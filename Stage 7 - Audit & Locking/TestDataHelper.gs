/**
 * HGUS Academic Result Management System
 * TestDataHelper.gs — Dummy data seeder for testing Stage 5 locks & PDF export
 *
 * STAGE 7 UPDATES (from Stage 5 version):
 *   1. TEST_STUDENTS now includes lastName and firstMiddleName so the result
 *      slip can display names in SURNAME Firstname format (e.g. "TESTSON Alpha").
 *   2. seedTestData() writes the new Students Cache columns: Last Name,
 *      First Middle Name, Date of Birth, Parent Contact.
 *   3. cleanupTestData() now also cleans up the Result Locks sheet (added in
 *      Stage 7 — a locked test class would block re-seeding if not cleaned up).
 *   4. verifyTestData() checks that name component columns are populated and
 *      reports whether a Result Lock exists for the test class.
 *
 * ─── PURPOSE ──────────────────────────────────────────────────────────────────
 *
 *   Lets you test the generation lock and PDF export features without touching
 *   real class data. Creates a small dummy class (TEST_CLS001) with 3 dummy
 *   students and 2 dummy subjects, then gives you individual functions to
 *   progressively unlock the Broadsheet and Results buttons.
 *
 * ─── HOW TO USE ───────────────────────────────────────────────────────────────
 *
 *   STEP 1 — Replace TestDataHelper.gs in your GAS project with this file.
 *             (Open the file → Ctrl+A → Delete → Paste this → Save.)
 *
 *   STEP 2 — Run seedTestData() once.
 *             Hard-refresh the app (Ctrl+Shift+R).
 *             Navigate to Broadsheet → you should see "TEST Class" in the list.
 *
 *   TEST A — Locked state
 *             Open the Class Menu for "TEST Class".
 *             Expected: BOTH Broadsheet and Results cards are grayed/locked.
 *
 *   STEP 3 — Run seedTestScores().
 *             Hard-refresh the app and open the TEST Class menu.
 *             Expected: Broadsheet card is now an active BUTTON.
 *                       Results card is still LOCKED (no PSQ or remarks yet).
 *
 *   STEP 4 — Run seedTestPSQ(), then run seedTestRemarks().
 *             Hard-refresh the app and open the TEST Class menu.
 *             Expected: BOTH cards are now active BUTTONS.
 *
 *   TEST B — PDF export
 *             Open Broadsheet → Results for TEST Class.
 *             Open a student's result slip → verify name shows "TESTSON Alpha".
 *             Click "Download PDF".
 *             Go back → click "Generate All PDFs".
 *
 *   TEST C — Stage 7 lock/unlock
 *             In Classes & Subjects → TEST Class → lock the class-term.
 *             Try saving a score — expected: error "Results are locked".
 *             Unlock → save again — expected: success.
 *
 *   STEP 5 — Run cleanupTestData() to remove everything.
 *             (You can delete this file after cleanup, but keeping it is harmless.)
 *
 * ─── WHAT GETS CREATED ────────────────────────────────────────────────────────
 *
 *   Classes:                  TEST_CLS001  — "TEST Class" (Section: SSS)
 *   Students Cache:           TEST_STU001, TEST_STU002, TEST_STU003
 *                             Includes: Last Name, First Middle Name, DOB, Parent Contact
 *   Subjects:                 TEST_SUBJ001 ("Test Subject A"), TEST_SUBJ002 ("Test Subject B")
 *   Class-Subject Assignments: 2 rows (TEST_CLS001 × each test subject, current session+term)
 *
 *   Scores:   3 students × 2 subjects × 6 components = 36 rows  (seedTestScores)
 *   PSQ:      3 rows — one per student, all 16 traits filled     (seedTestPSQ)
 *   Remarks:  3 rows — one remark per student                    (seedTestRemarks)
 *
 *   Scores, PSQ, and Remarks are scoped to the CURRENT active session and term
 *   (read from Script Properties), so they match exactly what the app uses.
 *
 * ─── CLEANUP ──────────────────────────────────────────────────────────────────
 *
 *   cleanupTestData() deletes every row in every relevant sheet where the
 *   Class ID is TEST_CLS001 or Subject ID is one of the test subject IDs.
 *   Also clears any Result Lock for TEST_CLS001.
 *   No real data is ever touched. Safe to run multiple times.
 *
 * ─── IMPORTANT NOTES ──────────────────────────────────────────────────────────
 *
 *   1. Make sure a session and term are activated in Admin → Session Settings
 *      before running any function here. The helpers will throw a clear error
 *      if they are not.
 *
 *   2. After running any seed function, always hard-refresh the app
 *      (Ctrl+Shift+R / Cmd+Shift+R) to force a fresh server call.
 *
 *   3. Use verifyTestData() at any point to see what is currently in the
 *      sheets for the test class — it reads only, writes nothing.
 */


// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION — edit these if you want different test values
// ═══════════════════════════════════════════════════════════════════════════════

// IDs for the dummy class (must be unique — must not clash with real data)
var TEST_CLASS_ID   = 'TEST_CLS001';
var TEST_CLASS_NAME = 'TEST Class';

// ── Three dummy students ──────────────────────────────────────────────────────
//
// STAGE 7 CHANGE: Added lastName and firstMiddleName to each student.
//
//   - firstMiddleName: what comes AFTER the surname on the result slip
//     e.g. "Alpha" or "Beta Jane"
//   - lastName: the surname — shown in CAPS on the result slip
//     e.g. "TESTSON Alpha"
//
//   fullName (firstName + lastName, first-last order) is still computed in
//   seedTestData() for the "Full Name" column, which is what the app uses
//   everywhere except result slips.
//
var TEST_STUDENTS = [
  { studentId: 'TEST_STU001', firstMiddleName: 'Alpha',       lastName: 'Testson',   gender: 'Male'   },
  { studentId: 'TEST_STU002', firstMiddleName: 'Beta Jane',   lastName: 'Tester',    gender: 'Female' },
  { studentId: 'TEST_STU003', firstMiddleName: 'Gamma',       lastName: 'Checklist', gender: 'Male'   }
];
// Expected result slip names:
//   TEST_STU001 → "TESTSON Alpha"
//   TEST_STU002 → "TESTER Beta Jane"
//   TEST_STU003 → "CHECKLIST Gamma"

// Two dummy subjects
var TEST_SUBJECTS = [
  { subjectId: 'TEST_SUBJ001', subjectName: 'Test Subject A' },
  { subjectId: 'TEST_SUBJ002', subjectName: 'Test Subject B' }
];

// Score to use for each component (C/W max=6, ASS max=2, ATT max=2, Test1 max=10, Test2 max=10, Exam max=70)
// These add up to 79 → Grade A1 (intentionally high so result slips look complete)
var TEST_SCORES_MAP = {
  'C/W':   5,
  'ASS':   2,
  'ATT':   2,
  'Test1': 8,
  'Test2': 7,
  'Exam':  55
};

// PSQ rating to use for every trait (1 = Excellent … 5 = Poor — adjust as you like)
var TEST_PSQ_RATING = 2;

// Remark to write for every dummy student
var TEST_REMARK = 'This is a test remark inserted by TestDataHelper.gs for lock testing purposes.';


// ═══════════════════════════════════════════════════════════════════════════════
// PRIVATE HELPERS — internal utilities used by the seed functions below
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get a sheet by name. Throws a clear error if the sheet does not exist.
 * All other helpers call this instead of getSheetByName directly.
 */
function _getTestSheet_(sheetName) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(
      'Sheet "' + sheetName + '" not found.\n' +
      'Run Admin Panel → Run Setup before using TestDataHelper.'
    );
  }
  return sheet;
}

/**
 * Read every data row from a sheet as an array of plain objects.
 * Row 1 is the header row; its values become the object keys (raw, not camelCase).
 * Returns { headers, rows } so callers can use both.
 */
function _sheetToObjects_(sheetName) {
  var sheet   = _getTestSheet_(sheetName);
  var data    = sheet.getDataRange().getValues();
  var headers = data[0] || [];
  if (data.length < 2) return { headers: headers, rows: [] };

  var rows = data.slice(1).map(function (row) {
    var obj = {};
    headers.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  });
  return { headers: headers, rows: rows };
}

