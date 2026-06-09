/**
 * HGUS Academic Result Management System
 * ResultService.gs — Student result slip assembly
 *
 * This service assembles the complete result data for a single student.
 * It is the server-side backbone of the student result slip screen.
 *
 * PUBLIC FUNCTIONS:
 *   - getStudentResult(token, studentId, classId)
 *       Returns the full result for one student: all subjects with
 *       component scores, totals, grades, and positions; PSQ ratings;
 *       Form Master remark; session/term details; next-term info;
 *       and the student's overall class position.
 *
 * HOW POSITIONS ARE COMPUTED:
 *   Per-subject position:
 *     - JSS: ranked within the single class.
 *     - SSS: ranked across ALL departments at the same level
 *       (SSS 1 Art + SSS 1 Commerce + SSS 1 Science).
 *
 *   Overall position:
 *     - Based on the SUM of all subject totals.
 *     - Ranked within the class group (same SSS-pooling logic).
 *     - Only Active students are ranked; Exam Exempt / Not Continuing
 *       receive null for position.
 *
 * EFFICIENCY NOTE:
 *   This function calls SheetService.getScoresForClassGroup() once to read
 *   all scores for the group in a single sheet scan, then filters in memory
 *   for each subject. This avoids N reads (one per subject) in a loop.
 *
 * ACCESS:
 *   Admin / Super Admin: any student in any class.
 *   Form Master:         only students whose classId matches one of the FM's
 *                        active assignment classIds (looked up via
 *                        SheetService.getFormMasterAssignmentsByStaff).
 */

