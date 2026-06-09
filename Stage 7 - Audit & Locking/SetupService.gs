/**
 * HGUS Academic Result Management System
 * SetupService.gs — One-time sheet initialisation
 *
 * Run setupSheets() once when the Google Spreadsheet is first created.
 * It is safe to run again — existing sheets are left untouched.
 *
 * Also contains setupSubjectsReference() to pre-populate the
 * Subjects Reference tab with the school's full subject list.
 */

// ─── SHEET DEFINITIONS ────────────────────────────────────────────────────────

/**
 * All 10 data sheets + support sheets, each with their required headers.
 * Order matters for initial tab layout.
 */
const SHEET_DEFINITIONS = {

  [SHEET_NAMES.USERS]: [
    'Staff ID', 'Name', 'Username', 'Password Hash', 'Force Password Change',
    'Email', 'Role', 'Phone Number', 'Date Joined', 'Employment Status',
    'Subject Specialty', 'Added By', 'Created At'
  ],

  [SHEET_NAMES.FORM_MASTER_ASSIGNMENTS]: [
    'Assignment ID', 'Staff ID', 'Class ID', 'Session',
    'Granted Full Access', 'Active From', 'Is Active'
  ],

  [SHEET_NAMES.TEACHER_SUBJECT_ASSIGNMENTS]: [
    'Assignment ID', 'Staff ID', 'Class ID', 'Subject ID', 'Term', 'Session'
  ],

  [SHEET_NAMES.CLASSES]: [
    'Class ID', 'Class Name', 'Section', 'Department'
  ],

  [SHEET_NAMES.SUBJECTS]: [
    'Subject ID', 'Subject Name', 'Section', 'Department'
  ],

  [SHEET_NAMES.CLASS_SUBJECT_ASSIGNMENTS]: [
    'Assignment ID', 'Class ID', 'Subject ID', 'Session'
  ],

  [SHEET_NAMES.SCORES]: [
    'Entry ID', 'Student ID', 'Class ID', 'Subject ID',
    'Term', 'Session', 'Component', 'Score', 'Staff ID', 'Timestamp'
  ],

  [SHEET_NAMES.PSQ]: [
    'Student ID', 'Class ID', 'Term', 'Session',
    'Physical Health', 'Punctuality', 'Reliability', 'Personal Neatness',
    'Politeness', 'Honesty', 'Initiative', 'Neatness in Academic Work',
    'Class Attendance', 'Class Participation', 'Self-Control',
    'Spirit of Co-operation', 'Sense of Responsibility', 'Attitude to Study',
    'Relationship with Peers', 'Relationship with Teachers',
    'Form Master Staff ID', 'Timestamp'
  ],

  [SHEET_NAMES.REMARKS]: [
    'Student ID', 'Class ID', 'Term', 'Session',
    'Remark', 'Form Master Staff ID', 'Timestamp'
  ],

  [SHEET_NAMES.STUDENT_TERM_STATUS]: [
    'Student ID', 'Class ID', 'Term', 'Session',
    'Status', 'Set By', 'Timestamp'
  ],

  [SHEET_NAMES.STUDENTS_CACHE]: [
    'Student ID', 'Full Name', 'Student Class', 'Gender',
    'Action Flag', 'Class ID', 'Cached At'
  ],

  [SHEET_NAMES.SESSION_SETTINGS]: [
    'Setting Key', 'Setting Value', 'Updated At'
  ],

  // ── Stage 7 additions ─────────────────────────────────────────────────────
  // These three sheets are created automatically by setupSheets().
  // Existing deployments that run Setup again will get these sheets added
  // without any disruption to existing sheets.

  [SHEET_NAMES.ACTIVITY_LOG]: [
    'Timestamp', 'Staff ID', 'Staff Name', 'Role',
    'Category', 'Action', 'Detail'
  ],

  [SHEET_NAMES.CHANGE_LOG]: [
    'Timestamp', 'Staff ID', 'Staff Name', 'Sheet',
    'Student ID', 'Class ID', 'Subject ID', 'Term', 'Session',
    'Field', 'Old Value', 'New Value'
  ],

  [SHEET_NAMES.RESULT_LOCKS]: [
    'Lock ID', 'Class ID', 'Term', 'Session', 'Is Locked',
    'Locked By', 'Locked At', 'Unlocked By', 'Unlocked At'
  ]
};

