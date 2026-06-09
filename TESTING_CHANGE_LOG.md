# HGUS Academic System — Testing Change Log

All bugs found and fixes applied during live testing, from Stage 1 through Stage 2.

---

## Stage 1 — Foundation

### T1-01 · Super Admin bootstrap — blank password hash gate
**Found during:** Initial login test with the bootstrapped Super Admin account.  
**Problem:** Logging in with `Force Password Change = TRUE` and a blank password hash caused a crash instead of routing to the Change Password screen.  
**Fix:** `AuthService.gs` — added a blank-hash check before password comparison; blank hash + `forcePasswordChange = TRUE` routes directly to the forced change screen without attempting a hash match.

---

## Stage 2 — Data Sync

### T2-01 · OAuth scope error — external spreadsheet access blocked
**Found during:** Step 2 of Stage 2 testing — Sync Classes.  
**Symptom:** Error: *"Could not open the external spreadsheet. Check the Sheet ID..."* even though the sheet ID was correct and owned by the same Google account.  
**Root cause:** `SpreadsheetApp.openById()` requires the `https://www.googleapis.com/auth/spreadsheets` scope to be explicitly declared in `appsscript.json`. Without it, GAS refuses cross-spreadsheet access regardless of ownership.  
**Fix:** Added `oauthScopes` array to `appsscript.json`:
```json
"oauthScopes": [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/script.external_request"
]
```
Re-authorised the script and redeployed.

---

### T2-02 · StudentService — column header mismatch
**Found during:** Step 4 of Stage 2 testing — Refresh Student List.  
**Symptom:** Error: *"Missing required columns: Student Class"* despite the external sheet having the correct data.  
**Root cause:** The external sheet used the header "Class" instead of "Student Class". The original code used an exact match `headers.indexOf('student class')` which returned -1.  
**Fix:** `StudentService.gs` — changed column detection to accept both:
```javascript
const colClass = headers.findIndex(function(h) {
  return h === 'student class' || h === 'class';
});
```

---

### T2-03 · Form Master UI — button and checkbox alignment
**Found during:** Step 5 of Stage 2 testing — Manage Assignments → Form Masters.  
**Symptom:** The checkbox ("Grant full-class access") and the Assign/Remove buttons were not vertically aligned; the layout looked disjointed on mobile.  
**Fix:** `AppScript.html` — rewrote the assign-card inner HTML to use a dedicated `assign-card__body` flex row, placing the checkbox and buttons in the same aligned row. `StyleBase.html` — adjusted `.assign-card__class` to `flex-direction: column; align-items: flex-start` so the class label and body stack cleanly.

---

### T2-04 · Form Master SSS grouping — 9 cards instead of 6
**Found during:** Step 5 of Stage 2 testing — Manage Assignments → Form Masters.  
**Symptom:** The Form Masters tab showed 9 SSS cards (SSS 1 Science, SSS 1 Art, SSS 1 Commerce, etc.) instead of 6 (JSS 1, JSS 2, JSS 3, SSS 1, SSS 2, SSS 3). Each SSS department had its own Form Master card, which is incorrect — one Form Master covers the whole level (e.g., SSS 1 regardless of department).  
**Fix:**  
- Added `getFMGroupKey(className)` helper that strips department suffix from class names: `"SSS 1 Science"` → `"SSS 1"`.  
- Added `buildFMGroups()` which collapses `_assignClasses` into 6 group objects, each holding all classIds in that level.  
- Rewrote `renderFMTab()` to render one card per group.  
- Save and remove operations chain sequential `serverAssignFormMaster` / `serverRemoveFormMaster` calls for all classIds in the group.

---

