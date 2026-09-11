# Limitations & scope decisions

Built for a first hackathon in ~24-36 hours. This is an honest list of what
we deliberately did not build, and why — not an apology, a scope record.

## What the matching engine is (and isn't)

- **It is not machine learning.** It's a weighted, rule-based scoring
  function over seven signals (name, age, location, date/time, description,
  identifying marks, photo), each computed with well-established
  similarity algorithms — `fuzzball` (Jaro-Winkler/Levenshtein-style) for
  text, perceptual hashing for photos. We chose this deliberately over an
  ML model: it's fully explainable (an admin can see exactly why a pair
  scored 89%), doesn't require training data we don't have, and is honest
  about its own confidence — it never claims more certainty than a string
  or hash comparison can actually support.
- **Photo similarity is real but deliberately modest.** It uses perceptual
  hashing (`blockhash-core`) — comparing overall visual similarity
  (framing, color, lighting), NOT face recognition. It has no concept of
  identity and will score two different people in similarly-lit blue
  shirts as visually similar. That's why it's labeled "experimental" in
  the UI and weighted at 20%, not treated as decisive. A real deployment
  wanting stronger photo matching would need a validated face-embedding
  model and a lot more scrutiny before trusting its number the way this
  weight suggests — we didn't want to overclaim what a hackathon-timeframe
  implementation can responsibly deliver.
- **The match/duplicate thresholds (50% / 60%) are demo-tuned, not
  statistically validated.** They were chosen by testing against the seed
  dataset, not against real-world disaster report data (which we don't
  have access to). A real deployment would need this tuned against actual
  historical cases, ideally with a human-reviewed calibration set.
- **Matching is an O(n) scan**, not a search index. Fine for hundreds of
  demo records; would need real indexing (e.g. a proper search engine or
  vector index for the photo-similarity case) at real disaster scale.

## Where AI (OpenAI) is used, and where it deliberately isn't

Two features call the OpenAI API — both are assistive, neither makes a
decision the system acts on:

1. **Smart intake parsing** turns a free-text description into suggested
   form field values. It never creates or submits a report by itself —
   the structured fields still land in an editable form a human reviews
   before hitting Submit.
2. **Match explanations** turn the deterministic score breakdown into one
   readable paragraph for a busy admin. Critically: the explanation is
   generated *from* the already-computed score, and cannot change it —
   the approve/reject decision is made from the same evidence either way.

**The match/duplicate scoring itself has no AI in it at all** — that's
the deterministic engine described above. We kept AI out of the actual
scoring on purpose: an LLM asked "does this match?" would produce a
plausible-sounding but unauditable answer, which is the opposite of what
a life-safety verification workflow needs. The one place we did use AI is
where wrongness costs almost nothing (a form pre-fill a human reviews, a
narration of a score that already exists) — never where wrongness could
mislead a verifier or a family.

Both features **fail soft**: no API key, a timeout, a malformed response —
none of it crashes the app or blocks a workflow. Intake parsing falls
back to "please fill in manually"; explanation generation falls back to
just showing the score breakdown with no narration. We tested this
explicitly with no key configured before ever testing with one.

## What "human verification" actually guarantees

No code path in this system can set a report's status to `verified_match`
except an authenticated admin clicking Approve on a specific match. The
scoring engine only ever produces `pending` candidates. This is enforced
at the database/API level, not just in the UI — hitting the API directly
still requires a valid admin session and an explicit approve action.

## What "controlled crowdsourcing" means here

Every report — whether filed by a family member, a hospital, or a random
member of the public — goes through the same pipeline: it's stored as
`unverified`, scored against existing reports, and any candidate match
sits as `pending` until a human reviews it. There is no code path where a
public submission alone can flip a case to verified. We didn't build a
separate "tip" form distinct from the main report forms — the existing
forms already have this property, so a second form would have added
surface area without adding safety.

## Privacy

- The public case-status page only ever returns name, report type, and a
  status label — never location, contact info, or photos.
- Reports for minors are flagged (`is_minor`) and visible to admins, but
  we did not build additional redaction rules beyond what the public
  status page already withholds. A real deployment handling minors' data
  at scale would need a dedicated data-handling policy beyond a hackathon
  MVP's scope.
- There is no encryption at rest — `data.db` is a plain SQLite file. Fine
  for a local demo; not fine for a real deployment without further work.

## Deployment notes

If deployed to a host with ephemeral disk (e.g. Render's free tier,
which wipes local files on every restart/redeploy), two things follow:
- **Data doesn't persist across restarts.** We handle this by
  auto-seeding demo data on boot whenever the database is empty
  (`server.js` checks report count, calls `data/seed.js` if zero) — so a
  cold-started deploy always shows a working demo instead of a blank app.
  This means, though, that anything a real user did (filed a report,
  approved a match) between deploys is not retained. Fine for a hackathon
  demo link; not fine for anything real without a persistent database.
- **Uploaded photos don't persist either**, for the same reason — they
  live in `backend/uploads/`, on the same ephemeral disk.
- A real deployment needs a persistent database (e.g. Postgres) and
  object storage for photos (e.g. S3-compatible storage) — both
  reasonable follow-ups, both out of scope for this timeframe.

## Auth

The admin login is a single seeded account with a session cookie — no
password reset, no rate limiting on login attempts, no role hierarchy
beyond "admin". Enough to gate a demo dashboard; not a real auth system.

## What we'd build next with more time

1. A validated face-embedding model to replace/supplement the current
   perceptual-hash photo signal, which only measures overall visual
   similarity, not identity.
2. A real search index for matching at scale beyond a few hundred records.
3. Rate limiting and stronger auth (password reset, multiple admin roles —
   e.g. "camp staff" who can file reports but not approve matches).
4. A proper data-retention/redaction policy for minors' records.
5. SMS/offline-friendly intake for areas with unreliable internet — the
   single channel we could not realistically build in this timeframe.