/**
 * Append one new row to a sheet by mapping an object's keys to the sheet's
 * header columns. Missing keys are written as empty string.
 *
 * The object keys must match the raw header names exactly
 * (e.g. 'Class ID', 'Student ID') — not camelCase.
 */
function _appendTestRow_(sheetName, rowData) {
  var sheet   = _getTestSheet_(sheetName);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row     = headers.map(function (h) {
    var val = rowData[h];
    return (val !== undefined && val !== null) ? val : '';
  });
  sheet.appendRow(row);
}

/**
 * Delete all rows where a given column equals any of the provided match values.
 * Works backwards through the sheet so row numbers stay valid after each delete.
 *
 * @param {string}   sheetName    — which sheet to modify
 * @param {string}   columnHeader — exact header name of the column to match (e.g. 'Class ID')
 * @param {string[]} matchValues  — array of values; a row is deleted if its cell equals any one
 * @returns {number} number of rows deleted
 */
function _deleteMatchingRows_(sheetName, columnHeader, matchValues) {
  var sheet    = _getTestSheet_(sheetName);
  var data     = sheet.getDataRange().getValues();
  if (data.length < 2) return 0;

  var colIndex = data[0].indexOf(columnHeader);
  if (colIndex === -1) {
    Logger.log('Warning: column "' + columnHeader + '" not found in sheet "' + sheetName + '".');
    return 0;
  }

  var deleted = 0;
  // Iterate BACKWARDS — deleting a row shifts all rows below it up by one,
  // so we must start at the bottom to avoid skipping rows.
  for (var i = data.length - 1; i >= 1; i--) {
    var cellValue = String(data[i][colIndex]);
    var isMatch   = matchValues.some(function (v) { return cellValue === String(v); });
    if (isMatch) {
      sheet.deleteRow(i + 1); // +1 because sheet row 1 = data[0] (header)
      deleted++;
    }
  }
  return deleted;
}

/**
 * Read the active session and term from Script Properties.
 * Throws a clear error if either value is not configured.
 */
function _getActiveSettings_() {
  var props   = PropertiesService.getScriptProperties();
  var session = props.getProperty('activeSession') || '';
  var term    = props.getProperty('activeTerm')    || '';

  if (!session || !term) {
    throw new Error(
      'No active session or term is set.\n' +
      'Go to Admin Panel → Session Settings, activate a session and term, then try again.'
    );
  }
  return { session: session, term: term };
}


// ═══════════════════════════════════════════════════════════════════════════════
// SEED STEP 1 — Create the class structure (class, students, subjects, assignments)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create the dummy class, students, subjects, and subject assignments.
 *
 * Run this FIRST — before any other seed function.
 * Safe to re-run: already-existing records are skipped, not duplicated.
 *
 * After running:
 *   Hard-refresh the app (Ctrl+Shift+R) and navigate to Broadsheet.
 *   You should see "TEST Class" in the class list.
 *   Open its Class Menu — both buttons should be LOCKED.
 */
