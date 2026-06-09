# HGUS Academic Result Management System — Project Log

> **How to use this file**
> - Claude reads this at the start of every new session — it is the ground truth for project state.
> - After every significant change, update the relevant stage block and the "Current State" section.
> - Do NOT delete old entries — mark them ✅ complete or ⚠️ known-issue.

---

## Current State (update this first in every session)

**Last updated:** 2026-06-09
**Active stage:** Stage 7 complete — no active stage
**Next planned work:** Stage 8 (Archive Session + Power BI endpoints) — deferred until real data
**Pending verification:** PSQ sticky-strip + fixed navigator bar fix (last change this session — user has not yet confirmed it works)

---

## Stage-by-Stage History

---

### Stage 1 — Foundation ✅ COMPLETE
**Folder:** `Stage 1 - Foundation\`
**What was built:**
- Config.gs, Utils.gs, SheetService.gs (10 sheets), AuthService.gs, UserService.gs, SetupService.gs
- Code.gs (all serverXxx wrappers), Index.html, StyleBase.html, AppScript.html
- Views: Login, ForceChangePassword, AdminHome, TeacherHome stub, UserList, AddUser, EditUser, ChangePassword
- DEPLOYMENT.md (initial)

**Key facts:**
- Super Admin bootstrap uses blank-hash flow (empty password hash triggers force-change on first login)
- All sessions via CacheService (5-min TTL)
- `toCamelCase` is the universal key convention for sheet reads

---

### Stage 2 — Data Sync ✅ COMPLETE
**Folder:** `Stage 2 - Data Sync\`
**What was built:**
- ClassService.gs, SubjectService.gs, StudentService.gs, AssignmentService.gs
- SheetService.gs, Code.gs, StyleBase.html, AppScript.html updated
- Views: Session Settings, Classes & Subjects, Manage Assignments
- External Google Sheet → student cache refresh
- Class/Subject/Form Master/Teacher-Subject assignment management

---

### Stage 3 — Score Entry ✅ COMPLETE
**Folder:** `Stage 3 - Score Entry\`
**What was built:**
- ScoreService.gs, PSQService.gs, RemarkService.gs, StatusService.gs
- Views: Teacher Home, FM Class Overview, Component Selector, Score Entry, PSQ Entry, Remarks Entry, Manage Class List
- Score components: C/W (6), ASS (2), ATT (2), Test1 (10), Test2 (10), Exam (70)
- CA Test 2 gated on every active student having Test 1; Exam gated on Test 1 + Test 2

---

### Stage 4 — Broadsheet & Results ✅ COMPLETE
**Folder:** `Stage 4 - Broadsheet & Results\`
**What was built:**
- BroadsheetService.gs, ResultService.gs
- Broadsheet per class/term (PDF + Excel), result slip per student (PDF + bulk batch)
- Totals, grades, CLASS MAX, positions (JSS: within class; SSS: across 3 departments at same level)

---

### Stage 5 — Locks & PDF Export ✅ COMPLETE
**Folder:** `Stage 5 - Locks & PDF Export\`
**What was built:**
- CompletionService.gs, PDFService.gs
- Completion gating (100% score entry required before broadsheet/result slip)
- Results Overview screen
- TestDataHelper.gs (dev-only seed data)

**Bug fixed (this project):**
- TestDataHelper was accumulating duplicate subject assignments across sessions. Fix: added Term to the duplicate-check condition and to the row data.
  File to update: `Stage 5 - Locks & PDF Export\TestDataHelper.gs`

---

### Stage 6 — Exports & Overview ✅ COMPLETE
**Folder:** `Stage 6 - Exports & Overview\`
**What was built:**
- OverviewService.gs, ExportService.gs, CarryForwardService.gs
- Student name/gender correction flow (FM edits; Admin resets)
- StudentData tab auto-detection and confirmation panel
- Updated: SheetService.gs, Code.gs, StyleBase.html, AppScript.html

**Key Stage 6 behaviours:**
- `getCachedStudents` merges corrections transparently — all callers get corrected names
- `studentDataTab` saved to Script Properties after Admin confirmation
- Admin/Super Admin can see Manage Class List from Classes & Subjects tab

**Pending (deferred to live data):**
- Carry-forward test: needs a real prior term with assignments before it can be verified

---

### Stage 7 — Audit & Locking ✅ COMPLETE
**Folder:** `Stage 7 - Audit & Locking\`

#### Files in this folder

| File | New or Updated | Purpose |
|------|---------------|---------|
| `Config.gs` | Updated | Added sheet name constants for Activity Log, Change Log, Result Locks |
| `SheetService.gs` | Updated | `logActivity_`, `logChange_`, Result Locks sheet read/write helpers |
| `Code.gs` | Updated | All serverXxx wrappers + audit logging wrappers for auth, config, results |
| `LogService.gs` | **New** | `logActivity(sess, category, action, detail)` and `logChange_(sess, sheet, studentId, classId, subjectId, term, session, field, old, new)` |
| `LockService.gs` | **New** | `lockClassTerm`, `unlockClassTerm`, `getClassTermLockStatus`, `isLocked` |
| `ScoreService.gs` | Updated | Score save now checks `LockService.isLocked` before writing; PSQ + Remarks IIFE wrappers for Change Log |
| `SetupService.gs` | Updated | `setupSheets()` creates Activity Log, Change Log, Result Locks sheets |
| `StyleBase.html` | Updated | Lock badge, lock action button, Activity Log view styles, Super Admin settings card, toggle switch, PSQ strip/navigator fix |
| `AppScript.html` | Updated | Activity Log view + filter; Lock/Unlock UI in class detail; PSQ strip/navigator layout fix |
| `StyleBase_Stage7_Additions.html` | Addition-only patch | Use if doing manual delta apply instead of full file replace |
| `AppScript_Stage7_Additions.html` | Addition-only patch | Use if doing manual delta apply instead of full file replace |
| `DEPLOYMENT.md` | **New** | Complete pilot-ready setup guide (replaces Stage 1 version) |

#### What was built

**Two-tier audit system:**
- **Activity Log** (in-app, visible to Super Admin; optionally Admin): high-level who-did-what events. Sheet: `Activity Log`. Columns: Timestamp | Staff ID | Staff Name | Role | Category | Action | Detail.
- **Change Log** (sheet-only, silent): per-field before/after snapshots for every score, PSQ rating, and remark save. Sheet: `Change Log`. Columns: Timestamp | Staff ID | Staff Name | Sheet | Student ID | Class ID | Subject ID | Term | Session | Field | Old Value | New Value.

**Events captured in Activity Log:**

| Category | Events |
|---|---|
| Auth | Login success, login failed, password change (self), force-change-password, password reset |
| User | User created, role changed |
| Config | Session changed, term changed, classes synced, subjects synced, student cache refreshed, StudentData tab confirmed, carry-forward executed |
| Results | Broadsheet Excel exported, score sheet PDF exported |
| Lock | Class-term locked, class-term unlocked |

**Events captured in Change Log:**
- Every individual score component write (old vs new value per field)
- Every PSQ trait rating change (old vs new per trait)
- Every remark field change (formMasterRemark, headTeacherRemark)

**Result Locking:**
- Admin/Super Admin can lock a class-term from Classes & Subjects → class detail
- Locked classes show amber lock badge in the list
- `saveScores` checks `LockService.isLocked` and returns error if locked
- Lock/unlock events written to Activity Log automatically

#### Bugs fixed in Stage 7

1. **Login logged as "Login failed" for successful logins**
   Root cause: success check was `result && result.success && result.data` — AuthService returns a flat response (no nested `data`), so `result.data` was undefined, triggering the failure branch.
   Fix: check only `result.success`; use `var d = result.data || result` to get user data.
   File: `Stage 7 - Audit & Locking\Code.gs` — `serverLogin` wrapper.

2. **PSQ strip overlapping trait rows**
   Root cause: `#app { min-height: 100vh }` means the PAGE scrolls, not `view-body`. `position: sticky` anchors to the page scroll context, not the `view-body` scroll context. The student strip was inside `view-body` so it scrolled with content.
   Fix:
   - Moved `.psq-student-strip` OUTSIDE `view-body` in `Views.psqEntry` HTML structure
   - `.psq-student-strip { position: sticky; top: var(--bar-height); z-index: 50 }` — sticks below app bar
   - `.view-body--psq { padding-top: 4px; padding-bottom: 80px }` — minimal gap, space for fixed navigator
   - `.psq-navigator { position: fixed; bottom: 0; left: 0; right: 0; z-index: 50 }` — always at viewport bottom
   - `renderPsqStudent` writes strip HTML to `#psq-student-strip` and traits to `#psq-entry-body`
   Files: `Stage 7 - Audit & Locking\StyleBase.html`, `Stage 7 - Audit & Locking\AppScript.html`
   ⚠️ **Awaiting user confirmation that this is visually correct.**

