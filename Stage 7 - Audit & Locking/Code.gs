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
 *   - serverGenerateResultSlipPDF   — PDF for one student (base64-encoded)
 *   - serverGenerateBulkResultsPDF  — combined PDF for all active students (base64-encoded)
 *
 * Stage 5 modifications:
 *   - serverGetBroadsheetForClass: now checks broadsheetUnlocked before proceeding.
 *   - serverGetStudentResult:       now checks resultsUnlocked before proceeding.
 *
 * Stage 6 additions (Exports & Overview):
 *   - serverGetResultsOverview      — school-wide completion dashboard (Admin only)
 *   - serverGetBroadsheetPDF        — broadsheet export as landscape PDF (base64)
 *   - serverGetBroadsheetExcel      — broadsheet export as XLSX (base64)
 *   - serverGetScoreSheetPDF        — per-subject score sheet PDF with signature block
 *   - serverGetCarryForwardPreview  — preview what would be copied from prior term
 *   - serverExecuteCarryForward     — copy assignments from prior term into active term
 *
 * Stage 7 additions (Audit Log + Result Locking):
 *   - serverLockClassTerm           — lock a class-term (Admin only)
 *   - serverUnlockClassTerm         — unlock a class-term (Admin only)
 *   - serverGetClassTermLockStatus  — get lock state for UI badge/button
 *   - serverGetClassLockStates      — get lock states for all classes (class list screen)
 *   - serverGetActivityLog          — filtered activity log for in-app viewer
 *   - serverGetSuperAdminSettings   — read SA preferences (adminCanViewLog)
 *   - serverSetSuperAdminSettings   — save SA preferences
 *   serverLogin / serverLogout / serverResetPassword / serverAddUser / serverUpdateUser /
 *   serverChangeRole / serverSetSessionSettings — wrappers now also call LogService.logActivity
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