### T2-05 · Teacher Subject — single-class assignment only
**Found during:** Step 6 of Stage 2 testing — Manage Assignments → Teacher Subjects.  
**Symptom:** The Add Assignment form had a single class dropdown, so a teacher could only be assigned to one class at a time. Assigning a teacher to Geography across three levels required three separate form submissions.  
**Fix:**  
- Replaced the class dropdown with a dynamic scrollable checkbox list (`#ts-class-list`) that appears after a subject is selected.  
- The list is populated by `onTSSubjectChange()` which reads `_assignCSA` (Class-Subject Assignments) to show only classes that actually offer the selected subject.  
- Added a "Select all available" toggle checkbox at the top.  
- `addTeacherAssignment()` loops through all checked classIds and chains sequential server calls.  
- Added CSS: `.check-list`, `.check-list__item`, `.check-list__item--all`, `.check-list__item--taken`, `.check-list__taken-label`, `.check-list__empty` to `StyleBase.html`.

---

### T2-06 · Teacher Subject — already-assigned classes not indicated
**Found during:** Step 6 follow-up testing.  
**Symptom:** When opening the class checkbox list, classes where the selected teacher/subject combination already existed were shown as available checkboxes, allowing duplicate assignments to be attempted.  
**Fix:** `onTSSubjectChange()` now cross-references `_assignTS` to find which groups already have an assignment for the selected subject and term, and renders those as disabled rows with the assigned teacher's name shown.

---

### T2-07 · Teacher Subject — SSS assignments split by department in the list
**Found during:** Step 6 follow-up testing after multi-class assignment was working.  
**Symptom:** When a teacher was assigned to Geography for SSS classes, the Current Assignments list showed three separate rows: "SSS 1 Science · Geography", "SSS 1 Art · Geography", "SSS 1 Commerce · Geography" — making the list unnecessarily long and confusing.  
**Expected:** One row per level: "SSS 1 · Geography", "SSS 2 · Geography", "SSS 3 · Geography".  
**Root cause:** The checkbox list was showing individual classIds (one per SSS department), and the assignments list was iterating `_assignTS` directly without deduplication.  
**Fix (three parts):**

**Part A — Checkbox list grouping** (`onTSSubjectChange()`):  
Classes are now grouped by `getFMGroupKey()` before rendering. Checkboxes show level keys ("SSS 1") not class names. `_tsClassGroups` maps each groupKey → `[classId, ...]`. A reverse map `classToGroup` is used to correctly detect which groups are already taken.

**Part B — Add assignment expansion** (`addTeacherAssignment()`):  
Checkbox `.value` attributes are now groupKeys. Each selected groupKey is expanded to its classIds via `_tsClassGroups[key]` before the server call loop. Selecting "SSS 1" creates up to 3 server writes (one per department classId).

**Part C — Assignments list deduplication** (`renderTSTab()`):  
`_assignTS` is collapsed into `_tsDisplay` by deduplicating on `staffId|subjectId|getFMGroupKey(className)|term`. The displayed count and each rendered row reflect the deduplicated entries. The Remove button calls `removeTeacherAssignmentGroup(assignmentIds)` with a JSON array of all underlying assignment IDs.

---

### T2-08 · Teacher Subject — remove function only handled one ID
**Found during:** Part of the T2-07 fix.  
**Problem:** `removeTeacherAssignment(assignmentId)` only accepted a single ID. After deduplication, one "SSS 1 · Geography" row could represent 3 underlying assignment records.  
**Fix:** Replaced with `removeTeacherAssignmentGroup(assignmentIds)` that accepts an array and chains sequential `serverRemoveTeacherAssignment` calls, then reloads the list once all are removed.

---

### T2-09 · User Profile subtitle stuck on "Loading…"
**Found during:** User List → tap a user → Edit User screen.  
**Symptom:** The app bar subtitle showed "Loading…" (the initial placeholder text) even after the user profile had fully loaded and all fields were populated.  
**Root cause:** `renderEditUserForm()` updated `h1.textContent` but never updated the `.subtitle` element.  
**Fix:** `AppScript.html` — added one line after the h1 update:
```javascript
const subtitleEl = document.querySelector('.app-bar .subtitle');
if (subtitleEl) subtitleEl.textContent = user.role || 'Staff Profile';
```

---

### T2-10 · Back arrow — not vertically centred in button
**Found during:** Visual review of User Profile screen.  
**Symptom:** The ← arrow glyph inside the round back button appeared slightly off-centre vertically, despite the button using `display: flex; align-items: center; justify-content: center`.  
**Root cause:** Browser `<button>` elements have default non-zero padding which offsets the flex centring calculation.  
**Fix:** `StyleBase.html` — added `padding: 0; line-height: 1;` to `.app-bar__back`.

