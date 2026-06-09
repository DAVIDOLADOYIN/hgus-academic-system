/**
 * HGUS Academic Result Management System
 * CarryForwardService.gs — Assignment carry-forward for new term (Stage 6)
 *
 * When a new term begins, an Admin can carry forward existing Form Master
 * and Teacher-Subject assignments from the most recent prior period that
 * has data. This removes the need to manually re-enter every assignment
 * at the start of each new term.
 *
 * ─── HOW IT WORKS ────────────────────────────────────────────────────────────
 *
 *   1. getCarryForwardPreview(token)
 *      - Checks whether Teacher-Subject Assignments already exist for the
 *        currently active term/session. If they do, carry-forward is not
 *        needed and the function returns { needed: false }.
 *      - If no assignments exist yet, it walks backwards through up to
 *        6 prior periods (e.g. Second Term → First Term → prior Third Term …)
 *        until it finds a period that has assignment data.
 *      - Returns a preview object showing exactly what would be copied,
 *        so the Admin can review before confirming.
 *
 *   2. executeCarryForward(token)
 *      - Re-detects the source period independently (never trusts client
 *        state). This means a double-click or network retry cannot cause
 *        duplicate rows.
 *      - Copies Form Master Assignments (session-scoped) and Teacher-Subject
 *        Assignments (term+session-scoped) from the source period.
 *      - Skips any assignment that would be an exact duplicate in the target.
 *      - Generates a fresh unique ID for every new row.
 *      - Returns { fmCreated, fmSkipped, tsCreated, tsSkipped }.
 *
 * ─── PERIOD WALK-BACK ORDER ──────────────────────────────────────────────────
 *
 *   Terms cycle: First Term → Second Term → Third Term → (next session) First Term
 *   Walking backwards:
 *     Second Term 2025/2026 → First Term 2025/2026
 *     First Term  2025/2026 → Third Term 2024/2025
 *     Third Term  2024/2025 → Second Term 2024/2025
 *   Up to MAX_LOOKBACK attempts are made before giving up.
 *
 * ─── ACCESS ──────────────────────────────────────────────────────────────────
 *
 *   Admin / Super Admin only.  Teachers are never routed to this feature.
 *
 * PUBLIC FUNCTIONS:
 *   - getCarryForwardPreview(token)
 *       Returns { needed, fromTerm, fromSession,
 *                 formMasterAssignments: [], teacherAssignments: [] }
 *   - executeCarryForward(token)
 *       Returns { fmCreated, fmSkipped, tsCreated, tsSkipped }
 */

