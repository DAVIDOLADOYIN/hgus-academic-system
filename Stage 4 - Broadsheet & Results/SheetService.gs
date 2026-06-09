/**
 * HGUS Academic Result Management System
 * SheetService.gs — Data layer
 *
 * ALL Google Sheets reads and writes go through this file.
 * No other file should call SpreadsheetApp directly.
 * To migrate to a different backend, rewrite only this file.
 *
 * Stage 3 additions:
 *   - getAllScores()             — all score rows (no filter); used by ScoreService
 *   - getAllClassPSQ()           — all PSQ rows for a class/term/session
 *   - getAllClassRemarks()       — all Remark rows for a class/term/session
 *   - batchSaveComponentScores() — efficient single-read, batch-write score save
 *
 * Stage 4 additions:
 *   - getScoresForClassGroup()  — scores for multiple classIds + term + session (one read)
 *                                  Used by ResultService to load all group scores efficiently.
 */

const SheetService = (function () {

  // ─── PRIVATE HELPERS ──────────────────────────────────────────────────────

  function getSpreadsheet() {
    return SpreadsheetApp.getActiveSpreadsheet();
  }

  /**
   * Get a sheet by name; throws a clear error if missing.
   */
  function getSheet(name) {
    const ss    = getSpreadsheet();
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
    const sheet   = getSheet(sheetName);
    const headers = getHeaders(sheet);
    const row     = headers.map(function (h) {
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
    const sheet   = getSheet(sheetName);
    const data    = sheet.getDataRange().getValues();
    if (data.length < 2) return false;
    const headers     = data[0];
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
   */
  function deleteRowWhere(sheetName, matchHeader, matchValue) {
    const sheet       = getSheet(sheetName);
    const data        = sheet.getDataRange().getValues();
    if (data.length < 2) return false;
    const headers     = data[0];
    const matchColIdx = headers.indexOf(matchHeader);
    if (matchColIdx === -1) return false;

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][matchColIdx]).trim() === String(matchValue).trim()) {
        sheet.deleteRow(i + 1);
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

  /**
   * Permanently delete a user row from the Users sheet by Staff ID.
   * This is a hard delete — the row is gone. Call only after all validation
   * has passed in the calling service (role check, self-delete check, etc.).
   *
   * @param {string} staffId
   * @returns {boolean} true if a row was found and deleted; false if not found
   */
  function deleteUserRecord(staffId) {
    return deleteRowWhere(SHEET_NAMES.USERS, 'Staff ID', staffId);
  }

  function usernameExists(username) { return getUser(username) !== null; }

  // ─── SESSION SETTINGS (PropertiesService) ─────────────────────────────────

  function getSessionSettings() {
    const props = PropertiesService.getScriptProperties();
    return {
      activeSession:      props.getProperty('activeSession')      || '',
      activeTerm:         props.getProperty('activeTerm')         || '',
      termStartDate:      props.getProperty('termStartDate')      || '',
      termEndDate:        props.getProperty('termEndDate')        || '',
      nextTermFee:        props.getProperty('nextTermFee')        || '',
      nextTermResumption: props.getProperty('nextTermResumption') || '',
      externalSheetId:    props.getProperty('externalSheetId')    || ''
    };
  }

  function setSessionSettings(settings) {
    const props   = PropertiesService.getScriptProperties();
    const allowed = [
      'activeSession', 'activeTerm', 'termStartDate',
      'termEndDate', 'nextTermFee', 'nextTermResumption',
      'externalSheetId'
    ];
    allowed.forEach(function (key) {
      if (settings[key] !== undefined) props.setProperty(key, String(settings[key]));
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

  function getSubjectsReference() {
    try {
      const sheet   = getSheet(SHEET_NAMES.SUBJECTS_REFERENCE);
      const data    = sheet.getDataRange().getValues();
      const results = [];
      for (let i = 0; i < data.length; i++) {
        const name     = String(data[i][0]).trim();
        const category = String(data[i][1]).trim();
        const section  = String(data[i][2]).trim();
        if (!name || !category || !section) continue;
        if (name === 'Subject Name') continue;
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

  function getAllFormMasterAssignments() {
    try { return sheetToObjects(getSheet(SHEET_NAMES.FORM_MASTER_ASSIGNMENTS)); }
    catch (e) { return []; }
  }

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

  /**
   * Get all scores for a specific class + subject + term + session.
   * Used by ScoreService to build the per-component roster.
   */
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

  /**
   * Get every score row in the sheet (no filters).
   *
   * WHY: ScoreService.getComponentStatuses() needs to check whether
   * ALL active students in a class have Test1 AND Test2 entered across
   * every subject. Reading the full sheet once and filtering in memory
   * is far faster than making one read per subject.
   *
   * HOW TO USE: Call once at the start of an operation; pass the
   * returned array to helper functions that filter it by classId,
   * subjectId, component, etc.
   */
  function getAllScores() {
    try { return sheetToObjects(getSheet(SHEET_NAMES.SCORES)); }
    catch (e) { return []; }
  }

  /**
   * Get all score rows for a list of classIds + term + session.
   *
   * WHY this function exists (Stage 4):
   *   ResultService.getStudentResult() needs to compute per-subject totals
   *   for EVERY student in a class group (for overall-position ranking).
   *   Calling getScores(classId, subjectId, ...) in a double loop
   *   (once per subject × once per class) would produce many sheet reads.
   *   This function reads the sheet ONCE and returns everything for the
   *   group, letting the service filter by subjectId in memory.
   *
   * @param {string[]} classIds — array of class IDs (e.g. ["CLS001","CLS002","CLS003"])
   * @param {string}   term
   * @param {string}   session
   * @returns {Object[]} score rows for all matching classIds + term + session
   */
  function getScoresForClassGroup(classIds, term, session) {
    try {
      // Build a Set-like object for O(1) classId lookups
      const classIdSet = {};
      classIds.forEach(function (id) { classIdSet[String(id)] = true; });

      const all = sheetToObjects(getSheet(SHEET_NAMES.SCORES));
      return all.filter(function (r) {
        return classIdSet[String(r.classId)] &&
               String(r.term)    === String(term)    &&
               String(r.session) === String(session);
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

  /**
   * Insert or update a single score row.
   * Reads the full Scores sheet to find an existing entry.
   * For saving many students at once, use batchSaveComponentScores() instead
   * — it is much faster because it only reads the sheet once.
   */
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

  /**
   * Save scores for a whole class (one component) in one efficient operation.
   *
   * WHY this function exists instead of calling upsertScore() in a loop:
   *   upsertScore() reads the entire Scores sheet to find an existing row,
   *   then writes to it. In a loop of 30 students that is 30 sheet reads
   *   plus 30 writes — very slow on large sheets. batchSaveComponentScores()
   *   reads the sheet ONCE, builds an in-memory index, then issues only the
   *   necessary writes. For N students: 1 read + N writes instead of N reads
   *   + N writes.
   *
   * @param {{ classId, subjectId, component, term, session, staffId }} context
   *   Shared fields for every score being saved.
   *
   * @param {{ studentId, score }[]} studentScores
   *   Array of { studentId, score } objects — one per student.
   *   score must be a number or empty string ('') to clear.
   *
   * HOW TO MODIFY:
   *   If you add a new column to the Scores sheet, add it to the rowData
   *   object inside the append block below.
   */
  function batchSaveComponentScores(context, studentScores) {
    const sheet   = getSheet(SHEET_NAMES.SCORES);
    const data    = sheet.getDataRange().getValues();
    const headers = data[0];

    // Build a column-index map for fast lookups when updating
    const colIdx = {};
    headers.forEach(function (h, i) { colIdx[toCamelCase(h)] = i; });

    // Build an in-memory index: "studentId|classId|subjectId|component|term|session" → rowNumber
    // Row numbers are 1-indexed and include the header row (so data row 0 is sheet row 2).
    const existingIndex = {};
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const key = [
        String(row[colIdx.studentId]  || ''),
        String(row[colIdx.classId]    || ''),
        String(row[colIdx.subjectId]  || ''),
        String(row[colIdx.component]  || ''),
        String(row[colIdx.term]       || ''),
        String(row[colIdx.session]    || '')
      ].join('|');
      existingIndex[key] = i + 1; // 1-indexed sheet row number
    }

    // Gather all existing entry IDs so we can generate new unique ones
    const existingEntryIds = data.slice(1).map(function (row) {
      return String(row[colIdx.entryId] || '');
    });

    const now      = new Date().toISOString();
    const newRows  = []; // rows to batch-append at the end

    studentScores.forEach(function (s) {
      const key = [
        String(s.studentId),
        String(context.classId),
        String(context.subjectId),
        String(context.component),
        String(context.term),
        String(context.session)
      ].join('|');

      if (existingIndex[key]) {
        // Update existing row in-place (single cell writes are fast)
        const sheetRowNum = existingIndex[key];
        if (colIdx.score     !== undefined) sheet.getRange(sheetRowNum, colIdx.score     + 1).setValue(s.score);
        if (colIdx.staffId   !== undefined) sheet.getRange(sheetRowNum, colIdx.staffId   + 1).setValue(context.staffId);
        if (colIdx.timestamp !== undefined) sheet.getRange(sheetRowNum, colIdx.timestamp + 1).setValue(now);
      } else {
        // Prepare a new row to append after the loop
        // generateId needs the full list — we track newly generated IDs too
        const newEntryId = generateId(ENTRY_ID_PREFIX, existingEntryIds);
        existingEntryIds.push(newEntryId); // prevent duplicate IDs within this batch

        newRows.push({
          entryId:   newEntryId,
          studentId: s.studentId,
          classId:   context.classId,
          subjectId: context.subjectId,
          term:      context.term,
          session:   context.session,
          component: context.component,
          score:     s.score,
          staffId:   context.staffId,
          timestamp: now
        });
      }
    });

    // Batch-append all new rows at once
    newRows.forEach(function (rowData) {
      appendRow(SHEET_NAMES.SCORES, rowData);
    });
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

  /**
   * Get ALL PSQ rows for a class/term/session.
   *
   * WHY: PSQService.getClassPSQ() loads the entire class roster so the Form
   * Master sees every student's ratings in one screen. Reading the full PSQ
   * sheet once and filtering is much faster than one getPSQ() call per student.
   *
   * @returns {{ studentId, [trait]: rating, ... }[]}
   */
  function getAllClassPSQ(classId, term, session) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.PSQ));
      return all.filter(function (r) {
        return String(r.classId) === String(classId) &&
               String(r.term)    === String(term)    &&
               String(r.session) === String(session);
      });
    } catch (e) { return []; }
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

  /**
   * Get ALL remark rows for a class/term/session.
   *
   * WHY: RemarkService.getClassRemarks() needs to show every student's
   * current remark at once. One filtered read is faster than N individual
   * getRemark() calls.
   *
   * @returns {{ studentId, remark, ... }[]}
   */
  function getAllClassRemarks(classId, term, session) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.REMARKS));
      return all.filter(function (r) {
        return String(r.classId) === String(classId) &&
               String(r.term)    === String(term)    &&
               String(r.session) === String(session);
      });
    } catch (e) { return []; }
  }

  function upsertRemark(remarkData) {
    const existing = getRemark(remarkData.studentId, remarkData.classId, remarkData.term, remarkData.session);
    if (existing) {
      updateRowWhere(SHEET_NAMES.REMARKS, 'Student ID', remarkData.studentId, {
        remark: remarkData.remark,
        formMasterStaffId: remarkData.formMasterStaffId,
        timestamp: remarkData.timestamp
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
    const existing = getStudentStatus(
      statusData.studentId, statusData.classId, statusData.term, statusData.session
    );
    // Only write to the sheet if the status is non-Active, or if the row already exists
    const existingRow = (function () {
      try {
        const all = sheetToObjects(getSheet(SHEET_NAMES.STUDENT_TERM_STATUS));
        return all.find(function (r) {
          return String(r.studentId) === String(statusData.studentId) &&
                 String(r.classId)   === String(statusData.classId)   &&
                 String(r.term)      === String(statusData.term)       &&
                 String(r.session)   === String(statusData.session);
        });
      } catch (e) { return null; }
    })();

    if (existingRow) {
      updateRowWhere(SHEET_NAMES.STUDENT_TERM_STATUS, 'Student ID', statusData.studentId, {
        status: statusData.status, setBy: statusData.setBy, timestamp: statusData.timestamp
      });
    } else if (statusData.status !== STUDENT_STATUS.ACTIVE) {
      // Only create a row if status is non-Active (Active is the implicit default)
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
    // Low-level helpers (exposed for direct use in services)
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
    deleteUserRecord,    // Stage 4 addition — hard delete for Super Admin
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
    getAllScores,                // Stage 3 addition
    getScoresForClassGroup,     // Stage 4 addition — bulk read for BroadsheetService/ResultService
    getScore,
    upsertScore,
    batchSaveComponentScores,   // Stage 3 addition

    // PSQ
    getPSQ,
    getAllClassPSQ,              // Stage 3 addition
    upsertPSQ,

    // Remarks
    getRemark,
    getAllClassRemarks,          // Stage 3 addition
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
