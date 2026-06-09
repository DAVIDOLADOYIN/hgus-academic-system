/**
 * HGUS Academic Result Management System
 * Code.gs — Entry point and server-callable API
 *
 * This file wires together the HTML frontend and the server-side services.
 * Every function prefixed with `server` is callable from the browser via
 * google.script.run.serverFunctionName(args).
 *
 * IMPORTANT: google.script.run cannot pass undefined — use null for optional args.
 */

// ─── WEB APP ENTRY POINT ──────────────────────────────────────────────────────

/**
 * Handle all GET requests to the web app.
 * Always returns the single-page app shell.
 * Routing is handled client-side via the JavaScript in AppScript.html.
 */
function doGet(e) {
  return HtmlService
    .createTemplateFromFile('Index')
    .evaluate()
    .setTitle('HGUS Academic System')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Include an HTML file's content inside another HTML file.
 * Used in Index.html as: <?!= include('StyleBase') ?>
 * @param {string} filename — without .html extension
 * @returns {string} raw HTML content
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ─── AUTH ENDPOINTS ───────────────────────────────────────────────────────────

/**
 * Login with username and password.
 * @param {string} username
 * @param {string} password  plain-text
 * @returns {{ success, token, forcePasswordChange, user } | { success, error, code }}
 */
function serverLogin(username, password) {
  try {
    return AuthService.login(username, password);
  } catch (e) {
    Logger.log('serverLogin error: ' + e.message);
    return errorResponse('An unexpected error occurred. Please try again.', 'SERVER_ERROR');
  }
}

/**
 * Validate an existing session token.
 * Returns session info and active session/term settings.
 * Called on every page load to restore state.
 *
 * @param {string} token
 * @returns {{ valid: boolean, session?, settings? }}
 */
function serverValidateSession(token) {
  try {
    const session = AuthService.validateToken(token);
    if (!session) return { valid: false };
    const settings = SheetService.getSessionSettings();
    return { valid: true, session, settings };
  } catch (e) {
    Logger.log('serverValidateSession error: ' + e.message);
    return { valid: false };
  }
}

/**
 * Logout and invalidate the session token.
 * @param {string} token
 */
function serverLogout(token) {
  try {
    AuthService.invalidateToken(token);
    return successResponse({});
  } catch (e) {
    return errorResponse(e.message);
  }
}

/**
 * Forced password change — first login or after Admin reset.
 * @param {string} token
 * @param {string} newPassword
 * @param {string} confirmPassword
 */
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

/**
 * Voluntary password change (any logged-in user).
 * @param {string} token
 * @param {string} currentPassword
 * @param {string} newPassword
 * @param {string} confirmPassword
 */
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

/**
 * Live username availability check. No token required.
 * @param {string} username
 * @returns {{ available: boolean, reason: string }}
 */
function serverCheckUsername(username) {
  try {
    return UserService.checkUsername(username);
  } catch (e) {
    return { available: false, reason: 'Could not check username availability.' };
  }
}

/**
 * Get all users (Admin / Super Admin only).
 * @param {string} token
 */
function serverGetUserList(token) {
  try {
    return UserService.getUserList(token);
  } catch (e) {
    Logger.log('serverGetUserList error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Get a single user profile by Staff ID.
 * @param {string} token
 * @param {string} staffId
 */
function serverGetUser(token, staffId) {
  try {
    return UserService.getUser(token, staffId);
  } catch (e) {
    Logger.log('serverGetUser error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Create a new user account.
 * @param {string} token
 * @param {Object} userData
 */
function serverAddUser(token, userData) {
  try {
    return UserService.addUser(token, userData);
  } catch (e) {
    Logger.log('serverAddUser error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Update editable fields on a user account.
 * @param {string} token
 * @param {string} staffId
 * @param {Object} updates
 */
function serverUpdateUser(token, staffId, updates) {
  try {
    return UserService.updateUser(token, staffId, updates);
  } catch (e) {
    Logger.log('serverUpdateUser error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Admin resets a user's password to a new temporary value.
 * @param {string} token
 * @param {string} staffId
 * @param {string} newTempPassword
 */
function serverResetPassword(token, staffId, newTempPassword) {
  try {
    return AuthService.resetPassword(token, staffId, newTempPassword);
  } catch (e) {
    Logger.log('serverResetPassword error: ' + e.message);
    return errorResponse(e.message);
  }
}

/**
 * Change a user's role (Super Admin only).
 * @param {string} token
 * @param {string} staffId
 * @param {string} newRole   'Admin' | 'Teacher'
 */
function serverChangeRole(token, staffId, newRole) {
  try {
    return UserService.changeRole(token, staffId, newRole);
  } catch (e) {
    Logger.log('serverChangeRole error: ' + e.message);
    return errorResponse(e.message);
  }
}

// ─── SESSION SETTINGS ENDPOINTS ───────────────────────────────────────────────

/**
 * Get the active session and term (used on every page load).
 * @param {string} token
 */
function serverGetSessionSettings(token) {
  try {
    const session = AuthService.validateToken(token);
    if (!session) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    return successResponse(SheetService.getSessionSettings());
  } catch (e) {
    return errorResponse(e.message);
  }
}

/**
 * Update session settings (Admin / Super Admin only).
 * @param {string} token
 * @param {Object} settings
 */
function serverSetSessionSettings(token, settings) {
  try {
    const session = AuthService.validateToken(token);
    if (!session) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    if (![ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(session.role)) {
      return errorResponse('Unauthorised.', 'UNAUTHORISED');
    }
    SheetService.setSessionSettings(settings);
    return successResponse({ message: 'Session settings updated.' });
  } catch (e) {
    return errorResponse(e.message);
  }
}

// ─── SETUP ENDPOINT ───────────────────────────────────────────────────────────

/**
 * Run the one-time sheet setup.
 * No authentication required — run this before any accounts exist.
 */
function serverRunSetup() {
  try {
    const message = setupSheets();
    return successResponse({ message });
  } catch (e) {
    Logger.log('serverRunSetup error: ' + e.message);
    return errorResponse('Setup failed: ' + e.message, 'SETUP_ERROR');
  }
}
