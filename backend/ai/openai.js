// backend/ai/openai.js
//
// Thin wrapper around the OpenAI Chat Completions API. Same design as
// gemini.js (which this replaces as the active provider — left in place
// in case anyone wants to switch back): one fetch() call, fails SOFT on
// every error path (no key, timeout, bad response), retries transient
// errors (429/503) once with a short backoff. Nothing in the app depends
// on this working — AI here is always a convenience layer.

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const TIMEOUT_MS = 8_000;
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 800;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callOpenAIOnce(prompt, json) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[openai] OPENAI_API_KEY not set — AI features are disabled, falling back to manual flow.');
    return { text: null, retryable: false };
  }

  const body = {
    model: OPENAI_MODEL,
    messages: [{ role: 'user', content: prompt }],
    ...(json ? { response_format: { type: 'json_object' } } : {}),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[openai] API error ${res.status}: ${errText.slice(0, 300)}`);
      // 429 (rate limit) and 503 (overloaded) are worth retrying; a bad
      // key, bad model name, or bad request won't fix itself on a retry.
      const retryable = res.status === 429 || res.status === 503;
      return { text: null, retryable };
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    return { text: text ?? null, retryable: false };
  } catch (err) {
    console.error(`[openai] request failed: ${err.message}`);
    return { text: null, retryable: true };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Calls OpenAI with a prompt and returns the raw text response, or null
 * if it fails even after retrying transient errors.
 *
 * @param {string} prompt
 * @param {object} [options]
 * @param {boolean} [options.json] - ask for a valid JSON object back
 */
async function callOpenAI(prompt, { json = false } = {}) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { text, retryable } = await callOpenAIOnce(prompt, json);
    if (text !== null) return text;
    if (!retryable || attempt === MAX_ATTEMPTS) return null;

    console.warn(`[openai] retrying after transient error (attempt ${attempt}/${MAX_ATTEMPTS})...`);
    await sleep(RETRY_DELAY_MS * attempt);
  }
  return null;
}

/**
 * Calls OpenAI asking for a JSON object and parses it. Returns null on
 * any failure, including a response that isn't valid JSON.
 */
async function callOpenAIJson(prompt) {
  const text = await callOpenAI(prompt, { json: true });
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error(`[openai] response was not valid JSON: ${text.slice(0, 300)}`);
    return null;
  }
}

module.exports = { callOpenAI, callOpenAIJson };
