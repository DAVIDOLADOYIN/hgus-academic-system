/**
 * HGUS Academic Result Management System
 * OverviewService.gs — School-wide completion dashboard (Stage 6)
 *
 * Aggregates completion state for every class group in the school
 * (JSS 1 – SSS 3) for the currently active term and session.
 *
 * Used by the Admin Results Overview screen to show, at a glance,
 * which classes are ready for broadsheet and result generation.
 *
 * ─── HOW IT WORKS ────────────────────────────────────────────────────────────
 *
 *   1. Reads the full class list from SheetService.getAllClasses().
 *   2. Derives distinct group keys (e.g. "JSS 1", "SSS 2") using the same
 *      getGroupKey_() helper used throughout the system.
 *   3. Calls CompletionService.getClassGroupCompletion(token, groupKey) once
 *      per group, reusing all existing lock-check logic.
 *   4. Returns a flat array — one entry per group — with the broadsheetUnlocked /
 *      resultsUnlocked flags and the granular detail object for progress bars.
 *
 * ─── ACCESS ─────────────────────────────────────────────────────────────────
 *
 *   Admin / Super Admin only.  Teachers are not routed to this screen.
 *
 * PUBLIC FUNCTIONS:
 *   - getResultsOverview(token)
 *       Returns { session, term, groups: [ { groupKey, broadsheetUnlocked,
 *                resultsUnlocked, detail }, … ] } sorted in school order.
 */

const OverviewService = (function () {

  // ─── PRIVATE HELPERS ────────────────────────────────────────────────────────

  /**
   * Strip the SSS department suffix from a class name to get the group key.
   * Mirrors the identical helper in BroadsheetService, CompletionService, etc.
   *
   * "SSS 1 Science" → "SSS 1"
   * "JSS 3"         → "JSS 3"
   *
   * @param {string} className
   * @returns {string}
   */
  function getGroupKey_(className) {
    return String(className)
      .replace(/\s+(science|art|commerce|humanities|business)\s*$/i, '')
      .trim();
  }

  // ─── MAIN: GET RESULTS OVERVIEW ─────────────────────────────────────────────

  /**
   * Aggregate completion state for every class group.
   *
   * Returns one entry per distinct group key found in the Classes sheet.
   * Groups are sorted in canonical school order: JSS 1, JSS 2, JSS 3,
   * SSS 1, SSS 2, SSS 3. Any unexpected keys are appended alphabetically.
   *
   * The detail object on each entry is the same granular breakdown returned
   * by CompletionService — it can be used by the UI to render progress bars
   * (e.g. "126 / 180 score cells entered").
   *
   * ─── RETURN SHAPE ────────────────────────────────────────────────────────
   *
   *   {
   *     success: true,
   *     data: {
   *       session: '2025/2026',
   *       term:    'First Term',
   *       groups: [
   *         {
   *           groupKey:           'JSS 1',
   *           broadsheetUnlocked: false,
   *           resultsUnlocked:    false,
   *           detail: {
   *             activeStudentCount: 38,
   *             subjectCount:       18,
   *             scores:  { required: 4104, entered: 2160, complete: false },
   *             psq:     { studentsRequired: 38, studentsComplete: 0, complete: false },
   *             remarks: { studentsRequired: 38, studentsComplete: 0, complete: false }
   *           }
   *         },
   *         …  // one entry per group key
   *       ]
   *     }
   *   }
   *
   * @param {string} token — session token
   * @returns {{ success, data: { session, term, groups } }}
   */
  function getResultsOverview(token) {

    // ── Validate session and restrict to Admin ───────────────────────────────
    var sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    var isAdmin = [ROLES.ADMIN, ROLES.SUPER_ADMIN].indexOf(sess.role) !== -1;
    if (!isAdmin) {
      return errorResponse(
        'Results Overview is only available to Admin and Super Admin.',
        'UNAUTHORISED'
      );
    }

    // ── Check active session/term ────────────────────────────────────────────
    var settings      = SheetService.getSessionSettings();
    var activeSession = settings.activeSession;
    var activeTerm    = settings.activeTerm;

    if (!activeSession || !activeTerm) {
      return errorResponse('No active session/term configured.', 'NO_SESSION');
    }

    // ── Derive distinct group keys from the class list ───────────────────────
    var allClasses = SheetService.getAllClasses();
    if (allClasses.length === 0) {
      return errorResponse(
        'No classes found. Please sync classes from Session Settings first.',
        'NO_CLASSES'
      );
    }

    var seenKeys  = {};
    var groupKeys = [];
    allClasses.forEach(function (c) {
      var key = getGroupKey_(c.className);
      if (!seenKeys[key]) {
        seenKeys[key] = true;
        groupKeys.push(key);
      }
    });

    // Sort in canonical school order; unknown keys go at the end alphabetically
    var ORDER = ['JSS 1', 'JSS 2', 'JSS 3', 'SSS 1', 'SSS 2', 'SSS 3'];
    groupKeys.sort(function (a, b) {
      var ia = ORDER.indexOf(a);
      var ib = ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });

    // ── Fetch completion data for each group ─────────────────────────────────
    //
    // CompletionService.getClassGroupCompletion() re-validates the token on
    // each call. This is cheap (a PropertiesService cache lookup) and keeps
    // the services properly decoupled.

    var groups = groupKeys.map(function (key) {
      var result = CompletionService.getClassGroupCompletion(token, key);

      if (!result.success) {
        // If the completion check failed for this group (e.g. no subjects
        // assigned yet), return a safe "everything locked, zero counts" entry
        // rather than aborting the whole overview.
        return {
          groupKey:           key,
          broadsheetUnlocked: false,
          resultsUnlocked:    false,
          error:              result.error || 'Could not load data.',
          detail: {
            activeStudentCount: 0,
            subjectCount:       0,
            scores:  { required: 0, entered: 0, complete: false },
            psq:     { studentsRequired: 0, studentsComplete: 0, complete: false },
            remarks: { studentsRequired: 0, studentsComplete: 0, complete: false }
          }
        };
      }

      return {
        groupKey:           key,
        broadsheetUnlocked: result.data.broadsheetUnlocked,
        resultsUnlocked:    result.data.resultsUnlocked,
        detail:             result.data.detail
      };
    });

    return successResponse({
      session: activeSession,
      term:    activeTerm,
      groups:  groups
    });
  }

  // ─── PUBLIC API ─────────────────────────────────────────────────────────────

  return {
    getResultsOverview: getResultsOverview
  };

})();
