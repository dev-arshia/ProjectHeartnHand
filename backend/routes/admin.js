// backend/routes/admin.js
//
// Just enough auth to gate the dashboard for the demo: one seeded admin
// account, a signed session cookie (cookie-session — no session store to
// run), and a middleware other routes can use to require login.
//
// Being upfront in the README about what this is NOT: this is not a real
// authentication system (no password reset, no rate limiting, no roles
// beyond "admin"). That's a deliberate scope cut for a hackathon MVP.

const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');

const router = express.Router();

// Seed a default admin account on first boot if none exists yet, so the
// demo works out of the box without a separate setup step.
function ensureDefaultAdmin() {
  const existing = db.prepare('SELECT 1 FROM admins LIMIT 1').get();
  if (existing) return;

  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const password_hash = bcrypt.hashSync(password, 10);

  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(username, password_hash);
  console.log(`Seeded default admin account: username="${username}" password="${password}" (change this for anything beyond a demo)`);
}

ensureDefaultAdmin();

// --- Middleware: require an admin session -------------------------------
// Any route that needs login protection can do:
//   const { requireAdmin } = require('../routes/admin');
//   router.get('/secret', requireAdmin, (req, res) => {...});
function requireAdmin(req, res, next) {
  if (req.session && req.session.adminUsername) return next();
  res.status(401).json({ error: 'Login required' });
}

// --- Login -------------------------------------------------------------
// POST /api/admin/login  { username, password }
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  req.session.adminUsername = admin.username;
  res.json({ username: admin.username });
});

// --- Logout ---------------------------------------------------------------
// POST /api/admin/logout
router.post('/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

// --- Who am I? (so the dashboard can check login state on page load) ---
// GET /api/admin/me
router.get('/me', (req, res) => {
  if (req.session && req.session.adminUsername) {
    return res.json({ username: req.session.adminUsername });
  }
  res.status(401).json({ error: 'Not logged in' });
});

// --- Dashboard stats -----------------------------------------------------
// GET /api/admin/stats
// One summary query for the numbers shown at the top of the dashboard —
// gives the admin a sense of overall caseload at a glance, not just
// per-tab tables.
router.get('/stats', requireAdmin, (req, res) => {
  const counts = db.prepare(`
    SELECT report_type, status, COUNT(*) as n FROM reports GROUP BY report_type, status
  `).all();

  const totals = { missing: 0, found: 0, verified_match: 0, possible_match: 0, minors: 0 };
  for (const row of counts) {
    totals[row.report_type] += row.n;
    if (row.status === 'verified_match') totals.verified_match += row.n;
    if (row.status === 'possible_match') totals.possible_match += row.n;
  }

  totals.minors = db.prepare(`SELECT COUNT(*) as n FROM reports WHERE is_minor = 1`).get().n;
  totals.pending_matches = db.prepare(`SELECT COUNT(*) as n FROM matches WHERE status = 'pending'`).get().n;
  totals.pending_duplicates = db.prepare(`SELECT COUNT(*) as n FROM duplicate_flags WHERE status = 'pending'`).get().n;
  totals.total_reports = totals.missing + totals.found;

  res.json(totals);
});

module.exports = { router, requireAdmin };
