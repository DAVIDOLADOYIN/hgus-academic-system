/**
 * HGUS Academic Result Management System
 * AssignmentService.gs — Form Master and Teacher-Subject assignment management
 *
 * Two types of assignments:
 *
 * 1. Form Master Assignments (one per class per session)
 *    - One active Form Master per class per session
 *    - Setting a new FM deactivates any existing active one for that class
 *    - Optional: Admin can grant a Form Master full-class score entry access
 *
 * 2. Teacher-Subject Assignments (many per term per session)
 *    - One or more teachers can be assigned to a subject within a class
 *    - Scoped by Term and Session
 *    - Can be added or removed by Admin
 *
 * getMyAssignments() is used by the teacher home screen (Stage 3) to build
 * the assignment list card view.
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

    // Get all active FM assignments for the current session
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

    // Verify the staff member exists
    const staffMember = SheetService.getUserById(staffId);
    if (!staffMember) return errorResponse('Staff member not found.', 'NOT_FOUND');

    const settings      = SheetService.getSessionSettings();
    const activeSession = settings.activeSession;
    if (!activeSession) {
      return errorResponse('No active session set. Please configure Session Settings.', 'NO_SESSION');
    }

    // Deactivate existing active assignment for this class/session
    const existing = SheetService.getAllFormMasterAssignments().filter(function (a) {
      return String(a.classId)  === String(classId) &&
             String(a.session)  === String(activeSession) &&
             toBoolean(a.isActive);
    });
    existing.forEach(function (a) {
      SheetService.deactivateFormMasterAssignment(a.assignmentId);
    });

    // Create the new assignment
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

    // Validate references
    if (!SheetService.getUserById(staffId))   return errorResponse('Staff member not found.', 'NOT_FOUND');
    if (!SheetService.getAllClasses().find(function (c) { return c.classId === classId; }))
      return errorResponse('Class not found.', 'NOT_FOUND');
    if (!SheetService.getAllSubjects().find(function (s) { return s.subjectId === subjectId; }))
      return errorResponse('Subject not found.', 'NOT_FOUND');

    // Duplicate check
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

  // ─── TEACHER HOME ──────────────────────────────────────────────────────────

  /**
   * Get the assignments for the currently logged-in teacher.
   * Returns their Teacher-Subject assignments plus Form Master info.
   * If they are a Form Master with full access, returns all subjects for their class.
   *
   * Used by the teacher home screen (Stage 3).
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

    // Teacher-Subject assignments for this staff member
    const tsAssignments = SheetService.getTeacherAssignmentsByStaff(staffId, activeTerm, activeSession);

    // Form Master assignment for this staff member (if any)
    const fmAssignments = SheetService.getFormMasterAssignmentsByStaff(staffId)
      .filter(function (a) { return String(a.session) === String(activeSession); });
    const fmAssignment = fmAssignments.length > 0 ? fmAssignments[0] : null;

    // Look-up maps
    const allClasses  = SheetService.getAllClasses();
    const allSubjects = SheetService.getAllSubjects();
    const classById   = {};
    allClasses.forEach(function (c)  { classById[c.classId]   = c; });
    const subjectById = {};
    allSubjects.forEach(function (s) { subjectById[s.subjectId] = s; });

    // Enrich Teacher-Subject assignments
    const enriched = tsAssignments.map(function (a) {
      return Object.assign({}, a, {
        className:   (classById[a.classId]   || {}).className   || a.classId,
        subjectName: (subjectById[a.subjectId] || {}).subjectName || a.subjectId
      });
    });

    // If FM with full access: add all subjects for their class not already in the list
    if (fmAssignment && toBoolean(fmAssignment.grantedFullAccess)) {
      const fmClass = classById[fmAssignment.classId] || {};
      const csAssignments = SheetService.getClassSubjectAssignments(activeSession)
        .filter(function (a) { return String(a.classId) === String(fmAssignment.classId); });

      csAssignments.forEach(function (csa) {
        const alreadyAssigned = enriched.some(function (a) {
          return String(a.subjectId) === String(csa.subjectId) &&
                 String(a.classId)   === String(csa.classId);
        });
        if (!alreadyAssigned) {
          enriched.push({
            assignmentId: 'FM_' + csa.assignmentId,
            staffId:      staffId,
            classId:      csa.classId,
            subjectId:    csa.subjectId,
            term:         activeTerm,
            session:      activeSession,
            className:    fmClass.className   || csa.classId,
            subjectName:  (subjectById[csa.subjectId] || {}).subjectName || csa.subjectId,
            viaFormMaster: true
          });
        }
      });
    }

    // Form Master context object
    let fmContext = null;
    if (fmAssignment) {
      const fmCls = classById[fmAssignment.classId] || {};
      fmContext = {
        assignmentId:      fmAssignment.assignmentId,
        classId:           fmAssignment.classId,
        className:         fmCls.className || fmAssignment.classId,
        grantedFullAccess: toBoolean(fmAssignment.grantedFullAccess)
      };
    }

    return successResponse({
      assignments:  enriched,
      isFormMaster: !!fmAssignment,
      formMaster:   fmContext,
      session:      activeSession,
      term:         activeTerm
    });
  }

  // ─── PRIVATE HELPERS ───────────────────────────────────────────────────────

  /**
   * Enrich an array of assignment objects with className, subjectName, staffName.
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
