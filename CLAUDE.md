# Modcraft App — Project Context for Claude

## What this project is
A single-file HTML quotation management app for **World Class Laminate, Inc. / RTMO Digital School** (interior fit-out / modular furniture company based in the Philippines). No server — the entire app is one file (`index.html`) deployed on **GitHub Pages** and embedded in a **Google Site**. All data persists in **Google Sheets** and **Google Drive** via the Google Sheets API and Drive API using OAuth 2.0.

## Live URLs
- **GitHub repo:** https://github.com/rotaligatos/modcraft-app
- **Live app (GitHub Pages):** https://rotaligatos.github.io/modcraft-app/
- **Google Sheets database:** https://docs.google.com/spreadsheets/d/1Rs79K8wX27lxVRddksNlYwdyesTCOjIhHCqH0jRMV-o
- **Google Drive folder:** The app creates "Modcraft Quotations" in the signed-in user's personal My Drive (NOT the old hardcoded folder `1hK4iox_XmAFWOD-mMGjpEHBENOxJneeB` which was the original broken approach)

## Key files
- `index.html` — the entire app (HTML + CSS + JS, ~12600 lines)
- `server.ps1` — local PowerShell static server (port 8765, serves `quotation_app.html`)
- `preview_server.ps1` — preview server for Claude testing (port 8766, serves `index.html`)
- `.claude/launch.json` — launch configs for both servers
- `WCLI SKU Items with SRP.xlsx` — product price data for import

## Google Sheets structure (SHEETS_ID = `1Rs79K8wX27lxVRddksNlYwdyesTCOjIhHCqH0jRMV-o`)
| Tab | Purpose |
|-----|---------|
| `Quotations` | Index of all quotations (serial, date, client, status, total, etc.) |
| `Quotation State` | Full editable state JSON per quotation, chunked across 10 columns (B–K, 45k chars each) |
| `Clients` | Client directory (name, biz name, contact, segment, etc.) |
| `Settings` | App config — one CONFIG row with JSON for cost factors + scheduling + terms |
| `User Roles` | User email → role + company assignment |
| `Activity log` | Audit trail |
| `Quotation Items` | Line items detail |
| `Pending Orders` | Wufoo form submissions — 27 columns from ID to Source Company; written by Google Apps Script webhook |

## Google Drive structure (Shared/Team Drive under wcli-it-admin)
- **Shared folder ID:** `1hK4iox_XmAFWOD-mMGjpEHBENOxJneeB` (Team Drive — all users have Editor access)
- Stored in Settings sheet as `sharedDriveFolderId` and loaded at login for all users
- All Drive API calls use `supportsAllDrives=true` (required for Team Drive folders — missing this causes "File not found" errors on writes)
```
Modcraft Quotations/          ← Team Drive folder under wcli-it-admin
  QT-260601-4083/             ← one subfolder per quotation serial
    QT-260601-4083 — Client — state.json     ← full data backup
    QT-260601-4083 — Client — Draft.html
    QT-260601-4083 — Client — Final Quotation.html
  QT-260602-9378/
    ...
```

## Google OAuth
- **Client ID:** `605710112392-vgvmr9e66b8himis6ka118cdq5er6393.apps.googleusercontent.com`
- **Scopes:** `spreadsheets`, `drive`, `userinfo.email`, `userinfo.profile`
- **Token expiry:** tracked via `gTokenExpiry`; auto-refreshed silently via `gRefreshToken()` using `prompt:''`
- **In iframe (Google Sites):** popup sign-in works; silent refresh does NOT (browsers block it in iframes); when token expires inside embed, the session-expired banner appears and user re-auths via popup

## Architecture decisions (WHY things are the way they are)

