/**
 * HGUS Academic Result Management System
 * BroadsheetService.gs — Broadsheet computation
 *
 * This service handles all broadsheet-related operations for Stage 4.
 * It reads scores, computes totals, grades, positions, and class maxes
 * for display in the Admin broadsheet views.
 *
 * PUBLIC FUNCTIONS:
 *   - getClassGroups(token)
 *       Returns all distinct class groups (JSS 1…SSS 3) available in the
 *       current session. Used by the broadsheetHome screen.
 *
 *   - getBroadsheetSubjects(token, classGroupKey)
 *       Returns the subjects and student list for a class group.
 *       Used by the broadsheetSubjectSelect screen.
 *
 *   - getBroadsheetForSubject(token, classGroupKey, subjectId)
 *       Returns the full broadsheet for a class group + subject.
 *       Used by the broadsheetView screen.
 *
 * KEY RULES:
 *   - JSS: position is within that SINGLE class only.
 *   - SSS: position is across ALL departments at the same level
 *     (SSS 1 Art + SSS 1 Commerce + SSS 1 Science are ranked together).
 *   - Only "Active" students receive a total / grade / position.
 *   - "Exam Exempt" students: show component scores but no total/grade/position.
 *   - "Not Continuing" students: shown but no total/grade/position.
 *   - Ties: shared rank; next rank skipped (e.g. 1, 2, 2, 4).
 *
 * ACCESS:
 *   Admin / Super Admin: all class groups.
 *   Any other user:      only class groups they are actively assigned to as
 *                        Form Master (looked up via
 *                        SheetService.getFormMasterAssignmentsByStaff()).
 *                        NOTE: There is no separate "Form Master" role constant
 *                        in Config.gs — a Teacher becomes a Form Master by being
 *                        assigned, not by having a different role string.
 */

