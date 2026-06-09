/**
 * HGUS Academic Result Management System
 * CompletionService.gs — Generation Lock computation (Stage 5)
 *
 * This service answers one question for a given class group:
 *   "Has all required data been entered, and which generation buttons are unlocked?"
 *
 * It is called:
 *   1. By serverGetClassGroupCompletion() (in Code.gs) so the Class Menu
 *      UI can render buttons as locked or unlocked.
 *   2. By serverGetBroadsheetForClass() and serverGetStudentResult() (in Code.gs)
 *      to enforce locks at the API level (not just the UI).
 *
 * ─── WHAT GETS CHECKED ──────────────────────────────────────────────────────
 *
 *   broadsheetUnlocked = true  when:
 *     Every Active student in the group has ALL 6 score components entered
 *     for EVERY subject assigned to the group.
 *     (C/W, ASS, ATT, Test1, Test2, Exam — defined in COMPONENT_ORDER in Config.gs)
 *
 *   resultsUnlocked = true  when:
 *     broadsheetUnlocked = true  AND
 *     Every Active student has all 16 PSQ traits rated (1–5)  AND
 *     Every Active student has a Form Master remark of at least 1 character.
 *
 *   "Subject Scores" button is ALWAYS unlocked — no lock logic here.
 *
 * ─── WHO CAN CALL THIS ──────────────────────────────────────────────────────
 *   Admin / Super Admin: any class group.
 *   Form Master (Teacher): only class groups that include one of their assigned classes.
 *
 * ─── EFFICIENCY ─────────────────────────────────────────────────────────────
 *   Scores, PSQ, and Remarks are each read ONCE for the whole group using the
 *   bulk readers added to SheetService in Stage 5.  All filtering and
 *   completeness checks happen in memory — no per-student or per-subject reads.
 *
 * PUBLIC FUNCTIONS:
 *   - getClassGroupCompletion(token, classGroupKey)
 *       Returns { broadsheetUnlocked, resultsUnlocked, detail } for the group.
 */

