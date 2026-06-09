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

    const compDef = Object.values(SCORE_COMPONENTS).find(function (c) { return c.key === component; });
    if (!compDef) return errorResponse('Unknown score component: ' + component, 'VALIDATION_ERROR');

    if (component === SCORE_COMPONENTS.TEST2.key) {
      const lockCheck = isTest2Locked_(classId, subjectId, activeTerm, activeSession);
      if (lockCheck.locked) {
        return errorResponse(lockCheck.reason, 'COMPONENT_LOCKED');
      }
    }
    if (component === SCORE_COMPONENTS.EXAM.key) {
      const lockCheck = isExamLocked_(classId, subjectId, activeTerm, activeSession);
      if (lockCheck.locked) {
        return errorResponse(lockCheck.reason, 'COMPONENT_LOCKED');
      }
    }

    const students  = SheetService.getCachedStudents(classId);
    const statusMap = SheetService.getClassTermStatuses(classId, activeTerm, activeSession);
    const scores    = SheetService.getScores(classId, subjectId, activeTerm, activeSession);

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
   * Stage 3 version: validates and saves via batchSaveComponentScores.
   * Stage 7 wrapper below adds: result-lock check + change logging.
   *
   * @param {string} token
   * @param {string} classId
   * @param {string} subjectId
   * @param {string} component
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

    const compDef = Object.values(SCORE_COMPONENTS).find(function (c) { return c.key === component; });
    if (!compDef) return errorResponse('Unknown score component: ' + component, 'VALIDATION_ERROR');

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

    const invalidStudents = [];
    studentScores.forEach(function (s) {
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

  function hasScoreAccess_(staffId, classId, subjectId) {
    const settings = SheetService.getSessionSettings();

    const tsAssignments = SheetService.getTeacherAssignmentsByStaff(
      staffId, settings.activeTerm, settings.activeSession
    );
    const hasDirect = tsAssignments.some(function (a) {
      return String(a.classId)   === String(classId) &&
             String(a.subjectId) === String(subjectId);
    });
    if (hasDirect) return true;

    const fmAssignment = SheetService.getFormMasterAssignment(classId, settings.activeSession);
    if (fmAssignment &&
        String(fmAssignment.staffId) === String(staffId) &&
        toBoolean(fmAssignment.grantedFullAccess)) {
      const classSubjects = SheetService.getClassSubjectAssignments(settings.activeSession)
        .filter(function (csa) { return String(csa.classId) === String(classId); });
      return classSubjects.some(function (csa) {
        return String(csa.subjectId) === String(subjectId);
      });
    }

    return false;
  }

  function isTest2Locked_(classId, subjectId, term, session) {
    const students  = SheetService.getCachedStudents(classId);
    const statusMap = SheetService.getClassTermStatuses(classId, term, session);
    const activeIds = students
      .filter(function (s) {
        return (statusMap[s.studentId] || STUDENT_STATUS.ACTIVE) === STUDENT_STATUS.ACTIVE;
      })
      .map(function (s) { return s.studentId; });

    if (activeIds.length === 0) return { locked: false, reason: '' };

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

  function isExamLocked_(classId, subjectId, term, session) {
    const students     = SheetService.getCachedStudents(classId);
    const statusMap    = SheetService.getClassTermStatuses(classId, term, session);
    const activeIds    = students
      .filter(function (s) {
        return (statusMap[s.studentId] || STUDENT_STATUS.ACTIVE) === STUDENT_STATUS.ACTIVE;
      })
      .map(function (s) { return s.studentId; });

    if (activeIds.length === 0) return { locked: false, reason: '' };

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

// ═══════════════════════════════════════════════════════════════════════════════
// STAGE 7 ADDITIONS — append-only, nothing above this line was changed
// ═══════════════════════════════════════════════════════════════════════════════
//
// WHY a wrapper instead of editing saveScores() above?
//   The Stage Inheritance Rule forbids modifying prior-stage code.
//   Wrapping ScoreService.saveScores via module augmentation lets us add:
//     1. Result-lock check  (LockService.isLocked)
//     2. Before/after change logging  (LogService.logChange_)
//   … without touching Stage 3.
//
// HOW IT WORKS:
//   We capture the original saveScores, then replace it on the ScoreService
//   object with a new function that runs the lock check first, calls the
//   original, and logs any actual score changes on success.
//
// NOTE ON AUTH:
//   The original saveScores already validates the session (AuthService.validateToken).
//   The wrapper calls validateToken again only to get the sess object for
//   logging. The second call hits the CacheService (fast, < 10ms).
//   If the session expired between the two calls the original will return
//   SESSION_EXPIRED and the wrapper propagates it correctly.

(function () {
  // Capture the Stage 3 saveScores before we replace it
  var _originalSaveScores = ScoreService.saveScores;

  /**
   * Stage 7 wrapper around ScoreService.saveScores.
   *
   * Added behaviours (in order):
   *   1. Result-Lock check   — rejects save if Admin has locked this class-term.
   *   2. Before snapshot     — reads current scores so we can detect what changed.
   *   3. Delegate to Stage 3 — calls the original for all validation + writes.
   *   4. Change log          — logs only the values that actually changed.
   */
  ScoreService.saveScores = function (token, classId, subjectId, component, studentScores) {

    // ── 1. Validate session (needed for logging; original validates again inside) ──
    var sess     = AuthService.validateToken(token);
    // Don't abort here if sess is null — the original will return SESSION_EXPIRED
    // cleanly, and we don't want to log a change for an expired session.

    // ── 2. Result-Lock check ────────────────────────────────────────────────────
    if (sess) {
      var settings   = SheetService.getSessionSettings();
      var activeTerm = settings.activeTerm;
      var activeSession = settings.activeSession;

      if (activeTerm && activeSession) {
        var locked = LockService.isLocked(classId, activeTerm, activeSession);
        if (locked) {
          return errorResponse(
            'This class is locked for ' + activeTerm + '. Contact an Admin to unlock before saving scores.',
            'RESULT_LOCKED'
          );
        }
      }
    }

    // ── 3. Before snapshot — read existing scores to detect changes later ───────
    // Only read if we have a session (otherwise we won't be logging anyway).
    var beforeMap = {};
    if (sess && Array.isArray(studentScores) && studentScores.length > 0) {
      try {
        var existing = SheetService.getScores(
          classId, subjectId,
          settings.activeTerm, settings.activeSession
        );
        existing.forEach(function (r) {
          if (String(r.component) === String(component)) {
            beforeMap[r.studentId] = r.score;
          }
        });
      } catch (e) {
        // Non-fatal: if we can't read existing scores we skip change logging
        Logger.log('ScoreService Stage 7 wrapper: before-snapshot failed (non-fatal): ' + e.message);
      }
    }

    // ── 4. Call the original Stage 3 saveScores ──────────────────────────────────
    var result = _originalSaveScores(token, classId, subjectId, component, studentScores);

    // ── 5. Change log — only if save succeeded and we have a session ─────────────
    if (result && result.success && sess && Array.isArray(studentScores)) {
      studentScores.forEach(function (s) {
        var oldVal = beforeMap[s.studentId];
        var newVal = s.score;

        // Only log if the value actually changed (avoids no-op save spam)
        var oldStr = String(oldVal !== undefined && oldVal !== null ? oldVal : '');
        var newStr = String(newVal !== undefined && newVal !== null ? newVal : '');

        if (oldStr !== newStr) {
          LogService.logChange_(
            sess,
            SHEET_NAMES.SCORES,
            s.studentId,
            classId,
            subjectId,
            settings.activeTerm,
            settings.activeSession,
            component,   // field = score component key (e.g. 'Test1')
            oldStr,
            newStr
          );
        }
      });
    }

    return result;
  };

})();

// ─── STAGE 7: PSQ CHANGE LOG WRAPPER ─────────────────────────────────────────
//
// Augments PSQService.savePSQ without modifying the original PSQ service file.
// Pattern mirrors the ScoreService.saveScores wrapper above:
//   1. Snapshot existing PSQ ratings for the student before saving
//   2. Call the original savePSQ
//   3. Write one Change Log row per trait that actually changed
//
// Change Log fields used:
//   Sheet      = 'PSQ'
//   Subject ID = '' (PSQ is class-level, not subject-level)
//   Field      = trait name (e.g. 'Handwriting', 'Neatness')
//   Old/New    = numeric rating (empty string if not previously set)
// ─────────────────────────────────────────────────────────────────────────────

(function () {

  // Guard: PSQService must exist before we can wrap it
  if (typeof PSQService === 'undefined' || typeof PSQService.savePSQ !== 'function') {
    Logger.log('ScoreService Stage 7: PSQService.savePSQ not found — PSQ Change Log wrapper skipped.');
    return;
  }

  var _originalSavePSQ = PSQService.savePSQ;

  PSQService.savePSQ = function (token, classId, studentId, ratings) {

    // Validate session — needed to build the log entry
    var sess = null;
    try { sess = AuthService.validateToken(token); } catch (e) { /* non-fatal */ }

    // ── 1. Before snapshot — read existing PSQ for this student ─────────────────
    var beforeRatings = {};
    if (sess) {
      try {
        var existing = PSQService.getClassPSQ(token, classId);
        if (existing && existing.success) {
          // getClassPSQ returns { data: { students: [ { studentId, ratings: {...} } ] } }
          var students = (existing.data && existing.data.students) ? existing.data.students : [];
          var row = students.find(function (s) {
            return String(s.studentId) === String(studentId);
          });
          if (row && row.ratings && typeof row.ratings === 'object') {
            beforeRatings = row.ratings;
          }
        }
      } catch (e) {
        Logger.log('PSQ Stage 7 wrapper: before-snapshot failed (non-fatal): ' + e.message);
      }
    }

    // ── 2. Call the original savePSQ ─────────────────────────────────────────────
    var result = _originalSavePSQ(token, classId, studentId, ratings);

    // ── 3. Change log — one row per trait that actually changed ──────────────────
    if (result && result.success && sess && ratings && typeof ratings === 'object') {
      var settings = SheetService.getSessionSettings();

      Object.keys(ratings).forEach(function (trait) {
        var oldStr = String(
          beforeRatings[trait] !== undefined && beforeRatings[trait] !== null
            ? beforeRatings[trait] : ''
        );
        var newStr = String(
          ratings[trait] !== undefined && ratings[trait] !== null
            ? ratings[trait] : ''
        );

        if (oldStr !== newStr) {
          LogService.logChange_(
            sess,
            'PSQ',          // sheet name
            studentId,
            classId,
            '',             // no subject ID — PSQ is class-level
            settings.activeTerm,
            settings.activeSession,
            trait,          // field = trait name (e.g. 'Handwriting')
            oldStr,
            newStr
          );
        }
      });
    }

    return result;
  };

})();


// ─── STAGE 7: REMARKS CHANGE LOG WRAPPER ──────────────────────────────────────
//
// Augments RemarkService.saveRemarks without modifying the original file.
// saveRemarks receives an array of { studentId, formMasterRemark, headTeacherRemark }
// objects — one per student. We snapshot the class remarks before saving and
// write one Change Log row per remark field that actually changed.
//
// Change Log fields used:
//   Sheet      = 'Remarks'
//   Subject ID = '' (remarks are class-level, not subject-level)
//   Field      = remark field name ('formMasterRemark' or 'headTeacherRemark')
//   Old/New    = remark text (empty string if not previously set)
// ─────────────────────────────────────────────────────────────────────────────

(function () {

  // Guard: RemarkService must exist before we can wrap it
  if (typeof RemarkService === 'undefined' || typeof RemarkService.saveRemarks !== 'function') {
    Logger.log('ScoreService Stage 7: RemarkService.saveRemarks not found — Remarks Change Log wrapper skipped.');
    return;
  }

  var _originalSaveRemarks = RemarkService.saveRemarks;

  RemarkService.saveRemarks = function (token, classId, remarks) {

    // Validate session — needed to build the log entry
    var sess = null;
    try { sess = AuthService.validateToken(token); } catch (e) { /* non-fatal */ }

    // ── 1. Before snapshot — read existing remarks for this class ────────────────
    // Build a lookup map: { [studentId]: { formMasterRemark, headTeacherRemark } }
    var beforeMap = {};
    if (sess) {
      try {
        var existing = RemarkService.getClassRemarks(token, classId);
        if (existing && existing.success) {
          // getClassRemarks returns { data: [ { studentId, formMasterRemark, headTeacherRemark } ] }
          var rows = Array.isArray(existing.data) ? existing.data : [];
          rows.forEach(function (r) {
            beforeMap[String(r.studentId)] = r;
          });
        }
      } catch (e) {
        Logger.log('Remarks Stage 7 wrapper: before-snapshot failed (non-fatal): ' + e.message);
      }
    }

    // ── 2. Call the original saveRemarks ─────────────────────────────────────────
    var result = _originalSaveRemarks(token, classId, remarks);

    // ── 3. Change log — one row per remark field that actually changed ───────────
    if (result && result.success && sess && Array.isArray(remarks)) {
      var settings = SheetService.getSessionSettings();

      // Fields we track — extend this list if more remark fields are added later
      var REMARK_FIELDS = ['formMasterRemark', 'headTeacherRemark'];

      remarks.forEach(function (entry) {
        var studentId = String(entry.studentId || '');
        if (!studentId) return;

        var before = beforeMap[studentId] || {};

        REMARK_FIELDS.forEach(function (field) {
          var oldStr = String(
            before[field] !== undefined && before[field] !== null ? before[field] : ''
          );
          var newStr = String(
            entry[field] !== undefined && entry[field] !== null ? entry[field] : ''
          );

          if (oldStr !== newStr) {
            LogService.logChange_(
              sess,
              'Remarks',      // sheet name
              studentId,
              classId,
              '',             // no subject ID — remarks are class-level
              settings.activeTerm,
              settings.activeSession,
              field,          // e.g. 'formMasterRemark'
              oldStr,
              newStr
            );
          }
        });
      });
    }

    return result;
  };

})();