// ─── SUBJECTS REFERENCE DATA ──────────────────────────────────────────────────

/**
 * Full subject list for the school.
 * Each entry: [Subject Name, Category, Section]
 * Category mapping:
 *   JSS:  'General' → all JSS classes
 *   SSS:  'General' → all 9 SSS classes
 *         'Science' → SSS Science classes only
 *         'Business'→ SSS Commerce classes only
 *         'Humanities' → SSS Art classes only
 */
const SUBJECTS_REFERENCE_DATA = [
  // ── JSS (18 subjects, all General) ────────────────────────────────────────
  ['English Language',              'General',    'JSS'],
  ['Mathematics',                   'General',    'JSS'],
  ['Digital Technologies',          'General',    'JSS'],
  ['Business Studies',              'General',    'JSS'],
  ['Creative and Cultural Science', 'General',    'JSS'],
  ['Christian Religious Studies',   'General',    'JSS'],
  ['Social and Citizenship Studies','General',    'JSS'],
  ['History',                       'General',    'JSS'],
  ['Intermediate Science',          'General',    'JSS'],
  ['Basic Science',                 'General',    'JSS'],
  ['Physical Health Education',     'General',    'JSS'],
  ['Agricultural Science',          'General',    'JSS'],
  ['Home Economics',                'General',    'JSS'],
  ['Civic Education',               'General',    'JSS'],
  ['French',                        'General',    'JSS'],
  ['Hausa',                         'General',    'JSS'],
  ['Basic Tech',                    'General',    'JSS'],
  ['Social Studies',                'General',    'JSS'],

  // ── SSS General (7 subjects → all 9 SSS classes) ─────────────────────────
  ['English Language',              'General',    'SSS'],
  ['Mathematics',                   'General',    'SSS'],
  ['Digital Technologies',          'General',    'SSS'],
  ['Civic Education',               'General',    'SSS'],
  ['Agricultural Science',          'General',    'SSS'],
  ['Data Processing',               'General',    'SSS'],
  ['Geography',                     'General',    'SSS'],

  // ── SSS Science (3 subjects → Science department only) ───────────────────
  ['Chemistry',                     'Science',    'SSS'],
  ['Physics',                       'Science',    'SSS'],
  ['Biology',                       'Science',    'SSS'],

  // ── SSS Business/Commerce (2 subjects → Commerce department only) ─────────
  ['Commerce',                      'Business',   'SSS'],
  ['Financial Accounting',          'Business',   'SSS'],

  // ── SSS Humanities/Art (3 subjects → Art department only) ────────────────
  ['Government',                    'Humanities', 'SSS'],
  ['Christian Religious Studies',   'Humanities', 'SSS'],
  ['Literature',                    'Humanities', 'SSS']
];

// ─── MAIN SETUP FUNCTION ──────────────────────────────────────────────────────

/**
 * Create all required sheets in the active spreadsheet.
 * - Existing sheets are left completely untouched.
 * - New sheets get styled header rows (blue background, white bold text) + frozen row.
 * - Subjects Reference tab is always refreshed with the canonical subject list.
 * - Script Properties for active session/term are initialised if not already set.
 *
 * Returns a human-readable summary string.
 */
function setupSheets() {
  const ss = getSpreadsheet_();
  const results = { created: [], existing: [] };

  // ── Create / verify data sheets ──────────────────────────────────────────
  for (const [name, headers] of Object.entries(SHEET_DEFINITIONS)) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      writeHeaders_(sheet, headers);
      results.created.push(name);
    } else {
      results.existing.push(name);
    }
  }

  // ── Subjects Reference tab ────────────────────────────────────────────────
  setupSubjectsReference_(ss);

  // ── Default session settings (first-time only) ───────────────────────────
  initSessionSettings_();

  const summary = [
    'Setup complete.',
    results.created.length > 0
      ? 'Created: ' + results.created.join(', ')
      : 'No new sheets needed.',
    'Already existed: ' + (results.existing.length) + ' sheet(s).'
  ].join(' ');

  Logger.log(summary);
  return summary;
}

