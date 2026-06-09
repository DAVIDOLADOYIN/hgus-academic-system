/**
 * HGUS Academic Result Management System
 * SubjectService.gs — Subject sync and class-subject assignment
 *
 * Reads the Subjects Reference tab (already pre-populated in SetupService),
 * creates / verifies Subject sheet rows, and auto-assigns subjects to classes
 * in the Class-Subject Assignments sheet for the currently active session.
 *
 * Mapping rules (from PRD Section 2.3):
 *   JSS  General    → all JSS classes
 *   SSS  General    → all 9 SSS classes
 *   SSS  Science    → SSS *Science classes only
 *   SSS  Business   → SSS *Commerce classes only
 *   SSS  Humanities → SSS *Art classes only
 */

const SubjectService = (function () {

  // ─── PUBLIC API ────────────────────────────────────────────────────────────

  /**
   * Sync subjects from the internal Subjects Reference tab.
   * Creates Subject rows that don't exist yet, then creates Class-Subject
   * Assignments for the currently active session.
   *
   * Safe to run multiple times — existing subjects and assignments are skipped.
   *
   * @param {string} token
   * @returns {{ success, data: { subjectsCreated, assignmentsCreated, session, message } }}
   */
  function syncSubjects(token) {
    const sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    if (![ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(sess.role)) {
      return errorResponse('Unauthorised.', 'UNAUTHORISED');
    }

    const settings      = SheetService.getSessionSettings();
    const activeSession = settings.activeSession;
    if (!activeSession) {
      return errorResponse(
        'No active session is set. Please configure Session Settings first.',
        'NO_SESSION'
      );
    }

    // ── Read Subjects Reference tab ───────────────────────────────────────────
    const refData = SheetService.getSubjectsReference();
    if (!refData || refData.length === 0) {
      return errorResponse(
        'The Subjects Reference tab is empty. It should have been pre-populated by Setup.',
        'NO_DATA'
      );
    }

    // ── Load existing data ────────────────────────────────────────────────────
    const existingSubjects  = SheetService.getAllSubjects();
    const subjectByKey      = {};  // "SubjectName|Section" → subject object
    existingSubjects.forEach(function (s) {
      subjectByKey[s.subjectName + '|' + s.section] = s;
    });
    const subjectIds = existingSubjects.map(function (s) { return s.subjectId; });
    const newSubjectIds = subjectIds.slice();

    const allClasses = SheetService.getAllClasses();
    if (allClasses.length === 0) {
      return errorResponse(
        'No classes found. Please run Sync Classes first.',
        'NO_CLASSES'
      );
    }

    // Build a set of existing assignment keys for this session
    const existingAssignments = SheetService.getClassSubjectAssignments(activeSession);
    const assignmentKeySet    = new Set(
      existingAssignments.map(function (a) { return a.classId + '|' + a.subjectId; })
    );
    // IDs for generateId — we fetch fresh each time to avoid re-using IDs
    // from the same batch (we accumulate into newAssignmentIds as we go)
    const allAssignmentIds  = SheetService.getClassSubjectAssignments().map(function (a) { return a.assignmentId; });
    const newAssignmentIds  = allAssignmentIds.slice();

    let subjectsCreated    = 0;
    let assignmentsCreated = 0;

    // ── Process each subject from the reference tab ───────────────────────────
    refData.forEach(function (ref) {
      const key        = ref.subjectName + '|' + ref.section;
      const department = categoryToDepartment_(ref.category);

      // Create subject if not already in Subjects sheet
      let subject = subjectByKey[key];
      if (!subject) {
        const subjectId = generateId(SUBJECT_ID_PREFIX, newSubjectIds);
        newSubjectIds.push(subjectId);
        SheetService.createSubject({
          subjectId:   subjectId,
          subjectName: ref.subjectName,
          section:     ref.section,
          department:  department
        });
        subject = { subjectId, subjectName: ref.subjectName, section: ref.section, department };
        subjectByKey[key] = subject;
        subjectsCreated++;
      }

      // Determine which classes this subject applies to
      const targetClasses = getTargetClasses_(ref, allClasses);

      // Create class-subject assignments for classes not yet assigned
      targetClasses.forEach(function (cls) {
        const assignKey = cls.classId + '|' + subject.subjectId;
        if (assignmentKeySet.has(assignKey)) return;

        const assignmentId = generateId(ASSIGNMENT_ID_PREFIX, newAssignmentIds);
        newAssignmentIds.push(assignmentId);

        SheetService.createClassSubjectAssignment({
          assignmentId: assignmentId,
          classId:      cls.classId,
          subjectId:    subject.subjectId,
          session:      activeSession
        });
        assignmentKeySet.add(assignKey);
        assignmentsCreated++;
      });
    });

    const msg = [
      'Sync complete for session ' + activeSession + '.',
      subjectsCreated > 0
        ? subjectsCreated + ' subject(s) created.'
        : 'All subjects already exist.',
      assignmentsCreated > 0
        ? assignmentsCreated + ' class-subject assignment(s) created.'
        : 'All assignments already exist for this session.'
    ].join(' ');

    return successResponse({
      subjectsCreated:    subjectsCreated,
      assignmentsCreated: assignmentsCreated,
      session:            activeSession,
      message:            msg
    });
  }

  /**
   * Get all subjects.
   * @param {string} token
   */
  function getSubjects(token) {
    const sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    return successResponse(SheetService.getAllSubjects());
  }

  /**
   * Get class-subject assignments (optionally filtered to a session).
   * @param {string} token
   * @param {string} [sessionFilter]
   */
  function getClassSubjectAssignments(token, sessionFilter) {
    const sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    const assignments = SheetService.getClassSubjectAssignments(sessionFilter || null);
    return successResponse(assignments);
  }

  // ─── PRIVATE HELPERS ───────────────────────────────────────────────────────

  /**
   * Map Subjects Reference "Category" to the internal "Department" value
   * stored in the Subjects sheet and used for class matching.
   */
  function categoryToDepartment_(category) {
    const map = {
      'General':    'General',
      'Science':    'Science',
      'Business':   'Commerce',
      'Humanities': 'Art'
    };
    return map[category] || 'General';
  }

  /**
   * Return the subset of classes that a subject (identified by ref.section
   * and ref.category) should be assigned to.
   */
  function getTargetClasses_(ref, allClasses) {
    const section  = ref.section;
    const category = ref.category;

    if (section === 'JSS') {
      // All JSS classes
      return allClasses.filter(function (c) { return c.section === 'JSS'; });
    }

    if (section === 'SSS') {
      if (category === 'General') {
        return allClasses.filter(function (c) { return c.section === 'SSS'; });
      }
      if (category === 'Science') {
        return allClasses.filter(function (c) {
          return c.section === 'SSS' && c.department === 'Science';
        });
      }
      if (category === 'Business') {
        return allClasses.filter(function (c) {
          return c.section === 'SSS' && c.department === 'Commerce';
        });
      }
      if (category === 'Humanities') {
        return allClasses.filter(function (c) {
          return c.section === 'SSS' && c.department === 'Art';
        });
      }
    }

    return [];
  }

  return { syncSubjects, getSubjects, getClassSubjectAssignments };

})();
