// backend/matching/generate.js
//
// Runs the scoring engine (score.js) against existing reports whenever a
// new report comes in, and stores any candidates worth a human's attention.
//
// Kept deliberately simple for the hackathon dataset size: it's an O(n)
// scan against opposite-type reports, not a search index. Fine for
// hundreds of demo records; would need real indexing at real disaster
// scale, and the README/docs should say so honestly.

const { db } = require('../db');
const { compareReports } = require('./score');

// Below this score, we don't even bother storing a match row — it would
// just be noise for the admin to scroll past. This is a demo-tuned
// threshold, not a validated cutoff.
const MATCH_THRESHOLD = 50;

/**
 * Given a newly created report, compares it against every existing report
 * of the opposite type, and stores match rows for anything scoring at or
 * above MATCH_THRESHOLD. Also bumps both reports' status to
 * 'possible_match' if they were 'unverified' (never downgrades a report
 * that's already verified/rejected/closed).
 *
 * @param {object} newReport - a full row from the reports table
 * @returns {Array} the match rows created (possibly empty)
 */
function generateMatchesForReport(newReport) {
  const oppositeType = newReport.report_type === 'missing' ? 'found' : 'missing';
  const candidates = db.prepare('SELECT * FROM reports WHERE report_type = ?').all(oppositeType);

  const insertMatch = db.prepare(`
    INSERT OR IGNORE INTO matches (missing_report_id, found_report_id, score, breakdown_json, status)
    VALUES (@missing_report_id, @found_report_id, @score, @breakdown_json, 'pending')
  `);

  const bumpStatus = db.prepare(`
    UPDATE reports SET status = 'possible_match', updated_at = datetime('now')
    WHERE id = ? AND status = 'unverified'
  `);

  const logMatch = db.prepare(`
    INSERT INTO audit_log (report_id, match_id, action, actor, notes)
    VALUES (?, ?, 'match_generated', 'system', ?)
  `);

  const createdMatches = [];

  for (const candidate of candidates) {
    const missing = newReport.report_type === 'missing' ? newReport : candidate;
    const found = newReport.report_type === 'found' ? newReport : candidate;

    const { score, breakdown } = compareReports(missing, found);
    if (score < MATCH_THRESHOLD) continue;

    const result = insertMatch.run({
      missing_report_id: missing.id,
      found_report_id: found.id,
      score,
      breakdown_json: JSON.stringify(breakdown),
    });

    // INSERT OR IGNORE means result.changes is 0 if this exact pair
    // already had a match row (the UNIQUE constraint in db.js) — skip
    // bumping status/logging again for a duplicate.
    if (result.changes === 0) continue;

    bumpStatus.run(missing.id);
    bumpStatus.run(found.id);
    logMatch.run(missing.id, result.lastInsertRowid, `Scored ${score}% against found report ${found.case_id}`);
    logMatch.run(found.id, result.lastInsertRowid, `Scored ${score}% against missing report ${missing.case_id}`);

    createdMatches.push({ id: result.lastInsertRowid, missing_report_id: missing.id, found_report_id: found.id, score, breakdown });
  }

  return createdMatches;
}

module.exports = { generateMatchesForReport, MATCH_THRESHOLD };
