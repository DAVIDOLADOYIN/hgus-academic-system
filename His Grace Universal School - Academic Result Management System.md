# His Grace Universal School — Academic Result Management System
## Product Requirements Document (PRD)

**Version:** 5.2
**Last Updated:** 2026-05-04
**Status:** Updated — Super Admin Bootstrap, Role Assignment from User List, Account Creation Screen, Voluntary Password Change

---

## Change Log

| Version | Date | Summary |
|---------|------|---------|
| 1.0 | 2026-05-03 | Initial PRD from source document |
| 2.0 | 2026-05-03 | Gap analysis applied — scoring model, grade system, result slip template corrected |
| 3.0 | 2026-05-03 | All Q&A gaps resolved — PSQ, CLASS MAX, position rules, archive, student data |
| 4.0 | 2026-05-03 | Architecture decisions — Super Admin, 10-sheet model, mobile-first entry, Power BI, Users sheet |
| 5.0 | 2026-05-04 | Confirmed structural details — JSS no arms, subjects in internal tab, classes from external sheet, student caching, three-value term status, generation locks, UI session/term display, Form Master home layout |
| 5.1 | 2026-05-04 | Authentication changed from Google Sign-In to username/password — Users sheet updated with Username, Password Hash, Force Password Change; Admin creates and resets teacher accounts; login flow updated throughout |
| 5.2 | 2026-05-04 | Super Admin bootstrap clarified (4 columns set by developer, password self-set on first login); role assignment moved to user list; Add User screen added; Edit User screen added; voluntary Change Password accessible from profile at all times; new flows and screens documented |

---

## 1. Product Overview

A **mobile-first web application** built on **Google Apps Script** with **Google Sheets** as the database backend. The system serves the **secondary school arm only** (JSS and SSS) for the initial pilot. Primary and Nursery arms will be covered in future expansions.

The system enables:
- Teachers to input student scores **one component at a time** per subject per term, optimised for phone use
- Automatic calculation of totals, grades, comments, averages, CLASS MAX, and class positions
- Form Masters to manage their class list, enter Personal and Social Qualities ratings, and write remarks per student
- Generation and bulk export of broadsheets and individual student result slips — gated on completion
- Admin and Super Admin control over users, assignments, configuration, and session management
- A **Power BI integration feed** via an Apps Script API endpoint for school-wide analytics

The system is designed with a clean service-layer architecture so all data access is isolated, enabling future migration to a standalone database and web backend without restructuring business logic or Power BI dashboards.

---

## 2. Academic Structure

### 2.1 School Sections & Classes

The result system covers Secondary only. Classes are read from the external student data sheet (see Section 5.3) and filtered to Junior Secondary and Senior Secondary rows only.

| Section | Classes | Arms | Departments |
|---------|---------|------|-------------|
| JSS | JSS 1, JSS 2, JSS 3 | None — one stream per year level | None |
| SSS | SSS 1, SSS 2, SSS 3 | None | Art, Commerce, Science |

**Total classes in scope: 12** — 3 JSS + 9 SSS (3 levels × 3 departments)

SSS classes are distinguished by department: SSS 1 Art, SSS 1 Commerce, SSS 1 Science, SSS 2 Art, SSS 2 Commerce, SSS 2 Science, SSS 3 Art, SSS 3 Commerce, SSS 3 Science.

Nursery, Primary, and any other sections in the external class list are ignored by the result system.

### 2.2 Academic Calendar

- **Terms:** First Term, Second Term, Third Term
- **Sessions:** Identified by academic year — e.g., 2025/2026, 2026/2027
- All score, PSQ, and remark data is always tagged with both **Session** and **Term**
- The active Session and Term are set by Admin in Session Settings and displayed persistently at the top of every screen in the application

### 2.3 Subject Organisation

Subject data is stored in a dedicated **Subjects Reference tab** within the result system Google Spreadsheet. The Admin syncs subjects from this tab into the Subjects data sheet. The tab is pre-populated from the school's existing subject list and follows this structure:

**JSS Subjects** (18 subjects, all General category):
English Language, Mathematics, Digital Technologies, Business Studies, Creative and Cultural Science, Christian Religious Studies, Social and Citizenship Studies, History, Intermediate Science, Basic Science, Physical Health Education, Agricultural Science, Home Economics, Civic Education, French, Hausa, Basic Tech, Social Studies

**SSS Subjects** (17 subjects, across four categories):

| Category in tab | Maps to Department | Subjects |
|----------------|--------------------|---------|
| General | All SSS departments | English Language, Mathematics, Digital Technologies, Civic Education, Agricultural Science, Data Processing, Geography |
| Science | Science department | Chemistry, Physics, Biology |
| Business | Commerce department | Commerce, Financial Accounting |
| Humanities | Art department | Government, Christian Religious Studies, Literature |

When the Admin triggers **Sync Subjects**, the system reads the Subjects Reference tab, creates or updates Subjects sheet entries, and auto-assigns subjects to the correct classes:
- All JSS subjects → assigned to JSS 1, JSS 2, JSS 3
- SSS General subjects → assigned to all nine SSS classes
- SSS Science subjects → assigned to SSS 1 Science, SSS 2 Science, SSS 3 Science
- SSS Business/Commerce subjects → assigned to SSS 1 Commerce, SSS 2 Commerce, SSS 3 Commerce
- SSS Humanities/Art subjects → assigned to SSS 1 Art, SSS 2 Art, SSS 3 Art

Class-Subject Assignments are created per session. If subjects change for a new session, the Admin runs Sync Subjects again for that session.

---

## 3. User Roles & Access Control

Three role tiers: **Super Admin**, **Admin**, and **Teacher**. All users stored in a single Users sheet. Roles resolved from this sheet on every login.