function seedTestData() {
  var settings = _getActiveSettings_();
  var now      = new Date().toISOString();

  // ── Classes ───────────────────────────────────────────────────────────────
  var classRows = _sheetToObjects_('Classes').rows;
  var classExists = classRows.some(function (r) {
    return String(r['Class ID']) === TEST_CLASS_ID;
  });

  if (!classExists) {
    _appendTestRow_('Classes', {
      'Class ID':   TEST_CLASS_ID,
      'Class Name': TEST_CLASS_NAME,
      'Section':    'SSS',
      'Department': ''
    });
    Logger.log('[seedTestData] Created class: ' + TEST_CLASS_ID + ' — ' + TEST_CLASS_NAME);
  } else {
    Logger.log('[seedTestData] Class already exists: ' + TEST_CLASS_ID + ' (skipped)');
  }

  // ── Students Cache ────────────────────────────────────────────────────────
  //
  // STAGE 7 CHANGE: Now writes the four new columns that were added in Stage 7:
  //   Last Name          — surname only (used for result slip SURNAME format)
  //   First Middle Name  — first name + any middle names (also used on result slip)
  //   Date of Birth      — test value provided below
  //   Parent Contact     — test value provided below
  //
  // The "Full Name" column (first-last order) is still written so existing
  // code that reads fullName continues to work without any changes.
  //
  var existingStudentIds = _sheetToObjects_('Students Cache').rows
    .map(function (r) { return String(r['Student ID']); });

  TEST_STUDENTS.forEach(function (s) {
    if (existingStudentIds.indexOf(s.studentId) === -1) {

      // Build the full name in first-last order (how it appears everywhere except result slips)
      var fullName = s.firstMiddleName + ' ' + s.lastName;

      _appendTestRow_('Students Cache', {
        'Student ID':       s.studentId,
        'Full Name':        fullName,
        'First Middle Name': s.firstMiddleName,       // new in Stage 7
        'Last Name':        s.lastName,                // new in Stage 7
        'Student Class':    TEST_CLASS_NAME,
        'Gender':           s.gender,
        'Action Flag':      '',
        'Class ID':         TEST_CLASS_ID,
        'Cached At':        now,
        'Date of Birth':    '2008-01-15',              // test placeholder
        'Parent Contact':   '08012345678'              // test placeholder
      });
      Logger.log('[seedTestData] Created student: ' + s.studentId + ' — ' + fullName);
    } else {
      Logger.log('[seedTestData] Student already exists: ' + s.studentId + ' (skipped)');
    }
  });

  // ── Subjects ──────────────────────────────────────────────────────────────
  var existingSubjectIds = _sheetToObjects_('Subjects').rows
    .map(function (r) { return String(r['Subject ID']); });

  TEST_SUBJECTS.forEach(function (subj) {
    if (existingSubjectIds.indexOf(subj.subjectId) === -1) {
      _appendTestRow_('Subjects', {
        'Subject ID':   subj.subjectId,
        'Subject Name': subj.subjectName,
        'Section':      'SSS',
        'Department':   'General'
      });
      Logger.log('[seedTestData] Created subject: ' + subj.subjectId + ' — ' + subj.subjectName);
    } else {
      Logger.log('[seedTestData] Subject already exists: ' + subj.subjectId + ' (skipped)');
    }
  });

  // ── Class-Subject Assignments (scoped to the active session + term) ────────
  var existingCSA = _sheetToObjects_('Class-Subject Assignments').rows;

  TEST_SUBJECTS.forEach(function (subj, i) {
    var alreadyAssigned = existingCSA.some(function (r) {
      return String(r['Class ID'])   === TEST_CLASS_ID &&
             String(r['Subject ID']) === subj.subjectId &&
             String(r['Session'])    === settings.session &&
             String(r['Term'])       === settings.term;   // term added to prevent cross-session duplicates
    });

    if (!alreadyAssigned) {
      _appendTestRow_('Class-Subject Assignments', {
        'Assignment ID': 'TEST_ASGN' + String(i + 1),
        'Class ID':      TEST_CLASS_ID,
        'Subject ID':    subj.subjectId,
        'Session':       settings.session,
        'Term':          settings.term     // scoped to active term as well as session
      });
      Logger.log('[seedTestData] Assigned: ' + TEST_CLASS_ID + ' → ' + subj.subjectId + ' (' + settings.session + ')');
    } else {
      Logger.log('[seedTestData] Assignment already exists for ' + subj.subjectId + ' (skipped)');
    }
  });

  Logger.log('');
  Logger.log('seedTestData() done. Session: ' + settings.session + ' | Term: ' + settings.term);
  Logger.log('Hard-refresh the app → navigate to Broadsheet → open "TEST Class".');
  Logger.log('Expected: Broadsheet and Results buttons are both LOCKED.');
}


// ═══════════════════════════════════════════════════════════════════════════════
// SEED STEP 2 — Fill in all scores (unlocks the Broadsheet button)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Insert score rows for all dummy students × subjects × components.
 * 3 students × 2 subjects × 6 components = 36 rows total.
 *
 * After running:
 *   Hard-refresh the app → open TEST Class menu.
 *   Expected: Broadsheet card is now a clickable BUTTON.
 *             Results card is still LOCKED (PSQ and remarks still missing).
 *
 * Safe to run only once — if scores already exist for this class/term/session
 * the function logs a message and skips (run cleanupTestData first to re-seed).
 */
