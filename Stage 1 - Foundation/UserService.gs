/**
 * HGUS Academic Result Management System
 * UserService.gs — User management business logic
 *
 * All functions validate the caller's token before executing.
 * Only Admins and Super Admins can access user management.
 * The Super Admin row is protected from edit/delete by anyone else.
 */

const UserService = (function () {

  // ─── PRIVATE HELPERS ──────────────────────────────────────────────────────

  /**
   * Strip the password hash before sending user data to the client.
   * Never return raw hashes to the browser.
   */
  function stripSensitive(user) {
    const safe = Object.assign({}, user);
    delete safe.passwordHash;
    return safe;
  }

  /**
   * Check that the caller is an Admin or Super Admin.
   * @param {Object} session
   * @returns {boolean}
   */
  function isAdminOrAbove(session) {
    return [ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(session.role);
  }

  // ─── USER LIST ────────────────────────────────────────────────────────────

  /**
   * Get all users (Admin / Super Admin only).
   * Returns an array of user objects with password hash removed.
   *
   * @param {string} token
   * @returns {{ success, data: Object[] } | { success, error, code }}
   */
  function getUserList(token) {
    const session = AuthService.validateToken(token);
    if (!session) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    if (!isAdminOrAbove(session)) return errorResponse('Unauthorised.', 'UNAUTHORISED');

    const users = SheetService.getAllUsers().map(stripSensitive);
    return successResponse(users);
  }

  /**
   * Get a single user profile by Staff ID.
   *
   * @param {string} token
   * @param {string} staffId
   */
  function getUser(token, staffId) {
    const session = AuthService.validateToken(token);
    if (!session) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    if (!isAdminOrAbove(session)) return errorResponse('Unauthorised.', 'UNAUTHORISED');

    const user = SheetService.getUserById(staffId);
    if (!user) return errorResponse('User not found.', 'USER_NOT_FOUND');

    return successResponse(stripSensitive(user));
  }

  // ─── USERNAME AVAILABILITY ────────────────────────────────────────────────

  /**
   * Live check for username availability.
   * Called as the Admin types during Add User.
   * No token required — availability alone is not sensitive.
   *
   * @param {string} username
   * @returns {{ available: boolean, reason: string }}
   */
  function checkUsername(username) {
    if (!username || username.trim().length === 0) {
      return { available: false, reason: '' };
    }
    if (!isValidUsername(username)) {
      return {
        available: false,
        reason: 'Username must be 3–20 characters (letters, numbers, underscores only).'
      };
    }
    const exists = SheetService.usernameExists(username.trim());
    return {
      available: !exists,
      reason: exists ? 'This username is already taken.' : ''
    };
  }

  // ─── ADD USER ─────────────────────────────────────────────────────────────

  /**
   * Create a new user account.
   *
   * Rules:
   * - Only Admin or Super Admin can create accounts
   * - Only Super Admin can create Admin accounts
   * - Nobody can create a Super Admin account via this flow
   * - Username must be unique and valid format
   * - Password must be ≥ 8 characters
   * - Staff ID is auto-generated
   * - Force Password Change is always set to TRUE on creation
   *
   * @param {string} token
   * @param {Object} userData
   * @param {string} userData.name
   * @param {string} userData.username
   * @param {string} userData.password           plain-text temporary password
   * @param {string} [userData.email]
   * @param {string} [userData.phoneNumber]
   * @param {string} [userData.subjectSpecialty]
   * @param {string} [userData.employmentStatus]  defaults to 'Active'
   * @param {string} [userData.role]              defaults to 'Teacher'
   * @param {string} [userData.dateJoined]
   */
  function addUser(token, userData) {
    const session = AuthService.validateToken(token);
    if (!session) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    if (!isAdminOrAbove(session)) return errorResponse('Unauthorised.', 'UNAUTHORISED');

    // ── Validate required fields ──────────────────────────────────────────
    if (!userData || !userData.name || !userData.name.trim()) {
      return errorResponse('Full name is required.', 'VALIDATION_ERROR');
    }
    if (!userData.username || !userData.username.trim()) {
      return errorResponse('Username is required.', 'VALIDATION_ERROR');
    }
    if (!userData.password) {
      return errorResponse('A temporary password is required.', 'VALIDATION_ERROR');
    }

    const username = userData.username.trim();

    if (!isValidUsername(username)) {
      return errorResponse(
        'Invalid username. Use 3–20 characters: letters, numbers, or underscores.',
        'VALIDATION_ERROR'
      );
    }
    if (!isValidPassword(userData.password)) {
      return errorResponse('Temporary password must be at least 8 characters.', 'VALIDATION_ERROR');
    }
    if (SheetService.usernameExists(username)) {
      return errorResponse('This username is already taken.', 'USERNAME_TAKEN');
    }

    // ── Role constraints ──────────────────────────────────────────────────
    const targetRole = userData.role || ROLES.TEACHER;

    if (targetRole === ROLES.SUPER_ADMIN) {
      return errorResponse(
        'Cannot create a Super Admin account. There can only be one.',
        'UNAUTHORISED'
      );
    }
    if (targetRole === ROLES.ADMIN && session.role !== ROLES.SUPER_ADMIN) {
      return errorResponse(
        'Only the Super Admin can create Admin accounts.',
        'UNAUTHORISED'
      );
    }

    // ── Build and write the user row ──────────────────────────────────────
    const staffId      = generateStaffId();
    const passwordHash = sha256(userData.password);
    const now          = new Date();

    const newUser = {
      staffId:             staffId,
      name:                userData.name.trim(),
      username:            username,
      passwordHash:        passwordHash,
      forcePasswordChange: true,
      email:               userData.email          || '',
      role:                targetRole,
      phoneNumber:         userData.phoneNumber    || '',
      dateJoined:          userData.dateJoined     || formatDate(now),
      employmentStatus:    userData.employmentStatus || EMPLOYMENT_STATUS.ACTIVE,
      subjectSpecialty:    userData.subjectSpecialty || '',
      addedBy:             session.staffId,
      createdAt:           now
    };

    SheetService.createUser(newUser);

    return successResponse({
      staffId,
      message: 'Account created successfully. Staff ID: ' + staffId
    });
  }

  // ─── EDIT USER ────────────────────────────────────────────────────────────

  /**
   * Update editable fields on a user account.
   *
   * Protected fields that cannot be changed via this function:
   *   staffId, username, passwordHash, role, createdAt, addedBy
   *
   * Super Admin row is protected from edits by non-Super-Admins.
   *
   * @param {string} token
   * @param {string} staffId        Staff ID of the user to edit
   * @param {Object} updates        Only editable fields
   */
  function updateUser(token, staffId, updates) {
    const session = AuthService.validateToken(token);
    if (!session) return errorResponse('Session expired.', 'SESSION_EXPIRED');
    if (!isAdminOrAbove(session)) return errorResponse('Unauthorised.', 'UNAUTHORISED');

    const targetUser = SheetService.getUserById(staffId);
    if (!targetUser) return errorResponse('User not found.', 'USER_NOT_FOUND');

    // Only Super Admin can edit Super Admin row
    if (
      String(targetUser.role) === ROLES.SUPER_ADMIN &&
      session.role !== ROLES.SUPER_ADMIN
    ) {
      return errorResponse('Cannot edit the Super Admin account.', 'UNAUTHORISED');
    }

    // Strip protected fields from the updates payload
    const protectedFields = [
      'staffId', 'staffid', 'Staff ID',
      'username',
      'passwordHash', 'passwordhash', 'Password Hash',
      'role', 'Role',
      'createdAt', 'createdat', 'Created At',
      'addedBy', 'addedby', 'Added By'
    ];
    const safeUpdates = {};
    Object.keys(updates).forEach(key => {
      if (!protectedFields.includes(key)) {
        safeUpdates[key] = updates[key];
      }
    });

    if (Object.keys(safeUpdates).length === 0) {
      return errorResponse('No editable fields provided.', 'VALIDATION_ERROR');
    }

    SheetService.updateUser(staffId, safeUpdates);
    return successResponse({ message: 'User updated successfully.' });
  }

  // ─── ROLE MANAGEMENT ─────────────────────────────────────────────────────

  /**
   * Change a user's role between Admin and Teacher.
   * Super Admin only. Cannot change own role or another Super Admin's role.
   *
   * @param {string} token
   * @param {string} staffId   Staff ID of the user to promote/demote
   * @param {string} newRole   'Admin' or 'Teacher'
   */
  function changeRole(token, staffId, newRole) {
    const session = AuthService.validateToken(token);
    if (!session) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    if (session.role !== ROLES.SUPER_ADMIN) {
      return errorResponse('Only the Super Admin can change user roles.', 'UNAUTHORISED');
    }

    // Cannot change own role
    if (String(staffId).trim() === String(session.staffId).trim()) {
      return errorResponse('You cannot change your own role.', 'PROTECTED');
    }

    const targetUser = SheetService.getUserById(staffId);
    if (!targetUser) return errorResponse('User not found.', 'USER_NOT_FOUND');

    // Cannot change another Super Admin (there should be none, but guard anyway)
    if (String(targetUser.role) === ROLES.SUPER_ADMIN) {
      return errorResponse('Cannot change the Super Admin role.', 'PROTECTED');
    }

    if (![ROLES.ADMIN, ROLES.TEACHER].includes(newRole)) {
      return errorResponse('Invalid role. Must be "Admin" or "Teacher".', 'VALIDATION_ERROR');
    }

    SheetService.updateUser(staffId, { role: newRole });

    return successResponse({
      message: targetUser.name + ' is now ' + newRole + '.'
    });
  }

  // ─── PUBLIC API ───────────────────────────────────────────────────────────

  return {
    getUserList,
    getUser,
    checkUsername,
    addUser,
    updateUser,
    changeRole
  };

})();
