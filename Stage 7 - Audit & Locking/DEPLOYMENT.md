# HGUS Academic Result Management System — Deployment Guide

**Stage 7 — Pilot-Ready Setup**

This guide walks a first-time deployer through setting up the system from scratch.
Follow every step in order. Do not skip the first-run checklist at the end.

---

## 1. Prerequisites

| Requirement | Notes |
|---|---|
| Google account | Must be the account that will own the Apps Script project |
| Google Sheets | One spreadsheet will hold all data tabs |
| Apps Script access | Enabled by default for all Google accounts |

---

## 2. Create the Google Spreadsheet (Data Store)

1. Go to [sheets.google.com](https://sheets.google.com) and create a **new blank spreadsheet**.
2. Name it something clear, e.g. `HGUS Academic System — Data`.
3. Copy the **Spreadsheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/  <<<SPREADSHEET_ID>>>  /edit
   ```
   You will need this ID later.

---

## 3. Create the Apps Script Project

1. In the spreadsheet, click **Extensions → Apps Script**.
2. This opens the Apps Script editor, already linked to your spreadsheet.
3. Delete the default `Code.gs` file that appears (you will replace it).

---

## 4. Upload All Script Files (.gs)

In the Apps Script editor, create one file for each `.gs` file below.
Use **File → New → Script** to add each file.
Name it exactly as shown (no `.gs` extension needed — Apps Script adds it automatically).

**Files to create, in this order (order does not matter functionally, but keeps things tidy):**

| File name in editor | Source file |
|---|---|
| `Config` | `Stage 7 - Audit & Locking / Config.gs` |
| `SetupService` | `Stage 7 - Audit & Locking / SetupService.gs` |
| `SheetService` | `Stage 7 - Audit & Locking / SheetService.gs` |
| `AuthService` | `Stage 2 - Auth & Sessions / AuthService.gs` |
| `ScoreService` | `Stage 7 - Audit & Locking / ScoreService.gs` |
| `LogService` | `Stage 7 - Audit & Locking / LogService.gs` |
| `LockService` | `Stage 7 - Audit & Locking / LockService.gs` |
| `ClassService` | `Stage 4 - Classes & Subjects / ClassService.gs` |
| `ExportService` | `Stage 6 - Exports & Overview / ExportService.gs` |
| `Code` | `Stage 7 - Audit & Locking / Code.gs` |

> **Note:** Each Stage 7 `.gs` file already contains all prior-stage code verbatim at the top,
> followed by Stage 7 additions at the bottom. You only need the Stage 7 versions.
> Do **not** also upload earlier-stage versions of the same file — that would cause duplicates.

Paste the full contents of each source file into the matching editor file, then press **Ctrl+S** (or **⌘S**) to save.

---

## 5. Upload All HTML Files

In the Apps Script editor, use **File → New → HTML** to create these files.

| File name in editor | Source file | Notes |
|---|---|---|
| `StyleBase` | `Stage 6 - Exports & Overview / StyleBase.html` + append `Stage 7 - Audit & Locking / StyleBase_Stage7_Additions.html` | See instructions below |
| `AppScript` | `Stage 6 - Exports & Overview / AppScript.html` + append `Stage 7 - Audit & Locking / AppScript_Stage7_Additions.html` | See instructions below |
| `Index` | `Stage 1 - Foundation / Index.html` | No changes needed |

### How to combine the HTML addition files

**StyleBase:**
1. Open `Stage 6 - Exports & Overview / StyleBase.html` in a text editor.
2. Find the closing `</style>` tag near the very end.
3. Paste the entire contents of `Stage 7 - Audit & Locking / StyleBase_Stage7_Additions.html`
   **immediately before** that closing `</style>` tag.
4. Copy the full result into the Apps Script `StyleBase` file.

**AppScript:**
1. Open `Stage 6 - Exports & Overview / AppScript.html` in a text editor.
2. Scroll to the very end of the file.
3. Paste the entire contents of `Stage 7 - Audit & Locking / AppScript_Stage7_Additions.html`
   at the end, after the last line.
4. Copy the full result into the Apps Script `AppScript` file.

---

## 6. Bootstrap the Super Admin Account

The system cannot run until at least one Super Admin exists in the Users sheet.
This must be done **before** running Setup Sheets for the first time, or immediately after.

### Step A — Run Setup Sheets (creates all tabs)

1. In the Apps Script editor, open `Code.gs`.
2. From the function dropdown (top toolbar), select **`setupSheets`**.
3. Click **Run**.
4. Grant permissions when prompted (click "Review permissions" → choose your account → "Allow").
5. Wait for execution to complete. You should see `Execution completed` in the log.

This creates all required sheet tabs, including `Users`, `Activity Log`, `Change Log`, `Result Locks`, etc.

### Step B — Add the Super Admin row manually

1. Go back to your spreadsheet.
2. Open the **`Users`** tab.
3. The header row was created by Setup. Add a new row directly below the header with these values:

| Staff ID | First Name | Last Name | Username | Password Hash | Role | Status | Created At |
|---|---|---|---|---|---|---|---|
| `SA001` | *(your first name)* | *(your last name)* | *(choose a username)* | *(see below)* | `Super Admin` | `Active` | *(today's date)* |

**Password Hash:** The system uses plain-text passwords during early pilot (hashed in AuthService).
For the bootstrap account, you can temporarily set `Password Hash` to the literal string `changeme`
and then immediately change it after first login using the in-app password reset.

> If AuthService uses SHA-256 hashing, you must hash your chosen password first.
> Use this Apps Script one-off: In the editor, create a temporary function:
> ```javascript
> function hashTest() {
>   Logger.log(Utilities.computeDigest(
>     Utilities.DigestAlgorithm.SHA_256,
>     'yourChosenPassword'
>   ).map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join(''));
> }
> ```
> Run it, copy the hex output from the log, and paste that as the Password Hash.

---

## 7. Deploy as a Web App

1. In the Apps Script editor, click **Deploy → New deployment**.
2. Click the gear icon next to "Type" and choose **Web app**.
3. Fill in the settings:
   - **Description:** `HGUS Academic System v1` (or any label)
   - **Execute as:** `Me` *(the Google account that owns the spreadsheet)*
   - **Who has access:** `Anyone` *(or "Anyone within [your org]" for school-internal use)*
4. Click **Deploy**.
5. Copy the **Web app URL** — this is the link you will share with staff.

> Every time you update code, you must click **Deploy → Manage deployments → Edit (pencil icon)
> → Version: New version → Deploy** to push changes to the live URL.
> The URL itself does not change between versions.

---

## 8. Connect the External Student Data Sheet

The system reads student data from a separate Google Sheet (the "StudentData" source).

1. Open that external spreadsheet and copy its **Spreadsheet ID** from the URL.
2. In the Apps Script editor, open `Config.gs`.
3. Find the constant `STUDENT_DATA_SHEET_ID` (or similar) and paste your external sheet ID there.
4. Confirm the tab name inside that sheet matches what Config.gs expects
   (typically `StudentData` — see `Config.gs` for the exact constant name).
5. Save and redeploy (see Step 7 above).

---

## 9. First-Run Checklist

Complete these steps in the web app **in this exact order** after deploying:

- [ ] **1. Open the web app URL** and log in with the Super Admin credentials you created.

- [ ] **2. Run Setup Sheets** (if not done in Step 6A above)
  - Go to Admin / Super Admin menu → Settings → "Setup Sheets"
  - Wait for the confirmation toast.

- [ ] **3. Confirm StudentData tab**
  - In your external student data sheet, verify the tab is named correctly and has student rows.
  - Columns expected: `Student ID`, `First Name`, `Last Name`, `Class ID`, `Status`
    (confirm exact column names against `SheetService.gs → refreshStudentCache`).

- [ ] **4. Sync Classes**
  - In the app: Settings → Sync Classes → enter the external sheet ID → tap Sync.
  - Confirm classes appear in the Classes & Subjects screen.

- [ ] **5. Sync Subjects**
  - Settings → Sync Subjects → tap Sync.
  - Confirm subjects appear and are linked to classes.

- [ ] **6. Refresh Student Cache**
  - Settings → Refresh Student Cache → select a class → tap Refresh.
  - Repeat for each class, or refresh all if a bulk option is available.
  - This populates the `Students` tab used by score entry.

- [ ] **7. Create the first Admin account**
  - User Management → Add User → fill in details → Role: Admin → Save.
  - Share the temporary password with the Admin user.

- [ ] **8. Set Session Settings**
  - Settings → Session Settings → enter the current Term and Academic Session → Save.
  - Example: Term `First Term`, Session `2025/2026`.

- [ ] **9. Verify Carry-Forward (if applicable)**
  - If this is not the first term, go to Classes → select a class → Carry Forward.
  - Preview first to confirm student promotions look correct before executing.

- [ ] **10. Test score entry end-to-end**
  - Log in as the Admin, assign a Teacher to a subject, log in as Teacher,
    enter scores for one student, confirm they save without error.

- [ ] **11. Test result locking**
  - As Admin, open a class detail → tap Lock Results.
  - Attempt to save scores for that class as a Teacher — should be rejected with lock message.
  - Unlock and confirm scores can be saved again.

- [ ] **12. Verify Activity Log**
  - As Super Admin, open Activity Log → confirm login events, lock/unlock events appear.

---

## 10. Ongoing Maintenance

| Task | How |
|---|---|
| **Push code updates** | Apps Script editor → Deploy → Manage deployments → New version |
| **Add more staff** | In-app User Management → Add User |
| **Change term/session** | Settings → Session Settings |
| **View audit trail** | Activity Log (in-app) for visible events; `Change Log` tab in the spreadsheet for raw field-level history |
| **Unlock a class** | Class detail screen → Unlock Results (Admin / Super Admin only) |
| **Back up data** | Download the Google Sheet as `.xlsx` from File → Download |

---

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "Session expired" immediately after login | Token not persisting | Check CacheService quota; ensure `Execute as: Me` in deployment |
| Scores not saving — "Result is locked" | Class is locked | Admin must unlock class first |
| Activity Log empty | `Activity Log` tab missing | Re-run Setup Sheets |
| Students not appearing in score entry | Student cache not refreshed | Settings → Refresh Student Cache for that class |
| PDF generation fails | Drive quota or permissions | Confirm the Apps Script account has Drive access; check execution log |
| "Exception: You do not have permission" | Script not deployed as Me | Redeploy: Execute as → Me |

---

*End of Deployment Guide — Stage 7*
