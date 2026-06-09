/**
 * HGUS Academic Result Management System
 * ScoreService.gs — Score entry business logic
 *
 * This service handles all score-related operations for Stage 3.
 *
 * KEY RULE — EXAM LOCK:
 *   The Exam component is locked (disabled) for a class/subject until
 *   EVERY student with status "Active" has a score entered for BOTH
 *   Test1 AND Test2. Students marked "Exam Exempt" or "Not Continuing"
 *   are excluded from this check.
 *
 * SCORE COMPONENTS (from Config.gs):
 *   C/W   — Classwork       max 6
 *   ASS   — Assignment      max 2
 *   ATT   — Attendance      max 2
 *   Test1 — 1st CA Test     max 10
 *   Test2 — 2nd CA Test     max 10
 *   Exam  — Examination     max 70
 *
 * Flow:
 *   Teacher Home → (tap FM class) → fmClassOverview
 *   Teacher Home → (tap TS assignment) → componentSelector
 *   componentSelector → scoreEntry
 */

const ScoreService = (function () {

  // ─── FORM MASTER CLASS OVERVIEW ───────────────────────────────────────────

  /**
   * Get overview data for a Form Master's class.
   *
   * Returns the student list with their current term status so the FM can:
   *   - See who is Active / Exam Exempt / Not Continuing
   *   - Navigate to PSQ entry, Remarks entry, and Manage Class status screens
   *   - Tap a subject to enter scores (if grantedFullAccess = true)
   *
   * Also returns the list of subjects assigned to the class so the FM (if
   * granted full access) can reach score entry for any subject.
   *
   * @param {string} token
   * @param {string} classId
   * @returns {{ success, data: { students, statuses, subjects, grantedFullAccess } }}
   */
  function getFMClassOverview(token, classId) {
    const sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    const settings      = SheetService.getSessionSettings();
    const activeSession = settings.activeSession;
    const activeTerm    = settings.activeTerm;

    if (!activeSession || !activeTerm) {
      return errorResponse('No active session/term configured.', 'NO_SESSION');
    }

    // Confirm the caller is actually the Form Master for this class
    const fmAssignment = SheetService.getFormMasterAssignment(classId, activeSession);
    if (!fmAssignment || String(fmAssignment.staffId) !== String(sess.staffId)) {
      return errorResponse('You are not the Form Master for this class.', 'UNAUTHORISED');
    }

    // Students in this class from the cache
    const students = SheetService.getCachedStudents(classId);

    // Current term statuses (returns a map: studentId → status)
    const statusMap = SheetService.getClassTermStatuses(classId, activeTerm, activeSession);

    // Enrich each student with their term status
    const enrichedStudents = students.map(function (s) {
      return Object.assign({}, s, {
        termStatus: statusMap[s.studentId] || STUDENT_STATUS.ACTIVE
      });
    });

    // Subjects assigned to this class this session (for score entry access)
    const classSubjects = SheetService.getClassSubjectAssignments(activeSession)
      .filter(function (csa) { return String(csa.classId) === String(classId); });

    const allSubjects  = SheetService.getAllSubjects();
    const subjectById  = {};
    allSubjects.forEach(function (s) { subjectById[s.subjectId] = s; });

    const subjects = classSubjects.map(function (csa) {
      return {
        subjectId:   csa.subjectId,
        subjectName: (subjectById[csa.subjectId] || {}).subjectName || csa.subjectId
      };
    });

    return successResponse({
      classId:           classId,
      className:         (SheetService.getAllClasses().find(function (c) {
                           return c.classId === classId;
                         }) || {}).className || classId,
      grantedFullAccess: toBoolean(fmAssignment.grantedFullAccess),
      students:          enrichedStudents,
      subjects:          subjects,
      term:              activeTerm,
      session:           activeSession
    });
  }

  // ─── COMPONENT STATUS ──────────────────────────────────────────────────────

  /**
   * Get the status of each score component for a class/subject.
   *
   * Returns one entry per component in COMPONENT_ORDER. Each entry includes:
   *   - component  — e.g. 'C/W', 'Test1', 'Exam'
   *   - label      — friendly name from SCORE_COMPONENTS
   *   - max        — maximum score
   *   - entered    — how many Active students have a score for this component
   *   - total      — how many Active students there are
   *   - locked     — true only for 'Exam' when the lock condition is not met
   *   - lockReason — human-readable explanation when locked
   *
   * LOCK RULE: Exam is locked until every Active student has both Test1 and
   * Test2 entered for this class/subject/term/session.
   *
   * @param {string} token
   * @param {string} classId
   * @param {string} subjectId
   * @returns {{ success, data: ComponentStatus[] }}
   */
  function getComponentStatuses(token, classId, subjectId) {
    const sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    // Verify access: must be FM for this class OR have a TS assignment
    if (!hasScoreAccess_(sess.staffId, classId, subjectId)) {
      return errorResponse('You are not authorised to enter scores for this class/subject.', 'UNAUTHORISED');
    }

    const settings      = SheetService.getSessionSettings();
    const activeSession = settings.activeSession;
    const activeTerm    = settings.activeTerm;

    if (!activeSession || !activeTerm) {
      return errorResponse('No active session/term configured.', 'NO_SESSION');
    }

    // Get the student roster and their statuses
    const students  = SheetService.getCachedStudents(classId);
    const statusMap = SheetService.getClassTermStatuses(classId, activeTerm, activeSession);

    // Only Active students count toward the totals and the Exam lock check
    const activeStudentIds = students
      .filter(function (s) {
        const st = statusMap[s.studentId] || STUDENT_STATUS.ACTIVE;
        return st === STUDENT_STATUS.ACTIVE;
      })
      .map(function (s) { return s.studentId; });

    const totalActive = activeStudentIds.length;

    // Load all scores for this class/subject/term/session in one read
    const scores = SheetService.getScores(classId, subjectId, activeTerm, activeSession);

    // Build a lookup: "studentId|component" → score
    const scoreLookup = {};
    scores.forEach(function (r) {
      scoreLookup[r.studentId + '|' + r.component] = r.score;
    });

    // Count how many Active students have each component entered
    function countEntered(componentKey) {
      return activeStudentIds.filter(function (sid) {
        const val = scoreLookup[sid + '|' + componentKey];
        return val !== undefined && val !== null && val !== '';
      }).length;
    }

    // Count how many Active students have each key component entered
    const test1Entered = countEntered(SCORE_COMPONENTS.TEST1.key);
    const test2Entered = countEntered(SCORE_COMPONENTS.TEST2.key);

    // LOCK RULE 1 — CA Test 2 is locked until every Active student has CA Test 1
    const test2Unlocked = (test1Entered >= totalActive && totalActive > 0);

    // LOCK RULE 2 — Examination is locked until every Active student has both
    //               CA Test 1 AND CA Test 2
    const examUnlocked  = (test1Entered >= totalActive &&
                           test2Entered >= totalActive &&
                           totalActive > 0);

    const statuses = COMPONENT_ORDER.map(function (compKey) {
      const def     = Object.values(SCORE_COMPONENTS).find(function (c) { return c.key === compKey; });
      const entered = countEntered(compKey);
      const isTest2 = (compKey === SCORE_COMPONENTS.TEST2.key);
      const isExam  = (compKey === SCORE_COMPONENTS.EXAM.key);

      // Determine lock state and compose a user-friendly reason message.
      // Reason text uses the same friendly names shown on the client tiles.
      let locked     = false;
      let lockReason = '';

      if (isTest2 && !test2Unlocked) {
        locked     = true;
        lockReason = 'CA Test 2 is locked until all ' + totalActive +
          ' active student(s) have CA Test 1 scores entered. (' +
          test1Entered + '/' + totalActive + ' entered)';

      } else if (isExam && !examUnlocked) {
        locked     = true;
        lockReason = 'Examination is locked until all ' + totalActive +
          ' active student(s) have CA Test 1 and CA Test 2 scores entered. (' +
          test1Entered + '/' + totalActive + ' CA Test 1, ' +
          test2Entered + '/' + totalActive + ' CA Test 2)';
      }

      return {
        component:  compKey,
        label:      def ? def.label : compKey,
        max:        def ? def.max : 0,
        entered:    entered,
        total:      totalActive,
        locked:     locked,
        lockReason: lockReason
      };
    });

    return successResponse({
      classId:   classId,
      subjectId: subjectId,
      term:      activeTerm,
      session:   activeSession,
      statuses:  statuses
    });
  }

  // ─── SCORE ENTRY ──────────────────────────────────────────────────────────

  /**
   * Get the student roster with existing scores for one component.
   *
   * Returns every student in the class with their current score for the
   * specified component, their term status, and their name — ready to
   * render the score entry grid.
   *
   * @param {string} token
   * @param {string} classId
   * @param {string} subjectId
   * @param {string} component   — e.g. 'C/W', 'Test1', 'Exam'
   * @returns {{ success, data: { students, component, max, locked } }}
   */
  function getScoresForComponent(token, classId, subjectId, component) {
    const sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    if (!hasScoreAccess_(sess.staffId, classId, subjectId)) {
      return errorResponse('You are not authorised to enter scores for this class/subject.', 'UNAUTHORISED');
    }

    const settings      = SheetService.getSessionSettings();
    const activeSession = settings.activeSession;
    const activeTerm    = settings.activeTerm;

    if (!activeSession || !activeTerm) {
      return errorResponse('No active session/term configured.', 'NO_SESSION');
    }

    // Get the component definition so we know the max score
    const compDef = Object.values(SCORE_COMPONENTS).find(function (c) { return c.key === component; });
    if (!compDef) return errorResponse('Unknown score component: ' + component, 'VALIDATION_ERROR');

    // Enforce component lock rules server-side so the rules hold even if
    // someone navigates directly to score entry without going through the UI.
    //
    // CA Test 2 — locked until all Active students have CA Test 1
    if (component === SCORE_COMPONENTS.TEST2.key) {
      const lockCheck = isTest2Locked_(classId, subjectId, activeTerm, activeSession);
      if (lockCheck.locked) {
        return errorResponse(lockCheck.reason, 'COMPONENT_LOCKED');
      }
    }
    // Examination — locked until all Active students have CA Test 1 AND CA Test 2
    if (component === SCORE_COMPONENTS.EXAM.key) {
      const lockCheck = isExamLocked_(classId, subjectId, activeTerm, activeSession);
      if (lockCheck.locked) {
        return errorResponse(lockCheck.reason, 'COMPONENT_LOCKED');
      }
    }

    const students  = SheetService.getCachedStudents(classId);
    const statusMap = SheetService.getClassTermStatuses(classId, activeTerm, activeSession);
    const scores    = SheetService.getScores(classId, subjectId, activeTerm, activeSession);

    // Build a lookup: studentId → score for this component
    const scoreLookup = {};
    scores
      .filter(function (r) { return String(r.component) === String(component); })
      .forEach(function (r) { scoreLookup[r.studentId] = r.score; });

    const roster = students.map(function (s) {
      return {
        studentId:  s.studentId,
        name:       s.fullName || s.studentName || s.name || s.studentId,
        termStatus: statusMap[s.studentId] || STUDENT_STATUS.ACTIVE,
        score:      scoreLookup[s.studentId] !== undefined ? scoreLookup[s.studentId] : ''
      };
    });

    return successResponse({
      classId:   classId,
      subjectId: subjectId,
      component: component,
      label:     compDef.label,
      max:       compDef.max,
      term:      activeTerm,
      session:   activeSession,
      roster:    roster
    });
  }

  /**
   * Save scores for a whole class (one component at a time).
   *
   * Validates every score before writing any. If any score is out of range,
   * returns an error listing which students had invalid scores.
   *
   * Uses SheetService.batchSaveComponentScores() for efficiency —
   * one sheet read regardless of class size.
   *
   * @param {string} token
   * @param {string} classId
   * @param {string} subjectId
   * @param {string} component         — e.g. 'C/W', 'Test1', 'Exam'
   * @param {{ studentId, score }[]} studentScores
   * @returns {{ success, data: { saved, message } }}
   */
  function saveScores(token, classId, subjectId, component, studentScores) {
    const sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    if (!hasScoreAccess_(sess.staffId, classId, subjectId)) {
      return errorResponse('You are not authorised to enter scores for this class/subject.', 'UNAUTHORISED');
    }

    const settings      = SheetService.getSessionSettings();
    const activeSession = settings.activeSession;
    const activeTerm    = settings.activeTerm;

    if (!activeSession || !activeTerm) {
      return errorResponse('No active session/term configured.', 'NO_SESSION');
    }

    // Validate the component
    const compDef = Object.values(SCORE_COMPONENTS).find(function (c) { return c.key === component; });
    if (!compDef) return errorResponse('Unknown score component: ' + component, 'VALIDATION_ERROR');

    // Enforce component lock rules before writing any scores
    if (component === SCORE_COMPONENTS.TEST2.key) {
      const lockCheck = isTest2Locked_(classId, subjectId, activeTerm, activeSession);
      if (lockCheck.locked) return errorResponse(lockCheck.reason, 'COMPONENT_LOCKED');
    }
    if (component === SCORE_COMPONENTS.EXAM.key) {
      const lockCheck = isExamLocked_(classId, subjectId, activeTerm, activeSession);
      if (lockCheck.locked) return errorResponse(lockCheck.reason, 'COMPONENT_LOCKED');
    }

    if (!Array.isArray(studentScores) || studentScores.length === 0) {
      return errorResponse('No scores provided.', 'VALIDATION_ERROR');
    }

    // Validate all scores before writing anything
    const invalidStudents = [];
    studentScores.forEach(function (s) {
      // Empty string is allowed (clears the score)
      if (s.score === '' || s.score === null || s.score === undefined) return;
      if (!isValidScore(component, s.score)) {
        invalidStudents.push(s.studentId + ' (score: ' + s.score + ', max: ' + compDef.max + ')');
      }
    });

    if (invalidStudents.length > 0) {
      return errorResponse(
        'Invalid score(s) — must be 0–' + compDef.max + '. Offending entries: ' +
        invalidStudents.join(', '),
        'VALIDATION_ERROR'
      );
    }

    // All valid — write in one efficient batch
    SheetService.batchSaveComponentScores(
      {
        classId:   classId,
        subjectId: subjectId,
        component: component,
        term:      activeTerm,
        session:   activeSession,
        staffId:   sess.staffId
      },
      studentScores
    );

    return successResponse({
      saved:   studentScores.length,
      message: studentScores.length + ' score(s) saved for ' + compDef.label + '.'
    });
  }

  // ─── PRIVATE HELPERS ───────────────────────────────────────────────────────

  /**
   * Check whether a staff member is authorised to enter scores for a
   * given class/subject combination.
   *
   * A teacher is authorised if EITHER of these is true:
   *   A. They have a Teacher-Subject assignment for this class + subject
   *      in the active term/session.
   *   B. They are the Form Master for this class AND they have been granted
   *      full-class score access (grantedFullAccess = true).
   *
   * @param {string} staffId
   * @param {string} classId
   * @param {string} subjectId
   * @returns {boolean}
   */
  function hasScoreAccess_(staffId, classId, subjectId) {
    const settings = SheetService.getSessionSettings();

    // Path A — direct Teacher-Subject assignment
    const tsAssignments = SheetService.getTeacherAssignmentsByStaff(
      staffId, settings.activeTerm, settings.activeSession
    );
    const hasDirect = tsAssignments.some(function (a) {
      return String(a.classId)   === String(classId) &&
             String(a.subjectId) === String(subjectId);
    });
    if (hasDirect) return true;

    // Path B — Form Master with full access
    const fmAssignment = SheetService.getFormMasterAssignment(classId, settings.activeSession);
    if (fmAssignment &&
        String(fmAssignment.staffId) === String(staffId) &&
        toBoolean(fmAssignment.grantedFullAccess)) {
      // Confirm this subject is actually assigned to the class
      const classSubjects = SheetService.getClassSubjectAssignments(settings.activeSession)
        .filter(function (csa) { return String(csa.classId) === String(classId); });
      return classSubjects.some(function (csa) {
        return String(csa.subjectId) === String(subjectId);
      });
    }

    return false;
  }

  /**
   * Check whether CA Test 2 is currently locked for a class/subject.
   *
   * CA Test 2 is locked when at least one Active student is missing a
   * CA Test 1 score for this class/subject/term/session.
   *
   * @returns {{ locked: boolean, reason: string }}
   */
  function isTest2Locked_(classId, subjectId, term, session) {
    const students  = SheetService.getCachedStudents(classId);
    const statusMap = SheetService.getClassTermStatuses(classId, term, session);
    const activeIds = students
      .filter(function (s) {
        return (statusMap[s.studentId] || STUDENT_STATUS.ACTIVE) === STUDENT_STATUS.ACTIVE;
      })
      .map(function (s) { return s.studentId; });

    if (activeIds.length === 0) {
      // No Active students — nothing to lock against
      return { locked: false, reason: '' };
    }

    const scores = SheetService.getScores(classId, subjectId, term, session);
    const scoreLookup = {};
    scores.forEach(function (r) {
      scoreLookup[r.studentId + '|' + r.component] = r.score;
    });

    let missingTest1 = 0;
    activeIds.forEach(function (sid) {
      const t1 = scoreLookup[sid + '|' + SCORE_COMPONENTS.TEST1.key];
      if (t1 === undefined || t1 === null || t1 === '') missingTest1++;
    });

    const locked = missingTest1 > 0;
    return {
      locked: locked,
      reason: locked
        ? 'CA Test 2 is locked until all ' + activeIds.length +
          ' active student(s) have CA Test 1 scores entered. (' +
          (activeIds.length - missingTest1) + '/' + activeIds.length + ' entered)'
        : ''
    };
  }

  /**
   * Check whether the Exam component is currently locked for a class/subject.
   *
   * The Exam is locked when at least one Active student is missing either
   * CA Test 1 or CA Test 2 for this class/subject/term/session.
   *
   * @returns {{ locked: boolean, reason: string }}
   */
  function isExamLocked_(classId, subjectId, term, session) {
    const students     = SheetService.getCachedStudents(classId);
    const statusMap    = SheetService.getClassTermStatuses(classId, term, session);
    const activeIds    = students
      .filter(function (s) {
        return (statusMap[s.studentId] || STUDENT_STATUS.ACTIVE) === STUDENT_STATUS.ACTIVE;
      })
      .map(function (s) { return s.studentId; });

    if (activeIds.length === 0) {
      // No active students — nothing to lock against
      return { locked: false, reason: '' };
    }

    const scores = SheetService.getScores(classId, subjectId, term, session);
    const scoreLookup = {};
    scores.forEach(function (r) {
      scoreLookup[r.studentId + '|' + r.component] = r.score;
    });

    let missingTest1 = 0;
    let missingTest2 = 0;
    activeIds.forEach(function (sid) {
      const t1 = scoreLookup[sid + '|' + SCORE_COMPONENTS.TEST1.key];
      const t2 = scoreLookup[sid + '|' + SCORE_COMPONENTS.TEST2.key];
      if (t1 === undefined || t1 === null || t1 === '') missingTest1++;
      if (t2 === undefined || t2 === null || t2 === '') missingTest2++;
    });

    const locked = missingTest1 > 0 || missingTest2 > 0;
    return {
      locked: locked,
      reason: locked
        ? 'Exam entry is locked. All ' + activeIds.length + ' active student(s) must have ' +
          'Test1 and Test2 entered first. Missing: ' +
          missingTest1 + ' Test1, ' + missingTest2 + ' Test2.'
        : ''
    };
  }

  return {
    getFMClassOverview,
    getComponentStatuses,
    getScoresForComponent,
    saveScores
  };

})();