const CarryForwardService = (function () {

  // ─── CONSTANTS ──────────────────────────────────────────────────────────────

  /**
   * Terms in chronological order within a session.
   * Used to calculate which term comes "before" the current one.
   */
  var TERMS = ['First Term', 'Second Term', 'Third Term'];

  /**
   * Maximum number of prior periods to check before giving up.
   * 6 covers two full academic years (3 terms × 2 sessions).
   */
  var MAX_LOOKBACK = 6;

  // ─── PRIVATE HELPERS ────────────────────────────────────────────────────────

  /**
   * Given a term string and session string, return the immediately preceding
   * period as { term, session }.
   *
   * Examples:
   *   'Second Term', '2025/2026' → { term: 'First Term',  session: '2025/2026' }
   *   'First Term',  '2025/2026' → { term: 'Third Term',  session: '2024/2025' }
   *
   * @param {string} term
   * @param {string} session  e.g. '2025/2026'
   * @returns {{ term: string, session: string }}
   */
  function getPrevPeriod_(term, session) {
    var idx = TERMS.indexOf(term);

    // If the term is not in our list, treat it as index 0 so we still step back
    if (idx === -1) idx = 0;

    if (idx > 0) {
      // Same session, one term earlier
      return { term: TERMS[idx - 1], session: session };
    }

    // idx === 0 → 'First Term', so roll back to 'Third Term' of prior session
    var prevSession = decrementSession_(session);
    return { term: TERMS[TERMS.length - 1], session: prevSession };
  }

  /**
   * Decrement an academic session string by one year.
   *
   * '2025/2026' → '2024/2025'
   * '2024/2025' → '2023/2024'
   *
   * If the format is unrecognised, the original string is returned unchanged.
   *
   * @param {string} session
   * @returns {string}
   */
  function decrementSession_(session) {
    // Expect format "YYYY/YYYY" where second year = first year + 1
    var parts = String(session).split('/');
    if (parts.length !== 2) return session;

    var startYear = parseInt(parts[0], 10);
    var endYear   = parseInt(parts[1], 10);

    if (isNaN(startYear) || isNaN(endYear)) return session;

    return (startYear - 1) + '/' + (endYear - 1);
  }

  /**
   * Walk backwards from the period just before (activeTerm, activeSession)
   * and return the first period that has Teacher-Subject Assignment data.
   *
   * Returns null if no data is found within MAX_LOOKBACK attempts.
   *
   * @param {string} activeTerm
   * @param {string} activeSession
   * @returns {{ term: string, session: string } | null}
   */
  function findSourcePeriod_(activeTerm, activeSession) {
    var current = { term: activeTerm, session: activeSession };

    for (var i = 0; i < MAX_LOOKBACK; i++) {
      // Step one period back
      current = getPrevPeriod_(current.term, current.session);

      // Check if this period has any Teacher-Subject Assignments
      var assignments = SheetService.getTeacherSubjectAssignments(
        current.term,
        current.session
      );

      if (assignments && assignments.length > 0) {
        return current;  // Found a period with data
      }
    }

    return null;  // No data found in any of the prior periods checked
  }

  /**
   * Fetch all Form Master Assignments for a given session (any active status).
   * FM assignments are session-scoped (no term field), so we filter by session.
   *
   * @param {string} session
   * @returns {Object[]}
   */
  function getFMAssignmentsForSession_(session) {
    var all = SheetService.getAllFormMasterAssignments();
    return all.filter(function (a) {
      return String(a.session) === String(session) && toBoolean(a.isActive);
    });
  }

  // ─── PUBLIC: CARRY-FORWARD PREVIEW ──────────────────────────────────────────

  /**
   * Check whether assignment carry-forward is available and, if so, return
   * a preview of what would be copied.
   *
   * ─── RETURN SHAPE ────────────────────────────────────────────────────────
   *
   * If carry-forward is not needed (current term already has assignments):
   *   { success: true, data: { needed: false } }
   *
   * If carry-forward is needed but no source data exists:
   *   { success: true, data: { needed: true, fromTerm: null, fromSession: null,
   *                            formMasterAssignments: [], teacherAssignments: [] } }
   *
   * If carry-forward is available:
   *   { success: true, data: {
   *       needed:   true,
   *       fromTerm: 'Third Term',
   *       fromSession: '2024/2025',
   *       formMasterAssignments: [
   *         { staffId, classId, session, grantedFullAccess, isActive, … }
   *       ],
   *       teacherAssignments: [
   *         { staffId, classId, subjectId, term, session, … }
   *       ]
   *   }}
   *
   * @param {string} token
   * @returns {{ success, data }}
   */
  function getCarryForwardPreview(token) {

    // ── Validate session and restrict to Admin ───────────────────────────────
    var sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    var isAdmin = [ROLES.ADMIN, ROLES.SUPER_ADMIN].indexOf(sess.role) !== -1;
    if (!isAdmin) {
      return errorResponse(
        'Carry-forward is only available to Admin and Super Admin.',
        'UNAUTHORISED'
      );
    }

    // ── Read active term/session ─────────────────────────────────────────────
    var settings      = SheetService.getSessionSettings();
    var activeSession = settings.activeSession;
    var activeTerm    = settings.activeTerm;

    if (!activeSession || !activeTerm) {
      return errorResponse('No active session/term configured.', 'NO_SESSION');
    }

    // ── Check if current term already has assignments ────────────────────────
    //
    // If Teacher-Subject Assignments already exist for this term/session,
    // carry-forward is not needed. We guard here (not just in execute) so the
    // UI can hide the carry-forward card entirely in this case.

    var currentTS = SheetService.getTeacherSubjectAssignments(activeTerm, activeSession);

    if (currentTS && currentTS.length > 0) {
      return successResponse({ needed: false });
    }

    // ── Find the most recent prior period that has data ──────────────────────
    var sourcePeriod = findSourcePeriod_(activeTerm, activeSession);

    if (!sourcePeriod) {
      // No prior data found at all — this is probably the first term ever.
      return successResponse({
        needed:                 true,
        fromTerm:               null,
        fromSession:            null,
        formMasterAssignments:  [],
        teacherAssignments:     []
      });
    }

    // ── Fetch the assignments from the source period ─────────────────────────
    var sourceFM = getFMAssignmentsForSession_(sourcePeriod.session);
    var sourceTS = SheetService.getTeacherSubjectAssignments(
      sourcePeriod.term,
      sourcePeriod.session
    );

    return successResponse({
      needed:                true,
      fromTerm:              sourcePeriod.term,
      fromSession:           sourcePeriod.session,
      formMasterAssignments: sourceFM,
      teacherAssignments:    sourceTS
    });
  }

  // ─── PUBLIC: EXECUTE CARRY-FORWARD ──────────────────────────────────────────

  /**
   * Copy Form Master and Teacher-Subject assignments from the most recent
   * prior period into the currently active term/session.
   *
   * This function is idempotent: calling it twice will not create duplicates
   * because:
   *   - It re-checks whether the current term already has assignments before
   *     doing anything (guards against double-click / network retry).
   *   - It skips any individual row that already exists in the target.
   *
   * ─── RETURN SHAPE ────────────────────────────────────────────────────────
   *
   *   { success: true, data: {
   *       fmCreated:  <number>,   // Form Master rows written
   *       fmSkipped:  <number>,   // Form Master rows skipped (already exist)
   *       tsCreated:  <number>,   // Teacher-Subject rows written
   *       tsSkipped:  <number>    // Teacher-Subject rows skipped (already exist)
   *   }}
   *
   * @param {string} token
   * @returns {{ success, data }}
   */
  function executeCarryForward(token) {

    // ── Validate session and restrict to Admin ───────────────────────────────
    var sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    var isAdmin = [ROLES.ADMIN, ROLES.SUPER_ADMIN].indexOf(sess.role) !== -1;
    if (!isAdmin) {
      return errorResponse(
        'Carry-forward is only available to Admin and Super Admin.',
        'UNAUTHORISED'
      );
    }

    // ── Read active term/session ─────────────────────────────────────────────
    var settings      = SheetService.getSessionSettings();
    var activeSession = settings.activeSession;
    var activeTerm    = settings.activeTerm;

    if (!activeSession || !activeTerm) {
      return errorResponse('No active session/term configured.', 'NO_SESSION');
    }

    // ── Guard: abort if assignments already exist for this term ─────────────
    //
    // This is the primary idempotency check. If a previous call already
    // copied assignments, this stops a second call from creating duplicates.

    var currentTS = SheetService.getTeacherSubjectAssignments(activeTerm, activeSession);
    if (currentTS && currentTS.length > 0) {
      return errorResponse(
        'Assignments already exist for ' + activeTerm + ' ' + activeSession +
        '. Carry-forward is not needed.',
        'ALREADY_EXISTS'
      );
    }

    // ── Find source period ───────────────────────────────────────────────────
    var sourcePeriod = findSourcePeriod_(activeTerm, activeSession);

    if (!sourcePeriod) {
      return errorResponse(
        'No prior assignment data found. Please create assignments manually.',
        'NO_SOURCE_DATA'
      );
    }

    // ── Copy Form Master Assignments ─────────────────────────────────────────
    //
    // FM assignments are session-scoped (no term). We copy any active FM
    // assignment from the source session into the target session. If an FM
    // assignment for the same classId already exists in the target session
    // (e.g. it was created manually after the preview was shown), we skip it.

    var sourceFM  = getFMAssignmentsForSession_(sourcePeriod.session);
    var fmCreated = 0;
    var fmSkipped = 0;

    // Read all existing FM assignments once for duplicate checking
    var allExistingFM = SheetService.getAllFormMasterAssignments();

    // Build a lookup: classId → true for any active FM row in the target session
    var existingFMByClass = {};
    allExistingFM.forEach(function (a) {
      if (String(a.session) === String(activeSession) && toBoolean(a.isActive)) {
        existingFMByClass[String(a.classId)] = true;
      }
    });

    // Collect all current FM IDs so we can generate unique new IDs
    var allFMIds = allExistingFM.map(function (a) { return a.assignmentId; });

    sourceFM.forEach(function (src) {
      var classId = String(src.classId);

      if (existingFMByClass[classId]) {
        // An FM assignment already exists for this class in the target session
        fmSkipped++;
        return;
      }

      // Generate a new unique ID and write the row
      var newId = generateId(ASSIGNMENT_ID_PREFIX, allFMIds);
      allFMIds.push(newId);  // Keep the local list current so next ID is unique

      SheetService.createFormMasterAssignment({
        assignmentId:      newId,
        staffId:           src.staffId,
        classId:           classId,
        session:           activeSession,            // Target session
        grantedFullAccess: src.grantedFullAccess || 'FALSE',
        activeFrom:        formatDate(new Date()),   // Today as the start date
        isActive:          'TRUE'
      });

      existingFMByClass[classId] = true;  // Mark so we don't double-insert
      fmCreated++;
    });

    // ── Copy Teacher-Subject Assignments ─────────────────────────────────────
    //
    // TS assignments are term+session-scoped. We copy each one from the source
    // period into the active term/session. Duplicate check: skip if the same
    // (staffId, classId, subjectId) already exists in the target term/session.

    var sourceTS  = SheetService.getTeacherSubjectAssignments(
      sourcePeriod.term,
      sourcePeriod.session
    );
    var tsCreated = 0;
    var tsSkipped = 0;

    // Read all existing TS assignments for the target period for dedup
    var existingTargetTS = SheetService.getAllTeacherSubjectAssignmentsUnfiltered();

    // Build a set of keys: "staffId|classId|subjectId" for target term/session
    var existingTSKeys = {};
    existingTargetTS.forEach(function (a) {
      if (String(a.term)    === String(activeTerm) &&
          String(a.session) === String(activeSession)) {
        var key = a.staffId + '|' + a.classId + '|' + a.subjectId;
        existingTSKeys[key] = true;
      }
    });

    // Collect all TS IDs (across all terms/sessions) for unique ID generation
    var allTSIds = existingTargetTS.map(function (a) { return a.assignmentId; });

    sourceTS.forEach(function (src) {
      var key = src.staffId + '|' + src.classId + '|' + src.subjectId;

      if (existingTSKeys[key]) {
        // An identical assignment already exists in the target term/session
        tsSkipped++;
        return;
      }

      // Generate a new unique ID and write the row
      var newId = generateId(ASSIGNMENT_ID_PREFIX, allTSIds);
      allTSIds.push(newId);  // Keep local list current

      SheetService.createTeacherSubjectAssignment({
        assignmentId: newId,
        staffId:      src.staffId,
        classId:      src.classId,
        subjectId:    src.subjectId,
        term:         activeTerm,    // Target term
        session:      activeSession  // Target session
      });

      existingTSKeys[key] = true;  // Mark so we don't double-insert
      tsCreated++;
    });

    // ── Return summary ───────────────────────────────────────────────────────
    return successResponse({
      fmCreated: fmCreated,
      fmSkipped: fmSkipped,
      tsCreated: tsCreated,
      tsSkipped: tsSkipped
    });
  }

  // ─── PUBLIC API ─────────────────────────────────────────────────────────────

  return {
    getCarryForwardPreview: getCarryForwardPreview,
    executeCarryForward:    executeCarryForward
  };

})();
