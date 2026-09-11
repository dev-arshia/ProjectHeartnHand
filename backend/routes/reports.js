// backend/routes/reports.js
//
// Everything related to creating and reading missing/found-person reports.
// This is what both the public report forms and the admin dashboard talk to.

const express = require('express');
const multer = require('multer');
const path = require('node:path');
const crypto = require('node:crypto');

const { db, normalizeName, generateCaseId } = require('../db');
const { generateMatchesForReport } = require('../matching/generate');
const { requireAdmin } = require('./admin');

const router = express.Router();

// --- Photo upload setup -------------------------------------------------
// Photos are saved to backend/uploads/ with a random filename (so two
// people uploading "photo.jpg" don't collide) and served back at /uploads/<filename>.
const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

function imageFileFilter(req, file, cb) {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) cb(null, true);
  else cb(new Error('Only .jpg, .jpeg, .png, and .webp photos are allowed'));
}

const upload = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// --- Create a report ------------------------------------------------------
// POST /api/reports
// multipart/form-data (so it can include an optional photo)
router.post('/', upload.single('photo'), (req, res) => {
  const {
    report_type,
    full_name,
    age,
    gender,
    location,
    event_datetime,
    description,
    identifying_marks,
    is_minor,
    reporter_name,
    reporter_contact,
    source_channel,
  } = req.body;

  // Minimal required-field validation. Everything else is optional because
  // real reports genuinely do arrive with gaps — that's the whole premise.
  if (!report_type || !['missing', 'found'].includes(report_type)) {
    return res.status(400).json({ error: 'report_type must be "missing" or "found"' });
  }
  if (!full_name || !full_name.trim()) {
    return res.status(400).json({ error: 'full_name is required' });
  }
  if (!location || !location.trim()) {
    return res.status(400).json({ error: 'location is required' });
  }

  const case_id = generateCaseId(report_type);
  const photo_path = req.file ? `/uploads/${req.file.filename}` : null;

  const insert = db.prepare(`
    INSERT INTO reports (
      case_id, report_type, full_name, name_normalized, age, gender,
      location, event_datetime, description, identifying_marks, photo_path,
      is_minor, reporter_name, reporter_contact, source_channel
    ) VALUES (
      @case_id, @report_type, @full_name, @name_normalized, @age, @gender,
      @location, @event_datetime, @description, @identifying_marks, @photo_path,
      @is_minor, @reporter_name, @reporter_contact, @source_channel
    )
  `);

  const result = insert.run({
    case_id,
    report_type,
    full_name: full_name.trim(),
    name_normalized: normalizeName(full_name),
    age: age ? Number(age) : null,
    gender: gender || null,
    location: location.trim(),
    event_datetime: event_datetime || null,
    description: description || null,
    identifying_marks: identifying_marks || null,
    photo_path,
    is_minor: is_minor === 'true' || is_minor === true ? 1 : 0,
    reporter_name: reporter_name || null,
    reporter_contact: reporter_contact || null,
    source_channel: source_channel || 'public',
  });

  db.prepare(`
    INSERT INTO audit_log (report_id, action, actor, notes)
    VALUES (?, 'report_created', ?, ?)
  `).run(result.lastInsertRowid, reporter_name || 'anonymous', `Filed via ${source_channel || 'public'} channel`);

  let created = db.prepare('SELECT * FROM reports WHERE id = ?').get(result.lastInsertRowid);

  // Compare this new report against every report of the opposite type and
  // store any candidate matches for admin review. This can flip `created`'s
  // status from 'unverified' to 'possible_match', so we re-fetch below.
  const newMatches = generateMatchesForReport(created);
  if (newMatches.length > 0) {
    created = db.prepare('SELECT * FROM reports WHERE id = ?').get(result.lastInsertRowid);
  }

  res.status(201).json({ ...created, matches_found: newMatches.length });
});

// --- List reports (admin dashboard) ---------------------------------------
// GET /api/reports?type=missing&status=unverified&search=rahul
// Admin-only: this exposes every reporter's contact info across all
// cases, not just the one case a family member is checking on.
router.get('/', requireAdmin, (req, res) => {
  const { type, status, search } = req.query;

  let sql = 'SELECT * FROM reports WHERE 1=1';
  const params = [];

  if (type) {
    sql += ' AND report_type = ?';
    params.push(type);
  }
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (search) {
    sql += ' AND (name_normalized LIKE ? OR location LIKE ? OR case_id LIKE ?)';
    const like = `%${normalizeName(search)}%`;
    const likeRaw = `%${search}%`;
    params.push(like, likeRaw, likeRaw);
  }

  sql += ' ORDER BY created_at DESC';

  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// --- Get one report by internal numeric id (used by admin case detail,
// match review screens) ---
// Admin-only.
// GET /api/reports/by-id/:id
router.get('/by-id/:id', requireAdmin, (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  res.json(report);
});

// --- Audit history for one report (admin case detail page) ---
// Admin-only.
// GET /api/reports/by-id/:id/audit
router.get('/by-id/:id/audit', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM audit_log WHERE report_id = ? ORDER BY created_at DESC
  `).all(req.params.id);
  res.json(rows);
});

// --- Matches involving this report (admin case detail page) ---
// Admin-only.
// GET /api/reports/by-id/:id/matches
router.get('/by-id/:id/matches', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT matches.*, m.full_name AS missing_name, m.case_id AS missing_case_id,
           f.full_name AS found_name, f.case_id AS found_case_id
    FROM matches
    JOIN reports m ON m.id = matches.missing_report_id
    JOIN reports f ON f.id = matches.found_report_id
    WHERE matches.missing_report_id = ? OR matches.found_report_id = ?
    ORDER BY matches.score DESC
  `).all(req.params.id, req.params.id);
  res.json(rows.map((r) => ({ ...r, breakdown: JSON.parse(r.breakdown_json) })));
});

// --- Get one report by public case ID (used by the family status page) ---
// GET /api/reports/:caseId
router.get('/:caseId', (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE case_id = ?').get(req.params.caseId.toUpperCase());
  if (!report) return res.status(404).json({ error: 'No case found with that ID' });
  res.json(report);
});

module.exports = router;
