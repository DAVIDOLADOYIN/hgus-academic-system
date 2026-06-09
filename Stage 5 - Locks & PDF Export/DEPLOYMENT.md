# Stage 5 Deployment Guide — Locks & PDF Export

This guide explains exactly what to copy, where to paste it in the Google Apps Script editor, and how to verify the new features work correctly before handing the system to users.

---

## What Stage 5 Adds

**Generation Locks** — the Broadsheet and Result buttons inside the Class Menu are disabled and visually grayed out until all required data has been entered. The UI shows a specific count of outstanding items so teachers know exactly what to complete.

- **Broadsheet button** unlocks when every Active student in the class group has all 6 score components entered for every assigned subject.
- **Results button** unlocks when scores are complete **and** every Active student has all 16 PSQ traits rated **and** a Form Master remark of at least one character.
- The Subject Scores button is never locked — teachers can always view raw scores.

**PDF Export** — once results are unlocked:

- A **Download PDF** button appears on each individual student result slip.
- A **Generate All PDFs** button appears on the student list, producing one combined PDF for every Active student in the class group (one page per student, all in a single file).

---

## Files in This Folder

| File | What it is |
|---|---|
| `CompletionService.gs` | New file — checks whether all data is entered for a class group |
| `PDFService.gs` | New file — generates result slip PDFs (single or bulk) |
| `SheetService.gs` | Updated file — two new bulk-read functions added at the bottom |
| `Code.gs` | Updated file — three new server endpoints; two existing endpoints now enforce locks |
| `AppScript.html` | Updated file — Class Menu rewritten with lock UI; PDF buttons added |
| `StyleBase.html` | Updated file — new CSS for lock cards and PDF action bar |

---

## Step-by-Step: Updating the GAS Project