3. **TestDataHelper duplicate subject assignments**
   Root cause: duplicate check was missing Term — same subject was added again for new terms.
   Fix: added `String(r['Term']) === settings.term` to the `alreadyAssigned` check and `'Term': settings.term` to the row data.
   File: `Stage 5 - Locks & PDF Export\TestDataHelper.gs`

---

## Deferred / Future Work

| Item | Notes |
|------|-------|
| Stage 8: Archive Session | Deferred until real session data exists to archive |
| Stage 8: Power BI API endpoints | Deferred — needs real data first |
| Principal/Head Teacher Comments | Deferred — pending discussion about position-based auto-comment structure |
| Attendance Module | Not needed — ATT component (0–2) is sufficient for pilot |
| Carry-forward verification | Must test once a real prior term has assignments; couldn't test with seed data |

---

## Architecture Quick Reference

| Rule | Detail |
|------|--------|
| Key convention | Always `camelCase` — `toCamelCase("Full Name")` → `fullName` |
| Student name field | Always `s.fullName` (never `s.name`) |
| Score component keys | `C/W`, `ASS`, `ATT`, `Test1`, `Test2`, `Exam` (immutable) |
| Score maxes | C/W=6, ASS=2, ATT=2, Test1=10, Test2=10, Exam=70 |
| IDs | Students: `HG####`; Staff: `HGST###` |
| Response shape | Always `successResponse(data)` / `errorResponse(message, code)` |
| Session guard | `if (handleSessionExpired(result)) return;` — ALWAYS first line in every success handler |
| Stage inheritance | NEVER modify prior-stage files — copy verbatim, append new content only |
| All responses fire-and-forget | `logActivity()` and `logChange_()` must never throw — wrap in try/catch |

---

## Files to Update When Resuming

If continuing Stage 7 work, these are the active files:
- `Stage 7 - Audit & Locking\Code.gs`
- `Stage 7 - Audit & Locking\ScoreService.gs`
- `Stage 7 - Audit & Locking\AppScript.html`
- `Stage 7 - Audit & Locking\StyleBase.html`

For Stage 8, new files will go in `Stage 8 - Archive & API\`.
