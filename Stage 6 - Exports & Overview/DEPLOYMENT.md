# Stage 6 — Exports & Overview: Deployment Guide

This guide explains exactly what to do to deploy Stage 6 into your Google Apps Script project.  
Follow the steps in order. Do not skip or reorder them.

---

## What Stage 6 Adds

| Feature | Description |
|---|---|
| **Results Overview screen** | Admin dashboard showing Scores / PSQ / Remarks completion % per class group, with status badges |
| **Broadsheet PDF export** | Landscape PDF of the full class broadsheet, with footer showing date/time and user ID |
| **Broadsheet Excel export** | Excel (.xlsx) version of the broadsheet for offline use |
| **Score Sheet PDF export** | Per-subject score sheet PDF with a signature cell at the bottom |
| **Export action bar** | Sticky bar injected into the broadsheet and subject-score screens with one-tap download buttons |
| **Carry-Forward assignments** | Card on the Assignments screen that detects missing assignments and copies them from the previous term/session |

---

## Files in This Stage

| File | Type | What to do |
|---|---|---|
| `CarryForwardService.gs` | **New file** | Create it in the GAS project |
| `ExportService.gs` | **New file** | Create it in the GAS project |
| `OverviewService.gs` | **New file** | Create it in the GAS project |
| `SheetService.gs` | **Replace** | Replace the existing `SheetService.gs` entirely |
| `Code.gs` | **Replace** | Replace the existing `Code.gs` entirely |
| `StyleBase.html` | **Replace** | Replace the existing `StyleBase.html` entirely |
| `AppScript_Stage6_Additions.html` | **Merge (manual step)** | Do NOT create this as its own file — see merge instructions below |

---

## Step-by-Step Deployment

### Step 1 — Open your Google Apps Script project