function serverDeleteUser(token, staffId) {
  try {
    var sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    if (sess.role !== ROLES.SUPER_ADMIN) {
      return errorResponse('Only Super Admins can delete user accounts.', 'UNAUTHORISED');
    }

    if (String(sess.staffId) === String(staffId)) {
      return errorResponse('You cannot delete your own account.', 'SELF_DELETE');
    }

    var target = SheetService.getUserById(staffId);
    if (!target) return errorResponse('User not found.', 'NOT_FOUND');
    if (target.role === ROLES.SUPER_ADMIN) {
      return errorResponse(
        'Super Admin accounts cannot be deleted. Demote the role first.',
        'PROTECTED'
      );
    }

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

function serverGetStudentDataSources(token) {
  try {
    return ClassService.getStudentDataSources(token);
  } catch (e) {
    Logger.log('serverGetStudentDataSources error: ' + e.message);
    return errorResponse('Could not read data sources: ' + e.message, 'SYNC_ERROR');
  }
}

function serverSyncClasses(token, externalSheetId, tabName) {
  try {
    return ClassService.syncClasses(token, externalSheetId, tabName);
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

function serverGetMyAssignments(token) {
  try {
    return AssignmentService.getMyAssignments(token);
  } catch (e) {
    Logger.log('serverGetMyAssignments error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ─── SCORE ENTRY ENDPOINTS ────────────────────────────────────────────────────

function serverGetFMClassOverview(token, classId) {
  try {
    return ScoreService.getFMClassOverview(token, classId);
  } catch (e) {
    Logger.log('serverGetFMClassOverview error: ' + e.message);
    return errorResponse(e.message);
  }
}

function serverGetComponentStatuses(token, classId, subjectId) {
  try {
    return ScoreService.getComponentStatuses(token, classId, subjectId);
  } catch (e) {
    Logger.log('serverGetComponentStatuses error: ' + e.message);
    return errorResponse(e.message);
  }
}

function serverGetScoresForComponent(token, classId, subjectId, component) {
  try {
    return ScoreService.getScoresForComponent(token, classId, subjectId, component);
  } catch (e) {
    Logger.log('serverGetScoresForComponent error: ' + e.message);
    return errorResponse(e.message);
  }
}

function serverSaveScores(token, classId, subjectId, component, studentScores) {
  try {
    return ScoreService.saveScores(token, classId, subjectId, component, studentScores);
  } catch (e) {
    Logger.log('serverSaveScores error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ─── PSQ ENDPOINTS ────────────────────────────────────────────────────────────

function serverGetClassPSQ(token, classId) {
  try {
    return PSQService.getClassPSQ(token, classId);
  } catch (e) {
    Logger.log('serverGetClassPSQ error: ' + e.message);
    return errorResponse(e.message);
  }
}

function serverSavePSQ(token, classId, studentId, ratings) {
  try {
    return PSQService.savePSQ(token, classId, studentId, ratings);
  } catch (e) {
    Logger.log('serverSavePSQ error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ─── REMARKS ENDPOINTS ────────────────────────────────────────────────────────

function serverGetClassRemarks(token, classId) {
  try {
    return RemarkService.getClassRemarks(token, classId);
  } catch (e) {
    Logger.log('serverGetClassRemarks error: ' + e.message);
    return errorResponse(e.message);
  }
}

function serverSaveRemarks(token, classId, remarks) {
  try {
    return RemarkService.saveRemarks(token, classId, remarks);
  } catch (e) {
    Logger.log('serverSaveRemarks error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ─── STUDENT STATUS ENDPOINTS ─────────────────────────────────────────────────

function serverGetClassStudentStatus(token, classId) {
  try {
    return StatusService.getClassStudentStatus(token, classId);
  } catch (e) {
    Logger.log('serverGetClassStudentStatus error: ' + e.message);
    return errorResponse(e.message);
  }
}

function serverSetStudentStatus(token, classId, studentId, status) {
  try {
    return StatusService.setStudentStatus(token, classId, studentId, status);
  } catch (e) {
    Logger.log('serverSetStudentStatus error: ' + e.message);
    return errorResponse(e.message);
  }
}

function serverUpdateStudentCorrection(token, classId, studentId, editedName, editedGender) {
  try {
    return StatusService.updateStudentCorrection(token, classId, studentId, editedName, editedGender);
  } catch (e) {
    Logger.log('serverUpdateStudentCorrection error: ' + e.message);
    return errorResponse(e.message);
  }
}

function serverClearStudentCorrection(token, studentId) {
  try {
    return StatusService.clearStudentCorrection(token, studentId);
  } catch (e) {
    Logger.log('serverClearStudentCorrection error: ' + e.message);
    return errorResponse(e.message);
  }
}


// ─── BROADSHEET ENDPOINTS (Stage 4, lock checks added in Stage 5) ────────────

function serverGetClassGroups(token) {
  try {
    return BroadsheetService.getClassGroups(token);
  } catch (e) {
    Logger.log('serverGetClassGroups error: ' + e.message);
    return errorResponse(e.message);
  }
}

function serverGetBroadsheetSubjects(token, classGroupKey) {
  try {
    return BroadsheetService.getBroadsheetSubjects(token, classGroupKey);
  } catch (e) {
    Logger.log('serverGetBroadsheetSubjects error: ' + e.message);
    return errorResponse(e.message);
  }
}

function serverGetBroadsheetForSubject(token, classGroupKey, subjectId) {
  try {
    return BroadsheetService.getBroadsheetForSubject(token, classGroupKey, subjectId);
  } catch (e) {
    Logger.log('serverGetBroadsheetForSubject error: ' + e.message);
    return errorResponse(e.message);
  }
}

function serverGetBroadsheetForClass(token, classGroupKey) {
  try {
    var completion = CompletionService.getClassGroupCompletion(token, classGroupKey);
    if (!completion.success) return completion;

    if (!completion.data.broadsheetUnlocked) {
      var d = completion.data.detail;
      var missing = d.scores.required - d.scores.entered;
      return errorResponse(
        'Broadsheet is locked. ' + missing + ' score entr' + (missing === 1 ? 'y' : 'ies') +
        ' still missing. All 6 components must be entered for every active student before the broadsheet can be generated.',
        'LOCKED'
      );
    }

    return BroadsheetService.getBroadsheetForClass(token, classGroupKey);
  } catch (e) {
    Logger.log('serverGetBroadsheetForClass error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ─── RESULT SLIP ENDPOINTS (Stage 4, lock check added in Stage 5) ────────────

function serverGetStudentResult(token, studentId, classId) {
  try {
    var allClasses = SheetService.getAllClasses();
    var cls        = allClasses.find(function (c) { return c.classId === classId; }) || {};
    var className  = cls.className || classId;
    var groupKey   = String(className)
      .replace(/\s+(science|art|commerce|humanities|business)\s*$/i, '')
      .trim();

    var completion = CompletionService.getClassGroupCompletion(token, groupKey);
    if (!completion.success) return completion;

    if (!completion.data.resultsUnlocked) {
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

    return ResultService.getStudentResult(token, studentId, classId);
  } catch (e) {
    Logger.log('serverGetStudentResult error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ─── COMPLETION ENDPOINT (Stage 5) ───────────────────────────────────────────

function serverGetClassGroupCompletion(token, classGroupKey) {
  try {
    return CompletionService.getClassGroupCompletion(token, classGroupKey);
  } catch (e) {
    Logger.log('serverGetClassGroupCompletion error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ─── PDF EXPORT ENDPOINTS (Stage 5) ──────────────────────────────────────────

function serverGenerateResultSlipPDF(token, studentId, classId) {
  try {
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

    return PDFService.generateResultSlipPDF(token, studentId, classId);
  } catch (e) {
    Logger.log('serverGenerateResultSlipPDF error: ' + e.message);
    return errorResponse(e.message);
  }
}

function serverGenerateBulkResultsPDF(token, classGroupKey) {
  try {
    var completion = CompletionService.getClassGroupCompletion(token, classGroupKey);
    if (!completion.success) return completion;
    if (!completion.data.resultsUnlocked) {
      return errorResponse(
        'PDF generation is locked. Complete all scores, PSQ ratings, and remarks before generating bulk PDFs.',
        'LOCKED'
      );
    }

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

// ═══════════════════════════════════════════════════════════════════════════════
// STAGE 6 ADDITIONS — append-only, nothing above this line was changed
// ═══════════════════════════════════════════════════════════════════════════════

// ─── RESULTS OVERVIEW ENDPOINT (Stage 6) ──────────────────────────────────────

function serverGetResultsOverview(token) {
  try {
    return OverviewService.getResultsOverview(token);
  } catch (e) {
    Logger.log('serverGetResultsOverview error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ─── BROADSHEET EXPORT ENDPOINTS (Stage 6) ────────────────────────────────────

function serverGetBroadsheetPDF(token, classGroupKey) {
  try {
    var completion = CompletionService.getClassGroupCompletion(token, classGroupKey);
    if (!completion.success) return completion;
    if (!completion.data.broadsheetUnlocked) {
      var d       = completion.data.detail;
      var missing = d.scores.required - d.scores.entered;
      return errorResponse(
        'Broadsheet PDF is locked. ' + missing + ' score entr' + (missing === 1 ? 'y' : 'ies') +
        ' still missing. Complete all scores before exporting.',
        'LOCKED'
      );
    }

    return ExportService.getBroadsheetPDF(token, classGroupKey);
  } catch (e) {
    Logger.log('serverGetBroadsheetPDF error: ' + e.message);
    return errorResponse(e.message);
  }
}

function serverGetBroadsheetExcel(token, classGroupKey) {
  try {
    var completion = CompletionService.getClassGroupCompletion(token, classGroupKey);
    if (!completion.success) return completion;
    if (!completion.data.broadsheetUnlocked) {
      var d       = completion.data.detail;
      var missing = d.scores.required - d.scores.entered;
      return errorResponse(
        'Broadsheet Excel is locked. ' + missing + ' score entr' + (missing === 1 ? 'y' : 'ies') +
        ' still missing. Complete all scores before exporting.',
        'LOCKED'
      );
    }

    return ExportService.getBroadsheetExcel(token, classGroupKey);
  } catch (e) {
    Logger.log('serverGetBroadsheetExcel error: ' + e.message);
    return errorResponse(e.message);
  }
}

function serverGetScoreSheetPDF(token, classGroupKey, subjectId) {
  try {
    return ExportService.getScoreSheetPDF(token, classGroupKey, subjectId);
  } catch (e) {
    Logger.log('serverGetScoreSheetPDF error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ─── CARRY-FORWARD ENDPOINTS (Stage 6) ────────────────────────────────────────

function serverGetCarryForwardPreview(token) {
  try {
    return CarryForwardService.getCarryForwardPreview(token);
  } catch (e) {
    Logger.log('serverGetCarryForwardPreview error: ' + e.message);
    return errorResponse(e.message);
  }
}

function serverExecuteCarryForward(token) {
  try {
    return CarryForwardService.executeCarryForward(token);
  } catch (e) {
    Logger.log('serverExecuteCarryForward error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STAGE 7 ADDITIONS — append-only, nothing above this line was changed
// ═══════════════════════════════════════════════════════════════════════════════

// ─── RESULT LOCKING ENDPOINTS (Stage 7) ───────────────────────────────────────

/**
 * Lock a class-term to prevent further score saves.
 *
 * Admin / Super Admin only.
 * The lock is logged in the Activity Log automatically (inside LockService).
 *
 * @param {string} token
 * @param {string} classId
 * @returns {{ success, data: { classId, term, session, isLocked, lockedBy, lockedAt } }}
 */
function serverLockClassTerm(token, classId) {
  try {
    return LockService.lockClassTerm(token, classId);
  } catch (e) {
    Logger.log('serverLockClassTerm error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Unlock a class-term to allow score saves again.
 *
 * Admin / Super Admin only.
 * The unlock is logged in the Activity Log automatically (inside LockService).
 *
 * @param {string} token
 * @param {string} classId
 * @returns {{ success, data: { classId, term, session, isLocked } }}
 */
function serverUnlockClassTerm(token, classId) {
  try {
    return LockService.unlockClassTerm(token, classId);
  } catch (e) {
    Logger.log('serverUnlockClassTerm error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Get the lock state for a single class in the active term/session.
 * Used by the class detail screen to show the Lock/Unlock button.
 *
 * @param {string} token
 * @param {string} classId
 * @returns {{ success, data: { classId, term, session, isLocked, lockedBy, lockedAt } }}
 */
function serverGetClassTermLockStatus(token, classId) {
  try {
    return LockService.getClassTermLockStatus(token, classId);
  } catch (e) {
    Logger.log('serverGetClassTermLockStatus error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Return the lock state for ALL classes in the active session.
 *
 * Used by the Classes & Subjects screen to render padlock badges
 * on locked classes without making one request per class.
 *
 * Returns a map: { [classId]: boolean } — true = locked.
 *
 * Any logged-in user can call this (read-only).
 *
 * @param {string} token
 * @returns {{ success, data: { lockMap: { [classId]: boolean }, term, session } }}
 */
function serverGetClassLockStates(token) {
  try {
    var sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    var settings = SheetService.getSessionSettings();
    var session  = settings.activeSession;
    var term     = settings.activeTerm;

    var locks    = SheetService.getResultLocksForSession(session);
    var lockMap  = {};

    locks.forEach(function (r) {
      if (String(r.term) === String(term)) {
        lockMap[r.classId] = toBoolean(r.isLocked);
      }
    });

    return successResponse({ lockMap: lockMap, term: term, session: session });
  } catch (e) {
    Logger.log('serverGetClassLockStates error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ─── ACTIVITY LOG ENDPOINTS (Stage 7) ─────────────────────────────────────────

/**
 * Fetch activity log entries for the in-app Activity Log screen.
 *
 * Access rules (enforced server-side):
 *   Super Admin — sees all categories.
 *   Admin       — sees all categories EXCEPT Auth, but ONLY if the Super Admin
 *                 has enabled "Allow Admins to view log" in Super Admin Settings.
 *   Teacher     — no access (returns UNAUTHORISED).
 *
 * @param {string} token
 * @param {Object|null} filters  — { category, staffId, dateFrom, dateTo }
 *                                  All fields optional; pass null for no filter.
 * @param {number|null} limit    — max entries to return (default 200)
 * @returns {{ success, data: { entries, totalCount, canViewLog } }}
 */
function serverGetActivityLog(token, filters, limit) {
  try {
    var sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    // Teachers cannot view the activity log at all
    if (sess.role === ROLES.TEACHER) {
      return errorResponse('Access denied.', 'UNAUTHORISED');
    }

    // Admins can only view if Super Admin has enabled it
    if (sess.role === ROLES.ADMIN) {
      var saSettings = LogService.getSuperAdminSettings();
      if (!saSettings.adminCanViewLog) {
        return errorResponse(
          'Activity Log is not enabled for Admins. Ask your Super Admin to enable it.',
          'UNAUTHORISED'
        );
      }
    }

    var result = LogService.getActivityLog(sess, filters || {}, limit || 200);
    return successResponse(result);
  } catch (e) {
    Logger.log('serverGetActivityLog error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ─── SUPER ADMIN SETTINGS ENDPOINTS (Stage 7) ────────────────────────────────

/**
 * Read Super Admin preferences (currently: adminCanViewLog flag).
 * Super Admin only.
 *
 * @param {string} token
 * @returns {{ success, data: { adminCanViewLog: boolean } }}
 */
function serverGetSuperAdminSettings(token) {
  try {
    var sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    if (sess.role !== ROLES.SUPER_ADMIN) {
      return errorResponse('Super Admin only.', 'UNAUTHORISED');
    }
    return successResponse(LogService.getSuperAdminSettings());
  } catch (e) {
    Logger.log('serverGetSuperAdminSettings error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Save Super Admin preferences.
 * Super Admin only.
 *
 * @param {string} token
 * @param {{ adminCanViewLog: boolean }} settings
 * @returns {{ success, data: { adminCanViewLog: boolean } }}
 */
function serverSetSuperAdminSettings(token, settings) {
  try {
    var sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    if (sess.role !== ROLES.SUPER_ADMIN) {
      return errorResponse('Super Admin only.', 'UNAUTHORISED');
    }
    LogService.setSuperAdminSettings(settings);
    return successResponse(LogService.getSuperAdminSettings());
  } catch (e) {
    Logger.log('serverSetSuperAdminSettings error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ─── STAGE 7: AUTH ACTIVITY LOGGING ──────────────────────────────────────────
//
// The functions below are thin wrappers that add Activity Log calls around
// the existing Auth/User actions. They delegate entirely to the original
// service functions and only add the log call on success.
//
// WHY here and not in the service files?
//   The rule is "never modify what came before." AuthService and UserService
//   are Stage 1 files that we cannot change. Wrapping from Code.gs is the
//   clean way to add logging without touching prior-stage code.
//
// These wrappers REPLACE the earlier server functions of the same name.
// Google Apps Script executes function declarations in order — the LAST
// declaration of a function name wins. So the Stage 7 versions below
// override the Stage 1-6 versions above.

/**
 * Override serverLogin to log Auth events.
 *
 * Logs:
 *   - "Login success" on successful login
 *   - "Login failed" on wrong password / unknown user
 */
function serverLogin(username, password) {
  try {
    var result = AuthService.login(username, password);

    // Build a minimal session-like object for the log (no real sess available).
    // AuthService.login may return a flat response { success, staffId, name, role, token, ... }
    // OR a nested one { success, data: { staffId, name, role, token, ... } }.
    // We handle both shapes so the success check never accidentally falls through.
    var logSess = null;
    if (result && result.success) {
      var d = (result.data && typeof result.data === 'object') ? result.data : result;
      logSess = {
        staffId: d.staffId || '',
        name:    d.name    || '',
        role:    d.role    || ''
      };
      LogService.logActivity(logSess, LOG_CATEGORIES.AUTH, 'Login success', username);
    } else {
      // Failed login — attribute to username only (no staffId known)
      LogService.logActivity(
        { staffId: '', name: '', role: '' },
        LOG_CATEGORIES.AUTH,
        'Login failed',
        'Username: ' + username
      );
    }

    return result;
  } catch (e) {
    Logger.log('serverLogin error: ' + e.message);
    return errorResponse('An unexpected error occurred. Please try again.', 'SERVER_ERROR');
  }
}

/**
 * Override serverResetPassword to log Auth events.
 */
function serverResetPassword(token, staffId, newTempPassword) {
  try {
    var sess   = AuthService.validateToken(token);
    var result = AuthService.resetPassword(token, staffId, newTempPassword);

    if (result && result.success) {
      var target = SheetService.getUserById(staffId);
      LogService.logActivity(
        sess,
        LOG_CATEGORIES.AUTH,
        'Password reset',
        'Target: ' + staffId + (target ? ' (' + target.name + ')' : '')
      );
    }

    return result;
  } catch (e) {
    Logger.log('serverResetPassword error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Override serverAddUser to log User Management events.
 */
function serverAddUser(token, userData) {
  try {
    var sess   = AuthService.validateToken(token);
    var result = UserService.addUser(token, userData);

    if (result && result.success) {
      LogService.logActivity(
        sess,
        LOG_CATEGORIES.USER_MGMT,
        'User created',
        (userData.name || '') + ' | ' + (userData.role || '') + ' | ' + (userData.username || '')
      );
    }

    return result;
  } catch (e) {
    Logger.log('serverAddUser error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Override serverChangeRole to log User Management events.
 */
function serverChangeRole(token, staffId, newRole) {
  try {
    var sess   = AuthService.validateToken(token);
    var target = SheetService.getUserById(staffId);
    var result = UserService.changeRole(token, staffId, newRole);

    if (result && result.success) {
      LogService.logActivity(
        sess,
        LOG_CATEGORIES.USER_MGMT,
        'Role changed',
        staffId + (target ? ' (' + target.name + ')' : '') + ' → ' + newRole
      );
    }

    return result;
  } catch (e) {
    Logger.log('serverChangeRole error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Override serverDeleteUser to log User Management events.
 */
function serverDeleteUser(token, staffId) {
  try {
    var sess   = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    if (sess.role !== ROLES.SUPER_ADMIN) {
      return errorResponse('Only Super Admins can delete user accounts.', 'UNAUTHORISED');
    }

    if (String(sess.staffId) === String(staffId)) {
      return errorResponse('You cannot delete your own account.', 'SELF_DELETE');
    }

    var target = SheetService.getUserById(staffId);
    if (!target) return errorResponse('User not found.', 'NOT_FOUND');
    if (target.role === ROLES.SUPER_ADMIN) {
      return errorResponse(
        'Super Admin accounts cannot be deleted. Demote the role first.',
        'PROTECTED'
      );
    }

    SheetService.deleteUserRecord(staffId);

    LogService.logActivity(
      sess,
      LOG_CATEGORIES.USER_MGMT,
      'User deleted',
      staffId + ' (' + target.name + ') | was ' + target.role
    );

    return successResponse({ message: 'Account for "' + target.name + '" has been permanently deleted.' });
  } catch (e) {
    Logger.log('serverDeleteUser error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Override serverSetSessionSettings to log Configuration events.
 */
function serverSetSessionSettings(token, settings) {
  try {
    var sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    if (![ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(sess.role)) {
      return errorResponse('Unauthorised.', 'UNAUTHORISED');
    }

    SheetService.setSessionSettings(settings);
    var saved = SheetService.getSessionSettings();

    // Log whichever fields were changed
    var changes = [];
    if (settings.activeSession !== undefined) changes.push('Session: ' + settings.activeSession);
    if (settings.activeTerm    !== undefined) changes.push('Term: ' + settings.activeTerm);
    if (settings.studentDataTab !== undefined) changes.push('StudentDataTab confirmed');

    if (changes.length > 0) {
      LogService.logActivity(
        sess,
        LOG_CATEGORIES.CONFIG,
        'Session settings updated',
        changes.join(' | ')
      );
    }

    return successResponse(saved);
  } catch (e) {
    return errorResponse(e.message);
  }
}

/**
 * Override serverSyncClasses to log Configuration events.
 */
function serverSyncClasses(token, externalSheetId, tabName) {
  try {
    var sess   = AuthService.validateToken(token);
    var result = ClassService.syncClasses(token, externalSheetId, tabName);

    if (result && result.success) {
      LogService.logActivity(
        sess,
        LOG_CATEGORIES.CONFIG,
        'Classes synced',
        'Tab: ' + (tabName || '?')
      );
    }

    return result;
  } catch (e) {
    Logger.log('serverSyncClasses error: ' + e.message);
    return errorResponse('Sync failed: ' + e.message, 'SYNC_ERROR');
  }
}

/**
 * Override serverSyncSubjects to log Configuration events.
 */
function serverSyncSubjects(token) {
  try {
    var sess   = AuthService.validateToken(token);
    var result = SubjectService.syncSubjects(token);

    if (result && result.success) {
      LogService.logActivity(sess, LOG_CATEGORIES.CONFIG, 'Subjects synced', '');
    }

    return result;
  } catch (e) {
    Logger.log('serverSyncSubjects error: ' + e.message);
    return errorResponse('Sync failed: ' + e.message, 'SYNC_ERROR');
  }
}

/**
 * Override serverRefreshStudentCache to log Configuration events.
 */
function serverRefreshStudentCache(token, classId) {
  try {
    var sess   = AuthService.validateToken(token);
    var result = StudentService.refreshStudentCache(token, classId || 'all');

    if (result && result.success) {
      LogService.logActivity(
        sess,
        LOG_CATEGORIES.CONFIG,
        'Student cache refreshed',
        classId ? 'Class: ' + classId : 'All classes'
      );
    }

    return result;
  } catch (e) {
    Logger.log('serverRefreshStudentCache error: ' + e.message);
    return errorResponse('Refresh failed: ' + e.message, 'REFRESH_ERROR');
  }
}

/**
 * Override serverGenerateResultSlipPDF to log Results events.
 */
function serverGenerateResultSlipPDF(token, studentId, classId) {
  try {
    var sess = AuthService.validateToken(token);

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

    var result = PDFService.generateResultSlipPDF(token, studentId, classId);

    if (result && result.success) {
      LogService.logActivity(
        sess,
        LOG_CATEGORIES.RESULTS,
        'Result slip exported',
        'Student: ' + studentId + ' | Class: ' + className
      );
    }

    return result;
  } catch (e) {
    Logger.log('serverGenerateResultSlipPDF error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Override serverGenerateBulkResultsPDF to log Results events.
 */
function serverGenerateBulkResultsPDF(token, classGroupKey) {
  try {
    var sess = AuthService.validateToken(token);

    var completion = CompletionService.getClassGroupCompletion(token, classGroupKey);
    if (!completion.success) return completion;
    if (!completion.data.resultsUnlocked) {
      return errorResponse(
        'PDF generation is locked. Complete all scores, PSQ ratings, and remarks before generating bulk PDFs.',
        'LOCKED'
      );
    }

    var result = PDFService.generateBulkResultsPDF(token, classGroupKey);

    if (result && result.success) {
      LogService.logActivity(
        sess,
        LOG_CATEGORIES.RESULTS,
        'Bulk results PDF exported',
        'Group: ' + classGroupKey + ' | ' + (result.data.studentCount || '?') + ' students'
      );
    }

    return result;
  } catch (e) {
    Logger.log('serverGenerateBulkResultsPDF error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Override serverGetBroadsheetPDF to log Results events.
 */
function serverGetBroadsheetPDF(token, classGroupKey) {
  try {
    var sess = AuthService.validateToken(token);

    var completion = CompletionService.getClassGroupCompletion(token, classGroupKey);
    if (!completion.success) return completion;
    if (!completion.data.broadsheetUnlocked) {
      var d       = completion.data.detail;
      var missing = d.scores.required - d.scores.entered;
      return errorResponse(
        'Broadsheet PDF is locked. ' + missing + ' score entr' + (missing === 1 ? 'y' : 'ies') +
        ' still missing. Complete all scores before exporting.',
        'LOCKED'
      );
    }

    var result = ExportService.getBroadsheetPDF(token, classGroupKey);

    if (result && result.success) {
      LogService.logActivity(
        sess,
        LOG_CATEGORIES.RESULTS,
        'Broadsheet PDF exported',
        'Group: ' + classGroupKey
      );
    }

    return result;
  } catch (e) {
    Logger.log('serverGetBroadsheetPDF error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Override serverUpdateStudentCorrection to log Corrections events.
 */
function serverUpdateStudentCorrection(token, classId, studentId, editedName, editedGender) {
  try {
    var sess   = AuthService.validateToken(token);
    var result = StatusService.updateStudentCorrection(token, classId, studentId, editedName, editedGender);

    if (result && result.success) {
      LogService.logActivity(
        sess,
        LOG_CATEGORIES.CORRECTIONS,
        'Student correction saved',
        'Student: ' + studentId + ' | Name: ' + editedName + ' | Gender: ' + editedGender
      );
    }

    return result;
  } catch (e) {
    Logger.log('serverUpdateStudentCorrection error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Override serverClearStudentCorrection to log Corrections events.
 */
function serverClearStudentCorrection(token, studentId) {
  try {
    var sess   = AuthService.validateToken(token);
    var result = StatusService.clearStudentCorrection(token, studentId);

    if (result && result.success) {
      LogService.logActivity(
        sess,
        LOG_CATEGORIES.CORRECTIONS,
        'Student correction cleared',
        'Student: ' + studentId
      );
    }

    return result;
  } catch (e) {
    Logger.log('serverClearStudentCorrection error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Override serverForceChangePassword to log Auth events.
 * Called on first login when a temporary password must be replaced.
 */
function serverForceChangePassword(token, newPassword, confirmPassword) {
  try {
    if (!newPassword || newPassword.trim().length === 0) {
      return errorResponse('New password is required.', 'VALIDATION_ERROR');
    }
    if (newPassword !== confirmPassword) {
      return errorResponse('Passwords do not match.', 'VALIDATION_ERROR');
    }

    var sess   = AuthService.validateToken(token);
    var result = AuthService.forceChangePassword(token, newPassword);

    if (result && result.success && sess) {
      LogService.logActivity(
        sess,
        LOG_CATEGORIES.AUTH,
        'Forced password changed',
        'First-login password set by ' + (sess.staffId || 'unknown')
      );
    }

    return result;
  } catch (e) {
    Logger.log('serverForceChangePassword error: ' + e.message);
    return errorResponse('An unexpected error occurred.', 'SERVER_ERROR');
  }
}

/**
 * Override serverChangePassword to log Auth events.
 * Called when a user voluntarily changes their own password from the profile screen.
 */
function serverChangePassword(token, currentPassword, newPassword, confirmPassword) {
  try {
    if (!newPassword || newPassword.trim().length === 0) {
      return errorResponse('New password is required.', 'VALIDATION_ERROR');
    }
    if (newPassword !== confirmPassword) {
      return errorResponse('New passwords do not match.', 'VALIDATION_ERROR');
    }

    var sess   = AuthService.validateToken(token);
    var result = AuthService.changePassword(token, currentPassword, newPassword);

    if (result && result.success && sess) {
      LogService.logActivity(
        sess,
        LOG_CATEGORIES.AUTH,
        'Password changed',
        'Self-service password change by ' + (sess.staffId || 'unknown')
      );
    }

    return result;
  } catch (e) {
    Logger.log('serverChangePassword error: ' + e.message);
    return errorResponse('An unexpected error occurred.', 'SERVER_ERROR');
  }
}

/**
 * Override serverExecuteCarryForward to log Configuration events.
 * Carry-forward copies teacher-subject assignments from a prior term into the active term.
 */
function serverExecuteCarryForward(token) {
  try {
    var sess   = AuthService.validateToken(token);
    var result = CarryForwardService.executeCarryForward(token);

    if (result && result.success && sess) {
      var d = result.data || {};
      LogService.logActivity(
        sess,
        LOG_CATEGORIES.CONFIG,
        'Carry-forward executed',
        'Assignments copied: ' + (d.copiedCount !== undefined ? d.copiedCount : '?')
      );
    }

    return result;
  } catch (e) {
    Logger.log('serverExecuteCarryForward error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Override serverGetBroadsheetExcel to log Results events.
 */
function serverGetBroadsheetExcel(token, classGroupKey) {
  try {
    var sess = AuthService.validateToken(token);

    var completion = CompletionService.getClassGroupCompletion(token, classGroupKey);
    if (!completion.success) return completion;
    if (!completion.data.broadsheetUnlocked) {
      var d       = completion.data.detail;
      var missing = d.scores.required - d.scores.entered;
      return errorResponse(
        'Broadsheet Excel is locked. ' + missing + ' score entr' + (missing === 1 ? 'y' : 'ies') +
        ' still missing. Complete all scores before exporting.',
        'LOCKED'
      );
    }

    var result = ExportService.getBroadsheetExcel(token, classGroupKey);

    if (result && result.success && sess) {
      LogService.logActivity(
        sess,
        LOG_CATEGORIES.RESULTS,
        'Broadsheet Excel exported',
        'Group: ' + classGroupKey
      );
    }

    return result;
  } catch (e) {
    Logger.log('serverGetBroadsheetExcel error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Override serverGetScoreSheetPDF to log Results events.
 */
function serverGetScoreSheetPDF(token, classGroupKey, subjectId) {
  try {
    var sess   = AuthService.validateToken(token);
    var result = ExportService.getScoreSheetPDF(token, classGroupKey, subjectId);

    if (result && result.success && sess) {
      LogService.logActivity(
        sess,
        LOG_CATEGORIES.RESULTS,
        'Score sheet PDF exported',
        'Group: ' + classGroupKey + ' | Subject: ' + (subjectId || 'all')
      );
    }

    return result;
  } catch (e) {
    Logger.log('serverGetScoreSheetPDF error: ' + e.message);
    return errorResponse(e.message);
  }
}

// PSQ and Remarks are logged in the Change Log (per-field, per-student),
// not in the Activity Log. Their Change Log wrappers live in ScoreService.gs
// as IIFE augmentations, following the same pattern as ScoreService.saveScores.
