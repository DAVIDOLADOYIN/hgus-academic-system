/**
 * HGUS Academic Result Management System
 * RemarkService.gs — Form Master's end-of-term remarks per student
 *
 * The Form Master writes a short text remark for each student in their class
 * once per term (e.g. "Excellent attitude, keep it up.").
 *
 * IMPORTANT: Only the Form Master for a class can manage remarks.
 * Remarks are per-student per-class per-term (not per-subject).
 */

const RemarkService = (function () {

  // ─── GET CLASS REMARKS ────────────────────────────────────────────────────

  /**
   * Get the remark data for an entire class in one call.
   *
   * Returns the full student roster enriched with each student's current
   * remark text. Students without a saved remark get an empty string.
   *
   * @param {string} token
   * @param {string} classId
   * @returns {{ success, data: { students, term, session } }}
   */
  function getClassRemarks(token, classId) {
    const sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    const settings      = SheetService.getSessionSettings();
    const activeSession = settings.activeSession;
    const activeTerm    = settings.activeTerm;

    if (!activeSession || !activeTerm) {
      return errorResponse('No active session/term configured.', 'NO_SESSION');
    }

    // Only the Form Master for this class can access remarks
    const fmAssignment = SheetService.getFormMasterAssignment(classId, activeSession);
    if (!fmAssignment || String(fmAssignment.staffId) !== String(sess.staffId)) {
      return errorResponse('Only the Form Master for this class can manage remarks.', 'UNAUTHORISED');
    }

    const students = SheetService.getCachedStudents(classId);
    if (students.length === 0) {
      return errorResponse(
        'No students found for this class. Please refresh the student list from Session Settings.',
        'NO_STUDENTS'
      );
    }

    // All remark rows for this class/term/session in one read
    const remarkRows = SheetService.getAllClassRemarks(classId, activeTerm, activeSession);

    // Build a lookup: studentId → remark text
    const remarkByStudent = {};
    remarkRows.forEach(function (row) {
      remarkByStudent[row.studentId] = row.remark || '';
    });

    // Enrich each student with their saved remark
    const enrichedStudents = students.map(function (s) {
      return {
        studentId: s.studentId,
        name:      s.fullName || s.studentName || s.name || s.studentId,
        remark:    remarkByStudent[s.studentId] || ''
      };
    });

    return successResponse({
      classId:  classId,
      term:     activeTerm,
      session:  activeSession,
      students: enrichedStudents
    });
  }

  // ─── SAVE REMARKS ─────────────────────────────────────────────────────────

  /**
   * Save remarks for one or more students in a class.
   *
   * WHY allow batch here (unlike PSQ)?
   *   Remarks are simple single-field text entries. The Form Master may
   *   want to write all remarks and then save them all at once. Each save
   *   is still an individual upsert in the sheet (no batch API available
   *   for arbitrary row updates), but we accept an array so the server
   *   call count is 1 instead of N.
   *
   * @param {string} token
   * @param {string} classId
   * @param {{ studentId, remark }[]} remarks   Array of { studentId, remark } objects
   * @returns {{ success, data: { saved, message } }}
   */
  function saveRemarks(token, classId, remarks) {
    const sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    const settings      = SheetService.getSessionSettings();
    const activeSession = settings.activeSession;
    const activeTerm    = settings.activeTerm;

    if (!activeSession || !activeTerm) {
      return errorResponse('No active session/term configured.', 'NO_SESSION');
    }

    // Only the Form Master for this class can save remarks
    const fmAssignment = SheetService.getFormMasterAssignment(classId, activeSession);
    if (!fmAssignment || String(fmAssignment.staffId) !== String(sess.staffId)) {
      return errorResponse('Only the Form Master for this class can save remarks.', 'UNAUTHORISED');
    }

    if (!Array.isArray(remarks) || remarks.length === 0) {
      return errorResponse('No remarks provided.', 'VALIDATION_ERROR');
    }

    // Validate: each entry must have a studentId; remark text can be empty
    const invalid = remarks.filter(function (r) { return !r.studentId; });
    if (invalid.length > 0) {
      return errorResponse('Each remark entry must include a studentId.', 'VALIDATION_ERROR');
    }

    const now = new Date().toISOString();
    remarks.forEach(function (r) {
      SheetService.upsertRemark({
        studentId:         r.studentId,
        classId:           classId,
        term:              activeTerm,
        session:           activeSession,
        remark:            r.remark || '',
        formMasterStaffId: sess.staffId,
        timestamp:         now
      });
    });

    return successResponse({
      saved:   remarks.length,
      message: remarks.length + ' remark(s) saved.'
    });
  }

  return {
    getClassRemarks,
    saveRemarks
  };

})();