function seedTestScores() {
  var settings   = _getActiveSettings_();
  var components = ['C/W', 'ASS', 'ATT', 'Test1', 'Test2', 'Exam'];

  // Check if scores already exist for this test class to avoid duplicates
  var existingScores = _sheetToObjects_('Scores').rows.filter(function (r) {
    return String(r['Class ID']) === TEST_CLASS_ID &&
           String(r['Term'])     === settings.term  &&
           String(r['Session'])  === settings.session;
  });
  if (existingScores.length > 0) {
    Logger.log('[seedTestScores] ' + existingScores.length + ' score row(s) already exist for this class/term/session. Skipping.');
    Logger.log('Run cleanupTestData() first if you want to re-seed from scratch.');
    return;
  }

  var now   = new Date().toISOString();
  var count = 0;

  TEST_STUDENTS.forEach(function (s) {
    TEST_SUBJECTS.forEach(function (subj) {
      components.forEach(function (component, ci) {
        // Build a unique entry ID for each score row
        var entryId = 'TEST_ENT_' + s.studentId + '_' + subj.subjectId + '_' + ci;

        _appendTestRow_('Scores', {
          'Entry ID':   entryId,
          'Student ID': s.studentId,
          'Class ID':   TEST_CLASS_ID,
          'Subject ID': subj.subjectId,
          'Term':       settings.term,
          'Session':    settings.session,
          'Component':  component,
          'Score':      TEST_SCORES_MAP[component],
          'Staff ID':   'TEST_STAFF',
          'Timestamp':  now
        });
        count++;
      });
    });
  });

  Logger.log('[seedTestScores] Inserted ' + count + ' score rows (' +
    TEST_STUDENTS.length + ' students × ' + TEST_SUBJECTS.length + ' subjects × 6 components).');
  Logger.log('Hard-refresh the app → open TEST Class menu.');
  Logger.log('Expected: Broadsheet = UNLOCKED. Results = still LOCKED.');
}


// ═══════════════════════════════════════════════════════════════════════════════
// SEED STEP 3a — Fill in PSQ ratings for all dummy students
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Insert a PSQ row for each dummy student with all 16 traits filled in.
 *
 * Run this together with seedTestRemarks() to unlock the Results button.
 *
 * After running BOTH seedTestPSQ and seedTestRemarks:
 *   Hard-refresh the app → open TEST Class menu.
 *   Expected: BOTH Broadsheet and Results cards are active BUTTONS.
 */
function seedTestPSQ() {
  var settings = _getActiveSettings_();

  // Avoid inserting duplicate PSQ rows
  var existingPSQ = _sheetToObjects_('PSQ').rows.filter(function (r) {
    return String(r['Class ID']) === TEST_CLASS_ID &&
           String(r['Term'])     === settings.term  &&
           String(r['Session'])  === settings.session;
  });
  if (existingPSQ.length > 0) {
    Logger.log('[seedTestPSQ] PSQ rows already exist for this class/term/session. Skipping.');
    Logger.log('Run cleanupTestData() first if you want to re-seed from scratch.');
    return;
  }

  // Exact trait names as they appear in the PSQ sheet header (SetupService.gs)
  var psqTraits = [
    'Physical Health',         'Punctuality',         'Reliability',
    'Personal Neatness',       'Politeness',           'Honesty',
    'Initiative',              'Neatness in Academic Work',
    'Class Attendance',        'Class Participation',  'Self-Control',
    'Spirit of Co-operation',  'Sense of Responsibility',
    'Attitude to Study',       'Relationship with Peers',
    'Relationship with Teachers'
  ];

  var now = new Date().toISOString();

  TEST_STUDENTS.forEach(function (s) {
    // Build the PSQ row — start with the identity columns
    var fullName = s.firstMiddleName + ' ' + s.lastName;
    var psqRow = {
      'Student ID':           s.studentId,
      'Class ID':             TEST_CLASS_ID,
      'Term':                 settings.term,
      'Session':              settings.session,
      'Form Master Staff ID': 'TEST_STAFF',
      'Timestamp':            now
    };
    // Fill every trait with the test rating value
    psqTraits.forEach(function (trait) {
      psqRow[trait] = TEST_PSQ_RATING;
    });

    _appendTestRow_('PSQ', psqRow);
    Logger.log('[seedTestPSQ] Inserted PSQ for ' + s.studentId + ' (' + fullName + ')');
  });

  Logger.log('[seedTestPSQ] Done. ' + TEST_STUDENTS.length + ' PSQ rows inserted.');
}


