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


// ═══════════════════════════════════════════════════════════════════════════
// STAGE 7 PATCH — New external sheet column structure
// ═══════════════════════════════════════════════════════════════════════════
//
// The external StudentData sheet now uses a different column layout:
//   - "Full Name" column no longer exists.
//   - Name is split into: "First Name / Middle Name" (col D) + "Last Name (Surname)" (col E).
//   - New columns available: "Date of Birth" (col K), "Parent / Guardian Contact" (col I).
//
// This IIFE replaces StudentService.refreshStudentCache with an updated version
// that handles the new structure. The Stage 6 original above is preserved verbatim
// per the Stage Inheritance Rule.
//
// HOW TO MODIFY:
//   - To change name format: edit the fullName construction line below.
//   - To add more cached fields: add the column lookup + include in the student object.
//   - To revert to old sheet format: delete this entire IIFE block.
// ═══════════════════════════════════════════════════════════════════════════

(function () {

  // Keep a reference to the original function in case it is needed for fallback.
  var _originalRefresh = StudentService.refreshStudentCache;

  /**
   * Replace refreshStudentCache to handle the new external sheet column structure.
   * All logic is identical to the Stage 6 version except:
   *   1. Name is built by concatenating "First Name / Middle Name" + "Last Name (Surname)".
   *   2. "Date of Birth" and "Parent / Guardian Contact" are read and stored in the cache.
   *   3. The required-column check is updated to match the new headers.
   */
  StudentService.refreshStudentCache = function (token, classId) {

    var sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    var settings = SheetService.getSessionSettings();

    // ── Validate external sheet ID ─────────────────────────────────────────
    if (!settings.externalSheetId) {
      return errorResponse(
        'External Sheet ID is not configured. Please enter it in Session Settings and save.',
        'CONFIG_ERROR'
      );
    }

    // ── Validate confirmed tab name ────────────────────────────────────────
    if (!settings.studentDataTab) {
      return errorResponse(
        'Student data source has not been confirmed yet. ' +
        'Please go to Session Settings → Data Sync → Refresh Student List ' +
        'and confirm the correct student data tab before refreshing.',
        'CONFIG_ERROR'
      );
    }

    // ── Open external spreadsheet ──────────────────────────────────────────
    var extSS;
    try {
      extSS = SpreadsheetApp.openById(settings.externalSheetId.trim());
    } catch (e) {
      return errorResponse(
        'Could not open the external spreadsheet. Check the Sheet ID in Session Settings.',
        'EXTERNAL_SHEET_ERROR'
      );
    }

    // ── Locate the confirmed tab ───────────────────────────────────────────
    var tabName   = settings.studentDataTab.trim();
    var dataSheet = extSS.getSheets().filter(function (s) {
      return s.getName() === tabName;
    })[0];
    if (!dataSheet) {
      return errorResponse(
        'Could not find the tab "' + tabName + '" in the external spreadsheet. ' +
        'It may have been renamed. Go to Session Settings → Data Sync and confirm the source again.',
        'EXTERNAL_SHEET_ERROR'
      );
    }

    // ── Read data ──────────────────────────────────────────────────────────
    var data = dataSheet.getDataRange().getValues();
    if (data.length < 2) {
      return errorResponse('The tab "' + tabName + '" is empty.', 'EXTERNAL_SHEET_ERROR');
    }

    // Normalise all header strings to lowercase for case-insensitive matching.
    var headers = data[0].map(function (h) { return String(h).trim().toLowerCase(); });

    // ── Column lookups — new structure ────────────────────────────────────
    var colStudentId  = headers.indexOf('student id');
    var colFirstName  = headers.indexOf('first name / middle name'); // col D in current sheet
    var colLastName   = headers.indexOf('last name (surname)');      // col E in current sheet
    // Accept both "Student Class" (old) and "Class" (new) as the class column.
    var colClass      = headers.indexOf('student class') !== -1
                        ? headers.indexOf('student class')
                        : headers.indexOf('class');
    var colGender       = headers.indexOf('gender');
    var colActionFlag   = headers.indexOf('action flag');
    var colDOB          = headers.indexOf('date of birth');              // col K — new
    var colParentPhone  = headers.indexOf('parent / guardian contact');  // col I — new

    // Required: Student ID + at least one name column + Class.
    // We support both old ("Full Name") and new (split name) layouts.
    var colFullName    = headers.indexOf('full name'); // will be -1 in new sheet
    var hasNewNameCols = colFirstName !== -1 && colLastName !== -1;
    var hasOldNameCol  = colFullName  !== -1;

    if (colStudentId === -1 || colClass === -1 || (!hasNewNameCols && !hasOldNameCol)) {
      return errorResponse(
        'The tab "' + tabName + '" is missing required columns. ' +
        'Expected: "Student ID", "Class" (or "Student Class"), and either ' +
        '"First Name / Middle Name" + "Last Name (Surname)" or "Full Name".',
        'EXTERNAL_SHEET_ERROR'
      );
    }

    // ── Ensure new cache columns exist in the Students Cache sheet ─────────
    // SheetService.ensureCacheStudentDataColumns() checks for Date of Birth
    // and Parent Contact columns and adds them if missing.
    try {
      SheetService.ensureCacheStudentDataColumns();
    } catch (e) {
      Logger.log('StudentService Stage 7 patch: ensureCacheStudentDataColumns failed: ' + e.message);
    }

    // ── Build className → class map ───────────────────────────────────────
    var allClasses  = SheetService.getAllClasses();
    var classByName = {};
    allClasses.forEach(function (c) {
      classByName[String(c.className).trim().toLowerCase()] = c;
    });

    // ── Parse all students from the external sheet ─────────────────────────
    var allStudents = data.slice(1).map(function (row) {

      // Build fullName: prefer new split columns, fall back to legacy Full Name.
      var fullName;
      if (hasNewNameCols) {
        var firstName = String(row[colFirstName] || '').trim(); // e.g. "David Obi"
        var lastName  = String(row[colLastName]  || '').trim(); // e.g. "Smith"
        // Format: First (+ Middle) Last — e.g. "David Obi Smith"
        fullName = (firstName + ' ' + lastName).trim();
      } else {
        fullName = String(row[colFullName] || '').trim();
      }

      return {
        studentId:     String(row[colStudentId]  || '').trim(),
        fullName:      fullName,
        studentClass:  String(row[colClass]       || '').trim(),
        gender:        colGender      >= 0 ? String(row[colGender]      || '').trim() : '',
        actionFlag:    colActionFlag  >= 0 ? String(row[colActionFlag]  || '').trim() : '',
        dateOfBirth:   colDOB         >= 0 ? String(row[colDOB]         || '').trim() : '',
        parentContact: colParentPhone >= 0 ? String(row[colParentPhone] || '').trim() : ''
      };
    }).filter(function (s) {
      // Drop rows missing the three required values.
      if (!s.studentId || !s.fullName || !s.studentClass) return false;
      // Only process JSS and SSS students.
      var up = s.studentClass.toUpperCase();
      return up.startsWith('JSS') || up.startsWith('SSS');
    });

    // ── Determine which classes to refresh ────────────────────────────────
    var targetClasses;
    if (classId === 'all') {
      targetClasses = allClasses;
    } else {
      var cls = allClasses.filter(function (c) { return c.classId === classId; })[0];
      if (!cls) return errorResponse('Class not found: ' + classId, 'NOT_FOUND');
      targetClasses = [cls];
    }

    // ── Write to cache class by class ─────────────────────────────────────
    var totalCount = 0;
    targetClasses.forEach(function (cls) {
      var studentsForClass = allStudents.filter(function (s) {
        return s.studentClass.toLowerCase() === cls.className.toLowerCase();
      });
      var toCache = studentsForClass.map(function (s) {
        return {
          studentId:     s.studentId,
          fullName:      s.fullName,
          studentClass:  s.studentClass,
          gender:        s.gender,
          actionFlag:    s.actionFlag,
          dateOfBirth:   s.dateOfBirth,
          parentContact: s.parentContact,
          classId:       cls.classId
        };
      });
      SheetService.refreshStudentCache(cls.classId, toCache);
      totalCount += toCache.length;

      // ── Keep the admin session alive during long refresh operations ────
      // Each class processed resets the 5-minute session TTL in CacheService.
      // Without this, refreshing all 12 classes could outlast the session
      // and force the admin to re-login immediately after the refresh ends.
      try {
        CacheService.getScriptCache().put(token, JSON.stringify(sess), 300);
      } catch (e) {
        Logger.log('StudentService: session touch failed for class ' + cls.classId + ': ' + e.message);
      }
    });

    var scope = classId === 'all'
      ? 'all classes'
      : (targetClasses[0] ? targetClasses[0].className : classId);

    return successResponse({
      count:   totalCount,
      message: 'Student cache refreshed for ' + scope + ': ' + totalCount + ' student(s). Source: "' + tabName + '".'
    });
  };

})();
