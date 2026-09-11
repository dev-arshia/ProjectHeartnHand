// backend/routes/matches.js
//
// Admin-facing endpoints for reviewing candidate matches. This is where
// the "human in the loop" requirement actually lives: nothing here ever
// tells a family a match was found — it only lets a verified admin
// approve or reject what the scoring engine suggested.

const express = require('express');
const { db } = require('../db');
const { callOpenAI } = require('../ai/openai');

const router = express.Router();

// --- List matches, joined with both reports' key details -----------------
// GET /api/matches?status=pending
router.get('/', (req, res) => {
  const { status } = req.query;

  let sql = `
    SELECT
      matches.*,
      m.full_name AS missing_name, m.case_id AS missing_case_id, m.age AS missing_age,
      m.location AS missing_location, m.event_datetime AS missing_datetime,
      m.description AS missing_description, m.identifying_marks AS missing_marks,
      m.photo_path AS missing_photo,
      f.full_name AS found_name, f.case_id AS found_case_id, f.age AS found_age,
      f.location AS found_location, f.event_datetime AS found_datetime,
      f.description AS found_description, f.identifying_marks AS found_marks,
      f.photo_path AS found_photo
    FROM matches
    JOIN reports m ON m.id = matches.missing_report_id
    JOIN reports f ON f.id = matches.found_report_id
    WHERE 1=1
  `;
  const params = [];

  if (status) {
    sql += ' AND matches.status = ?';
    params.push(status);
  }

  sql += ' ORDER BY matches.score DESC, matches.created_at DESC';

  const rows = db.prepare(sql).all(...params).map((row) => ({
    ...row,
    breakdown: JSON.parse(row.breakdown_json),
  }));

  res.json(rows);
});

// --- Get one match by id (for the match review page) ----------------------
// GET /api/matches/:id
router.get('/:id', (req, res) => {
  const row = db.prepare(`
    SELECT
      matches.*,
      m.full_name AS missing_name, m.case_id AS missing_case_id, m.age AS missing_age,
      m.gender AS missing_gender, m.location AS missing_location, m.event_datetime AS missing_datetime,
      m.description AS missing_description, m.identifying_marks AS missing_marks,
      m.photo_path AS missing_photo,
      f.full_name AS found_name, f.case_id AS found_case_id, f.age AS found_age,
      f.gender AS found_gender, f.location AS found_location, f.event_datetime AS found_datetime,
      f.description AS found_description, f.identifying_marks AS found_marks,
      f.photo_path AS found_photo
    FROM matches
    JOIN reports m ON m.id = matches.missing_report_id
    JOIN reports f ON f.id = matches.found_report_id
    WHERE matches.id = ?
  `).get(req.params.id);

  if (!row) return res.status(404).json({ error: 'Match not found' });

  res.json({ ...row, breakdown: JSON.parse(row.breakdown_json) });
});

// --- Generate a plain-language explanation of the match ---------------
// POST /api/matches/:id/explain
//
// Purely descriptive: narrates the already-computed score breakdown in
// a sentence a busy admin can read faster than six breakdown rows. Does
// NOT influence the score or the approve/reject decision in any way —
// it's generated from the breakdown that already exists, never the
// other way around. Cached on the match row so repeat views don't
// re-call the API; pass ?regenerate=true to force a fresh one.
router.post('/:id/explain', async (req, res) => {
  const match = db.prepare(`
    SELECT matches.*, m.full_name AS missing_name, m.age AS missing_age,
           m.location AS missing_location, m.event_datetime AS missing_datetime,
           m.description AS missing_description, m.identifying_marks AS missing_marks,
           f.full_name AS found_name, f.age AS found_age,
           f.location AS found_location, f.event_datetime AS found_datetime,
           f.description AS found_description, f.identifying_marks AS found_marks
    FROM matches
    JOIN reports m ON m.id = matches.missing_report_id
    JOIN reports f ON f.id = matches.found_report_id
    WHERE matches.id = ?
  `).get(req.params.id);

  if (!match) return res.status(404).json({ error: 'Match not found' });

  if (match.ai_explanation && req.query.regenerate !== 'true') {
    return res.json({ explanation: match.ai_explanation, cached: true });
  }

  const breakdown = JSON.parse(match.breakdown_json);
  const prompt = `You are assisting a human reviewer deciding whether two disaster-relief reports describe the same person. Write ONE short paragraph (2-3 sentences, plain language, no bullet points) explaining why these two reports might or might not be the same person, based on the evidence below. Be balanced — mention any notable mismatch, not just similarities. Do not state a final verdict ("this is a match") — the human reviewer decides that, you're only summarizing the evidence.

Missing person report: name "${match.missing_name}", age ${match.missing_age ?? 'unknown'}, last seen at "${match.missing_location}"${match.missing_datetime ? ` on ${match.missing_datetime}` : ''}, description: "${match.missing_description || 'none given'}", identifying marks: "${match.missing_marks || 'none given'}".

Found person report: name "${match.found_name}", age ${match.found_age ?? 'unknown'}, found at "${match.found_location}"${match.found_datetime ? ` on ${match.found_datetime}` : ''}, description: "${match.found_description || 'none given'}", identifying marks: "${match.found_marks || 'none given'}".

Computed similarity scores (already calculated, just for your reference): ${Object.entries(breakdown).map(([k, v]) => `${k}: ${v.label}`).join(', ')}.`;

  const explanation = await callOpenAI(prompt);

  if (!explanation) {
    return res.status(200).json({ explanation: null, error: 'AI explanation unavailable right now — the score breakdown above is still fully valid on its own.' });
  }

  db.prepare(`UPDATE matches SET ai_explanation = ? WHERE id = ?`).run(explanation, match.id);
  res.json({ explanation, cached: false });
});

