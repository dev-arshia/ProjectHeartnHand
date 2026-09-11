// data/seed.js
//
// Populates the database with a realistic demo dataset: duplicate-ish
// reports with different spellings, partial information, a pair that
// should score as a strong match, a pair that's a near-miss (rejected by
// an admin), and clearly unrelated people. This is what you'd actually
// demo to judges instead of typing data live.
//
// Run directly with: npm run seed
// Also imported and called by server.js on boot if the database is
// empty — important on hosts with ephemeral disk (e.g. Render's free
// tier wipes local files on every restart), so a cold-started deploy
// always has a working demo instead of showing a blank app.
//
// Safe to run multiple times — it wipes and recreates the reports/
// matches/audit_log tables first.

const { db, normalizeName } = require('../backend/db');
const { generateMatchesForReport, generateDuplicatesForReport } = require('../backend/matching/generate');
require('../backend/routes/admin'); // side effect: seeds the default admin account if none exists

function seedDemoData() {
  console.log('Seeding demo data...');

  // Wipe existing report/match/audit data so re-running this gives a
  // clean, predictable demo state. Leaves the admins table alone.
  db.exec('DELETE FROM audit_log');
  db.exec('DELETE FROM matches');
  db.exec('DELETE FROM duplicate_flags');
  db.exec('DELETE FROM reports');
  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('reports','matches','audit_log','duplicate_flags')");

  const insertReport = db.prepare(`
    INSERT INTO reports (
      case_id, report_type, full_name, name_normalized, age, gender,
      location, event_datetime, description, identifying_marks, photo_path,
      is_minor, reporter_name, reporter_contact, source_channel, created_at
    ) VALUES (
      @case_id, @report_type, @full_name, @name_normalized, @age, @gender,
      @location, @event_datetime, @description, @identifying_marks, @photo_path,
      @is_minor, @reporter_name, @reporter_contact, @source_channel, @created_at
    )
  `);

  function addReport(fields) {
    const row = {
      gender: null,
      event_datetime: null,
      description: null,
      identifying_marks: null,
      photo_path: null,
      is_minor: 0,
      reporter_name: null,
      reporter_contact: null,
      source_channel: 'public',
      created_at: new Date().toISOString(),
      ...fields,
      name_normalized: normalizeName(fields.full_name),
    };
    const result = insertReport.run(row);
    return { ...row, id: result.lastInsertRowid };
  }

  // --- Scenario 1: the headline demo pair — strong match, different
  // spelling, partial info on the found side. -----------------------------
  const rahulMissing = addReport({
    case_id: 'MP-1042',
    report_type: 'missing',
    full_name: 'Rahul Sharma',
    age: 22,
    gender: 'male',
    location: 'Jaipur',
    event_datetime: '2026-09-01T10:00:00',
    description: 'Blue shirt, black jeans, medium height, short hair',
    reporter_name: 'Priya Sharma',
    reporter_contact: '9876543210',
    source_channel: 'public',
  });

  const rahulFound = addReport({
    case_id: 'FP-1043',
    report_type: 'found',
    full_name: 'R. Sharmma',
    age: 23,
    location: 'Relief camp near Jaipur',
    event_datetime: '2026-09-02T14:00:00',
    description: 'Blue shirt, appears disoriented but unharmed',
    source_channel: 'camp',
  });

  // --- Scenario 2: a near-miss — similar name, but age/location far
  // enough off that a human should reject it after reviewing. --------------
  const nearMissMissing = addReport({
    case_id: 'MP-1044',
    report_type: 'missing',
    full_name: 'Anil Kumar',
    age: 35,
    gender: 'male',
    location: 'Guwahati',
    event_datetime: '2026-09-03T09:00:00',
    description: 'White kurta, glasses',
    reporter_name: 'Sunita Kumar',
    reporter_contact: '9812345670',
    source_channel: 'helpline',
  });

  const nearMissFound = addReport({
    case_id: 'FP-1045',
    report_type: 'found',
    full_name: 'Anil Kumar',
    age: 58,
    location: 'Hospital in Guwahati',
    event_datetime: '2026-09-03T22:00:00',
    description: 'White shirt, elderly',
    source_channel: 'hospital',
  });

  // --- Scenario 3: duplicate missing reports for the same person, filed
  // by two different channels (tests duplicate consolidation, not just
  // missing<->found matching). ---------------------------------------------
  addReport({
    case_id: 'MP-1046',
    report_type: 'missing',
    full_name: 'Meera Iyer',
    age: 29,
    gender: 'female',
    location: 'Kochi',
    event_datetime: '2026-09-04T07:30:00',
    description: 'Yellow saree, gold bangles',
    reporter_name: 'Ramesh Iyer',
    reporter_contact: '9900112233',
    source_channel: 'public',
  });

  addReport({
    case_id: 'MP-1047',
    report_type: 'missing',
    full_name: 'Meera lyer', // capital I vs lowercase l typo, common OCR/typing mistake
    age: 29,
    location: 'Kochi',
    event_datetime: '2026-09-04T08:00:00',
    description: 'Yellow saree',
    reporter_name: 'Neighbor (anonymous tip)',
    source_channel: 'volunteer',
  });

  // --- Scenario 4: a minor — tests the is_minor privacy flag. -------------
  addReport({
    case_id: 'MP-1048',
    report_type: 'missing',
    full_name: 'Kavya Nair',
    age: 9,
    gender: 'female',
    location: 'Kozhikode',
    event_datetime: '2026-09-05T16:00:00',
    description: 'Pink frock, carrying a red backpack',
    identifying_marks: 'Small scar above left eyebrow',
    is_minor: 1,
    reporter_name: 'Suresh Nair (father)',
    reporter_contact: '9765432109',
    source_channel: 'public',
  });

  // --- Scenario 5: clearly unrelated people, spread across sources, to
  // show the system does NOT throw false matches at the admin. -------------
  addReport({
    case_id: 'MP-1049',
    report_type: 'missing',
    full_name: 'Vikram Singh',
    age: 41,
    gender: 'male',
    location: 'Chandigarh',
    event_datetime: '2026-09-06T11:00:00',
    description: 'Grey jacket, tall build',
    reporter_name: 'Harpreet Singh',
    reporter_contact: '9123456780',
    source_channel: 'helpline',
  });

  addReport({
    case_id: 'FP-1050',
    report_type: 'found',
    full_name: 'Aisha Khan',
    age: 45,
    gender: 'female',
    location: 'Mumbai',
    event_datetime: '2026-08-15T08:00:00',
    description: 'Green saree, in stable condition',
    source_channel: 'hospital',
  });

  addReport({
    case_id: 'FP-1051',
    report_type: 'found',
    full_name: 'Unknown Child',
    age: 4,
    location: 'Relief camp, Kochi outskirts',
    event_datetime: '2026-09-04T09:00:00',
    description: 'Unable to state name, wearing a blue t-shirt with a star print',
    is_minor: 1,
    source_channel: 'camp',
  });

  console.log('Base reports inserted. Generating matches...');

  // Run matching for every report against what came before it, in creation
  // order, the same way the live app does it one report at a time.
  const allReports = db.prepare('SELECT * FROM reports ORDER BY id ASC').all();
  let totalMatches = 0;
  let totalDuplicates = 0;
  for (const report of allReports) {
    totalMatches += generateMatchesForReport(report).length;
    totalDuplicates += generateDuplicatesForReport(report).length;
  }

  console.log(`Generated ${totalMatches} candidate match(es) and ${totalDuplicates} duplicate flag(s).`);

  // --- Pre-resolve a couple of matches so the demo shows every state,
  // not just "everything pending". -----------------------------------------

  // Approve the headline Rahul Sharma match.
  const rahulMatch = db.prepare(`
    SELECT * FROM matches WHERE missing_report_id = ? AND found_report_id = ?
  `).get(rahulMissing.id, rahulFound.id);

  if (rahulMatch) {
    db.prepare(`UPDATE matches SET status = 'approved', reviewed_by = ?, reviewed_at = ? WHERE id = ?`)
      .run('demo_admin', new Date().toISOString(), rahulMatch.id);
    db.prepare(`UPDATE reports SET status = 'verified_match' WHERE id IN (?, ?)`)
      .run(rahulMissing.id, rahulFound.id);
    db.prepare(`
      INSERT INTO audit_log (report_id, match_id, action, actor, notes)
      VALUES (?, ?, 'match_approved', 'demo_admin', 'Pre-approved for demo'), (?, ?, 'match_approved', 'demo_admin', 'Pre-approved for demo')
    `).run(rahulMissing.id, rahulMatch.id, rahulFound.id, rahulMatch.id);
    console.log(`Approved match MP-1042 <-> FP-1043 (score ${rahulMatch.score})`);
  }

  // Reject the near-miss Anil Kumar match, if the engine even flagged it —
  // worth checking either way, since age gap should keep it below threshold.
  const nearMissMatch = db.prepare(`
    SELECT * FROM matches WHERE missing_report_id = ? AND found_report_id = ?
  `).get(nearMissMissing.id, nearMissFound.id);

  if (nearMissMatch) {
    db.prepare(`UPDATE matches SET status = 'rejected', reviewed_by = ?, reviewed_at = ? WHERE id = ?`)
      .run('demo_admin', new Date().toISOString(), nearMissMatch.id);
    db.prepare(`UPDATE reports SET status = 'unverified' WHERE id IN (?, ?)`)
      .run(nearMissMissing.id, nearMissFound.id);
    db.prepare(`
      INSERT INTO audit_log (report_id, match_id, action, actor, notes)
      VALUES (?, ?, 'match_rejected', 'demo_admin', 'Age difference too large despite name/location match'), (?, ?, 'match_rejected', 'demo_admin', 'Age difference too large despite name/location match')
    `).run(nearMissMissing.id, nearMissMatch.id, nearMissFound.id, nearMissMatch.id);
    console.log(`Rejected match MP-1044 <-> FP-1045 (score ${nearMissMatch.score})`);
  } else {
    console.log('Anil Kumar pair scored below the match threshold — nothing to reject (that is fine, it shows the threshold working).');
  }

  const finalCounts = db.prepare(`
    SELECT report_type, status, COUNT(*) as n FROM reports GROUP BY report_type, status
  `).all();

  console.log('\nSeed complete. Report counts by type/status:');
  console.table(finalCounts);
  console.log(`\nAdmin login: username="${process.env.ADMIN_USERNAME || 'admin'}" password="${process.env.ADMIN_PASSWORD || 'admin123'}"`);
  console.log('Try looking up case MP-1042 or FP-1043 on the public status page — it will show a verified match.');
  console.log('Try MP-1046 vs MP-1047 as a duplicate-consolidation talking point in the demo.');
}

module.exports = { seedDemoData };

// Only auto-run when this file is executed directly (npm run seed),
// not when server.js requires it as a module.
if (require.main === module) {
  seedDemoData();
}
