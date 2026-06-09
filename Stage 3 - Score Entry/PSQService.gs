/**
 * HGUS Academic Result Management System
 * PSQService.gs — Psychomotor / Socio-emotional Qualities entry
 *
 * PSQ (Personal and Social Qualities) is filled in by the Form Master once
 * per student per term. It covers 16 traits rated on a scale of 1–5.
 *
 * Traits (from Config.gs PSQ_TRAITS):
 *   Physical Health, Punctuality, Reliability, Personal Neatness,
 *   Politeness, Honesty, Initiative, Neatness in Academic Work,
 *   Class Attendance, Class Participation, Self-Control,
 *   Spirit of Co-operation, Sense of Responsibility,
 *   Attitude to Study, Relationship with Peers, Relationship with Teachers
 *
 * IMPORTANT: Only the Form Master for a class can fill in PSQ.
 * Unlike scores, which are per-subject, PSQ is per-student per-class per-term.
 */

const PSQService = (function () {

  // ─── GET CLASS PSQ ────────────────────────────────────────────────────────

  /**
   * Get the PSQ data for an entire class in one call.
   *
   * Returns the student roster enriched with each student's existing
   * PSQ ratings (if any). The client renders one row per student with
   * 16 trait dropdowns pre-filled from the saved data.
   *
   * @param {string} token
   * @param {string} classId
   * @returns {{ success, data: { students, traitKeys, term, session } }}
   */
  function getClassPSQ(token, classId) {
    const sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    const settings      = SheetService.getSessionSettings();
    const activeSession = settings.activeSession;
    const activeTerm    = settings.activeTerm;

    if (!activeSession || !activeTerm) {
      return errorResponse('No active session/term configured.', 'NO_SESSION');
    }

    // Only the Form Master for this class can access PSQ
    const fmAssignment = SheetService.getFormMasterAssignment(classId, activeSession);
    if (!fmAssignment || String(fmAssignment.staffId) !== String(sess.staffId)) {
      return errorResponse('Only the Form Master for this class can manage PSQ data.', 'UNAUTHORISED');
    }

    // Students in this class
    const students = SheetService.getCachedStudents(classId);
    if (students.length === 0) {
      return errorResponse(
        'No students found for this class. Please refresh the student list from Session Settings.',
        'NO_STUDENTS'
      );
    }

    // All PSQ rows for this class/term/session (one read)
    const psqRows = SheetService.getAllClassPSQ(classId, activeTerm, activeSession);

    // Build a lookup: studentId → PSQ object
    const psqByStudent = {};
    psqRows.forEach(function (row) { psqByStudent[row.studentId] = row; });

    // Build the trait keys in camelCase (matching the sheet column names)
    // These are derived from PSQ_TRAITS by the same toCamelCase() function used in SheetService
    const traitKeys = PSQ_TRAITS.map(function (trait) {
      return {
        key:   toCamelCase(trait),   // camelCase key used in the data object
        label: trait                  // display label shown on screen
      };
    });

    // Enrich each student with their saved PSQ ratings
    const enrichedStudents = students.map(function (s) {
      const saved   = psqByStudent[s.studentId] || {};
      const ratings = {};

      traitKeys.forEach(function (t) {
        // Default to empty string if not yet rated
        ratings[t.key] = (saved[t.key] !== undefined && saved[t.key] !== '') ? saved[t.key] : '';
      });

      return {
        studentId: s.studentId,
        name:      s.fullName || s.studentName || s.name || s.studentId,
        ratings:   ratings
      };
    });

    return successResponse({
      classId:   classId,
      term:      activeTerm,
      session:   activeSession,
      traitKeys: traitKeys,
      students:  enrichedStudents
    });
  }

  // ─── SAVE PSQ ─────────────────────────────────────────────────────────────

  /**
   * Save PSQ ratings for a single student.
   *
   * WHY one student at a time (not batch)?
   *   The PSQ screen uses a "Save & Next" pattern — the Form Master fills in
   *   one student's ratings and taps Save to move to the next. The PSQ sheet
   *   is small (max ~30 rows per class per term) so reading it per save is
   *   not a performance concern.
   *
   * @param {string} token
   * @param {string} classId
   * @param {string} studentId
   * @param {{ [traitKey]: number }} ratings   Map of camelCase trait key → rating (1–5)
   * @returns {{ success, data: { message } }}
   */
  function savePSQ(token, classId, studentId, ratings) {
    const sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    const settings      = SheetService.getSessionSettings();
    const activeSession = settings.activeSession;
    const activeTerm    = settings.activeTerm;

    if (!activeSession || !activeTerm) {
      return errorResponse('No active session/term configured.', 'NO_SESSION');
    }

    // Only the Form Master for this class can save PSQ
    const fmAssignment = SheetService.getFormMasterAssignment(classId, activeSession);
    if (!fmAssignment || String(fmAssignment.staffId) !== String(sess.staffId)) {
      return errorResponse('Only the Form Master for this class can save PSQ data.', 'UNAUTHORISED');
    }

    if (!studentId) {
      return errorResponse('Student ID is required.', 'VALIDATION_ERROR');
    }

    if (!ratings || typeof ratings !== 'object') {
      return errorResponse('Ratings object is required.', 'VALIDATION_ERROR');
    }

    // Validate each provided rating — must be 1–5 or empty
    const invalidTraits = [];
    PSQ_TRAITS.forEach(function (trait) {
      const key = toCamelCase(trait);
      const val = ratings[key];
      if (val === '' || val === null || val === undefined) return; // empty is fine
      const n = Number(val);
      if (isNaN(n) || n < 1 || n > 5) {
        invalidTraits.push(trait + ' (value: ' + val + ')');
      }
    });

    if (invalidTraits.length > 0) {
      return errorResponse(
        'Invalid rating(s) — must be 1–5. Offending: ' + invalidTraits.join(', '),
        'VALIDATION_ERROR'
      );
    }

    // Build the PSQ data object to upsert
    const psqData = {
      studentId:         studentId,
      classId:           classId,
      term:              activeTerm,
      session:           activeSession,
      formMasterStaffId: sess.staffId,
      timestamp:         new Date().toISOString()
    };

    // Copy ratings into the data object (only valid trait keys)
    PSQ_TRAITS.forEach(function (trait) {
      const key = toCamelCase(trait);
      psqData[key] = (ratings[key] !== undefined && ratings[key] !== null) ? ratings[key] : '';
    });

    SheetService.upsertPSQ(psqData);

    return successResponse({ message: 'PSQ ratings saved for student ' + studentId + '.' });
  }

  return {
    getClassPSQ,
    savePSQ
  };

})();
