# Stage 2 Deployment Guide — Data Sync & Admin Setup

## Overview

Stage 2 adds the admin data-setup layer: Session Settings, Class/Subject sync from an external Google Sheet, Student Cache management, and Assignment management (Form Masters + Teacher-Subject pairs).

---

## Files Changed vs Stage 1

Replace the following files in your Google Apps Script project with the Stage 2 versions. The remaining Stage 1 files are **unchanged** — do not replace them.

| File | Status | Notes |
|------|--------|-------|
| `Code.gs` | **Updated** | New server endpoints for all Stage 2 features; `serverSetSessionSettings` now returns updated settings object |
| `SheetService.gs` | **Updated** | Added `externalSheetId` support, `deleteRowWhere`, `getAllFormMasterAssignments` |
| `StyleBase.html` | **Updated** | New CSS: tab bars, sync actions, assignment cards, form-row, utility classes |
| `AppScript.html` | **Updated** | Session Settings, Classes & Subjects, and Manage Assignments views; admin tile wiring |
| `ClassService.gs` | **NEW** | Sync classes from external sheet |
| `SubjectService.gs` | **NEW** | Sync subjects from Subjects Reference tab; create Class-Subject Assignments |
| `StudentService.gs` | **NEW** | Refresh student cache from external sheet |
| `AssignmentService.gs` | **NEW** | Form Master and Teacher-Subject assignment management |

### Files NOT changed (keep Stage 1 versions):
`Config.gs`, `Utils.gs`, `AuthService.gs`, `UserService.gs`, `SetupService.gs`, `Index.html`

---

## Prerequisite: External Student Data Spreadsheet

Stage 2 reads student and class data from a **separate** Google Sheet (the "external sheet"). That sheet must have a tab named **`StudentData`** (or `Student Data`) with these columns:

| Column | Required | Notes |
|--------|----------|-------|
| `Student ID` | Yes | Unique identifier |
| `Full Name` | Yes | Student's full name |
| `Student Class` | Yes | e.g. `JSS1`, `SSS2 Science`, `JSS3B` |
| `Gender` | No | Optional — stored in cache |
| `Action Flag` | No | Optional — stored in cache |

Only rows where `Student Class` starts with `JSS` or `SSS` are imported.

---

## Deployment Steps

### 1. Upload all Stage 2 files to Apps Script

In the Apps Script editor:
- Replace `Code.gs`, `SheetService.gs`, `StyleBase.html`, `AppScript.html` with the new versions.
- Create four new `.gs` files: `ClassService`, `SubjectService`, `StudentService`, `AssignmentService`.
- Paste the contents of each corresponding Stage 2 `.gs` file.

### 2. Run Setup (if not already done)

In the Apps Script editor, open `SetupService.gs` and run `setupSheets()` manually, **or** open the deployed web app and it will be triggered automatically on first load if sheets are missing.

> **Note:** Running setup again is safe — it only creates sheets that don't already exist.

### 3. Ensure the Subjects Reference tab exists

The internal spreadsheet must have a tab named **`Subjects Reference`** with columns:

| Column | Notes |
|--------|-------|
| `Subject Name` | e.g. `Mathematics`, `English Language` |
| `Category` | One of: `General`, `Science`, `Business`, `Humanities` |

- `General` subjects → assigned to **all** classes (both JSS and SSS)
- `Science` subjects → assigned to SSS Science classes only
- `Business` subjects → assigned to SSS Commerce classes only  
- `Humanities` subjects → assigned to SSS Art classes only

---

## Testing Sequence

Work through the screens in this order. Each step depends on the previous.

### Step 1 — Session Settings

1. Log in as Admin or Super Admin.
2. From the Admin Home, tap **Session Settings**.
3. Fill in:
   - **Academic Session** (e.g. `2024/2025`)
   - **Active Term** (First / Second / Third)
   - **Session Start** and **Session End** dates
   - **Next Term Fee** and **Next Term Resumption** (optional)
4. Tap **Save Academic Period**. Verify the app bar subtitle updates.
5. Paste the **External Sheet ID** (the part of the Google Sheet URL between `/d/` and `/edit`) into the External Sheet ID field.
6. Tap **Save Sheet ID**.

### Step 2 — Sync Classes

1. Still on Session Settings, tap **Sync Classes**.
2. Expected: success message with a count of classes found (e.g. `"Synced 12 class(es)"`).
3. Navigate to **Classes & Subjects** from the Admin Home.
4. Verify the Classes tab shows JSS and SSS groups with the correct class names.

### Step 3 — Sync Subjects

1. Return to Session Settings.
2. Tap **Sync Subjects**.
3. Expected: success message (e.g. `"Synced 15 subject(s) and 48 class-subject assignment(s)"`).
4. Navigate to **Classes & Subjects** → **Subjects** tab.
5. Verify subjects are listed. Switch back to Classes; each class entry should now list its assigned subjects.

### Step 4 — Refresh Student List

1. Return to Session Settings.
2. Tap **Refresh Student List**.
3. Expected: success message with total student count (e.g. `"Student cache refreshed for all classes: 320 student(s)."`).
4. If you see a "Column not found" error, check the external sheet column headers match exactly: `Student ID`, `Full Name`, `Student Class`.

### Step 5 — Manage Assignments: Form Masters

1. From the Admin Home, tap **Manage Assignments**.
2. The **Form Masters** tab shows a card for every class.
3. For a class with no Form Master: select a teacher from the dropdown, optionally check "Grant full-class access", tap **Assign**.
4. Verify the card now shows the assigned teacher's name.
5. Tap **Remove** to test removal — card should revert to "No Form Master assigned".
6. Re-assign and verify the old assignment is replaced (not duplicated).

### Step 6 — Manage Assignments: Teacher Subjects

1. Switch to the **Teacher Subjects** tab.
2. Use the Add Assignment form: select Teacher, Class, Subject, and Term, then tap **Add Assignment**.
3. Verify the new assignment appears in the list below.
4. Tap the **×** remove button on the assignment. Verify it disappears from the list.
5. Try adding a duplicate (same teacher/class/subject/term) — should show "This teacher-subject assignment already exists."

---

## Common Errors

| Error Message | Likely Cause | Fix |
|---|---|---|
| `External Sheet ID is not configured` | Sheet ID not saved in Session Settings | Enter and save the External Sheet ID |
| `Could not open the external spreadsheet` | Wrong sheet ID, or Apps Script doesn't have access | Check the ID; share the external sheet with the Apps Script service account email |
| `Could not find a tab named "StudentData"` | Tab missing or misspelled | Rename the tab to exactly `StudentData` |
| `Missing required columns` | Header row doesn't match expected names | Fix headers: `Student ID`, `Full Name`, `Student Class` |
| `Could not find a tab named "Subjects Reference"` | Internal tab missing | Create a `Subjects Reference` tab in the main spreadsheet |
| `No active session set` | Session Settings not saved yet | Complete Step 1 above |
| `Unauthorised` | Logged-in user doesn't have Admin role | Promote the user in Manage Users |

---

## What's Next — Stage 3 (Score Entry)

Stage 3 will build the teacher-facing score entry workflow:

- **Teacher Home** — assignment card list (uses `getMyAssignments` from Stage 2)
- **Component Selector** — choose which score component to enter (CA1, CA2, Exam, etc.)
- **Score Entry** — student list with score inputs and save/submit
- **Form Master Class Overview** — class summary for Form Masters
- **PSQ Entry** — psychomotor and affective domain scores
- **Remarks Entry** — teacher and form master remarks
- **Manage Class List** — add/remove students for a class
