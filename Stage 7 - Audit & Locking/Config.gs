/**
 * HGUS Academic Result Management System
 * Config.gs — Global constants and configuration
 *
 * All magic strings and numbers live here.
 * Never hard-code these values in other files.
 */

// ─── SHEET NAMES ──────────────────────────────────────────────────────────────

const SHEET_NAMES = {
  USERS:                        'Users',
  FORM_MASTER_ASSIGNMENTS:      'Form Master Assignments',
  TEACHER_SUBJECT_ASSIGNMENTS:  'Teacher-Subject Assignments',
  CLASSES:                      'Classes',
  SUBJECTS:                     'Subjects',
  CLASS_SUBJECT_ASSIGNMENTS:    'Class-Subject Assignments',
  SCORES:                       'Scores',
  PSQ:                          'PSQ',
  REMARKS:                      'Remarks',
  STUDENT_TERM_STATUS:          'Student Term Status',
  SUBJECTS_REFERENCE:           'Subjects Reference',
  STUDENTS_CACHE:               'Students Cache',
  SESSION_SETTINGS:             'Session Settings',

  // ── Stage 7 additions ─────────────────────────────────────────────────────
  // Three new sheets for audit logging and result locking.
  ACTIVITY_LOG:  'Activity Log',   // Tier 1: key events shown in the app UI
  CHANGE_LOG:    'Change Log',     // Tier 2: before/after snapshots (Sheets-only view)
  RESULT_LOCKS:  'Result Locks'    // Which class-terms are currently locked
};

// ─── ROLES ────────────────────────────────────────────────────────────────────

const ROLES = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN:       'Admin',
  TEACHER:     'Teacher'
};

// ─── EMPLOYMENT STATUS ────────────────────────────────────────────────────────

const EMPLOYMENT_STATUS = {
  ACTIVE:   'Active',
  ON_LEAVE: 'On Leave',
  RESIGNED: 'Resigned'
};

// ─── TERMS ────────────────────────────────────────────────────────────────────

const TERMS = ['First Term', 'Second Term', 'Third Term'];

// ─── STUDENT STATUS ───────────────────────────────────────────────────────────

const STUDENT_STATUS = {
  ACTIVE:        'Active',
  EXAM_EXEMPT:   'Exam Exempt',
  NOT_CONTINUING:'Not Continuing'
};

// ─── SCORE COMPONENTS ─────────────────────────────────────────────────────────

const SCORE_COMPONENTS = {
  CW:    { key: 'C/W',   label: 'Classwork',         max: 6  },
  ASS:   { key: 'ASS',   label: 'Assignment',         max: 2  },
  ATT:   { key: 'ATT',   label: 'Attendance',         max: 2  },
  TEST1: { key: 'Test1', label: '1st C.A Test',       max: 10 },
  TEST2: { key: 'Test2', label: '2nd C.A Test',       max: 10 },
  EXAM:  { key: 'Exam',  label: 'Examination',        max: 70 }
};

const COMPONENT_ORDER = ['C/W', 'ASS', 'ATT', 'Test1', 'Test2', 'Exam'];

// ─── GRADE THRESHOLDS ─────────────────────────────────────────────────────────

const GRADE_THRESHOLDS = [
  { min: 75,  max: 100, grade: 'A1', comment: 'Excellent'    },
  { min: 70,  max: 74,  grade: 'B2', comment: 'Very Good'    },
  { min: 65,  max: 69,  grade: 'B3', comment: 'Good'         },
  { min: 60,  max: 64,  grade: 'C4', comment: 'Fairly Good'  },
  { min: 55,  max: 59,  grade: 'C5', comment: 'Fairly Good'  },
  { min: 50,  max: 54,  grade: 'C6', comment: 'Fairly Good'  },
  { min: 45,  max: 49,  grade: 'D7', comment: 'Weak'         },
  { min: 40,  max: 44,  grade: 'E8', comment: 'Very Weak'    },
  { min: 0,   max: 39,  grade: 'F9', comment: 'Fail'         }
];