// ═══════════════════════════════════════════════════════════════════════════════
// SEED STEP 3b — Fill in Form Master remarks for all dummy students
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Insert a remark row for each dummy student.
 *
 * Run this together with seedTestPSQ() to unlock the Results button.
 */
function seedTestRemarks() {
  var settings = _getActiveSettings_();

  // Avoid inserting duplicate remark rows
  var existingRemarks = _sheetToObjects_('Remarks').rows.filter(function (r) {
    return String(r['Class ID']) === TEST_CLASS_ID &&
           String(r['Term'])     === settings.term  &&
           String(r['Session'])  === settings.session;
  });
  if (existingRemarks.length > 0) {
    Logger.log('[seedTestRemarks] Remark rows already exist for this class/term/session. Skipping.');
    Logger.log('Run cleanupTestData() first if you want to re-seed from scratch.');
    return;
  }

  var now = new Date().toISOString();

  TEST_STUDENTS.forEach(function (s) {
    var fullName = s.firstMiddleName + ' ' + s.lastName;
    _appendTestRow_('Remarks', {
      'Student ID':           s.studentId,
      'Class ID':             TEST_CLASS_ID,
      'Term':                 settings.term,
      'Session':              settings.session,
      'Remark':               TEST_REMARK,
      'Form Master Staff ID': 'TEST_STAFF',
      'Timestamp':            now
    });
    Logger.log('[seedTestRemarks] Inserted remark for ' + s.studentId + ' (' + fullName + ')');
  });

  Logger.log('[seedTestRemarks] Done. ' + TEST_STUDENTS.length + ' remark rows inserted.');
  Logger.log('Hard-refresh the app → open TEST Class menu.');
  Logger.log('Expected (if scores + PSQ also done): BOTH cards UNLOCKED.');
}


// ═══════════════════════════════════════════════════════════════════════════════
// CLEANUP — remove all test data from every sheet
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Delete every test row from every relevant sheet.
 *
 * Targets:
 *   Classes                  → rows where Class ID = TEST_CLS001
 *   Students Cache           → rows where Class ID = TEST_CLS001
 *   Subjects                 → rows where Subject ID is a test subject ID
 *   Class-Subject Assignments→ rows where Class ID = TEST_CLS001
 *   Scores                   → rows where Class ID = TEST_CLS001
 *   PSQ                      → rows where Class ID = TEST_CLS001
 *   Remarks                  → rows where Class ID = TEST_CLS001
 *   Student Term Status      → rows where Class ID = TEST_CLS001
 *   Result Locks             → rows where Class ID = TEST_CLS001   ← NEW Stage 7
 *
 * DOES NOT touch any row whose Class ID is anything other than TEST_CLS001.
 * Safe to run multiple times — nothing to delete simply means 0 deleted.
 *
 * After running: you can delete this file from the GAS project if you no longer
 * need to re-seed test data.
 */
