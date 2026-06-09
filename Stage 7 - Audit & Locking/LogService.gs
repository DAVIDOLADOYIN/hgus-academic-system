/**
 * HGUS Academic Result Management System
 * LogService.gs — Two-Tier Audit Logging (Stage 7)
 *
 * ── OVERVIEW ────────────────────────────────────────────────────────────────
 *
 * TIER 1 — Activity Log (in-app visible)
 *   Sheet: "Activity Log"
 *   Columns: Timestamp | Staff ID | Staff Name | Role | Category | Action | Detail
 *   Who sees it: Super Admin (all categories). Admin (all except Auth) if
 *                the Super Admin has toggled "Allow Admins to view log".
 *   How to write: call LogService.logActivity(sess, category, action, detail)
 *
 * TIER 2 — Change Log (silent background trail, Google Sheets only)
 *   Sheet: "Change Log"
 *   Columns: Timestamp | Staff ID | Staff Name | Sheet | Student ID |
 *            Class ID | Subject ID | Term | Session | Field | Old Value | New Value
 *   Who sees it: Nobody in the app. Super Admin can filter the sheet directly
 *                in Google Sheets to reconstruct score changes after an incident.
 *   How to write: call LogService.logChange_(sheet, studentId, classId,
 *                                            subjectId, term, session,
 *                                            field, oldValue, newValue)
 *                 NOTE: logChange_ needs a session object for staff info.
 *                 Pass it as the first argument; see function signature below.
 *
 * ── DESIGN DECISIONS ────────────────────────────────────────────────────────
 *
 * - Both functions are fire-and-forget with try/catch: a logging failure
 *   must NEVER break the actual operation being logged.
 * - They append directly via SheetService.appendActivityLog / appendChangeLog
 *   so that all Sheets I/O stays in SheetService.
 * - logChange_ is intentionally suffixed with _ (private convention) because
 *   it should only be called from service-layer wrappers, not from the UI.
 *
 * ── HOW TO ADD NEW LOG EVENTS ────────────────────────────────────────────────
 *
 * 1. Pick or add a category in Config.gs → LOG_CATEGORIES.
 * 2. Call LogService.logActivity(sess, LOG_CATEGORIES.YOUR_CAT, 'Action', 'Detail')
 *    in the relevant service or Code.gs server function.
 * 3. The Activity Log sheet will show the new event immediately.
 */

