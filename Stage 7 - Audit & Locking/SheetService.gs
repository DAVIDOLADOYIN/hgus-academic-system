/**
 * HGUS Academic Result Management System
 * SheetService.gs — Data layer
 *
 * ALL Google Sheets reads and writes go through this file.
 * No other file should call SpreadsheetApp directly.
 * To migrate to a different backend, rewrite only this file.
 *
 * Stage 3 additions:
 *   - getAllScores()                 — all score rows (no filter); used by ScoreService
 *   - getAllClassPSQ()               — all PSQ rows for a class/term/session
 *   - getAllClassRemarks()           — all Remark rows for a class/term/session
 *   - batchSaveComponentScores()    — efficient single-read, batch-write score save
 *
 * Stage 4 additions:
 *   - getScoresForClassGroup()      — scores for multiple classIds + term + session (one read)
 *                                      Used by ResultService to load all group scores efficiently.
 *
 * Stage 5 additions:
 *   - getAllClassPSQForGroup()       — PSQ rows for multiple classIds + term + session (one read)
 *                                      Used by CompletionService to check PSQ completeness.
 *   - getAllClassRemarksForGroup()   — Remark rows for multiple classIds + term + session (one read)
 *                                      Used by CompletionService to check remarks completeness.
 *
 * Stage 6 additions:
 *   - getAllTeacherSubjectAssignmentsUnfiltered() — all TS assignment rows (no filter)
 *                                      Used by CarryForwardService for duplicate-checking
 *                                      and ID generation across all terms/sessions.
 *
 * Stage 7 additions:
 *   - appendActivityLog(row)         — append one row to Activity Log (Tier 1)
 *   - appendChangeLog(row)           — append one row to Change Log (Tier 2)
 *   - getAllActivityLog()            — read all Activity Log rows (for in-app viewer)
 *   - getResultLock(classId,t,s)     — read the lock row for a class-term
 *   - upsertResultLock(...)          — insert or update a Result Locks row
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
      externalSheetId:    props.getProperty('externalSheetId')    || '',
      studentDataTab:     props.getProperty('studentDataTab')     || ''
    };
  }

  function setSessionSettings(settings) {
    const props   = PropertiesService.getScriptProperties();
    const allowed = [
      'activeSession', 'activeTerm', 'termStartDate',
      'termEndDate', 'nextTermFee', 'nextTermResumption',
      'externalSheetId', 'studentDataTab'
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

  function getAllScores() {
    try { return sheetToObjects(getSheet(SHEET_NAMES.SCORES)); }
    catch (e) { return []; }
  }

  function getScoresForClassGroup(classIds, term, session) {
    try {
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

  function batchSaveComponentScores(context, studentScores) {
    const sheet   = getSheet(SHEET_NAMES.SCORES);
    const data    = sheet.getDataRange().getValues();
    const headers = data[0];

    const colIdx = {};
    headers.forEach(function (h, i) { colIdx[toCamelCase(h)] = i; });

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
      existingIndex[key] = i + 1;
    }

    const existingEntryIds = data.slice(1).map(function (row) {
      return String(row[colIdx.entryId] || '');
    });

    const now      = new Date().toISOString();
    const newRows  = [];

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
        const sheetRowNum = existingIndex[key];
        if (colIdx.score     !== undefined) sheet.getRange(sheetRowNum, colIdx.score     + 1).setValue(s.score);
        if (colIdx.staffId   !== undefined) sheet.getRange(sheetRowNum, colIdx.staffId   + 1).setValue(context.staffId);
        if (colIdx.timestamp !== undefined) sheet.getRange(sheetRowNum, colIdx.timestamp + 1).setValue(now);
      } else {
        const newEntryId = generateId(ENTRY_ID_PREFIX, existingEntryIds);
        existingEntryIds.push(newEntryId);

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

  function getAllClassPSQForGroup(classIds, term, session) {
    try {
      const classIdSet = {};
      classIds.forEach(function (id) { classIdSet[String(id)] = true; });

      const all = sheetToObjects(getSheet(SHEET_NAMES.PSQ));
      return all.filter(function (r) {
        return classIdSet[String(r.classId)] &&
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

  function getAllClassRemarksForGroup(classIds, term, session) {
    try {
      const classIdSet = {};
      classIds.forEach(function (id) { classIdSet[String(id)] = true; });

      const all = sheetToObjects(getSheet(SHEET_NAMES.REMARKS));
      return all.filter(function (r) {
        return classIdSet[String(r.classId)] &&
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
      return all
        .filter(function (r) { return String(r.classId) === String(classId); })
        .map(function (r) {
          var editedName   = r['Edited Name']   ? String(r['Edited Name']).trim()   : '';
          var editedGender = r['Edited Gender'] ? String(r['Edited Gender']).trim() : '';
          if (!editedName   && r.editedName)   editedName   = String(r.editedName).trim();
          if (!editedGender && r.editedGender) editedGender = String(r.editedGender).trim();
          var hasNameCorr   = !!editedName;
          var hasGenderCorr = !!editedGender;
          return Object.assign({}, r, {
            fullName:      hasNameCorr   ? editedName   : (r.fullName   || ''),
            gender:        hasGenderCorr ? editedGender : (r.gender     || ''),
            sourceFullName: r.fullName  || '',
            sourceGender:   r.gender    || '',
            hasCorrection:  hasNameCorr || hasGenderCorr
          });
        });
    } catch (e) { return []; }
  }

  function refreshStudentCache(classId, students) {
    const sheet = getSheet(SHEET_NAMES.STUDENTS_CACHE);
    ensureCacheCorrectionsColumns_();

    const data = sheet.getDataRange().getValues();

    var corrections = {};
    if (data.length > 1) {
      const headers    = data[0].map(function (h) { return String(h); });
      const classIdCol = headers.indexOf('Class ID');
      const studentCol = headers.indexOf('Student ID');
      const enCol      = headers.indexOf('Edited Name');
      const egCol      = headers.indexOf('Edited Gender');
      const rowsToDelete = [];

      for (let i = data.length - 1; i >= 1; i--) {
        if (String(data[i][classIdCol]).trim() !== String(classId).trim()) continue;
        const sid = studentCol >= 0 ? String(data[i][studentCol] || '').trim() : '';
        if (sid) {
          corrections[sid] = {
            editedName:   enCol >= 0 ? String(data[i][enCol] || '').trim() : '',
            editedGender: egCol >= 0 ? String(data[i][egCol] || '').trim() : ''
          };
        }
        rowsToDelete.push(i + 1);
      }
      rowsToDelete.forEach(function (rowNum) { sheet.deleteRow(rowNum); });
    }

    const now = new Date();
    students.forEach(function (s) {
      const corr = corrections[s.studentId] || {};
      appendRow(SHEET_NAMES.STUDENTS_CACHE, Object.assign({}, s, {
        classId:      classId,
        cachedAt:     now,
        editedName:   corr.editedName   || '',
        editedGender: corr.editedGender || ''
      }));
    });
  }

  function ensureCacheCorrectionsColumns_() {
    const sheet   = getSheet(SHEET_NAMES.STUDENTS_CACHE);
    const lastCol = sheet.getLastColumn();
    if (lastCol === 0) return;
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h); });
    const needed  = ['Edited Name', 'Edited Gender'];
    needed.forEach(function (col) {
      if (headers.indexOf(col) === -1) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(col);
      }
    });
  }

  function updateStudentCorrection(studentId, editedName, editedGender) {
    ensureCacheCorrectionsColumns_();
    updateRowWhere(SHEET_NAMES.STUDENTS_CACHE, 'Student ID', studentId, {
      editedName:   editedName   || '',
      editedGender: editedGender || ''
    });
  }

  function clearStudentCorrection(studentId) {
    ensureCacheCorrectionsColumns_();
    updateRowWhere(SHEET_NAMES.STUDENTS_CACHE, 'Student ID', studentId, {
      editedName:   '',
      editedGender: ''
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE 6 ADDITIONS — append-only, nothing above this line was changed
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get every Teacher-Subject Assignment row in the sheet (no filters).
   * Used by CarryForwardService.
   */
  function getAllTeacherSubjectAssignmentsUnfiltered() {
    try {
      return sheetToObjects(getSheet(SHEET_NAMES.TEACHER_SUBJECT_ASSIGNMENTS));
    } catch (e) { return []; }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE 7 ADDITIONS — append-only, nothing above this line was changed
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── ACTIVITY LOG (Tier 1) ────────────────────────────────────────────────

  /**
   * Append one row to the Activity Log sheet.
   *
   * Called exclusively by LogService.logActivity() — do not call directly.
   *
   * @param {{ timestamp, staffId, staffName, role, category, action, detail }} rowData
   */
  function appendActivityLog(rowData) {
    // Use the sheet directly (no getSheet guard) so logging never throws
    try {
      appendRow(SHEET_NAMES.ACTIVITY_LOG, rowData);
    } catch (e) {
      Logger.log('appendActivityLog error (non-fatal): ' + e.message);
    }
  }

  /**
   * Read all Activity Log rows.
   * Called by LogService.getActivityLog() which then applies role/filter logic.
   *
   * @returns {Object[]}
   */
  function getAllActivityLog() {
    try {
      return sheetToObjects(getSheet(SHEET_NAMES.ACTIVITY_LOG));
    } catch (e) { return []; }
  }

  // ─── CHANGE LOG (Tier 2) ─────────────────────────────────────────────────

  /**
   * Append one row to the Change Log sheet.
   *
   * Called exclusively by LogService.logChange_() — do not call directly.
   * Never shown in the app UI; filtered in Google Sheets by Super Admin.
   *
   * @param {{ timestamp, staffId, staffName, sheet, studentId, classId,
   *           subjectId, term, session, field, oldValue, newValue }} rowData
   */
  function appendChangeLog(rowData) {
    try {
      appendRow(SHEET_NAMES.CHANGE_LOG, rowData);
    } catch (e) {
      Logger.log('appendChangeLog error (non-fatal): ' + e.message);
    }
  }

  // ─── RESULT LOCKS ─────────────────────────────────────────────────────────

  /**
   * Read the result lock row for a specific class + term + session.
   *
   * One row per (classId + term + session) combination.
   * Returns null if no lock record exists yet (treat as unlocked).
   *
   * @param {string} classId
   * @param {string} term
   * @param {string} session
   * @returns {Object|null}
   */
  function getResultLock(classId, term, session) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.RESULT_LOCKS));
      return all.find(function (r) {
        return String(r.classId) === String(classId) &&
               String(r.term)    === String(term)    &&
               String(r.session) === String(session);
      }) || null;
    } catch (e) { return null; }
  }

  /**
   * Insert or update the lock record for a class + term + session.
   *
   * If a row already exists for this combination, it is updated in-place.
   * If not, a new row is appended.
   *
   * Called exclusively by LockService — do not call directly from Code.gs.
   *
   * @param {string} classId
   * @param {string} term
   * @param {string} session
   * @param {{ isLocked, lockedBy, lockedAt, unlockedBy, unlockedAt }} lockData
   *   Only the keys you provide are updated when updating an existing row.
   */
  function upsertResultLock(classId, term, session, lockData) {
    const existing = getResultLock(classId, term, session);

    if (existing) {
      // Update existing row — match on the unique Lock ID
      const updates = {};
      if (lockData.isLocked   !== undefined) updates.isLocked   = lockData.isLocked;
      if (lockData.lockedBy   !== undefined) updates.lockedBy   = lockData.lockedBy;
      if (lockData.lockedAt   !== undefined) updates.lockedAt   = lockData.lockedAt;
      if (lockData.unlockedBy !== undefined) updates.unlockedBy = lockData.unlockedBy;
      if (lockData.unlockedAt !== undefined) updates.unlockedAt = lockData.unlockedAt;
      updateRowWhere(SHEET_NAMES.RESULT_LOCKS, 'Lock ID', existing.lockId, updates);
    } else {
      // Generate a new Lock ID
      const allLocks     = sheetToObjects(getSheet(SHEET_NAMES.RESULT_LOCKS));
      const existingIds  = allLocks.map(function (r) { return String(r.lockId || ''); });
      const newLockId    = generateId(LOCK_ID_PREFIX, existingIds);

      appendRow(SHEET_NAMES.RESULT_LOCKS, {
        lockId:     newLockId,
        classId:    classId,
        term:       term,
        session:    session,
        isLocked:   lockData.isLocked   !== undefined ? lockData.isLocked   : false,
        lockedBy:   lockData.lockedBy   || '',
        lockedAt:   lockData.lockedAt   || '',
        unlockedBy: lockData.unlockedBy || '',
        unlockedAt: lockData.unlockedAt || ''
      });
    }
  }

  /**
   * Get all result lock rows for a given session (for showing lock badges
   * on every class card in the Classes & Subjects screen).
   *
   * @param {string} session — e.g. "2025/2026"
   * @returns {Object[]}  — array of lock rows (may be empty)
   */
  function getResultLocksForSession(session) {
    try {
      const all = sheetToObjects(getSheet(SHEET_NAMES.RESULT_LOCKS));
      return all.filter(function (r) {
        return String(r.session) === String(session);
      });
    } catch (e) { return []; }
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
    deleteUserRecord,
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
    getAllTeacherSubjectAssignmentsUnfiltered,

    // Scores
    getScores,
    getAllScores,
    getScoresForClassGroup,
    getScore,
    upsertScore,
    batchSaveComponentScores,

    // PSQ
    getPSQ,
    getAllClassPSQ,
    getAllClassPSQForGroup,
    upsertPSQ,

    // Remarks
    getRemark,
    getAllClassRemarks,
    getAllClassRemarksForGroup,
    upsertRemark,

    // Student Term Status
    getStudentStatus,
    upsertStudentStatus,
    getClassTermStatuses,

    // Students cache
    getCachedStudents,
    refreshStudentCache,
    updateStudentCorrection,
    clearStudentCorrection,

    // Stage 7: Activity Log
    appendActivityLog,
    getAllActivityLog,

    // Stage 7: Change Log
    appendChangeLog,

    // Stage 7: Result Locks
    getResultLock,
    upsertResultLock,
    getResultLocksForSession
    // Note: ensureCacheStudentDataColumns is attached directly to SheetService
    // below the IIFE — it does not need to be listed here.
  };

})();


