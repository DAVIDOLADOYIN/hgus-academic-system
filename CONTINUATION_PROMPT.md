# Continuation Prompt — HGUS Academic Result Management System
## Stage 7: Audit Log + Result Locking + DEPLOYMENT.md

---

## What This Project Is

A **mobile-first Google Apps Script web application** for His Grace Universal Schools. It manages academic result entry, broadsheets, and result slip generation for the secondary school arm (JSS and SSS) only. The backend is Google Sheets. All code files are stored locally in the workspace folder and copied manually into the Apps Script editor by the developer.

**PRD:**
`C:\Users\david\OneDrive\Documents\Claude\Projects\HGUS Academic System\His Grace Universal School - Academic Result Management System.md`

**Workspace folder:**
`C:\Users\david\OneDrive\Documents\Claude\Projects\HGUS Academic System\`

---

## Architecture

- All sheet reads/writes go through `SheetService.gs`
- Business logic lives in named service files
- `Code.gs` exposes all `server*` functions callable from the client
- Frontend is a single-page app: `Index.html` (shell), `StyleBase.html` (CSS), `AppScript.html` (all client JS)
- All JS modules use the IIFE pattern: `const XService = (function() { ... return { ... }; })()`
- All responses use `successResponse(data)` / `errorResponse(message, code)` from `Utils.gs`
- `google.script.run` calls are sequential — no `Promise.all`

---

## Completed Stages

### Stage 1 — Foundation ✅ (`Stage 1 - Foundation\`)
Config, Utils, SheetService, AuthService, UserService, SetupService, Code.gs, Index.html, StyleBase.html, AppScript.html

### Stage 2 — Data Sync ✅ (`Stage 2 - Data Sync\`)
ClassService, SubjectService, StudentService, AssignmentService + updates to SheetService, Code.gs, StyleBase.html, AppScript.html
- Session Settings, Classes & Subjects, Manage Assignments views
- External Google Sheet → student cache refresh
- Class/Subject/FM/TS assignment management

### Stage 3 — Score Entry ✅ (`Stage 3 - Score Entry\`)
ScoreService, PSQService, RemarkService, StatusService + updates
- Score entry per component, PSQ ratings, Form Master remarks, student term status
- Teacher Home, FM Class Overview, Component Selector, Score Entry, PSQ Entry, Remarks Entry, Manage Class List views

### Stage 4 — Broadsheet & Results ✅ (`Stage 4 - Broadsheet & Results\`)
BroadsheetService, ResultService + updates
- Broadsheet per class/term (PDF + Excel export)
- Result slip per student (PDF, bulk batch)
- Totals, grades, CLASS MAX, positions computed

### Stage 5 — Locks & PDF Export ✅ (`Stage 5 - Locks & PDF Export\`)
CompletionService, PDFService + updates
- Completion gating (score entry must be 100% before broadsheet/result slip allowed)
- PDF generation via HtmlService print
- Results Overview screen
- TestDataHelper.gs (dev only — seed test data)

### Stage 6 — Exports & Overview ✅ (`Stage 6 - Exports & Overview\`)

**New files:**
| File | Purpose |
|------|---------|
| `ClassService.gs` | `getStudentDataSources` — auto-detects StudentData tabs by session short-form (e.g. "25/26"); returns detected + all options for Admin confirmation panel |
| `StudentService.gs` | `refreshStudentCache` — uses confirmed `studentDataTab` from Script Properties; accepts "Class" or "Student Class" as column header |
| `StatusService.gs` | Updated: Admin/Super Admin can now access `getClassStudentStatus`; `updateStudentCorrection` (FM); `clearStudentCorrection` (Admin/Super Admin) |
| `OverviewService.gs` | School-wide results overview — per-class completion, averages, student counts |
| `ExportService.gs` | Bulk broadsheet + result slip export orchestration |
| `CarryForwardService.gs` | Detect missing assignments at term start; prompt Admin to carry forward from prior term |
| `PDFService.gs` | PDF generation (carry-forward from Stage 5) |

**Updated files (Stage 6 versions replace prior versions):**
| File | Key Changes |
|------|-------------|
| `SheetService.gs` | `studentDataTab` in session settings; `getCachedStudents` applies name/gender corrections transparently; `refreshStudentCache` preserves corrections; `updateStudentCorrection`; `clearStudentCorrection`; `ensureCacheCorrectionsColumns_()` |
| `Code.gs` | `serverGetStudentDataSources`, updated `serverSyncClasses(token, externalSheetId, tabName)`, `serverUpdateStudentCorrection`, `serverClearStudentCorrection` |
| `AppScript.html` | StudentData source confirmation panel; `pickStudentDataSource()` helper; student name/gender correction UI in Manage Class List (Edit pill / ✏ Edited pill / Reset to source); Admin can reach Manage Class List from Classes & Subjects tab |
| `StyleBase.html` | `.score-max-banner` fix (position: static); student correction pill styles; edit bottom-sheet styles |

**Key Stage 6 behaviours:**
- StudentData tab selection: Admin sees a confirmation panel with auto-detected tab pre-selected. Confirmed tab saved to Script Properties (`studentDataTab`). All subsequent cache refreshes use this exact tab silently.
- Student name/gender corrections: FM can edit from Manage Class List. Corrections stored as `editedName`/`editedGender` in Students Cache sheet. `getCachedStudents` merges corrections transparently — all callers (score entry, broadsheet, result slip) get corrected names automatically.
- Admin/Super Admin can reset corrections from Classes & Subjects → tap class → Manage Class List → "Reset to source" button (only visible to Admin/Super Admin on corrected students).
- `callerIsAdmin` flag returned in `getClassStudentStatus` response so UI shows/hides reset button.
- `toCamelCase` rule: `updateRowWhere` matches keys using `toCamelCase(header)` — always pass camelCase keys (`editedName`, not `"Edited Name"`).

---

## Stage 7 — What to Build Next

**Stage 7 scope (agreed):**

### 1. Audit Log — Two-Tier System

**Tier 1 — Activity Log (visible in app UI)**

Log key administrative and configuration events. Stored in a new `Activity Log` sheet.

Each row: `Timestamp | Staff ID | Staff Name | Role | Category | Action | Detail`

Categories to log:
| Category | Events |
|---|---|
| Auth | Login (success), login (failed), password reset, force-change-password triggered |
| User Management | User created, role changed, user deleted/deactivated |
| Configuration | Active session changed, active term changed, classes synced, subjects synced, student cache refreshed, studentDataTab confirmed |
| Results | Broadsheet exported, result slip exported (single + bulk) |
| Corrections | Student name/gender corrected, correction reset |
| Archive | Session archived (Stage 8) |
| Lock | Class-term locked, class-term unlocked (Stage 7 Result Locking) |

UI: Super Admin home has a new "Activity Log" tile. Shows a filterable list — filter by category, by staff member, by date range. Super Admin sees all categories. Admin sees all EXCEPT Auth events (failed logins, password resets stay Super Admin only).

Super Admin can toggle "Allow Admins to view log" in Super Admin settings — stored in Script Properties.

**Tier 2 — Change Log (silent background trail, never shown in main UI)**

Every individual score save, PSQ save, and remark save logs a before/after snapshot to a `Change Log` sheet. This is never surfaced in normal app flow — it exists so that if an incident occurs (suspicious score change, parent complaint), Super Admin can filter the Change Log sheet directly in Google Sheets to reconstruct what happened.

Each row: `Timestamp | Staff ID | Staff Name | Sheet | Student ID | Class ID | Subject ID | Term | Session | Field | Old Value | New Value`

A single shared helper `LogService.logChange_(sheet, studentId, classId, subjectId, term, session, field, oldValue, newValue)` is called inside the relevant SheetService write functions.

### 2. Result Locking

Admin can lock a class for a given term once scores are finalised. After locking, no teacher can save scores for that class/term. Only Admin (or Super Admin) can unlock.

**New sheet:** `Result Locks` — columns: Class ID | Term | Session | Locked By | Locked At | Unlocked By | Unlocked At | Is Locked

**New service file:** `LockService.gs`
- `lockClassTerm(token, classId, term, session)` — Admin/Super Admin only
- `unlockClassTerm(token, classId, term, session)` — Admin/Super Admin only
- `getClassTermLockStatus(token, classId)` — returns lock state for current session/term

**Gate in ScoreService:** `saveScores` checks `LockService.isLocked(classId, term, session)` before writing. Returns a clear error if locked.

**UI:** Admin → Classes & Subjects → tap class → shows lock status + Lock/Unlock button. Locked classes show a lock badge in the class list. Locking/unlocking is logged in Tier 1 Activity Log automatically.

### 3. DEPLOYMENT.md

A complete pilot-ready setup guide covering:
- Creating the Apps Script project and linking the spreadsheet
- Which files go where (all .gs files, all .html files)
- Super Admin bootstrap: setting the 4 columns in Users sheet
- Deploying as a web app (Execute as: Me, Who has access: Anyone)
- Connecting the external student data sheet
- First-run checklist: Setup Sheets → confirm StudentData tab → sync classes → sync subjects → refresh student cache → create Admin account → carry-forward check

---

## Critical Rules — Must Always Follow

### Stage Inheritance Rule (MOST IMPORTANT)
**Never rewrite existing stage files.** Each Stage 7 file that updates a shared file must:
1. Read the Stage 6 version of that file in FULL first
2. Use Stage 6 content verbatim as the starting point
3. Only append new Stage 7 additions at the bottom
4. Never modify anything that came before

This applies to: `SheetService.gs`, `Code.gs`, `StyleBase.html`, `AppScript.html` and any other updated files.

### `toCamelCase` Key Rule
`updateRowWhere` and `appendRow` both call `toCamelCase(header)` before matching keys. Always pass camelCase data keys. Never pass "Column Name With Spaces" as a key.

### Session Guard (every server success handler):
```javascript
.withSuccessHandler(function (result) {
  if (handleSessionExpired(result)) return; // ALWAYS first line
  // ...
})
```

### SPA Router Pattern:
- `navigateTo(view, params)` → pushes to `App._navHistory`, calls `renderView`
- `navigateBack()` → pops `App._navHistory`
- `renderView(view)` → calls `Views[view](App.viewParams)` → injects HTML into `#app`
- Every view has an `initView` function for its async data load