Go to [script.google.com](https://script.google.com), open the HGUS project.

---

### Step 2 — Create the three new `.gs` service files

For each file below, click **+ Add a file → Script** in the left sidebar, name it exactly as shown, then paste in the full contents of the corresponding file from this folder.

**Files to create:**

1. `CarryForwardService` — paste contents of `CarryForwardService.gs`
2. `ExportService` — paste contents of `ExportService.gs`
3. `OverviewService` — paste contents of `OverviewService.gs`

> **Important:** GAS automatically appends `.gs` to the name — just type the name without the extension when creating the file.

---

### Step 3 — Replace `SheetService.gs`

1. In the left sidebar, click on `SheetService`.
2. Select all (Ctrl+A / Cmd+A) and delete the existing contents.
3. Paste in the full contents of `SheetService.gs` from this Stage 6 folder.
4. Save (Ctrl+S / Cmd+S).

> **Why:** Stage 6 adds `getAllTeacherSubjectAssignmentsUnfiltered()` to `SheetService`. The file in this folder is a verbatim copy of Stage 5's version with only that one function appended at the bottom — nothing else is changed.

---

### Step 4 — Replace `Code.gs`

1. In the left sidebar, click on `Code`.
2. Select all and delete the existing contents.
3. Paste in the full contents of `Code.gs` from this Stage 6 folder.
4. Save.

> **Why:** Stage 6 appends six new server endpoint functions to `Code.gs`:  
> `serverGetResultsOverview`, `serverGetBroadsheetPDF`, `serverGetBroadsheetExcel`,  
> `serverGetScoreSheetPDF`, `serverGetCarryForwardPreview`, `serverExecuteCarryForward`.  
> The rest of the file is identical to Stage 5.

---

### Step 5 — Replace `StyleBase.html`

1. In the left sidebar, click on `StyleBase`.
2. Select all and delete the existing contents.
3. Paste in the full contents of `StyleBase.html` from this Stage 6 folder.
4. Save.

> **Why:** Stage 6 appends a new CSS block at the bottom for all new UI components (overview bars, status badges, export action bar, carry-forward card). Everything above the Stage 6 block is identical to Stage 5.

---

### Step 6 — Merge Stage 6 JavaScript into `AppScript.html` (manual step)

This is the most important step. The `AppScript_Stage6_Additions.html` file in this folder contains **only the Stage 6 JavaScript additions** — it is NOT a replacement for the full `AppScript.html`. You must paste its contents into the existing file.

**Instructions:**

1. Open `AppScript_Stage6_Additions.html` from this folder in a text editor.
2. Copy everything between (and not including) the opening `<script>` tag and the closing `</script>` tag.  
   *(The HTML comment block at the top explaining the merge can be ignored — only copy the JavaScript inside the `<script>` tags.)*
3. In GAS, click on `AppScript` in the left sidebar.
4. Scroll to the very bottom of the file.
5. Find the closing `</script>` tag — it will be the last `</script>` before the closing `</body>` or end of file.
6. Place your cursor **immediately before** that `</script>` tag (on a new line above it).
7. Paste the copied JavaScript.
8. Save.

**What you are pasting in contains:**
- An IIFE that overrides `Views.adminHome` to add the Results Overview tile to the Admin Dashboard
- An IIFE that overrides `renderView` to handle the new `resultsOverview` route
- An IIFE that overrides `initView` to wire up export bars, carry-forward, and overview initialization
- `Views.resultsOverview` — the HTML renderer for the Overview screen
- `initResultsOverview`, `renderResultsOverview` — data loading and rendering logic
- `initBroadsheetExportBar`, `injectBroadsheetExportBar` — export bar for broadsheet screens
- `initScoreSheetExportBar`, `injectScoreSheetExportBar` — export bar for subject score screens
- `initCarryForwardSection` — carry-forward card logic on the Assignments screen
- `downloadFile(base64, filename, mime)` — helper for non-PDF (Excel) downloads

> **Why this approach instead of replacing AppScript.html?**  
> `AppScript.html` is very large (~4,000 lines). Replacing it risks accidentally losing UI changes made in earlier stages that were not captured in the saved file. By pasting additions only, you preserve everything that is already working.

---

### Step 7 — Save and Deploy

1. Click **Deploy → Manage deployments** (or create a new deployment).
2. For an existing deployment: click the pencil (edit) icon, change the version to **"New version"**, and click **Deploy**.
3. For a new deployment: choose **Web app**, set access to the appropriate audience, and deploy.
4. Copy the new deployment URL and test.

---

## Quick Verification Checklist

After deploying, log in and confirm the following:

- [ ] Admin home screen shows a new **"Results Overview"** tile
- [ ] Clicking the tile loads the Overview screen with progress bars per class group
- [ ] Opening a broadsheet view shows an **export action bar** below the app bar (PDF and Excel buttons)
- [ ] Opening a subject score sheet shows an **export bar** with a PDF button
- [ ] Clicking a broadsheet PDF button downloads a landscape PDF with a footer
- [ ] Clicking the Excel button downloads an `.xlsx` file
- [ ] Going to the Assignments screen shows the **Carry Forward card** if the current term has no assignments
- [ ] Confirming carry-forward copies assignments and the card disappears

---

## Files You DO NOT Touch

The following files from earlier stages are **not modified** in Stage 6 and should not be changed:

- `AuthService.gs`
- `UserService.gs`
- `StudentService.gs`
- `ScoreService.gs`
- `BroadsheetService.gs`
- `ResultService.gs`
- `CompletionService.gs`
- `AssignmentService.gs`
- `Config.gs`
- `Utils.gs`
- `Index.html`

---

## Troubleshooting

**"Overview screen loads but shows no data"**  
→ Check that `OverviewService.gs` was created and saved correctly. Open the GAS editor and look for it in the sidebar.

**"Export buttons appear but download fails"**  
→ Check that `ExportService.gs` was created. Also verify the Google Drive logo file ID in `ExportService.gs` matches the one in your Drive.

**"Carry-forward card never appears"**  
→ Check that `CarryForwardService.gs` was created. Also verify the active session/term in `Config.gs` matches what is stored in the sheet.

**"Admin home tile for Overview is missing"**  
→ The AppScript.html merge step (Step 6) may not have been completed, or the paste was placed outside the `<script>` block. Re-read Step 6 carefully.

**"Excel download does nothing"**  
→ Some older mobile browsers do not support `Blob` + object URLs. Test on a desktop browser first. The `downloadFile()` helper in the additions file handles this for modern browsers.
