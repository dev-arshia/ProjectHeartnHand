// backend/load-env.js
//
// A tiny, dependency-free .env file loader. We don't need the full
// `dotenv` package for one job: read KEY=VALUE lines from .env (if it
// exists) and set them on process.env, without overwriting anything
// already set by the real environment (e.g. on Render).
//
// require()'d once, at the very top of server.js, before anything else
// reads process.env.

const fs = require('node:fs');
const path = require('node:path');

function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;

  const contents = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    // Strip matching surrounding quotes, if any.
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();