const LogService = (function () {

  // ─── TIER 1: ACTIVITY LOG ─────────────────────────────────────────────────

  /**
   * Write one row to the Activity Log sheet.
   *
   * Call this after any significant admin/config action succeeds.
   * It is safe to call inside try/catch blocks — it will silently swallow
   * errors so the parent operation is never disrupted.
   *
   * @param {Object} sess     — validated session object from AuthService.validateToken()
   *                            Must have: staffId, name (or staffName), role
   * @param {string} category — one of LOG_CATEGORIES values (e.g. LOG_CATEGORIES.AUTH)
   * @param {string} action   — short verb phrase (e.g. 'Login success', 'Class locked')
   * @param {string} [detail] — optional extra detail (e.g. username, classId)
   */
  function logActivity(sess, category, action, detail) {
    try {
      if (!sess) return; // No session = nothing to attribute the log entry to

      SheetService.appendActivityLog({
        timestamp: new Date().toISOString(),
        staffId:   String(sess.staffId  || ''),
        staffName: String(sess.name     || sess.staffName || ''),
        role:      String(sess.role     || ''),
        category:  String(category      || ''),
        action:    String(action        || ''),
        detail:    String(detail        || '')
      });
    } catch (e) {
      // Silent fail — logging must never block the main operation
      Logger.log('LogService.logActivity error (non-fatal): ' + e.message);
    }
  }

  // ─── TIER 2: CHANGE LOG ───────────────────────────────────────────────────

  /**
   * Write one row to the Change Log sheet (before/after snapshot).
   *
   * Call this whenever a score, PSQ rating, or remark is saved and the
   * value has actually changed. Comparing old vs new before calling avoids
   * flooding the sheet with no-op saves.
   *
   * This function is private by convention (trailing _). It should only be
   * called from service wrappers (ScoreService Stage 7 wrapper, etc.).
   *
   * @param {Object} sess      — validated session object (for staff attribution)
   * @param {string} sheetName — which data sheet was changed (e.g. SHEET_NAMES.SCORES)
   * @param {string} studentId — student whose data changed
   * @param {string} classId
   * @param {string} subjectId — pass '' for changes not tied to a subject (e.g. Remarks)
   * @param {string} term
   * @param {string} session
   * @param {string} field     — what changed (e.g. component key 'Test1', 'Remark', etc.)
   * @param {*}      oldValue  — value before the change ('' if it was new)
   * @param {*}      newValue  — value after the change
   */
  function logChange_(sess, sheetName, studentId, classId, subjectId, term, session, field, oldValue, newValue) {
    try {
      SheetService.appendChangeLog({
        timestamp: new Date().toISOString(),
        staffId:   String(sess ? sess.staffId  || '' : ''),
        staffName: String(sess ? (sess.name || sess.staffName || '') : ''),
        sheet:     String(sheetName  || ''),
        studentId: String(studentId  || ''),
        classId:   String(classId    || ''),
        subjectId: String(subjectId  || ''),
        term:      String(term       || ''),
        session:   String(session    || ''),
        field:     String(field      || ''),
        oldValue:  String(oldValue !== undefined && oldValue !== null ? oldValue : ''),
        newValue:  String(newValue !== undefined && newValue !== null ? newValue : '')
      });
    } catch (e) {
      // Silent fail — change log must never break score saves
      Logger.log('LogService.logChange_ error (non-fatal): ' + e.message);
    }
  }

  // ─── ACTIVITY LOG QUERY ───────────────────────────────────────────────────

  /**
   * Read activity log entries, with optional filters.
   * Used by the in-app Activity Log screen.
   *
   * Access rules:
   *   - Super Admin: sees everything
   *   - Admin: sees everything EXCEPT LOG_CATEGORIES.AUTH entries
   *            (only if the Super Admin has enabled "Allow Admins to view log"
   *             in Script Properties: SA_PROP_ADMIN_CAN_VIEW_LOG = 'true')
   *   - Teacher: no access (return empty, caller enforces this)
   *
   * @param {Object} sess           — validated session object
   * @param {Object} [filters]      — optional filter object:
   *   filters.category  {string}   — filter to one category ('' = all)
   *   filters.staffId   {string}   — filter to one staff member ('' = all)
   *   filters.dateFrom  {string}   — ISO date string, inclusive ('' = no limit)
   *   filters.dateTo    {string}   — ISO date string, inclusive ('' = no limit)
   * @param {number} [limit=200]    — max rows to return (most recent first)
   *
   * @returns {{ entries: Object[], totalCount: number }}
   */
  function getActivityLog(sess, filters, limit) {
    var rows = SheetService.getAllActivityLog();

    // ── Role-based visibility filter ─────────────────────────────────────────
    if (sess.role === ROLES.ADMIN) {
      // Admins never see Auth category events (failed logins, password resets)
      rows = rows.filter(function (r) {
        return String(r.category) !== LOG_CATEGORIES.AUTH;
      });
    }

    // ── Optional client filters ───────────────────────────────────────────────
    if (filters) {
      if (filters.category) {
        rows = rows.filter(function (r) {
          return String(r.category) === String(filters.category);
        });
      }
      if (filters.staffId) {
        rows = rows.filter(function (r) {
          return String(r.staffId) === String(filters.staffId);
        });
      }
      if (filters.dateFrom) {
        var from = new Date(filters.dateFrom).getTime();
        rows = rows.filter(function (r) {
          return r.timestamp && new Date(r.timestamp).getTime() >= from;
        });
      }
      if (filters.dateTo) {
        // Include the whole day by moving to end-of-day
        var to = new Date(filters.dateTo);
        to.setHours(23, 59, 59, 999);
        var toMs = to.getTime();
        rows = rows.filter(function (r) {
          return r.timestamp && new Date(r.timestamp).getTime() <= toMs;
        });
      }
    }

    // ── Sort: most recent first ───────────────────────────────────────────────
    rows.sort(function (a, b) {
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    var totalCount = rows.length;
    var maxRows    = limit || 200;

    return {
      entries:    rows.slice(0, maxRows),
      totalCount: totalCount
    };
  }

  // ─── SUPER ADMIN SETTINGS ─────────────────────────────────────────────────

  /**
   * Read Super Admin preferences stored in ScriptProperties.
   * Currently only one setting: whether Admins can view the Activity Log.
   *
   * @returns {{ adminCanViewLog: boolean }}
   */
  function getSuperAdminSettings() {
    var props = PropertiesService.getScriptProperties();
    return {
      adminCanViewLog: props.getProperty(SA_PROP_ADMIN_CAN_VIEW_LOG) === 'true'
    };
  }

  /**
   * Save Super Admin preferences to ScriptProperties.
   *
   * @param {{ adminCanViewLog: boolean }} settings
   */
  function setSuperAdminSettings(settings) {
    var props = PropertiesService.getScriptProperties();
    if (settings.adminCanViewLog !== undefined) {
      props.setProperty(
        SA_PROP_ADMIN_CAN_VIEW_LOG,
        settings.adminCanViewLog ? 'true' : 'false'
      );
    }
  }

  // ─── PUBLIC API ───────────────────────────────────────────────────────────

  return {
    logActivity,           // Log a Tier 1 activity event
    logChange_,            // Log a Tier 2 before/after change snapshot
    getActivityLog,        // Query Activity Log with filters (in-app UI)
    getSuperAdminSettings, // Read Super Admin preferences
    setSuperAdminSettings  // Save Super Admin preferences
  };

})();
