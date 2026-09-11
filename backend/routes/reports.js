// backend/routes/reports.js
//
// Everything related to creating and reading missing/found-person reports.
// This is what both the public report forms and the admin dashboard talk to.

const express = require('express');
const multer = require('multer');
const path = require('node:path');
const crypto = require('node:crypto');

const { db, normalizeName, generateCaseId } = require('../db');

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

  // NOTE: automatic matching against opposite-type reports is wired up
  // in a later step (matching/score.js) — not yet in this route.

  const created = db.prepare('SELECT * FROM reports WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(created);
});

// --- List reports (admin dashboard) ---------------------------------------
// GET /api/reports?type=missing&status=unverified&search=rahul
router.get('/', (req, res) => {
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
// GET /api/reports/by-id/:id
router.get('/by-id/:id', (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  res.json(report);
});

// --- Get one report by public case ID (used by the family status page) ---
// GET /api/reports/:caseId
router.get('/:caseId', (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE case_id = ?').get(req.params.caseId.toUpperCase());
  if (!report) return res.status(404).json({ error: 'No case found with that ID' });
  res.json(report);
});

module.exports = router;
