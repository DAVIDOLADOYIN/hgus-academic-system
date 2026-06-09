/**
 * HGUS Academic Result Management System
 * StatusService.gs — Student term status + name/gender correction management
 * Stage 6 update: adds student name and gender correction by Form Masters,
 * and correction reset by Admin/Super Admin.
 *
 * Changes from Stage 3:
 *   - getClassStudentStatus: Admin/Super Admin can now also access the list
 *     (to view and reset corrections). Previously FM-only.
 *   - getClassStudentStatus: response now includes hasCorrection, sourceFullName,
 *     sourceGender per student so the UI can show correction indicators.
 *   - NEW: updateStudentCorrection — FM saves a corrected name/gender.
 *   - NEW: clearStudentCorrection  — Admin resets a student back to source data.
 */

const StatusService = (function () {

  // ─── GET CLASS STUDENT STATUS ──────────────────────────────────────────────

  /**
   * Get every student in a class enriched with their term status and any
   * name/gender corrections.
   *
   * Access:
   *   - Form Master for this class (to manage statuses and corrections)
   *   - Admin / Super Admin (to view corrections and reset them)
   *
   * @param {string} token
   * @param {string} classId
   * @returns {{ success, data: { students, term, session } }}
   */
  function getClassStudentStatus(token, classId) {
    const sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    const settings      = SheetService.getSessionSettings();
    const activeSession = settings.activeSession;
    const activeTerm    = settings.activeTerm;

    if (!activeSession || !activeTerm) {
      return errorResponse('No active session/term configured.', 'NO_SESSION');
    }

    // ── Authorisation: FM for this class OR Admin/Super Admin ────────────────
    const isAdmin = [ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(sess.role);
    if (!isAdmin) {
      // For FM, verify they are assigned to this class
      const fmAssignment = SheetService.getFormMasterAssignment(classId, activeSession);
      if (!fmAssignment || String(fmAssignment.staffId) !== String(sess.staffId)) {
        return errorResponse(
          'Only the Form Master for this class can manage student statuses.',
          'UNAUTHORISED'
        );
      }
    }

    // getCachedStudents already applies corrections transparently AND includes
    // hasCorrection, sourceFullName, sourceGender fields — no extra work needed
    const students  = SheetService.getCachedStudents(classId);
    const statusMap = SheetService.getClassTermStatuses(classId, activeTerm, activeSession);

    const enrichedStudents = students.map(function (s) {
      return {
        studentId:      s.studentId,
        name:           s.fullName   || s.studentId,  // already corrected by getCachedStudents
        gender:         s.gender     || '',            // already corrected
        sourceFullName: s.sourceFullName || '',        // original source name
        sourceGender:   s.sourceGender   || '',        // original source gender
        hasCorrection:  !!s.hasCorrection,
        termStatus:     statusMap[s.studentId] || STUDENT_STATUS.ACTIVE
      };
    });

    return successResponse({
      classId:         classId,
      term:            activeTerm,
      session:         activeSession,
      students:        enrichedStudents,
      allowedStatuses: Object.values(STUDENT_STATUS),
      // Let the UI know whether the caller is an admin so it can show/hide
      // the reset correction button without a separate role check call
      callerIsAdmin:   isAdmin
    });
  }

  // ─── SET STUDENT STATUS ────────────────────────────────────────────────────

  /**
   * Set or change the term status of a single student.
   * Only the FM for the class can do this (unchanged from Stage 3).
   *
   * @param {string} token
   * @param {string} classId
   * @param {string} studentId
   * @param {string} status — must be one of STUDENT_STATUS values
   */
  function setStudentStatus(token, classId, studentId, status) {
    const sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    const settings      = SheetService.getSessionSettings();
    const activeSession = settings.activeSession;
    const activeTerm    = settings.activeTerm;

    if (!activeSession || !activeTerm) {
      return errorResponse('No active session/term configured.', 'NO_SESSION');
    }

    const fmAssignment = SheetService.getFormMasterAssignment(classId, activeSession);
    if (!fmAssignment || String(fmAssignment.staffId) !== String(sess.staffId)) {
      return errorResponse(
        'Only the Form Master for this class can set student statuses.',
        'UNAUTHORISED'
      );
    }

    if (!studentId) return errorResponse('Student ID is required.', 'VALIDATION_ERROR');

    const validStatuses = Object.values(STUDENT_STATUS);
    if (!validStatuses.includes(status)) {
      return errorResponse(
        'Invalid status "' + status + '". Must be one of: ' + validStatuses.join(', '),
        'VALIDATION_ERROR'
      );
    }

    SheetService.upsertStudentStatus({
      studentId: studentId,
      classId:   classId,
      term:      activeTerm,
      session:   activeSession,
      status:    status,
      setBy:     sess.staffId,
      timestamp: new Date().toISOString()
    });

    return successResponse({
      studentId: studentId,
      status:    status,
      message:   'Status updated to "' + status + '".'
    });
  }

  // ─── STUDENT NAME / GENDER CORRECTION ─────────────────────────────────────

  /**
   * Save a corrected name and/or gender for a student.
   *
   * Only the Form Master for this class can do this. The correction is stored
   * in the Students Cache sheet and survives future cache refreshes.
   *
   * Rules:
   *   - editedName and editedGender are validated to be non-empty strings
   *   - At least one of the two must be provided
   *   - The FM can correct both fields in one call
   *
   * @param {string} token
   * @param {string} classId    — used to verify FM assignment
   * @param {string} studentId
   * @param {string} editedName   — corrected full name (required)
   * @param {string} editedGender — corrected gender ('Male' | 'Female')
   * @returns {{ success, data: { studentId, message } }}
   */
  function updateStudentCorrection(token, classId, studentId, editedName, editedGender) {
    const sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    const settings = SheetService.getSessionSettings();

    // Only FM for this class can make corrections
    const fmAssignment = SheetService.getFormMasterAssignment(classId, settings.activeSession);
    if (!fmAssignment || String(fmAssignment.staffId) !== String(sess.staffId)) {
      return errorResponse(
        'Only the Form Master for this class can correct student details.',
        'UNAUTHORISED'
      );
    }

    const name   = editedName   ? String(editedName).trim()   : '';
    const gender = editedGender ? String(editedGender).trim() : '';

    if (!name && !gender) {
      return errorResponse(
        'Please provide a corrected name or gender (or both).',
        'VALIDATION_ERROR'
      );
    }
    if (!name) {
      return errorResponse('Student name cannot be blank.', 'VALIDATION_ERROR');
    }
    if (gender && !['Male', 'Female'].includes(gender)) {
      return errorResponse('Gender must be "Male" or "Female".', 'VALIDATION_ERROR');
    }

    SheetService.updateStudentCorrection(studentId, name, gender);

    return successResponse({
      studentId: studentId,
      message:   'Student record updated successfully.'
    });
  }

  /**
   * Clear all corrections for a student — reverts to the source data.
   *
   * Only Admin / Super Admin can do this. Used when the external registration
   * sheet has been fixed and the manual override is no longer needed.
   *
   * @param {string} token
   * @param {string} studentId
   * @returns {{ success, data: { studentId, message } }}
   */
  function clearStudentCorrection(token, studentId) {
    const sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    if (![ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(sess.role)) {
      return errorResponse(
        'Only Admin or Super Admin can reset student corrections.',
        'UNAUTHORISED'
      );
    }

    if (!studentId) return errorResponse('Student ID is required.', 'VALIDATION_ERROR');

    SheetService.clearStudentCorrection(studentId);

    return successResponse({
      studentId: studentId,
      message:   'Corrections cleared. Source data will be used.'
    });
  }

  return {
    getClassStudentStatus,
    setStudentStatus,
    updateStudentCorrection,
    clearStudentCorrection
  };

})();