// ─── STAGE 7 PATCH: ensureCacheStudentDataColumns ────────────────────────────
// The external StudentData sheet now includes Date of Birth and
// Parent / Guardian Contact. This function checks whether those two columns
// exist in the Students Cache sheet and appends them if they are missing.
//
// Called automatically by StudentService.refreshStudentCache (IIFE patch)
// before every cache write, so the columns are always present before data
// is written. Safe to call multiple times — it is a no-op if the columns
// already exist.
//
// HOW TO MODIFY:
//   Add more column names to the `needed` array to ensure additional columns
//   are present in the Students Cache sheet.
// ─────────────────────────────────────────────────────────────────────────────

// This function is added directly to the SheetService object so it is
// accessible across all service files.
SheetService.ensureCacheStudentDataColumns = function () {
  // NOTE: This function is defined outside the SheetService IIFE, so it cannot
  // use the private getSheet() helper. It accesses the sheet directly via
  // SpreadsheetApp instead — functionally identical, just different entry point.
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet()
                              .getSheetByName(SHEET_NAMES.STUDENTS_CACHE);
    if (!sheet) {
      Logger.log('ensureCacheStudentDataColumns: Students Cache sheet not found.');
      return;
    }

    var lastCol = sheet.getLastColumn();
    if (lastCol === 0) return; // Empty sheet — nothing to do.

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
                       .map(function (h) { return String(h).trim(); });

    // Columns to guarantee exist in the Students Cache sheet.
    // Add more entries here if future fields need to be cached.
    var needed = ['Date of Birth', 'Parent Contact'];

    needed.forEach(function (col) {
      if (headers.indexOf(col) === -1) {
        // Append the missing column header in the next available column.
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(col);
      }
    });
  } catch (e) {
    Logger.log('SheetService.ensureCacheStudentDataColumns error: ' + e.message);
  }
};
