# Stage 4 – Broadsheet & Results: Deployment & Testing Guide

## What Stage 4 adds

| Feature | Description |
|---|---|
| Broadsheet Home | Admin entry screen — lists all class groups (JSS 1 → SSS 3) |
| Class Menu | 3-option menu per class group: Broadsheet · Subject Scores · Results |
| Broadsheet (class view) | Per-class all-subjects totals table — students as rows, subjects as columns; far-right columns: Total, Avg, Grade, Position |
| Subject Scores | Subject list for the class group — tap any subject to see component scores |
| Subject Detail | Per-subject component score table (CW, AS, AT, T1, T2, EX, Tot, Grd, Pos) |
| Results | Student list — tap any student to open their result slip |
| Student Result Slip | Complete per-student view: all subjects, scores, totals, grades, positions, PSQ ratings, Form Master remark, next-term info |
| Form Master broadsheet access | FMs see a "Results & Broadsheet" tile on their home screen for their assigned class only. All three broadsheet screens and result slips are accessible to them, but scoped to their class group. The server enforces this — a FM cannot retrieve broadsheet data for any other class. |
| Delete user account | Super Admins can permanently delete a staff account from the Edit User screen (Danger Zone card). Cannot delete self or another Super Admin. |

---

## Files to copy into Apps Script

These files **replace** the Stage 3 versions already in your Apps Script editor.  
Copy them in the order listed below.

| File in this folder | Action | What changed |
|---|---|---|
| `AppScript.html` | **Replace** Stage 3 `AppScript.html` | Navigation redesigned: broadsheetClassMenu, broadsheetView, broadsheetSubjectScores, broadsheetSubjectDetail, broadsheetStudentList; FM "Results & Broadsheet" tile on teacher home; `confirmDeleteUser` + `submitDeleteUser` for Super Admin delete; `subjectAbbr()` helper |
| `StyleBase.html` | **Replace** Stage 3 `StyleBase.html` | All Stage 3 CSS preserved; Stage 4 adds: `.bs-table*`, `.bs-summary-*`, `.grade-badge` variants, `.fm-action-btn__abbr`, `.bcm-card*`, `.home-card--results`, `.eu-danger-zone` |
| `SheetService.gs` | **Replace** Stage 3 `SheetService.gs` | Adds `getScoresForClassGroup()` (bulk score read) and `deleteUserRecord()` (hard-delete user row) |
| `Code.gs` | **Replace** Stage 3 `Code.gs` | 6 new endpoints: `serverGetClassGroups`, `serverGetBroadsheetSubjects`, `serverGetBroadsheetForSubject`, `serverGetBroadsheetForClass`, `serverGetStudentResult`, `serverDeleteUser` |
| `BroadsheetService.gs` | **Add new file** | Broadsheet computation; FM access enforced via `getFMGroupKeys_()` and `validateBroadsheetAccess_()` helpers |
| `ResultService.gs` | **Add new file** | Student result slip assembly; FM access enforced (classId checked against FM assignments) |

> **All other Stage 3 files** (`ScoreService.gs`, `PSQService.gs`, `RemarkService.gs`, `StatusService.gs`, `AuthService.gs`, `AssignmentService.gs`, `ClassService.gs`, `SubjectService.gs`, `StudentService.gs`, `SetupService.gs`, `Config.gs`, `Utils.gs`, `Index.html`) remain unchanged.

---

## How to copy files into Apps Script

