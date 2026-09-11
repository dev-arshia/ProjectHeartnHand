// backend/db.js
//
// Sets up our SQLite database using Node's built-in `node:sqlite` module.
// No external database server, no native compiler needed — just one file
// on disk (data.db) that stores everything.
//
// Every other file in the backend should `require('./db')` to get the
// same shared connection instead of opening its own.

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(__dirname, '..', 'data.db');
const db = new DatabaseSync(DB_PATH);

// Foreign keys are off by default in SQLite — turn them on so that, e.g.,
// a match row can't point at a report id that doesn't exist.
db.exec('PRAGMA foreign_keys = ON;');

// --- Schema -----------------------------------------------------------
// reports: one row per missing-person OR found-person report.
// report_type tells us which kind it is.
db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id           TEXT UNIQUE NOT NULL,
    report_type       TEXT NOT NULL CHECK (report_type IN ('missing', 'found')),
    full_name         TEXT NOT NULL,
    name_normalized   TEXT NOT NULL,
    age               INTEGER,
    gender            TEXT,
    location          TEXT NOT NULL,
    event_datetime    TEXT,
    description       TEXT,
    identifying_marks TEXT,
    photo_path        TEXT,
    is_minor          INTEGER NOT NULL DEFAULT 0,
    reporter_name     TEXT,
    reporter_contact  TEXT,
    source_channel    TEXT NOT NULL DEFAULT 'public',
    status            TEXT NOT NULL DEFAULT 'unverified'
                        CHECK (status IN ('unverified','possible_match','verified_match','rejected','closed')),
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(report_type);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_reports_name_normalized ON reports(name_normalized);`);

// matches: a candidate link between one missing report and one found report,
// with a score and a human-readable breakdown of why it scored that way.
db.exec(`
  CREATE TABLE IF NOT EXISTS matches (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    missing_report_id  INTEGER NOT NULL REFERENCES reports(id),
    found_report_id    INTEGER NOT NULL REFERENCES reports(id),
    score              INTEGER NOT NULL,
    breakdown_json      TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','rejected')),
    reviewed_by        TEXT,
    reviewed_at        TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(missing_report_id, found_report_id)
  );
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_matches_missing ON matches(missing_report_id);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_matches_found ON matches(found_report_id);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);`);

// duplicate_flags: same idea as `matches`, but for two reports of the
// SAME type (two missing reports, or two found reports) that look like
// they describe the same person filed twice — e.g. one from a family
// member and one from a volunteer, under slightly different spellings.
// Kept as a separate table from `matches` because the review action is
// different (merge/dismiss, not approve/reject a missing<->found link).
db.exec(`
  CREATE TABLE IF NOT EXISTS duplicate_flags (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    report_a_id   INTEGER NOT NULL REFERENCES reports(id),
    report_b_id   INTEGER NOT NULL REFERENCES reports(id),
    score         INTEGER NOT NULL,
    breakdown_json TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','merged','dismissed')),
    reviewed_by   TEXT,
    reviewed_at   TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(report_a_id, report_b_id)
  );
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_dupflags_a ON duplicate_flags(report_a_id);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_dupflags_b ON duplicate_flags(report_b_id);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_dupflags_status ON duplicate_flags(status);`);

// audit_log: a record of every decision made in the system, so admins
// (and judges) can see exactly who approved/rejected what and when.
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id   INTEGER REFERENCES reports(id),
    match_id    INTEGER REFERENCES matches(id),
    action      TEXT NOT NULL,
    actor       TEXT NOT NULL,
    notes       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// admins: just enough to gate the dashboard behind a login for the demo.
db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    username       TEXT UNIQUE NOT NULL,
    password_hash  TEXT NOT NULL
  );
`);

// --- Helpers ------------------------------------------------------------

// Normalizes a name for fuzzy matching: lowercase, trim, collapse spaces,
// strip punctuation like periods (so "R. Sharmma" and "r sharmma" compare
// the same way).
function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[.,'"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Generates a public-facing case ID like "MP-1042" (missing) or "FP-1042" (found).
// Not cryptographically anything — just needs to be short, unique, and easy
// for a family member to read over the phone. Retries on the rare collision.
function generateCaseId(reportType) {
  const prefix = reportType === 'missing' ? 'MP' : 'FP';
  const checkExists = db.prepare('SELECT 1 FROM reports WHERE case_id = ?');
  for (let attempt = 0; attempt < 20; attempt++) {
    const n = 1000 + Math.floor(Math.random() * 9000);
    const candidate = `${prefix}-${n}`;
    if (!checkExists.get(candidate)) return candidate;
  }
  // Extremely unlikely fallback: fall back to a timestamp suffix.
  return `${prefix}-${Date.now() % 100000}`;
}

module.exports = { db, normalizeName, generateCaseId };
