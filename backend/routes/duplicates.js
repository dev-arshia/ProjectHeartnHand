// backend/routes/duplicates.js
//
// Admin-facing endpoints for reviewing possible duplicate reports (two
// reports of the SAME type — e.g. two missing-person reports — that look
// like they describe the same individual). Distinct from matches.js,
// which links a missing report to a found report.

const express = require('express');
const { db } = require('../db');

const router = express.Router();

function reportSummaryFields(alias) {
  return `
    ${alias}.case_id AS ${alias}_case_id, ${alias}.report_type AS ${alias}_report_type,
    ${alias}.full_name AS ${alias}_name, ${alias}.age AS ${alias}_age,
    ${alias}.location AS ${alias}_location, ${alias}.event_datetime AS ${alias}_datetime,
    ${alias}.description AS ${alias}_description, ${alias}.identifying_marks AS ${alias}_marks,
    ${alias}.photo_path AS ${alias}_photo, ${alias}.status AS ${alias}_status
  `;
}

// GET /api/duplicates?status=pending
router.get('/', (req, res) => {
  const { status } = req.query;

  let sql = `
    SELECT duplicate_flags.*, ${reportSummaryFields('a')}, ${reportSummaryFields('b')}
    FROM duplicate_flags
    JOIN reports a ON a.id = duplicate_flags.report_a_id
    JOIN reports b ON b.id = duplicate_flags.report_b_id
    WHERE 1=1
  `;
  const params = [];
  if (status) {
    sql += ' AND duplicate_flags.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY duplicate_flags.score DESC, duplicate_flags.created_at DESC';

  const rows = db.prepare(sql).all(...params).map((r) => ({ ...r, breakdown: JSON.parse(r.breakdown_json) }));
  res.json(rows);
});

// GET /api/duplicates/:id
router.get('/:id', (req, res) => {
  const row = db.prepare(`
    SELECT duplicate_flags.*, ${reportSummaryFields('a')}, ${reportSummaryFields('b')}
    FROM duplicate_flags
    JOIN reports a ON a.id = duplicate_flags.report_a_id
    JOIN reports b ON b.id = duplicate_flags.report_b_id
    WHERE duplicate_flags.id = ?
  `).get(req.params.id);

  if (!row) return res.status(404).json({ error: 'Duplicate flag not found' });
  res.json({ ...row, breakdown: JSON.parse(row.breakdown_json) });
});

// POST /api/duplicates/:id/merge  { keep: 'a' | 'b', actor }
// Keeps one report as the canonical record and closes the other, noting
// the merge in the audit trail. Does not delete anything — the closed
// report stays in the database for the audit history.
router.post('/:id/merge', (req, res) => {
  const flag = db.prepare('SELECT * FROM duplicate_flags WHERE id = ?').get(req.params.id);
  if (!flag) return res.status(404).json({ error: 'Duplicate flag not found' });
  if (flag.status !== 'pending') {
    return res.status(400).json({ error: `Duplicate flag already ${flag.status}` });
  }

  const { keep, actor } = req.body || {};
  if (keep !== 'a' && keep !== 'b') {
    return res.status(400).json({ error: 'keep must be "a" or "b"' });
  }

  const keepId = keep === 'a' ? flag.report_a_id : flag.report_b_id;
  const closeId = keep === 'a' ? flag.report_b_id : flag.report_a_id;
  const actorName = actor || 'admin';
  const now = new Date().toISOString();

  const keepReport = db.prepare('SELECT case_id FROM reports WHERE id = ?').get(keepId);
  const closeReport = db.prepare('SELECT case_id FROM reports WHERE id = ?').get(closeId);

  db.prepare(`UPDATE duplicate_flags SET status = 'merged', reviewed_by = ?, reviewed_at = ? WHERE id = ?`)
    .run(actorName, now, flag.id);

  db.prepare(`UPDATE reports SET status = 'closed', updated_at = datetime('now') WHERE id = ?`).run(closeId);

  db.prepare(`
    INSERT INTO audit_log (report_id, action, actor, notes)
    VALUES (?, 'duplicate_merged', ?, ?), (?, 'duplicate_merged', ?, ?)
  `).run(
    keepId, actorName, `Confirmed as the same person as ${closeReport.case_id}; that report was closed`,
    closeId, actorName, `Closed as a duplicate of ${keepReport.case_id}`
  );

  const updated = db.prepare('SELECT * FROM duplicate_flags WHERE id = ?').get(flag.id);
  res.json(updated);
});

// POST /api/duplicates/:id/dismiss  { actor, reason }
router.post('/:id/dismiss', (req, res) => {
  const flag = db.prepare('SELECT * FROM duplicate_flags WHERE id = ?').get(req.params.id);
  if (!flag) return res.status(404).json({ error: 'Duplicate flag not found' });
  if (flag.status !== 'pending') {
    return res.status(400).json({ error: `Duplicate flag already ${flag.status}` });
  }

  const { actor, reason } = req.body || {};
  const actorName = actor || 'admin';
  const now = new Date().toISOString();

  db.prepare(`UPDATE duplicate_flags SET status = 'dismissed', reviewed_by = ?, reviewed_at = ? WHERE id = ?`)
    .run(actorName, now, flag.id);

  db.prepare(`
    INSERT INTO audit_log (report_id, action, actor, notes)
    VALUES (?, 'duplicate_dismissed', ?, ?), (?, 'duplicate_dismissed', ?, ?)
  `).run(
    flag.report_a_id, actorName, reason || 'Not the same person',
    flag.report_b_id, actorName, reason || 'Not the same person'
  );

  const updated = db.prepare('SELECT * FROM duplicate_flags WHERE id = ?').get(flag.id);
  res.json(updated);
});

module.exports = router;