1. Open your Apps Script project at [script.google.com](https://script.google.com)
2. For each **Replace** file: click the file in the left sidebar → select all (`Ctrl+A`) → paste the new content
3. For each **Add new file**: click the `+` button → choose **Script** → name it exactly as shown (e.g. `BroadsheetService`) → paste the content
4. Click **Save** (floppy disk icon or `Ctrl+S`)
5. Deploy → **Manage deployments** → click the pencil icon → bump the version → **Deploy**

---

## Pre-flight checklist

Before testing, verify these are all true in Session Settings:

- [ ] Active session is set (e.g. `2024/2025`)
- [ ] Active term is set (e.g. `First Term`)
- [ ] Classes have been synced from the external StudentData sheet
- [ ] Subjects have been synced from the Subjects Reference tab
- [ ] Class-Subject assignments exist for at least one class group
- [ ] Students have been synced into the student cache
- [ ] At least some scores have been entered (Stage 3) for a subject

---

## Testing walkthrough

### Test 1 — Broadsheet Home loads

1. Log in as **Admin** or **Super Admin**
2. On the Admin Home, tap the **Results Overview** tile
3. **Expected:** "Broadsheet & Results" screen shows a list of class groups (e.g. JSS 1, JSS 2, SSS 1 …)
4. **If empty:** No classes have been synced — go to Session Settings → Sync Classes first

### Test 2 — Class Menu

1. From Broadsheet Home, tap any class group (e.g. **JSS 1**)
2. **Expected:** Screen titled "JSS 1 — Select an option" with three buttons:
   - **Broadsheet** — "Full class totals — all subjects at a glance"
   - **Subject Scores** — "Component breakdown per subject"
   - **Results** — "Individual result slips for each student"
3. Tap the back button — returns to Broadsheet Home

### Test 3 — Class Broadsheet (per-class all-subjects totals)

1. From the Class Menu, tap **Broadsheet**
2. **Expected:** Wide table with one row per student and one column per subject (totals only)
3. Column order: Name | [Cls if SSS] | Subject 1 | Subject 2 | … | Total | Avg | Grd | Pos
4. Subject column headers are abbreviated to 6 characters; hover to see full name
5. Grades show as coloured badges (green A1, amber C4, red F9 etc.)
6. Exam Exempt students: amber row tint; Not Continuing: greyed/faded; total/avg/grade/pos all show `—`
7. **SSS group:** Additional "Cls" column shows dept abbreviation (Sci / Art / Com); positions rank across all 3 departments
8. Scroll horizontally — name column stays sticky on the left
9. Tap any row — opens that student's result slip
10. Back button returns to Class Menu

### Test 4 — Subject Scores list

1. From the Class Menu, tap **Subject Scores**
2. **Expected:** List of subjects assigned to the class group; subtitle shows `First Term · 2024/2025`
3. Tap any subject — opens the component score table for that subject (Test 5)
4. Back returns to Class Menu

### Test 5 — Subject Detail (component score table)

1. Tap a subject from the Subject Scores list
2. **Expected:** Score table with columns: Name | [Cls] | CW | AS | AT | T1 | T2 | EX | Tot | Grd | Pos
3. Summary strip at top shows Class Max, Average, Active count
4. Tap any row — opens that student's result slip
5. Back returns to Subject Scores list

### Test 6 — Results (student list)

1. From the Class Menu, tap **Results**
2. **Expected:** List of all students in the class group; subtitle shows `First Term · 2024/2025`
3. **SSS group:** Students from all 3 departments appear together; dept shown after name (e.g. "Ade · Science")
4. Exam Exempt / Not Continuing students show status chip on their row
5. Tap any student — opens their result slip (Test 7)
6. Back returns to Class Menu

### Test 7 — Student Result Slip

1. Tap any active student (from either the class broadsheet row or the Results list)
2. **Expected:** Result slip screen shows student name in title; class name in subtitle
3. Sections visible:
   - **Student Information** — ID, name, class, session, term dates
   - **Academic Performance** — table of all subjects with component scores, total, grade, position, class max
   - **Summary** — total score, average, overall grade, class position
   - **PSQ ratings** (if entered) — shows trait names and ratings
   - **Form Master's Remark** (if entered)
   - **Next Term Information** (if configured in Session Settings)
4. For an Exam Exempt student — total, grade, and position all show `—`
5. Back returns to the previous screen (broadsheet row or student list)

### Test 8 — SSS cross-department ranking

1. Open the class broadsheet for an SSS group (e.g. SSS 1)
2. Active students from Art + Commerce + Science should all appear ranked together
3. Positions go 1, 2, 2, 4 … (ties share a rank, next rank is skipped)
4. Verify the same position numbering appears in each student's result slip

### Test 9 — Session expiry

1. Log out or wait for the token to expire
2. Attempt to navigate to any broadsheet view
3. **Expected:** Redirected to login screen — "Session expired" message

### Test 10 — Form Master broadsheet access

1. Log in as a **Form Master** who is assigned to a class (e.g. JSS 2)
2. On the teacher home, a **"Results & Broadsheet"** section should appear below the Form Master Classes section
3. Tap the tile — **Expected:** Class Menu for JSS 2 (Broadsheet · Subject Scores · Results)
4. All three options should work exactly as they do for Admin, but scoped to JSS 2 only
5. **Verify restriction:** If a FM tries to access a different class group by typing its URL params directly, the server should return an "Unauthorised" error — the UI will show an empty/error state

### Test 11 — Super Admin delete user

1. Log in as **Super Admin**
2. Navigate to User List → tap any non-Super-Admin, non-self user
3. Scroll to the bottom of their profile — a red-tinted **Danger Zone** card should appear
4. Tap **Delete Account** — a confirmation dialog should appear naming the user and warning the action is permanent
5. Click OK — **Expected:** Toast "Account for '[Name]' has been permanently deleted", returns to User List, user is gone
6. Verify the following are NOT shown / NOT allowed:
   - Danger Zone is not shown when viewing your own profile
   - Danger Zone is not shown when viewing another Super Admin's profile
   - Danger Zone is not shown when logged in as Admin (not Super Admin)

---

## Known boundaries (not bugs)

| Behaviour | Reason |
|---|---|
| No PDF export button | Stage 4 is the data/display layer only. PDF export is a future stage. |
| Subject teachers cannot access broadsheets | Only Admin, Super Admin, and Form Masters have access. A subject teacher with no FM assignment sees no Results tile on their home screen. |
| FM sees only their own class group | This is enforced server-side. A FM assigned to JSS 2 cannot see JSS 3 broadsheet data even if they navigate there directly. |
| FM broadsheet tile shows only after an FM assignment exists | The tile appears in `renderTeacherHomeSections` only when `fmClasses.length > 0`. If no FM assignment is set, the tile does not appear. |
| Class broadsheet shows subject totals only (no component breakdown) | Use Subject Scores → tap a subject for the full CW/AS/AT/T1/T2/EX breakdown. |
| Position shown as `—` for students with zero scores | A student must have at least one component score entered to participate in ranking. |
| "Class Max" on result slip is per-subject | It reflects the highest total in that subject across all active students in the class group, not the student's own total. |
| Average in class broadsheet is over subjects with scores | A student who sat 8 of 9 subjects is averaged over 8, not 9. |
| Delete does NOT auto-remove the user's FM/TS assignments | Orphaned assignment rows remain in the sheet (no data loss, but the selector dropdown will show a missing name). Reassign before deleting. |
| Super Admin accounts cannot be deleted | The server blocks this. Demote the role to Admin first, then delete. |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "No class groups found" on Broadsheet Home | Classes not synced | Session Settings → Sync Classes |
| "No subjects assigned" on Subject Scores or Class Broadsheet | Class-Subject assignments missing | Manage Assignments → assign subjects to the class group |
| Class broadsheet shows all `—` totals for a subject column | No scores entered for that subject | Enter scores via Score Entry (Stage 3) |
| Student result slip shows no subjects | No class-subject assignments for that specific class | Check assignments for the student's exact classId |
| All student totals show `—` | Student is Exam Exempt or Not Continuing | Check student status in Manage Class List (Stage 3) |
| Broadsheet shows wrong position for SSS | Position is computed across all 3 departments combined | This is correct behaviour — SSS positions are cross-department |
| Grade badges not showing colours | `StyleBase.html` not updated to Stage 4 version | Replace StyleBase.html and redeploy |
| `serverGetBroadsheetForClass is not a function` error | `Code.gs` or `BroadsheetService.gs` not updated | Replace both files and redeploy |
| FM sees no Results tile on teacher home | No active FM assignment for this term | Go to Manage Assignments → assign a Form Master for the class |
| FM gets "Unauthorised" when opening broadsheet | Their FM assignment classId does not match the requested group key | Check the assignment session is correct and the class name matches expected format |
| "Delete Account" button not visible on a user's profile | Logged in as Admin (not Super Admin), or viewing self, or viewing another Super Admin | This is correct — delete is Super Admin only and has the protections listed |
| Deleting a user leaves their name blank in FM assignment dropdown | Assignment row was not removed before deletion | Go to Manage Assignments and reassign or remove the orphaned assignment |