function cleanupTestData() {
  var testSubjectIds = TEST_SUBJECTS.map(function (s) { return s.subjectId; });
  var report = [];
  var d;

  // Classes
  d = _deleteMatchingRows_('Classes', 'Class ID', [TEST_CLASS_ID]);
  report.push('Classes:                   deleted ' + d + ' row(s)');

  // Students Cache (keyed by Class ID — all 3 students belong to TEST_CLS001)
  d = _deleteMatchingRows_('Students Cache', 'Class ID', [TEST_CLASS_ID]);
  report.push('Students Cache:            deleted ' + d + ' row(s)');

  // Subjects (keyed by Subject ID)
  d = _deleteMatchingRows_('Subjects', 'Subject ID', testSubjectIds);
  report.push('Subjects:                  deleted ' + d + ' row(s)');

  // Class-Subject Assignments
  d = _deleteMatchingRows_('Class-Subject Assignments', 'Class ID', [TEST_CLASS_ID]);
  report.push('Class-Subject Assignments: deleted ' + d + ' row(s)');

  // Scores
  d = _deleteMatchingRows_('Scores', 'Class ID', [TEST_CLASS_ID]);
  report.push('Scores:                    deleted ' + d + ' row(s)');

  // PSQ
  d = _deleteMatchingRows_('PSQ', 'Class ID', [TEST_CLASS_ID]);
  report.push('PSQ:                       deleted ' + d + ' row(s)');

  // Remarks
  d = _deleteMatchingRows_('Remarks', 'Class ID', [TEST_CLASS_ID]);
  report.push('Remarks:                   deleted ' + d + ' row(s)');

  // Student Term Status (may be empty — that is fine)
  d = _deleteMatchingRows_('Student Term Status', 'Class ID', [TEST_CLASS_ID]);
  report.push('Student Term Status:       deleted ' + d + ' row(s)');

  // ── STAGE 7 ADDITION: Result Locks ────────────────────────────────────────
  // If the test class was locked and then cleaned up without unlocking first,
  // the lock row would remain in the Result Locks sheet. Cleaning it up here
  // prevents a "stale lock" from blocking re-seeding in future test runs.
  d = _deleteMatchingRows_('Result Locks', 'Class ID', [TEST_CLASS_ID]);
  report.push('Result Locks:              deleted ' + d + ' row(s)');

  Logger.log('cleanupTestData() complete:');
  report.forEach(function (line) { Logger.log('  ' + line); });
  Logger.log('');
  Logger.log('All test data has been removed. You can now delete this file from the GAS project.');
}


// ═══════════════════════════════════════════════════════════════════════════════
// VERIFY — read-only check of what is currently in the sheets
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Optional: run at any point to see the current state of the test data.
 * Reads nothing, writes nothing. Useful for diagnosing issues.
 *
 * Run this from the GAS editor (select verifyTestData → Run) and check
 * the Execution Log (View → Logs).
 */
