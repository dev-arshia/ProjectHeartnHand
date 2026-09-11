# ProjectHeartnHand

Missing Person Coordination for disaster response — built for a first hackathon.

## The problem

After a disaster, information about missing and rescued people arrives through
dozens of uncoordinated channels — relief camps, hospitals, social media,
helplines, volunteers. The same person gets reported many times under
different spellings, while genuine matches between a "missing" report and a
"found" report get buried in the noise.

## What this does

ProjectHeartnHand collects missing- and found-person reports from any
channel, scores possible matches between them using explainable
fuzzy-matching, flags likely duplicate reports of the same person, and puts
every candidate in front of a **human verifier** before anything is
confirmed. Families can check an honest status page with a case ID —
including when there's *no* confirmed answer yet.

**This is deliberately not:** a facial-recognition system, an automated
notification system, or a replacement for field search-and-rescue. Human
verification is a hard requirement, enforced at the code level — see
[docs/LIMITATIONS.md](docs/LIMITATIONS.md) for exactly what that does and
doesn't guarantee.

## Core features

- **Multi-channel intake** — public report forms for both missing and
  found/rescued people, with a source-channel field (helpline, camp,
  hospital, volunteer, public). Includes an optional **AI-assisted
  free-text intake**: paste a rough description (like a phone transcript)
  and AI pre-fills the structured fields for a human to review before
  submitting — it only ever suggests values, never submits on its own.
- **Explainable fuzzy matching** — every new report is automatically
  scored against opposite-type reports on name, age, location, date/time,
  description, identifying marks, and (when both sides have a photo)
  perceptual photo similarity. No black-box ML: every score comes with a
  per-signal High/Medium/Low breakdown an admin can actually read.
- **Duplicate consolidation** — same-type reports (two missing reports,
  two found reports) are compared too, to catch the same person reported
  twice under different spellings.
- **Human verification workflow** — candidate matches sit as `pending`
  until an authenticated admin approves or rejects them. Nothing in the
  scoring engine can mark a case verified on its own. An optional
  **AI-generated plain-language explanation** narrates the score
  breakdown in one paragraph for the admin — purely descriptive, computed
  *from* the score, never the other way around.
- **Full audit trail** — every report creation, match, approval,
  rejection, and merge is logged with who did it and when.
- **Honest family status page** — a case-ID lookup that reports the real
  state of a case (e.g. "a possible match is under review") instead of a
  false all-clear or a bare status code.

## Tech stack

- **Frontend:** plain HTML/CSS/JavaScript, no framework, no build step
- **Backend:** Node.js + Express
- **Database:** SQLite via Node's built-in `node:sqlite` module — no
  database server to install, no C++ build toolchain needed
- **Matching:** [`fuzzball`](https://www.npmjs.com/package/fuzzball)
  (Jaro-Winkler/Levenshtein-style string similarity) + a weighted,
  explainable scoring function we wrote (`backend/matching/score.js`)
- **AI (optional):** [OpenAI API](https://platform.openai.com/api-keys)
  for two assistive features — see above. The app runs completely fine
  with no key configured; both features just fall back to manual entry /
  no explanation shown. (A Gemini wrapper also exists in `backend/ai/`
  if you'd rather swap providers — see `backend/ai/openai.js` vs
  `backend/ai/gemini.js`.)

We chose this stack specifically to be finishable by a small student team
in a hackathon timeframe — see [docs/LIMITATIONS.md](docs/LIMITATIONS.md)
for what we deliberately left out and why.

## Getting started

**Requires Node.js 22.5 or newer** (for `node:sqlite`). Check with
`node --version`; get the latest from [nodejs.org](https://nodejs.org) if needed.

```bash
git clone https://github.com/dev-arshia/ProjectHeartnHand.git
cd ProjectHeartnHand
npm install
npm run seed    # populates realistic demo data — duplicates, misspellings,
                 # a confirmed match, a rejected match, unrelated people
npm start
```

**Optional — enable AI features:** copy `.env.example` to `.env` and set
`OPENAI_API_KEY` (get one from [platform.openai.com/api-keys](https://platform.openai.com/api-keys)).
Not required to run or demo the app — everything else works identically
without it.

Open **http://localhost:3000** for the public site, or
**http://localhost:3000/admin/login.html** for the admin dashboard
(demo login: `admin` / `admin123`, printed by the seed script).

## Project structure

```
backend/
  db.js              SQLite schema (reports, matches, duplicate_flags, audit_log, admins)
  server.js           Express app entry point
  matching/
    score.js          The explainable scoring function
    generate.js        Runs scoring against existing reports on every new report
  routes/
    reports.js         Create/list/lookup reports
    matches.js          List/approve/reject missing<->found match candidates
    duplicates.js       List/merge/dismiss same-type duplicate candidates
    admin.js            Login/logout/session

frontend/
  public/              Landing page, report forms, case status lookup
  admin/               Login, dashboard, match review, duplicate review, case detail
  css/, js/            Shared styles and client-side logic

data/
  seed.js              Realistic demo dataset

docs/
  LIMITATIONS.md        Honest scope-cut documentation
```

## How the matching works, briefly

Every new report is compared against every existing report of the
opposite type (missing↔found) and every existing report of the same
type (for duplicate detection), using seven signals — name, age, location,
date/time, description, identifying marks, and photo similarity (when
both sides have a photo, via perceptual hashing — see
[docs/LIMITATIONS.md](docs/LIMITATIONS.md) for what that does and doesn't
mean). Each signal is scored 0-100 and
labeled High/Medium/Low/None; the overall score is a weighted average over
whichever signals actually had data on both sides (a blank field never
unfairly drags a score down). Anything scoring above a threshold becomes a
`pending` candidate for a human to review. Full details and the exact
weights are in `backend/matching/score.js`, which is short and commented
end to end.

## Demo data

`npm run seed` wipes and repopulates the database with a scripted scenario
designed to show every part of the system:

- A strong match with realistic spelling drift (`Rahul Sharma` / `R.
  Sharmma`), pre-approved so you can look it up on the status page.
- A near-miss that scores below confidence and gets rejected on review.
- A duplicate pair (`Meera Iyer` / `Meera lyer`) for the duplicate-review flow.
- A minor's case, to show the `is_minor` privacy flag.
- Clearly unrelated people, to demonstrate the system doesn't throw false
  positives at the admin.

## License

MIT
