/**
 * HGUS Academic Result Management System
 * Code.gs — Entry point and server-callable API
 *
 * Every function prefixed with `server` is callable from the browser via
 * google.script.run.serverFunctionName(args).
 *
 * Stage 4 additions (Broadsheet & Result Generation):
 *   - serverGetClassGroups          — list of class groups (Admin: all; FM: own class only)
 *   - serverGetBroadsheetSubjects   — subjects + students for a class group
 *   - serverGetBroadsheetForSubject — full computed broadsheet for one subject
 *   - serverGetBroadsheetForClass   — full per-class totals broadsheet (all subjects)
 *   - serverGetStudentResult        — full assembled result for one student
 *   - serverDeleteUser              — permanently remove a user account (Super Admin only)
 *
 * Stage 5 additions (Locks & PDF Export):
 *   - serverGetClassGroupCompletion — data completeness state for a class group
 *                                      (drives the locked/unlocked UI buttons)
 *   - serverGenerateResultSlipPDF   — PDF for one student (base64-encoded)
 *   - serverGenerateBulkResultsPDF  — combined PDF for all active students (base64-encoded)
 *
 * Stage 5 modifications:
 *   - serverGetBroadsheetForClass: now checks broadsheetUnlocked before proceeding;
 *                                   returns errorResponse('...', 'LOCKED') if not ready.
 *   - serverGetStudentResult:       now checks resultsUnlocked before proceeding;
 *                                   returns errorResponse('...', 'LOCKED') if not ready.
 *   - serverGetBroadsheetSubjects and serverGetBroadsheetForSubject:
 *                                   NO lock check — always accessible.
 *
 * IMPORTANT: google.script.run cannot pass undefined — use null for optional args.
 */

// ─── WEB APP ENTRY POINT ──────────────────────────────────────────────────────