// ─── PSQ TRAITS ───────────────────────────────────────────────────────────────

const PSQ_TRAITS = [
  'Physical Health',
  'Punctuality',
  'Reliability',
  'Personal Neatness',
  'Politeness',
  'Honesty',
  'Initiative',
  'Neatness in Academic Work',
  'Class Attendance',
  'Class Participation',
  'Self-Control',
  'Spirit of Co-operation',
  'Sense of Responsibility',
  'Attitude to Study',
  'Relationship with Peers',
  'Relationship with Teachers'
];

// ─── SESSION / CACHE ──────────────────────────────────────────────────────────

// How long (in seconds) the server-side session cache entry lives.
//
// WHY 3600 (1 hour)?
//   The client browser is the primary inactivity guard — it logs the user out
//   after 5 minutes of no screen interaction (INACTIVITY_MS in AppScript.html).
//   The server cache is only a backstop for truly abandoned sessions (e.g. the
//   browser tab crashed or was closed without logging out).
//
//   Setting this to 5 minutes (300) caused premature "Session expired" errors:
//   the user could be actively reading data on screen — which fires client
//   touch/click events and keeps the browser timer alive — but if no server
//   call happened for 5 minutes the cache entry expired. The next server
//   action then returned SESSION_EXPIRED even though the user never went idle.
//   See TESTING_CHANGE_LOG.md T2-12 for the full diagnosis.
const SESSION_TIMEOUT_SECONDS = 3600;         // 1 hour (server-side backstop)
const SESSION_CACHE_KEY_PREFIX = 'sess_';
const STAFF_ID_PREFIX = 'HGST';
const CLASS_ID_PREFIX = 'CLS';
const SUBJECT_ID_PREFIX = 'SUBJ';
const ASSIGNMENT_ID_PREFIX = 'ASGN';
const ENTRY_ID_PREFIX = 'ENT';

// ─── SCHOOL DETAILS ───────────────────────────────────────────────────────────

const SCHOOL = {
  name:    'His Grace Universal Schools',
  address: 'Across the Rail, Sabon Gari Gonin Gora, P.O Box 8095, Kaduna'
};

// ═══════════════════════════════════════════════════════════════════════════════
// STAGE 7 ADDITIONS — append-only, nothing above this line was changed
// ═══════════════════════════════════════════════════════════════════════════════

// ─── LOG CATEGORIES (Tier 1 Activity Log) ────────────────────────────────────
//
// Each category groups related events in the Activity Log.
// Used by the UI to populate the category filter dropdown and by LogService
// to stamp each activity row with a consistent category string.
//
// HOW TO EXTEND: Add a new key/value here, then use LOG_CATEGORIES.YOUR_KEY
// in the relevant service call. The UI filter will pick it up automatically.

const LOG_CATEGORIES = {
  AUTH:        'Auth',           // Login, logout, password events
  USER_MGMT:   'User Management',// User created, role changed, deleted
  CONFIG:      'Configuration',  // Session/term changed, classes/subjects synced
  RESULTS:     'Results',        // Broadsheet and result slip exports
  CORRECTIONS: 'Corrections',    // Student name/gender corrections
  ARCHIVE:     'Archive',        // Session archived (Stage 8)
  LOCK:        'Lock'            // Class-term locked / unlocked (Stage 7)
};

// ─── ID PREFIXES ─────────────────────────────────────────────────────────────

// Prefix for Result Lock row IDs (stored in Result Locks sheet).
// Format: LCK001, LCK002, ...
const LOCK_ID_PREFIX = 'LCK';

// ─── SUPER ADMIN SETTINGS PROPERTY KEYS ─────────────────────────────────────
//
// These are ScriptProperty keys (PropertiesService) for Super Admin-only settings.
// They are NOT stored in any sheet — they live in Script Properties.

const SA_PROP_ADMIN_CAN_VIEW_LOG = 'superAdmin_adminCanViewLog';
// Value: 'true' or 'false'. Default is 'false' (admins cannot see activity log).