const BroadsheetService = (function () {

  // ─── PRIVATE HELPERS ────────────────────────────────────────────────────────

  /**
   * Return all class group keys (e.g. "JSS 3", "SSS 1") that a Form Master
   * is actively assigned to.
   *
   * Looks up active FM assignment rows for the given staffId, maps each
   * assignment's classId to its class name via SheetService.getAllClasses(),
   * then strips any SSS department suffix to produce the group key.
   *
   * Returns an empty array if the FM has no active assignments.
   *
   * @param {string} staffId
   * @returns {string[]} e.g. ["JSS 3"] or ["SSS 1"]
   */
  function getFMGroupKeys_(staffId) {
    var assignments = SheetService.getFormMasterAssignmentsByStaff(staffId);
    if (!assignments || assignments.length === 0) return [];

    // Build a classId → className map for quick lookup
    var allClasses = SheetService.getAllClasses();
    var classNameById = {};
    allClasses.forEach(function (c) {
      classNameById[String(c.classId)] = c.className;
    });

    // Derive unique group keys from the FM's assigned classIds
    var seen      = {};
    var groupKeys = [];
    assignments.forEach(function (a) {
      var className = classNameById[String(a.classId)];
      if (!className) return; // orphaned assignment — skip
      var key = getGroupKey_(className);
      if (!seen[key]) {
        seen[key] = true;
        groupKeys.push(key);
      }
    });
    return groupKeys;
  }

  /**
   * Validate that the caller has broadsheet access to a specific class group.
   *
   * - Admin / Super Admin: always allowed.
   * - Form Master:          allowed only for group keys in their active FM
   *                         assignments. Returns an error response if they
   *                         request a group that is not theirs.
   *
   * Returns null if access is granted, or an error-response object if denied.
   * Usage:
   *   var authErr = validateBroadsheetAccess_(sess, classGroupKey);
   *   if (authErr) return authErr;
   *
   * @param {{ role, staffId }} sess   — result of AuthService.validateToken()
   * @param {string}            classGroupKey — e.g. "JSS 3" or "SSS 1"
   * @returns {null | ErrorResponse}
   */
  function validateBroadsheetAccess_(sess, classGroupKey) {
    // Admin and Super Admin can access any class group.
    if ([ROLES.ADMIN, ROLES.SUPER_ADMIN].indexOf(sess.role) !== -1) {
      return null; // access granted — no further checks needed
    }

    // NOTE: There is no separate "Form Master" role constant.
    // In this system a Teacher (or any non-admin) becomes a Form Master by
    // being *assigned* as FM for a class via Manage Assignments.
    // We grant broadsheet access based on active FM assignments, not role string.
    var myKeys = getFMGroupKeys_(sess.staffId);
    if (myKeys.indexOf(classGroupKey) !== -1) {
      return null; // user has an active FM assignment for this group — access granted
    }

    // No FM assignment covers the requested group → deny
    return errorResponse(
      'Unauthorised. You do not have a Form Master assignment for this class group.',
      'UNAUTHORISED'
    );
  }

  /**
   * Strip the SSS department suffix from a class name so all departments
   * at the same level share one group key.
   *
   * Examples:
   *   "SSS 1 Science"  → "SSS 1"
   *   "SSS 2 Art"      → "SSS 2"
   *   "JSS 3"          → "JSS 3"   (no suffix to strip)
   *
   * @param {string} className
   * @returns {string}
   */
  function getGroupKey_(className) {
    return String(className)
      .replace(/\s+(science|art|commerce|humanities|business)\s*$/i, '')
      .trim();
  }

  /**
   * Given the full class list, return just the classIds that belong to
   * the specified group key.
   *
   * @param {string}   groupKey   — e.g. "SSS 1"
   * @param {Object[]} allClasses — from SheetService.getAllClasses()
   * @returns {string[]} classIds
   */
  function getClassIdsForGroup_(groupKey, allClasses) {
    return allClasses
      .filter(function (c) { return getGroupKey_(c.className) === groupKey; })
      .map(function (c) { return c.classId; });
  }

  /**
   * Compute the running total from a student's scores map.
   *
   * Sums all 6 score components: C/W, ASS, ATT, Test1, Test2, Exam.
   * Returns null if the student has NO scores at all (not yet started).
   * Returns a number (even 0) if at least one component has been entered.
   *
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
   * Rank an array of { studentId, total } objects by total (descending).
   *
   * Ties share the same position; the next rank after a tie is skipped.
   * Example: totals [95, 90, 90, 85] → positions [1, 2, 2, 4].
   *
   * @param {{ studentId: string, total: number }[]} studentsWithTotals
   * @returns {{ [studentId]: number }} map of studentId → position
   */
  function rankByTotal_(studentsWithTotals) {
    // Sort descending by total
    var sorted = studentsWithTotals.slice().sort(function (a, b) {
      return b.total - a.total;
    });

    var posMap = {};
    sorted.forEach(function (s, idx) {
      if (idx === 0) {
        posMap[s.studentId] = 1;
      } else {
        var prev = sorted[idx - 1];
        if (s.total === prev.total) {
          // Same total as previous → same position
          posMap[s.studentId] = posMap[prev.studentId];
        } else {
          // Different total → next position, skipping any tied ranks
          posMap[s.studentId] = idx + 1;
        }
      }
    });
    return posMap;
  }

  // ─── GET CLASS GROUPS ────────────────────────────────────────────────────────

  /**
   * Return all distinct class groups available in the current session.
   *
   * The returned array is sorted in school order: JSS 1, JSS 2, JSS 3,
   * SSS 1, SSS 2, SSS 3. Each group entry also lists its classIds so
   * the caller knows which classes make up each group.
   *
   * Admin / Super Admin only.
   *
   * @param {string} token
   * @returns {{ success, data: { groups: [{ groupKey, classIds }] } }}
   */
  function getClassGroups(token) {
    var sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    var isAdmin = [ROLES.ADMIN, ROLES.SUPER_ADMIN].indexOf(sess.role) !== -1;

    var allClasses = SheetService.getAllClasses();
    if (allClasses.length === 0) {
      return errorResponse(
        'No classes found. Please sync classes from Session Settings first.',
        'NO_CLASSES'
      );
    }

    // Admin / Super Admin: show all class groups (allowedKeys = null = unrestricted).
    // Any other user: show only class groups for which they have an active FM assignment.
    // (There is no separate FM role constant — access is purely assignment-based.)
    var allowedKeys = null;
    if (!isAdmin) {
      allowedKeys = getFMGroupKeys_(sess.staffId);
      if (allowedKeys.length === 0) {
        return errorResponse(
          'You have no active Form Master assignments. Contact your administrator.',
          'NO_ASSIGNMENT'
        );
      }
    }

    // Build groupKey → [classId, …] map, filtered for FM if needed
    var groupMap = {};
    allClasses.forEach(function (c) {
      var key = getGroupKey_(c.className);
      if (allowedKeys && allowedKeys.indexOf(key) === -1) return; // FM: skip other groups
      if (!groupMap[key]) groupMap[key] = [];
      groupMap[key].push(c.classId);
    });

    // Sort group keys in known school order; unknown keys go at the end
    var ORDER = ['JSS 1', 'JSS 2', 'JSS 3', 'SSS 1', 'SSS 2', 'SSS 3'];
    var groups = Object.keys(groupMap)
      .sort(function (a, b) {
        var ia = ORDER.indexOf(a);
        var ib = ORDER.indexOf(b);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.localeCompare(b);
      })
      .map(function (key) {
        return { groupKey: key, classIds: groupMap[key] };
      });

    return successResponse({ groups: groups });
  }

  // ─── GET BROADSHEET SUBJECTS ─────────────────────────────────────────────────

  /**
   * Get the subjects and student list for a class group.
   *
   * Used by the broadsheetSubjectSelect screen which shows two sections:
   *   A. "View Broadsheet" — one button per subject (tap → full broadsheet)
   *   B. "Result Slips"    — one row per student (tap → student result slip)
   *
   * For SSS groups, the student list combines all three departments.
   * Students are sorted alphabetically by name.
   *
   * Admin / Super Admin only.
   *
   * @param {string} token
   * @param {string} classGroupKey — e.g. "JSS 2" or "SSS 1"
   * @returns {{ success, data: { classGroupKey, classIds, term, session, subjects, students } }}
   */
  function getBroadsheetSubjects(token, classGroupKey) {
    var sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    var authErr = validateBroadsheetAccess_(sess, classGroupKey);
    if (authErr) return authErr;

    var settings       = SheetService.getSessionSettings();
    var activeSession  = settings.activeSession;
    var activeTerm     = settings.activeTerm;

    if (!activeSession || !activeTerm) {
      return errorResponse('No active session/term configured.', 'NO_SESSION');
    }

    var allClasses = SheetService.getAllClasses();
    var classIds   = getClassIdsForGroup_(classGroupKey, allClasses);

    if (classIds.length === 0) {
      return errorResponse(
        'No classes found for group "' + classGroupKey + '". ' +
        'Please sync classes from Session Settings.',
        'NO_CLASSES'
      );
    }

    // ── Subjects: find all subjects assigned to any class in this group ──

    var classSubjectAssignments = SheetService.getClassSubjectAssignments(activeSession)
      .filter(function (csa) {
        return classIds.some(function (id) {
          return String(id) === String(csa.classId);
        });
      });

    // Deduplicate subjects — all departments share the same subject list
    var subjectIdsSeen = {};
    var subjectIds     = [];
    classSubjectAssignments.forEach(function (csa) {
      if (!subjectIdsSeen[csa.subjectId]) {
        subjectIdsSeen[csa.subjectId] = true;
        subjectIds.push(csa.subjectId);
      }
    });

    // Enrich with subject names and sort alphabetically
    var allSubjects = SheetService.getAllSubjects();
    var subjectById = {};
    allSubjects.forEach(function (s) { subjectById[s.subjectId] = s; });

    var subjects = subjectIds.map(function (sid) {
      var subj = subjectById[sid] || {};
      return { subjectId: sid, subjectName: subj.subjectName || sid };
    }).sort(function (a, b) {
      return a.subjectName.localeCompare(b.subjectName);
    });

    // ── Students: collect all students across all classes in the group ──

    // Build a combined status map from all classes in the group
    var statusMaps = {};
    classIds.forEach(function (cid) {
      var m = SheetService.getClassTermStatuses(cid, activeTerm, activeSession);
      Object.keys(m).forEach(function (sid) { statusMaps[sid] = m[sid]; });
    });

    var students = [];
    classIds.forEach(function (cid) {
      var cls          = allClasses.find(function (c) { return c.classId === cid; }) || {};
      var classStudents = SheetService.getCachedStudents(cid);
      classStudents.forEach(function (s) {
        students.push({
          studentId:  s.studentId,
          name:       s.fullName || s.studentName || s.name || s.studentId,
          classId:    cid,
          className:  cls.className || cid,
          termStatus: statusMaps[s.studentId] || STUDENT_STATUS.ACTIVE
        });
      });
    });

    // Sort students alphabetically by name for easy scanning
    students.sort(function (a, b) { return a.name.localeCompare(b.name); });

    return successResponse({
      classGroupKey: classGroupKey,
      classIds:      classIds,
      term:          activeTerm,
      session:       activeSession,
      subjects:      subjects,
      students:      students
    });
  }

  // ─── GET BROADSHEET FOR SUBJECT ──────────────────────────────────────────────

  /**
   * Compute and return the full broadsheet for a class group + subject.
   *
   * For each student this returns:
   *   - Their score for every component (C/W, ASS, ATT, Test1, Test2, Exam)
   *   - Computed total (Active students only; null for others)
   *   - Grade and grade comment (Active students only)
   *   - Position within the class group (Active students only)
   *
   * Plus a summary section with:
   *   - classMax  — highest total in the group for this subject
   *   - average   — mean of all Active students' totals
   *   - activeCount / totalCount
   *
   * POSITION RULE:
   *   JSS: position is within the single class.
   *   SSS: position is across ALL departments at the same level.
   *   Ties share a rank; next rank after a tie is skipped.
   *
   * SORT ORDER in the returned students array:
   *   Active (sorted by position) → Exam Exempt (by name) → Not Continuing (by name)
   *
   * Admin / Super Admin only.
   *
   * @param {string} token
   * @param {string} classGroupKey — e.g. "JSS 2" or "SSS 1"
   * @param {string} subjectId
   * @returns {{ success, data: BroadsheetData }}
   */
  function getBroadsheetForSubject(token, classGroupKey, subjectId) {
    var sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    var authErr = validateBroadsheetAccess_(sess, classGroupKey);
    if (authErr) return authErr;

    var settings      = SheetService.getSessionSettings();
    var activeSession = settings.activeSession;
    var activeTerm    = settings.activeTerm;

    if (!activeSession || !activeTerm) {
      return errorResponse('No active session/term configured.', 'NO_SESSION');
    }

    var allClasses = SheetService.getAllClasses();
    var classIds   = getClassIdsForGroup_(classGroupKey, allClasses);

    if (classIds.length === 0) {
      return errorResponse(
        'No classes found for group "' + classGroupKey + '".',
        'NO_CLASSES'
      );
    }

    // ── Subject name lookup ──
    var allSubjects = SheetService.getAllSubjects();
    var subject     = allSubjects.find(function (s) {
      return s.subjectId === subjectId;
    }) || {};
    var subjectName = subject.subjectName || subjectId;

    // Whether the broadsheet needs a "Class" column:
    // true for SSS (3 departments per level), false for JSS (1 class)
    var showClassColumn = classIds.length > 1;

    // ── Build the combined student list with statuses ──
    var statusMaps = {};
    classIds.forEach(function (cid) {
      var m = SheetService.getClassTermStatuses(cid, activeTerm, activeSession);
      Object.keys(m).forEach(function (sid) { statusMaps[sid] = m[sid]; });
    });

    var allStudents = [];
    classIds.forEach(function (cid) {
      var cls           = allClasses.find(function (c) { return c.classId === cid; }) || {};
      var classStudents = SheetService.getCachedStudents(cid);
      classStudents.forEach(function (s) {
        allStudents.push({
          studentId:  s.studentId,
          name:       s.fullName || s.studentName || s.name || s.studentId,
          classId:    cid,
          className:  cls.className || cid,
          termStatus: statusMaps[s.studentId] || STUDENT_STATUS.ACTIVE
        });
      });
    });

    // ── Read scores for this subject across all classes in the group ──
    // One SheetService.getScores() call per classId, building a flat lookup.
    // Key format: "studentId|component" → score value
    var scoreLookup = {};
    classIds.forEach(function (cid) {
      var classScores = SheetService.getScores(cid, subjectId, activeTerm, activeSession);
      classScores.forEach(function (r) {
        scoreLookup[r.studentId + '|' + r.component] = r.score;
      });
    });

    // ── Per-student: build scores map and compute total/grade ──
    var studentsWithScores = allStudents.map(function (s) {
      var scoresMap = {};
      COMPONENT_ORDER.forEach(function (key) {
        var val = scoreLookup[s.studentId + '|' + key];
        scoresMap[key] = (val !== undefined && val !== null && val !== '') ? val : '';
      });

      // Only Active students receive a total and grade
      var isActive = (s.termStatus === STUDENT_STATUS.ACTIVE);
      var total    = isActive ? computeTotal_(scoresMap) : null;

      var grade        = null;
      var gradeComment = null;
      if (total !== null) {
        var g    = getGrade(total);  // getGrade() is defined in Utils.gs
        grade        = g.grade;
        gradeComment = g.comment;
      }

      return {
        studentId:   s.studentId,
        name:        s.name,
        classId:     s.classId,
        className:   s.className,
        termStatus:  s.termStatus,
        scores:      scoresMap,
        total:       total,
        grade:       grade,
        gradeComment: gradeComment,
        position:    null   // computed below
      };
    });

    // ── Compute positions ──
    // Only Active students with a non-null total participate in ranking
    var forRanking = studentsWithScores
      .filter(function (s) { return s.total !== null; })
      .map(function (s) { return { studentId: s.studentId, total: s.total }; });

    var posMap = rankByTotal_(forRanking);

    // Apply positions back to the student list
    var studentsWithPositions = studentsWithScores.map(function (s) {
      return Object.assign({}, s, {
        position: (posMap[s.studentId] !== undefined) ? posMap[s.studentId] : null
      });
    });

    // ── Sort: Active (by position) → Exam Exempt (by name) → Not Continuing (by name) ──
    studentsWithPositions.sort(function (a, b) {
      // Status sort order: Active = 0, Exam Exempt = 1, Not Continuing = 2
      var statusOrder = function (st) {
        if (st === STUDENT_STATUS.ACTIVE)        return 0;
        if (st === STUDENT_STATUS.EXAM_EXEMPT)   return 1;
        return 2;
      };
      var sa = statusOrder(a.termStatus);
      var sb = statusOrder(b.termStatus);
      if (sa !== sb) return sa - sb;
      // Within Active students: sort by position ascending
      if (a.position !== null && b.position !== null) return a.position - b.position;
      if (a.position !== null) return -1;
      if (b.position !== null) return 1;
      return a.name.localeCompare(b.name);
    });

    // ── Summary statistics ──
    var activeTotals = forRanking.map(function (s) { return s.total; });
    var classMax = activeTotals.length > 0
      ? Math.max.apply(null, activeTotals) : 0;
    var average = activeTotals.length > 0
      ? Math.round(
          (activeTotals.reduce(function (sum, t) { return sum + t; }, 0) / activeTotals.length)
          * 10) / 10
      : 0;

    return successResponse({
      classGroupKey:   classGroupKey,
      subjectId:       subjectId,
      subjectName:     subjectName,
      term:            activeTerm,
      session:         activeSession,
      showClassColumn: showClassColumn,
      students:        studentsWithPositions,
      summary: {
        classMax:    classMax,
        average:     average,
        activeCount: activeTotals.length,
        totalCount:  allStudents.length
      }
    });
  }

  // ─── GET BROADSHEET FOR CLASS ────────────────────────────────────────────────

  /**
   * Compute and return the full per-class broadsheet for a class group.
   *
   * Unlike getBroadsheetForSubject() which shows one subject's component scores,
   * this function shows ALL subjects at once — students as rows, subjects as
   * columns — with only the computed TOTAL per subject (not components).
   *
   * This is how a traditional printed school broadsheet looks:
   *   Name | [Cls] | Maths | English | ... | Total | Avg | Grade | Position
   *
   * POSITION RULE:
   *   Computed from overallTotal (sum of all subject totals for the student).
   *   JSS: ranked within the single class.
   *   SSS: ranked across all three departments at the same level.
   *   Ties share a rank; the next rank after a tie is skipped.
   *
   * AVERAGE:
   *   overallTotal ÷ number of subjects in which the student has at least one
   *   component score entered (so a student who sat only 8 of 9 subjects is
   *   averaged over 8, not 9).
   *
   * GRADE:
   *   Based on the student's average score using the same getGrade() scale used
   *   throughout the system.
   *
   * SORT ORDER:
   *   Active (by position asc) → Exam Exempt (by name) → Not Continuing (by name)
   *
   * Admin / Super Admin only.
   *
   * @param {string} token
   * @param {string} classGroupKey — e.g. "JSS 2" or "SSS 1"
   * @returns {{ success, data: ClassBroadsheetData }}
   *
   * ClassBroadsheetData shape:
   *   {
   *     classGroupKey, term, session, showClassColumn,
   *     subjects: [{ subjectId, subjectName }],   // alphabetically sorted
   *     students: [{
   *       studentId, name, classId, className, termStatus,
   *       subjectTotals: { "SUB001": 85, "SUB002": null, ... },
   *       overallTotal,   // sum of non-null totals; null for non-Active
   *       average,        // 1 d.p.; null for non-Active or zero scored subjects
   *       grade,          // e.g. "A1 Excellent"; null for non-Active
   *       position        // integer; null if not ranked
   *     }],
   *     summary: { activeCount, totalCount }
   *   }
   */
  function getBroadsheetForClass(token, classGroupKey) {
    var sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    var authErr = validateBroadsheetAccess_(sess, classGroupKey);
    if (authErr) return authErr;

    var settings      = SheetService.getSessionSettings();
    var activeSession = settings.activeSession;
    var activeTerm    = settings.activeTerm;

    if (!activeSession || !activeTerm) {
      return errorResponse('No active session/term configured.', 'NO_SESSION');
    }

    var allClasses = SheetService.getAllClasses();
    var classIds   = getClassIdsForGroup_(classGroupKey, allClasses);

    if (classIds.length === 0) {
      return errorResponse(
        'No classes found for group "' + classGroupKey + '". ' +
        'Please sync classes from Session Settings.',
        'NO_CLASSES'
      );
    }

    // Show a department column when multiple classIds share one group key (SSS)
    var showClassColumn = classIds.length > 1;

    // ── Subjects: union of all subjects assigned to any class in this group ──
    var classSubjectAssignments = SheetService.getClassSubjectAssignments(activeSession)
      .filter(function (csa) {
        return classIds.some(function (id) { return String(id) === String(csa.classId); });
      });

    // Deduplicate — SSS departments share the same subject set
    var subjectIdsSeen = {};
    var subjectIds     = [];
    classSubjectAssignments.forEach(function (csa) {
      if (!subjectIdsSeen[csa.subjectId]) {
        subjectIdsSeen[csa.subjectId] = true;
        subjectIds.push(csa.subjectId);
      }
    });

    // Enrich with subject names and sort alphabetically
    var allSubjects = SheetService.getAllSubjects();
    var subjectById = {};
    allSubjects.forEach(function (s) { subjectById[s.subjectId] = s; });

    var subjects = subjectIds.map(function (sid) {
      var subj = subjectById[sid] || {};
      return { subjectId: sid, subjectName: subj.subjectName || sid };
    }).sort(function (a, b) { return a.subjectName.localeCompare(b.subjectName); });

    // Update subjectIds to match the sorted order (keeps column order consistent)
    subjectIds = subjects.map(function (s) { return s.subjectId; });

    // ── Term status map ──
    var statusMaps = {};
    classIds.forEach(function (cid) {
      var m = SheetService.getClassTermStatuses(cid, activeTerm, activeSession);
      Object.keys(m).forEach(function (sid) { statusMaps[sid] = m[sid]; });
    });

    // ── Student list ──
    var allStudents = [];
    classIds.forEach(function (cid) {
      var cls          = allClasses.find(function (c) { return c.classId === cid; }) || {};
      var classStudents = SheetService.getCachedStudents(cid);
      classStudents.forEach(function (s) {
        allStudents.push({
          studentId:  s.studentId,
          name:       s.fullName || s.studentName || s.name || s.studentId,
          classId:    cid,
          className:  cls.className || cid,
          termStatus: statusMaps[s.studentId] || STUDENT_STATUS.ACTIVE
        });
      });
    });

    // ── Bulk score read — one sheet access for ALL subjects + classes ──
    // Returns rows: { studentId, classId, subjectId, component, score, term, session }
    var scoreRows = SheetService.getScoresForClassGroup(classIds, activeTerm, activeSession);

    // Build nested lookup: studentId → subjectId → { component: score }
    // Only non-empty scores are stored (matches computeTotal_ logic).
    var scoreMap = {};
    scoreRows.forEach(function (row) {
      var score = row.score;
      if (score === undefined || score === null || score === '') return;
      var stu = String(row.studentId);
      var sub = String(row.subjectId);
      var cmp = String(row.component);
      if (!scoreMap[stu])       scoreMap[stu]       = {};
      if (!scoreMap[stu][sub])  scoreMap[stu][sub]  = {};
      scoreMap[stu][sub][cmp] = score;
    });

    // ── Per-student computation ──
    var studentsComputed = allStudents.map(function (s) {
      var isActive = (s.termStatus === STUDENT_STATUS.ACTIVE);

      // For each subject: compute the component total (null = no scores entered)
      var subjectTotals = {};
      subjectIds.forEach(function (sid) {
        if (!isActive) {
          // Non-Active students never receive a total
          subjectTotals[sid] = null;
          return;
        }
        var compMap = (scoreMap[s.studentId] && scoreMap[s.studentId][sid])
          ? scoreMap[s.studentId][sid] : {};
        subjectTotals[sid] = computeTotal_(compMap);  // null if no scores at all
      });

      // Overall total = sum of all non-null subject totals
      // (a student with 0 scores in a subject still gets 0 added if they have
      //  at least one component entered; null means no entry at all)
      var scoredSubjects = subjectIds.filter(function (sid) {
        return subjectTotals[sid] !== null;
      });
      var overallTotal = (isActive && scoredSubjects.length > 0)
        ? scoredSubjects.reduce(function (sum, sid) { return sum + subjectTotals[sid]; }, 0)
        : null;

      // Average = overallTotal / number of subjects with any score entered
      var average = null;
      if (overallTotal !== null && scoredSubjects.length > 0) {
        average = Math.round((overallTotal / scoredSubjects.length) * 10) / 10;
      }

      // Grade = based on average, using the same scale as the rest of the system
      var grade        = null;
      var gradeComment = null;
      if (average !== null) {
        var g    = getGrade(average);
        grade        = g.grade;
        gradeComment = g.comment;
      }

      return {
        studentId:     s.studentId,
        name:          s.name,
        classId:       s.classId,
        className:     s.className,
        termStatus:    s.termStatus,
        subjectTotals: subjectTotals,  // { subjectId: total|null }
        overallTotal:  overallTotal,   // null for non-Active or no scores
        average:       average,        // null for same
        grade:         grade,          // null for same
        gradeComment:  gradeComment,
        position:      null            // computed in the next step
      };
    });

    // ── Compute positions from overallTotal (Active students only) ──
    var forRanking = studentsComputed
      .filter(function (s) { return s.overallTotal !== null; })
      .map(function (s) { return { studentId: s.studentId, total: s.overallTotal }; });

    var posMap = rankByTotal_(forRanking);

    var studentsWithPositions = studentsComputed.map(function (s) {
      return Object.assign({}, s, {
        position: (posMap[s.studentId] !== undefined) ? posMap[s.studentId] : null
      });
    });

    // ── Sort: Active (by position asc) → Exam Exempt (by name) → NC (by name) ──
    studentsWithPositions.sort(function (a, b) {
      var statusOrder = function (st) {
        if (st === STUDENT_STATUS.ACTIVE)      return 0;
        if (st === STUDENT_STATUS.EXAM_EXEMPT) return 1;
        return 2;
      };
      var sa = statusOrder(a.termStatus);
      var sb = statusOrder(b.termStatus);
      if (sa !== sb) return sa - sb;
      // Within Active: sort by position ascending
      if (a.position !== null && b.position !== null) return a.position - b.position;
      if (a.position !== null) return -1;
      if (b.position !== null) return 1;
      return a.name.localeCompare(b.name);
    });

    return successResponse({
      classGroupKey:   classGroupKey,
      term:            activeTerm,
      session:         activeSession,
      showClassColumn: showClassColumn,
      subjects:        subjects,
      students:        studentsWithPositions,
      summary: {
        activeCount: forRanking.length,
        totalCount:  allStudents.length
      }
    });
  }

  // ─── PUBLIC API ──────────────────────────────────────────────────────────────

  return {
    getClassGroups,
    getBroadsheetSubjects,
    getBroadsheetForSubject,
    getBroadsheetForClass
  };

})();
