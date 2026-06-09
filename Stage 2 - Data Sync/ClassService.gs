/**
 * HGUS Academic Result Management System
 * ClassService.gs — Class synchronisation from external student data sheet
 *
 * Reads the external Google Sheet, extracts unique JSS/SSS class names
 * from the "Student Class" column, and writes them to the internal Classes sheet.
 *
 * The external spreadsheet must contain a tab whose name includes "StudentData"
 * (case-insensitive). That tab must have a "Student Class" column.
 *
 * The external sheet ID is stored in Script Properties (key: externalSheetId)
 * so it is saved across calls.
 */

const ClassService = (function () {

  // ─── PUBLIC API ────────────────────────────────────────────────────────────

  /**
   * Sync classes from the external student data spreadsheet.
   * Reads unique "Student Class" values, filters to JSS / SSS, and creates
   * rows in the Classes sheet for any class not already present.
   *
   * @param {string} token
   * @param {string} externalSheetId — Google Spreadsheet ID of the student data sheet
   * @returns {{ success, data: { created, skipped, total, classes } }}
   */
  function syncClasses(token, externalSheetId) {
    const session = AuthService.validateToken(token);
    if (!session) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    if (![ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(session.role)) {
      return errorResponse('Unauthorised.', 'UNAUTHORISED');
    }
    if (!externalSheetId || !String(externalSheetId).trim()) {
      return errorResponse(
        'Please enter the External Sheet ID in Session Settings before syncing classes.',
        'VALIDATION_ERROR'
      );
    }

    const sheetId = String(externalSheetId).trim();

    // ── Open the external spreadsheet ────────────────────────────────────────
    let extSS;
    try {
      extSS = SpreadsheetApp.openById(sheetId);
    } catch (e) {
      return errorResponse(
        'Could not open the external spreadsheet. ' +
        'Check the Sheet ID in Session Settings and ensure this Google Account has view access to it.',
        'EXTERNAL_SHEET_ERROR'
      );
    }

    // ── Locate the StudentData tab ────────────────────────────────────────────
    const dataSheet = findStudentDataSheet_(extSS);
    if (!dataSheet) {
      return errorResponse(
        'Could not find a tab containing "StudentData" in the external spreadsheet. ' +
        'Rename your student data tab so its name includes "StudentData".',
        'EXTERNAL_SHEET_ERROR'
      );
    }

    // ── Read data and locate "Student Class" column ───────────────────────────
    const data = dataSheet.getDataRange().getValues();
    if (data.length < 2) {
      return errorResponse('The StudentData tab appears to be empty.', 'EXTERNAL_SHEET_ERROR');
    }

    const headers    = data[0].map(h => String(h).trim().toLowerCase());
    const classColIdx = headers.findIndex(h => h === 'student class' || h === 'class');
    if (classColIdx === -1) {
      return errorResponse(
        'Could not find a "Student Class" column in the StudentData tab. ' +
        'The column header must be exactly "Student Class".',
        'EXTERNAL_SHEET_ERROR'
      );
    }

    // ── Collect unique class names ────────────────────────────────────────────
    const uniqueNames = new Set();
    data.slice(1).forEach(function (row) {
      const name = String(row[classColIdx] || '').trim();
      if (name) uniqueNames.add(name);
    });

    // Filter to JSS / SSS only
    const targetNames = Array.from(uniqueNames).filter(isJssOrSss_);

    if (targetNames.length === 0) {
      return errorResponse(
        'No JSS or SSS classes found in the StudentData tab. ' +
        'Class names must start with "JSS" or "SSS" (e.g. "JSS 1", "SSS 2 Science").',
        'NO_CLASSES_FOUND'
      );
    }

    // ── Compare against existing Classes sheet ────────────────────────────────
    const existingClasses = SheetService.getAllClasses();
    const existingByName  = {};
    existingClasses.forEach(function (c) {
      existingByName[String(c.className).trim().toLowerCase()] = c;
    });
    const existingIds = existingClasses.map(function (c) { return c.classId; });
    const newIds      = existingIds.slice(); // grows as we add

    let created = 0;
    let skipped = 0;

    targetNames.forEach(function (className) {
      if (existingByName[className.toLowerCase()]) {
        skipped++;
        return;
      }
      const parsed   = parseClassName_(className);
      const classId  = generateId(CLASS_ID_PREFIX, newIds);
      newIds.push(classId);

      SheetService.createClass({
        classId:    classId,
        className:  className,
        section:    parsed.section,
        department: parsed.department
      });
      existingByName[className.toLowerCase()] = { classId, className };
      created++;
    });

    const allClasses = SheetService.getAllClasses();
    return successResponse({
      created:  created,
      skipped:  skipped,
      total:    allClasses.length,
      classes:  allClasses,
      message:  created > 0
        ? created + ' class(es) added. ' + skipped + ' already existed.'
        : 'All classes already up to date (' + skipped + ' existing).'
    });
  }

  /**
   * Get all classes (any authenticated user).
   * @param {string} token
   */
  function getClasses(token) {
    const session = AuthService.validateToken(token);
    if (!session) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    return successResponse(SheetService.getAllClasses());
  }

  // ─── PRIVATE HELPERS ───────────────────────────────────────────────────────

  /**
   * Find the StudentData sheet in an external spreadsheet.
   * Matches any tab whose name contains "studentdata" (case-insensitive).
   */
  function findStudentDataSheet_(ss) {
    const sheets = ss.getSheets();
    return sheets.find(function (s) {
      return s.getName().toLowerCase().includes('studentdata') ||
             s.getName().toLowerCase().includes('student data');
    }) || null;
  }

  /** Returns true if the class name starts with JSS or SSS. */
  function isJssOrSss_(name) {
    const up = name.toUpperCase().trim();
    return up.startsWith('JSS') || up.startsWith('SSS');
  }

  /**
   * Derive section and department from a class name.
   * "JSS 1"          → { section: 'JSS', department: 'N/A' }
   * "SSS 2 Science"  → { section: 'SSS', department: 'Science' }
   * "SSS 3 Commerce" → { section: 'SSS', department: 'Commerce' }
   * "SSS 1 Art"      → { section: 'SSS', department: 'Art' }
   */
  function parseClassName_(name) {
    const up = name.toUpperCase();
    if (up.startsWith('JSS')) return { section: 'JSS', department: 'N/A' };
    if (up.startsWith('SSS')) {
      let dept = 'N/A';
      if (up.includes('ART'))       dept = 'Art';
      if (up.includes('COMMERCE'))  dept = 'Commerce';
      if (up.includes('SCIENCE'))   dept = 'Science';
      return { section: 'SSS', department: dept };
    }
    return { section: 'Other', department: 'N/A' };
  }

  return { syncClasses, getClasses };

})();