### SSS Class Grouping:
SSS has 9 classes (SSS 1 Art, SSS 1 Commerce, SSS 1 Science × 3 levels). Always use `getFMGroupKey()` / `stripDept()` when grouping SSS classes at the level.

### UI Design Standard (Minimum bar for every screen):
- Section cards: white rounded cards with box-shadow (`section-card`)
- List-item actions: `fm-action-btn` (icon + label + › chevron, full-width, separator lines)
- Collapsible panels: long lists default to collapsed with tappable header + rotating chevron
- Consistent spacing: `margin: 0 var(--space-md) var(--space-md)`; no content touches screen edge
- Empty states: always `empty-msg` paragraph, never raw empty container
- Loading states: always `.loading-placeholder` (spinner + centred text)

### Student name field:
Always `s.fullName` (never `s.name`) — `toCamelCase("Full Name")` → `fullName`

### Score component keys (immutable):
`C/W`, `ASS`, `ATT`, `Test1`, `Test2`, `Exam`

### Score maxes:
C/W = 6, ASS = 2, ATT = 2, Test1 = 10, Test2 = 10, Exam = 70, Total = 100

### Lock rules (enforced in UI + server + now + Result Locking):
- CA Test 2 locked until every Active student has CA Test 1
- Exam locked until every Active student has CA Test 1 AND CA Test 2
- Result Lock (new Stage 7): class-term locked by Admin prevents ALL score saves

