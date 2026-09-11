// backend/routes/ai.js
//
// Public endpoint: turns a free-text description (the kind a helpline
// operator types while someone talks) into structured report fields, to
// pre-fill the report form for a human to review and correct before
// submitting. This never creates a report by itself — it only returns
// suggested field values.

const express = require('express');
const { callGeminiJson } = require('../ai/gemini');

const router = express.Router();

function buildIntakePrompt(text, reportType) {
  const context = reportType === 'found'
    ? 'a found or rescued person (someone located at a relief camp, hospital, or elsewhere)'
    : 'a missing person';

  return `You are helping extract structured information from a free-text description of ${context}, for a disaster-relief report form. The text may be informal, a phone transcript, or written by someone under stress — extract only what's actually stated, and leave a field blank (empty string or null) if it isn't mentioned. Do not guess or invent details.

Return ONLY a JSON object with exactly these fields:
{
  "full_name": string or null,
  "age": number or null,
  "gender": "male" | "female" | "other" | null,
  "location": string or null,
  "event_datetime": an ISO 8601 datetime string if a specific date/time is mentioned, else null,
  "description": string or null (clothing/physical description),
  "identifying_marks": string or null (scars, tattoos, birthmarks, etc.)
}

Text to extract from:
"""
${text}
"""`;
}

// POST /api/ai/parse-intake  { text, report_type }
router.post('/parse-intake', async (req, res) => {
  const { text, report_type } = req.body || {};

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }

  const prompt = buildIntakePrompt(text.trim(), report_type);
  const extracted = await callGeminiJson(prompt);

  if (!extracted) {
    // Fails soft: the frontend should fall back to "please fill the form
    // manually" rather than showing an error that blocks the report.
    return res.status(200).json({ ok: false, fields: null });
  }

  res.json({ ok: true, fields: extracted });
});

module.exports = router;
