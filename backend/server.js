// backend/server.js
//
// Entry point for the whole app. Starts an Express server that:
//   1. Serves the frontend (plain HTML/CSS/JS) as static files.
//   2. Exposes a JSON API under /api/* (routes added in later steps).
//
// Run it with: npm start   (or npm run dev to auto-restart on file changes)

const path = require('node:path');
const express = require('express');

// Importing db.js here makes sure the database file + tables exist as
// soon as the server boots, even before any route touches them.
require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

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

app.use('/api/reports', require('./routes/reports'));
app.use('/api/matches', require('./routes/matches'));

// Mounted in a later step:
// app.use('/api/admin', require('./routes/admin'));

app.listen(PORT, () => {
  console.log(`ProjectHeartnHand server running at http://localhost:${PORT}`);
});
