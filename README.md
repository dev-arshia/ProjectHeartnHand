# ProjectHeartnHand

Missing Person Coordination for disaster response — a system for a first hackathon build, not a production tool.

> **Status:** 🚧 Under active development for [hackathon name] — see [docs/PLAN.md](docs/PLAN.md) for the full design.

## The problem

After a disaster, reports about missing and rescued people pour in from helplines, relief camps, hospitals, volunteers, and the public — the same person described differently in each one. Genuine matches get buried under duplicates and misspellings, and families are left calling every channel at once because no one tells them the honest state of their case.

## What this does

Heart & Hand collects missing- and found-person reports, scores possible matches between them using explainable fuzzy-matching (name, age, location, time, description, identifying marks), and puts every match in front of a **human verifier** before anyone is told a match was found. Families can check an honest status page with a case ID — including when there's *no* confirmed answer yet.

**This is deliberately not:** a facial-recognition system, an automated notification system, or a replacement for field search-and-rescue. Human verification is a hard requirement, not a fallback.

## Tech stack

- Frontend: plain HTML/CSS/JavaScript (no framework/build step)
- Backend: Node.js + Express
- Database: SQLite (`better-sqlite3`)
- Matching: `fuzzball` (Jaro-Winkler/Levenshtein-style string similarity) + a weighted, explainable scoring function

## Getting started

**Requires Node.js 22.5 or newer** (we use the built-in `node:sqlite` module, so no database install or C++ build tools needed — just Node itself). Check with `node --version`; if it's older, grab the latest from [nodejs.org](https://nodejs.org).

```bash
git clone https://github.com/dev-arshia/ProjectHeartnHand.git
cd ProjectHeartnHand
npm install
npm start
```

Then open http://localhost:3000 — you should see `{"status":"ok",...}` at http://localhost:3000/api/health if the server booted correctly.

`npm run seed` (adds demo data) becomes available once `data/seed.js` is built — not yet.

## Project structure

```
backend/     Express server, routes, matching logic
frontend/    Public + admin HTML/CSS/JS pages
data/        Seed script and sample demo data
docs/        Design docs, architecture notes, screenshots
```

## Documentation

- [docs/PLAN.md](docs/PLAN.md) — full design: schema, pages, matching approach, roadmap
- [docs/LIMITATIONS.md](docs/LIMITATIONS.md) — what this does *not* do, and why (coming soon)

## License

MIT
