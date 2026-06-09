/**
 * HGUS Academic Result Management System
 * StudentService.gs — Student cache management
 *
 * Reads student records from the external Google Sheet (StudentData tab)
 * and writes them to the internal Students Cache sheet.
 *
 * The external sheet ID must already be saved in Script Properties
 * (key: externalSheetId) via Session Settings before calling these functions.
 *
 * Cache strategy:
 *   - Pull-on-open: called when a teacher opens a class's Score Entry screen
 *   - Admin can force a full refresh at any time via Session Settings
 *   - Each refresh for a specific class replaces only that class's rows
 *   - 'all' refresh replaces all classes' rows (one class at a time)
 */

const StudentService = (function () {

  // ─── PUBLIC API ────────────────────────────────────────────────────────────

  /**
   * Refresh the student cache from the external spreadsheet.
   *
   * @param {string} token
   * @param {string} classId — a specific Class ID, or 'all' to refresh every class
   * @returns {{ success, data: { count, message } }}
   */
  function refreshStudentCache(token, classId) {
    const sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    const settings        = SheetService.getSessionSettings();
    const externalSheetId = settings.externalSheetId;
    if (!externalSheetId) {
      return errorResponse(
        'External Sheet ID is not configured. Please enter it in Session Settings and save.',
        'CONFIG_ERROR'
      );
    }

    // ── Open external spreadsheet ─────────────────────────────────────────────
    let extSS;
    try {
      extSS = SpreadsheetApp.openById(externalSheetId.trim());
    } catch (e) {
      return errorResponse(
        'Could not open the external spreadsheet. Check the Sheet ID in Session Settings.',
        'EXTERNAL_SHEET_ERROR'
      );
    }

    // ── Locate StudentData tab ────────────────────────────────────────────────
    const sheets    = extSS.getSheets();
    const dataSheet = sheets.find(function (s) {
      const name = s.getName().toLowerCase();
      return name.includes('studentdata') || name.includes('student data');
    });
    if (!dataSheet) {
      return errorResponse(
        'Could not find a tab named "StudentData" in the external spreadsheet.',
        'EXTERNAL_SHEET_ERROR'
      );
    }

    // ── Read and validate headers ─────────────────────────────────────────────
    const data = dataSheet.getDataRange().getValues();
    if (data.length < 2) {
      return errorResponse('The StudentData tab is empty.', 'EXTERNAL_SHEET_ERROR');
    }

    const headers       = data[0].map(function (h) { return String(h).trim().toLowerCase(); });
    const colStudentId  = headers.indexOf('student id');
    const colFullName   = headers.indexOf('full name');
    const colClass      = headers.indexOf('student class');
    const colGender     = headers.indexOf('gender');
    const colActionFlag = headers.indexOf('action flag');

    if (colStudentId === -1 || colFullName === -1 || colClass === -1) {
      return errorResponse(
        'The StudentData tab is missing required columns. ' +
        'Expected: "Student ID", "Full Name", "Student Class".',
        'EXTERNAL_SHEET_ERROR'
      );
    }

    // ── Build a map from className → classId using the Classes sheet ──────────
    const allClasses  = SheetService.getAllClasses();
    const classByName = {};
    allClasses.forEach(function (c) {
      classByName[String(c.className).trim().toLowerCase()] = c;
    });

    // ── Parse students from external data ─────────────────────────────────────
    const allStudents = data.slice(1)
      .map(function (row) {
        return {
          studentId:    String(row[colStudentId]  || '').trim(),
          fullName:     String(row[colFullName]   || '').trim(),
          studentClass: String(row[colClass]      || '').trim(),
          gender:       colGender     >= 0 ? String(row[colGender]     || '').trim() : '',
          actionFlag:   colActionFlag >= 0 ? String(row[colActionFlag] || '').trim() : ''
        };
      })
      .filter(function (s) {
        // Skip blank / malformed rows
        if (!s.studentId || !s.fullName || !s.studentClass) return false;
        // Only JSS / SSS students
        const up = s.studentClass.toUpperCase();
        return up.startsWith('JSS') || up.startsWith('SSS');
      });

    // ── Determine which classes to refresh ────────────────────────────────────
    let targetClasses;
    if (classId === 'all') {
      targetClasses = allClasses;
    } else {
      const cls = allClasses.find(function (c) { return c.classId === classId; });
      if (!cls) return errorResponse('Class not found: ' + classId, 'NOT_FOUND');
      targetClasses = [cls];
    }

    // ── Refresh cache one class at a time ─────────────────────────────────────
    let totalCount = 0;
    targetClasses.forEach(function (cls) {
      const studentsForClass = allStudents.filter(function (s) {
        return s.studentClass.toLowerCase() === cls.className.toLowerCase();
      });
      // Attach classId before writing
      const toCache = studentsForClass.map(function (s) {
        return {
          studentId:    s.studentId,
          fullName:     s.fullName,
          studentClass: s.studentClass,
          gender:       s.gender,
          actionFlag:   s.actionFlag,
          classId:      cls.classId
        };
      });
      SheetService.refreshStudentCache(cls.classId, toCache);
      totalCount += toCache.length;
    });

    const scope = classId === 'all'
      ? 'all classes'
      : (targetClasses[0] ? targetClasses[0].className : classId);

    return successResponse({
      count:   totalCount,
      message: 'Student cache refreshed for ' + scope + ': ' + totalCount + ' student(s).'
    });
  }

  /**
   * Get cached students for a specific class.
   * @param {string} token
   * @param {string} classId
   * @returns {{ success, data: Object[] }}
   */
  function getCachedStudents(token, classId) {
    const sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    if (!classId) return errorResponse('Class ID is required.', 'VALIDATION_ERROR');
    return successResponse(SheetService.getCachedStudents(classId));
  }

  return { refreshStudentCache, getCachedStudents };

})();
