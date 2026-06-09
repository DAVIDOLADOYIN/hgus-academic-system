/**
 * HGUS Academic Result Management System
 * StatusService.gs — Student term status management
 *
 * Each student has a status for a given class/term/session:
 *
 *   Active          — default, participates in all assessments
 *   Exam Exempt     — sits CA tests but is excused from the Exam
 *   Not Continuing  — has left the school; excluded from all score entry
 *
 * The status determines:
 *   - Whether the student appears in score entry grids (Active + Exam Exempt)
 *   - Whether they count toward the Exam lock check (Active only)
 *   - Whether PSQ and Remarks are required (Active + Exam Exempt)
 *
 * IMPORTANT: Only the Form Master for a class can change student statuses.
 *
 * The Active status is the default and is NOT stored in the Student Term
 * Status sheet — only non-Active statuses are persisted. If a student has
 * no row in the sheet their status is implicitly Active. This keeps the
 * sheet small.
 */

const StatusService = (function () {

  // ─── GET CLASS STUDENT STATUS ──────────────────────────────────────────────

  /**
   * Get the term status for every student in a class.
   *
   * Returns each student from the cache, enriched with their current
   * status for the active term/session.
   *
   * @param {string} token
   * @param {string} classId
   * @returns {{ success, data: { students, statuses, term, session } }}
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

    // Only the Form Master for this class can manage statuses
    const fmAssignment = SheetService.getFormMasterAssignment(classId, activeSession);
    if (!fmAssignment || String(fmAssignment.staffId) !== String(sess.staffId)) {
      return errorResponse('Only the Form Master for this class can manage student statuses.', 'UNAUTHORISED');
    }

    const students  = SheetService.getCachedStudents(classId);
    const statusMap = SheetService.getClassTermStatuses(classId, activeTerm, activeSession);

    // Enrich each student with their status
    const enrichedStudents = students.map(function (s) {
      return {
        studentId:  s.studentId,
        name:       s.fullName || s.studentName || s.name || s.studentId,
        termStatus: statusMap[s.studentId] || STUDENT_STATUS.ACTIVE
      };
    });

    return successResponse({
      classId:         classId,
      term:            activeTerm,
      session:         activeSession,
      students:        enrichedStudents,
      allowedStatuses: Object.values(STUDENT_STATUS)
    });
  }

  // ─── SET STUDENT STATUS ────────────────────────────────────────────────────

  /**
   * Set or change the term status of a single student.
   *
   * STORAGE RULE: Only non-Active statuses are written to the sheet.
   * If status is Active, any existing row for this student is updated
   * back to Active (so the FM can reverse a previous status change).
   *
   * @param {string} token
   * @param {string} classId
   * @param {string} studentId
   * @param {string} status   — must be one of STUDENT_STATUS values
   * @returns {{ success, data: { studentId, status, message } }}
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

    // Only the Form Master for this class can set statuses
    const fmAssignment = SheetService.getFormMasterAssignment(classId, activeSession);
    if (!fmAssignment || String(fmAssignment.staffId) !== String(sess.staffId)) {
      return errorResponse('Only the Form Master for this class can set student statuses.', 'UNAUTHORISED');
    }

    if (!studentId) {
      return errorResponse('Student ID is required.', 'VALIDATION_ERROR');
    }

    // Validate status value
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

  return {
    getClassStudentStatus,
    setStudentStatus
  };

})();