function doGet(e) {
  return HtmlService
    .createTemplateFromFile('Index')
    .evaluate()
    .setTitle('HGUS Academic System')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ─── AUTH ENDPOINTS ───────────────────────────────────────────────────────────

function serverLogin(username, password) {
  try {
    return AuthService.login(username, password);
  } catch (e) {
    Logger.log('serverLogin error: ' + e.message);
    return errorResponse('An unexpected error occurred. Please try again.', 'SERVER_ERROR');
  }
}

function serverValidateSession(token) {
  try {
    const session = AuthService.validateToken(token);
    if (!session) return { valid: false };
    const settings = SheetService.getSessionSettings();
    return { valid: true, session: session, settings: settings };
  } catch (e) {
    Logger.log('serverValidateSession error: ' + e.message);
    return { valid: false };
  }
}

function serverLogout(token) {
  try {
    AuthService.invalidateToken(token);
    return successResponse({});
  } catch (e) {
    return errorResponse(e.message);
  }
}

function serverForceChangePassword(token, newPassword, confirmPassword) {
  try {
    if (!newPassword || newPassword.trim().length === 0) {
      return errorResponse('New password is required.', 'VALIDATION_ERROR');
    }
    if (newPassword !== confirmPassword) {
      return errorResponse('Passwords do not match.', 'VALIDATION_ERROR');
    }
    return AuthService.forceChangePassword(token, newPassword);
  } catch (e) {
    Logger.log('serverForceChangePassword error: ' + e.message);
    return errorResponse('An unexpected error occurred.', 'SERVER_ERROR');
  }
}

function serverChangePassword(token, currentPassword, newPassword, confirmPassword) {
  try {
    if (!newPassword || newPassword.trim().length === 0) {
      return errorResponse('New password is required.', 'VALIDATION_ERROR');
    }
    if (newPassword !== confirmPassword) {
      return errorResponse('New passwords do not match.', 'VALIDATION_ERROR');
    }
    return AuthService.changePassword(token, currentPassword, newPassword);
  } catch (e) {
    Logger.log('serverChangePassword error: ' + e.message);
    return errorResponse('An unexpected error occurred.', 'SERVER_ERROR');
  }
}

// ─── USER MANAGEMENT ENDPOINTS ───────────────────────────────────────────────

function serverCheckUsername(username) {
  try {
    return UserService.checkUsername(username);
  } catch (e) {
    return { available: false, reason: 'Could not check username availability.' };
  }
}

function serverGetUserList(token) {
  try {
    return UserService.getUserList(token);
  } catch (e) {
    Logger.log('serverGetUserList error: ' + e.message);
    return errorResponse(e.message);
  }
}

function serverGetUser(token, staffId) {
  try {
    return UserService.getUser(token, staffId);
  } catch (e) {
    Logger.log('serverGetUser error: ' + e.message);
    return errorResponse(e.message);
  }
}

function serverAddUser(token, userData) {
  try {
    return UserService.addUser(token, userData);
  } catch (e) {
    Logger.log('serverAddUser error: ' + e.message);
    return errorResponse(e.message);
  }
}

function serverUpdateUser(token, staffId, updates) {
  try {
    return UserService.updateUser(token, staffId, updates);
  } catch (e) {
    Logger.log('serverUpdateUser error: ' + e.message);
    return errorResponse(e.message);
  }
}

function serverResetPassword(token, staffId, newTempPassword) {
  try {
    return AuthService.resetPassword(token, staffId, newTempPassword);
  } catch (e) {
    Logger.log('serverResetPassword error: ' + e.message);
    return errorResponse(e.message);
  }
}

function serverChangeRole(token, staffId, newRole) {
  try {
    return UserService.changeRole(token, staffId, newRole);
  } catch (e) {
    Logger.log('serverChangeRole error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Permanently delete a staff user account from the system.
 *
 * Rules enforced server-side (in addition to what the UI checks):
 *   1. Caller must be Super Admin.
 *   2. A Super Admin cannot delete their own account.
 *   3. Super Admin accounts are protected — demote the role first.
 *
 * NOTE: This does NOT automatically remove the user's FM or TS assignments.
 *       Reassign those in Manage Assignments before deleting the account, or
 *       orphaned assignment rows will remain in the sheet (harmless but untidy).
 *
 * @param {string} token   — caller's session token
 * @param {string} staffId — Staff ID of the account to delete
 */
function serverDeleteUser(token, staffId) {
  try {
    // 1. Validate session
    var sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    // 2. Super Admin only
    if (sess.role !== ROLES.SUPER_ADMIN) {
      return errorResponse('Only Super Admins can delete user accounts.', 'UNAUTHORISED');
    }

    // 3. Cannot delete self
    if (String(sess.staffId) === String(staffId)) {
      return errorResponse('You cannot delete your own account.', 'SELF_DELETE');
    }

    // 4. Look up target and protect Super Admin accounts
    var target = SheetService.getUserById(staffId);
    if (!target) return errorResponse('User not found.', 'NOT_FOUND');
    if (target.role === ROLES.SUPER_ADMIN) {
      return errorResponse(
        'Super Admin accounts cannot be deleted. Demote the role first.',
        'PROTECTED'
      );
    }

    // 5. Delete the row
    SheetService.deleteUserRecord(staffId);
    Logger.log('serverDeleteUser: deleted staffId=' + staffId + ' by ' + sess.staffId);
    return successResponse({ message: 'Account for "' + target.name + '" has been permanently deleted.' });
  } catch (e) {
    Logger.log('serverDeleteUser error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ─── SESSION SETTINGS ENDPOINTS ───────────────────────────────────────────────

function serverGetSessionSettings(token) {
  try {
    const session = AuthService.validateToken(token);
    if (!session) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    return successResponse(SheetService.getSessionSettings());
  } catch (e) {
    return errorResponse(e.message);
  }
}

function serverSetSessionSettings(token, settings) {
  try {
    const session = AuthService.validateToken(token);
    if (!session) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    if (![ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(session.role)) {
      return errorResponse('Unauthorised.', 'UNAUTHORISED');
    }
    SheetService.setSessionSettings(settings);
    return successResponse(SheetService.getSessionSettings());
  } catch (e) {
    return errorResponse(e.message);
  }
}

// ─── CLASS ENDPOINTS ──────────────────────────────────────────────────────────

function serverSyncClasses(token, externalSheetId) {
  try {
    return ClassService.syncClasses(token, externalSheetId);
  } catch (e) {
    Logger.log('serverSyncClasses error: ' + e.message);
    return errorResponse('Sync failed: ' + e.message, 'SYNC_ERROR');
  }
}

function serverGetClasses(token) {
  try {
    return ClassService.getClasses(token);
  } catch (e) {
    Logger.log('serverGetClasses error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ─── SUBJECT ENDPOINTS ────────────────────────────────────────────────────────

function serverSyncSubjects(token) {
  try {
    return SubjectService.syncSubjects(token);
  } catch (e) {
    Logger.log('serverSyncSubjects error: ' + e.message);
    return errorResponse('Sync failed: ' + e.message, 'SYNC_ERROR');
  }
}

function serverGetSubjects(token) {
  try {
    return SubjectService.getSubjects(token);
  } catch (e) {
    Logger.log('serverGetSubjects error: ' + e.message);
    return errorResponse(e.message);
  }
}

function serverGetClassSubjectAssignments(token, sessionFilter) {
  try {
    return SubjectService.getClassSubjectAssignments(token, sessionFilter);
  } catch (e) {
    Logger.log('serverGetClassSubjectAssignments error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ─── STUDENT CACHE ENDPOINTS ──────────────────────────────────────────────────

function serverRefreshStudentCache(token, classId) {
  try {
    return StudentService.refreshStudentCache(token, classId || 'all');
  } catch (e) {
    Logger.log('serverRefreshStudentCache error: ' + e.message);
    return errorResponse('Refresh failed: ' + e.message, 'REFRESH_ERROR');
  }
}

function serverGetCachedStudents(token, classId) {
  try {
    return StudentService.getCachedStudents(token, classId);
  } catch (e) {
    Logger.log('serverGetCachedStudents error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ─── FORM MASTER ASSIGNMENT ENDPOINTS ─────────────────────────────────────────

function serverGetFormMasterAssignments(token) {
  try {
    return AssignmentService.getFormMasterAssignments(token);
  } catch (e) {
    Logger.log('serverGetFormMasterAssignments error: ' + e.message);
    return errorResponse(e.message);
  }
}

function serverSetFormMasterAssignment(token, data) {
  try {
    return AssignmentService.setFormMasterAssignment(token, data);
  } catch (e) {
    Logger.log('serverSetFormMasterAssignment error: ' + e.message);
    return errorResponse(e.message);
  }
}

function serverRemoveFormMasterAssignment(token, classId) {
  try {
    return AssignmentService.removeFormMasterAssignment(token, classId);
  } catch (e) {
    Logger.log('serverRemoveFormMasterAssignment error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ─── TEACHER-SUBJECT ASSIGNMENT ENDPOINTS ─────────────────────────────────────

function serverGetTeacherAssignments(token) {
  try {
    return AssignmentService.getTeacherSubjectAssignments(token);
  } catch (e) {
    Logger.log('serverGetTeacherAssignments error: ' + e.message);
    return errorResponse(e.message);
  }
}

function serverAddTeacherAssignment(token, data) {
  try {
    return AssignmentService.addTeacherSubjectAssignment(token, data);
  } catch (e) {
    Logger.log('serverAddTeacherAssignment error: ' + e.message);
    return errorResponse(e.message);
  }
}

function serverRemoveTeacherAssignment(token, assignmentId) {
  try {
    return AssignmentService.removeTeacherSubjectAssignment(token, assignmentId);
  } catch (e) {
    Logger.log('serverRemoveTeacherAssignment error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ─── MY ASSIGNMENTS (TEACHER/ADMIN HOME) ──────────────────────────────────────

/**
 * Get the logged-in teacher's (or admin's) own assignment list.
 * Stage 3: returns { fmClasses[], tsAssignments[], session, term }
 * @param {string} token
 */
function serverGetMyAssignments(token) {
  try {
    return AssignmentService.getMyAssignments(token);
  } catch (e) {
    Logger.log('serverGetMyAssignments error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ─── SCORE ENTRY ENDPOINTS ────────────────────────────────────────────────────

/**
 * Get Form Master class overview: students, statuses, subjects.
 * @param {string} token
 * @param {string} classId
 */
function serverGetFMClassOverview(token, classId) {
  try {
    return ScoreService.getFMClassOverview(token, classId);
  } catch (e) {
    Logger.log('serverGetFMClassOverview error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Get component status tiles (entered count, total, lock state) for a class/subject.
 * @param {string} token
 * @param {string} classId
 * @param {string} subjectId
 */
function serverGetComponentStatuses(token, classId, subjectId) {
  try {
    return ScoreService.getComponentStatuses(token, classId, subjectId);
  } catch (e) {
    Logger.log('serverGetComponentStatuses error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Get the student roster with existing scores for one component.
 * @param {string} token
 * @param {string} classId
 * @param {string} subjectId
 * @param {string} component  — e.g. 'C/W', 'Test1', 'Exam'
 */
function serverGetScoresForComponent(token, classId, subjectId, component) {
  try {
    return ScoreService.getScoresForComponent(token, classId, subjectId, component);
  } catch (e) {
    Logger.log('serverGetScoresForComponent error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Save scores for a whole class (one component).
 * @param {string} token
 * @param {string} classId
 * @param {string} subjectId
 * @param {string} component
 * @param {{ studentId, score }[]} studentScores
 */
function serverSaveScores(token, classId, subjectId, component, studentScores) {
  try {
    return ScoreService.saveScores(token, classId, subjectId, component, studentScores);
  } catch (e) {
    Logger.log('serverSaveScores error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ─── PSQ ENDPOINTS ────────────────────────────────────────────────────────────

/**
 * Get PSQ ratings for a whole class.
 * @param {string} token
 * @param {string} classId
 */
function serverGetClassPSQ(token, classId) {
  try {
    return PSQService.getClassPSQ(token, classId);
  } catch (e) {
    Logger.log('serverGetClassPSQ error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Save PSQ ratings for one student.
 * @param {string} token
 * @param {string} classId
 * @param {string} studentId
 * @param {{ [traitKey]: number }} ratings  — camelCase trait key → rating 1–5
 */
function serverSavePSQ(token, classId, studentId, ratings) {
  try {
    return PSQService.savePSQ(token, classId, studentId, ratings);
  } catch (e) {
    Logger.log('serverSavePSQ error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ─── REMARKS ENDPOINTS ────────────────────────────────────────────────────────

/**
 * Get remarks for a whole class.
 * @param {string} token
 * @param {string} classId
 */
function serverGetClassRemarks(token, classId) {
  try {
    return RemarkService.getClassRemarks(token, classId);
  } catch (e) {
    Logger.log('serverGetClassRemarks error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Save remarks for one or more students in a class.
 * @param {string} token
 * @param {string} classId
 * @param {{ studentId, remark }[]} remarks
 */
function serverSaveRemarks(token, classId, remarks) {
  try {
    return RemarkService.saveRemarks(token, classId, remarks);
  } catch (e) {
    Logger.log('serverSaveRemarks error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ─── STUDENT STATUS ENDPOINTS ─────────────────────────────────────────────────

/**
 * Get term statuses for all students in a class.
 * @param {string} token
 * @param {string} classId
 */
function serverGetClassStudentStatus(token, classId) {
  try {
    return StatusService.getClassStudentStatus(token, classId);
  } catch (e) {
    Logger.log('serverGetClassStudentStatus error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Set the term status of a single student.
 * @param {string} token
 * @param {string} classId
 * @param {string} studentId
 * @param {string} status  — 'Active' | 'Exam Exempt' | 'Not Continuing'
 */
function serverSetStudentStatus(token, classId, studentId, status) {
  try {
    return StatusService.setStudentStatus(token, classId, studentId, status);
  } catch (e) {
    Logger.log('serverSetStudentStatus error: ' + e.message);
    return errorResponse(e.message);
  }
}


// ─── BROADSHEET ENDPOINTS (Stage 4, lock checks added in Stage 5) ────────────

/**
 * Return all distinct class groups available in the current session.
 * Groups are sorted JSS 1 → SSS 3.
 * Admin / Super Admin only.
 *
 * @param {string} token
 * @returns {{ success, data: { groups: [{ groupKey, classIds }] } }}
 */
function serverGetClassGroups(token) {
  try {
    return BroadsheetService.getClassGroups(token);
  } catch (e) {
    Logger.log('serverGetClassGroups error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Get the subjects and student list for a class group.
 * Used by the broadsheetSubjectSelect screen to render the subject selector
 * and the result-slip student list.
 *
 * Stage 5 NOTE: NO lock check — this endpoint is always accessible.
 *   Teachers and admins must always be able to see subject scores;
 *   locking this would block legitimate data entry.
 *
 * @param {string} token
 * @param {string} classGroupKey — e.g. "JSS 2" or "SSS 1"
 * @returns {{ success, data: { classGroupKey, classIds, subjects, students } }}
 */
function serverGetBroadsheetSubjects(token, classGroupKey) {
  try {
    return BroadsheetService.getBroadsheetSubjects(token, classGroupKey);
  } catch (e) {
    Logger.log('serverGetBroadsheetSubjects error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Compute and return the full broadsheet for a class group + subject.
 * Includes every student's component scores, total, grade, and position.
 *
 * Stage 5 NOTE: NO lock check — per-subject broadsheet is always accessible.
 *   Only the full class broadsheet (serverGetBroadsheetForClass) is locked.
 *
 * @param {string} token
 * @param {string} classGroupKey — e.g. "JSS 2" or "SSS 1"
 * @param {string} subjectId
 * @returns {{ success, data: BroadsheetData }}
 */
function serverGetBroadsheetForSubject(token, classGroupKey, subjectId) {
  try {
    return BroadsheetService.getBroadsheetForSubject(token, classGroupKey, subjectId);
  } catch (e) {
    Logger.log('serverGetBroadsheetForSubject error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Compute and return the full per-class broadsheet for a class group.
 * Students are rows; subjects are columns (totals only, not components).
 * Each student also has overallTotal, average, grade, and class position.
 *
 * Stage 5 LOCK CHECK: Returns errorResponse('...', 'LOCKED') if all 6 score
 * components have not been entered for every active student in the group.
 * This prevents generating a broadsheet with incomplete data.
 *
 * HOW THE LOCK CHECK WORKS:
 *   1. Call CompletionService.getClassGroupCompletion() for the group.
 *   2. If completion.data.broadsheetUnlocked === false → return LOCKED error.
 *   3. Otherwise → delegate to BroadsheetService as normal.
 *
 * @param {string} token
 * @param {string} classGroupKey — e.g. "JSS 2" or "SSS 1"
 * @returns {{ success, data: ClassBroadsheetData }}
 */
function serverGetBroadsheetForClass(token, classGroupKey) {
  try {
    // ── Stage 5: Lock check ───────────────────────────────────────────────
    var completion = CompletionService.getClassGroupCompletion(token, classGroupKey);

    // Propagate any auth/session errors from the completion check
    if (!completion.success) return completion;

    if (!completion.data.broadsheetUnlocked) {
      // Build a helpful message showing how many scores are missing
      var d = completion.data.detail;
      var missing = d.scores.required - d.scores.entered;
      return errorResponse(
        'Broadsheet is locked. ' + missing + ' score entr' + (missing === 1 ? 'y' : 'ies') +
        ' still missing. All 6 components must be entered for every active student before the broadsheet can be generated.',
        'LOCKED'
      );
    }

    // ── Proceed with normal broadsheet generation ─────────────────────────
    return BroadsheetService.getBroadsheetForClass(token, classGroupKey);
  } catch (e) {
    Logger.log('serverGetBroadsheetForClass error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ─── RESULT SLIP ENDPOINTS (Stage 4, lock check added in Stage 5) ────────────

/**
 * Assemble the complete result for one student.
 * Includes all subjects (scores, total, grade, position), PSQ ratings,
 * Form Master remark, overall position, and next-term info.
 *
 * Stage 5 LOCK CHECK: Returns errorResponse('...', 'LOCKED') if scores, PSQ,
 * or remarks are not fully complete for every active student in the class group.
 * This prevents viewing a result slip with missing data.
 *
 * HOW THE LOCK CHECK WORKS:
 *   1. Derive the class group key from classId (by looking up the class name
 *      and stripping any SSS department suffix — same logic as ResultService).
 *   2. Call CompletionService.getClassGroupCompletion() for that group.
 *   3. If completion.data.resultsUnlocked === false → return LOCKED error.
 *   4. Otherwise → delegate to ResultService as normal.
 *
 * @param {string} token
 * @param {string} studentId — e.g. "HG0001"
 * @param {string} classId   — the student's specific class (e.g. "CLS002")
 * @returns {{ success, data: StudentResult }}
 */
function serverGetStudentResult(token, studentId, classId) {
  try {
    // ── Stage 5: Derive the group key from classId ────────────────────────
    // We need the group key to call CompletionService.
    // This replicates the getGroupKey_() helper from ResultService/BroadsheetService.
    var allClasses = SheetService.getAllClasses();
    var cls        = allClasses.find(function (c) { return c.classId === classId; }) || {};
    var className  = cls.className || classId;
    var groupKey   = String(className)
      .replace(/\s+(science|art|commerce|humanities|business)\s*$/i, '')
      .trim();

    // ── Stage 5: Lock check ───────────────────────────────────────────────
    var completion = CompletionService.getClassGroupCompletion(token, groupKey);

    // Propagate any auth/session errors
    if (!completion.success) return completion;

    if (!completion.data.resultsUnlocked) {
      // Build a helpful message indicating which checks are still failing
      var d        = completion.data.detail;
      var reasons  = [];
      if (!d.scores.complete) {
        var missing = d.scores.required - d.scores.entered;
        reasons.push(missing + ' score entr' + (missing === 1 ? 'y' : 'ies') + ' missing');
      }
      if (!d.psq.complete) {
        var psqMissing = d.psq.studentsRequired - d.psq.studentsComplete;
        reasons.push('PSQ incomplete for ' + psqMissing + ' student' + (psqMissing === 1 ? '' : 's'));
      }
      if (!d.remarks.complete) {
        var remMissing = d.remarks.studentsRequired - d.remarks.studentsComplete;
        reasons.push('Remarks missing for ' + remMissing + ' student' + (remMissing === 1 ? '' : 's'));
      }
      return errorResponse(
        'Result slip is locked. ' + reasons.join('; ') + '. Complete all data before viewing result slips.',
        'LOCKED'
      );
    }

    // ── Proceed with normal result assembly ───────────────────────────────
    return ResultService.getStudentResult(token, studentId, classId);
  } catch (e) {
    Logger.log('serverGetStudentResult error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ─── COMPLETION ENDPOINT (Stage 5) ───────────────────────────────────────────

/**
 * Return the data completeness state for a class group.
 *
 * This drives the lock/unlock UI in the Class Menu screen (broadsheetClassMenu).
 * The client calls this once when the Class Menu loads, and uses the result to:
 *   - Show a lock icon and blocking message on the "Broadsheet" button if
 *     broadsheetUnlocked === false.
 *   - Show a lock icon and blocking message on the "Results" button if
 *     resultsUnlocked === false.
 *   - Show the buttons as active if the respective flag is true.
 *
 * Also used as the gate-check inside serverGetBroadsheetForClass and
 * serverGetStudentResult (above).
 *
 * @param {string} token
 * @param {string} classGroupKey — e.g. "JSS 2" or "SSS 1"
 * @returns {{
 *   success: boolean,
 *   data: {
 *     broadsheetUnlocked: boolean,
 *     resultsUnlocked:    boolean,
 *     detail: {
 *       activeStudentCount: number,
 *       subjectCount:       number,
 *       componentCount:     number,
 *       scores:   { required, entered, complete },
 *       psq:      { studentsRequired, studentsComplete, complete },
 *       remarks:  { studentsRequired, studentsComplete, complete }
 *     }
 *   }
 * }}
 */
function serverGetClassGroupCompletion(token, classGroupKey) {
  try {
    return CompletionService.getClassGroupCompletion(token, classGroupKey);
  } catch (e) {
    Logger.log('serverGetClassGroupCompletion error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ─── PDF EXPORT ENDPOINTS (Stage 5) ──────────────────────────────────────────

/**
 * Generate a PDF for one student's result slip.
 *
 * Stage 5 LOCK CHECK (enforced here before delegating to PDFService):
 *   Calls serverGetStudentResult-equivalent lock check first.
 *   If resultsUnlocked === false, returns LOCKED error.
 *   This ensures PDFs can only be generated when all data is complete.
 *
 * HOW THE CLIENT USES THE RESULT:
 *   data.base64Pdf  — base64-encoded PDF bytes
 *   data.filename   — suggested filename (e.g. "John_Doe_Term1_2024-2025.pdf")
 *   Client decodes the base64 to a Blob, creates an object URL, and triggers
 *   a download via a hidden <a download> element.
 *
 * @param {string} token
 * @param {string} studentId
 * @param {string} classId
 * @returns {{ success, data: { base64Pdf, filename } }}
 */
function serverGenerateResultSlipPDF(token, studentId, classId) {
  try {
    // ── Lock check (same derivation as serverGetStudentResult) ────────────
    var allClasses = SheetService.getAllClasses();
    var cls        = allClasses.find(function (c) { return c.classId === classId; }) || {};
    var className  = cls.className || classId;
    var groupKey   = String(className)
      .replace(/\s+(science|art|commerce|humanities|business)\s*$/i, '')
      .trim();

    var completion = CompletionService.getClassGroupCompletion(token, groupKey);
    if (!completion.success) return completion;
    if (!completion.data.resultsUnlocked) {
      return errorResponse(
        'PDF generation is locked. Complete all scores, PSQ ratings, and remarks before generating PDFs.',
        'LOCKED'
      );
    }

    // ── Delegate to PDFService ────────────────────────────────────────────
    return PDFService.generateResultSlipPDF(token, studentId, classId);
  } catch (e) {
    Logger.log('serverGenerateResultSlipPDF error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Generate a combined PDF with one result slip per active student in the group.
 *
 * Stage 5 LOCK CHECK: same resultsUnlocked gate as serverGetStudentResult.
 *   All data (scores, PSQ, remarks) must be complete for every active student
 *   in the group before the bulk PDF can be generated.
 *
 * HOW THE CLIENT USES THE RESULT:
 *   data.base64Pdf    — base64-encoded combined PDF bytes
 *   data.filename     — suggested filename
 *   data.studentCount — number of student slips in the PDF
 *
 * NOTE: This can be slow for large class groups because it assembles one
 * result per student. GAS has a 6-minute execution limit; typical classes
 * of 30–50 students should complete well within that limit.
 *
 * @param {string} token
 * @param {string} classGroupKey — e.g. "JSS 2" or "SSS 1"
 * @returns {{ success, data: { base64Pdf, filename, studentCount } }}
 */
function serverGenerateBulkResultsPDF(token, classGroupKey) {
  try {
    // ── Lock check ────────────────────────────────────────────────────────
    var completion = CompletionService.getClassGroupCompletion(token, classGroupKey);
    if (!completion.success) return completion;
    if (!completion.data.resultsUnlocked) {
      return errorResponse(
        'PDF generation is locked. Complete all scores, PSQ ratings, and remarks before generating bulk PDFs.',
        'LOCKED'
      );
    }

    // ── Delegate to PDFService ────────────────────────────────────────────
    return PDFService.generateBulkResultsPDF(token, classGroupKey);
  } catch (e) {
    Logger.log('serverGenerateBulkResultsPDF error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ─── SETUP ENDPOINT ───────────────────────────────────────────────────────────

function serverRunSetup() {
  try {
    const message = setupSheets();
    return successResponse({ message: message });
  } catch (e) {
    Logger.log('serverRunSetup error: ' + e.message);
    return errorResponse('Setup failed: ' + e.message, 'SETUP_ERROR');
  }
}