---

### T2-11 · Joined date displayed as raw ISO string
**Found during:** User Profile screen review.  
**Symptom:** "Joined: 2026-05-03T23:00:00.000Z" — raw ISO format, unreadable for end users.  
**Expected:** "Sun, 03 May, 2026 23:00"  
**Fix:** Added `formatDateTime(isoStr)` helper to `AppScript.html` that converts any ISO string to the `ddd, dd mmm, yyyy hh:mm` format using manual array lookups (avoids `Intl` API compatibility issues in GAS's embedded WebView). Applied to `user.dateJoined` in `renderEditUserForm()`.

---

### T2-12 · Session timeout fired while user was still active in the app

**Found during:** Live testing between Stage 2 and Stage 3 — user received "Session expired" error while actively using the app, without having been idle.

**Root cause (two independent problems working together):**

**Problem A — Two timers with different reset conditions.**
The app uses two completely independent timeout clocks:
- The **client-side timer** (`INACTIVITY_MS = 5 min` in `AppScript.html`) resets on any screen interaction — a tap, scroll, or keypress.
- The **server-side cache TTL** (`SESSION_TIMEOUT_SECONDS = 300` in `Config.gs`) resets only when an actual server call (`google.script.run`) is made.

A user could be actively reading data on screen — which keeps the client timer alive — but if no server call was made for 5 minutes (e.g. they were reading a long assignment list without taking any action), the server cache entry expired quietly. The next server action then returned `SESSION_EXPIRED` even though the user was never idle.

**Problem B — No centralised handler for `SESSION_EXPIRED` on the client.**
When the server returned `{ success: false, code: 'SESSION_EXPIRED' }`, each `withSuccessHandler` only showed `result.error` in whatever inline alert happened to be on screen. The session was not cleared, the login screen was not shown, and the user was left in a broken half-authenticated state.

**Fix A — `Config.gs` (Stage 1):** Increased `SESSION_TIMEOUT_SECONDS` from `300` (5 min) to `3600` (1 hour).
- The client-side 5-minute inactivity timer is the primary logout guard for real users.
- The server cache is now a backstop for truly abandoned sessions (browser crashed, tab closed without logout), not a racing timer against the client.
- In normal use the client timer will always act first.

**Fix B — `AppScript.html` (Stage 2):** Added `handleSessionExpired(result)` utility function.
- Checks if any server response has `code === 'SESSION_EXPIRED'`.
- If yes: clears the session, navigates to login, and shows a clear toast message.
- Returns `true` so the caller bails out with a single `return`.
- Applied as the **first line** of every `withSuccessHandler` that sends a token to the server — 22 handlers total across all views.

**Files changed:**
- `Stage 1 - Foundation/Config.gs` — `SESSION_TIMEOUT_SECONDS` 300 → 3600
- `Stage 2 - Data Sync/AppScript.html` — added `handleSessionExpired()` function; applied guard to all 22 server success handlers

---

### T2-13 · User Profile — name duplicated in app bar and summary card
**Found during:** Visual review of the Edit User screen.  
**Symptom:** The user's name appeared twice — once as the `h1` in the blue app bar banner, and again as a bold heading inside the first summary card of the profile.  
**Fix:** `AppScript.html` — removed the `<div class="fw-bold">name</div>` line from the summary card in `renderEditUserForm()`. The card now starts directly with the staff ID and username row, which is sufficient for identification since the name is already visible in the banner above. A comment was added to the code explaining the intentional omission.

---

### T2-14 · User Profile — Joined date showing meaningless 00:00 time
**Found during:** Visual review of Edit User screen after T2-13 fix.  
**Symptom:** The Joined date displayed as "Mon, 04 May, 2026 00:00". The `00:00` is not a real time — `dateJoined` is stored as a date-only value in the sheet (no time component recorded). When Apps Script serialises it, it becomes a midnight UTC ISO string, and `formatDateTime` correctly reads the local-timezone time as 00:00 — which is meaningless to the user.  
**Fix:** `AppScript.html` — added a `formatDate(isoStr)` helper that formats as `"ddd, dd mmm, yyyy"` with no time component. Switched `dateJoined` in `renderEditUserForm()` from `formatDateTime` to `formatDate`. Updated the `formatDateTime` doc comment to explain when to use each function. The result now displays as "Mon, 04 May, 2026".

---

---

## Stage 3 — Score Entry

### T3-01 · FM Class Overview — student names not showing
**Found during:** Test C (FM Class Overview).
**Symptom:** Student list showed only status badges with no names.
**Root cause:** JS read `s.name` but `SheetService.getCachedStudents()` uses `toCamelCase()` on the "Full Name" column header, producing `fullName` — not `name`.
**Fix:** `AppScript.html` — changed `s.name` → `s.fullName || s.name || '—'` in `initFmClassOverview`. Applied the same fallback chain to `initManageClassList`.

---

### T3-02 · Component Selector — blank screen after tapping a subject
**Found during:** Test D (Component Selector).
**Symptom:** Tapping any subject card navigated to the Component Selector but the screen remained blank (no tiles rendered).
**Root cause (two mismatches):**
1. Client read `result.data.components` — server returns `result.data.statuses`.
2. Client read `comp.enteredCount` / `comp.totalStudents` — server returns `comp.entered` / `comp.total`.
**Fix:** `AppScript.html` — corrected all three field names in `initComponentSelector`. Added inline comments naming the exact server keys to prevent regression.

---

### T3-03 · Score Entry — blank screen after tapping a component tile
**Found during:** Test E (Score Entry).
**Symptom:** After selecting a component, Score Entry showed only the "Save All Scores" button — no students listed and no max score banner.
**Root cause (two mismatches):**
1. Client read `data.students` — server returns `data.roster`.
2. Client read `data.maxScore` — server returns `data.max`.
**Fix:** `AppScript.html` — corrected both field names in `initScoreEntry`. Added inline comments.

---

### T3-04 · Score Entry app bar — raw component key displayed
**Found during:** Test E (Score Entry).
**Symptom:** The app bar title showed the raw key "C/W" instead of the friendly label "Class Work".
**Root cause:** `Views.scoreEntry` passed the raw `component` key string directly to `appBarHtml` instead of looking up the display label.
**Fix:** `AppScript.html` — added global `COMPONENT_DISPLAY_LABEL` constant mapping all six keys to friendly names. `Views.scoreEntry` now uses `COMPONENT_DISPLAY_LABEL[component] || component`.

---

### T3-05 · saveAllScores — wrong CSS class on error inputs
**Found during:** Score entry validation testing.
**Symptom:** Scores above the maximum were not highlighted red when the save validation ran — the error styling was silently failing.
**Root cause:** `saveAllScores` applied `input.classList.add('input--error')` but the CSS defines `.score-input--error` (not `.input--error`).
**Fix:** `AppScript.html` — corrected class name to `score-input--error` in both add and remove calls inside `saveAllScores` and `validateScoreInput`.

---

### T3-06 · Locked component tile — overlapping text on Exam card
**Found during:** Component Selector visual review.
**Symptom:** The Exam lock indicator text overlapped the tile content — the lock emoji and reason text were positioned absolutely over the tile name and count.
**Root cause:** Lock indicator used `position: absolute` which floated on top of sibling elements instead of flowing below them.
**Fix:** `StyleBase.html` — removed absolute positioning from `.component-tile__lock-reason`. Added `.component-tile__spacer { flex: 1 }` to push the lock reason to the bottom of the flex column. Hidden progress bar and count on locked tiles via CSS (`display: none` on `.component-tile--locked .component-tile__bar` and `__count`).

---

### T3-07 · Component Selector — SSS department name shown in subtitle
**Found during:** Testing Biology (SSS 1 Science).
**Symptom:** The component selector app bar subtitle showed "SSS 1 Science" instead of "SSS 1".
**Root cause:** `renderTeacherHomeSections` called `stripDept()` only on the card's displayed detail text — the raw `a.className` (including department) was embedded in the `onclick` string passed to `navigateTo`, so the full name reached the component selector.
**Fix:** `AppScript.html` — computed `const shortClass = escHtml(stripDept(a.className))` once and used it in both the onclick params and the card detail text.

---

### T3-08 · Back button arrow — not vertically centred in circle
**Found during:** Visual review across multiple screens.
**Symptom:** The `←` Unicode arrow appeared slightly above or off-centre in the round back button on Android.
**Root cause:** The `←` glyph (U+2190) has uneven ascender/descender metrics across Android system fonts. No amount of `display: flex; align-items: center` or `line-height` adjustments can correct a character whose visual centre doesn't match its bounding box.
**Fix:**
- `AppScript.html` — replaced `&#8592;` in `appBarHtml` with an inline SVG chevron (`<path d="M7.5 1.5L2 7.5L7.5 13.5">`). SVG renders as a geometric shape — immune to font metric variance.
- `StyleBase.html` — updated `.app-bar__back` to `display: grid; place-items: center` and removed font-specific properties. Added `.app-bar__back svg { display: block }` to prevent inherited styles from affecting the SVG.

---

### T3-09 · PSQ ratings — buttons not right-aligned
**Found during:** Test G (PSQ Entry).
**Symptom:** The five rating circle buttons (1–5) for each trait row were left-aligned instead of sharing a uniform right-column alignment.
**Root cause:** CSS class name mismatch — the JS generated `class="psq-trait-row__label"` (BEM naming) but the CSS only defined `.psq-trait-label`. The `flex: 1` rule that stretches the label and pushes buttons right was never applied.
**Fix:** `StyleBase.html` — combined both selectors: `.psq-trait-label, .psq-trait-row__label { flex: 1; ... }` so both names work, covering existing and future code.

---

### T3-10 · Loading states — text flush with screen edge on all screens
**Found during:** Visual review of Component Selector and Score Entry loading.
**Symptom:** "Loading component progress…" and similar loading messages appeared in the top-left corner with no padding, touching both the app bar and the left edge.
**Root cause:** `.loading-placeholder` had no CSS defined at all — the class existed in JS but was never styled.
**Fix:** `StyleBase.html` — added `.loading-placeholder` with `display: flex; flex-direction: column; align-items: center; padding: var(--space-xl) var(--space-md)`. Added a `::before` pseudo-element spinner ring using the existing `@keyframes spin` animation. All seven loading states across the app now show a centred spinner above the loading text.

---

### T3-11 · Manage Class List — unstyled raw list
**Found during:** Test I (Manage Class List).
**Symptom:** The screen showed student names and status chips with no card structure, no padding, text flush against the screen edges, and the instruction text sitting directly against the app bar.
**Root cause:** CSS classes `.status-list`, `.status-list__item`, `.status-list__name` were referenced in JS but never defined in StyleBase.html. No wrapper structure existed.
**Fix:**
- `AppScript.html` — rebuilt the `initManageClassList` success handler HTML to wrap the student list in a `section-card` with a student count header; added a `manage-hint` banner above explaining the tap-to-change interaction.
- `StyleBase.html` — added `.status-list`, `.status-list__item`, `.status-list__name`, `.manage-hint`, `.manage-hint__icon`, `.manage-hint__text` CSS classes.

---

---

## Stage 4 — Broadsheet & Results

### T4-01 · Subject Scores list — emoji icon replaced with abbreviation pill
**Found during:** Visual review of the Subject Scores list screen.  
**Symptom:** Each subject row used a 📚 emoji as its left icon, which looked unpolished and inconsistent with the rest of the app's UI standard.  
**Fix:**  
- `AppScript.html` — added `subjectAbbr(name)` helper function (after `initials()`). Strips noise words (and, of, the, a, in, for, to, at, &), takes the first letter of the first two significant words, uppercases the result. Falls back to the first two characters of a single-word name.  
- Subject Scores list item left icon changed from the emoji span to `<div class="fm-action-btn__abbr">` containing the two-letter abbreviation.  
- `StyleBase.html` — added `.fm-action-btn__abbr`: 36×36px rounded tile, light blue background (`#e8eeff`), primary-colour text, 11px bold letter-spaced font.

---

### T4-02 · Student Results list — emoji icon replaced with initials circle
**Found during:** Visual review of the broadsheet student list screen.  
**Symptom:** Each student row used a 👤 emoji as its left icon, inconsistent with the avatar-circle pattern used elsewhere in the app.  
**Fix:** `AppScript.html` — student list item left icon changed to `<div class="list-row__avatar">` populated by `initials(s.name)`. `.list-row__avatar` already existed in `StyleBase.html` from Stage 3.

---

### T4-03 · Broadsheet table — Name column too close to the left edge
**Found during:** Visual review of broadsheet and subject detail tables on a live device.  
**Symptom:** The Name column header and cell text were flush against the left border of the sticky column with no breathing room, making names hard to read.  
**Fix:** `StyleBase.html` — added `padding-left: var(--space-md)` to both `.bs-th--name` and `.bs-td--name`. The right-side padding was already present; this matched the left side symmetrically.

---

### T4-04 · FM access to Results & Broadsheet — tile added to teacher home
**Change (new feature):** Form Masters are responsible for broadsheet and result preparation for their class. They now have a "Results & Broadsheet" entry point on their teacher home screen.  
**Implementation:**  
- `AppScript.html` — `renderTeacherHomeSections()` now derives unique group keys from the FM's class list by running each class name through `stripDept()` and deduplicating. For each unique group key a `home-card home-card--results` button is rendered under a "Results & Broadsheet" section heading.  
- `StyleBase.html` — added `.home-card--results` with an amber/gold tint to visually distinguish this tile from the blue FM class cards and green TS cards.  
- `BroadsheetService.gs` — added `getFMGroupKeys_(staffId)` private helper that maps a staff member's active FM assignment classIds to group keys. Added `validateBroadsheetAccess_(sess, classGroupKey)` that grants Admin/SA unrestricted access and grants non-admin users access only if they have an FM assignment covering the requested group key.  
- All four `BroadsheetService` public functions updated to use `validateBroadsheetAccess_()`.  
- `ResultService.gs` — `getStudentResult()` non-admin path now checks `SheetService.getFormMasterAssignmentsByStaff(staffId)` for the specific classId instead of doing a role-string comparison.

---

### T4-05 · FM Results tile — button navigated to blank screen
**Found during:** Live test of the FM Results tile on the teacher home screen.  
**Symptom:** Tapping the "Results Overview" card for a class did nothing visible — the screen appeared to navigate but then showed no content.  
**Root cause:** The onclick called `openClassGroup(gk)` passing the groupKey string as the argument. `openClassGroup(idx)` expects a numeric index into `_bssGroups[]`, which is only populated when `broadsheetHome` loads. FMs skip `broadsheetHome` entirely, so `_bssGroups` was always empty — `_bssGroups["JSS 3"]` returned `undefined`, causing an early return before any navigation occurred.  
**Fix:** `AppScript.html` — changed the FM tile onclick from `openClassGroup(gk)` to `navigateTo('broadsheetClassMenu', {groupKey: gk})`, bypassing the index array entirely and navigating directly to the class menu with the group key as a param. Added a code comment explaining why `openClassGroup()` cannot be used here.

---

### T4-06 · FM broadsheet access — "Unauthorised" on all three screens
**Found during:** Live test after T4-05 fix — FM could reach the Class Menu but tapping Broadsheet, Subject Scores, or Results all returned "Unauthorised."  
**Root cause:** The auth logic in `BroadsheetService.gs` and `ResultService.gs` used `sess.role === ROLES.FORM_MASTER` to grant non-admin access. However, `ROLES` in `Config.gs` only defines three constants: `SUPER_ADMIN`, `ADMIN`, `TEACHER`. There is no `ROLES.FORM_MASTER` — it evaluates to `undefined`. The comparison always failed, so every non-admin user was rejected regardless of their actual FM assignment.  
**Fix:**  
- `BroadsheetService.gs` — replaced the role-string check entirely with an assignment-based check. `validateBroadsheetAccess_()` now calls `getFMGroupKeys_(sess.staffId)` and grants access if the requested group key appears in the FM's assigned group keys. No role string is compared.  
- `ResultService.gs` — same fix. The non-admin path calls `SheetService.getFormMasterAssignmentsByStaff(sess.staffId)` and checks whether the requested `classId` is in the returned assignment classIds.  
- Added a prominent comment in both files explaining that Form Master is not a role constant — it is a Teacher with an active FM assignment row.

---

### T4-07 · Super Admin — delete user account (new feature)
**Change (new feature):** Super Admins can permanently delete a staff account from the Edit User screen.  
**Implementation:**  
- `AppScript.html` — `renderEditUserForm()` renders a red-tinted "Danger Zone" card at the bottom of the profile when all three conditions hold: caller is Super Admin, caller is not viewing their own profile, target user is not a Super Admin. Card contains a "Delete Account" button. `confirmDeleteUser(staffId, userName)` shows a native `confirm()` dialog. `submitDeleteUser(staffId)` calls `serverDeleteUser` and on success navigates back to the User List with a toast.  
- `StyleBase.html` — added `.eu-danger-zone` (red-tinted border, light red background) and `.eu-danger-zone__title` (red bold heading).  
- `SheetService.gs` — added `deleteUserRecord(staffId)` using the existing private `deleteRowWhere()` helper. Exposed in the public API.  
- `Code.gs` — added `serverDeleteUser(token, staffId)` with four server-side guards: (1) valid session, (2) Super Admin only, (3) cannot delete self, (4) cannot delete another Super Admin.  
- **Known boundary:** deleting a user does not remove their FM or TS assignment rows — orphaned assignment rows remain harmless but untidy. Reassign before deleting.

---

### T4-08 · Class Menu — excessive gap below header banner
**Found during:** Visual review of the Class Menu screen on a live device.  
**Symptom:** The space between the blue app bar banner and the first option card was visibly larger than the 16px standard used across other screens.  
**Root cause:** `.bcm-options` had `padding: 24px var(--space-md) var(--space-md)` — 24px top padding stacked on top of `.view-body`'s existing `padding-top: 16px`, producing a 40px total gap.  
**Fix:** `StyleBase.html` — changed `.bcm-options` top padding to `0`: `padding: 0 var(--space-md) var(--space-md)`. Gap is now 16px, consistent with all other screens.

---

### T4-09 · FM Class Overview — excessive gap below header banner
**Found during:** Visual review of the FM Class Overview screen alongside T4-08.  
**Symptom:** Same double-padding symptom — too much space below the app bar banner.  
**Root cause:** `initFmClassOverview` wrapped its content in `<div style="padding-top:var(--space-md)">`, adding 16px on top of `.view-body`'s `padding-top: 16px`, totalling 32px.  
**Fix:** `AppScript.html` — removed the inline `padding-top` from the wrapper div in `initFmClassOverview`. The wrapper is now `<div>` with no top padding, relying solely on `.view-body` for headroom.

---

### T4-10 · Teacher Home — excessive gap below header banner
**Found during:** Visual review alongside T4-08 and T4-09.  
**Symptom:** Same double-padding symptom on the teacher home screen.  
**Root cause:** `renderTeacherHomeSections()` wrapped all content in `<div class="page-content">`. `.page-content` applies `padding: var(--space-md)` on all four sides (16px each). Inside `.view-body` which already provides `padding-top: 16px`, total gap above the greeting was 32px.  
**Fix:** `AppScript.html` — changed the wrapper from `<div class="page-content">` to `<div style="padding: 0 var(--space-md)">`. This preserves left/right padding (so content doesn't touch screen edges) while eliminating the extra top padding. Added a comment explaining the reason.

---

## Summary Counts

| Stage | Bugs Fixed | Features Added |
|-------|-----------|---------------|
| Stage 1 | 1 | — |
| Stage 2 | 14 | — |
| Stage 3 | 11 | — |
| Stage 4 | 8 | 2 (FM broadsheet access, delete user) |
| **Total** | **34** | **2** |
