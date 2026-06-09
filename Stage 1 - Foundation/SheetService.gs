/**
 * HGUS Academic Result Management System
 * SheetService.gs — Data layer
 *
 * ALL Google Sheets reads and writes go through this file.
 * No other file should call SpreadsheetApp directly.
 * To migrate to a different backend (Supabase, etc.), rewrite only this file.
 */

const SheetService = (function () {

  // ─── PRIVATE HELPERS ──────────────────────────────────────────────────────

  function getSpreadsheet() {
    return SpreadsheetApp.getActiveSpreadsheet();
  }

  /**
   * Get a sheet by name; throws a clear error if missing (prompts setup).
   */
  function getSheet(name) {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(name);
    if (!sheet) {
      throw new Error(
        'Sheet "' + name + '" not found. ' +
        'Please run Setup (Admin Panel → Run Setup) first.'
      );
    }
    return sheet;
  }

  /**
   * Convert a cell value to a type safe for google.script.run serialisation.
   * Date objects become ISO strings; everything else is left as-is.
   */
  function sanitizeValue(val) {
    if (val instanceof Date) return val.toISOString();
    return val;
  }

  /**
   * Read all data rows from a sheet and return as an array of plain objects.
   * Row 1 is treated as the header row.
   * Header strings are converted to camelCase keys.
   * All values are sanitized so Dates become strings (safe for client transfer).
   */
  function sheetToObjects(sheet) {
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return [];
    const headers = data[0];
    return data.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[toCamelCase(h)] = sanitizeValue(row[i]);
      });
      return obj;
    });
  }

  /**
   * Return the header row of a sheet as an array of strings.
   */
  function getHeaders(sheet) {
    const lastCol = sheet.getLastColumn();
    if (lastCol === 0) return [];
    return sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  }

  /**
   * Append a data object as a new row, mapping keys via the header row.
   * Missing keys are written as empty string.
   */
  function appendRow(sheetName, rowData) {
    const sheet = getSheet(sheetName);
    const headers = getHeaders(sheet);
    const row = headers.map(h => {
      const val = rowData[toCamelCase(h)];
      return val !== undefined && val !== null ? val : '';
    });
    sheet.appendRow(row);
  }

  /**
   * Find a row where the column named `matchHeader` equals `matchValue`
   * and update the columns specified in the `updates` object.
   * Returns true if a matching row was found and updated.
   */
  function updateRowWhere(sheetName, matchHeader, matchValue, updates) {
    const sheet = getSheet(sheetName);
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return false;
    const headers = data[0];
    const matchColIdx = headers.indexOf(matchHeader);
    if (matchColIdx === -1) return false;

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][matchColIdx]).trim() === String(matchValue).trim()) {
        headers.forEach((h, j) => {
          const key = toCamelCase(h);
          if (Object.prototype.hasOwnProperty.call(updates, key)) {
            sheet.getRange(i + 1, j + 1).setValue(updates[key]);
          }
        });
        return true;
      }
    }
    return false;
  }

  // ─── USERS ────────────────────────────────────────────────────────────────

  /**
   * Get a single user by username (case-sensitive match).
   * Returns null if not found.
   */
  function getUser(username) {
    try {
      const users = getAllUsers();
      return users.find(u => String(u.username).trim() === String(username).trim()) || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Get a single user by Staff ID.
   * Returns null if not found.
   */
  function getUserById(staffId) {
    try {
      const users = getAllUsers();
      return users.find(u => String(u.staffId).trim() === String(staffId).trim()) || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Get all users as an array of objects.
   * Returns [] if the sheet is empty or doesn't exist yet.
   */
  function getAllUsers() {
    try {
      return sheetToObjects(getSheet(SHEET_NAMES.USERS));
    } catch (e) {
      return [];
    }
  }

  /**
   * Append a new user row to the Users sheet.
   * @param {Object} userData — must include all required fields
   */
  function createUser(userData) {
    appendRow(SHEET_NAMES.USERS, userData);
  }

  /**
   * Update fields on a user row identified by Staff ID.
   * Only keys present in `updates` are written; all others are left unchanged.
   * @param {string} staffId
   * @param {Object} updates — camelCase keys matching header names
   * @returns {boolean} true if the row was found and updated
   */
  function updateUser(staffId, updates) {
    return updateRowWhere(SHEET_NAMES.USERS, 'Staff ID', staffId, updates);
  }

  /**
   * Check if a username already exists in the Users sheet.
   * @param {string} username
   * @returns {boolean}
   */
  function usernameExists(username) {
    return getUser(username) !== null;
  }

  // ─── SESSION SETTINGS (PropertiesService) ─────────────────────────────────
  //
  // Active session and term are global state — stored in Script Properties,
  // not a sheet, so reads are instant and there's no concurrency issue.

  /**
   * Get the current active session/term settings.
   * @returns {{activeSession, activeTerm, termStartDate, termEndDate, nextTermFee, nextTermResumption}}
   */
  function getSessionSettings() {
    const props = PropertiesService.getScriptProperties();
    return {
      activeSession:       props.getProperty('activeSession')       || '',
      activeTerm:          props.getProperty('activeTerm')          || '',
      termStartDate:       props.getProperty('termStartDate')       || '',
      termEndDate:         props.getProperty('termEndDate')         || '',
      nextTermFee:         props.getProperty('nextTermFee')         || '',
      nextTermResumption:  props.getProperty('nextTermResumption')  || ''
    };
  }

  /**
   * Update one or more session settings fields.
   * Only keys present in `settings` are written.
   * @param {Object} settings
   */
  function setSessionSettings(settings) {
    const props = PropertiesService.getScriptProperties();
    const allowed = [
      'activeSession', 'activeTerm', 'termStartDate',
      'termEndDate', 'nextTermFee', 'nextTermResumption'
    ];
    allowed.forEach(key => {
      if (settings[key] !== undefined) {
        props.setProperty(key, String(settings[key]));
      }
    });
  }

  // ─── CLASSES ──────────────────────────────────────────────────────────────

  /**
   * Get all classes from the Classes sheet.
   * @returns {Object[]}
   */
  function getAllClasses() {
    try {
      return sheetToObjects(getSheet(SHEET_NAMES.CLASSES));
    } catch (e) {
      return [];
    }
  }

  /**
   * Append a new class row.
   * @param {Object} classData
   */
  function createClass(classData) {
    appendRow(SHEET_NAMES.CLASSES, classData);
  }

  // ─── SUBJECTS ─────────────────────────────────────────────────────────────

  /**
   * Get all subjects from the Subjects sheet.
   * @returns {Object[]}
   */
  function getAllSubjects() {
    try {
      return sheetToObjects(getSheet(SHEET_NAMES.SUBJECTS));
    } catch (e) {
      return [];
    }
  }

  /**
   * Append a new subject row.
   * @param {Object} subjectData
   */
  function createSubject(subjectData) {
    appendRow(SHEET_NAMES.SUBJECTS, subjectData);
  }

  /**
   * Read the Subjects Reference tab and return rows as objects.
   * Expected columns: Subject Name | Category | Section
   * Skips rows that are blank or are section header labels.
   * @returns {{ subjectName: string, category: string, section: string }[]}
   */
  function getSubjectsReference() {
    try {
      const sheet = getSheet(SHEET_NAMES.SUBJECTS_REFERENCE);
      const data = sheet.getDataRange().getValues();
      const results = [];
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const name = String(row[0]).trim();
        const category = String(row[1]).trim();
        const section = String(row[2]).trim();
        // Skip headers, blanks, and label rows
        if (!name || !category || !section) continue;
        if (name === 'Subject Name') continue;                // header row
        if (name.toUpperCase() === name && !category) continue; // label row
        results.push({ subjectName: name, category, section });
      }
      return results;
    } catch (e) {
      return [];
    }
  }

  // ─── CLASS-SUBJECT ASSIGNMENTS ────────────────────────────────────────────

  /**
   * Get all class-subject assignments for a given session.
   * @param {string} session — e.g. '2025/2026'
   * @returns {Object[]}
   */
  function getClassSubjectAssignments(session) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.CLASS_SUBJECT_ASSIGNMENTS));
      return session ? all.filter(r => String(r.session) === String(session)) : all;
    } catch (e) {
      return [];
    }
  }

  /**
   * Append a class-subject assignment row.
   * @param {Object} assignmentData
   */
  function createClassSubjectAssignment(assignmentData) {
    appendRow(SHEET_NAMES.CLASS_SUBJECT_ASSIGNMENTS, assignmentData);
  }

  // ─── FORM MASTER ASSIGNMENTS ──────────────────────────────────────────────

  /**
   * Get active Form Master assignment for a class/session.
   * @param {string} classId
   * @param {string} session
   * @returns {Object|null}
   */
  function getFormMasterAssignment(classId, session) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.FORM_MASTER_ASSIGNMENTS));
      return all.find(r =>
        String(r.classId) === String(classId) &&
        String(r.session) === String(session) &&
        toBoolean(r.isActive)
      ) || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Get all Form Master assignments for a staff member.
   * @param {string} staffId
   * @returns {Object[]}
   */
  function getFormMasterAssignmentsByStaff(staffId) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.FORM_MASTER_ASSIGNMENTS));
      return all.filter(r =>
        String(r.staffId) === String(staffId) &&
        toBoolean(r.isActive)
      );
    } catch (e) {
      return [];
    }
  }

  /**
   * Append a Form Master assignment row.
   * @param {Object} data
   */
  function createFormMasterAssignment(data) {
    appendRow(SHEET_NAMES.FORM_MASTER_ASSIGNMENTS, data);
  }

  /**
   * Deactivate a Form Master assignment (set Is Active = FALSE).
   * @param {string} assignmentId
   */
  function deactivateFormMasterAssignment(assignmentId) {
    updateRowWhere(
      SHEET_NAMES.FORM_MASTER_ASSIGNMENTS,
      'Assignment ID',
      assignmentId,
      { isActive: false }
    );
  }

  // ─── TEACHER-SUBJECT ASSIGNMENTS ──────────────────────────────────────────

  /**
   * Get all teacher-subject assignments for a given term and session.
   * @param {string} term
   * @param {string} session
   * @returns {Object[]}
   */
  function getTeacherSubjectAssignments(term, session) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.TEACHER_SUBJECT_ASSIGNMENTS));
      return all.filter(r =>
        String(r.term) === String(term) &&
        String(r.session) === String(session)
      );
    } catch (e) {
      return [];
    }
  }

  /**
   * Get assignments for a specific teacher.
   * @param {string} staffId
   * @param {string} term
   * @param {string} session
   * @returns {Object[]}
   */
  function getTeacherAssignmentsByStaff(staffId, term, session) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.TEACHER_SUBJECT_ASSIGNMENTS));
      return all.filter(r =>
        String(r.staffId) === String(staffId) &&
        String(r.term) === String(term) &&
        String(r.session) === String(session)
      );
    } catch (e) {
      return [];
    }
  }

  /**
   * Append a teacher-subject assignment.
   * @param {Object} data
   */
  function createTeacherSubjectAssignment(data) {
    appendRow(SHEET_NAMES.TEACHER_SUBJECT_ASSIGNMENTS, data);
  }

  // ─── SCORES ───────────────────────────────────────────────────────────────

  /**
   * Get all score rows for a class, subject, term, and session.
   * @param {string} classId
   * @param {string} subjectId
   * @param {string} term
   * @param {string} session
   * @returns {Object[]}
   */
  function getScores(classId, subjectId, term, session) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.SCORES));
      return all.filter(r =>
        String(r.classId)   === String(classId)   &&
        String(r.subjectId) === String(subjectId) &&
        String(r.term)      === String(term)       &&
        String(r.session)   === String(session)
      );
    } catch (e) {
      return [];
    }
  }

  /**
   * Get a specific component score for a student.
   * @param {string} studentId
   * @param {string} classId
   * @param {string} subjectId
   * @param {string} component
   * @param {string} term
   * @param {string} session
   * @returns {Object|null}
   */
  function getScore(studentId, classId, subjectId, component, term, session) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.SCORES));
      return all.find(r =>
        String(r.studentId) === String(studentId) &&
        String(r.classId)   === String(classId)   &&
        String(r.subjectId) === String(subjectId) &&
        String(r.component) === String(component) &&
        String(r.term)      === String(term)       &&
        String(r.session)   === String(session)
      ) || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Upsert a score: update if entry exists, append if not.
   * @param {Object} scoreData — must include entryId if updating
   */
  function upsertScore(scoreData) {
    const existing = getScore(
      scoreData.studentId,
      scoreData.classId,
      scoreData.subjectId,
      scoreData.component,
      scoreData.term,
      scoreData.session
    );
    if (existing) {
      updateRowWhere(
        SHEET_NAMES.SCORES,
        'Entry ID',
        existing.entryId,
        { score: scoreData.score, staffId: scoreData.staffId, timestamp: scoreData.timestamp }
      );
    } else {
      appendRow(SHEET_NAMES.SCORES, scoreData);
    }
  }

  // ─── PSQ ──────────────────────────────────────────────────────────────────

  /**
   * Get PSQ record for a student in a given term/session.
   * @returns {Object|null}
   */
  function getPSQ(studentId, classId, term, session) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.PSQ));
      return all.find(r =>
        String(r.studentId) === String(studentId) &&
        String(r.classId)   === String(classId)   &&
        String(r.term)      === String(term)       &&
        String(r.session)   === String(session)
      ) || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Upsert a PSQ record.
   * @param {Object} psqData
   */
  function upsertPSQ(psqData) {
    const existing = getPSQ(
      psqData.studentId,
      psqData.classId,
      psqData.term,
      psqData.session
    );
    if (existing) {
      const updates = {};
      PSQ_TRAITS.forEach(trait => {
        const key = toCamelCase(trait);
        if (psqData[key] !== undefined) updates[key] = psqData[key];
      });
      updates.formMasterStaffId = psqData.formMasterStaffId;
      updates.timestamp = psqData.timestamp;
      updateRowWhere(SHEET_NAMES.PSQ, 'Student ID', psqData.studentId, updates);
    } else {
      appendRow(SHEET_NAMES.PSQ, psqData);
    }
  }

  // ─── REMARKS ──────────────────────────────────────────────────────────────

  /**
   * Get a remark for a student in a given term/session.
   * @returns {Object|null}
   */
  function getRemark(studentId, classId, term, session) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.REMARKS));
      return all.find(r =>
        String(r.studentId) === String(studentId) &&
        String(r.classId)   === String(classId)   &&
        String(r.term)      === String(term)       &&
        String(r.session)   === String(session)
      ) || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Upsert a remark.
   * @param {Object} remarkData
   */
  function upsertRemark(remarkData) {
    const existing = getRemark(
      remarkData.studentId,
      remarkData.classId,
      remarkData.term,
      remarkData.session
    );
    if (existing) {
      updateRowWhere(
        SHEET_NAMES.REMARKS,
        'Student ID',
        remarkData.studentId,
        { remark: remarkData.remark, formMasterStaffId: remarkData.formMasterStaffId, timestamp: remarkData.timestamp }
      );
    } else {
      appendRow(SHEET_NAMES.REMARKS, remarkData);
    }
  }

  // ─── STUDENT TERM STATUS ──────────────────────────────────────────────────

  /**
   * Get the term status for a student.
   * Returns 'Active' if no row exists (the default).
   * @returns {string} 'Active' | 'Exam Exempt' | 'Not Continuing'
   */
  function getStudentStatus(studentId, classId, term, session) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.STUDENT_TERM_STATUS));
      const row = all.find(r =>
        String(r.studentId) === String(studentId) &&
        String(r.classId)   === String(classId)   &&
        String(r.term)      === String(term)       &&
        String(r.session)   === String(session)
      );
      return row ? String(row.status) : STUDENT_STATUS.ACTIVE;
    } catch (e) {
      return STUDENT_STATUS.ACTIVE;
    }
  }

  /**
   * Upsert a student term status.
   * @param {Object} statusData
   */
  function upsertStudentStatus(statusData) {
    const existing = getStudentStatus(
      statusData.studentId,
      statusData.classId,
      statusData.term,
      statusData.session
    );
    // 'Active' means no row — if existing row, update; if Active→Active, do nothing
    const sheet = getSheet(SHEET_NAMES.STUDENT_TERM_STATUS);
    const all = sheetToObjects(sheet);
    const row = all.find(r =>
      String(r.studentId) === String(statusData.studentId) &&
      String(r.classId)   === String(statusData.classId)   &&
      String(r.term)      === String(statusData.term)       &&
      String(r.session)   === String(statusData.session)
    );
    if (row) {
      updateRowWhere(
        SHEET_NAMES.STUDENT_TERM_STATUS,
        'Student ID',
        statusData.studentId,
        { status: statusData.status, setBy: statusData.setBy, timestamp: statusData.timestamp }
      );
    } else if (statusData.status !== STUDENT_STATUS.ACTIVE) {
      // Only write a row for non-Active statuses
      appendRow(SHEET_NAMES.STUDENT_TERM_STATUS, statusData);
    }
  }

  /**
   * Get all term statuses for a class/term/session.
   * Returns a map: { studentId → status }
   * Students not in the map are Active.
   */
  function getClassTermStatuses(classId, term, session) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.STUDENT_TERM_STATUS));
      const map = {};
      all
        .filter(r =>
          String(r.classId) === String(classId) &&
          String(r.term) === String(term) &&
          String(r.session) === String(session)
        )
        .forEach(r => { map[r.studentId] = r.status; });
      return map;
    } catch (e) {
      return {};
    }
  }

  // ─── STUDENTS CACHE ───────────────────────────────────────────────────────

  /**
   * Get cached students for a class.
   * @param {string} classId
   * @returns {Object[]}
   */
  function getCachedStudents(classId) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.STUDENTS_CACHE));
      return all.filter(r => String(r.classId) === String(classId));
    } catch (e) {
      return [];
    }
  }

  /**
   * Replace all cached students for a class.
   * @param {string} classId
   * @param {Object[]} students
   */
  function refreshStudentCache(classId, students) {
    const sheet = getSheet(SHEET_NAMES.STUDENTS_CACHE);
    // Remove existing rows for this class
    const data = sheet.getDataRange().getValues();
    if (data.length > 1) {
      const headers = data[0];
      const classIdCol = headers.indexOf('Class ID');
      // Collect rows to delete (reverse order to avoid index shifting)
      const rowsToDelete = [];
      for (let i = data.length - 1; i >= 1; i--) {
        if (String(data[i][classIdCol]).trim() === String(classId).trim()) {
          rowsToDelete.push(i + 1); // 1-indexed
        }
      }
      rowsToDelete.forEach(rowNum => sheet.deleteRow(rowNum));
    }
    // Append new rows
    const now = new Date();
    students.forEach(s => {
      appendRow(SHEET_NAMES.STUDENTS_CACHE, { ...s, classId, cachedAt: now });
    });
  }

  // ─── PUBLIC API ───────────────────────────────────────────────────────────

  return {
    // Low-level
    getSheet,
    sheetToObjects,
    appendRow,
    updateRowWhere,

    // Users
    getUser,
    getUserById,
    getAllUsers,
    createUser,
    updateUser,
    usernameExists,

    // Session settings
    getSessionSettings,
    setSessionSettings,

    // Classes
    getAllClasses,
    createClass,

    // Subjects
    getAllSubjects,
    createSubject,
    getSubjectsReference,

    // Class-subject assignments
    getClassSubjectAssignments,
    createClassSubjectAssignment,

    // Form Master assignments
    getFormMasterAssignment,
    getFormMasterAssignmentsByStaff,
    createFormMasterAssignment,
    deactivateFormMasterAssignment,

    // Teacher-subject assignments
    getTeacherSubjectAssignments,
    getTeacherAssignmentsByStaff,
    createTeacherSubjectAssignment,

    // Scores
    getScores,
    getScore,
    upsertScore,

    // PSQ
    getPSQ,
    upsertPSQ,

    // Remarks
    getRemark,
    upsertRemark,

    // Student Term Status
    getStudentStatus,
    upsertStudentStatus,
    getClassTermStatuses,

    // Students cache
    getCachedStudents,
    refreshStudentCache
  };

})();
