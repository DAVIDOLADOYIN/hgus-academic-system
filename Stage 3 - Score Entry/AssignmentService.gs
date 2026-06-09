/**
 * HGUS Academic Result Management System
 * AssignmentService.gs — Form Master and Teacher-Subject assignment management
 *
 * Stage 3 change: getMyAssignments() now returns separate fmClasses[] and
 * tsAssignments[] arrays instead of the mixed "assignments" array used in
 * Stage 2. This lets the Teacher Home screen render two distinct sections:
 *   - "My Form Class" — one card per FM class (with FM-specific actions)
 *   - "My Subject Assignments" — one card per teaching assignment
 *
 * All other functions (admin assignment management) are unchanged from Stage 2.
 */

const AssignmentService = (function () {

  // ─── FORM MASTER ASSIGNMENTS ───────────────────────────────────────────────

  /**
   * Get all Form Master assignments, enriched with class and staff names.
   * Admin and Super Admin only.
   *
   * @param {string} token
   * @returns {{ success, data: Object[] }}
   */
  function getFormMasterAssignments(token) {
    const sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    if (![ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(sess.role)) {
      return errorResponse('Unauthorised.', 'UNAUTHORISED');
    }

    const settings      = SheetService.getSessionSettings();
    const activeSession = settings.activeSession;

    const all = SheetService.getAllFormMasterAssignments()
      .filter(function (a) {
        return String(a.session) === String(activeSession) && toBoolean(a.isActive);
      });

    const enriched = enrichWithNames_(all);
    return successResponse(enriched);
  }

  /**
   * Set (or replace) the Form Master for a class.
   * Deactivates any existing active assignment for the class first.
   *
   * @param {string} token
   * @param {{ staffId, classId, grantedFullAccess }} data
   */
  function setFormMasterAssignment(token, data) {
    const sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    if (![ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(sess.role)) {
      return errorResponse('Unauthorised.', 'UNAUTHORISED');
    }

    const { staffId, classId, grantedFullAccess } = data || {};
    if (!staffId || !classId) {
      return errorResponse('Staff ID and Class ID are required.', 'VALIDATION_ERROR');
    }

    const staffMember = SheetService.getUserById(staffId);
    if (!staffMember) return errorResponse('Staff member not found.', 'NOT_FOUND');

    const settings      = SheetService.getSessionSettings();
    const activeSession = settings.activeSession;
    if (!activeSession) {
      return errorResponse('No active session set. Please configure Session Settings.', 'NO_SESSION');
    }

    // Deactivate any existing active assignment for this class/session
    const existing = SheetService.getAllFormMasterAssignments().filter(function (a) {
      return String(a.classId)  === String(classId) &&
             String(a.session)  === String(activeSession) &&
             toBoolean(a.isActive);
    });
    existing.forEach(function (a) {
      SheetService.deactivateFormMasterAssignment(a.assignmentId);
    });

    const allIds       = SheetService.getAllFormMasterAssignments().map(function (a) { return a.assignmentId; });
    const assignmentId = generateId(ASSIGNMENT_ID_PREFIX, allIds);

    SheetService.createFormMasterAssignment({
      assignmentId:      assignmentId,
      staffId:           staffId,
      classId:           classId,
      session:           activeSession,
      grantedFullAccess: toBoolean(grantedFullAccess) ? 'TRUE' : 'FALSE',
      activeFrom:        formatDate(new Date()),
      isActive:          'TRUE'
    });

    return successResponse({
      assignmentId: assignmentId,
      message: staffMember.name + ' assigned as Form Master.'
    });
  }

  /**
   * Remove (deactivate) the Form Master assignment for a class.
   * @param {string} token
   * @param {string} classId
   */
  function removeFormMasterAssignment(token, classId) {
    const sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    if (![ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(sess.role)) {
      return errorResponse('Unauthorised.', 'UNAUTHORISED');
    }

    const settings      = SheetService.getSessionSettings();
    const activeSession = settings.activeSession;

    const existing = SheetService.getAllFormMasterAssignments().filter(function (a) {
      return String(a.classId) === String(classId) &&
             String(a.session) === String(activeSession) &&
             toBoolean(a.isActive);
    });

    if (existing.length === 0) {
      return errorResponse('No active Form Master assignment found for this class.', 'NOT_FOUND');
    }

    existing.forEach(function (a) {
      SheetService.deactivateFormMasterAssignment(a.assignmentId);
    });

    return successResponse({ message: 'Form Master assignment removed.' });
  }

  // ─── TEACHER-SUBJECT ASSIGNMENTS ──────────────────────────────────────────

  /**
   * Get all Teacher-Subject assignments for the active term/session, enriched.
   * Admin and Super Admin only.
   *
   * @param {string} token
   */
  function getTeacherSubjectAssignments(token) {
    const sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    if (![ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(sess.role)) {
      return errorResponse('Unauthorised.', 'UNAUTHORISED');
    }

    const settings = SheetService.getSessionSettings();
    const all      = SheetService.getTeacherSubjectAssignments(
      settings.activeTerm,
      settings.activeSession
    );

    const enriched = enrichWithNames_(all);
    return successResponse(enriched);
  }

  /**
   * Add a Teacher-Subject assignment.
   * @param {string} token
   * @param {{ staffId, classId, subjectId, term, session }} data
   */
  function addTeacherSubjectAssignment(token, data) {
    const sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    if (![ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(sess.role)) {
      return errorResponse('Unauthorised.', 'UNAUTHORISED');
    }

    const { staffId, classId, subjectId, term } = data || {};
    if (!staffId || !classId || !subjectId || !term) {
      return errorResponse(
        'Staff ID, Class ID, Subject ID, and Term are all required.',
        'VALIDATION_ERROR'
      );
    }

    const settings      = SheetService.getSessionSettings();
    const activeSession = settings.activeSession;
    if (!activeSession) {
      return errorResponse('No active session set.', 'NO_SESSION');
    }

    if (!SheetService.getUserById(staffId))   return errorResponse('Staff member not found.', 'NOT_FOUND');
    if (!SheetService.getAllClasses().find(function (c) { return c.classId === classId; }))
      return errorResponse('Class not found.', 'NOT_FOUND');
    if (!SheetService.getAllSubjects().find(function (s) { return s.subjectId === subjectId; }))
      return errorResponse('Subject not found.', 'NOT_FOUND');

    const existing = SheetService.getTeacherSubjectAssignments(term, activeSession).find(function (a) {
      return String(a.staffId)   === String(staffId)  &&
             String(a.classId)   === String(classId)  &&
             String(a.subjectId) === String(subjectId);
    });
    if (existing) {
      return errorResponse('This teacher-subject assignment already exists.', 'DUPLICATE');
    }

    const allIds       = SheetService.getTeacherSubjectAssignments(term, activeSession)
      .map(function (a) { return a.assignmentId; });
    const assignmentId = generateId(ASSIGNMENT_ID_PREFIX, allIds);

    SheetService.createTeacherSubjectAssignment({
      assignmentId: assignmentId,
      staffId:      staffId,
      classId:      classId,
      subjectId:    subjectId,
      term:         term,
      session:      activeSession
    });

    return successResponse({
      assignmentId: assignmentId,
      message: 'Assignment created successfully.'
    });
  }

  /**
   * Remove a Teacher-Subject assignment row by Assignment ID.
   * @param {string} token
   * @param {string} assignmentId
   */
  function removeTeacherSubjectAssignment(token, assignmentId) {
    const sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    if (![ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(sess.role)) {
      return errorResponse('Unauthorised.', 'UNAUTHORISED');
    }
    if (!assignmentId) return errorResponse('Assignment ID required.', 'VALIDATION_ERROR');

    const deleted = SheetService.deleteRowWhere(
      SHEET_NAMES.TEACHER_SUBJECT_ASSIGNMENTS,
      'Assignment ID',
      assignmentId
    );
    if (!deleted) return errorResponse('Assignment not found.', 'NOT_FOUND');
    return successResponse({ message: 'Assignment removed.' });
  }

  // ─── TEACHER HOME — MY ASSIGNMENTS ────────────────────────────────────────

  /**
   * Get the assignments for the currently logged-in teacher/admin.
   *
   * STAGE 3 CHANGE — returns two separate, clearly named arrays:
   *
   *   fmClasses[]     — one entry per class where this person is Form Master.
   *                     Each entry: { assignmentId, classId, className,
   *                                   grantedFullAccess }
   *
   *   tsAssignments[] — one entry per teacher-subject assignment for the
   *                     active term/session. Each entry: { assignmentId,
   *                     classId, className, subjectId, subjectName,
   *                     term, session }
   *
   * This clean separation lets the Teacher Home screen render two distinct
   * sections without any client-side filtering logic.
   *
   * ADMIN NOTE: Admins can also be teachers (e.g. Vice Principal). If an
   * Admin has FM or TS assignments their Teacher Home tile will show. This
   * function works for any role.
   *
   * @param {string} token
   */
  function getMyAssignments(token) {
    const sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    const staffId       = sess.staffId;
    const settings      = SheetService.getSessionSettings();
    const activeSession = settings.activeSession;
    const activeTerm    = settings.activeTerm;

    if (!activeSession || !activeTerm) {
      return errorResponse(
        'The active session and term have not been configured. Please contact your administrator.',
        'NO_SESSION'
      );
    }

    // ── Look-up maps (read sheets once each) ───────────────────────────────
    const allClasses  = SheetService.getAllClasses();
    const allSubjects = SheetService.getAllSubjects();
    const classById   = {};
    allClasses.forEach(function (c)  { classById[c.classId]     = c; });
    const subjectById = {};
    allSubjects.forEach(function (s) { subjectById[s.subjectId] = s; });

    // ── Form Master classes ────────────────────────────────────────────────
    // Find all active FM assignments for this staff member in the active session.
    // studentCount is read from the Students Cache sheet so the Teacher Home
    // can show "Form Master · N students" without a separate server call.
    const fmClasses = SheetService.getFormMasterAssignmentsByStaff(staffId)
      .filter(function (a) { return String(a.session) === String(activeSession); })
      .map(function (a) {
        return {
          assignmentId:      a.assignmentId,
          classId:           a.classId,
          className:         (classById[a.classId] || {}).className || a.classId,
          grantedFullAccess: toBoolean(a.grantedFullAccess),
          // Pull live count from the student cache (populated by Data Sync → Refresh)
          studentCount:      SheetService.getCachedStudents(a.classId).length
        };
      });

    // ── Teacher-Subject assignments ────────────────────────────────────────
    // Each row in Teacher-Subject Assignments for this staff/term/session.
    const tsAssignments = SheetService.getTeacherAssignmentsByStaff(staffId, activeTerm, activeSession)
      .map(function (a) {
        return {
          assignmentId: a.assignmentId,
          classId:      a.classId,
          className:    (classById[a.classId]     || {}).className   || a.classId,
          subjectId:    a.subjectId,
          subjectName:  (subjectById[a.subjectId] || {}).subjectName || a.subjectId,
          term:         a.term,
          session:      a.session
        };
      });

    return successResponse({
      fmClasses:     fmClasses,
      tsAssignments: tsAssignments,
      session:       activeSession,
      term:          activeTerm
    });
  }

  // ─── PRIVATE HELPERS ───────────────────────────────────────────────────────

  /**
   * Enrich an array of assignment objects with className, subjectName, staffName.
   * Used only by admin-facing functions that need all three fields.
   */
  function enrichWithNames_(assignments) {
    const allClasses  = SheetService.getAllClasses();
    const allSubjects = SheetService.getAllSubjects();
    const allUsers    = SheetService.getAllUsers();

    const classById   = {};
    allClasses.forEach(function (c)  { classById[c.classId]     = c; });
    const subjectById = {};
    allSubjects.forEach(function (s) { subjectById[s.subjectId] = s; });
    const userById    = {};
    allUsers.forEach(function (u)    { userById[u.staffId]      = u; });

    return assignments.map(function (a) {
      return Object.assign({}, a, {
        className:   (classById[a.classId]     || {}).className   || a.classId,
        subjectName: (subjectById[a.subjectId] || {}).subjectName || a.subjectId,
        staffName:   (userById[a.staffId]      || {}).name        || a.staffId
      });
    });
  }

  return {
    getFormMasterAssignments,
    setFormMasterAssignment,
    removeFormMasterAssignment,
    getTeacherSubjectAssignments,
    addTeacherSubjectAssignment,
    removeTeacherSubjectAssignment,
    getMyAssignments
  };

})();