### IDs:
- Student IDs: `HG####` format, come from external sheet
- Staff IDs: `HGST###` format
- `generateId(PREFIX, existingIds)` from Utils.gs

### Always `escHtml()` around every user-provided string in HTML output.

---

## School Structure Reference

**Sections:** JSS (JSS 1, JSS 2, JSS 3) and SSS (SSS 1/2/3 × Art/Commerce/Science = 9 classes). 12 classes total.
**Terms:** First Term, Second Term, Third Term
**Sessions:** e.g. 2025/2026

**Position ranking:**
- JSS: within that single class
- SSS: across all three departments at the same level (SSS 1 Art + SSS 1 Commerce + SSS 1 Science combined)
- Ties: shared rank, next rank skipped

**Grade system:**
75–100 A1 Excellent | 70–74 B2 Very Good | 65–69 B3 Good | 60–64 C4 Fairly Good |
55–59 C5 Fairly Good | 50–54 C6 Fairly Good | 45–49 D7 Weak | 40–44 E8 Very Weak | 0–39 F9 Fail

---

## Future (NOT Stage 7)

- **Stage 8:** Archive Session + Power BI API endpoints (deferred until real data exists)
- **Principal/Admin Comments:** Deferred — pending discussion with principal about position-based auto-comment structure
- **Attendance Module:** Not needed — current ATT score component (0–2) is sufficient for the pilot
- **Carry-forward test:** Needs a term with existing assignments followed by a new term to verify — remind to test when live data exists
