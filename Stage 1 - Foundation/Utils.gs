/**
 * HGUS Academic Result Management System
 * Utils.gs — Utility / helper functions
 *
 * Pure functions only — no sheet access here.
 */

// ─── CRYPTOGRAPHY ─────────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hash of a string and return as lowercase hex.
 * Uses GAS built-in Utilities — no external dependency.
 * @param {string} text
 * @returns {string} 64-char hex string
 */
function sha256(text) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(text),
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

// ─── TOKEN / ID GENERATION ────────────────────────────────────────────────────

/**
 * Generate a cryptographically random 64-char session token.
 * @returns {string}
 */
function generateToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 64; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate the next Staff ID by scanning existing IDs for the highest number.
 * Format: HGST001, HGST002, ...
 * Must be called after SheetService is available.
 * @returns {string}
 */
function generateStaffId() {
  const users = SheetService.getAllUsers();
  let maxNum = 0;
  users.forEach(u => {
    const match = u.staffId && String(u.staffId).match(/^HGST(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  });
  return STAFF_ID_PREFIX + String(maxNum + 1).padStart(3, '0');
}

/**
 * Generate a unique prefixed ID given a list of existing IDs.
 * E.g. generateId('CLS', ['CLS001','CLS002']) → 'CLS003'
 * @param {string} prefix
 * @param {string[]} existingIds
 * @returns {string}
 */
function generateId(prefix, existingIds) {
  let maxNum = 0;
  const re = new RegExp('^' + prefix + '(\\d+)$');
  (existingIds || []).forEach(id => {
    const match = id && String(id).match(re);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  });
  return prefix + String(maxNum + 1).padStart(3, '0');
}

// ─── GRADING ──────────────────────────────────────────────────────────────────

/**
 * Return the grade and comment for a given total score.
 * @param {number} total
 * @returns {{ grade: string, comment: string }}
 */
function getGrade(total) {
  for (const t of GRADE_THRESHOLDS) {
    if (total >= t.min && total <= t.max) {
      return { grade: t.grade, comment: t.comment };
    }
  }
  return { grade: 'F9', comment: 'Fail' };
}

// ─── DATE FORMATTING ──────────────────────────────────────────────────────────

/**
 * Format a date as DD/MM/YYYY.
 * @param {Date|string} date
 * @returns {string}
 */
function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return String(date);
  return [
    String(d.getDate()).padStart(2, '0'),
    String(d.getMonth() + 1).padStart(2, '0'),
    d.getFullYear()
  ].join('/');
}

/**
 * Format a datetime as DD/MM/YYYY HH:MM.
 * @param {Date|string} date
 * @returns {string}
 */
function formatDateTime(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return String(date);
  return formatDate(d) + ' ' + [
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0')
  ].join(':');
}

// ─── VALIDATION ───────────────────────────────────────────────────────────────

/**
 * Check minimum password length (8 characters).
 * @param {string} password
 * @returns {boolean}
 */
function isValidPassword(password) {
  return typeof password === 'string' && password.trim().length >= 8;
}

/**
 * Check username format: 3–20 characters, letters / numbers / underscores only.
 * @param {string} username
 * @returns {boolean}
 */
function isValidUsername(username) {
  return typeof username === 'string' && /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

/**
 * Check that a score is within the allowed range for a component.
 * @param {string} component — e.g. 'C/W', 'Exam'
 * @param {number} value
 * @returns {boolean}
 */
function isValidScore(component, value) {
  const comp = Object.values(SCORE_COMPONENTS).find(c => c.key === component);
  if (!comp) return false;
  const n = Number(value);
  return !isNaN(n) && n >= 0 && n <= comp.max;
}

// ─── RESPONSE HELPERS ─────────────────────────────────────────────────────────

/**
 * Standard success envelope returned to the client.
 * @param {*} data
 * @returns {{ success: true, data: * }}
 */
function successResponse(data) {
  return { success: true, data: data };
}

/**
 * Standard error envelope returned to the client.
 * @param {string} message
 * @param {string} [code]
 * @returns {{ success: false, error: string, code: string }}
 */
function errorResponse(message, code) {
  return { success: false, error: String(message), code: code || 'ERROR' };
}

// ─── STRING UTILS ─────────────────────────────────────────────────────────────

/**
 * Convert a header string to camelCase key.
 * 'Staff ID' → 'staffId', 'Force Password Change' → 'forcePasswordChange'
 * @param {string} str
 * @returns {string}
 */
function toCamelCase(str) {
  return String(str)
    .trim()
    .split(/\s+/)
    .map((word, i) => {
      const lower = word.toLowerCase();           // normalise ALL-CAPS words like "ID"
      return i === 0
        ? lower
        : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}

/**
 * Safely coerce a value to boolean.
 * Handles TRUE/FALSE strings from Sheets.
 * @param {*} val
 * @returns {boolean}
 */
function toBoolean(val) {
  if (typeof val === 'boolean') return val;
  return String(val).toUpperCase() === 'TRUE';
}
