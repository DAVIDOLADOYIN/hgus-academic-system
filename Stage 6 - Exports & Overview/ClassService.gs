/**
 * HGUS Academic Result Management System
 * ClassService.gs — Class synchronisation from external student data sheet
 * Stage 6 update: smart student data source detection with confirmation flow.
 *
 * Changes from Stage 2:
 *   - Added getStudentDataSources(token) — lists all StudentData tabs in the
 *     external sheet and auto-detects the best match for the active session.
 *   - syncClasses now accepts an explicit tabName parameter so the UI can
 *     pass the admin-confirmed tab rather than relying on auto-search.
 *   - findStudentDataSheet_ updated: uses the explicit tab name directly;
 *     no silent first-match fallback.
 */

const ClassService = (function () {

  // ─── PUBLIC API ────────────────────────────────────────────────────────────

  /**
   * Discover all StudentData tabs in the external spreadsheet and auto-detect
   * the best match for the active academic session.
   *
   * Used by the UI to show a confirmation step before syncing so the Admin
   * can verify (or change) which tab will be used as the data source.
   *
   * Auto-detection logic:
   *   Active session "2025/2026" → short form "25/26"
   *   Looks for a tab whose name contains "25/26" AND "studentdata" (case-insensitive).
   *   If no session-specific match is found, detected is null — the UI will
   *   ask the Admin to pick manually rather than silently using the wrong tab.
   *
   * @param {string} token
   * @returns {{ success, data: { detected: string|null, all: string[] } }}
   */
  function getStudentDataSources(token) {
    const session = AuthService.validateToken(token);
    if (!session) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    if (![ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(session.role)) {
      return errorResponse('Unauthorised.', 'UNAUTHORISED');
    }

    const settings = SheetService.getSessionSettings();
    if (!settings.externalSheetId) {
      return errorResponse(
        'External Sheet ID is not configured. Please save it in Session Settings first.',
        'CONFIG_ERROR'
      );
    }

    // ── Open the external spreadsheet ────────────────────────────────────────
    let extSS;
    try {
      extSS = SpreadsheetApp.openById(settings.externalSheetId.trim());
    } catch (e) {
      return errorResponse(
        'Could not open the external spreadsheet. ' +
        'Check the Sheet ID in Session Settings and ensure this Google Account has view access.',
        'EXTERNAL_SHEET_ERROR'
      );
    }

    // ── Find all tabs whose name contains "StudentData" ───────────────────────
    const allTabs = extSS.getSheets()
      .map(function (s) { return s.getName(); })
      .filter(function (name) {
        const lower = name.toLowerCase();
        return lower.includes('studentdata') || lower.includes('student data');
      });

    if (allTabs.length === 0) {
      return errorResponse(
        'No tabs containing "StudentData" were found in the external spreadsheet. ' +
        'Tab names must include "StudentData" (e.g. "25/26 StudentData").',
        'EXTERNAL_SHEET_ERROR'
      );
    }

    // ── Auto-detect best match using the active session ───────────────────────
    // Convert "2025/2026" → "25/26" for matching against tab name prefixes.
    var detected = null;
    if (settings.activeSession) {
      var shortForm = sessionToShortForm_(settings.activeSession); // e.g. "25/26"
      if (shortForm) {
        detected = allTabs.find(function (name) {
          return name.toLowerCase().includes(shortForm.toLowerCase());
        }) || null;
      }
    }

    return successResponse({ detected: detected, all: allTabs });
  }

  /**
   * Sync classes from the external student data spreadsheet.
   *
   * Unlike Stage 2, this version requires the caller to pass the exact tab
   * name to use (tabName). The Admin confirms this via the UI before syncing.
   * If tabName is not provided the function returns an error — there is no
   * silent auto-search fallback that could pick the wrong session's data.
   *
   * @param {string} token
   * @param {string} externalSheetId — Google Spreadsheet ID
   * @param {string} tabName         — Exact tab name confirmed by the Admin
   * @returns {{ success, data: { created, skipped, total, classes } }}
   */
  function syncClasses(token, externalSheetId, tabName) {
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
    if (!tabName || !String(tabName).trim()) {
      return errorResponse(
        'No student data source selected. ' +
        'Please use the source confirmation step to choose which tab to sync from.',
        'VALIDATION_ERROR'
      );
    }

    const sheetId = String(externalSheetId).trim();
    const tabNameClean = String(tabName).trim();

    // ── Open the external spreadsheet ────────────────────────────────────────
    let extSS;
    try {
      extSS = SpreadsheetApp.openById(sheetId);
    } catch (e) {
      return errorResponse(
        'Could not open the external spreadsheet. ' +
        'Check the Sheet ID in Session Settings and ensure this Google Account has view access.',
        'EXTERNAL_SHEET_ERROR'
      );
    }

    // ── Locate the confirmed tab by exact name ────────────────────────────────
    const dataSheet = findTabByName_(extSS, tabNameClean);
    if (!dataSheet) {
      return errorResponse(
        'Could not find a tab named "' + tabNameClean + '" in the external spreadsheet. ' +
        'It may have been renamed. Please run the source detection step again.',
        'EXTERNAL_SHEET_ERROR'
      );
    }

    // ── Save confirmed tab name to Script Properties ──────────────────────────
    // This persists the selection so pull-on-open student cache refreshes
    // (which happen silently) know which tab to use without asking each time.
    SheetService.setSessionSettings({ studentDataTab: tabNameClean });

    // ── Read data and locate "Student Class" column ───────────────────────────
    const data = dataSheet.getDataRange().getValues();
    if (data.length < 2) {
      return errorResponse(
        'The tab "' + tabNameClean + '" appears to be empty.',
        'EXTERNAL_SHEET_ERROR'
      );
    }

    const headers     = data[0].map(function (h) { return String(h).trim().toLowerCase(); });
    const classColIdx = headers.findIndex(function (h) { return h === 'student class' || h === 'class'; });
    if (classColIdx === -1) {
      return errorResponse(
        'Could not find a "Student Class" column in "' + tabNameClean + '". ' +
        'The column header must be exactly "Student Class".',
        'EXTERNAL_SHEET_ERROR'
      );
    }

    // ── Collect unique JSS/SSS class names ────────────────────────────────────
    const uniqueNames = new Set();
    data.slice(1).forEach(function (row) {
      const name = String(row[classColIdx] || '').trim();
      if (name) uniqueNames.add(name);
    });

    const targetNames = Array.from(uniqueNames).filter(isJssOrSss_);
    if (targetNames.length === 0) {
      return errorResponse(
        'No JSS or SSS classes found in "' + tabNameClean + '". ' +
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
    const newIds      = existingIds.slice();

    let created = 0;
    let skipped = 0;

    targetNames.forEach(function (className) {
      if (existingByName[className.toLowerCase()]) { skipped++; return; }
      const parsed  = parseClassName_(className);
      const classId = generateId(CLASS_ID_PREFIX, newIds);
      newIds.push(classId);
      SheetService.createClass({ classId, className, section: parsed.section, department: parsed.department });
      existingByName[className.toLowerCase()] = { classId, className };
      created++;
    });

    const allClasses = SheetService.getAllClasses();
    return successResponse({
      created: created,
      skipped: skipped,
      total:   allClasses.length,
      classes: allClasses,
      message: created > 0
        ? created + ' class(es) added from "' + tabNameClean + '". ' + skipped + ' already existed.'
        : 'All classes already up to date (' + skipped + ' existing) — source: "' + tabNameClean + '".'
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
   * Find a tab in an external spreadsheet by its exact name.
   * Returns null if not found.
   *
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @param {string} tabName — exact tab name to find
   */
  function findTabByName_(ss, tabName) {
    return ss.getSheets().find(function (s) {
      return s.getName() === tabName;
    }) || null;
  }

  /**
   * Convert a full session string to its short two-digit form used as a tab
   * name prefix.
   *   "2025/2026" → "25/26"
   *   "2024/2025" → "24/25"
   * Returns null if the session format is not recognised.
   *
   * @param {string} session — e.g. "2025/2026"
   * @returns {string|null}
   */
  function sessionToShortForm_(session) {
    // Expect format "YYYY/YYYY"
    const parts = String(session).trim().split('/');
    if (parts.length !== 2) return null;
    const y1 = parts[0].trim(); // "2025"
    const y2 = parts[1].trim(); // "2026"
    if (y1.length < 2 || y2.length < 2) return null;
    return y1.slice(-2) + '/' + y2.slice(-2);  // "25/26"
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
   */
  function parseClassName_(name) {
    const up = name.toUpperCase();
    if (up.startsWith('JSS')) return { section: 'JSS', department: 'N/A' };
    if (up.startsWith('SSS')) {
      let dept = 'N/A';
      if (up.includes('ART'))      dept = 'Art';
      if (up.includes('COMMERCE')) dept = 'Commerce';
      if (up.includes('SCIENCE'))  dept = 'Science';
      return { section: 'SSS', department: dept };
    }
    return { section: 'Other', department: 'N/A' };
  }

  return { getStudentDataSources, syncClasses, getClasses };

})();
