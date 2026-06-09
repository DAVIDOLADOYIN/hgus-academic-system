# HGUS Academic Result Management System
## Stage 1 — Foundation: Deployment Guide

---

## Prerequisites

- A Google account with access to Google Drive
- A new (empty) Google Spreadsheet for the result system
- Access to Google Apps Script (script.google.com)

---

## Step 1 — Create the Google Apps Script Project

1. Open [script.google.com](https://script.google.com)
2. Click **New project**
3. Rename the project: `HGUS Academic Result System`

---

## Step 2 — Link to Your Spreadsheet

The script must run **inside** (as a container-bound script of) the result system spreadsheet.

**Option A — Recommended (container-bound):**
1. Open your new Google Spreadsheet
2. Click **Extensions → Apps Script**
3. This opens a project already linked to the spreadsheet
4. Use this project (delete the default `Code.gs` content — you'll replace it)

**Option B — From script.google.com:**
1. In your script project, go to **Project Settings** (gear icon)
2. Note the Script ID
3. In the spreadsheet, go to Extensions → Apps Script → it will create a separate container. Use Option A instead.

> **Important:** The script must be container-bound to the spreadsheet. `SpreadsheetApp.getActiveSpreadsheet()` will only work correctly in a container-bound script.

---

## Step 3 — Add All Files

In the Apps Script editor, create a file for each item below.
Use the **+ (New file)** button. Choose **Script** for `.gs` files and **HTML** for `.html` files.

**Script files (.gs) — create in this order:**

| File Name (in GAS) | Source File |
|---|---|
| `Config`      | `Config.gs`       |
| `Utils`       | `Utils.gs`        |
| `SheetService`| `SheetService.gs` |
| `AuthService` | `AuthService.gs`  |
| `UserService` | `UserService.gs`  |
| `SetupService`| `SetupService.gs` |
| `Code`        | `Code.gs`         |

> Replace the content of the default `Code.gs` file with `Code.gs` content.
> Rename it if needed (click the three dots next to the file name → Rename).

**HTML files — create each as HTML type:**

| File Name (in GAS) | Source File       |
|---|---|
| `Index`       | `Index.html`       |
| `StyleBase`   | `StyleBase.html`   |
| `AppScript`   | `AppScript.html`   |

> **File names must match exactly** — the `include()` function in `Code.gs` uses the exact name to load HTML files.

---

## Step 4 — Run Setup (Create Sheets)

Before deploying the web app, run the setup function to create all sheets:

1. In the GAS editor, select **SetupService** from the file list
2. From the function dropdown (top toolbar), select **`setupSheets`**
3. Click **▶ Run**
4. When prompted, click **Review permissions** and **Allow**
5. Check the **Execution log** at the bottom — you should see: `Setup complete. Created: [list of sheets]`

✅ Your spreadsheet now has all 10 data sheets + Students Cache + Session Settings + Subjects Reference tab.

---

## Step 5 — Bootstrap the Super Admin

The Super Admin account is set up **directly in the spreadsheet**, not through the app.

1. Open your Google Spreadsheet
2. Go to the **Users** sheet
3. Find the columns: **Staff ID**, **Name**, **Username**, **Password Hash**, **Force Password Change**, **Role**, **Employment Status**
4. Add one row with exactly these values:

| Column | Value |
|---|---|
| Staff ID | `HGST001` |
| Name | *(Super Admin's full name)* |
| Username | *(chosen username, e.g. `superadmin`)* |
| Password Hash | *(leave completely blank)* |
| Force Password Change | `TRUE` |
| Role | `Super Admin` |
| Employment Status | `Active` |
| Added By | `SYSTEM` |
| Created At | *(today's date)* |

> Leave **Password Hash blank**. On first login, the system detects the blank hash + `Force Password Change = TRUE` + `Role = Super Admin` and immediately shows the Set Password screen. The Super Admin sets their own password — no manual hashing required.

---

## Step 6 — Deploy as a Web App

1. In the GAS editor, click **Deploy → New deployment**
2. Click the gear icon next to "Select type" → choose **Web app**
3. Configure:
   - **Description:** `HGUS Academic Result System v1`
   - **Execute as:** `Me` (your Google account)
   - **Who has access:** `Anyone` (so teachers can access without a Google account)
4. Click **Deploy**
5. Copy the **Web App URL** — this is the URL you share with staff

> **Every time you update code**, click **Deploy → Manage deployments → ✏️ Edit → Deploy** to push the new version to the existing deployment URL.

---

## Step 7 — First Login (Super Admin)

1. Open the Web App URL in a browser (or phone)
2. Enter the Username you set in Step 5
3. Enter **any** password (it will be ignored — the blank hash triggers the bootstrap flow)
4. The **Set Password** screen appears
5. Set a strong password (8+ characters)
6. You are now on the **Admin Panel** home screen

---

## Step 8 — Verify Everything Works

Run through this checklist:

- [ ] Login screen loads on the web app URL
- [ ] Super Admin can log in and is prompted to set a password
- [ ] After setting password, Admin Panel home appears
- [ ] Active session/term badge shows in the app bar (default: `2025/2026 · First Term`)
- [ ] User List loads (shows only the Super Admin)
- [ ] Add User creates a new teacher account
- [ ] New teacher can log in and is forced to set a password
- [ ] Profile menu (avatar) → Change Password works
- [ ] Admin can reset a teacher's password from Edit User screen
- [ ] Super Admin can promote/demote users from Edit User screen

---

## Project File Structure Reference

```
Stage 1 - Foundation/
├── Code.gs              ← Entry point + all server-callable functions
├── Config.gs            ← Constants (sheet names, roles, grades, etc.)
├── Utils.gs             ← Helpers (SHA-256, ID gen, validation, etc.)
├── SheetService.gs      ← DATA LAYER — all sheet reads and writes
├── AuthService.gs       ← Login, session tokens, password management
├── UserService.gs       ← User management business logic
├── SetupService.gs      ← One-time sheet initialisation
├── Index.html           ← App shell (returned by doGet)
├── StyleBase.html       ← All CSS (mobile-first)
└── AppScript.html       ← All client-side JavaScript (SPA)
```

---

## Architecture Notes

### Service Layer Isolation
All Google Sheets reads and writes go through `SheetService.gs`.
No other file calls `SpreadsheetApp` directly. To migrate to Supabase or any
other backend, only `SheetService.gs` needs to be rewritten.

### Session Management
Sessions are stored in `CacheService.getScriptCache()` with a 5-minute TTL.
Each validated API call refreshes the timer (inactivity-based timeout).
Tokens are stored client-side in `sessionStorage` — they are never in the URL.

### Password Security
All passwords are SHA-256 hashed using GAS's `Utilities.computeDigest()` before
being written to the Users sheet. Plain-text passwords never touch the sheet.

### SPA Architecture
`doGet()` always returns `Index.html`. All navigation is handled client-side
by the JavaScript in `AppScript.html`. Server data is fetched via `google.script.run`.

---

## Common Issues

**"Sheet not found" error:**
→ Run `setupSheets()` from the GAS editor (Step 4).

**Login says "Username not recognised":**
→ Check the Users sheet. Confirm the Username column value matches exactly
(case-sensitive). Confirm Employment Status is `Active`.

**"Your account has been deactivated":**
→ Employment Status is set to `Resigned`. Change it to `Active` in the Users sheet.

**Web app shows old code after an update:**
→ You must create a new deployment version. Go to Deploy → Manage deployments → Edit → Deploy.

**"Authorization required" error on first run:**
→ The script needs permission to access the spreadsheet. Click "Review permissions" and Allow.

---

## What's Coming in Stage 2

- Sync Classes from external student spreadsheet
- Sync Subjects (from the Subjects Reference tab you can see in the spreadsheet)
- Student cache and class list management
- Assignment management (Form Master + Subject Teacher assignments)
- Assignment carry-forward prompt
- Score entry screens (Component Selector, Score Entry)
- Class Overview (Form Master home)
- Session Settings configuration

---

*HGUS Academic Result Management System — Stage 1 Foundation*
*Built for His Grace Universal Schools, Kaduna*