### 3.1 Super Admin

- **One account only** — bootstrapped by the developer directly in the Users sheet before launch
- Developer sets exactly four columns: Staff ID, Username, Role = Super Admin, Force Password Change = TRUE. Password Hash is left blank.
- On first login, the system detects the empty hash and Force Password Change flag and immediately shows the Change Password screen. Super Admin sets their own password — no manual hash calculation required.
- Cannot be deleted or modified by any other user, including other Admins
- Can promote any user to Admin or demote any Admin to Teacher directly from the User List screen
- The only user who can transfer Super Admin status to another account
- Has all Admin capabilities in addition to the above
- Protection enforced in code — the system checks Role before executing any write on the Users sheet

### 3.2 Admin

- Multiple admins supported; added and managed by Super Admin only
- Super Admin can promote or demote any user via the User List screen — no separate admin management screen required
- Admin capabilities:
  - Add new user accounts (Teacher or Admin as permitted by role)
  - Edit and manage existing user accounts
  - Assign Form Master role per class per session
  - Grant a Form Master full-class score entry permission
  - Assign Subject Teachers to subjects per class per term
  - Set active session and term (Session Settings)
  - Configure next term fee and resumption date (used in result slip footer)
  - Sync classes from external sheet
  - Sync subjects from internal Subjects Reference tab
  - Confirm or update assignment carry-forward at term/session start
  - Trigger Refresh Student List (updates student cache)
  - Mark students as Exam Exempt or Not Continuing for a given term
  - Archive completed session data
  - View Results Overview (all classes, read-only)

### 3.3 Form Master

- One active Form Master per class per session, assigned by Admin
- By default, enters scores only for subjects they personally teach in their class
- If Admin grants full-class access, enters scores for all subjects in their class
- Additional responsibilities:
  - Manage class list — mark students as Not Continuing or Exam Exempt for the term
  - Enter Personal and Social Qualities ratings per student per term
  - Write a free-text remark per student per term
  - View broadsheet for their class (unlocked when all scores are complete)
  - Generate and download result slips (unlocked when scores, PSQ, and remarks are all complete)

### 3.4 Subject Teacher

- Assigned to one or more specific subjects within one or more classes by Admin
- Enters score components for assigned subjects in assigned classes only, per assigned term
- Sees their assignments as a list — one card per class-subject combination
- Cannot access PSQ entry, Remarks, class list management, result generation, or other classes/subjects

> A Form Master can also be a Subject Teacher in another class. Roles are assignment-based, not account-based.

---

## 4. Authentication & Session Management

- **Login method:** Username and password — no Google Sign-In
- Credentials (username and SHA-256 hashed password) are stored directly in the Users sheet
- Admin creates all teacher accounts, choosing a username and setting a temporary password
- On first login, the user is forced to change their password before accessing any screen (Force Password Change flag = TRUE)
- **Voluntary password change:** Any logged-in user can change their password at any time via the profile menu (avatar icon on their home screen). They must enter their current password plus their new password twice to confirm.
- Password reset (forgotten password) is Admin-only — teachers contact Admin, who sets a new temporary password and re-triggers Force Password Change
- On login, the system performs a lookup against the Users sheet using the submitted username:
  - Username not found → access denied with message: *"Username not recognised. Contact your administrator."*
  - Password does not match → access denied with message: *"Incorrect password. Contact your administrator if you have forgotten it."*
  - Employment Status = Resigned → access denied with message: *"Your account has been deactivated. Contact your administrator."*
  - Force Password Change = TRUE → redirected immediately to the Change Password screen before any other screen loads
  - Role = Super Admin → Super Admin access
  - Role = Admin → Admin access
  - Role = Teacher → Teacher access (Form Master or Subject Teacher scope resolved from assignment sheets)
- **Session timeout:** Auto-logout after **5 minutes of inactivity**
- **Active session and term** are displayed persistently at the top of every screen — set once by Admin and visible everywhere

### 4.1 Super Admin Bootstrap (One-Time Developer Setup)

Before the system goes live, the developer adds one row to the Users sheet manually:

