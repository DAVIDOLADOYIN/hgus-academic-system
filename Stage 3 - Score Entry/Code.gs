/**
 * HGUS Academic Result Management System
 * Code.gs — Entry point and server-callable API
 *
 * Every function prefixed with `server` is callable from the browser via
 * google.script.run.serverFunctionName(args).
 *
 * Stage 3 additions (Score Entry):
 *   - serverGetMyAssignments      (updated: now returns fmClasses + tsAssignments)
 *   - serverGetFMClassOverview    (Form Master class overview)
 *   - serverGetComponentStatuses  (progress tiles per score component)
 *   - serverGetScoresForComponent (student roster + existing scores for one component)
 *   - serverSaveScores            (batch save scores for a whole class)
 *   - serverGetClassPSQ           (PSQ ratings for a whole class)
 *   - serverSavePSQ               (save PSQ for one student)
 *   - serverGetClassRemarks       (remarks for a whole class)
 *   - serverSaveRemarks           (save remarks for one or more students)
 *   - serverGetClassStudentStatus (student term statuses for a class)
 *   - serverSetStudentStatus      (set the term status of one student)
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