const CompletionService = (function () {

  // ─── PRIVATE HELPERS ────────────────────────────────────────────────────────

  /**
   * Strip the SSS department suffix from a class name so all departments
   * at the same level share one group key.
   * Mirrors the identical helper in BroadsheetService and ResultService.
   *
   * Examples:
   *   "SSS 1 Science"  → "SSS 1"
   *   "SSS 2 Art"      → "SSS 2"
   *   "JSS 3"          → "JSS 3"  (unchanged)
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
   * Given a group key (e.g. "SSS 1"), return all classIds whose class name
   * matches that group key (after stripping the department suffix).
   *
   * @param {string}   groupKey
   * @param {Object[]} allClasses — full class list from SheetService.getAllClasses()
   * @returns {string[]} array of classIds in the group
   */
  function getClassIdsForGroup_(groupKey, allClasses) {
    return allClasses
      .filter(function (c) { return getGroupKey_(c.className) === groupKey; })
      .map(function (c) { return c.classId; });
  }

  /**
   * Validate that a caller (admin or FM) is allowed to view a given group.
   *
   * Rules:
   *   - Admin / Super Admin → always allowed.
   *   - Any other role → allowed only if they have an active FM assignment
   *     for at least one classId in groupClassIds.
   *
   * @param {Object}   sess          — validated session from AuthService
   * @param {string[]} groupClassIds — classIds in the target group
   * @returns {boolean} true if access is permitted
   */
  function hasGroupAccess_(sess, groupClassIds) {
    var isAdmin = [ROLES.ADMIN, ROLES.SUPER_ADMIN].indexOf(sess.role) !== -1;
    if (isAdmin) return true;

    // For non-admins: check FM assignment
    var fmAssignments = SheetService.getFormMasterAssignmentsByStaff(sess.staffId);
    var fmClassIds    = fmAssignments.map(function (a) { return String(a.classId); });

    // Access is granted if at least one of the FM's classes is in the group
    return groupClassIds.some(function (id) {
      return fmClassIds.indexOf(String(id)) !== -1;
    });
  }

  // ─── MAIN: GET CLASS GROUP COMPLETION ───────────────────────────────────────

  /**
   * Compute completion state for a class group.
   *
   * Returns an object with:
   *   broadsheetUnlocked {boolean} — all scores complete for all active students
   *   resultsUnlocked    {boolean} — scores + PSQ + remarks all complete
   *   detail             {Object}  — granular counts for each check (useful for
   *                                  debugging or showing progress bars in future)
   *
   * ─── ALGORITHM ───────────────────────────────────────────────────────────
   *
   *   A. Resolve group → classIds in the group.
   *   B. Collect all Active students across all group classes.
   *   C. Collect all subject IDs assigned to the group.
   *   D. Bulk-read Scores, PSQ, and Remarks for the group (3 sheet reads total).
   *   E. Score check:
   *        For each (activeStudent, subject, component) triplet, verify a score
   *        value exists (non-empty) in the scores lookup.
   *        totalRequired = activeStudentCount × subjectCount × 6
   *   F. PSQ check:
   *        For each active student, verify a PSQ row exists with all 16 traits
   *        filled in (non-null, non-empty).
   *   G. Remark check:
   *        For each active student, verify a Remark row exists with at least
   *        1 non-whitespace character.
   *   H. broadsheetUnlocked = (scoresComplete === scoresRequired)
   *      resultsUnlocked    = broadsheetUnlocked && psqComplete && remarkComplete
   *
   * @param {string} token         — session token
   * @param {string} classGroupKey — e.g. "SSS 1" or "JSS 3"
   * @returns {{ success, data: { broadsheetUnlocked, resultsUnlocked, detail } }}
   */
  function getClassGroupCompletion(token, classGroupKey) {
    // ── Validate session ────────────────────────────────────────────────────
    var sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    // ── Get active session/term ─────────────────────────────────────────────
    var settings      = SheetService.getSessionSettings();
    var activeSession = settings.activeSession;
    var activeTerm    = settings.activeTerm;

    if (!activeSession || !activeTerm) {
      return errorResponse('No active session/term configured.', 'NO_SESSION');
    }

    // ── Resolve group classIds ──────────────────────────────────────────────
    var allClasses    = SheetService.getAllClasses();
    var groupClassIds = getClassIdsForGroup_(classGroupKey, allClasses);

    if (groupClassIds.length === 0) {
      return errorResponse(
        'No classes found for group "' + classGroupKey + '".',
        'NOT_FOUND'
      );
    }

    // ── Access check ────────────────────────────────────────────────────────
    if (!hasGroupAccess_(sess, groupClassIds)) {
      return errorResponse(
        'You do not have access to this class group.',
        'UNAUTHORISED'
      );
    }

    // ── A. Collect all Active students in the group ─────────────────────────
    //
    // For each class in the group:
    //   1. Get its term statuses (map of studentId → status).
    //   2. Get its student roster from cache.
    //   3. Keep only students whose status === ACTIVE (or no status row → default Active).

    var activeStudentIds = []; // array of studentId strings

    groupClassIds.forEach(function (classId) {
      var statusMap = SheetService.getClassTermStatuses(classId, activeTerm, activeSession);
      var students  = SheetService.getCachedStudents(classId);

      students.forEach(function (s) {
        var status = statusMap[s.studentId] || STUDENT_STATUS.ACTIVE;
        if (status === STUDENT_STATUS.ACTIVE) {
          activeStudentIds.push(String(s.studentId));
        }
      });
    });

    var activeCount = activeStudentIds.length;

    // Build a Set-like object for O(1) student lookups later
    var activeStudentSet = {};
    activeStudentIds.forEach(function (id) { activeStudentSet[id] = true; });

    // ── B. Collect subject IDs assigned to the group ────────────────────────

    var allAssignments = SheetService.getClassSubjectAssignments(activeSession);
    var subjectIdsSeen = {};
    var subjectIds     = [];

    allAssignments.forEach(function (csa) {
      var inGroup = groupClassIds.some(function (id) {
        return String(id) === String(csa.classId);
      });
      if (inGroup && !subjectIdsSeen[csa.subjectId]) {
        subjectIdsSeen[csa.subjectId] = true;
        subjectIds.push(String(csa.subjectId));
      }
    });

    var subjectCount = subjectIds.length;

    // ── C. Bulk-read Scores, PSQ, and Remarks (3 reads for the whole group) ─

    var groupScores  = SheetService.getScoresForClassGroup(groupClassIds, activeTerm, activeSession);
    var groupPSQ     = SheetService.getAllClassPSQForGroup(groupClassIds, activeTerm, activeSession);
    var groupRemarks = SheetService.getAllClassRemarksForGroup(groupClassIds, activeTerm, activeSession);

    // ── D. Score completeness check ─────────────────────────────────────────
    //
    // Build a quick lookup: "studentId|subjectId|component" → true (score exists & non-empty)
    // A score "exists" if its value is not undefined, null, or empty string.

    var scorePresent = {};
    groupScores.forEach(function (r) {
      if (activeStudentSet[String(r.studentId)] &&
          (r.score !== undefined && r.score !== null && String(r.score).trim() !== '')) {
        scorePresent[r.studentId + '|' + r.subjectId + '|' + r.component] = true;
      }
    });

    // Count how many of the required (student × subject × component) triplets are present
    var scoresRequired = activeCount * subjectCount * COMPONENT_ORDER.length;
    var scoresEntered  = 0;

    activeStudentIds.forEach(function (studentId) {
      subjectIds.forEach(function (subjectId) {
        COMPONENT_ORDER.forEach(function (component) {
          if (scorePresent[studentId + '|' + subjectId + '|' + component]) {
            scoresEntered++;
          }
        });
      });
    });

    var scoresComplete      = (scoresRequired > 0) && (scoresEntered === scoresRequired);

    // ── E. PSQ completeness check ───────────────────────────────────────────
    //
    // Build a lookup: studentId → number of PSQ traits filled in for that student.
    // A trait "filled in" means the value is a number between 1 and 5 (non-empty, non-null).

    var psqTraitsFilled = {}; // studentId → count of filled traits
    activeStudentIds.forEach(function (id) { psqTraitsFilled[id] = 0; });

    groupPSQ.forEach(function (r) {
      var sid = String(r.studentId);
      if (!activeStudentSet[sid]) return; // skip non-active students

      PSQ_TRAITS.forEach(function (trait) {
        var key = toCamelCase(trait);
        var val = r[key];
        // A valid rating is a number 1–5 (stored as number or numeric string)
        var num = Number(val);
        if (val !== undefined && val !== null && val !== '' && !isNaN(num) && num >= 1 && num <= 5) {
          psqTraitsFilled[sid] = (psqTraitsFilled[sid] || 0) + 1;
        }
      });
    });

    // Each active student must have all 16 PSQ traits filled in
    var psqStudentsComplete = 0;
    activeStudentIds.forEach(function (id) {
      if ((psqTraitsFilled[id] || 0) === PSQ_TRAITS.length) {
        psqStudentsComplete++;
      }
    });

    var psqComplete = (activeCount > 0) && (psqStudentsComplete === activeCount);

    // ── F. Remark completeness check ────────────────────────────────────────
    //
    // Build a lookup: studentId → true if remark exists with ≥1 non-whitespace char.

    var remarkPresent = {}; // studentId → true
    groupRemarks.forEach(function (r) {
      var sid = String(r.studentId);
      if (activeStudentSet[sid] && r.remark && String(r.remark).trim().length >= 1) {
        remarkPresent[sid] = true;
      }
    });

    var remarkStudentsComplete = 0;
    activeStudentIds.forEach(function (id) {
      if (remarkPresent[id]) remarkStudentsComplete++;
    });

    var remarkComplete = (activeCount > 0) && (remarkStudentsComplete === activeCount);

    // ── G. Final unlock flags ───────────────────────────────────────────────
    //
    // broadsheetUnlocked: all scores done.
    // resultsUnlocked:    all scores + PSQ + remarks done.
    //
    // Edge case: if there are no active students, treat everything as unlocked
    // (there is nothing to check — the teacher should still be able to proceed).

    var broadsheetUnlocked = (activeCount === 0) || scoresComplete;
    var resultsUnlocked    = broadsheetUnlocked && ((activeCount === 0) || (psqComplete && remarkComplete));

    // ── H. Return result with detailed breakdown ─────────────────────────────

    return successResponse({
      broadsheetUnlocked: broadsheetUnlocked,
      resultsUnlocked:    resultsUnlocked,

      // Granular detail — useful for future progress indicators or debugging
      detail: {
        activeStudentCount: activeCount,
        subjectCount:       subjectCount,
        componentCount:     COMPONENT_ORDER.length,

        scores: {
          required: scoresRequired,
          entered:  scoresEntered,
          complete: scoresComplete
        },

        psq: {
          studentsRequired: activeCount,
          studentsComplete: psqStudentsComplete,
          complete:         psqComplete
        },

        remarks: {
          studentsRequired: activeCount,
          studentsComplete: remarkStudentsComplete,
          complete:         remarkComplete
        }
      }
    });
  }

  // ─── PUBLIC API ─────────────────────────────────────────────────────────────

  return {
    getClassGroupCompletion
  };

})();
