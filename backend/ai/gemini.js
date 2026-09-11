// backend/ai/gemini.js
//
// Thin wrapper around the Gemini REST API. Deliberately not using the
// official SDK — one fetch() call is simpler to read, and it's the only
// thing we need. Every function here fails SOFT: if there's no API key,
// the network call times out, or Gemini returns something we can't
// parse, we return null and the caller falls back to normal behavior
// (manual form entry, or just no AI explanation shown). AI here is
// always a convenience layer — nothing in the app depends on it working.

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
// A successful call typically takes 5-6s; 8s gives it room without
// letting a hung request drag a demo out.
const TIMEOUT_MS = 8_000;

// Google's free tier returns 503 "high demand" fairly often — it's
// transient, not a real failure, so we retry once with a short backoff
// before giving up and falling back to the manual flow. Capped at 2
// total attempts (not 3+) so a full failure still resolves in well
// under 20s during a live demo, rather than making the audience wait.
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 800;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGeminiOnce(prompt, json) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[gemini] GEMINI_API_KEY not set — AI features are disabled, falling back to manual flow.');
    return { text: null, retryable: false };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    ...(json ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[gemini] API error ${res.status}: ${errText.slice(0, 300)}`);
      // 503 (overloaded) and 429 (rate limited) are worth retrying;
      // anything else (bad request, bad key, model not found) won't
      // fix itself on a retry.
      const retryable = res.status === 503 || res.status === 429;
      return { text: null, retryable };
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return { text: text ?? null, retryable: false };
  } catch (err) {
    console.error(`[gemini] request failed: ${err.message}`);
    // A timeout/network hiccup is also worth one retry.
    return { text: null, retryable: true };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Calls Gemini with a prompt and returns the raw text response, or null
 * if it fails even after retrying transient errors (overload, rate
 * limit, timeout). A non-retryable failure (no API key, bad request)
 * returns null immediately without wasting time retrying.
 *
 * @param {string} prompt
 * @param {object} [options]
 * @param {boolean} [options.json] - ask Gemini to return valid JSON
 */
async function callGemini(prompt, { json = false } = {}) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { text, retryable } = await callGeminiOnce(prompt, json);
    if (text !== null) return text;
    if (!retryable || attempt === MAX_ATTEMPTS) return null;

    console.warn(`[gemini] retrying after transient error (attempt ${attempt}/${MAX_ATTEMPTS})...`);
    await sleep(RETRY_DELAY_MS * attempt); // 1.2s, then 2.4s
  }
  return null;
}

/**
 * Calls Gemini asking for JSON and parses it. Returns null on any
 * failure — including a response that isn't valid JSON, which does
 * happen even when responseMimeType is requested.
 */
async function callGeminiJson(prompt) {
  const text = await callGemini(prompt, { json: true });
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error(`[gemini] response was not valid JSON: ${text.slice(0, 300)}`);
    return null;
  }
}

module.exports = { callGemini, callGeminiJson };