// --- Approve a match --------------------------------------------------
// POST /api/matches/:id/approve  { actor: "admin username" }
// This is the ONLY path that can mark a report 'verified_match'. Nothing
// in the scoring engine can do this on its own.
router.post('/:id/approve', (req, res) => {
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  if (match.status !== 'pending') {
    return res.status(400).json({ error: `Match already ${match.status}` });
  }

  const actor = (req.body && req.body.actor) || 'admin';
  const now = new Date().toISOString();

  db.prepare(`UPDATE matches SET status = 'approved', reviewed_by = ?, reviewed_at = ? WHERE id = ?`)
    .run(actor, now, match.id);

  db.prepare(`UPDATE reports SET status = 'verified_match', updated_at = datetime('now') WHERE id IN (?, ?)`)
    .run(match.missing_report_id, match.found_report_id);

  db.prepare(`
    INSERT INTO audit_log (report_id, match_id, action, actor, notes)
    VALUES (?, ?, 'match_approved', ?, ?), (?, ?, 'match_approved', ?, ?)
  `).run(
    match.missing_report_id, match.id, actor, `Approved match with found report`,
    match.found_report_id, match.id, actor, `Approved match with missing report`
  );

  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(match.id);
  res.json(updated);
});

// --- Reject a match --------------------------------------------------
// POST /api/matches/:id/reject  { actor: "admin username", reason: "..." }
router.post('/:id/reject', (req, res) => {
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  if (match.status !== 'pending') {
    return res.status(400).json({ error: `Match already ${match.status}` });
  }

  const actor = (req.body && req.body.actor) || 'admin';
  const reason = (req.body && req.body.reason) || null;
  const now = new Date().toISOString();

  db.prepare(`UPDATE matches SET status = 'rejected', reviewed_by = ?, reviewed_at = ? WHERE id = ?`)
    .run(actor, now, match.id);

  // If a report has no other pending matches left, drop it back to
  // 'unverified' rather than leaving it stuck on 'possible_match'.
  const revertIfNoOtherPending = db.prepare(`
    UPDATE reports SET status = 'unverified', updated_at = datetime('now')
    WHERE id = ? AND status = 'possible_match'
      AND NOT EXISTS (
        SELECT 1 FROM matches
        WHERE status = 'pending'
          AND (missing_report_id = ? OR found_report_id = ?)
      )
  `);
  revertIfNoOtherPending.run(match.missing_report_id, match.missing_report_id, match.missing_report_id);
  revertIfNoOtherPending.run(match.found_report_id, match.found_report_id, match.found_report_id);

  db.prepare(`
    INSERT INTO audit_log (report_id, match_id, action, actor, notes)
    VALUES (?, ?, 'match_rejected', ?, ?), (?, ?, 'match_rejected', ?, ?)
  `).run(
    match.missing_report_id, match.id, actor, reason || 'Rejected by verifier',
    match.found_report_id, match.id, actor, reason || 'Rejected by verifier'
  );

  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(match.id);
  res.json(updated);
});

module.exports = router;
