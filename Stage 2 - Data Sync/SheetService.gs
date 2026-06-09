/**
 * HGUS Academic Result Management System
 * SheetService.gs — Data layer
 *
 * ALL Google Sheets reads and writes go through this file.
 * No other file should call SpreadsheetApp directly.
 * To migrate to a different backend (Supabase, etc.), rewrite only this file.
 *
 * Stage 2 additions:
 *   - externalSheetId added to getSessionSettings / setSessionSettings
 *   - deleteRowWhere — physical row deletion (used by AssignmentService)
 *   - getAllFormMasterAssignments — returns all FM rows (no filter)
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
    return data.slice(1).map(function (row) {
      const obj = {};
      headers.forEach(function (h, i) {
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
    const row = headers.map(function (h) {
      const val = rowData[toCamelCase(h)];
      return (val !== undefined && val !== null) ? val : '';
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
        headers.forEach(function (h, j) {
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

  /**
   * Physically delete the first row where `matchHeader` column equals `matchValue`.
   * Returns true if a row was found and deleted.
   *
   * Use only when historical preservation is not required (e.g. removing an
   * erroneous Teacher-Subject assignment).
   */
  function deleteRowWhere(sheetName, matchHeader, matchValue) {
    const sheet = getSheet(sheetName);
    const data  = sheet.getDataRange().getValues();
    if (data.length < 2) return false;
    const headers     = data[0];
    const matchColIdx = headers.indexOf(matchHeader);
    if (matchColIdx === -1) return false;

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][matchColIdx]).trim() === String(matchValue).trim()) {
        sheet.deleteRow(i + 1); // rows are 1-indexed
        return true;
      }
    }
    return false;
  }

  // ─── USERS ────────────────────────────────────────────────────────────────

  function getUser(username) {
    try {
      const users = getAllUsers();
      return users.find(function (u) {
        return String(u.username).trim() === String(username).trim();
      }) || null;
    } catch (e) { return null; }
  }

  function getUserById(staffId) {
    try {
      const users = getAllUsers();
      return users.find(function (u) {
        return String(u.staffId).trim() === String(staffId).trim();
      }) || null;
    } catch (e) { return null; }
  }

  function getAllUsers() {
    try { return sheetToObjects(getSheet(SHEET_NAMES.USERS)); }
    catch (e) { return []; }
  }

  function createUser(userData) { appendRow(SHEET_NAMES.USERS, userData); }

  function updateUser(staffId, updates) {
    return updateRowWhere(SHEET_NAMES.USERS, 'Staff ID', staffId, updates);
  }

  function usernameExists(username) { return getUser(username) !== null; }

  // ─── SESSION SETTINGS (PropertiesService) ─────────────────────────────────
  //
  // Active session, term, and external sheet ID are global state stored in
  // Script Properties — instant reads, no concurrency issues.

  /**
   * Get all session settings including the external sheet ID.
   * @returns {{activeSession, activeTerm, termStartDate, termEndDate,
   *            nextTermFee, nextTermResumption, externalSheetId}}
   */
  function getSessionSettings() {
    const props = PropertiesService.getScriptProperties();
    return {
      activeSession:       props.getProperty('activeSession')       || '',
      activeTerm:          props.getProperty('activeTerm')          || '',
      termStartDate:       props.getProperty('termStartDate')       || '',
      termEndDate:         props.getProperty('termEndDate')         || '',
      nextTermFee:         props.getProperty('nextTermFee')         || '',
      nextTermResumption:  props.getProperty('nextTermResumption')  || '',
      externalSheetId:     props.getProperty('externalSheetId')     || ''
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
      'termEndDate', 'nextTermFee', 'nextTermResumption',
      'externalSheetId'
    ];
    allowed.forEach(function (key) {
      if (settings[key] !== undefined) {
        props.setProperty(key, String(settings[key]));
      }
    });
  }

  // ─── CLASSES ──────────────────────────────────────────────────────────────

  function getAllClasses() {
    try { return sheetToObjects(getSheet(SHEET_NAMES.CLASSES)); }
    catch (e) { return []; }
  }

  function createClass(classData) { appendRow(SHEET_NAMES.CLASSES, classData); }

  // ─── SUBJECTS ─────────────────────────────────────────────────────────────

  function getAllSubjects() {
    try { return sheetToObjects(getSheet(SHEET_NAMES.SUBJECTS)); }
    catch (e) { return []; }
  }

  function createSubject(subjectData) { appendRow(SHEET_NAMES.SUBJECTS, subjectData); }

  /**
   * Read the Subjects Reference tab.
   * Expected columns: Subject Name | Category | Section
   * @returns {{ subjectName, category, section }[]}
   */
  function getSubjectsReference() {
    try {
      const sheet  = getSheet(SHEET_NAMES.SUBJECTS_REFERENCE);
      const data   = sheet.getDataRange().getValues();
      const results = [];
      for (let i = 0; i < data.length; i++) {
        const name     = String(data[i][0]).trim();
        const category = String(data[i][1]).trim();
        const section  = String(data[i][2]).trim();
        if (!name || !category || !section) continue;
        if (name === 'Subject Name') continue;          // header row
        results.push({ subjectName: name, category: category, section: section });
      }
      return results;
    } catch (e) { return []; }
  }

  // ─── CLASS-SUBJECT ASSIGNMENTS ────────────────────────────────────────────

  function getClassSubjectAssignments(session) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.CLASS_SUBJECT_ASSIGNMENTS));
      return session
        ? all.filter(function (r) { return String(r.session) === String(session); })
        : all;
    } catch (e) { return []; }
  }

  function createClassSubjectAssignment(data) {
    appendRow(SHEET_NAMES.CLASS_SUBJECT_ASSIGNMENTS, data);
  }

  // ─── FORM MASTER ASSIGNMENTS ──────────────────────────────────────────────

  /**
   * Get the active Form Master assignment for a class / session.
   */
  function getFormMasterAssignment(classId, session) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.FORM_MASTER_ASSIGNMENTS));
      return all.find(function (r) {
        return String(r.classId) === String(classId) &&
               String(r.session) === String(session) &&
               toBoolean(r.isActive);
      }) || null;
    } catch (e) { return null; }
  }

  /**
   * Get all Form Master assignments (no filter).
   * Admin screens use this to display / deactivate them.
   */
  function getAllFormMasterAssignments() {
    try { return sheetToObjects(getSheet(SHEET_NAMES.FORM_MASTER_ASSIGNMENTS)); }
    catch (e) { return []; }
  }

  /**
   * Get all active FM assignments for a staff member.
   */
  function getFormMasterAssignmentsByStaff(staffId) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.FORM_MASTER_ASSIGNMENTS));
      return all.filter(function (r) {
        return String(r.staffId) === String(staffId) && toBoolean(r.isActive);
      });
    } catch (e) { return []; }
  }

  function createFormMasterAssignment(data) {
    appendRow(SHEET_NAMES.FORM_MASTER_ASSIGNMENTS, data);
  }

  function deactivateFormMasterAssignment(assignmentId) {
    updateRowWhere(
      SHEET_NAMES.FORM_MASTER_ASSIGNMENTS,
      'Assignment ID',
      assignmentId,
      { isActive: false }
    );
  }

  // ─── TEACHER-SUBJECT ASSIGNMENTS ──────────────────────────────────────────

  function getTeacherSubjectAssignments(term, session) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.TEACHER_SUBJECT_ASSIGNMENTS));
      return all.filter(function (r) {
        return String(r.term)    === String(term) &&
               String(r.session) === String(session);
      });
    } catch (e) { return []; }
  }

  function getTeacherAssignmentsByStaff(staffId, term, session) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.TEACHER_SUBJECT_ASSIGNMENTS));
      return all.filter(function (r) {
        return String(r.staffId) === String(staffId) &&
               String(r.term)    === String(term)    &&
               String(r.session) === String(session);
      });
    } catch (e) { return []; }
  }

  function createTeacherSubjectAssignment(data) {
    appendRow(SHEET_NAMES.TEACHER_SUBJECT_ASSIGNMENTS, data);
  }

  // ─── SCORES ───────────────────────────────────────────────────────────────

  function getScores(classId, subjectId, term, session) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.SCORES));
      return all.filter(function (r) {
        return String(r.classId)   === String(classId)   &&
               String(r.subjectId) === String(subjectId) &&
               String(r.term)      === String(term)      &&
               String(r.session)   === String(session);
      });
    } catch (e) { return []; }
  }

  function getScore(studentId, classId, subjectId, component, term, session) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.SCORES));
      return all.find(function (r) {
        return String(r.studentId) === String(studentId) &&
               String(r.classId)   === String(classId)   &&
               String(r.subjectId) === String(subjectId) &&
               String(r.component) === String(component) &&
               String(r.term)      === String(term)      &&
               String(r.session)   === String(session);
      }) || null;
    } catch (e) { return null; }
  }

  function upsertScore(scoreData) {
    const existing = getScore(
      scoreData.studentId, scoreData.classId, scoreData.subjectId,
      scoreData.component, scoreData.term, scoreData.session
    );
    if (existing) {
      updateRowWhere(SHEET_NAMES.SCORES, 'Entry ID', existing.entryId, {
        score: scoreData.score, staffId: scoreData.staffId, timestamp: scoreData.timestamp
      });
    } else {
      appendRow(SHEET_NAMES.SCORES, scoreData);
    }
  }

  // ─── PSQ ──────────────────────────────────────────────────────────────────

  function getPSQ(studentId, classId, term, session) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.PSQ));
      return all.find(function (r) {
        return String(r.studentId) === String(studentId) &&
               String(r.classId)   === String(classId)   &&
               String(r.term)      === String(term)       &&
               String(r.session)   === String(session);
      }) || null;
    } catch (e) { return null; }
  }

  function upsertPSQ(psqData) {
    const existing = getPSQ(psqData.studentId, psqData.classId, psqData.term, psqData.session);
    if (existing) {
      const updates = {};
      PSQ_TRAITS.forEach(function (trait) {
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

  function getRemark(studentId, classId, term, session) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.REMARKS));
      return all.find(function (r) {
        return String(r.studentId) === String(studentId) &&
               String(r.classId)   === String(classId)   &&
               String(r.term)      === String(term)       &&
               String(r.session)   === String(session);
      }) || null;
    } catch (e) { return null; }
  }

  function upsertRemark(remarkData) {
    const existing = getRemark(remarkData.studentId, remarkData.classId, remarkData.term, remarkData.session);
    if (existing) {
      updateRowWhere(SHEET_NAMES.REMARKS, 'Student ID', remarkData.studentId, {
        remark: remarkData.remark, formMasterStaffId: remarkData.formMasterStaffId, timestamp: remarkData.timestamp
      });
    } else {
      appendRow(SHEET_NAMES.REMARKS, remarkData);
    }
  }

  // ─── STUDENT TERM STATUS ──────────────────────────────────────────────────

  function getStudentStatus(studentId, classId, term, session) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.STUDENT_TERM_STATUS));
      const row = all.find(function (r) {
        return String(r.studentId) === String(studentId) &&
               String(r.classId)   === String(classId)   &&
               String(r.term)      === String(term)       &&
               String(r.session)   === String(session);
      });
      return row ? String(row.status) : STUDENT_STATUS.ACTIVE;
    } catch (e) { return STUDENT_STATUS.ACTIVE; }
  }

  function upsertStudentStatus(statusData) {
    const sheet = getSheet(SHEET_NAMES.STUDENT_TERM_STATUS);
    const all   = sheetToObjects(sheet);
    const row   = all.find(function (r) {
      return String(r.studentId) === String(statusData.studentId) &&
             String(r.classId)   === String(statusData.classId)   &&
             String(r.term)      === String(statusData.term)       &&
             String(r.session)   === String(statusData.session);
    });
    if (row) {
      updateRowWhere(SHEET_NAMES.STUDENT_TERM_STATUS, 'Student ID', statusData.studentId, {
        status: statusData.status, setBy: statusData.setBy, timestamp: statusData.timestamp
      });
    } else if (statusData.status !== STUDENT_STATUS.ACTIVE) {
      appendRow(SHEET_NAMES.STUDENT_TERM_STATUS, statusData);
    }
  }

  function getClassTermStatuses(classId, term, session) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.STUDENT_TERM_STATUS));
      const map = {};
      all
        .filter(function (r) {
          return String(r.classId) === String(classId) &&
                 String(r.term)    === String(term)    &&
                 String(r.session) === String(session);
        })
        .forEach(function (r) { map[r.studentId] = r.status; });
      return map;
    } catch (e) { return {}; }
  }

  // ─── STUDENTS CACHE ───────────────────────────────────────────────────────

  function getCachedStudents(classId) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.STUDENTS_CACHE));
      return all.filter(function (r) { return String(r.classId) === String(classId); });
    } catch (e) { return []; }
  }

  function refreshStudentCache(classId, students) {
    const sheet = getSheet(SHEET_NAMES.STUDENTS_CACHE);
    const data  = sheet.getDataRange().getValues();
    if (data.length > 1) {
      const headers    = data[0];
      const classIdCol = headers.indexOf('Class ID');
      const rowsToDelete = [];
      for (let i = data.length - 1; i >= 1; i--) {
        if (String(data[i][classIdCol]).trim() === String(classId).trim()) {
          rowsToDelete.push(i + 1);
        }
      }
      rowsToDelete.forEach(function (rowNum) { sheet.deleteRow(rowNum); });
    }
    const now = new Date();
    students.forEach(function (s) {
      appendRow(SHEET_NAMES.STUDENTS_CACHE, Object.assign({}, s, { classId: classId, cachedAt: now }));
    });
  }

  // ─── PUBLIC API ───────────────────────────────────────────────────────────

  return {
    // Low-level (exposed for direct use in services)
    getSheet,
    sheetToObjects,
    appendRow,
    updateRowWhere,
    deleteRowWhere,

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
    getAllFormMasterAssignments,
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
