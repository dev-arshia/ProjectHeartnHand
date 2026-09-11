# Limitations & scope decisions

Built for a first hackathon in ~24-36 hours. This is an honest list of what
we deliberately did not build, and why — not an apology, a scope record.

## What the matching engine is (and isn't)

- **It is not machine learning.** It's a weighted, rule-based scoring
  function over six signals (name, age, location, date/time, description,
  identifying marks), each computed with well-established string-similarity
  algorithms (`fuzzball`, a Jaro-Winkler/Levenshtein-style library). We
  chose this deliberately over an ML model: it's fully explainable (an
  admin can see exactly why a pair scored 89%), doesn't require training
  data we don't have, and is honest about its own confidence — it never
  claims more certainty than a string comparison can actually support.
- **Photo similarity is not scored.** Uploaded photos are shown side by
  side to the human reviewer, but the score itself doesn't currently
  factor in image similarity. Adding a perceptual-hash or embedding-based
  signal is a natural next step, but we didn't want a "photo similarity"
  number on screen that we hadn't validated wasn't misleading.
- **The match/duplicate thresholds (50% / 60%) are demo-tuned, not
  statistically validated.** They were chosen by testing against the seed
  dataset, not against real-world disaster report data (which we don't
  have access to). A real deployment would need this tuned against actual
  historical cases, ideally with a human-reviewed calibration set.
- **Matching is an O(n) scan**, not a search index. Fine for hundreds of
  demo records; would need real indexing (e.g. a proper search engine or
  vector index for the photo-similarity case) at real disaster scale.

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

## Auth

The admin login is a single seeded account with a session cookie — no
password reset, no rate limiting on login attempts, no role hierarchy
beyond "admin". Enough to gate a demo dashboard; not a real auth system.

## What we'd build next with more time

1. Photo similarity as an additional (clearly labeled "experimental")
   signal in the match score.
2. A real search index for matching at scale beyond a few hundred records.
3. Rate limiting and stronger auth (password reset, multiple admin roles —
   e.g. "camp staff" who can file reports but not approve matches).
4. A proper data-retention/redaction policy for minors' records.
5. SMS/offline-friendly intake for areas with unreliable internet — the
   single channel we could not realistically build in this timeframe.
