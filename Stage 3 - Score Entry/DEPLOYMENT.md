# Stage 3 – Score Entry: Deployment & Testing Guide

## What Stage 3 adds

| Feature | Description |
|---|---|
| Teacher Home | Two-section page: FM classes and teaching assignments |
| FM Class Overview | Student list with status badges + FM action buttons |
| Component Selector | 6 progress tiles per subject (C/W, ASS, ATT, Test1, Test2, Exam) |
| Score Entry | Full class roster with inline number inputs; excluded students greyed |
| PSQ Entry | One student at a time, 16 traits rated 1–5, Save & Next pattern |
| Remarks Entry | All students visible at once with textareas; single Save All |
| Manage Class List | Status chips per student (Active / Exam Exempt / Not Continuing) |

---

## Files changed in Stage 3

| File | What changed |
|---|---|
| `AppScript.html` | App state extended; 7 new views added; routing maps updated; `clearSession()` extended |
| `StyleBase.html` | CSS for all Stage 3 components (already written — no changes needed) |
| `Code.gs` | 11 new server endpoints for score/PSQ/remarks/status |
| `ScoreService.gs` | New file — score read/write logic |
| `PSQService.gs` | New file — PSQ read/write logic |
| `RemarkService.gs` | New file — remark read/write logic |
| `StatusService.gs` | New file — student status read/write logic |

---

## Deployment steps

### 1. Copy all Stage 3 files into your Apps Script project

Open your Apps Script project (the one from Stage 2) and make sure the following files exist:

- `Code.gs` — replace with Stage 3 version
- `AppScript.html` — replace with Stage 3 version
- `StyleBase.html` — replace with Stage 3 version (CSS already includes Stage 3 classes)
- `ScoreService.gs` — add as new file
- `PSQService.gs` — add as new file
- `RemarkService.gs` — add as new file
- `StatusService.gs` — add as new file

> **Important:** All other `.gs` files from Stage 2 (AuthService, UserService, ClassService, etc.) remain unchanged.

### 2. Run setup

In the Apps Script editor, run the `serverRunSetup()` function once to ensure any new sheet tabs or column headers are created.

### 3. Deploy as web app

In the Apps Script editor:
1. Click **Deploy → Manage deployments**
2. Click the edit (pencil) icon on your existing deployment
3. Change **Version** to **New version**
4. Click **Deploy**

Copy the new web app URL and open it to test.

---

## Testing checklist

Work through these scenarios in order. Each section lists what to check and what a correct result looks like.

---

### A. Teacher login flow

**Setup:** Create a teacher account via Admin → Users. Assign them to at least one class as Form Master and at least one class+subject as Teacher-Subject.

1. Log in as the teacher.
2. **Expected:** Lands directly on **My Teaching** (Teacher Home).
3. **Expected:** Two sections visible — "Form Master Classes" (blue accent cards) and "Teaching Assignments" (green accent cards).
4. Log out.

---

### B. Admin "My Teaching" tile (admin who also teaches)

**Setup:** Assign the admin account as Form Master of a class and/or as teacher of a subject.

1. Log in as admin.
2. **Expected:** Admin home shows the 7th tile **My Teaching** (initially hidden; appears after ~1 second while the server confirms assignments).
3. Tap **My Teaching**.
4. **Expected:** Navigates to Teacher Home showing the admin's FM/TS assignments.
5. Tap the back button.
6. **Expected:** Returns to Admin Home (not login).

> If the admin has NO teaching assignments the tile remains hidden — this is correct.

---

### C. FM Class Overview

1. From Teacher Home, tap an FM class card.
2. **Expected:** Shows three action buttons (PSQ Ratings, Remarks, Manage Class List) and a student list with status badges.
3. If the admin has granted the FM full score access, a **Subject grid** also appears below.
4. All students should show badge **Active** by default.
5. Tap the back button.
6. **Expected:** Returns to Teacher Home.

---

### D. Component Selector

1. From Teacher Home (or FM Class Overview subject grid), tap a subject card.
2. **Expected:** Shows 6 component tiles: C/W, ASS, ATT, Test1, Test2, Exam.
3. Each tile shows `0 / N` and an empty progress bar.
4. **Exam tile must be locked** (🔒) until all active students have Test1 and Test2 scores.
5. Tap any unlocked tile (e.g. C/W).
6. **Expected:** Navigates to Score Entry for that component.

---

### E. Score Entry