### Why state is in Sheets, not Drive
Original code saved quotation state as JSON files to a hardcoded Drive folder. This failed silently because:
1. The folder belonged to a different account (users couldn't write to it)
2. Drive API requires more auth complexity than Sheets
Solution: `saveQuotationJson()` now saves to the `Quotation State` sheet tab (primary), with a Drive backup in the per-quotation subfolder (secondary/nice-to-have).

### Why tokens auto-refresh
Google OAuth tokens expire after ~1 hour. Without refresh, saves silently hit 401 errors that the old code treated as success — data appeared to save but nothing was written. The `gApiFetch()` wrapper handles this transparently.

### Why demo data was removed from failure paths
`gLoadClients()` and the Projects directory previously fell back to demo/sample data whenever a read failed. This made it look like "all my saved data is gone" when really the read had just failed due to an expired token.

## Critical variables (globals in index.html)
```javascript
// ── Auth ──────────────────────────────────────────────────────────────────
SHEETS_ID            // main Google Sheets file ID
PRICE_DB_ID          // price database Google Sheets file ID
GOOG_CLIENT_ID       // OAuth client ID
gToken               // current access token (null if not signed in)
gTokenExpiry         // epoch ms when token expires (set from expires_in - 120s)
gTokenClient         // Google Identity Services token client object
gRefreshPromise      // in-flight silent token refresh promise
gSessionExpired      // true once refresh failed; banner is shown
gDriveFolderId       // cached "Modcraft Quotations" root folder ID
gDriveFolderPromise  // in-flight root folder create (race guard)
gQuotFolderCache     // { serial: folderId }
gQuotFolderPromise   // { serial: Promise } — in-flight subfolder creates

// ── User/session ──────────────────────────────────────────────────────────
gUser                // { email, name, picture }
currentRole          // 'Admin'|'Manager'|'Supervisor'|'Approver'|'Encoder'|'Staff'|'Viewer'
currentUserCompany   // one of COMPANIES[]
currentUserAcc       // { Dashboard, KPI, Reports, ... } feature access flags
currentDelegateTo    // email of delegate (if delegation enabled)
deviceBindingEnabled // loaded from User Roles header row col O

// ── Quotation state ──────────────────────────────────────────────────────
qSerial              // current quotation serial e.g. 'QT-260601-4083'
qBaseSerial          // base serial without option suffix (empty if no active option)
qActiveOptionId      // 0 = no active option, else option id
qOptionsList         // [{id, label, snapshot, status, grand}]
qStage               // 1 = Initial, 2 = Final Quotation
qLocked              // true once Stage 1 is locked
qApproved            // true once an option is approved for Stage 2
qSaved               // true once Save Draft clicked (gates Lock & Send)
qAreas               // [{name, items[], svcItems[], matItems[], hwItems[], bomItems[]}]
qLog                 // activity log entries for this quotation
_pCalc               // cached recalc result — {grand, fab, inst, mob, ...}
CF                   // global cost factors object
MOB_LOCATIONS        // mobilization cost by location array
fqLocked/fqSentStatus/fqInitialized  // Stage 2 equivalents

// ── Data ──────────────────────────────────────────────────────────────────
liveClients          // loaded from Clients sheet; never replaced with demo on error
dirData              // loaded from Quotations sheet; never replaced with demo on error
sessionQuotations    // { serial: entry } — in-memory cache for current session saves
dbServices/dbMaterials/dbHardware/dbTemplates  // price DB catalog arrays
prodSettings         // { claudeKey, kerf, aiEnabled, mobAiEnabled, cabinetRules, ... } saved to localStorage
dirSelected          // { serial: true } — checked quotation rows for bulk delete (Admin)
clientSelected       // { id: true } — checked client rows for bulk delete (Admin)

// ── UI ────────────────────────────────────────────────────────────────────
COMPANIES            // ['World Class Laminate, Inc.', 'Module Systems...', 'Cebu World...']
PH_HOL               // array of Philippine holiday date strings (YYYY-MM-DD)
```

## Key functions to know
```javascript
gApiFetch(url, opts)           // auth-aware fetch: auto-refreshes token, retries on 401
gRefreshToken()                // silent token refresh (prompt:'')
gOnSessionExpired()            // shows the red "session expired" banner
ensureDriveFolder()            // finds/creates "Modcraft Quotations" in user's My Drive
ensureQuotationFolder(s, pid)  // finds/creates QT-XXXXXX-XXXX subfolder
saveQuotationJson(cb)          // saves state to Quotation State sheet + Drive backup
loadQuotationJson(serial, cb)  // loads state from Quotation State sheet
gSaveAppSettings()             // saves CF + MOB_LOCATIONS + scheduling/terms to Settings tab
gLoadAppSettings(cb)           // restores settings from Settings tab (called at login)
verifyDatabaseConnection()     // checks Quotations, Clients, Quotation State tabs
setupMissingSheetTabs()        // creates missing sheet tabs with correct headers

// ── Admin delete helpers ───────────────────────────────────────────────────
sheetsDeleteRowByKey(sheetName, keyVal, cb)  // finds row by col-A key, gets sheetId, issues deleteDimension batchUpdate
deleteQuotation(serial)        // Admin: confirm → remove from memory + delete from Quotations & Quotation State sheets
deleteClient(id)               // Admin: confirm → remove from liveClients + delete from Clients sheet
deleteSelectedQuotations()     // Admin: bulk delete all dirSelected serials
deleteSelectedClients()        // Admin: bulk delete all clientSelected ids
toggleDirSelect(serial,chk)    // toggle checkbox selection for one quotation row
selectAllDir(checked)          // select/deselect all visible quotation rows
_updateDirDeleteBtn()          // sync delete-selected button count + select-all indeterminate state
toggleClientSelect(id,chk)     // toggle checkbox selection for one client row
selectAllClients(checked)      // select/deselect all visible client rows
_updateClientDeleteBtn()       // sync delete-selected button count + select-all indeterminate state

// ── Mobility planner ──────────────────────────────────────────────────────
_defaultMobilityOrigin()       // returns origin address based on quotation company (getCompanyName())
computeTransportation()        // AI call for transportation estimate only; sets mobilityState.transportResult
computeAccommodation()         // AI call for accommodation search only; sets mobilityState.accumResult
_mobCallClaude(prompt, cb)     // shared Claude API fetch helper for mobility (reuses prodSettings.claudeKey)
_buildResultBlock(result)      // renders a single AI result block (used by both transport + accom)
```

## Serial number format
`QT-YYMMDD-RRRR` where RRRR is a 4-digit random number.
Option serials: `QT-YYMMDD-RRRR-N` (N = option number 1, 2, ...).
The dedup regex is `/^(QT-\d{6}-\d{4})/` — extracts the base serial, stripping the option suffix but NOT the 4-digit random part (old bug: `/-\d+$/` stripped it all, collapsing same-date quotations).

## Companies supported
```javascript
var COMPANIES = [
  'World Class Laminate, Inc.',
  'Module Systems and Services, Inc.',
  'Cebu World Laminate, Inc.'
];
```
Each user is assigned a company in the `User Roles` sheet (column D). The quotation print header reflects the user's assigned company. Each company can have its own logo uploaded.

## User roles
Admin → Manager → Supervisor → Approver → Encoder → Staff → Viewer
- Certain actions require a **Manager or Supervisor PIN**: non-VAT treatment, revision of approved quotation, unlock, holiday premium override, custom cost factor override
- **Device binding** (optional, toggled in Settings → Security): users can be restricted to a registered device ID
- **Approval delegation**: a user can delegate approvals to another user
- Feature access (`ACC_KEYS`): `Dashboard`, `KPI`, `Reports`, `Profit/Revenue`, `Quotations`, `Analytics`, `Approvals`, `Schedule` — each toggleable per user in the Users sheet

## Full feature list (built across all sessions)

### Quotation page (Stage 1 & Stage 2)
- **Two-stage workflow:** Stage 1 = Initial Quotation, Stage 2 = Final Quotation
- **Two pricing modes per area:** Services mode (select from service catalog) vs BOM/Cutting-list mode (full Bill of Materials)
- **Areas:** multiple areas per quotation, each with its own line items
- **Quotation options/variants:** multiple options per quotation (e.g. Option 1: Laminate, Option 2: Solid Surface); each option has its own snapshot; one can be "approved" for Stage 2
- **Cost components:** fabrication, installation, assembly, mobilization (by location), bond & insurance, site visit fee, cutting list charge, design charge, QA/QC
- **VAT treatment:** default 12% inclusive; Non-VAT requires Manager/Supervisor PIN approval; logged
- **Discount:** requires Manager/Supervisor PIN
- **Holiday/weekend premium:** auto-detected from PH holiday list; requires PIN to approve
- **Custom cost factor override:** per-quotation override of the global CF rates (requires Supervisor/Manager)
- **Lock & Send:** Stage 1 locked quotation → generates PDF/HTML, can email client; Stage 2 same
- **Revision:** approved quotation can be revised (requires PIN); new serial created, old marked superseded
- **Quotation serial** tracks `Revised from: QT-XXXXXX` if applicable
- **Client section:** linked client (B2B/B2C), business name, contact, address, service type
- **Print/PDF:** html2pdf.js for PDF download; by-area and by-item layouts; company logo in header

### BOM / Cutting-list mode
- **Cabinet types:** 13 types with templates (materials, hardware, services pre-filled from price DB)
- **Materials, Hardware, Services, Outsource** sections per BOM item
- **Price database dropdowns:** live lookup from the Price Database Google Sheet
- **EBT (Edge Banding Type):** codes like `4s`, `1s`, `2s` define which edges get banding; auto-calculates linear metres; deduct thickness configurable
- **Outsource markup, contingency, buffer** rates separate from standard CF

### Price Database (Settings → Price Database tab)
- **Separate Google Sheet** (`PRICE_DB_ID = '1t7ND6N6uwJtkm7VWziUUf7gbqcn_sOXHhde0ZFeqVpY'`)
- Tabs: `Services`, `Materials`, `Hardware`, `CabinetTemplates`
- Import from Excel; initialize with defaults
- Cabinet template rows load automatically when BOM cabinet type changes

### Designers Support (Production AI page)
- Upload shop drawings / cutting lists → Claude AI extracts components, services, BOM
- **Claude API key** stored in Google Sheets `User Roles` sheet header row column R (shared across all users); setup guide hidden in Settings once key is configured
- Per-area grouping; editable reflect summary; "Reflect to quotation" pushes AI result into quotation
- EBT legend and cabinet rules configurable in Settings → Designers Support
- `prodSettings` object (saved to `localStorage` as `mc_prod`): `claudeKey`, `kerf`, `aiEnabled`, `mobAiEnabled`, `shopDrawing`, `cabinetRules`
- **Mobility & Accommodation Planner** (separate tab):
  - Three cards: **Shared header** (origin/destination), **Transportation**, **Accommodation**
  - **Transportation card**: workers, days on site, vehicle → `computeTransportation()` AI call
  - **Accommodation card**: nights, budget/night, min star rating (1–5★), max distance from site (km), food accessibility → `computeAccommodation()` AI call
  - Two independent AI calls with separate loading states, results, and Clear buttons
  - **AI ON/OFF toggle** in planner header — Admin sees click-to-toggle button; non-admins see status badge; `mobAiEnabled` saved to localStorage
  - **Origin auto-fills** from quotation company via `_defaultMobilityOrigin()` → `getCompanyName()` (not user's company):
    - WCL: `88 Jennys Ave., Pasig City, Metro Manila, Philippines`
    - MSSI: `88 Jennys Ave., Pasig City, Metro Manila, Philippines`
    - CWL: `Tawagan St., Tayud, Consolacion, Cebu, Philippines`
  - **Destination** auto-filled from quotation's `cl-location` field; date hint shows install/fab date for airfare

### Clients page
- Full client directory loaded from `Clients` Sheets tab
- **B2B segments:** General Contractors, Architects & Interior Designers, Real Estate Developers, Commercial, Hotels & Hospitality
- **B2C segments:** Homeowners, Condo Owners, First-time Homebuyers
- Client search/autocomplete on quotation form; auto-creates client record from quotation info
- Transaction history per client (pulled from Quotations tab)
- **Rows are clickable** — clicking a row opens the client detail modal (View button removed)
- **Admin bulk delete** — checkbox column (Admin only); select-all in header; "Delete selected (N)" button in sticky header; deletes from `liveClients` + `Clients` sheet

### Schedule page
- Gantt chart (full year) and Calendar (month) views
- Philippine holidays highlighted in red
- Fabrication and installation dates with workday calculations

### Reports page
- Dashboard KPIs: total revenue, active quotations, conversion rate, etc.
- Analytics: by segment, by status, by month, by agent
- Custom Report Export: Excel (.xlsx) and PowerPoint (.pptx) via SheetJS / PptxGenJS

### Users page (Admin only)
- Full CRUD against `User Roles` Sheets tab
- Assign role, company, active status, device ID, feature access, delegation
- Device binding: enforce user must sign in from registered device

### Settings page sub-tabs
| Sub-tab | What it controls |
|---------|-----------------|
| Company & DB | Company branding, DB connection test, "Create missing tabs" |
| Network & Deployment | LAN/ngrok/GitHub Pages/VPN setup guide |
| Security | Device binding toggle |
| Scheduling | Fab units/day, install teams/day, holiday premium % |
| Cost factors | All CF rates (markup, buffer, VAT, contingencies, labor, etc.) + MOB_LOCATIONS |
| Validity & Terms | Quotation validity days, payment terms text, T&C text |
| Carcass pricing | Per-unit carcass cost table |
| Services | Labor service catalog |
| Price Database | Connect/initialize the Price DB Google Sheet |
| Designers Support | Claude API key (hidden guide if key set), kerf, EBT/cabinet rules, Mobility AI on/off toggle |

### Project List (directory) — Admin features
- **Sticky header** — title, Columns button, New Quotation button, filters freeze at `top:52px` while table scrolls
- **Clickable rows** — clicking a row opens that quotation
- **Checkbox bulk delete (Admin only)** — checkbox column + select-all in header; "Delete selected (N)" button in filter bar; deletes from memory + `Quotations` and `Quotation State` sheets simultaneously; selections cleared on page navigation
- **`sheetsDeleteRowByKey(sheetName, keyVal, cb)`** — shared helper: reads col A to find row index, fetches sheetId via metadata API, issues `deleteDimension` batchUpdate

### Notifications system
- In-app notifications (`NOTIFS` array) for: client updates, approvals, follow-up alerts
- Quotation lifecycle: Active (0–25d) → Follow-up alert (day 25) → Inactive (day 30) → Archived (day 35)

### AI Help chat
- Built-in help chatbot on the Help tab with hardcoded Q&A for common workflows

## Settings persistence
Settings are saved when the user clicks **"Save settings"** in the Settings page header.
They are loaded automatically at login (`gShowApp()` → `gLoadAppSettings()`).
Covers: CF (all cost factors), MOB_LOCATIONS, scheduling fields, validity, payment terms, T&C.

## What was built in the earlier "Quotation-app" session (session local_e47522e1)
These were all built before the current session — do NOT re-implement or overwrite:
1. **Core quotation form** — areas, items, qty, cost calculations, two-stage workflow
2. **BOM/Cutting-list mode** — cabinet types, materials/hardware/services/outsource per item, price DB dropdowns
3. **EBT (Edge Banding Type)** — code system (`4s`, `1s`, `2s`, etc.), LM calculation, deduct logic
14. **Price Database** — separate Google Sheet, import from Excel, initialize with defaults
5. **Cost factors (CF)** — markup, buffer, VAT, contingencies, labor cost, capacity, etc.
6. **Mobilization costs (MOB_LOCATIONS)** — by location, workers × days calculation
7. **Quotation options/variants** — multiple options per quotation, snapshot on lock
8. **Lock & Send** — Stage 1 and Stage 2 lock, PDF via html2pdf.js, email workflow
9. **Revision workflow** — PIN-gated, new serial, tracks `qRevisedFrom`
10. **Designers Support (Production AI)** — Claude API, shop drawing upload, reflect to quotation
11. **Users page** — Google Sheets CRUD, role assignment, device binding, feature access, delegation
12. **Client directory** — B2B/B2C segments, autocomplete, transaction history
13. **Schedule** — Gantt + Calendar, PH holidays, workday calculations
14. **Reports** — KPIs, analytics, Excel + PowerPoint export
15. **Google Login + Sheets integration** — OAuth, role check, company assignment
16. **PIN approval modals** — Manager/Supervisor PIN for VAT, unlock, revision, premium
17. **Notifications system** — quotation lifecycle alerts, follow-up reminders
18. **Multi-company support** — per-user company, per-company logos, header branding
19. **AI Help chat** — hardcoded Q&A in Help tab
20. **Network & Deployment guide** — LAN/ngrok/GitHub Pages instructions in Settings

## What was fixed in the session that created this file
1. **Project list dedup bug** — same-date quotations all collapsed into one entry
2. **Clients tab auto-creation** — `gSaveClient` now creates the tab if it doesn't exist
3. **Quotation State tab** — replaced Drive JSON saves with Sheets-based chunked storage
4. **Token expiry** — `gApiFetch` auto-refreshes, session banner on failure
5. **Demo data masking** — failed reads no longer replace real data with demo
6. **Settings persistence** — CF + terms now saved to/loaded from Sheets
7. **Google Sites embed** — popup OAuth works inside the iframe; fallback to new tab if popup blocked
8. **Drive folder structure** — per-quotation subfolders with HTML + JSON backup
9. **Race condition** — in-flight promise guards on folder creation
10. **False "Database save failed" on lock** — was Drive HTML save failing; now silent (data in Sheets is safe)

## What was changed on 2026-06-03
1. **Quotation preview print buttons** — removed the separate "Download PDF" and "Print" buttons from the top toolbar; replaced with a single "Print / Save PDF" button (navy, same as the old bottom button)
2. **Removed bottom Print/Save PDF button** — the duplicate button at the bottom of the preview body HTML was removed; only the top toolbar button remains
3. **+ New quotation button moved** — removed from Dashboard; now lives in the Quotation page top bar (next to serial/status tags)
4. **Project List rows clickable** — clicking any row opens that quotation; redundant "Open/View" button removed; star and New Option buttons stop propagation
5. **Stage 1 form locked when quotation is locked** — `updateLockUI()` now disables all inputs/selects/textareas and buttons inside `#s1-wrap` when `qLocked=true`; CSS class `q-locked` applied; exempt buttons: Preview & Print (`data-lock-exempt`), Approve, Send, Request Unlock, Close Project
6. **Quotation sticky header** — company banner + Stage 1/2 nav bar + options bar wrapped in `#q-sticky-header` (`position:sticky;top:52px;z-index:99`) so they freeze below the topbar when scrolling (was `top:0` which caused it to scroll under the topbar — fixed 2026-06-06)
7. **Project List: resizable columns** — drag right edge of any column header to resize; widths saved to `localStorage` key `mc_dir_col_widths`; uses `startColResize` / `_onColResizeMove` / `_onColResizeUp` handlers
8. **Project List: Created column format** — now stores and displays full ISO datetime, rendered as `mm/dd/yy HH:MM` via new `fmtDT(s)` helper
9. **Project List: 4 new timestamp columns** — off by default, toggleable in Columns panel: Initial Locked, Initial Approved, Final Locked, Final Approved
10. **Quotations sheet extended to A:Q** — columns N–Q store lifecycle timestamps; written automatically at lock/approve/close events; `gSaveQuotation()` and directory loader updated accordingly

## What was changed on 2026-06-04
1. **Print/Save PDF — iframe fix** — detects Google Sites iframe; opens quotation in new tab and auto-triggers `window.print()` there instead of being blocked
2. **Send via email — opens Outlook/email client** — `confirmSend("email")` removed auto-PDF-download; now just opens mailto link directly
3. **Send via email — opens Gmail in browser** — changed from `mailto:` to Gmail compose URL (`https://mail.google.com/mail/?view=cm...`); downloads PDF first then opens Gmail
4. **Followed quotations dashboard bug** — `renderDashFollowed()` was reading from `DEMO_PROJS` instead of real `dirData`+`sessionQuotations`; fixed; stars now update dashboard instantly
5. **Followed quotations persistence** — `qFollowed` now saved per-user to Google Sheets Settings tab (`FOLLOWED_<email>` key) instead of localStorage; loaded on login
6. **✓ Verified badge not clearing** — `cl-linked-badge` now hidden when starting a new quotation
7. **Auto PDF download on Send** — removed unintended html2pdf download triggered by `confirmSend("email")`
8. **Send → Email flow** — generates PDF via `_buildPdfBlob()` helper, downloads it, then opens email client with subject/body pre-filled
9. **Blank PDF bug (in progress)** — html2canvas captures blank when element is off-screen or inside hidden modal; multiple approaches tried: onclone fix, temp div off-screen, string input, visible viewport div with overlay
10. **Send replaced with Share** — `send-btn` now calls `doShare()`; opens `ov-share` modal with: native Web Share API, email (mailto), WhatsApp, Viber, copy to clipboard; each logs activity and updates sent status
11. **Remove option button** — each active option pill in the options bar now has an × button; approved options cannot be removed; if last option removed, reverts to base quotation state
12. **Option version tag on printout** — when printing with an active option (e.g. Option 2), a navy badge appears next to the Quotation # in the print header
13. **Print preview option selector** — when multiple options exist, a blue bar appears in the print modal with pill buttons to switch which option to preview/print; updates content instantly
14. **Site Mobility & Accommodation Planner** — new tab in Designers Support ("Mobility & Accommodation"); inputs: origin, destination (auto-filled from quotation), workers, days, nights, vehicle, budget/night; calls Claude API to estimate transportation (land/air/ferry), accommodation (sorted by proximity, rated, breakfast flagged), and grand total
15. **Airfare included in mobility planner** — reads installation date (`inst-date`) or fabrication date (`fab-date`) from quotation; passes to Claude for date-specific airfare estimation; shows hint if no date set
16. **Designers Support tabs** — page now has two tabs: "Shop Drawing Analysis" (existing) and "Mobility & Accommodation" (new planner); tab state tracked in `prodTab` variable
17. **Nav tab reordering** — Projects moved between Quotation and Clients; Designers Support moved after Schedule; Users moved after Settings

## What was changed on 2026-06-05

### Bug fixes
1. **Login "not registered" for existing user** — `gCheckRole` was not trimming whitespace from emails read out of the User Roles sheet; added `.trim()` to `rowEmail` comparison so manually-entered emails with trailing spaces no longer fail
2. **Login 403 silent failure** — `gApiFetch` returns `{error:{code:403}}` JSON (not a thrown error) when a user's Google account doesn't have read access to the Sheets database; `gCheckRole` now detects `data.error` before looping and shows a clear "Cannot read the Sheets database — ask Admin to share the spreadsheet" message instead of the misleading "not registered" message
3. **Users page blank after commit** — accidentally committed an `st-users` Settings sub-tab block that had duplicate `id="users-wrap"` and `id="add-user-form-wrap"`; `document.getElementById` found the hidden duplicates first, so `loadUsersFromSheet` rendered into an invisible div; removed the duplicate block
4. **Google Sites cache** — after pushing a fix, the Google Site embed serves the stale cached version; workaround: in Google Sites edit mode, append `?v=N` (increment N) to the embed URL and republish
5. **JS syntax error (Stage 2 premium)** — `replace_all` substitution put unescaped `'fq'` inside a single-quoted JS string literal, breaking the entire script and preventing login; fixed by escaping to `\'fq\'`

### Feature access system (13 keys, nav enforcement)
6. **ACC_KEYS expanded from 8 → 13** — added `Projects`, `Clients`, `Designers Support`, `Settings`, `Users`
   - Column layout: old 8 keys at sheet cols G–N (indices 6–13), delegation unchanged at O–Q (14–16), new 5 keys at R–V (17–21)
   - All sheet ranges extended from `A:Q` → `A:V`
7. **Role defaults updated** — `getDefaultAcc()` defines per-role defaults for all 13 keys; Admin gets all, Manager gets all except Users, Supervisor no Settings/Users, Staff no DS/Reports/KPI/Settings/Users
8. **Nav tab enforcement** — `applyNavAccess()` called at login; hides nav buttons based on `currentUserAcc`; Users tab is code-enforced Admin-only regardless of checkbox; `canNavigate()` guards `navigate()` and shows a toast on blocked access
9. **Quotations → Projects rule** — checking Quotations auto-checks Projects (via `onchange`); unchecking Projects auto-unchecks Quotations; enforced in both edit-user and add-user forms, and in `applyDefaultAccess()`
10. **Projects-only = view-only mode** — `isViewOnly()` returns true when Projects is ON and Quotations is OFF; `updateLockUI()` applies the locked CSS and disables all form inputs/buttons; Lock and Send buttons are hidden; New Quotation button is hidden
11. **Admin-only user controls** — Save changes / Deactivate / Remove buttons in Users page only render when `currentRole==='Admin'`; feature access checkboxes are disabled (greyed) for non-Admins
12. **Error message fix** — 403 from Sheets API no longer silently shows "not registered"; now shows clear message to ask Admin to share the spreadsheet

### Customizable dashboard
13. **Two-tier dashboard widget system** — 5 toggleable widgets: KPI summary, Revenue chart, Project pipeline, Team performance, Followed quotations; each gated by existing feature access keys
14. **User preference** — Customize button visible to all users; widget toggles saved per-user to Settings sheet as `DASHPREF_<email>`; loaded at login and on every Dashboard visit
15. **Admin/Manager widget restrictions** — "Manage users" tab in Customize panel; select a user, toggle which widgets they can see; saved as `DASHALLOW_<email>` in Settings sheet; widget visible only if: `featureAccess AND NOT adminRestricted AND userPreference`; restricted widgets show greyed with 🔒 in user's Customize panel
16. **Dashboard reload on navigate** — `navigate('dashboard')` now calls `gLoadDashPref()` then re-renders so admin changes take effect on the user's next Dashboard visit (no re-login needed)
17. **Chart/pipeline split** — `dash-chart-card` and `dash-pipeline-card` given separate IDs; shown/hidden independently; grid columns adjust dynamically

### Approval request workflow
18. **`ov-send-request` confirmation popup** — new modal for non-Manager/Admin users; shows request type, quotation serial, client, what will change, optional note field, who the request will be routed to (respects delegation settings); "Send request" button creates the request
19. **Role routing** — `isApprover()` returns true for Manager/Admin; approvers go directly to PIN modal (existing behavior); all other roles get the send-request popup
20. **Request persistence** — requests saved to Settings sheet as `APPREQ_<id>` (key + JSON + timestamp); `gLoadApprovalRequests()` reads all APPREQ_ entries at Approvals page open and at login, merging into `NOTIFS`
21. **Routing intelligence** — `findApprover()` checks for active delegation first, then falls back to first active Manager/Admin in same company; shown in the send-request popup
22. **Duplicate prevention** — blocks sending a second pending request of the same type for the same serial; shows toast
23. **Pending badge on quotation form** — after sending a request, the relevant button shows 🕐 "Pending approval"; disabled to prevent duplicate submits
24. **Approvals page persistence** — `doApprovalAction()` now saves approve/reject/counter back to the APPREQ_ row in Settings sheet; `_applyApprovedRequest()` applies the approved value to the quotation form if it is currently open
25. **CF override modal** — non-approvers see the CF value inputs as normal but the PIN section is replaced with a "Send request" button; `ccf-pin-wrap` / `ccf-send-wrap` toggled by `isApprover()` in `openCustomCF()`

### Settings sheet — new per-user keys
The Settings sheet now stores additional per-user data beyond CONFIG and FOLLOWED_:
| Key pattern | Stores |
|------------|--------|
| `FOLLOWED_<email>` | Starred quotation IDs (existing) |
| `DASHPREF_<email>` | User's own dashboard widget toggle preferences |
| `DASHALLOW_<email>` | Admin/Manager-set widget restrictions for that user |
| `APPREQ_<id>` | Approval request (nonvat / discount / override / premium) with status |

## What was changed on 2026-06-05 (session 2 — notification & counter-offer fixes)

### Approval status & notification bugs fixed
1. **`fromEmail` missing from NOTIFS push** — `submitApprovalRequest()` pushed to `NOTIFS` without `fromEmail`; this caused `filterApprovalsByRouting` to never include the requester's own requests in `ownRequests`, and the poll timer's status-change toast never fired. Fixed by adding `fromEmail: req.fromEmail` to the `NOTIFS.unshift(...)` call.
2. **`gLoadApprovalRequests` backfill** — the update path (when a NOTIF already exists by `reqId`) now also patches `fromEmail`, `note`, and `counterDisc` from Sheets data so old in-memory entries missing those fields are repaired on the next poll.
3. **Requester never notified of approval** — same root cause as #1; `ownBefore` snapshot in the poll timer was always empty because `fromEmail` was falsy. Now works correctly after the fix above.

### Notification bell dropdown panel
4. **Bell button → dropdown panel** — `onclick="navigate('approvals')"` replaced with `onclick="toggleNotifPanel(event)"`; a `#notif-panel` dropdown is now rendered inside the bell's `position:relative` wrapper.
5. **Panel contents** — shows up to 8 recent notifications filtered by `filterApprovalsByRouting`; each item has type + status pills, client · serial, sender · date, and "actioned by" line; "View all" / "Open Approvals page" buttons navigate to the Approvals page.
6. **Unread tracking** — `_seenNotifIds` object (keyed `reqId_status`) persisted to `localStorage` as `mc_seen_<email>` per user; a NOTIF is unread if its key is absent. Opened panel or Approvals page marks all visible as read via `_markNotifsRead()`.
7. **Sort order** — both `renderApprovals` and `renderNotifPanel` sort: unread first → pending → resolved, then by date descending. Unread items get an amber left border + red dot.
8. **Approver pop-up toast on new requests** — poll timer now shows a `showToast('🔔 New X request from Y — serial')` for each truly-new pending request (not in `_lastSeenReqIds`); panel auto-refreshes if already open.
9. **Initial login baseline** — on `gShowApp()`, after `gLoadApprovalRequests`, all currently-pending requests are added to `_lastSeenReqIds` so pre-existing requests don't trigger toasts on first load.

### Counter-offer flow fixed
10. **Counter discount value was lost** — `doApprovalAction` never read `appr-disc` input for `action==='countered'`; the manager's counter percentage was discarded immediately. Now captured as `counterDisc`, stored in `NOTIFS[idx].counterDisc`, and included in the `updReq` JSON saved to Sheets.
11. **Pending badge stuck after counter** — poll timer `countered` branch only showed a toast but never called `_clearPendingBadge`. The Discount button stayed "🕐 Pending" forever. Fixed: now calls `_clearPendingBadge(n.type)` then `_showCounterBadge(n.type, n)`.
12. **`_showCounterBadge(type, notif)`** — new function; for `discount` type it sets the `disc-req-btn` to "⇄ Counter X%" (amber) so the requester can see a counter was made.
13. **Accept/Decline UI for requester** — `renderApprovals` now shows two buttons on `countered` items owned by the current user: **Accept X% counter** and **Decline**. Decline calls `cancelApprovalRequest` (withdraws). Accept calls new `acceptCounter(idx)`.
14. **`acceptCounter(idx)`** — new function; applies the counter discount via `_applyApprovedRequest({type:'discount', reqDisc:counterDisc})`, shows the Approved badge, saves `status:'accepted'` to Sheets, re-renders Approvals, fires toast.
15. **`accepted` status** — new status value (requester accepted a counter-offer); displayed as "Accepted" with teal color in both `renderApprovals` and `renderNotifPanel`.
16. **Status color/label unification** — both renderers now use the same mapping: `pending`→amber, `approved`/`accepted`→teal, `countered`→amber ("Counter-offer"), `rejected`/`cancelled`→coral.

### New globals added
```javascript
_seenNotifIds   // {reqId_status: true} — unread tracking; persisted to localStorage per user
```

### New functions added
```javascript
_loadSeenNotifs()          // restores _seenNotifIds from localStorage on login
_saveSeenNotifs()          // persists _seenNotifIds to localStorage
_markNotifsRead(notifs)    // marks array of notifs as read; saves if changed
_isNotifUnread(n)          // returns true if notif key absent from _seenNotifIds
_updateNotifBadge()        // recomputes pending count and updates #notif-cnt
toggleNotifPanel(e)        // opens/closes #notif-panel dropdown
closeNotifPanel()          // hides #notif-panel, removes outside-click listener
renderNotifPanel()         // renders up to 8 items in the panel, marks as read
_showCounterBadge(type,n)  // shows "⇄ Counter X%" badge on the relevant button
acceptCounter(idx)         // requester accepts manager's counter-offer discount
```

## What was changed on 2026-06-06

### UX improvements
1. **Client directory — View button removed** — clicking any row opens the client detail modal; `openClientModal()` now looks up `liveClients` first (was only checking `DEMO_CLIENTS`); hover highlight added via `tr.cl-row:hover`
2. **Quotation sticky header fix** — changed `top:0` → `top:52px` so the client banner + Stage 1/2 nav bar freeze below the 52px topbar instead of scrolling under it
3. **Project List sticky header** — title row + filter bar wrapped in `#dir-sticky-header` (`position:sticky;top:52px`)
4. **Client directory sticky header** — title row wrapped in `#cl-sticky-header` (`position:sticky;top:52px`)
5. **Claude API key setup guide hidden** — the "How to get your Claude API key" info box in Settings → Designers Support is now only shown when no key is configured

### Admin bulk delete — Quotations
6. **Checkbox column** (Admin only) — first column in the Project List table; select-all in `<th>`; selected rows highlighted amber (`#fef3e2`)
7. **"Delete selected (N)" button** — appears in the sticky filter bar when rows are checked; one confirm dialog deletes all selected from memory + `Quotations` sheet + `Quotation State` sheet
8. **Per-row trash button** — also kept for quick single-item delete
9. **`dirSelected`** global — `{ serial: true }` tracks checked rows; cleared on navigate away
10. **New functions**: `toggleDirSelect`, `selectAllDir`, `_updateDirDeleteBtn`, `deleteSelectedQuotations`, `deleteQuotation`

### Admin bulk delete — Clients
11. **Checkbox column** (Admin only) — first column in client table; select-all in `<th>`
12. **"Delete selected (N)" button** — appears next to the Add client button when rows are checked
13. **Delete button in client modal** — "Delete client" button in the detail modal footer (Admin only)
14. **`clientSelected`** global — `{ id: true }` tracks checked rows; cleared on navigate away
15. **New functions**: `toggleClientSelect`, `selectAllClients`, `_updateClientDeleteBtn`, `deleteSelectedClients`, `deleteClient`
16. **`sheetsDeleteRowByKey(sheetName, keyVal, cb)`** — shared helper used by all delete operations; finds row by col-A key, fetches sheet's numeric ID from spreadsheet metadata, issues `deleteDimension` batchUpdate

### Mobility & Accommodation Planner overhaul
17. **Three separate cards** — Shared header (origin/destination/date hint), Transportation, Accommodation
18. **Two independent AI search buttons**:
    - `computeTransportation()` — transport-only Claude prompt; result shown inside Transportation card
    - `computeAccommodation()` — accommodation-only Claude prompt; result shown inside Accommodation card
    - `_mobCallClaude(prompt, cb)` — shared fetch helper reusing `prodSettings.claudeKey`
    - `_buildResultBlock(result)` — renders AI result block (used by both)
19. **New Accommodation fields**: min star rating (1–5★), max distance from site (km), food accessibility (No preference / Free breakfast / Near restaurants / Full board)
20. **AI ON/OFF toggle on the planner page** — Admin sees a click-to-toggle button in the planner header card; non-admins see a status badge; `mobAiEnabled` saved to `localStorage` via `saveProdSettings()`; buttons show clear hint text when disabled (AI off / no key / no destination)
21. **Company-based auto-origin** — `_defaultMobilityOrigin()` reads `getCompanyName()` from the quotation form (not `currentUserCompany`); refreshes on tab switch unless user typed a custom value:
    - WCL: `World Class Laminate, Inc., 88 Jennys Ave., Pasig City, Metro Manila, Philippines`
    - MSSI: `Module Systems and Services, Inc., 88 Jennys Ave., Pasig City, Metro Manila, Philippines`
    - CWL: `Cebu World Laminate, Inc., Tawagan St., Tayud, Consolacion, Cebu, Philippines`
22. **Mobility AI result cards** — each AI result is parsed by `<h4>` headings and rendered as separate cards (Transportation / Accommodation / Cost Summary) with matching icon and accent color

### New globals added (2026-06-06)
```javascript
dirSelected          // { serial: true } — checked quotation rows for bulk delete
clientSelected       // { id: true } — checked client rows for bulk delete
_MOB_ORIGIN_MAP      // { companyName: originAddress } — company → origin address lookup
// mobilityState additions:
mobilityState.computingTransport  // boolean — transport AI in progress
mobilityState.computingAccom      // boolean — accommodation AI in progress
mobilityState.transportResult     // { data } or { error } — transport AI result (structured JSON)
mobilityState.accumResult         // { data } or { error } — accommodation AI result (structured JSON)
mobilityState.minStars            // minimum hotel star rating (1–5, default 2)
mobilityState.maxDistKm           // max distance from site in km (default 5)
mobilityState.foodPref            // 'any'|'breakfast'|'restaurants'|'full'
mobilityState.originLat           // lat from map picker / autocomplete for origin
mobilityState.originLng           // lng from map picker / autocomplete for origin
mobilityState.destLat             // lat from map picker / autocomplete for destination
mobilityState.destLng             // lng from map picker / autocomplete for destination
// prodSettings addition:
prodSettings.mobAiEnabled         // boolean — whether mobility AI buttons are enabled (Admin toggle)
// Map picker globals:
_mapLeafletLoaded    // boolean — Leaflet.js lazy-load flag
_mapPickerInstance   // Leaflet map instance (null when closed)
_mapPickerMarker     // current draggable marker
_mapPickerSelected   // { lat, lng, address } — confirmed pick
_mapPickerOpts       // { title, inputId, latId, lngId, onConfirm } — current picker context
_locAutoTimers       // { inputId: timer } — per-field debounce timers for autocomplete
_locAutoOnSelectMap  // { inputId: fn } — registered onSelect callbacks for autocomplete
```

## What was changed on 2026-06-07 (session — Mobility planner results + Map picker)

### Mobility planner: structured JSON results
1. **`_mobCallClaude` now passes raw text** — removed `_mobilityTextToHtml` conversion inside the helper; callers parse the text themselves
2. **Transport prompt → JSON output** — prompt now instructs Claude to return structured JSON: `{mode, items:[{label,detail,qty,unit_cost,total}], grand_total, notes}`; mode is one of: `land`, `air`, `both`, `ferry`
3. **Accommodation prompt → JSON output** — prompt returns: `{options:[{name,type,address,stars,distance_km,price_per_night,guest_rating,food_note,within_budget,reason}], recommended_index, total_cost, nights, workers, notes}`
4. **`_buildResultBlock(result)` rewritten** — dispatches to `_buildTransportTable(d)` or `_buildAccomGrid(d)` based on presence of `items` vs `options` key
5. **`_buildTransportTable(d)`** — renders navy-header cost breakdown table: Item / Qty / Unit Cost / Total columns; bold grand total footer row; mode icon (🚗/✈️/⛴️) badge
6. **`_buildAccomGrid(d)`** — renders responsive card grid; each card shows type badge, name, address, star rating (gold ★), distance, guest score, within/over budget badge, price/night, food note, reason; RECOMMENDED badge on best option; total cost footer
7. **Accommodation type field added** — `type` in JSON: `hotel`, `airbnb`, `pension`, `transient`, `room_rental`, `apartelle`, `bnb`; each type gets distinct color badge (blue/pink/green/yellow/purple/sky/amber)
8. **Accommodation scope expanded** — prompt explicitly requests hotels, Airbnb, pension houses, transient houses, room rentals, apartelles, B&Bs; not just hotels
9. **Stars hidden for Airbnb/non-hotel types** — star row only renders if `o.stars > 0`

### Mock mode (AI OFF)
10. **`canSearch` logic updated** — AI OFF now enables buttons (mock mode); only truly blocked when AI ON + no API key; `canSearch = (mobOff || !noKey) && !!destVal`
11. **Hint badge updated** — when AI OFF + destination set, shows amber "🧪 Mock mode — AI is OFF" badge instead of disabling buttons
12. **`computeTransportation()` mock path** — when `mobOff`, injects realistic mock JSON (fuel/tolls/parking) after 600ms fake delay; no API call made
13. **`computeAccommodation()` mock path** — when `mobOff`, injects 5 mock options covering all types (transient → pension → Airbnb → hotel → superior) scaled to `budgetPerNight`; total_cost = rec × nights × workers
14. **Mock banner** — `_buildResultBlock` checks `result.data._mock`; if true, shows amber "Mock data — AI is OFF" banner above the result cards

### Map picker (Leaflet + OpenStreetMap + Nominatim)
15. **Zero-cost mapping stack** — Leaflet.js (CDN), OpenStreetMap tiles, Nominatim geocoding API; no API key, no account, no cost; only requirement is `© OpenStreetMap` attribution (shown in modal footer)
16. **Lazy loading** — `_loadLeaflet(cb)` injects Leaflet CSS + JS on first map open only; no impact on initial page load
17. **`openMapPicker(opts)`** — shared function used by all location fields; `opts: {title, inputId, latId, lngId, onConfirm(lat,lng,addr)}`
18. **Map picker modal (`#ov-map-picker`)** — navy header with title, search bar at top, OSM map fills the body, footer with coordinates display + Cancel + Confirm buttons
19. **Click to place pin** — clicking anywhere on map drops a marker; reverse geocodes via Nominatim; updates address, coordinates, enables Confirm button
20. **Draggable pin** — marker can be dragged to fine-tune; re-geocodes on drag end
21. **Search inside map** — `_mapSearchDebounce` + `_mapNominatimSearch` — debounced 400ms; Philippines-filtered (`countrycodes=ph`); results as clickable list; clicking pans map + places pin
22. **Inline autocomplete on location fields** — `_locAutoDebounce` + `_locNominatimSearch` — as user types in any location input, shows dropdown of Nominatim suggestions; clicking fills field + stores lat/lng silently; 450ms debounce
23. **Touch points with 📍 button**:
    - Quotation → `cl-location` field: autocomplete + 📍 → stores `cl-lat` / `cl-lng` (hidden inputs)
    - Mobility planner → `mob-origin`: autocomplete + 📍 → stores `mobilityState.originLat/Lng`
    - Mobility planner → `mob-dest`: autocomplete + 📍 → stores `mobilityState.destLat/Lng`
24. **Coordinates flow into AI prompts** — when lat/lng available, transport prompt includes `(coords: lat,lng)` for both origin and destination; accommodation prompt includes destination coords; Claude uses them for accurate distance calculation
25. **CSS classes added**: `.loc-ac-drop`, `.loc-ac-item`, `.loc-ac-wrap`, `.map-sr-item` — shared autocomplete and map search result styles

### New functions added (2026-06-07)
```javascript
_loadLeaflet(cb)                   // lazy-loads Leaflet CSS+JS from CDN; calls cb when ready
openMapPicker(opts)                // opens #ov-map-picker modal; initializes Leaflet map
_initLeafletMap(opts)              // creates Leaflet map instance, OSM tiles, click handler
_placeMapMarker(lat,lng,addr)      // places/moves draggable marker; updates coords display
_reverseGeocode(lat,lng,cb)        // Nominatim reverse geocode → readable address
_mapPickerConfirm()                // fills input fields + calls onConfirm; closes modal
closeMapPicker()                   // hides modal, destroys Leaflet instance
_mapSearchDebounce(val)            // 400ms debounce for in-modal search input
_mapNominatimSearch(q)             // Nominatim search inside map modal; renders .map-sr-item list
_mapPickResult(lat,lng,addr)       // handles result click: pan map + place marker
_locAutoDebounce(inputId,dropId,val,onSelect)  // 450ms debounce for inline field autocomplete
_locNominatimSearch(inputId,dropId,q,onSelect) // Nominatim search for inline autocomplete dropdown
_locPickResult(inputId,dropId,lat,lng,addr,onSelect) // fills field + calls onSelect on pick
_buildTransportTable(d)            // renders transport cost breakdown table from JSON data
_buildAccomGrid(d)                 // renders accommodation card grid from JSON data
```

## What was changed on 2026-06-07 (session 2 — Share modal + Message Templates)

### Share modal redesign (two-step flow)
1. **Step 1 — Download PDF button** — prominent navy button at the top of the Share modal; calls `doShareDownloadPdf()` which reuses `printQuotation()` (opens browser print dialog in new tab — reliable, iframe-safe); shows toast "PDF dialog opened — choose Save as PDF"
2. **Step 2 — Send via** — Email, Viber, WhatsApp, Native share, Copy to clipboard buttons below
3. **Viber limitation acknowledged** — `viber://forward?text=` is text-only on desktop; no browser can auto-attach files to Viber; button now shows "attach PDF manually in Viber" subtitle and fires a toast reminder after opening Viber
4. **Email** — opens `mailto:` with subject and body pre-filled from the message template; user attaches the PDF manually

### Message Templates (Settings → Message Templates)
5. **New Settings sub-tab** — "Message Templates" added between Price Database and Designers Support
6. **Two templates** — Email (formal) and Viber/WhatsApp (conversational); side-by-side editor layout
7. **Placeholders** — `{client}`, `{serial}`, `{service}`, `{total}`, `{valid_until}`, `{prepared_by}`, `{company}`; shown as reference bar at top; typed directly into the textarea
8. **Live preview** — below each editor, shows the filled-in message using current quotation data
9. **Persisted to Sheets** — `msgTemplates: { email, msg }` added to `_collectAppSettings()` and `_applyAppSettings()`; saved with the rest of app settings via Save Settings button
10. **`_shareText(type)`** — refactored; now reads the saved template and calls `_fillMsgTemplate(tpl)` to replace all placeholders; `type='email'` uses email template, everything else uses msg template
11. **Default templates** set to professional scripts:
    - Email: formal "Good day" greeting, full proposal language, "Warm regards" closing
    - Viber: warm conversational tone, concise, pipe separator in signature (`— {prepared_by} | {company}`)

### New globals added
```javascript
MSG_TPL_DEFAULTS   // { email, msg } — fallback templates if none saved
```

### New functions added
```javascript
doShareDownloadPdf()           // triggers printQuotation for PDF save before sharing
_getMsgTemplate(type)          // reads textarea value or falls back to MSG_TPL_DEFAULTS
_fillMsgTemplate(tpl)          // replaces all {placeholders} with live quotation data
insertPlaceholder(id, ph)      // inserts placeholder at cursor in textarea (unused in current UI but kept)
renderMsgPreview(type)         // updates the preview div below each template editor
initMsgTemplates()             // called when msgtpl tab opens; fills textareas with defaults if empty
```

## What was changed on 2026-06-08 (session — Carcass pricing, BOM unit, Printout materials)

### Carcass pricing persistence (Settings → Carcass pricing tab)
1. **`_collectAppSettings` now includes `carcassPrices`** — full `CARCASS_PRICES` object is saved into the CONFIG row in the Settings sheet alongside CF, MOB_LOCATIONS, etc.
2. **`_applyAppSettings` restores carcass prices** — on login, merges saved prices back into `CARCASS_PRICES`, `CABINET_BASE_COSTS`, and `CARCASS_NAMES` (including any custom types added by Admin)
3. **Add type** — `+ Add type` button in Carcass pricing tab header; prompts for name, rejects duplicates, inserts at ₱0
4. **Remove type** — trash button per row; confirms before deleting; warns that existing quotations using that type will show ₱0 until re-saved
5. **New functions**: `addCarcassType()`, `removeCarcassType(name)`

### BOM materials / hardware — unit field
6. **Unit dropdown replaced with read-only badge** — `<select>` with `UNIT_OPTS` replaced by a grey styled `<span>` showing `mi.unit` / `hi.unit` (auto-filled from DB on item pick). Shows `—` if unset. Grid column narrowed from `78px` to `60px`.

### Quotation printout — Type of Materials column
7. **`extractSubstrateInfo(matNames[])`** — new helper; strips internal company prefixes (`[CWLI ONLY]`, `[MSSI]`, etc.), deduplicates, joins with ` · `; returns `'Per specification'` when no materials
8. **`_collectAreaMatNames(area)`** — new helper; collects material names for an area: BOM mode reads `bomItems[i].materials[].name`; services mode reads `matItems[].name` only (hardware excluded)
9. **By area printout**: `areaSpec` replaces hardcoded `'Per specification'`; populated by `extractSubstrateInfo(_collectAreaMatNames(area))`
10. **By cabinet type printout**: `typeMatNames{}` map tracks material names per cabinet type alongside `typeMap`; BOM mode populates from `bomItems[i].materials[]`; services mode assigns all area `matItems` names to service rows
11. **Lump sum printout**: aggregates all area mat names across all areas into one `extractSubstrateInfo` call
12. **Cabinet/Scope column — services mode**: scope now shows **services only** (service names from `svcItems`); `matItems` and `hwItems` removed from scope lines
13. **Type of Materials column — services mode**: shows **matItems only** (hardware excluded from `_collectAreaMatNames`)

### Column logic by fab mode (printout)
| Fab mode | Cabinet / Scope | Type of Materials |
|---|---|---|
| Carcass | Cabinet type names (e.g. `2× Wardrobe`) | Per specification |
| BOM | Cabinet type names | Materials from `bomItems[i].materials[]` |
| Services | Service names only | `matItems` names only |

## What was changed on 2026-06-07 (session 3 — Cost display cleanup)

1. **Mobilization & Installation combined** — separate "Mobilization" and "Installation" line items (and Assembly) are now displayed as one combined "Mobilization & Installation" line in both the quotation form summary and the printout, regardless of fab mode
2. **Contingency hidden from display** — Mob. contingency and Install. contingency rows removed from the admin breakdown panel; amounts are still computed and included in the combined value
3. **Overhead hidden from printout** — the "Contingency & overhead" row removed from the printout table; its amount is absorbed into the "Mobilization & Installation" combined row so totals still add up: `pMobBase + pInstBase + pAssmBase + overheadAmt`
4. **Fallback when no installation** — when `ni=false && na=false` (fabrication-only), the overhead is silently baked into the price; no mob/inst row shown; grand total unchanged

## What was changed on 2026-06-07 (session 4 — Pending Orders / Wufoo integration)

### New "Orders" nav tab
1. **`Orders` nav button** — inserted between Projects and Clients; shows a red badge with count of Pending + In Progress orders
2. **`page-orders`** — new page with sticky header, filter dropdown (Pending & In Progress / Done / All), Refresh button, SLA Settings shortcut button
3. **Order cards** — each order shows: Wufoo entry ID, received timestamp, status badge, request type badge (New/Revision), client info grid, service flags (Edging/Boring/Cutting/Lipping), clickable attachment links, color-coded response timer, SLA progress bar
4. **Response timer** — counts working minutes from received to now (Pending/In Progress) or to sentAt (Done); color: green → amber (≥75% SLA) → red (overdue)

### Wufoo → Sheets integration
5. **`Pending Orders` sheet tab** — new tab with 27 columns: ID, Received At, Client Name, Company Name, Contact Number, Customer Email, Salesman Email, Request Type, Type of Service, Floor (1F/2F), Board/Substrate, Haspe Flow, Edging, Boring, Cutting, Lipping, Handgrab Included/Groove/Installation/By, Agent Name, Attachment 1, Attachment 2, Status, Quotation Serial, Sent At, Source Company
6. **Google Apps Script webhook** — standalone script (provided to user) deployed at script.google.com; receives Wufoo POST, maps field labels to columns, appends row to Pending Orders tab; Wufoo webhook URL pasted under Integrations in Wufoo form
7. **Field mapping** — uses Wufoo's `Field1_label` + `Field1` pattern to build a label→value map; handles both old and new Wufoo field names with fallback

### Export to Quotation
8. **"Export to Quotation" button** — on each Pending order card; calls `exportOrderToQuotation(id)`: sets `qSourceOrderId`, navigates to Quotation page, pre-fills cl-name, cl-bizname, cl-contact, cl-email, cl-agent, cl-service; marks order "In Progress" in memory + Sheets
9. **Auto-mark Done on send** — all `doShare*` functions call `orderMarkSentFromQuotation()`; if `qSourceOrderId` is set, writes status=Done + sentAt to Sheets and clears the variable
10. **Manual "Mark Done" button** — shown on In Progress orders that already have a quotation serial; for cases where quotation was sent outside the app

### Settings → Orders & SLA sub-tab
11. **New "Orders & SLA" settings tab** — between Designers Support and the tab list end
12. **Default SLA hours** — single input; default 8 working hours; persisted in CONFIG settings row
13. **Per-company working hours** — day-by-day schedule table per company: checkbox (working/closed), start hour, end hour, computed hours column; Sunday/Saturday shown with grey background as default rest days
14. **Holiday exclusion toggle** — per-company checkbox "Exclude PH holidays from timer"; uses existing `PH_HOL` array; holidays are skipped in working-minutes calculation
15. **Wufoo webhook URL field** — informational storage + "Test" button (explains URL is pasted into Wufoo, not called from app)
16. **Setup guide** — collapsible 3-step guide embedded in the tab
17. **Settings persistence** — `ordersSla: { defaultHours, webhookUrl, companies }` added to `_collectAppSettings` / `_applyAppSettings`; saved/restored with all other settings

### Working hours calculator
18. **`calcWorkingMinutes(fromIso, toIso, companyName)`** — per-day schedule aware; skips non-work days, holidays (if enabled), and hours outside shift; migration-safe (handles old `{startH,endH,days}` format)
19. **`_defaultDaySchedule()`** — returns Mon–Fri 8–17, Sat/Sun closed
20. **`_ensureCompanySchedule(co)`** — ensures company entry exists in `ordersSlaSettings.companies`; migrates from old format if needed

### New globals added (2026-06-07 session 4)
```javascript
pendingOrders        // array of order objects loaded from Pending Orders sheet
ordersLoaded         // boolean — true once first load completes
qSourceOrderId       // order ID that spawned the current quotation (cleared on send)
ordersSlaSettings    // { defaultHours, webhookUrl, companies: { [co]: { excludeHolidays, schedule: {0..6: {start,end}|null} } } }
DAY_LABELS           // ['Sunday','Monday',...,'Saturday']
DAY_SHORT            // ['Sun','Mon',...,'Sat']
```

### New functions added (2026-06-07 session 4)
```javascript
_defaultDaySchedule()                    // returns Mon–Fri 8–17 schedule object
_ensureCompanySchedule(co)               // ensures/migrates company schedule entry
gLoadPendingOrders(cb)                   // loads Pending Orders sheet tab into pendingOrders[]
_updateOrdersBadge()                     // updates red badge count on Orders nav button
calcWorkingMinutes(fromIso,toIso,co)     // working-hours-aware elapsed minutes calculator
fmtWorkMins(mins)                        // formats minutes as "2h 30m"
_orderSlaClass(mins,slaHours)            // returns CSS color string based on SLA progress
renderOrders()                           // renders order cards into #orders-wrap
exportOrderToQuotation(orderId)          // pre-fills quotation from order, marks In Progress
_setVal(id,v)                            // helper: sets element value if exists and value truthy
_setOrderStatus(orderId,status,serial)   // updates in-memory + Sheets (cols X:Z) for one order
markOrderDoneManual(orderId)             // manual "Mark Done" from order card
orderMarkSentFromQuotation()             // called by doShare*; marks qSourceOrderId order Done
ensurePendingOrdersTab(cb)               // creates Pending Orders tab + header row if missing
renderOrdersSlaSettings()                // renders Settings → Orders & SLA tab content
_slaDayWorkToggle(co,day,checked)        // toggles a day on/off in company schedule
_slaDayHour(co,day,field,val)            // updates start/end hour for a day; refreshes hours display
_slaHolToggle(co,checked)               // toggles holiday exclusion for a company
testWebhookUrl()                         // shows toast explaining webhook URL goes in Wufoo
```

## What was changed on 2026-06-09 (session — Service Catalog + Capacity, Phase 1)

### Strategic plan established (Profitability roadmap)
The session defined a 5-phase plan toward full project profitability reporting:
- **Phase 1** ✓ — Service catalog with capacity fields (this session)
- **Phase 2** — Cost breakdown per service (admin %, consumables, manpower, overhead → cost/unit → markup)
- **Phase 3** — Wire capacity to real schedule load checks (replace hardcoded demo data)
- **Phase 4** — PPIC page (Job Orders, material issuance tickets, delivery scheduling)
- **Phase 5** — Profitability reports per project and monthly

Key architectural decisions made:
- Service catalog is a **global lookup** (not per-project-type) — same list for all quotations
- Capacity is defined at **service row level** (not category level) since different materials on the same machine have genuinely different output rates (e.g. 18mm vs 25mm cutting speed differs due to blade contact, chipping risk, operator loading time)
- Minimum charge rows (e.g. "Panel cutting (minimum charge)") are pricing rules, not capacity activities — detected by name and excluded from capacity fields
- `SERVICES.price` kept in memory (used by `getAreaSubtotal()` for services-mode quotation cost) — removal deferred to Phase 2 when full cost structure is defined

### Service catalog overhaul (Settings → Services tab)
1. **Synced from Price DB** — `_syncServicesFromDb()` merges `dbServices` (name/unit/price from Price DB) with `SERVICE_CAPACITY` (type/teams/shifts/output from CONFIG); result stored in `SERVICES`; called after every `loadPriceDatabase()` and after `_applyAppSettings()`
2. **Columns now shown**: Service name (editable) · UOM (editable dropdown) · Price (editable) · Type · Teams · Shifts/day · Output/shift · Delete
3. **Prices shown but note clarified** — price field kept editable for now; deferred to Phase 2 for full redesign
4. **Write-back on Save Settings** — `_saveServicesToPriceDb()` clears and rewrites the Price DB Services sheet with current `SERVICES` list; no need to edit the sheet directly
5. **Add service** — adds new row with editable name/UOM/price + capacity fields; written to Price DB on Save Settings

### Capacity fields per service
6. **`SERVICE_CAPACITY`** global — `{ serviceName: { type, teams, shiftsPerDay, outputPerShift } }` keyed by service name; saved to CONFIG row in Settings sheet as `serviceCapacity`
7. **Type** — `production` / `installation` / `outsourced`
8. **Teams** — number of teams/machines available simultaneously
9. **Shifts/day** — 1–3 shifts; affects total daily capacity
10. **Output/shift** — units per team per shift (in service's UOM); placeholder shows UOM for clarity
11. **Total effective daily capacity** = Teams × Shifts/day × Output/shift
12. **`_svcCapSet(i, field, val)`** — updates both `SERVICES[i][field]` and `SERVICE_CAPACITY[name][field]` simultaneously

### Price DB duplicate prevention
13. **`initPriceDB` fixed** — now uses `priceDbClear()` + `priceDbUpdate()` instead of `priceDbAppend()` for Services and CabinetTemplates tabs; running Initialize DB multiple times no longer creates duplicate rows
14. **`priceDbClear(range)`** — new helper; calls Sheets API `:clear` endpoint
15. **`priceDbUpdate(range, values)`** — new helper; calls Sheets API PUT (overwrite) instead of POST (append)
16. **"Clean duplicates" button** — added to Settings → Price Database tab; calls `dedupeServicesSheet()` which reads the sheet, removes exact-name duplicate rows, rewrites; shows count of removed rows

### Duplicate/similar name detection in Services tab
17. **`_svcSimilarGroups()`** — tokenizes service names, strips noise words (`minimum`, `charge`, `and`, `per`, etc.), flags any pair sharing 2+ significant tokens
18. **Amber highlight** — flagged rows get amber background + border + inline warning banner listing which other services they resemble
19. **Header count** — "⚠ N possible duplicates highlighted" shown in tab header when any are detected
20. **Tooltip** — hover over flagged row shows similar names

### New globals added (2026-06-09)
```javascript
SERVICE_CAPACITY   // { serviceName: { type, teams, shiftsPerDay, outputPerShift } } — capacity settings keyed by service name
SVC_TYPES          // [{ v:'production', l:'Production' }, { v:'installation', l:'Installation' }, { v:'outsourced', l:'Outsourced' }]
```

### New functions added (2026-06-09)
```javascript
_syncServicesFromDb()        // merges dbServices + SERVICE_CAPACITY → SERVICES; re-renders if tab open
_saveServicesToPriceDb()     // clears + rewrites Price DB Services sheet from SERVICES array; called by gSaveAppSettings
_svcCapSet(i, field, val)    // updates SERVICES[i] and SERVICE_CAPACITY[name] simultaneously
_svcSimilarGroups()          // returns { index: [similarIndexes] } for services with similar names (2+ shared tokens)
dedupeServicesSheet()        // reads Price DB Services sheet, removes exact-name duplicates, rewrites
priceDbClear(range)          // Sheets API :clear helper for Price DB
priceDbUpdate(range, values) // Sheets API PUT (overwrite) helper for Price DB
```

## What was changed on 2026-06-09 (session 2 — Phase 2 Cost Breakdown + Orders fixes)

### Phase 2: Cost Breakdown per service (Settings → Cost Breakdown tab)

#### New tab structure
1. **"Cost Breakdown" Settings sub-tab** — dedicated tab between Services and Cost Factors; shows global overhead card + one expandable card per service
2. **Global overhead card** — inputs: Admin cost, Utility cost, Other expenses, Packing (all ₱/mo), Working days/mo; live "Total base" display; no oninput re-render (uses `_refreshAllCbdOverhead()` in-place patch to avoid focus loss)
3. **Per-service 3-column layout** — Overhead | Manpower | Consumables; always fully expanded (no drawer hiding)

#### Revenue mix — overhead split
4. **Revenue mix slider** — in the global overhead card; sets Production share % (Installation = 100 − Production); default 70/30 based on historical sales data
5. **Two pool cards** — Production overhead pool (blue) and Installation overhead pool (green) update live as slider moves
6. **Effect on overhead only** — `computeServiceCosts()` applies `CF.productionMix` or `CF.installMix` % to `fixedTotal` first to get `fixedPool`, then applies `expenseRatio%` to the pool; manpower and consumables are unaffected
7. **Service type determines pool** — `s.type === 'installation'` uses installMix pool; all others (production, outsourced) use productionMix pool
8. **Persisted in CF** — `CF.productionMix` and `CF.installMix` saved with Save Settings

#### Overhead column per service
9. **Expense ratio (%)** — what share of the revenue-mix-adjusted pool this service absorbs
10. **Display chain** — shows: `₱fixedTotal total → × revShare% [prod/install] = ₱pool → × expenseRatio% ratio → = ₱fixedAlloc / mo`

#### Manpower column per service
11. **Team / operator cost (₱/mo)** — monthly salary of all operators for this service
12. **Allocation (%)** — what % of the team's cost to attribute here (since same team may work across services); `opCostMonth = operatorCost × manpowerPct%`
13. **Capacity utilization (%) slider** — what share of this machine's total monthly output is for this service; range 0–100%; live display: `Used: N lm / mo (of M max)`; affects `monthlyCapacity = fullCap × capacityPct%`; default 100%

#### Consumables column per service
14. **Formula: Cost ÷ Lifecycle** — each consumable row: label, Cost (₱), Lifecycle/Consumption → Cost per output unit = Cost ÷ Lifecycle
15. **Total consumable cost / unit** — sum of all consumable cost/unit rows; shown at bottom of consumables column
16. **No capacity needed for unit cost** — cost/unit always computable; monthly total requires capacity set

#### Summary bar per service card
17. **5-cell summary** — Monthly capacity | Overhead alloc. | Operator cost | Consumables/mo | Op Cost → Gross Margin
18. **Consumables/mo fallback** — when capacity = 0 but consumables entered: shows `₱X.XXXX/unit` + amber "Set output/shift for monthly total" instead of ₱0
19. **Op Cost → Margin** — when capacity = 0: shows amber "Set output/shift in Services tab" hint
20. **Gross margin color** — teal ≥30%, amber ≥15%, coral <15%

#### computeServiceCosts() formula
```
fullCap = teams × shiftsPerDay × outputPerShift × workdaysPerMonth
cap = fullCap × capacityPct%
fixedPool = fixedTotal × revShare%          ← revenue mix applied here only
fixedAlloc = fixedPool × expenseRatio%
opCostMonth = operatorCost × manpowerPct%
consumCost = Σ(cost/lifecycle) × cap        ← per-unit × monthly output
totalExpense = fixedAlloc + opCostMonth + consumCost
opCost = totalExpense / cap
grossMargin = (price - opCost) / price × 100
```

#### Services tab sync
21. **Services drawer always re-renders on open** — removed `!d.innerHTML.trim()` cache guard; drawer always shows fresh data so Services tab and Cost Breakdown tab always agree
22. **`_buildCbdSummaryHtml` overhead sub-label fixed** — now shows `Pool ₱X × ratio%` not `fixedTotal × ratio%`

### New globals added (Phase 2)
```javascript
// Added to each SERVICES[i] object:
//   expenseRatio     — % of overhead pool absorbed (0–200)
//   operatorCost     — monthly operator salary (₱)
//   manpowerPct      — % of team cost allocated to this service (0–100, default 100)
//   capacityPct      — % of machine capacity used by this service (0–100, default 100)
//   consumables      — [{ label, cost, lifecycle }] array

// Added to CF:
//   adminMonthlyCost — monthly admin cost (₱)
//   utilityCost      — monthly utility cost (₱)
//   otherExpenses    — monthly other expenses (₱)
//   packingCost      — monthly packing cost (₱)
//   productionMix    — production revenue share % (default 70)
//   installMix       — installation revenue share % (default 30)
```

### New functions added (Phase 2)
```javascript
computeServiceCosts(s)           // returns { fullCap, monthlyCapacity, fixedTotal, fixedPool, revShare, fixedAlloc, opCostMonth, consumCost, totalExpense, opCost, grossMargin }
_buildSvcCostSummaryHtml(i,s,cc) // 5-cell summary bar HTML (used in Services drawer)
_buildCbdSummaryHtml(i,s,cc)     // 5-cell summary bar HTML (used in Cost Breakdown tab)
renderCostBreakdownSettings()    // renders the full Cost Breakdown tab
_refreshCbdSummary(i)            // in-place patch of summary bar for service i
_refreshAllCbdOverhead()         // patches all overhead/pool displays when global costs change
_cbdAddConsumable(i)             // adds consumable row to service i; re-renders
_cbdRemoveConsumable(i,ci)       // removes consumable row; re-renders
_svcSetConsumable(i,ci,field,v)  // updates consumable field; patches cpu display + summary
addCarcassType()                 // adds custom carcass type (Settings → Carcass pricing)
removeCarcassType(name)          // removes carcass type with confirmation
```

### Orders page fixes
23. **Export to Quotation — race condition fixed** — always clears `qSerial` first (starts fresh), then polls every 150ms (up to 3s) until `cl-name` DOM field exists before filling — replaces the old fixed 400ms timeout
24. **View button on every order card** — opens `ov-order-detail` modal showing all 27 named fields with `—` for empty ones
25. **Raw sheet columns section** — collapsible "🔍 Raw sheet columns" section in View modal shows every non-empty column letter + value; used to diagnose Wufoo webhook column mapping issues
26. **Attachment files** — clicking File 1/File 2 opens modal with full URL + Copy to clipboard button; explains that Wufoo cabinet URLs require Wufoo login (cannot open directly)
27. **`ov-order-detail` overlay** — new reusable overlay used by both `viewOrderDetail()` and `viewOrderAttachment()`
28. **`_raw` stored on each order** — `pendingOrders[i]._raw = r` stores the raw sheet row array for the raw column dump

### GAS webhook update
29. **Robust label-flexible GAS script provided** — handles label variations via `LABEL_MAP` (50+ aliases), logs raw POST data via `Logger.log` for diagnosis, writes `EntryId` to col A, timestamp to col B, all mapped fields to correct columns, `Pending` default to col X; `doGet` health check endpoint; user needs to: paste new script → Deploy new version → resubmit Wufoo test → check Executions log for actual field labels sent

### New functions added (Orders fixes)
```javascript
viewOrderDetail(orderId)         // opens ov-order-detail modal with all fields + raw column dump
viewOrderAttachment(url)         // opens ov-order-detail modal with URL + copy button + Wufoo login note
```

## What was changed on 2026-06-09 (session 3 — Installation inputs + Cost Breakdown additions)

### Installation workers & days inputs (Mobilization card)
1. **`qInstWorkers` / `qInstDays` globals** — new per-quotation installation labor overrides; `0` means use CF defaults
2. **Mobilization card UI** — "Installation labor" section added below region selector: Workers input + Days on site input; shows CF defaults as placeholder (`CF.laborCount` / calculated days); live `inst-cost-disp` shows computed cost
3. **`recalc()` updated** — `instBase = workers × days × laborCostPerDay`; uses CF defaults when inputs are 0
4. **State save** — `collectQuotState` includes `instWorkers`/`instDays`
5. **State load** — restored from saved state JSON; DOM fields synced after loading
6. **Option snapshots** — `captureQuotationSnapshot` includes `instWorkers`/`instDays`; `restoreQuotationSnapshot` restores globals + DOM fields when switching options
7. **`initQuotation` reset** — both globals and DOM fields reset to 0 when starting a new quotation

### Cost Breakdown additions (session continuation)
8. **Price editable in Cost Breakdown card header** — service price field now has an editable input directly in the card header (₱X.XX / UOM); changes write back to `SERVICES[i].price` and `SERVICE_CAPACITY[name].price`; no auto-save — takes effect on Save Settings
9. **Price, Op Cost, Margin columns removed from Services tab** — these are already shown in Cost Breakdown; Services tab now only shows: Service name · UOM · Type · Teams · Shifts/d · Output/shift · Delete (grid `2fr 68px 80px 58px 74px 90px 36px`)

### New globals added
```javascript
var qInstWorkers = 0;   // installation workers override (0 = use CF.laborCount)
var qInstDays = 0;      // installation days override (0 = auto-calculate from totU)
```

## What was changed on 2026-06-09 (session 4 — AI model upgrade + Drawing Intelligence Pipeline POC)

### AI model upgrade (drawing analysis + mobility)
1. **Model upgraded `claude-sonnet-4-5` → `claude-sonnet-4-6`** — updated all 6 references in `index.html`: the 4 drawing-analysis calls (`prodSendPdf`, `prodSendText`, and the prompt paths around lines 12400/12416/12474/12529), the mobility planner (`_mobCallClaude`, ~line 12073), and the billing help text. Current-generation Sonnet for better structured-extraction accuracy at ~same cost.
2. **Opus 4.8 deferred** — kept as an "open consideration" (saved to auto-memory `project_opus_upgrade_consideration.md`): upgrade drawing analysis to `claude-opus-4-8` if Sonnet 4.6 still misses too much on real drawings. Opus is ~1.67× token cost ($5/$25 vs $3/$15 per 1M) but meaningfully better on ambiguous/low-quality inputs. 5 other accuracy improvements also still pending (EBT default-to-blank, max_tokens raise, page-type context, scale/title-block extraction, few-shot examples).

### Strategic direction — Drawing Intelligence Pipeline (the big goal)
The user's north-star for the Designers Support feature: accurately analyze shop drawings to reduce dependence on human expertise. Agreed pipeline (each arrow = a human-review gate):
```
Elevation/technical drawing → cabinet INTENT (type + W/H/D + material)
  → parametric MODEL (rules engine generates every panel/EBT/hardware)
  → 3D review (catch missing parts, overlaps, wrong sizes)
  → shop drawing → components/EBT → cutting layout (nesting) → cutting list
```
**Core architectural decision:** the LLM must NOT do geometry/EBT/cutting math directly (a language model gives a *plausible* answer each time, not a *consistent* one). Instead a **deterministic parametric rules engine** is the source of truth. The AI's job shrinks to *reading the drawing → cabinet type + dimensions*; the engine expands that into panels, EBT, and hardware by rule. This is what delivers accuracy + consistency + reduced human dependence. Beyond Claude, planned integrations: **Three.js** (3D review), **bin-packing** (cutting layout/nesting), a **WCLI rules library** (the encoded expertise = the actual product), and a **feedback loop** (log user corrections → engine + prompts evolve).

Phased roadmap: **Phase 1 ✓** single-cabinet parametric engine + 3D (done this session) · Phase 2 = all 13 cabinet types · Phase 3 = cutting layout → cutting list · Phase 4 = AI reads elevation → feeds engine · Phase 5 = feedback loop.

### New files (standalone — NOT part of the deployed app)
3. **`poc_cabinet.html`** — Phase 1 proof-of-concept. Standalone single file (Three.js via CDN), zero risk to `index.html`. Three inputs (W/H/D) + options deterministically generate a full base-cabinet parts list, EBT, and hardware, rendered in interactive 3D for review. Open by double-clicking, or via preview server at `http://localhost:8766/poc_cabinet.html`. Proves: determinism, EBT-by-rule, auto hardware derivation, 3D review gate. Key functions: `buildBaseCabinet(p)` (the rules engine), `tapePerPiece(code,L,W)` (EBT→tape length), `placeBoxes(p)` (Three.js render). EBT codes shown in **red** (banded), grey (`N/A`), orange (manual band).
4. **`WCLI_shop_standards.md`** — source-of-truth document capturing WCLI's actual cabinet-construction rules (from plant feedback). Referenced by the engine now and the AI prompt later. Update this whenever plant practice changes.

### WCLI plant standards captured & encoded (from user feedback)
- **EBT:** side panel = front+bottom (`1s/1l`); bottom = front (`1l`); top rails = front-facing edge (`1l`); 18mm full back / grooved thin back = `N/A`; **fixed** shelf = front only (`1l`); **adjustable** shelf = all sides (`2s/2l`); standard door = `2s/2l`; handgrab door = `1s/2l` (top grooved); end panel = `1s/1l`; toe kick = `1l`.
- **Backing:** standard 18mm full; option 3mm/6mm grooved (`4mm W × 9mm deep` groove in sides+bottom, 18mm from back edge; back oversized +18mm width/+9mm height; **support back panel added** behind thin back).
- **Fasteners:** HiLo/chipboard screw 4×50 (assembly), 4×32 (cabinet-to-cabinet), Minifix when screws would be visible; exposed side → add **End panel** or use Minifix.
- **Shelves:** adjustable = shelf pins (4/shelf); fixed = screw 4×50 or Minifix.
- **Doors/handles:** hinges 2/leaf (4 if tall, >~1400mm); 3mm gap; **aluminum handgrab** (−35mm door height, top-edge groove, glue); **45° taper** (edge all → 45° cut → manual band); **routered finger-pull**; knob/D-handle.
- **Materials:** standard 18mm carcass (25mm only on client request or tables); adjustable legs; 100mm toe kick; board sizes 4×8ft (1220×2440) standard, 6×8ft (1830×2440) some cases; compact laminate various.

### Open confirmation items (in `WCLI_shop_standards.md`, pending user verification)
1. Top rail EBT — does the **back** rail band the front-facing edge, or only the front rail?
2. Grooved backing add — confirm +18mm width / +9mm height, no top groove.
3. Routered finger-pull — band before or after routering?
4. Dowel + cam lock — used anywhere as standard, or strictly screw/Minifix?
5. Handgrab −35mm — fixed, or varies by profile? Which profiles stocked?

### All 5 base-cabinet confirmations applied (2026-06-09)
1. ✓ Both top rails band the front-facing edge.
2. ✓ Grooved backing: groove on all 4 sides incl. top, 18mm offset from rear edge; back panel +18mm W/+18mm H; **back panel recessed 18mm** from the rear (18mm carcass lip); **horizontal centre support rail** stands in the rear recess behind the back panel.
3. ✓ Routered finger-pull: router first, then edgeband.
4. ✓ Dowel + cam lock not used — screw/Minifix only.
5. ✓ Handgrab cut varies, 35mm is normal default.

### Decision taken: GO WIDE (Phase 2 started — multiple cabinet types)
Refactored `poc_cabinet.html` so geometry is defined **once per part** (`boxes:[{sx,sy,sz,x,y,z}]`); both the 3D view (`render3D`) and the cutting table read from the same source. Added a **cabinet-type dispatcher** `buildCabinet(p)` with a build function per type:
- **`buildBase`** — base cabinet (plant-accurate, confirmed by user).
- **`buildWall`** — wall/upper: no toe kick (`tk=0`), full top + bottom panels (not rails), hanging rail at top back, wall brackets, shallower default depth (320mm).
- **`buildTall`** — tall/pantry: full top panel, default height 2100mm, floor-standing (toe kick + legs), more shelves.
- **`buildDrawerBase`** — N drawer fronts (one part, N boxes) + drawer box panels (sides/front-back/bottom, aggregated qty, not rendered) + slide runners + pulls.
- **`buildSinkOpen`** — no bottom panel (open under-sink), bottom front rail to tie sides, door optional.

Shared sub-builders: `addSides`, `addBacking`, `addShelves`, `addDoors`/`doorHw`, `addToeKickLegs`, `addExposed`, `screws`. UI: cabinet-type dropdown, per-type control show/hide (`applyTypeUI`), per-type dimension defaults (`typeDefaults`), part color legend (`PART_COLORS`). All 5 types verified rendering with no console errors.

### Open items to VERIFY WITH PRODUCTION (the 4 new types use best-guess standard-practice rules — base cabinet is the only confirmed one)
- **Wall cabinet:** full top + bottom panels vs rails? Hanging rail vs French cleat vs direct screw? Standard wall depth?
- **Tall/pantry:** full top panel vs rails? Single tall door vs split upper/lower doors?
- **Drawer base:** drawer box material/thickness (assumed 15mm sides, 6mm base), slide clearance (assumed 26mm total), do drawer boxes get any EBT, bottom rail vs full bottom panel under drawers?
- **Sink/open base:** "no bottom panel + bottom front rail" correct, or built differently?
- User is checking these against the actual plant and will report back.

### Next after production verification
Refine the 4 new types per plant feedback, then either continue wide (corner, oven tower, remaining WCLI types) or pivot deep (Phase 4 — AI reads elevation drawing → feeds the engine).

## What was changed on 2026-06-10 (session — Wufoo source order tracking + timezone fix)

### Wufoo field mapping fixed
1. **GAS script rewritten to map by field ID** — previous version used `Field1_label`/`Field1` label-pair approach; Wufoo actually sends direct field IDs (`Field2`, `Field4`, etc.); script rewritten with confirmed field ID mapping from debug data
2. **Webhook URL corrected** — Wufoo was pointing to an old deployment URL; updated to match the active GAS deployment
3. **Wufoo Debug sheet** — GAS writes every raw POST to a `Wufoo Debug` sheet tab for diagnosis
4. **Field mapping confirmed** — `Field2`=Client Name, `Field4`=Company, `Field6`=Contact, `Field131`=Customer Email, `Field179`=Salesman Email, `Field156`=Request Type, `Field161`=Type of Service, `Field168`=Floor, `Field150`=Board/Substrate, `Field163`=Haspe Flow, `Field123`=Edging, `Field124`=Boring, `Field171`=Cutting, `Field177`=Lipping, `Field153`=HG Included, `Field172`=HG Groove, `Field175`=HG Installation, `Field152`=HG By, `Field126`=Agent Name, `Field128-url`=Attachment 1, `Field129-url`=Attachment 2

### Source Order tracking (index.html)
5. **`q-order-badge`** — blue pill badge near quotation serial shows `📋 Order #XXXX` when quotation was exported from a Wufoo order
6. **`qSourceOrderId` persisted** — saved to `Quotation State` JSON and restored on load
7. **Quotations sheet column R** — `Source Order` field written by `gSaveQuotation`; all `Quotations!A:Q` ranges updated to `A:R`; `QUOT_HDR` and `sessionQuotations` updated
8. **Project List "Source Order" column** — toggleable (off by default); shows blue `📋 #XXXX` pill for orders from Wufoo
9. **Activity log entry** — `logActivity('Quotation created from Wufoo Order #XXXX — Client Name')` called on export

### Timestamp timezone fix
10. **`DateCreated` is UTC-7 (US Pacific Daylight Time)** — Wufoo stores `DateCreated` on their US servers in UTC-7; confirmed by comparing GAS webhook receipt time (true UTC) vs `DateCreated` — consistently 7 hours apart
11. **Fix in GAS script** — `rawDate.replace(' ','T')+'-07:00'` parses as UTC-7; then `Utilities.formatDate(dt, 'Asia/Manila', ...)` converts to PHT and stores as `"yyyy-MM-dd'T'HH:mm:ss+08:00"`; orders now show correct Philippine time

### Attachment via Google Drive (COMPLETED)
12. **GAS `_uploadAttachment()` function** — downloads attachment from Wufoo at webhook time, uploads to Team Drive folder (`1hK4iox_XmAFWOD-mMGjpEHBENOxJneeB`), stores Drive URL instead of Wufoo-protected URL; falls back to original URL on failure
13. **Wufoo API key obtained** — `FCNJ-5BIO-MQJW-HKKK`; placed in GAS script; `doGet` run manually once for Drive OAuth approval
14. **Auth fix** — original `_uploadAttachment` sent `Authorization: Basic` header; Wufoo cabinet URLs are **pre-signed Amazon S3 URLs** (auth already embedded in query string); adding a second auth mechanism caused AWS 400 `InvalidArgument` error; fixed by removing the header — fetch the URL directly with no auth header
15. **Verified working** — `testAttachment()` returns a `drive.google.com` URL; new Wufoo submissions store Drive links instead of Wufoo cabinet URLs

## What was changed on 2026-06-10 (session 2 — Wufoo attachment fix + Mobility planner improvements)

### Wufoo attachment → Google Drive (completed)
1. **Root cause found** — `_uploadAttachment()` was sending `Authorization: Basic` header to Wufoo cabinet URLs; those URLs are pre-signed Amazon S3 URLs with auth already in the query string; AWS rejects dual-auth with HTTP 400 `InvalidArgument: Only one auth mechanism allowed`
2. **Fix** — removed the `Authorization` header from `_uploadAttachment()`; fetch the S3 URL directly with no extra headers; it downloads successfully and uploads to Team Drive
3. **Verified** — `testAttachment()` returns a `drive.google.com` URL; new order submissions automatically store Drive links; existing orders (#8704, #8705) still have old Wufoo URLs (saved before fix — not retroactively updated)

### Wufoo DateCreated timezone (corrected)
4. **Actual timezone confirmed as UTC-7** (US Pacific Daylight Time) — debug data showed GAS webhook receipt at 07:12Z vs `DateCreated: "2026-06-10 00:12:32"` — exactly 7 hours behind; the `+'Z'` fix treated it as UTC, still wrong
5. **Correct GAS fix** — `new Date(rawDate.replace(' ','T')+'-07:00')` → `Utilities.formatDate(dt, 'Asia/Manila', ...)+'08:00'`; orders now display correct Philippine time

### Tourist area detection in Accommodation Planner
6. **AI prompt updated** — `computeAccommodation()` now instructs Claude to detect if destination is a known tourist area in the Philippines (Boracay, Palawan, Siargao, Baguio, Tagaytay, Batangas beach areas, Cebu tourist zones, Vigan, Chocolate Hills, etc.)
7. **New JSON fields** — `tourist_area: boolean`, `tourist_premium_note: string` added to accommodation response schema
8. **Orange warning banner** — `_buildAccomGrid()` shows an orange 🏖️ banner above the accommodation cards when `tourist_area: true`; displays the AI's specific note (e.g. *"Boracay peak season — expect 30–50% above standard PH rates"*)
9. **Context** — tourist destination areas in PH typically have 20–60% higher accommodation and food prices vs non-tourist areas; banner prompts user to budget accordingly

### Mobility planner default origin/destination fix
10. **Origin not refreshing bug** — `mobilityState.origin` set to `'Philippines'` (fallback) was not in `knownDefaults` array; condition `knownDefaults.indexOf(mobilityState.origin)>=0` always false → origin never refreshed from company even when it should
11. **Fix** — added `'Philippines'` and `''` to `knownDefaults` so the fallback value is treated as non-custom and always refreshes
12. **Destination always syncs** — `setProdTab('mobility')` now always overwrites `mobilityState.destination` with `cl-location` value when switching to mobility tab; previously only filled when empty, so switching quotations left stale destination
13. **Rule confirmed** — WCL and MSSI both use `88 Jennys Ave., Pasig City, Metro Manila`; CWL uses `Tawagan St., Tayud, Consolacion, Cebu`; determined from quotation company via `getCompanyName()`, not user's company

## What was changed on 2026-06-11/12 (session — planner transport, cost report, Director role, mobilization breakdown)

### Mobility planner — long-haul transport preference + public commute mode (commit `8dfefcb`)
1. **`mobilityState.longHaulPref`** (`auto`/`air`/`sea`/`combined`) + **`mobilityState.publicMode`** (`commute`/`grab`) added (defaults `auto`/`commute`)
2. **Transportation card** — new "Long-haul preference" dropdown (always shown) + "Public mode" dropdown (only when Vehicle = Public Transport); grid widens to 4–5 cols
3. **AI prompt** — long-haul preference applied only when AI judges the trip is Visayas/Mindanao/far-Luzon (inter-island or >500km); prices preferred mode (airfare+transfers / RoRo passenger+vehicle / drive+ferry combo) and notes the alternative; ignored for nearby destinations. Public mode prices Grab vs jeep/bus city legs
4. **Mock mode** reflects both choices (mode icon, ferry/airfare/Grab lines)
5. **Origin lookup hardened** (commit `9f5acf3`) — `_mobOriginFor()` matches company names ignoring punctuation/spacing + keyword fallback (cebu/world class/module); fixes origin defaulting to "Philippines" when User Roles company string isn't an exact map key
6. **Search buttons never disabled** (commit `9f5acf3`) — clicking when blocked shows a toast ("Enter destination first" / "No Claude API key") instead of a dead disabled button; blocked state shown dimmed

### Transport export — choose which line items to send (commit `d1b388a`)
7. **Per-item checkboxes** in the transport result table (header = select/deselect all); unticked rows grey out + strikethrough — for costs already covered by the mobilization region cost
8. **`mobilityState.transportSel`** `{itemIdx:bool}` (null = all); footer shows teal "SELECTED FOR EXPORT (n of m items)" subtotal when partial; export button shows live amount, disabled at zero
9. **`exportTransportToQuotation()`** sends only ticked items' total; `qMobTransport.label` notes partial ("Ferry · 3 of 5 items"); selection resets on every new search
10. New helpers: `_transportItemChecked(i)`, `_toggleTransportItem(i,chk)`, `_transportSelTotal(d)`, `_selectAllTransportItems(chk)`

### Project Cost Report — planner detail → Drive + Reports tab (commit `5d1a89e`)
11. **`qMobTransport.detail` / `qMobAccom.detail`** — exports now carry full detail (mode, route, vehicle, selected + EXCLUDED items, AI grand total, exportedAt/By, mock flag)
12. **`_saveCostDetailToDrive()`** — on every planner export, upserts `<serial> — <client> — cost detail.json` into the quotation's Drive folder (non-blocking, logged)
13. **`_pCalc` extended (both stages)** — now caches `bufAmt`, `mkAmt`, `fabContAmt`/`mobContAmt`/`instContAmt`, region-vs-planner mob split, and applied `rates`
14. **`_buildCostReportSnapshot()`** — computes revenue ex-VAT, total direct cost, est. profit, margin %; stored as `costReport` in the quotation state JSON on every save
15. **Reports → "Cost report" tab** — `renderCostReportTab()` / `loadCostReport()` / `_buildCostReportHtml()`; quotation picker → loads saved state; KPI strip (grand, revenue ex-VAT, direct cost, profit, margin %), Direct costs table, Contingency/buffer/markup/taxes table (with % rates), transport detail sub-table (excluded items struck through), accommodation detail; CONFIDENTIAL banner; rebuilds from `pCalc` for older saves
16. **`canViewCostReport()`** = Admin/Director/Manager — gates tab visibility, tab guard, and renderer

### Director role (commit `6cc2d2e`)
17. **New role** between Manager and Admin; in `posOpts` dropdowns (Users add/edit), coral pill in user lists
18. **`getDefaultAcc`** — Director defaults = same as Manager (all except Users)
19. **`isApprover()`** includes Director — approves directly via PIN, not a request
20. **Approval routing** — Director sees ALL requests across companies (`filterApprovalsByRouting`); `findApprover()` includes Directors as delegation sources + fallback pool; Directors can delegate; dashboard "Manage users" + Security settings admin views extended to Director
21. **Deferred** — fine-grained per-role authority (discount % limits, per-role PINs, escalation thresholds) to be defined later; shared PIN is still the single static `checkPin` ('1234')

### Mobilization card — planner lines + contingency/buffer/markup breakdown (commit `0945b34`)
22. **`renderMobPlannerLines(ni,mobRegionCost,mobBaseRaw,rates)`** rewritten — card now shows: Base mobilization cost → Transportation/Accommodation planner lines (each removable via ×) → Mobilization subtotal → "+ Mob. contingency (x%)" / "+ Buffer (x%)" / "+ Markup (x%)" rows using CF rates (or approved custom-CF) → "Total mobilization charge" (final marked-up amount)
23. **Display-only** — recalc's grand-total math unchanged (planner amounts already flowed through the same margin chain); the card just shows the build-up explicitly. `mob-total-q-disp` now shows `mobBaseRaw×(1+cm/100)×(1+buf/100)×(1+markup/100)`

### Pending / open activities (not yet built)
24. **Floating AI agent** — approved 2026-06-11, deferred; chat bubble on every page, role-gated context injection (profit data only for Admin/Director/Manager), 3-phase plan. See memory `project_floating_ai_agent.md`
25. **Mobilization calculator** — IN DISCUSSION (this session). User attached `MSSI_Mobilization_Installation_Pricing_Policy v4.xlsx` and wants to adopt the **mobilization** portion (not the full policy yet). Goal: replace the simple region dropdown with a shortcut button to a calculator that computes mobilization from quotation + mobility-planner inputs, applying the policy's zone cost-items and the Mobilization-vs-Installation **overlap rules**. Policy structure captured below. Awaiting design answers before building.

#### MSSI/WCLI/CWLI Pricing Policy v4 — key facts (for the mobilization calculator)
- **Definitions:** MOBILIZATION = getting people & materials to site (per trip, per zone). INSTALLATION = work on site (per carcass × zone rate, incl. QA/QC & turnover). ADMIN = 30% overhead loaded as % on the installation rate, hidden from client. Mob & Install are **always separate line items**.
- **Overlap rules (double-counting prevention) — Mobilization gets:** truck/vehicle rental, fuel & toll, sea/air freight, port handling (origin+dest), freight insurance, packing & crating, **travel-night** accommodation (night before install only), driver per diem (travel days only).
- **Installation gets (NOT mobilization):** installer base rate + carcass-type factor + zone adjustment, overtime (DOLE +25%/+30%/+100%), tools/consumables, elevator/permit, after-hours surcharge, meal allowance + per diem on **working days**, **working-night** accommodation, site cleaning, punch-list, QA/QC, client sign-off, as-built docs.
- **Manila-base zones (MSSI/WCLI):** Z1 Within Metro Manila (mob ₱5k–12k) · Z2 Provincial Luzon (₱15k–35k) · Z3 Visayas (₱40k–80k) · Z4 Mindanao (₱60k–120k).
- **Cebu-base zones (CWLI):** Cebu A Metro Cebu core (₱3.5k–9k) · Cebu B Mid-Cebu 30–80km (₱8k–18k) · Cebu C Far N/S & islands 80–150km+ (₱15k–30k) · Inter-island other Visayas from Cebu (₱20k–45k). Never flat-rate all Cebu.
- **Per-zone cost items each have Min/Max + Basis** (per trip / per day / per shipment / per person / per person/night). Full line-item tables for all 8 zones are in the attached xlsx (sheets 3, 7).
- **Quoting rules:** mobilization is one-time **per trip** (multi-trip projects charge per trip); freight insurance required for Z3/Z4/inter-island; admin never added to mobilization.

## What was changed on 2026-06-12 (session 2 — Mob calc Pass 2 + planner nav + overlap detection)

### Mobilization calculator Pass 1 refinements (commit `aa641f9`)
1. **Zone auto-adjusts on calculator open** — re-suggests from company (zone set) + project location on every open; `qMobCalc._zoneManual=true` locks the user's manual override; if zone set changes (company changes), manual flag resets
2. **"Days on site" removed** — installation concept, not mobilization; driver costs are per delivery trip only
3. **Driver per diem + Driver meals/food** — added to land-delivery zones (Z1, Z2, Cebu A/B/C) with basis `trip`; freight zones (Visayas/Mindanao/inter-island) have no company driver (cargo goes by sea/air carrier)
4. **Per-line client-handled exclusion checkbox** — every goods line has an include/exclude toggle; excluded lines grey out + strike-through + drop from total and cost report; `line.excluded` flag
5. **Packing & crating `noAi:true`** — flagged "set by you"; AI skip these in Pass 2; all lines still editable
6. **Margin summary gated to Manager/Director/Admin** — `_canSeeMobMargins()` = `canViewCostReport()`; Encoders/Staff see cost lines + final Total only; no subtotal/contingency/buffer/markup rows shown to lower roles; applied to both Stage 1, Stage 2, and cost report

### Mobilization calculator Pass 2 — AI auto-fill (commit `562d9a8`)
7. **`computeMobCalcAI()`** — new function; calls Claude Sonnet 4.6 via `_mobCallClaude()`; estimates every goods/incidentals line (except `noAi` lines) for the specific project site using zone + destination + workers + trips; mock mode fills policy midpoints when `mobAiEnabled=false`; sets `qMobCalc.aiAssisted=true`
8. **Prompt — RAW COSTS only** — explicitly instructs AI not to add markup/contingency/buffer; scoped to goods movement + incidentals only (not installer travel)
9. **AI badge on lines** — each AI-estimated line shows a teal "✨ AI" badge; hover shows the AI's note (e.g. "L300 van 1 round trip, NCR rate")
10. **AI Estimate button in calculator footer** — left side of footer; shows "AI Estimate" when AI on, "Mock estimate" when off; loading spinner while computing; "No API key" hint when key missing
11. **"Open Mobility Planner →" link** — appears in both the calculator modal (planner section header) and the mob card bar (both states); closes the calc modal then navigates to Designers Support → Mobility tab
12. **`_mobCalcAutoSyncPlannerExclusions()`** — new function; runs after transport AI results arrive; auto-unticks any planner item whose label/detail contains goods-movement keywords (cargo, truck, freight, port, crating, forwarding, trucking, balikbayan, sea/air freight); sets `it._autoExcluded=true` for badge display
13. **`_buildTransportTable()` improvements** — when `qMobCalc` is active: shows a navy info banner explaining the planner/calculator transport split; auto-excluded items show amber "⬆ in calc" badge and are pre-unticked
14. **Min-max policy hints removed from AI prompt** — AI no longer anchored to a policy range; estimates based on actual conditions; min/max kept in zone data as mock-mode fallback only (not shown to user)

### Key new globals (2026-06-12 session 2)
```javascript
// On each qMobCalc.lines[i]:
//   aiNote        — AI's explanation for its estimate (shown on hover of ✨ AI badge)
// On qMobCalc:
//   aiZoneNote    — AI's zone confirmation note
//   aiNotes       — AI's general route notes
//   _aiRunning    — boolean: true while computeMobCalcAI() is in progress
```

### Key new functions (2026-06-12 session 2)
```javascript
computeMobCalcAI()                       // Pass 2 AI auto-fill: estimates all non-noAi mob calc lines
_mobCalcAutoSyncPlannerExclusions()      // auto-unticks goods-movement items in planner results when calc is active
```

---

## What was changed on 2026-06-12 (session 3 — BOM Report + Fullscreen)

### BOM Report (commits `55a97a5`, `b22d1dd`, `8780fac`)
1. **`_collectBomData()`** — consolidates all materials + hardware across all three fab modes into `{mode, areas, consMats, consHws, totalWeightKg, totalCbm, truckSuggestion}`:
   - BOM mode: `bomItems[].materials[]` + `bomItems[].hardware[]` × `bom.qty`
   - Carcass mode: `items[].type` × qty × `dbTemplates` (or `INIT_TEMPLATES` fallback) filtered by `category==='materials'`/`'hardware'`
   - Services mode: `matItems[]` + `hwItems[]`
   - Weight/CBM added per material via `_matchMaterial()` if Logistics DB connected
2. **`_buildBomHtml(d, optLabel)`** — standalone rendered HTML report with:
   - Preliminary (Stage 1, amber) vs Final (Stage 2, green) banner based on `fqLocked||fqInitialized`
   - Navy option badge next to serial when `optLabel` set (e.g. "Option 1")
   - Price toggle button (`Hide prices / Show prices`) — shows/hides `.pc` columns via JS in saved HTML
   - Consolidated Materials table + Consolidated Hardware table
   - Green cargo weight summary block (total kg, CBM, truck suggestion) if Logistics DB matched
   - Per-area breakdown section when multiple areas have data
   - Footer with timestamp + user email
3. **`generateBomReport()`** — resolves `optLabel` from `qActiveOptionId` + `qOptionsList`; opens blob URL in new tab immediately (rendered HTML, printable to PDF); saves to Drive in background as `driveFileName(optLabel ? optLabel+' — BOM' : 'BOM')`
4. **Option-versioned Drive filenames** — no overwrite between options:
   - Base quotation: `QT-XXXX-XXXX — Client — BOM.html`
   - Option 1 active: `QT-XXXX-XXXX — Client — Option 1 — BOM.html`
5. **Blob URL instead of `webViewLink`** — Drive shows `.html` files as raw source; blob URL opens the rendered report directly; Drive file is kept as a silent backup
6. **`_computeShipmentWeight()` carcass mode** — new branch reads `dbTemplates` (or `INIT_TEMPLATES` fallback) for material weight when `fabMode==='carcass'`; matches by `t.cabinet===item.type && t.category==='materials'`
7. **Generate BOM button** — added to Stage 1 toolbar (lock-exempt, next to Preview & Print) and Stage 2 toolbar

### Fullscreen (commits `f9fffda`, `06ffa54`, `e3f2adb`)
8. **`_fsAvailable()`** — checks `document.fullscreenEnabled` (or webkit variant); returns false inside Google Sites iframe (no `allowfullscreen` on the iframe — Google controls it)
9. **`_reqFullscreen()`** — tries standard then webkit API; promise rejection surfaced as `showToast()` instead of failing silently
10. **`toggleFullscreen()`** — enter/exit fullscreen; when blocked in embed, opens app in new tab + shows toast; icon synced via `fullscreenchange` + `webkitfullscreenchange` listeners
11. **`_showFullscreenPrompt()`** — post-login modal "Yes, go fullscreen / Not now"; prompt suppressed inside embed where fullscreen can't work; `_fsPromptYes()` is a named function so rejection surfaces correctly
12. **Topbar ⛶ button** — added between avatar and Sign Out; icon toggles between maximize/minimize
13. **Works on GitHub Pages; blocked in Google Sites embed** — embed behavior: prompt suppressed, ⛶ opens app in its own tab where fullscreen works. One-time embed hint deferred (see Known remaining areas)

### New functions added (2026-06-12 session 3)
```javascript
_collectBomData()          // consolidates BOM/carcass/services materials + hardware; adds Logistics DB weight
_buildBomHtml(d, optLabel) // renders standalone HTML BOM report with price toggle + weight summary
generateBomReport()        // resolves option label → opens blob URL + saves to Drive
_fsAvailable()             // detects fullscreen permission (false inside Google Sites iframe)
_reqFullscreen()           // standard + webkit requestFullscreen with error surfacing
toggleFullscreen()         // enter/exit; new-tab fallback when blocked in embed
_fsSyncIcon()              // fullscreenchange listener — keeps topbar icon in sync
_showFullscreenPrompt()    // post-login "go fullscreen?" dialog
_fsPromptYes()             // Yes button handler — removes prompt + calls _reqFullscreen()
```

---

## Logistics DB — COMPLETED ✅ (confirmed 2026-06-13)

### Strategic rationale
Weight-based freight estimation is the core accuracy gap in the mobilization calculator. Every Philippine carrier (2GO, LBC Cargo, RoRo lines) prices by **weight (kg) + volume (CBM)**. Without these inputs the AI guesses; with them it computes. Additionally, this data will be the foundation for Phase 4 (PPIC page) — logistics team needs a dedicated reference database separate from quotation data and pricing data.

**Decision: Separate Google Sheet** — not a tab in the main DB or Price DB. Logistics team + PPIC access it independently. User creates the sheet, pastes the ID in Settings → Logistics DB tab (same pattern as Price DB).

**Status:** All functions built and confirmed present in `index.html`: `gLoadLogisticsDb`, `_computeShipmentWeight`, `_matchMaterial`, `_suggestTruck`, Settings → Logistics DB tab with inline CRUD, Initialize defaults, connected to `computeMobCalcAI()` prompt.

### Logistics DB Google Sheet structure
| Tab | Columns | Purpose |
|---|---|---|
| **Materials** | Name · Board size (4x8 / 6x8 / custom) · Length mm · Width mm · Thickness mm · Weight/sheet kg · CBM/sheet (auto-computed) · Notes | Weight lookup by board type; expandable — any material/thickness/size |
| **Trucks** | Type name · Max weight kg · Max CBM · Body type (open/closed) · Notes | Truck selection: app picks smallest truck that fits; AI uses for rental estimate |
| **Carriers** *(future Phase 4)* | Name · Route · Mode (land/sea/air) · Rate/kg · Min charge · Notes | Actual carrier rate cards for PPIC |
| **Delivery Log** *(future Phase 4)* | Serial · Date · Carrier · Weight kg · CBM · Cost · Status | Per-delivery tracking |

### Materials tab — expandable design
- **No fixed rows** — user adds any material, any thickness, any board size
- **Auto-computed CBM/sheet** = (Length mm × Width mm × Thickness mm) ÷ 1,000,000,000 (in m³)
- **Default rows pre-filled by "Initialize"** button (user can add more):

| Material | Size | L mm | W mm | T mm | Weight/sheet |
|---|---|---|---|---|---|
| MDF | 4×8 ft | 1220 | 2440 | 18 | 40 kg |
| MDF | 4×8 ft | 1220 | 2440 | 25 | 55 kg |
| MDF | 6×8 ft | 1830 | 2440 | 18 | 62 kg |
| Plywood | 4×8 ft | 1220 | 2440 | 18 | 35 kg |
| Plywood | 4×8 ft | 1220 | 2440 | 12 | 24 kg |
| Melamine board | 4×8 ft | 1220 | 2440 | 18 | 40 kg |
| HMR board | 4×8 ft | 1220 | 2440 | 18 | 42 kg |
| Compact laminate | 4×8 ft | 1220 | 2440 | 12 | 38 kg |
| Particle board | 4×8 ft | 1220 | 2440 | 18 | 37 kg |

- **User can add:** any custom material, any thickness (e.g. MDF 9mm, MDF 32mm, Hardwood 25mm)
- **Matching logic** in `_computeShipmentWeight()`: case-insensitive keyword match on material name from BOM (e.g. "MDF 18mm" → MDF row with T=18); falls back to closest thickness if exact not found

### Trucks tab — default rows
| Type | Max weight | Max CBM | Body |
|---|---|---|---|
| L300 / Multicab | 800 kg | 3 CBM | closed |
| Closed van (Canter) | 3,000 kg | 12 CBM | closed |
| 6-wheeler truck | 6,000 kg | 20 CBM | closed |
| 10-wheeler truck | 15,000 kg | 40 CBM | open/closed |

### Settings → "Logistics DB" sub-tab (new)
- Sheet ID input + Connect button (verifies access, counts rows in Materials/Trucks tabs)
- "Initialize with defaults" button — clears + writes default Materials + Trucks rows
- **Materials table** — inline add/edit/delete; columns: Name, Size dropdown (4x8/6x8/Custom), L mm, W mm, T mm, Weight kg, CBM/sheet (computed live), Notes
- **Trucks table** — inline add/edit/delete; columns: Type, Max weight kg, Max CBM, Body, Notes

### Weight computation (app-side, before AI call)
```javascript
_computeShipmentWeight()   // reads qAreas → BOM → materials[], matches to Logistics DB,
                           // sums qty × weight/sheet; also computes total CBM
                           // returns { weightKg, cbm, boards:[], breakdown:[], truckSuggestion }
_matchMaterial(name)       // case-insensitive keyword + thickness match against logisticsDb.materials
_suggestTruck(weightKg, cbm) // picks smallest truck from logisticsDb.trucks that fits; notes if multi-truck
```

### Enhanced AI prompt (with weight data)
After weight computation, the mob calc AI prompt gains:
```
Shipment cargo details:
- Total weight: ~450 kg
- Total volume: ~2.1 CBM
- Boards: 35× MDF 18mm (4x8ft), 12× Plywood 18mm (4x8ft)
- Suggested truck: Closed van (1 truck sufficient at 450 kg / 2.1 CBM)
- Origin: 88 Jennys Ave., Pasig City, Metro Manila
- Destination: Iloilo City, Iloilo (Zone 3 — Visayas; sea route required)
- Delivery trips: 1
Estimate: sea freight (2GO / RoRo / LBC), port handling (origin + destination), freight insurance, local truck port→site.
```

### Option B — carrier quote badge (for Z3/Z4/inter-island lines)
For sea freight, air freight, port handling, and freight insurance lines in Visayas/Mindanao/inter-island zones, show an amber badge: **"⚠ Formal carrier quote recommended"**. The AI estimate is based on weight/CBM; actual carrier rates vary by season and booking date. Badge appears in the calculator on those specific lines, and on the cost report.

### Globals to add
```javascript
var LOGISTICS_DB_ID = '';   // Google Sheet ID for the Logistics DB (saved in Settings sheet CONFIG row)
var logisticsDb = {         // loaded at login (like dbServices/dbMaterials)
  materials: [],            // [{ name, boardSize, lengthMm, widthMm, thicknessMm, weightKg, cbm, notes }]
  trucks: []                // [{ type, maxWeightKg, maxCbm, bodyType, notes }]
};
```

### Integration points
- `computeMobCalcAI()` calls `_computeShipmentWeight()` first; if weight data available, adds cargo section to prompt; if no Logistics DB connected, falls back to current prompt (zone + destination only)
- `logisticsDb` loaded via `gLoadLogisticsDb(cb)` called after login alongside other DB loads
- Mob calc cost report snapshot includes `shipmentWeight` and `truckSuggestion` for PPIC reference
- **Back-compat**: if `LOGISTICS_DB_ID` is empty, weight computation returns null and AI prompt uses zone-only estimation (current behavior)

### Min-max removal (mob calc lines)
- Remove `placeholder="₱X–Y"` from rate inputs in `renderMobCalc()` — no visible policy range shown
- Remove min/max from AI prompt so AI isn't anchored to a range
- Keep `min`/`max` fields in `MOB_ZONES` zone data silently (used only for mock-mode midpoint fill when AI is OFF)

### Build order
1. Settings → Logistics DB sub-tab (connect + initialize + inline table CRUD)
2. `gLoadLogisticsDb()` — load on login
3. `_computeShipmentWeight()` + `_matchMaterial()` + `_suggestTruck()`
4. Wire into `computeMobCalcAI()` — enhanced prompt when weight data available
5. Option B carrier quote badges on Z3/Z4/inter-island lines
6. Remove min-max placeholders from rate inputs in `renderMobCalc()`
7. Save `LOGISTICS_DB_ID` to Settings sheet CONFIG row

## What was changed on 2026-06-13 (session — PPIC tab + Installation cost overhaul)

### Component 1 — PPIC Page (Settings sub-tab, between Logistics DB and end of tab bar)
> **Note:** Originally built as a standalone nav tab between Orders and Clients, then immediately relocated to Settings → PPIC sub-tab in the same session (see session 2 below). The standalone `page-ppic` HTML and nav button were removed; PPIC now lives inside Settings only.

1. **`ppicSettings` global** — `{installation:{teamsPerDay, cabPerTeamDay, workdaysPerMonth}}`; saved/restored via `_collectAppSettings` / `_applyAppSettings`
2. **`_ppicCapacity()`** — computes `teamsPerDay × cabPerTeamDay`; used by `_instCalc()` instead of the old manual `INST_COST.capacityPerDay`
3. **`renderPpicPage()`** — 2 cards: Installation Capacity inputs (teams/day, cabs/team/day, workdays/month) with live capacity display + Metro/Outside Metro rate banner; Complexity Factors per CARCASS_NAME (multiplier inputs, live effective rate display). Rate Preview table is in Cost Breakdown → Installation (see session 2).
4. **`instPriceUnitForType(region, cabinetType)`** — new helper; `instPriceUnitFor(region) × complexity[type]`

### Component 2 — Settings → Cost Breakdown → Installation (enhanced)
7. **`INST_COST` extended** — added `siteFees[]`, `instQaqc[]`, `complexity{}` arrays saved with `instCost` in Settings
8. **`_instCalc()` updated** — includes `siteFeesT` and `instQaqcT` in subtotal; returns `cap` from `_ppicCapacity()`
9. **New Site & Access Fees card** — elevator/stair fee, parking/access permit, after-hours surcharge (editable rows)
10. **New Installation QA/QC card** — punch list & defect rect., final QA inspection, site cleaning, as-built documentation, snag visit
11. **Capacity display** — replaced manual input with read-only PPIC computed value + "PPIC →" link
12. **Summary table** — added Site & Access Fees and Installation QA/QC rows

### Component 3 — Mobility Planner accommodation split export
13. **`qInstPlanner` global** — `{workNightAccom, perDiem, touristPremium, touristNote, isTourist, detail}`; saved/restored with quotation state + option snapshots; reset on `initQuotation()`
14. **`qInstTouristPrem` global** — boolean toggle for tourist premium; saved with quotation state
15. **`mobilityState.accomTravelNights`** — tracks how many nights are transit (→ mob); default 1
16. **`exportAccomToQuotation()` rewritten** — opens `ov-accom-split` modal: travel nights input (→ `qMobAccom`), working nights display (→ `qInstPlanner`), tourist premium checkbox (if `tourist_area` detected), preview panel; confirm calls `_doAccomSplitExport()`
17. **`_accomSplitRefresh()`** — live preview of mob vs install split counts
18. **`_doAccomSplitExport(...)`** — splits accommodation: mob portion → `qMobAccom`, working-night accom + per diem (from `INST_COST.allowance`) + tourist premium → `qInstPlanner`; calls `recalc()` + logs activity

### Component 4 — Quotation installation card with line items
19. **`inst-card` HTML updated** — added PPIC button in header, `#inst-lines-wrap` div for line items
20. **`renderInstCardLines(ni, laborCost, unitPrice, units, qaqcAmt, workAccom, perDiem, touristPrem)`** — renders line items: Labor (N × rate), QA/QC supervision, Working-night accommodation (removable), Per diem on site (removable), Tourist area premium (removable); shows "→ Mobility Planner" hint when no planner data
21. **`recalc()` updated** — `instBase` now includes `instPlannerWorkAccom + instPlannerPerDiem + instPlannerTourist` from `qInstPlanner`; calls `renderInstCardLines()` after computing

### New globals added (2026-06-13)
```javascript
ppicSettings      // {installation:{teamsPerDay, cabPerTeamDay, workdaysPerMonth}}
qInstPlanner      // {workNightAccom, perDiem, touristPremium, touristNote, isTourist, detail}
qInstTouristPrem  // boolean — tourist area premium toggle on inst card
// INST_COST additions:
//   siteFees    — [{label, cost}] — Site & Access Fees
//   instQaqc    — [{label, cost}] — Installation QA/QC activities
//   complexity  — {cabinetName: factor} — per-type installation multiplier
// mobilityState additions:
//   accomTravelNights — number of transit nights going to mobilization (default 1)
```

### New functions added (2026-06-13)
```javascript
_ppicCapacity()                        // teamsPerDay × cabPerTeamDay; fallback to INST_COST.capacityPerDay
instPriceUnitForType(region,type)      // instPriceUnitFor(region) × complexity factor
renderPpicPage()                       // renders full PPIC page content
renderInstCardLines(ni,labor,...)      // renders inst-card line items from INST_COST + qInstPlanner
_accomSplitRefresh()                   // live preview of travel/working night split in modal
_doAccomSplitExport(nights,workers,...) // commits the accommodation split to qMobAccom + qInstPlanner
```

## What was changed on 2026-06-13 (session 2 — PPIC relocation + Rate Preview move)

### PPIC relocated to Settings sub-tab
1. **Standalone nav button removed** — `<button data-pg="ppic">` removed from the top nav bar
2. **`page-ppic` standalone HTML removed** — the full-page div and its sticky header were removed
3. **Settings tab button added** — PPIC is now the last tab in the Settings tab bar: `<button onclick="setStTab('ppic')">PPIC</button>`
4. **`st-ppic` div added** — inside the Settings page; `renderPpicPage()` renders into its `ppic-wrap` child
5. **`setStTab()` updated** — added `'ppic'` to the tabs array; `if(t==='ppic') renderPpicPage()` fires on open
6. **`ppic` removed from `navigate()`, `canNavigate()`, `applyNavAccess()`** — all three guards cleaned up
7. **All `navigate('ppic')` call-sites fixed** — the PPIC button on the Installation card now calls `navigate('settings');setTimeout(function(){setStTab('ppic');},150)` (was `navigate('ppic')`)
8. **"Cost Breakdown" button fixed** — the button inside `renderPpicPage()` now calls `_cbdSubTab='installation';setStTab('costbreakdown')` directly (previously called `navigate('settings')` which navigated away from Settings and back, losing the PPIC tab state)

### Acronym fix: Installation Control → Inventory Control
9. **PPIC acronym corrected** — "Production, Planning and **Inventory** Control" (was "Installation Control"); the incorrect text was only in the now-removed `page-ppic` sticky header paragraph

### Rate Preview moved to Cost Breakdown → Installation
10. **Rate Preview card removed from `renderPpicPage()`** — the 13-type × metro/outside table is no longer shown in PPIC
11. **Rate Preview added to `renderInstCostBreakdown()`** — appended after the "Daily Cost Summary & Price per Unit" panel; computes `_rpMetro = instPriceUnitFor('metro')` and `_rpOutside = instPriceUnitFor('outside')` freshly at render time; shows all CARCASS_NAMES with their complexity factor and effective rates
12. **Cross-link** — Rate Preview header shows "Complexity factors set in Settings → PPIC" as a link; PPIC's "Cost Breakdown" button links back
13. **"PPIC →" button in summary fixed** — the Capacity row in Cost Breakdown → Installation summary called `navigate('ppic')` (broken); now calls `setStTab('ppic')`

## Known remaining areas to watch
- **PENDING — Embed fullscreen hint (deferred 2026-06-12)** — fullscreen works on GitHub Pages but is impossible inside the Google Sites iframe (no `allowfullscreen` attribute; Google controls it). Current behavior: prompt suppressed in embed; topbar ⛶ opens the app in its own tab. TO BUILD LATER: a small one-time hint after login inside the embed ("Want fullscreen? Open the app in its own tab →") so users discover the ⛶ route
- **Blank PDF on Send email** — RESOLVED ✅ (confirmed 2026-06-13)
- **Carcass pricing tab** — now persisted ✓
- **Drive saves in Google Sites embed** — RESOLVED ✅ (confirmed 2026-06-13)
- **First-time setup flow** — user needs to: sign in → Settings → Test connection → Create missing tabs → Save settings
- **Google Sites iframe cache** — after pushing a fix, the embed shows stale version; fix: edit the Google Site, append `?v=N` (increment N each time) to the embed URL, republish
- **Cross-session approval apply** — `_applyApprovedRequest()` updates the quotation form only if it is open in the same browser session; requester must navigate away and back to see the approved state if they were on a different page when approval happened
- **User Roles sheet column R** — Claude API key is stored in header row column R (index 17); this is the same column used by the `Projects` ACC_KEY for data rows — no conflict because Claude key is only read from `rows[0]` (header) and ACC_KEY data is read from `rows[1+]` (data rows)
- **`_localActions` guard duration** — approval/counter actions are guarded for 30 s against poll revert; if the Sheets write takes longer than 30 s (network issue), the next 60 s poll may briefly revert the status before the write completes
- **`SERVICES.price` deferred** — price field kept in Services tab for now; it is actively used by `getAreaSubtotal()` for services-mode cost calculation; editable in Cost Breakdown card header; full redesign deferred to Phase 3
- **Semantic duplicates in Price DB** — "Clean duplicates" button only catches exact-name matches; user must manually standardize semantically similar service names using the amber similarity highlight in Settings → Services tab
- **Wufoo attachment via Drive (DONE ✓)** — API key `FCNJ-5BIO-MQJW-HKKK` deployed; Drive OAuth approved; new submissions automatically upload to Team Drive; fetch URL directly (no auth header — S3 pre-signed URL)
- **Phase 2 Cost Breakdown — output/shift not yet set** — most services still have `outputPerShift=0`; until this is filled in Settings → Services, monthly capacity = 0 and Op Cost / Gross Margin show `—` in Cost Breakdown
- **Phase 3 onward** — capacity wired to schedule load checks (Phase 3), PPIC page (Phase 4), profitability reports (Phase 5) all pending

## What was changed on 2026-06-13 (session 2 — Cost formula redesign + Settings cleanup)

### Cost formula redesign — per-component buffer/markup (commits `cc91fcd`, `ff993d9`, `fdefc36`)
1. **Old global `buf` / `markup` CF fields removed** — replaced by per-component chains for each cost pool
2. **New CF fields added:**
   - `fabContingency`, `fabBuffer` (applied when install is included)
   - `mobContingency`, `mobBuffer`, `mobMarkup`
   - `instContingency`, `instBuffer`, `instMarkup`
   - `discountBuffer` (applied to combined total — absorbs future discounts)
   - `mssiCommPct` + `mssiCommissionEnabled` (MSSI user + CWL subsidiary client trigger)
   - `designersCommPct` + `designersCommissionEnabled` (fab+install quotations when activated)
3. **Formula chain (Stage 1 & 2):**
   ```
   fabC  = fabBase × (1+fabCont%) [× (1+fabBuf%) when install included]
   mobC  = mobBase × (1+mobCont%) × (1+mobBuf%) × (1+mobMk%)
   instC = instBase × (1+instCont%) × (1+instBuf%) × (1+instMk%)
   combined = fabC + mobC + instC + design + other
   discBufAmt = combined × discountBuffer%
   subtotal = combined + discBufAmt
   mssiCommAmt = subtotal × mssiCommPct% (when MSSI user + CWL subsidiary + enabled)
   designerCommAmt = subtotal × designersCommPct% (when fab+install + enabled)
   preDisc = subtotal + mssiCommAmt + designerCommAmt
   → discount → VAT → grand total
   ```
4. **Custom CF override modal** — redesigned from 2 fields to 9 fields (one per new component); `_setCCFFields(src)` + `_readCCFFields()` helpers added; PIN-gate unchanged
5. **Settings → Cost Factors UI** — redesigned into labeled sections (Fabrication / Mobilization / Installation / Grand Total / VAT & Premiums / Commissions)
6. **Cost Factors moved inside Cost Breakdown** — now the first sub-tab of Cost Breakdown (alongside Services, Installation, Mobilization); `setStTab('pricing')` auto-redirects to Cost Breakdown → Cost Factors for backward compat
7. **Service cost breakdown data loss fixed** — added explicit `serviceCostData` backup key to `_collectAppSettings()`; `_applyAppSettings()` merges it into `SERVICE_CAPACITY` before re-syncing; fixes race condition where Price DB load could clobber restored service cost data
8. **Blank Cost Factors sub-tab fixed** — removed old hidden `<div id="st-pricing">` that `document.getElementById` found first, causing content to render into invisible div

### CF redundant fields cleanup — Cost Factors tab (commits `dcf97c0`, `905a122`)

#### "Labor & capacity basis" card removed (commit `dcf97c0`)
- **`CF.laborCostPerDay`** — removed from UI; not used in any cost calculation (INST_COST.labor per-role rows handle installation cost)
- **`CF.laborCount`** — removed from UI; superseded by `_instLaborPersons()` which counts from Labor card rows
- **`CF.capacityPerDay`** — removed from UI; PPIC `teamsPerDay × cabPerTeamDay` is now sole authority via `_ppicCapacity()`
- **`CF.workdaysPerMonth`** — removed from CF UI; all computation reads now use `ppicSettings.installation.workdaysPerMonth`; the "Working days / mo" input in Cost Breakdown → Services overhead now writes to PPIC
- **Amber "computed labor cost per unit" display** — removed (was a remnant; formula ₱800×4÷3 didn't feed into any calculation)

#### "Admin, overhead & operating cost factors" card removed (commit `905a122`)
- **Monthly cost fields** (adminMonthlyCost, utilityCost, otherExpenses, packingCost) — removed from Cost Factors; these inputs already exist in Cost Breakdown → Services overhead card (their actual home); `CF` fields retained for persistence
- **Percentage fields** (adminPct, overheadPct, consumablesPct, utilitiesPct) — removed entirely; had zero usage in any calculation since Phase 2 per-service cost breakdown replaced them

#### Single source of truth after cleanup
| Setting | Owned by |
|---|---|
| Capacity (units/day) | PPIC → teams × cabs/team |
| Workdays per month | PPIC → Working days / mo |
| Team composition & cost | Cost Breakdown → Installation → Labor rows |
| Monthly overhead costs | Cost Breakdown → Services → overhead card |

### "Outside Metro — Additional Costs" removed from Cost Breakdown → Installation (commit `4b5da1a`)
- `outsideT` was hardcoded to `0` with comment "zone add-ons handled in _instCalcForZone; keep for back-compat" — never computed
- Enable toggle, row editor, summary table row, display refresh calls all removed
- `INST_COST.outsideMetro` definition and restore-from-state code kept for backward compat with old saved quotations
- Zone-based add-ons are handled by the mobilization calculator and zone rates, not this section

## Development workflow
```bash
# Local preview (Claude testing)
# Uses preview_server.ps1 on port 8766, serves index.html

# Deploy
git add index.html
git commit -m "description"
git push origin main
# GitHub Pages auto-deploys to https://rotaligatos.github.io/modcraft-app/
# Takes ~90 seconds; poll with: curl -s URL | grep -q "some-new-string"
```

## Testing approach
- Use the `preview_start` / `preview_eval` MCP tools to load `index.html` locally
- Mock `window.gApiFetch`, `window.sheetsGet/Append/Update`, `window.gToken` for unit tests
- Always verify no console errors after changes
- Always commit + push after verified changes