| Column | Value |
|--------|-------|
| Staff ID | HGST001 |
| Username | (chosen by Super Admin) |
| Password Hash | (leave blank) |
| Force Password Change | TRUE |
| Role | Super Admin |
| Name | (Super Admin's name) |
| Employment Status | Active |

All other columns can be filled in later. On first login, the system detects the blank Password Hash and immediately shows the Change Password screen. Super Admin sets their own password — no hash tool or developer assistance required.

### 4.2 Account Creation (Admin / Super Admin Flow)

1. Admin or Super Admin opens User List → Add User
2. Admin enters: Full Name, Username (system checks uniqueness instantly), Temporary Password (shown in plain text so Admin can communicate it), Email, Phone Number, Subject Specialty, Employment Status (default: Active), Role (default: Teacher; Super Admin can also set Admin)
3. Admin taps Create Account
4. System hashes the password, creates the Users row, sets Force Password Change = TRUE, auto-generates a Staff ID (HGST00N)
5. Admin communicates the username and temporary password to the user directly (outside the system)

### 4.3 Password Reset (Admin / Super Admin Flow)

1. Admin or Super Admin opens the user's profile from User List
2. Admin selects Reset Password and enters a new temporary password (shown in plain text)
3. System stores the hashed temporary password and sets Force Password Change = TRUE
4. User is forced to set a new password on their next login

### 4.4 Voluntary Password Change (Any Logged-In User)

1. User taps the avatar / profile icon on their home screen
2. Selects Change Password from the menu
3. Enters current password, new password, and confirmation of new password
4. System verifies current password matches stored hash
5. If matched: stores new hash, confirms change, returns user to home screen
6. If not matched: inline error — *"Current password is incorrect."*

---

## 5. Student Data & Reference Data

### 5.1 Student Data Source

Student records are not managed within this system. They are sourced from an **external Google Sheet** (the school's student registration system).

Columns used from that sheet:

| Column | Description |
|--------|-------------|
| Student ID | Unique identifier in format HG#### — generated by the registration system |
| Full Name | Student's full name |
| Student Class | The class the student belongs to (JSS 1, JSS 2, JSS 3, SSS 1 Art, etc.) |
| Gender | Male / Female |
| Action Flag | Student status — PROMOTED or REPEAT |

### 5.2 Student List Caching Strategy

A full cross-spreadsheet read on every screen load would cause unacceptable delays on mobile. The system uses **pull-on-open caching**:

- When a teacher opens the Score Entry screen for a class, the system fetches the latest student list for that class from the external sheet and writes it to a lightweight **Students Cache tab** within the result system spreadsheet
- Subsequent loads for the same class read from the cache (fast, no external call)
- The cache refreshes automatically at the start of each new session
- Admin can trigger **Refresh Student List** at any time to force an immediate refresh (e.g., after a new student is added or a student changes class mid-term)

### 5.3 Class List Sync

The Classes sheet in the result system is populated by reading from the external student data sheet:

- The system reads all rows from the class list tab in the external sheet
- It filters to rows where Section = "Junior Secondary" or "Senior Secondary"
- It maps Student Class names (JSS 1, SSS 1 Art, etc.) and Department (Art, Commerce, Science) into the Classes sheet
- Admin triggers **Sync Classes** from Session Settings to refresh
- Only classes present in the external sheet are available in the result system — no manual class entry

### 5.4 Subject Sync

Subjects are read from the **Subjects Reference tab** within the same result system Google Spreadsheet:

- The tab contains two tables: one for JSS subjects, one for SSS subjects
- Each row has: Subject Name and Category (General, Science, Business, Humanities)
- Admin triggers **Sync Subjects** from Session Settings
- The system creates/updates Subjects sheet entries and auto-assigns subjects to classes via the Class-Subject Assignments sheet (see Section 2.3 for the mapping rules)
- Sync is session-specific — assignments are created for the currently active session

### 5.5 Student Term Status

Each student can have one of three statuses per term per class:

| Status | Meaning | Effect |
|--------|---------|--------|
| Active | Normal enrolment | Included in all score requirements, completion counts, broadsheet, and result generation |
| Exam Exempt | Present but missed tests | Excluded from Exam lock count only; still required for other components |
| Not Continuing | Did not return this term | Excluded from all score requirements, completion counts, broadsheet, and result generation. Remains visible in the class list with a clear indicator |

Form Master and Admin can set any of these statuses. A student marked Not Continuing is not deleted — their record and any previously entered scores are preserved. Status is stored in the Student Term Status sheet (see Section 9.10).

### 5.6 Mid-Term Class Changes

If a student changes class mid-term:
1. Admin updates the student's record in the external source sheet
2. Admin triggers Refresh Student List
3. The student appears in their new class for subsequent entries
4. Previously entered scores are retained, tied to the Student ID and the term/session they were entered in

---

## 6. Scoring Model

All 6 score components are entered **per subject, per student, per term**. Scores are entered **one component type at a time** across the full class list.

### 6.1 Score Components

| Component | Label | Max Marks |
|-----------|-------|-----------|
| Classwork | C/W | 6 |
| Assignment | ASS | 2 |
| Attendance | ATT | 2 |
| 1st Continuous Assessment | C.A (1st) | 10 |
| 2nd Continuous Assessment | C.A (2nd) | 10 |
| Examination | EXAM | 70 |
| **Total** | **TOTAL** | **100** — computed on-the-fly |

### 6.2 Grade System

| Score Range | Grade | Auto-Comment |
|:-----------:|:-----:|:------------:|
| 75 – 100 | A1 | Excellent |
| 70 – 74 | B2 | Very Good |
| 65 – 69 | B3 | Good |
| 60 – 64 | C4 | Fairly Good |
| 55 – 59 | C5 | Fairly Good |
| 50 – 54 | C6 | Fairly Good |
| 45 – 49 | D7 | Weak |
| 40 – 44 | E8 | Very Weak |
| 0 – 39 | F9 | Fail |

### 6.3 Class Maximum (CLASS MAX)

For each subject, per class, per term: the highest Total Score achieved by any active student in that subject. Printed in the CLASS MAX column on every result slip.

### 6.4 Exam Lock Rule

The Exam component is locked for a subject until every **Active** student in the class has both 1st Test and 2nd Test scores entered for that subject.

- Exam Exempt students are excluded from the lock count
- Not Continuing students are excluded from the lock count
- When locked, the Component Selector shows: *"Exam is locked. [N] students are missing 1st or 2nd test scores. Enter their scores or update their term status to unlock."*

### 6.5 Overall Average & Position

**Final Average** = Sum of all subject Total Scores ÷ Number of subjects with entered scores

| Level | Ranking Scope |
|-------|--------------|
| JSS 1, JSS 2, JSS 3 | Within the single class (one stream per level) |
| SSS 1, SSS 2, SSS 3 | Across all three departments at the same level (e.g., all SSS 2 students — Art + Commerce + Science combined) |

Tie handling: shared position; next rank skipped. *(Both 3rd → next student is 5th)*

---

## 7. Generation Rules (Broadsheet & Results)

These rules protect the integrity of outputs. Buttons are visible but disabled until conditions are met, with a specific message listing what remains incomplete.

### 7.1 Broadsheet — Unlock Condition

Available only when **100% of score components are entered for all Active students across all subjects** in the class for the selected term.

Blocking message example: *"Broadsheet locked — incomplete scores: French (2 students missing ATT), Social Studies (all 8 students — not started)."*

### 7.2 Result Generation — Unlock Condition

Available only when all three are complete for all Active students:
- 100% of score components (all subjects, all components)
- 100% PSQ ratings (all 16 traits entered for every Active student)
- 100% Remarks (at least one character entered for every Active student)

Blocking message example: *"Results locked — 3 students missing remarks, PSQ not entered for 5 students."*

---

## 8. Core User Flows

### Flow 1: Login

1. User opens the app
2. Username and password fields presented
3. User enters credentials and taps Sign In
4. System looks up username in Users sheet and verifies SHA-256 hashed password
5. If username not found → access denied: *"Username not recognised. Contact your administrator."*
6. If password incorrect → access denied: *"Incorrect password. Contact your administrator if you have forgotten it."*
7. If Employment Status = Resigned → access denied: *"Your account has been deactivated."*
8. If Force Password Change = TRUE → redirected to Change Password screen; cannot proceed until new password set
9. If all checks pass → routed to role-appropriate home screen
10. Active session and term displayed at top immediately

### Flow 2: Subject Teacher — Enter Scores

1. Teacher logs in → **Assignment List** (cards: one per class-subject)
2. Active session and term visible in app bar
3. Teacher taps a card → **Component Selector**
4. Component Selector shows 6 tiles with status (Complete / Partial / Not started / Locked)
5. Teacher taps a component → **Score Entry** (full class list, one input per student)
6. Pre-filled values shown for already-saved scores
7. Teacher enters scores → **Save** → returns to Assignment List

### Flow 3: Form Master — Home & Navigation

1. Form Master logs in → **Class Overview** screen
2. App bar shows: greeting, name, avatar — identical layout to Subject Teacher home
3. Active session and term shown in app bar
4. Subject grid shows completion percentage per subject
5. Quick-action tiles: Enter Qualities | Enter Remarks | Manage Class List | Broadsheet (locked until complete) | Generate Results (locked until complete)

### Flow 4: Form Master — Manage Class List

1. From Class Overview, Form Master taps **Manage Class List**
2. Full student list for the class and current term loads
3. Each student row shows current term status (Active / Exam Exempt / Not Continuing)
4. Form Master taps a student to change their status
5. Status change saved to Student Term Status sheet immediately
6. Students marked Not Continuing are greyed out across all entry screens

### Flow 5: Form Master — PSQ Entry

1. Taps Enter Qualities from Class Overview
2. Student list with PSQ completion indicator loads
3. Tap a student → 16 trait ratings (1–5) displayed; previously entered ratings pre-filled
4. Save & Next moves to the next student

### Flow 6: Form Master — Remarks Entry

1. Taps Enter Remarks from Class Overview
2. Full class list with one text input per student
3. Pre-filled where remarks already saved
4. Save

### Flow 7: Generate Broadsheet

1. Admin or Form Master selects class and term
2. System checks completion — if locked, shows blocking message
3. If complete → broadsheet table displayed
4. Export as PDF or Excel

### Flow 8: Generate Result Slips

1. Form Master or Admin selects class and term
2. System checks completion — if locked, shows blocking message listing what is missing
3. If complete → student list with checkboxes
4. Select one or more (or all) → Generate & Download PDF
5. All selected slips bundled into one PDF

### Flow 9: Admin — Session Settings

Admin uses Session Settings to:
- Set the active academic session (e.g., 2025/2026)
- Set the active term (First, Second, or Third)
- Set the term start and end dates (informational — shown in teacher dashboard)
- Set next term fee and next term resumption date (appear in result slip footer)
- Trigger Sync Classes (reads class list from external sheet)
- Trigger Sync Subjects (reads from internal Subjects Reference tab)
- Trigger Refresh Student List (updates student cache from external sheet)

### Flow 10: Admin — Assignment Carry-Forward

At the start of each new term or session, the system detects no assignments exist for the period and prompts the Admin:
> *"[Term] [Session] is starting. Here are last term's assignments. Confirm to carry forward, or edit what has changed."*

Admin reviews, edits if needed, and confirms. System creates new assignment rows. If not confirmed, score entry is blocked.

### Flow 11: Archive Session

Admin selects a completed session → Archive Session → read-only backup created. Archived data viewable but not editable.

### Flow 12: Super Admin — Role Assignment from User List

1. Super Admin opens User List from Admin Panel
2. Taps any user row to open their profile
3. Profile shows current role badge and a Change Role option
4. Super Admin selects new role (Teacher → Admin or Admin → Teacher) with a confirmation prompt
5. System updates the Role column in the Users sheet immediately
6. Super Admin's own row shows no Change Role option — protected in code

### Flow 13: Admin — Add New User

1. Admin or Super Admin opens User List → taps Add User
2. Add User form: Name, Username (live uniqueness check), Temporary Password (visible plain text), Email, Phone, Subject Specialty, Employment Status, Role (Teacher default; Admin only if Super Admin)
3. Taps Create Account
4. System: hashes password, generates Staff ID, sets Force Password Change = TRUE, writes row to Users sheet
5. Admin notes the username and temporary password to communicate to the user out-of-band

### Flow 14: Any User — Change Password (Voluntary)

1. User taps avatar icon on their home screen
2. Selects Change Password from profile menu
3. Enters: Current Password | New Password | Confirm New Password
4. System verifies current password → if correct, stores new hash → success message
5. If current password wrong → inline error: *"Current password is incorrect."*

---

## 9. Screens & UI Requirements

**Mobile-first** — all screens designed for phone portrait mode. The **active session and term are displayed once at the top of every screen** (in the app bar or nav bar) and are not repeated anywhere else on the same screen.

### Screen 1: Login
- School name and logo mark
- Username field and Password field (password masked, show/hide toggle)
- Sign In button
- Error states displayed inline below the form:
  - "Username not recognised. Contact your administrator."
  - "Incorrect password. Contact your administrator if you have forgotten it."
  - "Your account has been deactivated. Contact your administrator."
- No self-service password reset link — directed to Admin

### Screen 1A: Change Password *(first login only)*
- Shown immediately after successful credential check when Force Password Change = TRUE
- Message: *"Welcome! You must set a new password before continuing."*
- New Password field | Confirm Password field
- Validation: minimum 8 characters; fields must match
- On save: password hashed and stored, Force Password Change set to FALSE, user routed to their home screen

### Screen 2: Assignment List *(Subject Teacher home)*
- App bar: greeting, teacher name, avatar, active session and term
- Scrollable list of assignment cards (class · subject · progress summary)
- Tap a card → Component Selector

### Screen 3: Class Overview *(Form Master home)*
- App bar: greeting, Form Master name, avatar, active session and term — **identical layout to Screen 2**
- Subject grid: each tile shows subject name + completion percentage + progress bar
- Quick-action tiles: Enter Qualities | Enter Remarks | Manage Class List | Broadsheet | Generate Results
- Broadsheet and Generate Results tiles show lock state with reason when conditions not met

### Screen 4: Component Selector
- Nav bar: back button, subject name, class name — active session and term in subtitle
- 6 component tiles in a 2-column grid with status indicators
- Locked Exam tile shows explanatory message with count of students blocking it

### Screen 5: Score Entry *(mobile-first)*
- Nav bar: back button, component name, class · subject — active session and term in subtitle
- Info bar: score range (0–N marks), count of entries so far
- Compact scrollable list: index number | student name | single numeric input
- Input is narrow (fits 2 digits) — name takes all remaining space, truncates with ellipsis if needed
- Pre-filled scores displayed in a distinct colour; indicator if entered by a different teacher
- Sticky Save button at bottom
- Save → returns to Assignment List

### Screen 6: PSQ Entry *(Form Master only)*
- Nav bar: back button, screen title — active session and term in subtitle
- Student navigator: previous / student name + progress count / next
- Rating scale reminder bar (5 = Excellent … 1 = Poor)
- 16 trait rows, each with 1–5 tap buttons
- Previously entered ratings pre-filled
- Save & Next button (sticky)

### Screen 7: Remarks Entry *(Form Master only)*
- Nav bar: back button, screen title, class — active session and term in subtitle
- Scrollable list: student name + text area per student
- Pre-filled where already saved
- Sticky Save button

### Screen 8: Manage Class List *(Form Master and Admin)*
- Nav bar: back button, class name — active session and term in subtitle
- Full student list for the class and term
- Each row: student name | current status badge (Active / Exam Exempt / Not Continuing)
- Tap a student → status selector (three options with descriptions)
- Not Continuing students greyed out with strikethrough

### Screen 9: Broadsheet
- Filters: class and term (session fixed to active)
- Horizontal-scrollable table: student rows × subject columns + Average + Grade + Position
- Export: Download PDF | Download Excel
- Locked state: disabled buttons + specific blocking message

### Screen 10: Generate Results
- Class and term selector
- Student list with checkboxes (Active students only)
- Generate & Download PDF button
- Locked state: disabled button + blocking message listing what is missing

### Screen 11: Admin Panel
- App bar: Admin / Super Admin label, name, avatar, active session and term
- Navigation tiles: User List | Classes & Subjects | Manage Assignments | Session Settings | Archive Session | Results Overview

### Screen 12: Session Settings *(Admin)*
- Active session and term selectors
- Term date pickers (start, end)
- Next term fee and resumption date fields
- Action buttons: Sync Classes | Sync Subjects | Refresh Student List

### Screen 13: Results Overview *(Admin)*
- Completion dashboard: all 12 classes listed with overall score entry percentage for current term
- Status indicators: which classes are ready for broadsheet, which for result generation
- Tap any class → read-only broadsheet for any session and term

### Screen 14: User List *(Admin and Super Admin)*
- Searchable, filterable list of all staff: name, username, role badge, employment status
- Add User button (top right) → opens Add User form (Screen 15)
- Tap any user row → opens Edit User / User Profile (Screen 16)
- Super Admin sees a Change Role option on each row (except their own)
- Super Admin sees a Danger Zone section at the bottom: Transfer Super Admin (with confirmation dialog)

### Screen 15: Add User *(Admin and Super Admin)*
- Form fields: Full Name, Username (live uniqueness check — shows ✓ or ✗ as typed), Temporary Password (plain text, visible), Email, Phone Number, Subject Specialty, Employment Status (dropdown: Active / On Leave / Resigned), Role (dropdown: Teacher default; Admin option visible to Super Admin only)
- Create Account button
- On success: Staff ID shown in a confirmation banner; Admin can note credentials to share

### Screen 16: Edit User / User Profile *(Admin and Super Admin)*
- Displays all user details in editable fields: Name, Email, Phone, Subject Specialty, Employment Status
- Read-only fields: Staff ID, Username, Date Joined, Added By
- Reset Password button → Admin enters a new temporary password (plain text); system hashes it and sets Force Password Change = TRUE
- Employment Status change to Resigned → access revoked on next login attempt
- Super Admin view adds: Change Role dropdown and Remove Account button (not shown on Super Admin's own row)

### Screen 17: Change Password *(Any logged-in user — voluntary)*
- Accessible from avatar / profile menu on any home screen
- Fields: Current Password | New Password | Confirm New Password
- Validation: minimum 8 characters; new password and confirm must match; current password must be correct
- On success: hash updated, user stays logged in, success message shown
- On failure: inline error under Current Password field

---

## 10. Data Structure

**10 permanent sheets** in the result system Google Spreadsheet. Rows accumulate over time — never deleted. Session and Term columns allow any historical period to be queried independently. All sheet access happens through service functions.

The spreadsheet also contains one **reference tab** (not a data sheet):
- **Subjects Reference** — the school's subject list used as the source for Sync Subjects. Pre-populated. Not touched by the application directly.

### 10.1 Users Sheet

| Column | Type | Notes |
|--------|------|-------|
| Staff ID | Text | Auto-generated: HGST001, HGST002... Universal foreign key across all sheets |
| Name | Text | Full name |
| Username | Text | Chosen by Admin at account creation; unique; used to log in |
| Password Hash | Text | SHA-256 hash of the user's current password; never stored in plain text |
| Force Password Change | Boolean | TRUE = user must set a new password on next login; set to TRUE on account creation and password reset |
| Email | Text | Contact email (informational only — not used for login) |
| Role | Text | Super Admin / Admin / Teacher |
| Phone Number | Text | Contact number |
| Date Joined | Date | Employment start date |
| Employment Status | Text | Active / On Leave / Resigned |
| Subject Specialty | Text | Subjects the teacher is qualified to teach (informational) |
| Added By | Text | Staff ID of the Admin who created this record |
| Created At | DateTime | Timestamp of record creation |

Super Admin row (Role = Super Admin) cannot be edited or deleted by any other user.

### 10.2 Form Master Assignments Sheet

| Column | Type | Notes |
|--------|------|-------|
| Staff ID | Text | References Users sheet |
| Class ID | Text | References Classes sheet |
| Session | Text | e.g., 2025/2026 |
| Granted Full Access | Boolean | TRUE = can enter scores for all subjects in the class |
| Active From | Date | Date the assignment became effective |
| Is Active | Boolean | FALSE when replaced mid-session |

### 10.3 Teacher-Subject Assignments Sheet

| Column | Type | Notes |
|--------|------|-------|
| Staff ID | Text | References Users sheet |
| Class ID | Text | References Classes sheet |
| Subject ID | Text | References Subjects sheet |
| Term | Text | First / Second / Third |
| Session | Text | e.g., 2025/2026 |

Historical rows preserved — current assignments filtered by active Term and Session.

### 10.4 Classes Sheet

Populated by Sync Classes (reads from external sheet, JSS and SSS rows only).

| Column | Type | Notes |
|--------|------|-------|
| Class ID | Text | Auto-generated |
| Class Name | Text | e.g., JSS 2, SSS 1 Commerce |
| Section | Text | JSS / SSS |
| Department | Text | Art / Commerce / Science / N/A |

### 10.5 Subjects Sheet

Populated by Sync Subjects (reads from internal Subjects Reference tab).

| Column | Type | Notes |
|--------|------|-------|
| Subject ID | Text | Auto-generated |
| Subject Name | Text | e.g., Mathematics |
| Section | Text | JSS / SSS |
| Department | Text | Art / Commerce / Science / General / N/A |

JSS English Language and SSS English Language are **separate Subject IDs** with different Section values. They share a name but are distinct entries — a JSS broadsheet never includes SSS subjects and vice versa.

### 10.6 Class-Subject Assignments Sheet

Auto-populated by Sync Subjects. Defines what subjects should appear in each class's broadsheet and result slip for a given session.

| Column | Type | Notes |
|--------|------|-------|
| Class ID | Text | References Classes sheet |
| Subject ID | Text | References Subjects sheet |
| Session | Text | e.g., 2025/2026 |

### 10.7 Scores Sheet

One row per component per student per subject. Total, Grade, and Comment computed on-the-fly.

| Column | Type | Notes |
|--------|------|-------|
| Entry ID | Text | Auto-generated |
| Student ID | Text | HG#### |
| Class ID | Text | References Classes sheet |
| Subject ID | Text | References Subjects sheet |
| Term | Text | First / Second / Third |
| Session | Text | e.g., 2025/2026 |
| Component | Text | C/W · ASS · ATT · Test1 · Test2 · Exam |
| Score | Number | Range enforced per component |
| Staff ID | Text | Who entered the score |
| Timestamp | DateTime | When saved |

### 10.8 PSQ Sheet

| Column | Type | Validation |
|--------|------|------------|
| Student ID | Text | — |
| Class ID | Text | — |
| Term | Text | — |
| Session | Text | — |
| Physical Health | Number | 1–5 |
| Punctuality | Number | 1–5 |
| Reliability | Number | 1–5 |
| Personal Neatness | Number | 1–5 |
| Politeness | Number | 1–5 |
| Honesty | Number | 1–5 |
| Initiative | Number | 1–5 |
| Neatness in Academic Work | Number | 1–5 |
| Class Attendance | Number | 1–5 |
| Class Participation | Number | 1–5 |
| Self-Control | Number | 1–5 |
| Spirit of Co-operation | Number | 1–5 |
| Sense of Responsibility | Number | 1–5 |
| Attitude to Study | Number | 1–5 |
| Relationship with Peers | Number | 1–5 |
| Relationship with Teachers | Number | 1–5 |
| Form Master Staff ID | Text | — |
| Timestamp | DateTime | — |

### 10.9 Remarks Sheet

| Column | Type |
|--------|------|
| Student ID | Text |
| Class ID | Text |
| Term | Text |
| Session | Text |
| Remark | Text |
| Form Master Staff ID | Text |
| Timestamp | DateTime |

### 10.10 Student Term Status Sheet

| Column | Type | Notes |
|--------|------|-------|
| Student ID | Text | HG#### |
| Class ID | Text | — |
| Term | Text | — |
| Session | Text | — |
| Status | Text | Active / Exam Exempt / Not Continuing |
| Set By | Text | Staff ID of Admin or Form Master who set the status |
| Timestamp | DateTime | — |

Default status for all students is Active. Only students with a non-Active status have a row in this sheet. When the system needs a student's status, it looks up this sheet — no row found means Active.

---

## 11. Validation Rules

| Field | Rule | Behaviour on Violation |
|-------|------|------------------------|
| C/W | 0–6 | Inline error; cannot save |
| ASS | 0–2 | Inline error; cannot save |
| ATT | 0–2 | Inline error; cannot save |
| 1st Test | 0–10 | Inline error; cannot save |
| 2nd Test | 0–10 | Inline error; cannot save |
| Exam | 0–70 | Inline error; cannot save |
| PSQ Rating | 1–5 | Inline error; cannot save |
| Exam availability | All Active students need Test1 + Test2 | Component locked; message shown |
| Broadsheet availability | All scores complete for all Active students | Broadsheet button disabled; blocking message |
| Result generation availability | Scores + PSQ + Remarks complete for all Active | Results button disabled; blocking message |
| Duplicate component entry | Same Student + Subject + Component + Term + Session | Warning modal; save blocked; existing entry preserved |
| Unauthorised login | Username not found in Users sheet | Access denied: "Username not recognised. Contact your administrator." |
| Wrong password | Username found, password hash does not match | Access denied: "Incorrect password. Contact your administrator if you have forgotten it." |
| Resigned account login | Employment Status = Resigned | Access denied: "Your account has been deactivated." |
| Force Password Change | Flag = TRUE on login | Intercepted before home screen; Change Password screen shown |
| Duplicate username | Admin tries to create account with existing username | Blocked inline; Admin must choose a different username |
| Super Admin edit/delete | Attempted by any other user | Blocked in code; silent rejection |

---

## 12. Edge Case Handling

| Scenario | Behaviour |
|----------|-----------|
| Student not returning this term | Form Master marks as Not Continuing → excluded from all requirements and outputs |
| Exam blocked by one absent student | Mark student as Exam Exempt → excluded from lock count → Exam unlocks |
| Teacher closes app before saving | Only previously saved scores retained; pre-filled on reopen |
| Duplicate component entry attempt | Save blocked; existing entry preserved; warning shown |
| Newly added student in external sheet | Admin triggers Refresh Student List → student appears in cache |
| Student changes class mid-term | Admin updates external sheet → triggers Refresh → student in new class; prior scores retained |
| Form Master replaced mid-session | Old assignment: Is Active = FALSE. New assignment created. Prior PSQ and Remarks retain original Form Master's Staff ID |
| Teacher changed mid-term | Old Teacher-Subject Assignment row retained as history. New row for current term. Prior scores retain original Staff ID |
| No assignments set for new term | Score entry blocked; Admin prompted to confirm carry-forward |
| SSS position tie | Shared position; next rank skipped |
| Subjects change for new session | Admin runs Sync Subjects for new session; old session assignments unaffected |
| Class added or removed in external sheet | Admin runs Sync Classes; new class appears; removed class hidden from dropdowns (historical data preserved) |
| Broadsheet requested before scores complete | Button disabled; message lists specific subjects/students blocking it |
| Results requested before all sections complete | Button disabled; message lists exactly what is missing (scores/PSQ/remarks) |
| Session inactivity (5 minutes) | Auto-logout |
| First-time login (Force Password Change) | User cannot access any screen until new password is set; Change Password screen is a mandatory gate |
| Super Admin first login (blank Password Hash) | System detects empty hash; Force Password Change = TRUE gate triggers; Super Admin sets own password — no manual hash required |
| Teacher forgets password | No self-service reset; teacher contacts Admin; Admin resets via Edit User screen; sets new temporary password; Force Password Change re-triggered |
| Admin forgets password | Admin contacts Super Admin; Super Admin resets via User List → Edit User |
| Username collision during account creation | System blocks creation; Admin shown inline error: "This username is already taken." Live check shown as user types. |
| Wrong current password on voluntary change | Inline error under Current Password field; hash not updated; user remains logged in |
| Role changed while user is logged in | New role applies on next login; current session continues with old role until timeout or manual logout |

---

## 13. Output Requirements

### 13.1 Student Result Slip

One slip per student per term. Layout mirrors the school's physical template. JSS and SSS use the **same layout** — only the subject list and section subtitle differ.

**Header Block**
- School name: HIS GRACE UNIVERSAL SCHOOLS
- Address: Across the Rail, Sabon Gari Gonin Gora, P.O Box 8095, Kaduna
- Section subtitle: "Junior Secondary and Continuous Assessment Results" (JSS) or "Senior Secondary and Continuous Assessment Results" (SSS)
- Student Name | Age
- Form (Class) | Term | Academic Year
- Attendance | Out | Days

**Academic Record Table**

| Column | Source |
|--------|--------|
| Subject | Subject name |
| ASS | Assignment score |
| C/W | Classwork score |
| ATT | Attendance score |
| C.A (1st) | 1st Test score |
| C.A (2nd) | 2nd Test score |
| EXAM | Exam score |
| TOTAL | Computed sum |
| GRADE | Auto-generated |
| CLASS MAX | Highest total in subject across the class/level |
| COMMENT | Auto-generated from grade |

**Summary Row:** Final Average | Form Position | Number in Class

**Personal and Social Qualities Block:** 16 traits with 1–5 ratings; scale printed on slip

**Grade Reference Table** *(printed on slip)*

| Score | Grade | Remark |
|:-----:|:-----:|:------:|
| 75–100 | A1 | Excellent |
| 70–74 | B2 | Very Good |
| 65–69 | B3 | Good |
| 60–64 | C4 | Fairly Good |
| 55–59 | C5 | Fairly Good |
| 50–54 | C6 | Fairly Good |
| 45–49 | D7 | Weak |
| 40–44 | E8 | Very Weak |
| 0–39 | F9 | Fail |

**Footer Block:** Form Master's Remark | Administration's Comment | Principal's Comment | Next Term Fee | Next Term Begins | Principal's Signature line

Export format: PDF only. Bulk generation: all selected slips bundled into one PDF.

### 13.2 Broadsheet

Per class, term, and session. Columns: Student Name + all subject Totals + Final Average + Grade + Position. Export: PDF and Excel.

---

## 14. Session & Archive Management

All data tagged with Session and Term — accumulates as rows, never cleared. Historical results always accessible.

**Assignment carry-forward:** At term/session start, system detects missing assignments and prompts Admin to confirm carry-forward from previous period. Unchanged assignments copied with one confirmation. Score entry blocked until confirmed.

**Archive:** Admin triggers Archive Session at end of any session. Read-only timestamped backup created for Scores, PSQ, and Remarks. Main sheets continue accumulating for the new session.

---

## 15. Hosting & Technical Stack

| Component | Choice |
|-----------|--------|
| Platform | Google Apps Script |
| Database | Google Sheets (10 data sheets + 1 Subjects Reference tab) |
| Authentication | Username/password — credentials stored in Users sheet (SHA-256 hashed); no Google Sign-In |
| Hosting | Google Apps Script Web App |
| Student Data Source | External Google Sheet — tabs containing "StudentData" in the name |
| Class List Source | External Google Sheet — class list tab, filtered to JSS/SSS |
| Subject List Source | Subjects Reference tab within the result system spreadsheet |

### 15.1 Power BI Integration

Read-only API endpoints exposed by the Apps Script web app. Power BI connects via the Web connector.

| Endpoint | Returns |
|----------|---------|
| `/api/scores` | All score records — StudentID, Class, Subject, Term, Session, Component, Score |
| `/api/students` | Student cache — StudentID, Name, Class, Session |
| `/api/psq` | PSQ ratings per student per term |
| `/api/staff` | Active staff list |

All endpoints return fully denormalised records with every dimension baked in. The endpoint contract mirrors a future REST API — Power BI dashboards need only a base URL change when the backend migrates.

---

## 16. Architecture & Migration Path

### 16.1 Current Architecture

```
Browser (phone / laptop)
        ↕ HTTPS
Google Apps Script Web App
        ├── UI Layer       → HTML / CSS / JS pages
        ├── Logic Layer    → Business rules (grading, locks, position, CLASS MAX)
        └── Data Layer     → Service functions — only code that reads/writes sheets
                                    ↕
                     Result system spreadsheet (10 data sheets + Subjects Reference tab)
                                    ↕
                     External student data spreadsheet (StudentData tabs + class list tab)
```

### 16.2 Design Principles for Clean Migration

- **Data layer isolation:** All sheet reads/writes through named service functions. Rewrite only the service layer to migrate.
- **Schema as a real database:** Typed columns, explicit foreign keys (Staff ID, Class ID, Subject ID), no formula columns stored as data.
- **Business logic in pure functions:** Grade calculation, position ranking, lock checks — database-agnostic, no changes needed on migration.
- **API-first data contract:** Power BI endpoints define the future REST API shape.

### 16.3 Migration Path

| Phase | Stack | Trigger |
|-------|-------|---------|
| 1 (Current) | Apps Script + Google Sheets | Launch and pilot |
| 2 | Node.js or Python + Supabase (PostgreSQL) | Volume or concurrency exceeds Sheets limits |
| 3 | Same backend + React / Next.js frontend | UI complexity outgrows Apps Script serving |

---

## 17. Future Enhancements

- **Result Locking** — Admin locks a class/term; only Admin can unlock
- **Admin Analytics Dashboard** — school-wide performance metrics within the app
- **Attendance Tracking** — dedicated module beyond the ATT score component
- **Principal / Administration Comment Entry** — digital entry of footer block comments
- **Expansion to Primary and Nursery arms** — after JSS/SSS pilot validated
- **Push Notifications** — alert Form Masters when all subject scores for their class are complete

---

*Document prepared based on PRD originally shared by mojolaoluwafavour@gmail.com.*
*Refined through stakeholder Q&A sessions — all gaps resolved.*
*Version 5.0 incorporates: confirmed JSS class structure (no arms — JSS 1/2/3 only), 12-class scope, subject sync from internal Subjects Reference tab with category-to-department mapping, class sync from external sheet, pull-on-open student caching with manual refresh, three-value Student Term Status (Active/Exam Exempt/Not Continuing), broadsheet and result generation lock rules, Form Master Manage Class List screen, active session/term displayed once at top of every screen, Form Master home screen layout matching Subject Teacher greeting pattern, score entry input width fix.*
*Version 5.1 incorporates: authentication changed from Google Sign-In to username/password; Users sheet updated with Username, Password Hash, and Force Password Change columns; Admin-only account creation and password reset flows documented; Change Password (Screen 1A) added; login flow updated; login error messages specified; username uniqueness validation added; edge cases for first login, forgotten passwords, and username collisions added.*
*Version 5.2 incorporates: Super Admin bootstrap clarified — developer sets 4 columns only (Staff ID, Username, Role = Super Admin, Force Password Change = TRUE), blank Password Hash triggers Change Password gate on first login; role assignment moved from dedicated Manage Admins screen to User List (Super Admin promotes/demotes from any user's profile); voluntary password change added for all users via avatar menu; Add User screen (Screen 15), Edit User screen (Screen 16), and voluntary Change Password screen (Screen 17) formally specified; Admin Panel tile renamed to User List; Flows 12–14 added; edge cases expanded for blank-hash bootstrap, wrong current password on voluntary change, and role change during active session.*
