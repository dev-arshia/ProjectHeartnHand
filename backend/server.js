// backend/server.js
//
// Entry point for the whole app. Starts an Express server that:
//   1. Serves the frontend (plain HTML/CSS/JS) as static files.
//   2. Exposes a JSON API under /api/* (routes added in later steps).
//
// Run it with: npm start   (or npm run dev to auto-restart on file changes)

require('./load-env'); // reads .env into process.env, if the file exists

const path = require('node:path');
const express = require('express');
const cookieSession = require('cookie-session');

// Importing db.js here makes sure the database file + tables exist as
// soon as the server boots, even before any route touches them.
require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Signed, cookie-based sessions — no session store to run, good enough
// for a demo-scale admin login. SESSION_SECRET should be set via .env in
// any real deployment; falls back to a fixed dev value locally.
app.use(cookieSession({
  name: 'phh_session',
  secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
  maxAge: 8 * 60 * 60 * 1000, // 8 hours
}));

// Serve the two frontend areas as static sites, plus the shared
// css/js folders that both public and admin pages pull from.
app.use('/', express.static(path.join(__dirname, '..', 'frontend', 'public')));
app.use('/admin', express.static(path.join(__dirname, '..', 'frontend', 'admin')));
app.use('/css', express.static(path.join(__dirname, '..', 'frontend', 'css')));
app.use('/js', express.static(path.join(__dirname, '..', 'frontend', 'js')));

// Uploaded photos (added in a later step) will live here.
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Simple health check — useful for confirming the server is alive,
// both locally and after deploying.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'projectheartnhand', time: new Date().toISOString() });
});

const { router: adminRouter, requireAdmin } = require('./routes/admin');

app.use('/api/reports', require('./routes/reports'));
// AI intake parsing is public (same reach as the report forms it assists) —
// it only ever returns suggested field values, never creates a report itself.
app.use('/api/ai', require('./routes/ai'));
// Match evidence includes sensitive details (photos, locations, contact
// info) — only a logged-in admin can view or act on it.
app.use('/api/matches', requireAdmin, require('./routes/matches'));
app.use('/api/duplicates', requireAdmin, require('./routes/duplicates'));
app.use('/api/admin', adminRouter);

app.listen(PORT, () => {
  console.log(`ProjectHeartnHand server running at http://localhost:${PORT}`);
});
