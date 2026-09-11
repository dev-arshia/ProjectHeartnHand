// backend/ai/gemini.js
//
// Thin wrapper around the Gemini REST API. Deliberately not using the
// official SDK — one fetch() call is simpler to read, and it's the only
// thing we need. Every function here fails SOFT: if there's no API key,
// the network call times out, or Gemini returns something we can't
// parse, we return null and the caller falls back to normal behavior
// (manual form entry, or just no AI explanation shown). AI here is
// always a convenience layer — nothing in the app depends on it working.

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const TIMEOUT_MS = 10_000;

/**
 * Calls Gemini with a prompt and returns the raw text response, or null
 * if anything goes wrong (no key configured, network error, timeout,
 * unexpected response shape).
 *
 * @param {string} prompt
 * @param {object} [options]
 * @param {boolean} [options.json] - ask Gemini to return valid JSON
 */
async function callGemini(prompt, { json = false } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[gemini] GEMINI_API_KEY not set — AI features are disabled, falling back to manual flow.');
    return null;
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
      return null;
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return text ?? null;
  } catch (err) {
    console.error(`[gemini] request failed: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
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