const ResultService = (function () {

  // ─── PRIVATE HELPERS ────────────────────────────────────────────────────────

  /**
   * Strip SSS department suffix so all departments at the same level
   * share one group key.  Mirrors the logic in BroadsheetService.
   * @param {string} className
   * @returns {string}
   */
  function getGroupKey_(className) {
    return String(className)
      .replace(/\s+(science|art|commerce|humanities|business)\s*$/i, '')
      .trim();
  }

  /**
   * Compute the total score from a scores map.
   * Returns null if NO component has been entered yet.
   * @param {{ [componentKey]: number|string }} scoresMap
   * @returns {number|null}
   */
  function computeTotal_(scoresMap) {
    var hasAny = false;
    var total  = 0;
    COMPONENT_ORDER.forEach(function (key) {
      var val = scoresMap[key];
      if (val !== undefined && val !== null && val !== '') {
        hasAny = true;
        total += Number(val) || 0;
      }
    });
    return hasAny ? total : null;
  }

  /**
   * Rank an array of { studentId, total } by total descending.
   * Ties share a rank; next rank after a tie is skipped.
   * @param {{ studentId: string, total: number }[]} arr
   * @returns {{ [studentId]: number }} position map
   */
  function rankByTotal_(arr) {
    var sorted = arr.slice().sort(function (a, b) { return b.total - a.total; });
    var posMap = {};
    sorted.forEach(function (s, idx) {
      if (idx === 0) {
        posMap[s.studentId] = 1;
      } else {
        var prev = sorted[idx - 1];
        posMap[s.studentId] = (s.total === prev.total)
          ? posMap[prev.studentId]   // tie → same position
          : idx + 1;                 // gap after tie
      }
    });
    return posMap;
  }

  // ─── GET STUDENT RESULT ──────────────────────────────────────────────────────

  /**
   * Assemble the complete result data for a single student.
   *
   * Steps:
   *   1. Validate session and admin role.
   *   2. Look up the student, their class, and their group key.
   *   3. Collect all classIds in the group (for SSS pooling).
   *   4. Read ALL scores for the group in one sheet scan.
   *   5. For each subject: compute this student's scores/total/grade/position.
   *   6. Compute the student's overall position (by sum of subject totals).
   *   7. Fetch PSQ ratings and Form Master remark.
   *   8. Return the assembled result object.
   *
   * @param {string} token
   * @param {string} studentId — e.g. "HG0001"
   * @param {string} classId   — the student's specific class ID
   * @returns {{ success, data: StudentResult }}
   */
  function getStudentResult(token, studentId, classId) {
    var sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    var isAdmin = [ROLES.ADMIN, ROLES.SUPER_ADMIN].indexOf(sess.role) !== -1;

    // Non-admin access: allowed only if the caller has an active FM assignment
    // that covers the student's classId. There is no separate FM role constant —
    // any Teacher can be assigned as Form Master via Manage Assignments.
    if (!isAdmin) {
      var fmAssignments = SheetService.getFormMasterAssignmentsByStaff(sess.staffId);
      var fmClassIds    = fmAssignments.map(function (a) { return String(a.classId); });
      if (fmClassIds.length === 0) {
        return errorResponse('Unauthorised.', 'UNAUTHORISED');
      }
      if (fmClassIds.indexOf(String(classId)) === -1) {
        return errorResponse(
          'You can only view result slips for students in your assigned class.',
          'UNAUTHORISED'
        );
      }
    }

    var settings      = SheetService.getSessionSettings();
    var activeSession = settings.activeSession;
    var activeTerm    = settings.activeTerm;

    if (!activeSession || !activeTerm) {
      return errorResponse('No active session/term configured.', 'NO_SESSION');
    }

    // ── STEP 1: Look up the student ──────────────────────────────────────────

    var students = SheetService.getCachedStudents(classId);
    var student  = students.find(function (s) {
      return String(s.studentId) === String(studentId);
    });

    if (!student) {
      return errorResponse(
        'Student "' + studentId + '" not found in class "' + classId + '".',
        'NOT_FOUND'
      );
    }

    var studentName = student.fullName || student.studentName || student.name || studentId;

    // ── STEP 2: Resolve class name, group key, and group class IDs ───────────

    var allClasses = SheetService.getAllClasses();
    var cls        = allClasses.find(function (c) { return c.classId === classId; }) || {};
    var className  = cls.className || classId;
    var groupKey   = getGroupKey_(className);

    var groupClassIds = allClasses
      .filter(function (c) { return getGroupKey_(c.className) === groupKey; })
      .map(function (c) { return c.classId; });

    // ── STEP 3: Get the student's term status ─────────────────────────────────

    var ownStatusMap = SheetService.getClassTermStatuses(classId, activeTerm, activeSession);
    var termStatus   = ownStatusMap[studentId] || STUDENT_STATUS.ACTIVE;
    var isActive     = (termStatus === STUDENT_STATUS.ACTIVE);

    // ── STEP 4: Load all scores for the group in one read ─────────────────────

    // SheetService.getScoresForClassGroup() reads the Scores sheet once and
    // returns only the rows for the given classIds + term + session.
    // This prevents N individual getScores() calls (one per subject) later.
    var groupScores = SheetService.getScoresForClassGroup(
      groupClassIds, activeTerm, activeSession
    );

    // Build a comprehensive lookup: "studentId|subjectId|component" → score value
    var scoreLookup = {};
    groupScores.forEach(function (r) {
      scoreLookup[r.studentId + '|' + r.subjectId + '|' + r.component] = r.score;
    });

    // ── STEP 5: Get subjects assigned to this class group ─────────────────────

    var classSubjectAssignments = SheetService.getClassSubjectAssignments(activeSession)
      .filter(function (csa) {
        return groupClassIds.some(function (id) {
          return String(id) === String(csa.classId);
        });
      });

    // Deduplicate subject IDs
    var subjectIdsSeen = {};
    var subjectIds     = [];
    classSubjectAssignments.forEach(function (csa) {
      if (!subjectIdsSeen[csa.subjectId]) {
        subjectIdsSeen[csa.subjectId] = true;
        subjectIds.push(csa.subjectId);
      }
    });

    var allSubjects = SheetService.getAllSubjects();
    var subjectById = {};
    allSubjects.forEach(function (s) { subjectById[s.subjectId] = s; });

    // ── STEP 6: Build all active students in the group (needed for ranking) ───

    // Read statuses for all classes in the group
    var allGroupStatuses = {};
    groupClassIds.forEach(function (cid) {
      var m = SheetService.getClassTermStatuses(cid, activeTerm, activeSession);
      Object.keys(m).forEach(function (sid) { allGroupStatuses[sid] = m[sid]; });
    });

    var allGroupStudents = [];
    groupClassIds.forEach(function (cid) {
      var cStudents = SheetService.getCachedStudents(cid);
      cStudents.forEach(function (s) {
        allGroupStudents.push({
          studentId:  s.studentId,
          classId:    cid,
          termStatus: allGroupStatuses[s.studentId] || STUDENT_STATUS.ACTIVE
        });
      });
    });

    var activeGroupStudents = allGroupStudents.filter(function (gs) {
      return gs.termStatus === STUDENT_STATUS.ACTIVE;
    });

    // ── STEP 7: Per-subject results ──────────────────────────────────────────

    var subjectResults = subjectIds.map(function (subjectId) {
      var subj = subjectById[subjectId] || {};

      // Build this student's component scores for this subject
      var thisStudentScores = {};
      COMPONENT_ORDER.forEach(function (key) {
        var val = scoreLookup[studentId + '|' + subjectId + '|' + key];
        thisStudentScores[key] = (val !== undefined && val !== null && val !== '') ? val : '';
      });

      // Compute this student's total (Active students only)
      var total        = isActive ? computeTotal_(thisStudentScores) : null;
      var grade        = null;
      var gradeComment = null;
      if (total !== null) {
        var g    = getGrade(total);   // getGrade() is defined in Utils.gs
        grade        = g.grade;
        gradeComment = g.comment;
      }

      // Compute position within the group for this subject
      // Build total-per-active-student from the scoreLookup (no extra reads)
      var forRanking = activeGroupStudents.map(function (gs) {
        var gsScores = {};
        COMPONENT_ORDER.forEach(function (key) {
          var val = scoreLookup[gs.studentId + '|' + subjectId + '|' + key];
          gsScores[key] = (val !== undefined && val !== null && val !== '') ? val : '';
        });
        return { studentId: gs.studentId, total: computeTotal_(gsScores) };
      }).filter(function (gs) { return gs.total !== null; }); // exclude students with no scores

      var posMap     = rankByTotal_(forRanking);
      var position   = isActive ? (posMap[studentId] || null) : null;

      // classMax for this subject
      var allTotals = forRanking.map(function (gs) { return gs.total; });
      var classMax  = allTotals.length > 0 ? Math.max.apply(null, allTotals) : null;

      return {
        subjectId:    subjectId,
        subjectName:  subj.subjectName || subjectId,
        scores:       thisStudentScores,
        total:        total,
        grade:        grade,
        gradeComment: gradeComment,
        position:     position,
        classMax:     classMax
      };
    });

    // Sort subjects alphabetically
    subjectResults.sort(function (a, b) {
      return a.subjectName.localeCompare(b.subjectName);
    });

    // ── STEP 8: Compute overall position ─────────────────────────────────────

    // Overall position: rank all active group students by their sum of subject totals.
    // We use the already-loaded scoreLookup so this is pure in-memory computation.
    var studentOverallTotals = activeGroupStudents.map(function (gs) {
      var sumOfTotals = 0;
      var hasAnySubject = false;
      subjectIds.forEach(function (sid) {
        var gsScores = {};
        COMPONENT_ORDER.forEach(function (key) {
          var val = scoreLookup[gs.studentId + '|' + sid + '|' + key];
          gsScores[key] = (val !== undefined && val !== null && val !== '') ? val : '';
        });
        var t = computeTotal_(gsScores);
        if (t !== null) { sumOfTotals += t; hasAnySubject = true; }
      });
      return { studentId: gs.studentId, total: hasAnySubject ? sumOfTotals : null };
    }).filter(function (gs) { return gs.total !== null; });

    var overallPosMap    = rankByTotal_(studentOverallTotals);
    var overallPosition  = isActive ? (overallPosMap[studentId] || null) : null;

    // Compute this student's overall total and average
    var thisStudentSubjTotals = subjectResults.filter(function (s) {
      return s.total !== null;
    });
    var totalScore  = thisStudentSubjTotals.reduce(function (sum, s) {
      return sum + s.total;
    }, 0);
    var averageScore = thisStudentSubjTotals.length > 0
      ? Math.round((totalScore / thisStudentSubjTotals.length) * 10) / 10
      : 0;
    var overallGrade = thisStudentSubjTotals.length > 0
      ? getGrade(averageScore).grade : null;

    // ── STEP 9: PSQ ratings ──────────────────────────────────────────────────

    var psqRow  = SheetService.getPSQ(studentId, classId, activeTerm, activeSession);
    var psqData = {};
    if (psqRow) {
      PSQ_TRAITS.forEach(function (trait) {
        var key = toCamelCase(trait);
        psqData[key] = (psqRow[key] !== undefined && psqRow[key] !== '') ? psqRow[key] : null;
      });
    }

    // ── STEP 10: Form Master remark and name ─────────────────────────────────

    var remarkRow  = SheetService.getRemark(studentId, classId, activeTerm, activeSession);
    var remark     = remarkRow ? (remarkRow.remark || '') : '';

    var fmAssignment   = SheetService.getFormMasterAssignment(classId, activeSession);
    var formMasterName = '';
    if (fmAssignment) {
      var fmStaff    = SheetService.getUserById(fmAssignment.staffId);
      formMasterName = fmStaff ? (fmStaff.name || '') : '';
    }

    // ── ASSEMBLE AND RETURN ──────────────────────────────────────────────────

    return successResponse({
      // Student & class info
      student: {
        studentId:  studentId,
        name:       studentName,
        classId:    classId,
        className:  className,
        termStatus: termStatus
      },

      // Academic period
      session:          activeSession,
      term:             activeTerm,
      termStartDate:    settings.termStartDate    || '',
      termEndDate:      settings.termEndDate      || '',
      nextTermFee:      settings.nextTermFee      || '',
      nextTermResumption: settings.nextTermResumption || '',

      // Per-subject results
      subjects: subjectResults,

      // Summary
      summary: {
        totalScore:      totalScore,
        averageScore:    averageScore,
        overallGrade:    overallGrade,
        overallPosition: overallPosition,
        classSize:       activeGroupStudents.length,
        subjectCount:    thisStudentSubjTotals.length
      },

      // PSQ and remark
      psq:            psqData,
      remark:         remark,
      formMasterName: formMasterName
    });
  }

  // ─── PUBLIC API ──────────────────────────────────────────────────────────────

  return {
    getStudentResult
  };

})();
