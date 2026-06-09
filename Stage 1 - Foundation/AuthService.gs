/**
 * HGUS Academic Result Management System
 * AuthService.gs — Authentication and session management
 *
 * Session tokens are stored in CacheService (script-scoped).
 * CacheService has a 6-hour hard ceiling; we use 300 seconds (5 min)
 * and refresh on every validated call to implement inactivity timeout.
 */

const AuthService = (function () {

  // ─── PRIVATE HELPERS ──────────────────────────────────────────────────────

  function sessionKey(token) {
    return SESSION_CACHE_KEY_PREFIX + token;
  }

  function getCache() {
    return CacheService.getScriptCache();
  }

  /**
   * Write a session to cache.
   * @param {Object} sessionData
   * @param {string} token
   */
  function writeSession(token, sessionData) {
    getCache().put(sessionKey(token), JSON.stringify(sessionData), SESSION_TIMEOUT_SECONDS);
  }

  /**
   * Strip the password hash from a user object before returning to client.
   * @param {Object} user
   * @returns {Object}
   */
  function safeUser(user) {
    const safe = Object.assign({}, user);
    delete safe.passwordHash;
    return safe;
  }

  // ─── LOGIN ────────────────────────────────────────────────────────────────

  /**
   * Attempt to authenticate a user with username + plain-text password.
   *
   * Returns:
   *   { success: true, token, forcePasswordChange, user }
   *   { success: false, error, code }
   *
   * Special case — Super Admin bootstrap:
   *   If the Password Hash column is blank AND Force Password Change = TRUE
   *   AND Role = Super Admin, the system allows them through to the
   *   Force Change Password screen without verifying a password.
   *   This is the one-time developer setup path (PRD §4.1).
   *
   * @param {string} username
   * @param {string} password  plain-text password entered by the user
   */
  function login(username, password) {
    const user = SheetService.getUser(username);

    // ── Username not found ────────────────────────────────────────────────
    if (!user) {
      return errorResponse(
        'Username not recognised. Contact your administrator.',
        'USER_NOT_FOUND'
      );
    }

    // ── Resigned account ──────────────────────────────────────────────────
    if (String(user.employmentStatus).trim() === EMPLOYMENT_STATUS.RESIGNED) {
      return errorResponse(
        'Your account has been deactivated. Contact your administrator.',
        'ACCOUNT_DEACTIVATED'
      );
    }

    const isBlankHash  = !user.passwordHash || String(user.passwordHash).trim() === '';
    const isFPC        = toBoolean(user.forcePasswordChange);
    const isSuperAdmin = String(user.role).trim() === ROLES.SUPER_ADMIN;

    // ── Super Admin bootstrap (blank hash, FPC=TRUE) ──────────────────────
    if (isBlankHash && isFPC && isSuperAdmin) {
      const token = generateToken();
      const sessionData = buildSessionData(user, true);
      writeSession(token, sessionData);
      return { success: true, token, forcePasswordChange: true, user: safeUser(user) };
    }

    // ── Normal password verification ──────────────────────────────────────
    if (isBlankHash) {
      // Non-Super Admin with blank hash — misconfigured account
      return errorResponse(
        'Incorrect password. Contact your administrator if you have forgotten it.',
        'WRONG_PASSWORD'
      );
    }

    const submittedHash = sha256(password);
    if (submittedHash !== String(user.passwordHash).trim()) {
      return errorResponse(
        'Incorrect password. Contact your administrator if you have forgotten it.',
        'WRONG_PASSWORD'
      );
    }

    // ── Successful authentication ─────────────────────────────────────────
    const token       = generateToken();
    const sessionData = buildSessionData(user, isFPC);
    writeSession(token, sessionData);

    return {
      success:             true,
      token,
      forcePasswordChange: isFPC,
      user:                safeUser(user)
    };
  }

  /**
   * Build the session payload stored in cache.
   * @param {Object} user
   * @param {boolean} forcePasswordChange
   * @returns {Object}
   */
  function buildSessionData(user, forcePasswordChange) {
    return {
      staffId:             String(user.staffId).trim(),
      username:            String(user.username).trim(),
      name:                String(user.name).trim(),
      role:                String(user.role).trim(),
      forcePasswordChange: !!forcePasswordChange,
      createdAt:           Date.now()
    };
  }

  // ─── TOKEN VALIDATION ─────────────────────────────────────────────────────

  /**
   * Validate a session token and refresh its inactivity timer.
   * Returns the session object if valid, null if expired or invalid.
   *
   * @param {string} token
   * @returns {Object|null}
   */
  function validateToken(token) {
    if (!token || typeof token !== 'string') return null;
    const raw = getCache().get(sessionKey(token));
    if (!raw) return null;

    let session;
    try {
      session = JSON.parse(raw);
    } catch (e) {
      return null;
    }

    // Refresh the inactivity timer on every validated call
    getCache().put(sessionKey(token), raw, SESSION_TIMEOUT_SECONDS);
    return session;
  }

  /**
   * Invalidate a session token (logout).
   * @param {string} token
   */
  function invalidateToken(token) {
    if (!token) return;
    try {
      getCache().remove(sessionKey(token));
    } catch (e) {
      // Silently ignore cache errors on logout
    }
  }

  // ─── PASSWORD MANAGEMENT ──────────────────────────────────────────────────

  /**
   * Forced password change — used on first login or after Admin reset.
   * The user must be authenticated (have a valid token) but may have
   * forcePasswordChange = true on their session.
   *
   * @param {string} token
   * @param {string} newPassword  plain-text new password
   * @returns {{ success, data } | { success, error, code }}
   */
  function forceChangePassword(token, newPassword) {
    const session = validateToken(token);
    if (!session) {
      return errorResponse('Session expired. Please log in again.', 'SESSION_EXPIRED');
    }

    if (!isValidPassword(newPassword)) {
      return errorResponse('Password must be at least 8 characters.', 'INVALID_PASSWORD');
    }

    const newHash = sha256(newPassword);
    const updated = SheetService.updateUser(session.staffId, {
      passwordHash:        newHash,
      forcePasswordChange: false
    });

    if (!updated) {
      return errorResponse(
        'Failed to update password. Please contact the administrator.',
        'UPDATE_FAILED'
      );
    }

    // Clear the forcePasswordChange flag in the live session
    session.forcePasswordChange = false;
    getCache().put(sessionKey(token), JSON.stringify(session), SESSION_TIMEOUT_SECONDS);

    return successResponse({ message: 'Password set successfully. Welcome!' });
  }

  /**
   * Voluntary password change — any logged-in user.
   * Requires the user to provide their current password for verification.
   *
   * @param {string} token
   * @param {string} currentPassword  plain-text current password
   * @param {string} newPassword      plain-text new password
   */
  function changePassword(token, currentPassword, newPassword) {
    const session = validateToken(token);
    if (!session) {
      return errorResponse('Session expired. Please log in again.', 'SESSION_EXPIRED');
    }

    if (!isValidPassword(newPassword)) {
      return errorResponse('New password must be at least 8 characters.', 'INVALID_PASSWORD');
    }

    const user = SheetService.getUserById(session.staffId);
    if (!user) {
      return errorResponse('User not found.', 'USER_NOT_FOUND');
    }

    const currentHash = sha256(currentPassword);
    if (currentHash !== String(user.passwordHash).trim()) {
      return errorResponse('Current password is incorrect.', 'WRONG_PASSWORD');
    }

    const newHash = sha256(newPassword);
    SheetService.updateUser(session.staffId, { passwordHash: newHash });

    return successResponse({ message: 'Password changed successfully.' });
  }

  /**
   * Admin-initiated password reset.
   * Sets a new temporary password and forces the user to change it on next login.
   *
   * @param {string} adminToken       token of the Admin/Super Admin performing the reset
   * @param {string} targetStaffId    Staff ID of the user being reset
   * @param {string} newTempPassword  plain-text temporary password
   */
  function resetPassword(adminToken, targetStaffId, newTempPassword) {
    const session = validateToken(adminToken);
    if (!session) {
      return errorResponse('Session expired.', 'SESSION_EXPIRED');
    }

    if (![ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(session.role)) {
      return errorResponse('Unauthorised.', 'UNAUTHORISED');
    }

    if (!isValidPassword(newTempPassword)) {
      return errorResponse('Temporary password must be at least 8 characters.', 'INVALID_PASSWORD');
    }

    const targetUser = SheetService.getUserById(targetStaffId);
    if (!targetUser) {
      return errorResponse('User not found.', 'USER_NOT_FOUND');
    }

    // Only Super Admin can reset Super Admin's password
    if (
      String(targetUser.role) === ROLES.SUPER_ADMIN &&
      session.role !== ROLES.SUPER_ADMIN
    ) {
      return errorResponse(
        'You are not authorised to reset the Super Admin password.',
        'UNAUTHORISED'
      );
    }

    const newHash = sha256(newTempPassword);
    SheetService.updateUser(targetStaffId, {
      passwordHash:        newHash,
      forcePasswordChange: true
    });

    return successResponse({
      message: 'Password has been reset. The user will be prompted to set a new password on their next login.'
    });
  }

  // ─── PUBLIC API ───────────────────────────────────────────────────────────

  return {
    login,
    validateToken,
    invalidateToken,
    forceChangePassword,
    changePassword,
    resetPassword
  };

})();
