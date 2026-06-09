# Continuation Prompt — HGUS Academic Result Management System

> **How to start a new session:**
> Paste this entire file into a new Claude chat and say: "Read this and let's continue."
> For full stage-by-stage history, bugs, and file details — read PROJECT_LOG.md in the workspace folder.

---

## What This Project Is

A **mobile-first Google Apps Script web application** for His Grace Universal Schools. It manages academic result entry, broadsheets, and result slip generation for the secondary school arm (JSS and SSS). Backend: Google Sheets. All code files are stored locally in the workspace folder and manually copied into the Apps Script editor.

**PRD:** `C:\Users\david\OneDrive\Documents\Claude\Projects\HGUS Academic System\His Grace Universal School - Academic Result Management System.md`

**Workspace folder:** `C:\Users\david\OneDrive\Documents\Claude\Projects\HGUS Academic System\`

**Detailed project log:** `PROJECT_LOG.md` in the workspace folder — read this for full stage history, all bugs fixed, and pending items.

---

## Architecture

- All sheet reads/writes go through `SheetService.gs`
- Business logic lives in named service files
- `Code.gs` exposes all `serverXxx` functions callable from the client
- Frontend is a single-page app: `Index.html` (shell), `StyleBase.html` (CSS), `AppScript.html` (all client JS)
- All JS modules use the IIFE pattern: `const XService = (function() { ... return { ... }; })()`
- All responses use `successResponse(data)` / `errorResponse(message, code)` from `Utils.gs`
- `google.script.run` calls are sequential — no `Promise.all`

---

## Completed Stages

| Stage | Folder | Status |
|-------|--------|--------|
| Stage 1 — Foundation | `Stage 1 - Foundation\` | ✅ Complete |
| Stage 2 — Data Sync | `Stage 2 - Data Sync\` | ✅ Complete |
| Stage 3 — Score Entry | `Stage 3 - Score Entry\` | ✅ Complete |
| Stage 4 — Broadsheet & Results | `Stage 4 - Broadsheet & Results\` | ✅ Complete |
| Stage 5 — Locks & PDF Export | `Stage 5 - Locks & PDF Export\` | ✅ Complete |
| Stage 6 — Exports & Overview | `Stage 6 - Exports & Overview\` | ✅ Complete |
| Stage 7 — Audit & Locking | `Stage 7 - Audit & Locking\` | ✅ Complete |

**Active files for any Stage 7 follow-up:**
- `Stage 7 - Audit & Locking\Code.gs`
- `Stage 7 - Audit & Locking\ScoreService.gs`
- `Stage 7 - Audit & Locking\AppScript.html`
- `Stage 7 - Audit & Locking\StyleBase.html`

---

## Stage 7 — What Was Built (Summary)

### Two-Tier Audit System
- **Activity Log** (in-app): high-level events — login, password changes, carry-forward, exports, lock/unlock. Visible to Super Admin (optionally Admin). Filterable by category, staff, date.
- **Change Log** (sheet-only, silent): per-field before/after snapshots for every score, PSQ rating, and remark save. For incident reconstruction — never shown in main UI.
- `LogService.gs` provides `logActivity()` and `logChange_()`. Both are fire-and-forget (wrapped in try/catch so they never break operations).
- Audit wrappers in `Code.gs` (IIFE pattern); PSQ + Remarks wrappers in `ScoreService.gs` (IIFE augmentation).

### Result Locking
- Admin/Super Admin can lock a class-term from Classes & Subjects → class detail screen.
- Locked classes show amber lock badge. `saveScores` checks `LockService.isLocked()` before writing.
- `LockService.gs` handles lock/unlock/status. Lock events written to Activity Log.

### DEPLOYMENT.md
- Complete pilot-ready setup guide in `Stage 7 - Audit & Locking\DEPLOYMENT.md`.

### Bugs fixed in Stage 7
1. Login success was being logged as "Login failed" — fixed in `Code.gs` serverLogin wrapper.
2. PSQ student strip overlapping trait rows — fixed by moving strip outside `view-body`; navigator changed to `position: fixed`. ⚠️ Awaiting user confirmation.
3. TestDataHelper duplicate subject assignments — fixed in `Stage 5 - Locks & PDF Export\TestDataHelper.gs`.

---

## Next Planned Work

**Stage 8 — Archive Session + Power BI API endpoints** — deferred until real data exists.

Other deferred items: Principal/Head Teacher Comments (pending discussion), Carry-forward verification (needs live term data).

---

## Critical Rules — Always Follow

### Stage Inheritance Rule (MOST IMPORTANT)
**Never rewrite existing stage files.** Each new stage file that updates a shared file must:
1. Read the prior stage version in FULL first
2. Use prior content verbatim as the starting point
3. Only append new additions at the bottom
4. Never modify anything from prior stages

### `toCamelCase` Key Rule
`updateRowWhere` and `appendRow` use `toCamelCase(header)` before matching keys. Always pass camelCase data keys. Never pass "Column Name With Spaces" as a key. Student name is always `s.fullName` (never `s.name`).

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
- Every view has an `initView` function for async data load

### UI Design Standard (every screen):
- Section cards: `section-card` (white, rounded, box-shadow)
- List items: `fm-action-btn` (icon + label + › chevron, full-width, separator lines)
- Collapsible panels: long lists default collapsed, tappable header + rotating chevron
- Consistent spacing: `margin: 0 var(--space-md) var(--space-md)`
- Empty states: always `.empty-msg`, never raw empty container
- Loading states: always `.loading-placeholder`

### Audit logging:
- `logActivity()` and `logChange_()` must NEVER throw — always fire-and-forget inside try/catch
- Use IIFE augmentation in the appropriate service file to wrap existing functions
- GAS last-declaration-wins: the IIFE wrapper must come AFTER the original function declaration

### Score component keys (immutable):
`C/W`, `ASS`, `ATT`, `Test1`, `Test2`, `Exam` | Maxes: 6, 2, 2, 10, 10, 70

### IDs:
- Student IDs: `HG####` | Staff IDs: `HGST###` | `generateId(PREFIX, existingIds)` from Utils.gs

### Always `escHtml()` around every user-provided string in HTML output.

---

## School Structure Reference

**Sections:** JSS (JSS 1–3) and SSS (SSS 1/2/3 × Art/Commerce/Science = 9 classes). 12 classes total.
**Terms:** First Term, Second Term, Third Term | **Sessions:** e.g. 2025/2026

**Position ranking:** JSS: within that single class. SSS: across all three departments at same level.
Ties: shared rank, next rank skipped.

**Grade system:**
75–100 A1 Excellent | 70–74 B2 Very Good | 65–69 B3 Good | 60–64 C4 | 55–59 C5 | 50–54 C6 | 45–49 D7 Weak | 40–44 E8 Very Weak | 0–39 F9 Fail

**SSS grouping:** Always use `getFMGroupKey()` / `stripDept()` when grouping SSS classes at the level.
