/**
 * HGUS Academic Result Management System
 * LockService.gs — Result Locking (Stage 7)
 *
 * ── OVERVIEW ────────────────────────────────────────────────────────────────
 *
 * Once an Admin is satisfied that all scores for a class/term are correct,
 * they can LOCK the class-term. After locking:
 *   - ScoreService.saveScores() rejects any save with a RESULT_LOCKED error.
 *   - The class card in the UI shows a padlock badge.
 *   - Only an Admin or Super Admin can unlock.
 *
 * Storage: "Result Locks" sheet (one row per lock event; most recent row for
 * a classId+term+session is the authoritative state).
 *
 * ── SHEET COLUMNS ────────────────────────────────────────────────────────────
 *   Lock ID | Class ID | Term | Session | Is Locked |
 *   Locked By | Locked At | Unlocked By | Unlocked At
 *
 * ── HOW LOCKING WORKS ────────────────────────────────────────────────────────
 *   Lock:   upsert row for (classId, term, session) with isLocked = true.
 *   Unlock: update that same row with isLocked = false (+ Unlocked By/At).
 *   Check:  read that row and return isLocked.
 *
 * One row per (classId + term + session) combination. Re-locking after an
 * unlock updates the same row rather than appending a new one.
 * (Full audit trail is in the Activity Log, not the Result Locks sheet.)
 */

const LockService = (function () {

  // ─── PUBLIC: CHECK LOCK STATE ─────────────────────────────────────────────

  /**
   * Return true if the specified class-term is currently locked.
   *
   * This is the fast check called by ScoreService.saveScores() on every save.
   * It reads from SheetService so it never touches SpreadsheetApp directly.
   *
   * @param {string} classId
   * @param {string} term
   * @param {string} session
   * @returns {boolean}
   */
  function isLocked(classId, term, session) {
    try {
      var lock = SheetService.getResultLock(classId, term, session);
      return lock ? toBoolean(lock.isLocked) : false;
    } catch (e) {
      // If the sheet doesn't exist yet (pre-setup), treat as unlocked
      return false;
    }
  }

  // ─── PUBLIC: LOCK A CLASS-TERM ────────────────────────────────────────────

  /**
   * Lock a class-term so no scores can be saved.
   *
   * Auth: Admin or Super Admin only.
   *
   * @param {string} token
   * @param {string} classId
   * @returns {{ success, data: { classId, term, session, isLocked, lockedBy, lockedAt } }}
   */
  function lockClassTerm(token, classId) {
    var sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    if (![ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(sess.role)) {
      return errorResponse('Only Admins can lock class-terms.', 'UNAUTHORISED');
    }

    var settings = SheetService.getSessionSettings();
    var term     = settings.activeTerm;
    var session  = settings.activeSession;

    if (!term || !session) {
      return errorResponse('No active session/term configured.', 'NO_SESSION');
    }

    // Guard: already locked
    if (isLocked(classId, term, session)) {
      return errorResponse(
        'This class-term is already locked.',
        'ALREADY_LOCKED'
      );
    }

    var now = new Date().toISOString();

    // Upsert the lock row
    SheetService.upsertResultLock(classId, term, session, {
      isLocked:   true,
      lockedBy:   sess.staffId,
      lockedAt:   now,
      unlockedBy: '',
      unlockedAt: ''
    });

    // ── Activity Log ──────────────────────────────────────────────────────────
    // Find the class name for a human-readable log entry
    var allClasses = SheetService.getAllClasses();
    var cls        = allClasses.find(function (c) { return c.classId === classId; }) || {};
    var className  = cls.className || classId;

    LogService.logActivity(
      sess,
      LOG_CATEGORIES.LOCK,
      'Class locked',
      className + ' | ' + term + ' | ' + session
    );

    return successResponse({
      classId:  classId,
      term:     term,
      session:  session,
      isLocked: true,
      lockedBy: sess.staffId,
      lockedAt: now
    });
  }

  // ─── PUBLIC: UNLOCK A CLASS-TERM ─────────────────────────────────────────

  /**
   * Unlock a class-term to allow score edits again.
   *
   * Auth: Admin or Super Admin only.
   *
   * @param {string} token
   * @param {string} classId
   * @returns {{ success, data: { classId, term, session, isLocked } }}
   */
  function unlockClassTerm(token, classId) {
    var sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    if (![ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(sess.role)) {
      return errorResponse('Only Admins can unlock class-terms.', 'UNAUTHORISED');
    }

    var settings = SheetService.getSessionSettings();
    var term     = settings.activeTerm;
    var session  = settings.activeSession;

    if (!term || !session) {
      return errorResponse('No active session/term configured.', 'NO_SESSION');
    }

    // Guard: not locked
    if (!isLocked(classId, term, session)) {
      return errorResponse(
        'This class-term is not currently locked.',
        'NOT_LOCKED'
      );
    }

    var now = new Date().toISOString();

    SheetService.upsertResultLock(classId, term, session, {
      isLocked:   false,
      unlockedBy: sess.staffId,
      unlockedAt: now
    });

    // ── Activity Log ──────────────────────────────────────────────────────────
    var allClasses = SheetService.getAllClasses();
    var cls        = allClasses.find(function (c) { return c.classId === classId; }) || {};
    var className  = cls.className || classId;

    LogService.logActivity(
      sess,
      LOG_CATEGORIES.LOCK,
      'Class unlocked',
      className + ' | ' + term + ' | ' + session
    );

    return successResponse({
      classId:  classId,
      term:     term,
      session:  session,
      isLocked: false
    });
  }

  // ─── PUBLIC: GET LOCK STATUS ──────────────────────────────────────────────

  /**
   * Return the lock status for a class in the current active term/session.
   * Used by the UI to show/hide the Lock button and padlock badge.
   *
   * Any logged-in user can call this (read-only).
   *
   * @param {string} token
   * @param {string} classId
   * @returns {{ success, data: { classId, term, session, isLocked, lockedBy, lockedAt } }}
   */
  function getClassTermLockStatus(token, classId) {
    var sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    var settings = SheetService.getSessionSettings();
    var term     = settings.activeTerm;
    var session  = settings.activeSession;

    var lock = SheetService.getResultLock(classId, term, session);

    var locked = lock ? toBoolean(lock.isLocked) : false;

    return successResponse({
      classId:  classId,
      term:     term     || '',
      session:  session  || '',
      isLocked: locked,
      lockedBy: lock && locked ? String(lock.lockedBy  || '') : '',
      lockedAt: lock && locked ? String(lock.lockedAt  || '') : ''
    });
  }

  // ─── PUBLIC API ───────────────────────────────────────────────────────────

  return {
    isLocked,              // Fast boolean check — used by ScoreService
    lockClassTerm,         // Server action: lock (Admin/Super Admin)
    unlockClassTerm,       // Server action: unlock (Admin/Super Admin)
    getClassTermLockStatus // Read lock state for UI
  };

})();
