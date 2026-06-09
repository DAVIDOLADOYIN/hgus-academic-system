/**
 * HGUS Academic Result Management System
 * StudentService.gs — Student cache management
 * Stage 6 update: uses the saved studentDataTab setting instead of auto-searching.
 *
 * Changes from Stage 2:
 *   - refreshStudentCache reads studentDataTab from Script Properties (saved
 *     when the Admin confirms the source in Session Settings).
 *   - If studentDataTab is not set, returns a clear error directing the Admin
 *     to run Sync Classes first (which saves the tab name on confirmation).
 *   - No silent auto-search: the wrong session's data can never be pulled.
 */

const StudentService = (function () {

  // ─── PUBLIC API ────────────────────────────────────────────────────────────

  /**
   * Refresh the student cache from the external spreadsheet.
   *
   * Uses the studentDataTab stored in Script Properties (saved when the Admin
   * confirms their source tab during Sync Classes or Refresh Students).
   * Pull-on-open calls (triggered silently when a teacher opens Score Entry)
   * also go through this function — they benefit from the pre-confirmed tab.
   *
   * @param {string} token
   * @param {string} classId — a specific Class ID, or 'all' to refresh every class
   * @returns {{ success, data: { count, message } }}
   */
  function refreshStudentCache(token, classId) {
    const sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    const settings = SheetService.getSessionSettings();

    // ── Validate external sheet ID ────────────────────────────────────────────
    if (!settings.externalSheetId) {
      return errorResponse(
        'External Sheet ID is not configured. Please enter it in Session Settings and save.',
        'CONFIG_ERROR'
      );
    }

    // ── Validate confirmed tab name ───────────────────────────────────────────
    // studentDataTab is saved when the Admin confirms the source during
    // Sync Classes or Refresh Students. If it is missing, the Admin has not
    // yet confirmed a source — direct them to do so rather than guessing.
    if (!settings.studentDataTab) {
      return errorResponse(
        'Student data source has not been confirmed yet. ' +
        'Please go to Session Settings → Data Sync → Refresh Student List ' +
        'and confirm the correct student data tab before refreshing.',
        'CONFIG_ERROR'
      );
    }

    // ── Open external spreadsheet ─────────────────────────────────────────────
    let extSS;
    try {
      extSS = SpreadsheetApp.openById(settings.externalSheetId.trim());
    } catch (e) {
      return errorResponse(
        'Could not open the external spreadsheet. Check the Sheet ID in Session Settings.',
        'EXTERNAL_SHEET_ERROR'
      );
    }

    // ── Locate the confirmed tab by exact name ────────────────────────────────
    const tabName   = settings.studentDataTab.trim();
    const dataSheet = extSS.getSheets().find(function (s) { return s.getName() === tabName; });
    if (!dataSheet) {
      return errorResponse(
        'Could not find the tab "' + tabName + '" in the external spreadsheet. ' +
        'It may have been renamed. Go to Session Settings → Data Sync and confirm the source again.',
        'EXTERNAL_SHEET_ERROR'
      );
    }

    // ── Read and validate headers ─────────────────────────────────────────────
    const data = dataSheet.getDataRange().getValues();
    if (data.length < 2) {
      return errorResponse('The tab "' + tabName + '" is empty.', 'EXTERNAL_SHEET_ERROR');
    }

    const headers       = data[0].map(function (h) { return String(h).trim().toLowerCase(); });
    const colStudentId  = headers.indexOf('student id');
    const colFullName   = headers.indexOf('full name');
    // Accept both "Student Class" and "Class" as the class column header
    const colClass      = headers.indexOf('student class') !== -1
                          ? headers.indexOf('student class')
                          : headers.indexOf('class');
    const colGender     = headers.indexOf('gender');
    const colActionFlag = headers.indexOf('action flag');

    if (colStudentId === -1 || colFullName === -1 || colClass === -1) {
      return errorResponse(
        'The tab "' + tabName + '" is missing required columns. ' +
        'Expected: "Student ID", "Full Name", "Student Class".',
        'EXTERNAL_SHEET_ERROR'
      );
    }

    // ── Build a map from className → classId ──────────────────────────────────
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
        if (!s.studentId || !s.fullName || !s.studentClass) return false;
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
      message: 'Student cache refreshed for ' + scope + ': ' + totalCount + ' student(s). Source: "' + tabName + '".'
    });
  }

  /**
   * Get cached students for a specific class.
   * @param {string} token
   * @param {string} classId
   */
  function getCachedStudents(token, classId) {
    const sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    if (!classId) return errorResponse('Class ID is required.', 'VALIDATION_ERROR');
    return successResponse(SheetService.getCachedStudents(classId));
  }

  return { refreshStudentCache, getCachedStudents };

})();
