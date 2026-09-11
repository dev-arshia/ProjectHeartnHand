// backend/matching/score.js
//
// The matching engine: compares one "missing" report against one "found"
// report and produces an explainable score. This is NOT machine learning —
// it's a weighted, rule-based function over several signals, each labeled
// High/Medium/Low/None so an admin can see exactly *why* two records scored
// the way they did. That's a deliberate choice: explainable beats opaque
// when a human has to make the final call on a real family's case.

const fuzzball = require('fuzzball');

// How much each signal counts toward the final 0-100 score.
// These weights are a starting point for the demo, not a scientifically
// tuned model — tune them by feel while testing against the seed data.
const WEIGHTS = {
  name: 0.30,
  age: 0.15,
  location: 0.20,
  datetime: 0.15,
  description: 0.10,
  marks: 0.10,
};

// Turns a 0-100 sub-score into a human-readable label.
function toLabel(subScore) {
  if (subScore === null) return 'None';
  if (subScore >= 80) return 'High';
  if (subScore >= 50) return 'Medium';
  return 'Low';
}

// --- Individual signal scorers -------------------------------------------
// Each one returns a 0-100 number, or null if there isn't enough
// information on one/both sides to compare.

function scoreName(a, b) {
  if (!a || !b) return null;
  // token_sort_ratio handles word-order differences ("Sharma Rahul" vs
  // "Rahul Sharma"); it's also naturally tolerant of small spelling slips
  // like "Sharmma" vs "Sharma" because it's edit-distance based underneath.
  return fuzzball.token_sort_ratio(a, b);
}

function scoreAge(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  const diff = Math.abs(Number(a) - Number(b));
  if (diff <= 1) return 100;
  if (diff <= 3) return 75;
  if (diff <= 5) return 50;
  if (diff <= 8) return 25;
  return 0;
}

function scoreLocation(a, b) {
  if (!a || !b) return null;
  // token_set_ratio ignores extra words, so "Jaipur" vs "Relief camp near
  // Jaipur" still scores high on the shared "Jaipur" token.
  return fuzzball.token_set_ratio(a, b);
}

function scoreDatetime(missingDatetime, foundDatetime) {
  if (!missingDatetime || !foundDatetime) return null;
  const missingTime = new Date(missingDatetime).getTime();
  const foundTime = new Date(foundDatetime).getTime();
  if (Number.isNaN(missingTime) || Number.isNaN(foundTime)) return null;

  const diffHours = (foundTime - missingTime) / (1000 * 60 * 60);

  // A found report dated *before* someone went missing is a red flag,
  // not just "far apart" — score it low but don't treat it as fatal,
  // since reporters get dates wrong under stress.
  if (diffHours < 0) return 20;
  if (diffHours <= 24) return 100;
  if (diffHours <= 72) return 80;
  if (diffHours <= 24 * 7) return 55;
  if (diffHours <= 24 * 30) return 30;
  return 10;
}

function scoreDescription(a, b) {
  if (!a || !b) return null;
  return fuzzball.token_set_ratio(a, b);
}

function scoreMarks(a, b) {
  if (!a || !b) return null;
  return fuzzball.token_set_ratio(a, b);
}

// --- Combine everything ---------------------------------------------------

/**
 * Compares a missing-person report against a found-person report.
 * @param {object} missing - a row from the reports table (report_type='missing')
 * @param {object} found - a row from the reports table (report_type='found')
 * @returns {{score: number, breakdown: object}}
 *   score: 0-100 overall confidence
 *   breakdown: per-signal { label, weight, note } for the UI to explain itself
 */
function compareReports(missing, found) {
  const signals = {
    name: scoreName(missing.full_name, found.full_name),
    age: scoreAge(missing.age, found.age),
    location: scoreLocation(missing.location, found.location),
    datetime: scoreDatetime(missing.event_datetime, found.event_datetime),
    description: scoreDescription(missing.description, found.description),
    marks: scoreMarks(missing.identifying_marks, found.identifying_marks),
  };

  // Only average over signals we actually had data for on both sides —
  // a missing "marks" field shouldn't drag the score down just because
  // nobody filled it in. We redistribute weight proportionally among the
  // signals that *do* have data.
  let weightedSum = 0;
  let weightUsed = 0;
  const breakdown = {};

  for (const key of Object.keys(WEIGHTS)) {
    const subScore = signals[key];
    breakdown[key] = {
      label: toLabel(subScore),
      raw: subScore,
    };
    if (subScore !== null) {
      weightedSum += subScore * WEIGHTS[key];
      weightUsed += WEIGHTS[key];
    }
  }

  // If literally nothing was comparable (shouldn't happen since name is
  // required on every report), score 0 rather than dividing by zero.
  const score = weightUsed > 0 ? Math.round(weightedSum / weightUsed) : 0;

  return { score, breakdown };
}

module.exports = { compareReports, WEIGHTS };