// ─── PRIVATE HELPERS ──────────────────────────────────────────────────────────

function getSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * Write the header row and apply styling.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string[]} headers
 */
function writeHeaders_(sheet, headers) {
  const range = sheet.getRange(1, 1, 1, headers.length);
  range.setValues([headers]);
  range.setBackground('#1565C0');      // Primary blue
  range.setFontColor('#FFFFFF');
  range.setFontWeight('bold');
  range.setFontSize(10);
  sheet.setFrozenRows(1);

  // Auto-resize columns for readability
  headers.forEach((_, i) => {
    sheet.autoResizeColumn(i + 1);
    // Enforce a minimum width
    const width = sheet.getColumnWidth(i + 1);
    if (width < 100) sheet.setColumnWidth(i + 1, 100);
  });
}

/**
 * Create or refresh the Subjects Reference tab.
 * This tab is the canonical source for Sync Subjects.
 * It is human-readable but machine-parseable.
 *
 * Layout:
 *   Row 1:   Header — Subject Name | Category | Section
 *   Row 2+:  One subject per row
 *   (Section label rows are omitted — Section is a column value instead)
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 */
function setupSubjectsReference_(ss) {
  let sheet = ss.getSheetByName(SHEET_NAMES.SUBJECTS_REFERENCE);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.SUBJECTS_REFERENCE);
  } else {
    sheet.clearContents();
    sheet.clearFormats();
  }

  const headers = ['Subject Name', 'Category', 'Section'];
  const allRows = [headers, ...SUBJECTS_REFERENCE_DATA];

  sheet.getRange(1, 1, allRows.length, 3).setValues(allRows);

  // Style header row
  const headerRange = sheet.getRange(1, 1, 1, 3);
  headerRange.setBackground('#1565C0');
  headerRange.setFontColor('#FFFFFF');
  headerRange.setFontWeight('bold');
  sheet.setFrozenRows(1);

  // Colour-code by section for readability
  const jssColor     = '#E3F2FD'; // light blue
  const sssGenColor  = '#E8F5E9'; // light green
  const sssSciColor  = '#FFF3E0'; // light orange
  const sssBusColor  = '#FCE4EC'; // light pink
  const sssHumColor  = '#EDE7F6'; // light purple

  SUBJECTS_REFERENCE_DATA.forEach((row, idx) => {
    const dataRow  = idx + 2; // offset by header
    const section  = row[2];
    const category = row[1];
    let color = '#FFFFFF';
    if (section === 'JSS')                                       color = jssColor;
    else if (section === 'SSS' && category === 'General')        color = sssGenColor;
    else if (section === 'SSS' && category === 'Science')        color = sssSciColor;
    else if (section === 'SSS' && category === 'Business')       color = sssBusColor;
    else if (section === 'SSS' && category === 'Humanities')     color = sssHumColor;
    sheet.getRange(dataRow, 1, 1, 3).setBackground(color);
  });

  // Auto-resize
  [1, 2, 3].forEach(col => sheet.autoResizeColumn(col));

  // Append a note row below the data
  const noteRow = allRows.length + 2;
  const noteCell = sheet.getRange(noteRow, 1, 1, 3);
  noteCell.merge();
  noteCell.setValue(
    'READ ONLY — This tab is the source for Sync Subjects. ' +
    'Edit subject names or categories here, then run Admin → Sync Subjects.'
  );
  noteCell.setFontColor('#757575').setFontStyle('italic').setWrap(true);
}

/**
 * Write default session settings to Script Properties if not already set.
 */
function initSessionSettings_() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('activeSession')) {
    props.setProperties({
      activeSession:      '2025/2026',
      activeTerm:         'First Term',
      termStartDate:      '',
      termEndDate:        '',
      nextTermFee:        '',
      nextTermResumption: ''
    });
    Logger.log('Session settings initialised with defaults: 2025/2026, First Term.');
  }
}

// serverRunSetup() is defined in Code.gs — it calls setupSheets() from here.