Open your Google Apps Script project at [script.google.com](https://script.google.com). The steps below go file by file.

### 1. Add `CompletionService.gs` (new file)

1. In the GAS editor left panel, click the **+** button next to "Files".
2. Choose **Script**.
3. Name it exactly `CompletionService` (GAS appends `.gs` automatically).
4. Delete the empty `function myFunction() {}` placeholder.
5. Open `CompletionService.gs` from this folder and paste the entire contents into the editor.
6. Save (Ctrl+S / Cmd+S).

### 2. Add `PDFService.gs` (new file)

1. Repeat the same steps — click **+** → Script.
2. Name it `PDFService`.
3. Paste the entire contents of `PDFService.gs` from this folder.
4. Save.

### 3. Replace `SheetService.gs` (updated file)

1. In the GAS editor, click on your existing `SheetService.gs` file.
2. Select all the text (Ctrl+A / Cmd+A) and delete it.
3. Paste the entire contents of `SheetService.gs` from this folder.
4. Save.

> **What changed:** Two new functions were added at the bottom of the module — `getAllClassPSQForGroup()` and `getAllClassRemarksForGroup()`. These do a single sheet read for an entire class group instead of one read per class, which is what CompletionService needs to work efficiently.

### 4. Replace `Code.gs` (updated file)

1. Click on your existing `Code.gs` in the GAS editor.
2. Select all, delete, and paste the contents of `Code.gs` from this folder.
3. Save.

> **What changed:**
> - `serverGetClassGroupCompletion(token, classGroupKey)` — new endpoint that calls CompletionService and returns the locked/unlocked state.
> - `serverGenerateResultSlipPDF(token, studentId, classId)` — new endpoint that calls PDFService and returns a base64-encoded PDF.
> - `serverGenerateBulkResultsPDF(token, classGroupKey)` — new endpoint that calls PDFService and returns a combined PDF for all active students.
> - `serverGetBroadsheetForClass()` — now returns an error with code `'LOCKED'` if `broadsheetUnlocked` is false for the class group.
> - `serverGetStudentResult()` — now returns an error with code `'LOCKED'` if `resultsUnlocked` is false for the class group.

### 5. Replace `AppScript.html` (updated file)

1. Click on your existing `AppScript.html` in the GAS editor.
2. Select all, delete, and paste the contents of `AppScript.html` from this folder.
3. Save.

> **What changed:**
> - `broadsheetClassMenu` view now renders a loading spinner first, then makes a server call to `serverGetClassGroupCompletion`. Cards are rendered as locked `<div>` elements (not clickable) or unlocked `<button>` elements based on the result. Each locked card shows a message like "3 students missing PSQ ratings."
> - `broadsheetStudentList` now injects a **Generate All PDFs** bar at the bottom of the student list when `resultsUnlocked` is true.
> - `studentResultSlip` now injects a **Download PDF** bar below the result slip when `resultsUnlocked` is true.
> - Three new client-side functions: `downloadPdf()`, `onDownloadPdf()`, `onBulkPdf()`.

### 6. Replace `StyleBase.html` (updated file)

1. Click on your existing `StyleBase.html` in the GAS editor.
2. Select all, delete, and paste the contents of `StyleBase.html` from this folder.
3. Save.

> **What changed:** New CSS classes added at the end of the stylesheet:
> - `.bcm-card--locked` and `.bcm-lock-msg` — grayed-out dashed lock card style.
> - `.pdf-action-bar`, `.pdf-action-bar__btn`, `.pdf-action-bar__spinner` — the blue PDF download bar that appears below result screens.

---

## No Additional GAS Settings Required

PDF generation uses `Utilities.newBlob(html, 'text/html').getAs('application/pdf')`, which is a built-in GAS method. **You do not need to enable the Drive API** or any advanced services. Everything works with the default GAS runtime.

---

## Testing the Lock Feature

### Test A: Verify the lock renders correctly

1. Log in as an Admin or Form Master who has a class group assigned.
2. Navigate to Broadsheet → select a class group that has missing scores.
3. **Expected result:** The Broadsheet button and Results button appear as grayed-out dashed cards with a lock message like "12 score cells incomplete" or "2 students missing PSQ ratings."
4. Try clicking a locked card — nothing should happen (the card is a `<div>`, not a `<button>`).
5. The Subject Scores button should still be clickable and work normally.

### Test B: Verify the Broadsheet unlocks

1. In the Score Entry screen, complete all scores for every Active student in a class group (all 6 components, all subjects).
2. Go back to the Class Menu for that group.
3. **Expected result:** The Broadsheet card is now a clickable button and opens the broadsheet normally.
4. The Results card should still be locked if PSQ or remarks are incomplete.

### Test C: Verify the Results button unlocks

1. After completing all scores for a group, also complete PSQ ratings for every student (all 16 traits, rated 1–5).
2. Also enter a Form Master remark (at least 1 character) for every student.
3. Return to the Class Menu.
4. **Expected result:** Both the Broadsheet and Results cards are now clickable buttons.

### Test D: Verify lock enforcement at the API level

Even if someone bypasses the UI lock (e.g. by directly calling from the browser console), the server enforces the lock:

1. Open the browser DevTools console on the GAS web app.
2. Run: `google.script.run.withSuccessHandler(console.log).serverGetBroadsheetForClass(App.token, 'YOUR_GROUP_KEY')`
3. If data is incomplete, **expected result:** `{ success: false, error: '...', code: 'LOCKED' }` — not actual broadsheet data.

---

## Testing the PDF Export

### Test E: Single student PDF

1. Make sure a class group is fully unlocked (all scores, PSQ, remarks complete).
2. Navigate to Broadsheet → Results → open any student's result slip.
3. A blue **↓ Download PDF** bar should appear below the result.
4. Click the button. It disables itself and shows a spinner while the server generates the PDF.
5. **Expected result:** A PDF file downloads with the filename pattern `StudentName_Term1_2024-2025.pdf`.
6. Open the PDF and verify the layout: letterhead, student info bar, academic performance table, PSQ table, Form Master remark, next term info.

### Test F: Bulk PDF

1. Navigate to Broadsheet → Results → the student list for a fully unlocked class group.
2. A blue **↓ Generate All PDFs** bar should appear below the student list.
3. Click the button. Bulk generation takes a few seconds per student — the button shows a spinner.
4. **Expected result:** A single PDF downloads with the filename pattern `SSS_1_All_Results_Term1_2024-2025.pdf`.
5. Open it and verify it contains one page per active student, with page breaks between them.

### Test G: PDF button does not appear when locked

1. Navigate to Results for a class group that has incomplete data (results locked).
2. Open the student list — the **Generate All PDFs** bar should not appear.
3. Open an individual student result slip — the **Download PDF** bar should not appear.

---

## Common Issues and Fixes

**"No active session/term configured" error when clicking the Class Menu**
The `serverGetClassGroupCompletion` call happens immediately when the Class Menu opens. If no session or term has been activated in the Admin Panel → Session Settings, the call returns this error. Fix: activate a session and term first.

**Locked card shows "0 items incomplete" but button is still locked**
This can happen if there are active students but zero subjects assigned to the class group. Check the Admin Panel → Subject Assignments and confirm subjects are assigned to the classes in this group for the current session.

**PDF downloads but is blank or shows garbled content**
GAS's PDF renderer does not support CSS variables. If you have customised `StyleBase.html` and accidentally added CSS variables inside the PDF HTML, they will not render. The `PDFService.gs` uses only inline `style="..."` attributes with plain color literals — do not add CSS variable references to `buildSlipHtml_()`.

**PDF generation times out for a large class group**
GAS has a 6-minute execution limit. For groups with more than ~60 students, the bulk PDF may hit this limit. If this happens, consider generating PDFs class-by-class rather than for the full group. A future stage could split the bulk PDF into one file per class.

**"Student not found" when downloading a single PDF**
This means the `studentId` stored in `App._resultData` does not match any row in the Students sheet for the given `classId`. This usually indicates a data entry error — check that the student's ID in the Students sheet exactly matches what was used during score entry.

---

## File Update Checklist

Use this list to confirm you have updated every file before testing:

- [ ] `CompletionService.gs` — added as a new file
- [ ] `PDFService.gs` — added as a new file
- [ ] `SheetService.gs` — replaced with Stage 5 version
- [ ] `Code.gs` — replaced with Stage 5 version
- [ ] `AppScript.html` — replaced with Stage 5 version
- [ ] `StyleBase.html` — replaced with Stage 5 version
- [ ] Deploy a new version of the web app (Publish → Deploy as web app → New version)

> **Important:** After replacing files, always deploy a new version. GAS caches the previous deployment — users visiting the old URL will still see the old code until you publish a new version and they hard-refresh the page (Ctrl+Shift+R / Cmd+Shift+R).