1. **Expected:** All active students listed with a number input field.
2. Students with status Exam Exempt or Not Continuing appear greyed with their status label — no input field.
3. Enter a valid score for every active student.
4. Tap **Save All Scores**.
5. **Expected:** Toast "Scores saved successfully." appears and you return to the component selector.
6. Re-open the same component tile.
7. **Expected:** The scores you entered are pre-filled and the progress bar shows completion.

**Error cases to verify:**
- Enter a negative number → red border on that input, toast "Please fix invalid score entries."
- Leave inputs empty → saves as null (cleared), no error.

---

### F. Exam Lock / Unlock

1. Enter Test1 scores for all active students in a subject.
2. Enter Test2 scores for all active students.
3. Return to Component Selector for that subject.
4. **Expected:** Exam tile is now unlocked and clickable.

---

### G. PSQ Entry

1. From FM Class Overview, tap **📋 PSQ Ratings**.
2. **Expected:** Shows the first student with 16 trait rows, each with 5 rating buttons.
3. Rate all traits by tapping a number button (1–5).
4. Tapping a selected button deselects it (returns to unrated).
5. Tap **Save & Next →**.
6. **Expected:** Moves to next student; previous student's ratings are saved.
7. On the last student, tap **Save & Finish**.
8. **Expected:** Toast "PSQ ratings saved for all students." and returns to FM Class Overview.
9. Re-open PSQ Entry.
10. **Expected:** Previously saved ratings are pre-selected.

**Previous button:**
- After advancing to student 2+, tap **← Previous**.
- **Expected:** Returns to the previous student with their saved ratings pre-selected.

---

### H. Remarks Entry

1. From FM Class Overview, tap **📝 Remarks**.
2. **Expected:** All students listed with a textarea each.
3. Type remarks for several students.
4. Tap **Save All Remarks**.
5. **Expected:** Toast "Remarks saved successfully."
6. Navigate away and return.
7. **Expected:** Remarks are pre-filled from the saved values.

---

### I. Manage Class List

1. From FM Class Overview, tap **👥 Manage Class List**.
2. **Expected:** All students listed; each has three status chips (Active, Exam Exempt, Not Continuing). Active chip is highlighted for all students.
3. Tap **Exam Exempt** for one student.
4. **Expected:** Toast "Status updated to 'Exam Exempt'." and the chip refreshes immediately.
5. Return to FM Class Overview.
6. **Expected:** That student's badge now shows "Exam Exempt".
7. Go to Component Selector → Score Entry for any subject.
8. **Expected:** The Exam Exempt student is greyed out with no input field.

---

### J. Back navigation

Verify the history stack works correctly across a deep drill-down:

1. Teacher Home → FM Class → Component Selector → Score Entry
2. Tap back → should return to Component Selector (not Teacher Home)
3. Tap back → Component Selector → FM Class Overview
4. Tap back → FM Class Overview → Teacher Home
5. Tap back → Teacher Home back button → Admin Home (if admin) or Login

---

### K. Session expiry handling

1. Open the app and log in.
2. In the Apps Script editor, manually invalidate the session token (delete the row in the Sessions sheet).
3. Perform any action that calls the server (e.g. save scores).
4. **Expected:** App shows the login screen automatically (session expired handling).

---

## Common issues and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| My Teaching tile never appears for admin | Admin has no FM or TS assignments | Assign the admin as FM/TS via the Assignments screen |
| Score Entry shows no students | Student cache is empty for the class | Go to Data Sync → Student Cache and run a refresh for that class |
| Exam tile stays locked even after entering Test1+Test2 | A student is missing a score | Check all *active* students (not Exam Exempt / Not Continuing) have both scores |
| PSQ ratings not loading on re-open | PSQ sheet column headers mismatch | Re-run `serverRunSetup()` to recreate headers |
| Status chips not updating | `StatusService.gs` not present | Verify the file exists in Apps Script project |

---

## Where each piece of data is stored (Google Sheet tabs)

| Data | Sheet tab |
|---|---|
| Scores | `Scores` — columns: Session, Term, ClassId, SubjectId, StudentId, Component, Score |
| PSQ ratings | `PSQ` — columns: Session, Term, ClassId, StudentId, [trait columns…] |
| Remarks | `Remarks` — columns: Session, Term, ClassId, StudentId, Remark |
| Student statuses | `StudentStatus` — columns: Session, Term, ClassId, StudentId, TermStatus |