function verifyTestData() {
  var settings = _getActiveSettings_();
  Logger.log('=== verifyTestData() — Session: ' + settings.session + ' | Term: ' + settings.term + ' ===');

  // Class
  var classRows = _sheetToObjects_('Classes').rows;
  var testClass = classRows.find(function (r) { return String(r['Class ID']) === TEST_CLASS_ID; });
  Logger.log('Class:    ' + (testClass ? testClass['Class Name'] + ' ✓' : 'NOT FOUND ✗'));

  // Students — check both existence AND new name component columns
  var studentRows = _sheetToObjects_('Students Cache').rows;
  TEST_STUDENTS.forEach(function (s) {
    var row = studentRows.find(function (r) { return String(r['Student ID']) === s.studentId; });
    if (!row) {
      Logger.log('Student:  ' + s.studentId + ' (' + s.firstMiddleName + ' ' + s.lastName + ')  NOT FOUND ✗ — run seedTestData()');
    } else {
      // ── STAGE 7 CHECK: verify the new name component columns were written ──
      var hasLastName       = row['Last Name']         && String(row['Last Name']).trim()         !== '';
      var hasFirstMiddle    = row['First Middle Name'] && String(row['First Middle Name']).trim() !== '';
      var nameStatus        = (hasLastName && hasFirstMiddle)
        ? '(slip: "' + String(row['Last Name']).toUpperCase() + ' ' + row['First Middle Name'] + '") ✓'
        : '⚠ name columns empty — re-run seedTestData() or refresh student cache';
      Logger.log('Student:  ' + s.studentId + '  ' + nameStatus);
    }
  });

  // Subjects
  var subjectRows = _sheetToObjects_('Subjects').rows;
  TEST_SUBJECTS.forEach(function (subj) {
    var found = subjectRows.some(function (r) { return String(r['Subject ID']) === subj.subjectId; });
    Logger.log('Subject:  ' + subj.subjectId + ' (' + subj.subjectName + ')  ' + (found ? '✓' : 'NOT FOUND ✗ — run seedTestData()'));
  });

  // Class-Subject Assignments
  var csaRows  = _sheetToObjects_('Class-Subject Assignments').rows;
  var csaCount = csaRows.filter(function (r) {
    return String(r['Class ID']) === TEST_CLASS_ID && String(r['Session']) === settings.session;
  }).length;
  var csaExpected = TEST_SUBJECTS.length;
  Logger.log('Subject assignments: ' + csaCount + ' / ' + csaExpected + ' expected  ' +
    (csaCount === csaExpected ? '✓' : '✗ — run seedTestData()'));

  // Scores
  var scoreRows  = _sheetToObjects_('Scores').rows.filter(function (r) {
    return String(r['Class ID']) === TEST_CLASS_ID &&
           String(r['Term'])     === settings.term  &&
           String(r['Session'])  === settings.session;
  });
  var expectedScores = TEST_STUDENTS.length * TEST_SUBJECTS.length * 6; // 6 components
  Logger.log('Scores:   ' + scoreRows.length + ' / ' + expectedScores + ' expected  ' +
    (scoreRows.length === expectedScores ? '✓ (Broadsheet should be UNLOCKED)' :
     scoreRows.length === 0 ? '✗ — run seedTestScores()' : '✗ — unexpected count'));

  // PSQ
  var psqRows    = _sheetToObjects_('PSQ').rows.filter(function (r) {
    return String(r['Class ID']) === TEST_CLASS_ID &&
           String(r['Term'])     === settings.term  &&
           String(r['Session'])  === settings.session;
  });
  Logger.log('PSQ:      ' + psqRows.length + ' / ' + TEST_STUDENTS.length + ' expected  ' +
    (psqRows.length === TEST_STUDENTS.length ? '✓' : '✗ — run seedTestPSQ()'));

  // Remarks
  var remarkRows = _sheetToObjects_('Remarks').rows.filter(function (r) {
    return String(r['Class ID']) === TEST_CLASS_ID &&
           String(r['Term'])     === settings.term  &&
           String(r['Session'])  === settings.session;
  });
  Logger.log('Remarks:  ' + remarkRows.length + ' / ' + TEST_STUDENTS.length + ' expected  ' +
    (remarkRows.length === TEST_STUDENTS.length ? '✓' : '✗ — run seedTestRemarks()'));

  // ── STAGE 7 CHECK: Result Locks ───────────────────────────────────────────
  // A locked test class will block score saves. Report its status so you can
  // unlock from the UI or run cleanupTestData() to remove the lock entry.
  try {
    var lockRows = _sheetToObjects_('Result Locks').rows.filter(function (r) {
      return String(r['Class ID']) === TEST_CLASS_ID &&
             String(r['Term'])     === settings.term  &&
             String(r['Session'])  === settings.session;
    });
    if (lockRows.length > 0) {
      Logger.log('Result Lock: ⚠ TEST Class is LOCKED for this term — score saves will be blocked.');
      Logger.log('             Unlock via Classes & Subjects → TEST Class → Unlock, or run cleanupTestData().');
    } else {
      Logger.log('Result Lock: not locked ✓');
    }
  } catch (e) {
    Logger.log('Result Lock: could not check (Result Locks sheet may not exist yet — run Setup)');
  }

  Logger.log('');
  if (scoreRows.length === expectedScores && psqRows.length === TEST_STUDENTS.length && remarkRows.length === TEST_STUDENTS.length) {
    Logger.log('All data complete — Results should be UNLOCKED and PDF buttons should be visible.');
    Logger.log('Open a result slip and verify the name shows as SURNAME Firstname (e.g. "TESTSON Alpha").');
  } else if (scoreRows.length === expectedScores) {
    Logger.log('Scores complete — Broadsheet should be UNLOCKED. Results still LOCKED.');
  } else {
    Logger.log('Scores not yet complete — both buttons should be LOCKED.');
  }
}
