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

## What was changed on 2026-06-14 (session — Lami voice overhaul + user-to-user messaging)

### Lami TTS rewrite — fix choppy/rattling voice
1. **Sentence-chunked TTS queue** — replaced the single-utterance `_chipSpeak` with a queue system: `_ttsSplitChunks(str)` (splits at sentence boundaries `.!?`+space+capital, then commas, max 150 chars/chunk — keeps `₱1,234.56` intact), `_ttsPump()` (speaks next chunk, 60 ms gap between chunks), `_ttsAppendClean(text)` (enqueue without cancelling — for streaming), `_ttsCancel()` (clear queue + `synth.cancel()`), `_chipSpeak(text)` (one-shot: cancel + enqueue)
2. **Removed the `pause()/resume()` keepalive interval** — it was the actual cause of micro-stutters; short chunks + gaps are enough for Chrome
3. **Globals:** `_ttsQueue`, `_ttsSpeaking`

### Lami voice selector (Settings → Lami → Voice)
4. **Pick any installed system voice** — `_chipVoicePresetId` saved to `localStorage` `mc_lami_voice_id`; `_chipPickVoice()` honours it first; lists all voices (English first, others tagged by lang), Neural badge for online voices, ▶ Preview per voice, ↻ Refresh, ✕ Reset to auto
5. **`_lamiSetVoice(name)` / `_lamiPreviewVoice(name)`** — set + audition; tip in UI to install Microsoft Guy/Mark on Windows for a deep "Jarvis" voice. ElevenLabs/custom-voice API is a saved future idea (memory `project_elevenlabs_voice.md`)

### Conversation Mode (Settings → Lami)
6. **`lamiConvMode`** (`'continuous'` | `'wakeword'`, saved to `mc_lami_conv`) via `_lamiSetConvMode(m)`
7. **Continuous (Loop)** — after "Hi Lami", mic stays on in loop until manually stopped
8. **Wake Word (5-second window)** — `_lamiWakeFollowListen()` listens once with a 5 s silence fallback (`_lamiFollowTimer`); after each exchange reopens a 5 s window; silence → back to standby

### Loop mic reliability + intent gate + barge-in
9. **Restart mic only after TTS drains** — `_lamiPendingRestart` flag; `_ttsPump` drain calls `_lamiResumeAfterTts()` (routes to loop listen or wake-follow). Fixes loop hearing itself / dying after one exchange
10. **Intent gate (continuous mode)** — `_lamiIsAddressed(t)`: speech reaches the API only if it mentions "Lami" (incl. mishearings lammy/lommie/laffy) OR is within the engaged window `_lamiEngagedUntil` (9 s after each exchange, 12 s after wake word). Background chatter no longer triggers API calls. `_lamiVoiceTurn` marks voice turns
11. **Barge-in** — tapping the mic while Lami speaks cancels TTS (`_lamiBeginListen` calls `_ttsCancel()` if speaking); `_lamiStartVoice` also cancels
12. **Broadened wake-word regex** — `(hi|hey|ey|hello|yo)\s+(la+mi+|lami|lammy|lommie|laffy)`

### Streaming AI responses (the big latency win)
13. **`_chipCallAI` now streams** — `stream:true` SSE parse via `resp.body.getReader()`; text appears in the bubble as it arrives and each completed sentence is spoken immediately (sub-second perceived latency vs 2–3 s). Markers (`[NAV]`,`[SEARCH]`,`[CALLME]`,`[MSG]`) held back from speech mid-stream via `_stripMarkers(s,streaming)` (hides dangling `[…`)
14. **Brief-when-voice** — voice turns get `max_tokens:320` + a "1–2 short spoken sentences, no markdown/lists" instruction; typed turns keep `max_tokens:900`
15. **Token usage** captured from `message_start` (input) + `message_delta` (output) → `_tkRecord('chat',…)`

### User-to-user messaging (Lami relay + inbox + email fallback)
16. **New `Messages` sheet tab** (auto-created via `gEnsureMessagesTab`/`_msgCreateTab`) — 11 cols: ID, Created At, From Email, From Name, To Email, To Name, Message, Priority, Status, Read At, Context (`MSG_HDR`)
17. **Core fns:** `gSendMessage(toEmail,toName,text,priority,ctx,cb)` (append row + email fallback + logActivity), `gLoadMessages(cb)` (rows where I'm sender or recipient → `messagesData`), `_msgMarkRead(id)`, `_msgUnreadForMe()`, `_updateMsgBadge()`
18. **✉ envelope button + panel** — left of the notification bell (`msg-btn`/`msg-cnt`/`msg-panel`); `toggleMsgPanel`/`closeMsgPanel`/`renderMsgPanel`; built-in composer (recipient `<select>` from `sheetUsers`, textarea, Urgent checkbox, Send → `_msgComposeSend`) + thread list (sent + received, opening marks incoming read)
19. **Attention on arrival** — 45 s poll (`_msgPollTimer`) → for new unread-to-me: `_msgAttention(m)` = toast + chime (`_msgPlayChime`, WebAudio, sharper 3-note for urgent) + envelope pulse + voice announcement if `chipVoiceOn`. Pre-existing messages baselined into `_msgSeen` at login so they don't re-toast
20. **Lami relay** — system prompt MESSAGING rule + `[MSG:recipient|priority|text]` marker; `_chipHandleMsgMarker(raw)` resolves recipient via `_resolveRecipient(q)` (email/full-name/first-name/contains; returns `{ambiguous:[…]}` when >1 match → Lami asks which); recipient roster injected via `_lamiRecipientList()`
21. **Email fallback** — `_sendMessageEmail(toEmail,fromName,text,priority)`: if `MSG_MAILER_URL` set → silent `fetch(..., {mode:'no-cors'})` POST `{to,subject,body}` to a Google Apps Script web app (`MailApp.sendEmail`); else opens Gmail compose for **urgent** only. URL field + **Send test** button (`_msgTestMailer`) in Settings → Lami → Messaging (Admin/Director only); persisted as `msgMailerUrl` in `_collectAppSettings`/`_applyAppSettings` (Settings sheet CONFIG → shared across users)
22. **GAS mailer (Option B, standalone)** — separate Apps Script project, `doPost` parses JSON + `MailApp.sendEmail`, `doGet` health check; deployed as Web App (Execute as: Me, Access: Anyone); paste the `/exec` URL into Settings. **Confirmed working 2026-06-14.** Note: `no-cors` means the app can't read the response — the toast confirms the request was sent, not delivery

### New globals (2026-06-14)
```javascript
lamiConvMode            // 'continuous' | 'wakeword'
_chipVoicePresetId      // saved TTS voice name
_lamiFollowTimer        // wake-word 5 s follow-up timer
_lamiPendingRestart     // restart loop mic after TTS drains
_lamiEngagedUntil       // continuous-mode intent-gate window (epoch ms)
_lamiVoiceTurn          // current turn came from voice → brief reply
_ttsQueue, _ttsSpeaking // TTS chunk queue state
MSG_HDR, messagesData, _msgSeen, _msgTabReady, _msgAudioCtx, MSG_MAILER_URL
```

## What was changed on 2026-06-16 (session — PIN enrollment, approval routing, Users→Settings, CF override redesign)

### PIN enrollment + per-user PIN verification (commit `9268dfa`)
1. **SHA-256 + salt PINs** — `_pinHash(pin,salt)`, `_pinVerify(pin,hash,salt)`, `_pinGenSalt()` using browser-native `crypto.subtle.digest`; no plaintext PINs anywhere
2. **User Roles sheet extended A:V → A:X** — col **W(22)=pin_hash**, **X(23)=pin_salt**; all `sheetsGet/Update/Append/Clear` ranges updated; `parseUserRows` reads cols 22–23 into `pinHash`/`pinSalt`; `saveUserRow` + `submitAddUser` write them (blank on add)
3. **Avatar dropdown** — the topbar avatar is now a clickable dropdown (`toggleAvatarMenu`/`closeAvatarMenu`): "Set / Change PIN" (Manager/Director/Admin only via `isApprover()`) + Sign out; the old standalone Sign Out button moved inside it
4. **`ov-set-pin` modal** — `openSetPinModal()` / `submitSetPin()`; first time = new PIN + confirm; thereafter must enter current PIN to change; writes to User Roles cols W:X via `sheetsUpdate`
5. **Reset PIN (Admin/Director only)** — `resetUserPin(i)` button per Manager/Director/Admin row in the Users page; clears hash/salt; sends an urgent in-app message to the user; PIN set/unset badge shown per row
6. **Named-approver validation** — `_pinModalApprover` global holds the approver being validated; `_verifyApproverPin(pin)` (async) hashes against that approver's stored salt; falls back to legacy `"1234"` when no PIN set (with an amber "no PIN" warning); `_openPinModal(ovId,pinId,errId)` sets the modal label to "Enter [Name]'s PIN" and shows the warning
7. **All approval modals updated to async PIN verify** — `confirmVat`, `confirmDisc`, `confirmPremium`, `confirmRevise`, `confirmUnlock`, `confirmCustomCF`, `_acexSubmit`, `doApprovalAction`, `fqOnNonVat`, `fqOnDiscRequest`, `onPremiumRequest` all set `_pinModalApprover=findApproverForSelf()` before opening and call `_verifyApproverPin().then(...)`
8. **`checkPin(val)` kept** — legacy `val==='1234'` retained only for non-modal callers; modals use `_verifyApproverPin`

### Approval routing (commit `9268dfa`, gated `15ce52d`)
9. **`APPR_ROUTING` global** — `{ company: { nonvat, discount, override, premium }: approverEmail }`; saved as `approvalRouting` in `_collectAppSettings` / restored in `_applyAppSettings` (Settings sheet CONFIG row)
10. **Settings → Approval Routing tab** — `renderApprovalRoutingSettings()` renders a table (action type × company) of dropdowns listing active Manager/Director/Admin; `_setApprRoute(co,type,email)`; Save via `gSaveAppSettings()`
11. **Admin/Director only** — tab hidden in `applyNavAccess()` (`st-tab-approvalrouting`) and the renderer shows a lock message for other roles
12. **`findApproverForAction(type)`** — resolves approver: APPR_ROUTING[company][type] → delegation chain (Director/Admin → any Manager; Manager → any Manager/Supervisor; **cross-company**) → first active Manager/Director/Admin (not self)
13. **`findApproverForSelf()`** — returns the current user's own `sheetUsers` entry (for self-approval PIN)
14. **No-approver fallback** — when `findApproverForAction` returns null, `submitApprovalRequest` notifies the Admin via in-app message and toasts; no silent failure
15. **`sheetUsers` populated at login** — **critical fix (commit `a7e3cd9`)**: `gCheckRole()` now calls `sheetUsers=parseUserRows(rows)` after reading User Roles. Previously `sheetUsers` was only populated when Settings → Users was opened, so `findApproverForSelf()` returned null and every approval PIN failed

### Users page relocated to Settings (commit `ed0982f`)
16. **Standalone `Users` nav button removed**; `page-users` content moved into a new **Settings → Users** sub-tab (`st-users`); `st-tab-users` button added to the Settings tab bar
17. **`setStTab('users')`** loads `loadUsersFromSheet()`; `navigate('users')` redirects to `navigate('settings')`+`setStTab('users')`; tab visible to Admin/Director only (in `applyNavAccess`); `canNavigate('users')` allows Admin **and Director**

### CF override redesign — reason-only request + approver-side profit calc (commits `2f915c5`, `b6650c5`, `baf7a82`)
18. **Two distinct paths in `openCustomCF()` / `fqOpenCustomCF()`**:
    - **Non-approver** → `ov-cf-request` modal: a single reason textarea (NO cost-factor numbers shown — too sensitive for basic users); `_submitCFRequest()` sends `openSendRequest('override',{reason})`. Request carries only the reason (no `cfValues`)
    - **Approver** → full `ov-custom-cf` modal with the cost factor fields + PIN
19. **Live Sale / Cost / Profit summary** — `_ccfUpdateProfit()` (fires on every field `oninput`): Sale (ex-VAT) = combined cost after the entered factors + discount buffer; Est. direct cost = fab+mob+inst+design+services raw bases from `_pCalc`; Est. profit + margin % (teal ≥30%, amber ≥15%, coral <15%). **Uses `fmtMoney` not `fmtP`** (the `fmtP` ReferenceError silently aborted the modal — fixed in `b6650c5`)
20. **Approver acts on a routed request** — `openApprovalAction(idx)` detects `type==='override'` and opens `openCustomCFFromRequest(note,from)` (shows the requester's note banner `ccf-req-note`) instead of the generic approve/reject box; `_pendingOverrideNotifIdx` tracks it; on `confirmCustomCF` success, `_markOverrideApproved(idx,cfObj)` sets status=approved, notifies the requester via in-app message, and persists to Sheets
21. **Lami announces incoming requests** — the 60 s approval poll now calls `_chipSpeak('You have a new … request from … for quotation …. They said: …')` when `chipVoiceOn`, alongside the existing toast
22. **Override card gated to Fab + Installation** (commit `baf7a82`) — `ccf-card` shown only when service = "Fabrication with Installation"; hidden in `onServiceChange()` + `initQuotation()`. Rationale: for fabrication-only quotes, mob/inst factors multiply a zero base and fab buffer is `ni`-gated, so the override has almost no effect
23. **Discount buffer gated to Fab + Installation** — in both `recalc()` and `recalcFQ()`, `discBuf = ni ? (aCF.discountBuffer||0) : 0`; a fabrication-only quote no longer bakes in the discount buffer

### New globals (2026-06-16)
```javascript
APPR_ROUTING            // { company: { nonvat,discount,override,premium }: approverEmail }
_pinModalApprover       // {name,email,pinHash,pinSalt} — approver being validated in the open modal
_pendingOverrideNotifIdx// NOTIFS index of the override request the approver is currently actioning (-1 = none)
// On each sheetUsers[i]: pinHash, pinSalt (User Roles cols W/X)
```

### New functions (2026-06-16)
```javascript
_pinHash(pin,salt) / _pinVerify(pin,hash,salt) / _pinGenSalt()
_verifyApproverPin(pin)              // async; validates against _pinModalApprover's stored PIN (or legacy 1234)
_openPinModal(ovId,pinId,errId)      // sets "Enter [Name]'s PIN" label + no-PIN warning
toggleAvatarMenu(e)/closeAvatarMenu()
openSetPinModal()/submitSetPin()
resetUserPin(i)                      // Admin/Director: clear a user's PIN + notify them
findApproverForSelf()                // current user's sheetUsers entry
findApproverForAction(type)          // APPR_ROUTING → delegation → fallback
renderApprovalRoutingSettings()/_setApprRoute(co,type,email)
openCustomCFFromRequest(note,from)/_ccfShowReqNote(note,from)
_ccfUpdateProfit()                   // live Sale/Cost/Profit on the approver CF modal
_submitCFRequest()                   // non-approver: send reason-only override request
_markOverrideApproved(idx,cfObj)     // mark routed override request approved + notify requester
```

### Open items deferred (2026-06-16)
- **Fine-grained per-role authority** (discount % limits, per-role PINs, escalation thresholds) still deferred; routing assigns a single named approver per action+company
- Approval routing currently covers 4 action types: `nonvat`, `discount`, `override`, `premium`

## What was changed on 2026-06-20 (session — Cabinet POC: all types plant-verified + corner base + board/material rules)

> All work this session is in the **standalone** `poc_cabinet.html` (Drawing Intelligence Pipeline Phase 1/2 proof-of-concept) and `WCLI_shop_standards.md` — NOT the deployed `index.html`. This clears the long-standing **"verify the 4 new cabinet types with production"** open item.

### Cabinet types verified/refined with the plant (base, wall, tall, drawer, sink) — now CONFIRMED
1. **Wall cabinet** — 18mm full top/bottom/side panels; backing by material (MDF/PB 3 or 6mm, **plywood 5mm**), grooved + recessed 18mm; **2 rear rails** (~¼H up from bottom, ~¼H down from top); **plastic suspension brackets (×2) + steel wall plates (×2)** screwed to side panels.
2. **Tall/pantry** — base-style (solid 18mm top/bottom/sides); **3–4 rear rails evenly distributed, ONLY when backing is thin** (none with 18mm solid back); doors single/double/**pull-out larder**.
3. **Drawer base** — drawer box **15mm** boards incl. bottom (was 6mm ply); **18mm** face; slide/guide **13mm/side → box width = inner − 26mm**; **guide 50mm shorter than cabinet depth** (clears backing); drawer-box **top edge EBT** (`1l`); full bottom panel.
4. **Sink/open base** — base-style with **18mm bottom**; **2 back rails at top & bottom of the backing** (centre left clear for the plumbing hole); **no shelves**; **never uses 18mm backing** (18mm option disabled for sink, snaps to 6mm).
5. **Cross-cutting rules confirmed:**
   - **Backing → rails:** thin (3/5/6mm) grooved = support rails; **18mm flush backing = NO rails** (universal — would protrude past the panel edge).
   - **Screw counts (4×50 HiLo):** bottom panel **4** · solid top **4** · **each rail 4** (2 per end) · 18mm solid back **8** · thin grooved back **none**.
   - **Adjustable-shelf pin holes:** 2 rows per side panel (**35mm from front, 35mm from back**), **3 holes/shelf @ 50mm pitch** (12 holes/shelf); **shelf depth = cabinet depth − 20mm**.

### Corner base (L-shape) — NEW type, built iteratively against plant photos/feedback (CONFIRMED)
- **True L-shape:** outer A1×A2, each leg D deep, notch (A1−D)×(A2−D) at the room-facing corner; door openings = legLen − depth. UI: **Width = left leg, Right leg width = back leg, Depth = leg depth**.
- **Doors:** bi-fold OR two separate (new "Bi-fold (corner)" door option).
- **Bottom + shelves = ONE L-shaped (notched) piece each** — rendered as a single **extruded polygon** (new renderer path: `part.poly` + `polyY` levels), not two boxes (no seam). Shelves are **housed/penetrate the side panels**.
- **Special cut:** any L/notched piece flagged **SPECIAL CUT** (can't stop a saw mid-panel → cut from a bounding-rectangle blank, notch = waste).
- **Backing on the LEFT side only** (optional thin grooved + centre support rail in the rear recess); **every other panel is an 18mm side panel** (even the one facing the wall). The left backing (18mm or thin) is **captured between the perpendicular side panels** (inset, recessed 18mm), same length as the rail on it — no exposed edge.
- **Assembly correctness:** all vertical panels **butt-joint** (no overlap/exposed double edges); internal members (bottom, shelves, rails, fascia) **inset between panels** (no protrusion); **bottom captured between the sides** (not sitting on top). Right side (back-leg end) panel length = its top rail length.
- **3 top rails, all parallel** (front-to-back): on the left backing, in front of the left door (full length to side panel), on the right side panel.
- **Fascia** = horizontal door stopper on top of each door opening.

### Board / material rules (wired into the POC engine)
- **Material + Board-size selectors:** PB/MDF/Plywood → **4×8 / 6×8**; Compact laminate → **6×6 / 6×7 / 6×8**.
- **Compact laminate → no EBT** (all edge banding forced to N/A; used for toilet partitions + vanity).
- **Component division rule:** a component stays ONE piece; it is divided **only when bigger than the board in use**. Over-board pieces are flagged and **auto-split** along the longer side into the fewest equal parts that fit (min 2) — shown as separate cut-list rows (`split n/of`, `SPLIT Npc` badge); the **3D still shows the assembled whole piece**.
- Distinct concepts in the cut list: **SPECIAL CUT** (L/notched) vs **SPLIT** (over-board).
- **Tall cabinet over 8ft → stacked modular cabinets** (added 2026-06-20, distinct from panel auto-split): when a tall cabinet's height > **8ft (2440mm)**, it is NOT one carcass with split panels — `buildTall` divides it into **N = ceil(H/2440) stacked modular cabinets** (each a *complete* cabinet via `buildTallSingle`), each H/N tall (so its panels fit the board). Only the **bottom module** gets toe kick + legs; modules are **joined cabinet-to-cabinet with 4×32 screws**. Cut-list parts are labelled `[Module n/N]`; 3D shows the stack. (`buildTall` is now a modularizing wrapper; the original single-cabinet builder is `buildTallSingle`; global `MODULE_MAX=2440`.)

### Key `poc_cabinet.html` additions this session
```javascript
buildCornerBase(p)        // L-shape corner: butt-jointed panels, 1-pc L bottom/shelf, 3 parallel rails, fascia, bi-fold/separate doors
// renderer: part.poly (x-z outline) + polyY (y levels) → single ExtrudeGeometry (one-piece L)
BOARDS / MATERIAL_BOARDS  // board catalogue + per-material board list
fitsOnBoard(L,W,bd)       // does a piece fit a board (either orientation)
splitForBoard(L,W,bd)     // split over-board piece along longer side into fewest equal parts (min 2)
updateBoardOptions()      // repopulate board dropdown when material changes
// part flags: specialCut (L/notched), poly/polyY (extruded shape), qty (one-piece count)
```

### Status & next (Drawing Intelligence Pipeline)
- **6 cabinet types now plant-verified:** base, wall, tall, drawer, sink, corner.
- All confirmed rules captured in `WCLI_shop_standards.md` (dated sections per type + cross-cutting rules + board/division/compact rules).
- **Next options:** more cabinet types (corner wall, oven/appliance tower, open shelf, microwave) · refine split (joint allowance / nesting) · or pivot to Phase 4 (AI reads elevation → feeds the engine).

## What was changed on 2026-06-20 (session 2 — 4 more cabinet types: corner wall, oven tower, open shelf, microwave)

> Continues the `poc_cabinet.html` / `WCLI_shop_standards.md` work. Went WIDE — scaffolded 4 more types, then refined each against plant feedback. **9 cabinet types now in the POC** (base, wall, tall, drawer, sink, corner base, corner wall, open shelf, microwave) + oven tower on hold.

### New build functions (`poc_cabinet.html`)
```javascript
buildCornerWall(p)   // corner base L-shape as a WALL unit
buildOvenTower(p)    // tall appliance tower (oven cavity)
buildOpenShelf(p)    // doorless cabinet, floor or hanging
buildMicrowave(p)    // hanging cabinet + microwave cavity
```
Dropdown options + dispatcher cases + `applyTypeUI`/`typeDefaults` updated; **Mount** dropdown (`p-mount`, floor/wall) added for open shelf; wall-mounted types (`wall`/`cornerwall`/`microwave`) set `tk=0` in render.

### Corner wall — CONFIRMED (wall construction on the L-shape)
- Same L-shape as corner base (one-piece L bottom, special cut, fascia, bi-fold/separate doors), but **wall-mounted: no toe kick/legs**.
- **Solid L top panel** (one piece, captured between sides) — NOT the corner base's 3 top rails.
- **Backing = wall-cabinet method:** thin grooved + **2 back rails at ~¼ and ~¾ height** (replaces the single centre rail); 18mm → no rails.
- **3 suspension brackets** (+ 3 wall plates) on the top corners of the 18mm side panels.

### Corner shelves — fix (both corner base + corner wall)
- L-shelf was protruding past the recessed thin backing. Added `shelfPoly` that insets the left edge to the **front face of the recessed backing** (`x = 18+bThk` when thin, else `x = t`).

### Open shelf — CONFIRMED (doorless cabinet, Mount toggle)
- **Floor → base-cabinet construction; Hanging → wall-cabinet construction** — just no doors. `buildOpenShelf` delegates to `buildBase`/`buildWall` with `door:'none'` + `tk` override. No new geometry.

### Microwave / appliance cabinet — CONFIRMED (hanging)
- Uses **hanging (wall) construction** (`buildWall`, doors off) + a **lower open microwave cavity**, a **divider shelf** (depth clears the recessed backing), and an **upper door**.

### Oven / appliance tower — ON HOLD (partial)
- Applied 2 user findings: **backing = tall-cabinet method** (thin grooved + 3–4 rear rails, none for 18mm), and the **appliance base shelf depth reduced to clear the recessed backing** (fixed a rear protrusion).
- **User is finalizing the rest with their team** — cavity sizing, door/drawer config, appliance framing still to refine before it's confirmed.

### Standards doc
`WCLI_shop_standards.md` now has confirmed sections **§11 Corner wall, §12 Open shelf, §13 Microwave** (oven tower not yet a confirmed section — on hold).

## What was changed on 2026-06-20 (session 3 — 5 more scaffold types, all PARKED pending verification)

> Continued going wide. Scaffolded 5 more cabinet types into `poc_cabinet.html` as **first-pass best-guesses**, then the user chose to **PARK all of them** (not yet plant-verified) and move on to other development. **None are confirmed; none are in `WCLI_shop_standards.md` yet.**

New build functions (best-guess geometry — to verify with plant before confirming):
```javascript
buildBlindCorner(p)     // base carcass + partial door + fixed BLIND filler panel (corner access blocked by adjacent cabinet)
buildDrawerDoor(p)      // base + top drawer over a lower door
buildFridgeSurround(p)  // tall: open fridge void (no bottom) + upper bridging cabinet w/ door
buildWardrobe(p)        // tall furniture: hat shelf + hanging rod + double doors
buildFiller(p)          // single flat trim panel (filler / end panel)
```
Dropdown options + dispatcher cases + `applyTypeUI` (filler has no doors) + `typeDefaults` added.

- **Blind corner** clarification confirmed with user: at the carcass level a blind corner ≈ a base cabinet (one box); the "blind" is about ACCESS — a partial door + a fixed blind panel that the adjacent perpendicular cabinet butts against (dead corner reached only through the door opening; lazy-susan/magic-corner hardware optional). User still needs to verify the exact split width, filler gap, and whether there's a stepped blind RETURN panel vs a flat blind panel.
- **The POC now has 14 cabinet types total:** 9 confirmed (base, wall, tall, drawer, sink, corner base, corner wall, open shelf, microwave) + oven tower ON HOLD + these 5 PARKED scaffolds.
- **Door TYPES discussion (deferred):** user asked about door styles; agreed it's a high-leverage cross-cutting axis (slab/shaker/glass/alu-glass/louvered construction × hinged/lift-up/sliding/tambour mechanism) that would multiply cut-list accuracy across all types — but chose to keep going wide on cabinet types for now. Revisit when ready (need WCLI's actual door styles + stile/rail/glass-rebate dimensions).

## What was changed on 2026-06-20 (session 4 — Client-supplied materials + unlock PIN fix) [deployed app]

> Back to the deployed `index.html` (not the POC).

### Client-supplied materials (BOM + cutting-list modes)
- **Toggle** "Client-supplied materials" sits **above the Fabrication Cost Basis** card (`#client-mat-row`/`#client-mat-toggle`/`#client-mat-body`). Applies to **By BOM** and **By cutting list (services)** modes.
- **When ON:** materials are **excluded from cost** (hardware + outsource still counted), and **all services are multiplied** by an uplift. The Materials sections **gray out** (opacity .4 + non-interactive) with a "client-supplied · not counted" badge — in both BOM (`renderBOMSection`, cat==='materials') and cutting-list (`renderItems` services-mode materials) views.
- **Customer Supplied Materials input** (`renderClientMatSection`): a list of rows — Brand · Type (`CLIENT_MAT_TYPES` = HPL / Raw Plywood / Melamine-Laminated MDF·PB·Plywood / Compact Laminate) · Color · Size · Thickness · Texture · Qty.
- **Multiplier:** new `CF.clientMatServiceMult` (default **1.20**) in Settings → Cost Factors ("Client-supplied materials"). Per-quotation **override field** `qClientMatMultOverride` (separate from the custom-CF override; blank = global).
- **Cost logic:** `clientMatMult()` helper; applied in `getBOMItemUnitCost` (services × mult, materials skipped, hardware/outsource counted) and `getAreaSubtotal` services branch (svcItems × mult, matItems skipped when client-supplied).
- **Globals:** `qClientSupplyMat`, `qClientSupplyMatList`, `qClientMatMultOverride`. Persisted in quotation state (save/load), option snapshots (capture/restore), reset in `initQuotation`. CF persists wholesale via `_collectAppSettings`/`_applyAppSettings`.
- **Printout:** `_clientMatPrintHtml()` renders a "Customer-Supplied Materials" table on the quote (note: excluded from quoted material cost).

### Unlock PIN bug fix
- **Symptom:** unlock button did nothing even with the correct PIN.
- **Cause 1:** `requestUnlock` (Stage 1) never reset `modalCtx`; a leftover `'fq'` from a prior Final-Quotation action made `confirmUnlock` clear `fqLocked` instead of `qLocked` → Stage-1 quotation stayed locked. Fixed: `requestUnlock` sets `modalCtx='s1'`.
- **Cause 2:** `requestFQUnlock` opened the modal via `openModal('ov-unlock')` **without** setting `_pinModalApprover` or calling `_openPinModal`, so `_verifyApproverPin` ran against a stale/null approver. Fixed: it now sets `_pinModalApprover=findApproverForSelf()` + `_openPinModal(...)`.
- **Safety net:** `confirmUnlock` sets `_pinModalApprover=findApproverForSelf()` if unset.

## Backend migration — Supabase + Synology (PLANNING, 2026-06-20)

Direction decided to move Modcraft's backend off **Google Sheets/Drive**. Full plan in **`SUPABASE_MIGRATION_PLAN.md`** (beginner-friendly — user is new to Supabase and wants to go SLOWLY).

- **Architecture:** **Supabase Cloud = primary live DB** (Postgres + Auth/Google + Storage + Realtime, **Singapore region**) **+ Synology NAS = nightly backup node** (pg_dump + storage mirror). One source of truth + one local backup the user owns. Explicitly NOT two live syncing databases.
- **Why Supabase over NAS-as-primary:** keeps the serverless single-file architecture (browser → Supabase directly, no server to run), kills the 45k-char `Quotation State` chunking hack (whole state → one JSON column), gives real RLS for the role/company model, multi-site friendly (Pasig + Cebu), low ops burden for a team with no IT.
- **Phases:** P0 schema (zero risk — builds empty DB beside the live app) → P1 incremental data-layer swap behind a `USE_SUPABASE` flag with dual-write safety (quotations+state first) → P2 one-time data migration → **P3 Synology backup (PENDING HARDWARE — decoupled, last)**.
- **Synology not required to start:** P3 is the only NAS-dependent phase and is independent. During P0–P2 **Google Sheets stays live = inherent backup**; Supabase has its own backups too. So data stays safe without the NAS.
- **No lock-in (user asked):** Supabase is open-source Postgres; switching accounts later = restore the pg_dump + update 2 values in `index.html` (project URL + anon key) + re-add Google redirect. Same dump can restore to self-hosted Postgres on the NAS for fully on-prem later.
- **Cost:** Supabase free tier likely enough; ~$25/mo Pro if outgrown.

## What was changed on 2026-06-21 (session — Supabase migration Phase 0 + Phase 1 spike)

### Phase 0 — Supabase project + schema (DONE ✅)
1. **`supabase_schema.sql`** (commit `9a53380`) — paste-ready schema: **16 tables** (one per Sheets tab; `quotation_states` uses ONE `state jsonb` column = the 45k-char 10-column chunking hack is gone), `updated_at` triggers, **RLS enabled on all 16** with a permissive `"authenticated full access"` starter policy (tighten by company/role later), 2 storage buckets (`quotations`, `logos`). Idempotent — only CREATEs, never touches live Sheets/Drive.
2. **Live Supabase project created + verified:** name **Modcraft**, ref **`nkpekroogqsmfilypowd`**, region **ap-southeast-1 (Singapore)**, org `krnnchlunkimkumfdtdx`, Postgres 17. (First made in Tokyo; deleted + recreated in Singapore while empty. Unrelated older "rotaligatos's Project" in Sydney — leave alone.) Verified via Supabase MCP: 16 tables / 16 RLS-on / 16 policies / 2 buckets.
3. **Google sign-in enabled** in Supabase Auth → Providers → Google, reusing the app's existing OAuth client "Modcraft Web" (`605710112392-…`). Redirect URI `https://nkpekroogqsmfilypowd.supabase.co/auth/v1/callback` added in Google Cloud. Auth → URL Configuration: Site URL `https://rotaligatos.github.io/modcraft-app/` + Redirect URL `https://rotaligatos.github.io/modcraft-app/**`.

### Phase 1 spike — quotations + state dual-write (DONE ✅, proven end-to-end)
All additive + fully guarded; **Google Sheets stays primary and untouched.** Commits `26d1280`, `1ce464e`, `1487baa`.
4. **Library + config:** `<script src=".../@supabase/supabase-js@2">`; globals `SUPA_URL`, `SUPA_ANON_KEY` (= **publishable** key `sb_publishable_…`, public-safe), `SUPA_DUAL_WRITE=true` (writes on), `USE_SUPABASE=false` (reads still from Sheets), `supa`, `supaSession`.
5. **Auth — redirect flow, NOT One Tap.** Google One Tap / `signInWithIdToken` is **blocked for Internal/org-restricted Google apps** (403 `org_internal`). So `supaConnect()` uses `supa.auth.signInWithOAuth({provider:'google'})` (flowType pkce, `detectSessionInUrl:true`) — the same redirect mechanism as the app's working Sheets login. It's **manual/one-time** (run `supaConnect()` once in the console); the session then persists in localStorage and **auto-restores** via `getSession()` on every load. NOT auto-called in `gShowApp` (would redirect-loop). Must connect with the **@worldclasslaminate.com.ph** account (yahoo blocked by org_internal).
6. **New functions:** `initSupabase()` (called at startup after `initGoogleAuth()`), `supaConnect()`, `supaConnected()`, `supaReady()`, `supaUpsertQuotation(entry)`, `supaUpsertState(serial,state)`, `supaGetState(serial)` (for the future read path).
7. **Dual-write hooks:** `gSaveQuotation()` → `supaUpsertQuotation(sessionQuotations[serial])` (reads `entry.id` — sessionQuotations stores the serial as `id`, not `serial`; the original `entry.serial` bug wrote null → fixed in `1487baa`). `saveQuotationJson()` → `supaUpsertState(serial,state)` (first upserts a `{serial}` parent stub with `ignoreDuplicates` to satisfy the FK, then upserts the full state jsonb).
8. **Proven:** saving `QT-260621-4858` wrote the header row (client/total ₱240,086.62/status/company/prepared_by all correct) **and** the full state as one ~6k-char jsonb column. Verified via Supabase MCP.

### NEXT (each its own small, reviewable step — NOT started; Synology deferred, no hardware yet)
1. Dual-write **clients**, then **settings**.
2. Wire **reads** behind `USE_SUPABASE` (`loadQuotationJson` → `supaGetState` first, Sheets fallback), then flip the flag once proven.
3. **Phase 2** — one-time data migration Sheets → Supabase (verify row counts).
4. Tighten **RLS** from permissive "any authenticated" to per-company/role.
5. **Phase 3 (Synology)** — deferred until the NAS is on hand; Sheets remains the inherent backup meanwhile. Eventually drop GIS/Sheets and make Supabase Auth the sole login.

## What was changed on 2026-06-21 (session — performance fixes for app slowness/hangs)

User reported the app "slows down, rattles, and sometimes hangs" — investigated and fixed 4 concrete causes (not yet the Supabase migration; these are Sheets-backend optimizations).

1. **Typing jank (13 fields)** — qty/price/CF `oninput` handlers called the heavy `recalc()` (full line-item DOM rebuild) on every keystroke. Changed to `recalcSoon()` (instant totals + line-items rebuild debounced 120ms). `onchange`/`onclick` handlers left calling `recalc()` immediately (not per-keystroke).
2. **Background polling during hangs** — approvals (60s) and messages (45s) poll timers now skip when `document.hidden` (tab not visible), avoiding periodic Sheets-read stalls while the tab is backgrounded.
3. **Materials list slow/blank in quotation (BOM + cutting-list mode) — root cause found:**
   - `loadQuotationJson` was reading the **entire `Quotation State` sheet** (every quotation, all 10 chunked columns, up to 450KB each) just to scan for one row in JS. Gets slower as quotation count grows; large/slow reads could stall or silently fail ("blank"). Fixed: now mirrors `saveQuotationJson`'s pattern — read column A only (cheap) to find the row index, then fetch just that single row's range (`A{row}:K{row}`).
   - `loadPriceDatabase` fetched Services→Materials→Hardware→CabinetTemplates **sequentially** (4 chained round-trips) before the Materials/Hardware dropdowns had real data. Fixed: all 4 now fetch via `Promise.all` in parallel — total wait = the slowest single call, not the sum of four.
   - Added **`_qStateRowCache`** `{serial: rowIdx}` — populated whenever column A is scanned (by either load or save); a *second* open of any quotation in the same session skips the column-A scan entirely (1 API call instead of 2). Invalidated on quotation delete (single + bulk, since `deleteDimension` shifts row numbers — prevents reading the wrong row post-delete); a newly-appended row clears its own cache entry until the next scan.
4. **Verified no JS syntax errors** and all fixes work via mocked Sheets calls (targeted reads only, no full-sheet scan, calls run in parallel, cache hit/invalidation confirmed).

### Ceiling — why some delay remains, and the real fix
These changes squeeze the most out of Google Sheets as a backend, but each Sheets API call still has a **fixed per-call latency floor** (~300ms–2+s from a PH connection) that the app cannot remove — Sheets has no indexing and wasn't built for frequent small point-lookups. **This is exactly what the Supabase migration (see `SUPABASE_MIGRATION_PLAN.md` / the "Backend migration" section above) is expected to fix structurally** — an indexed Postgres query is typically single/double-digit milliseconds server-side vs. Sheets' per-call overhead, and it collapses today's 1–2 Sheets calls into a single indexed query with no chunking. (Phase 0 schema + Phase 1 quotations/state dual-write since shipped 2026-06-21 — see the Supabase session below.)

## What was changed on 2026-07-02 (session — Supabase Phase 1 continued: clients + settings dual-write)

Continuing the additive/guarded Supabase migration (Phase 0 schema + quotations/state dual-write shipped 2026-06-21 — see "Backend migration — Supabase + Synology" section and the 2026-06-21 Supabase session above). This session wired the next two tables per the plan's "NEXT" list.

1. **`supaUpsertClient(client)`** — new function (~index.html:13575); maps the in-app client object to the `clients` table row (`id`, `name`, `biz_name`, `contact`, `email`, `address` (joined address+city), `segment`, `client_type`, `company` via `getCompanyName()`, `notes`); upserts on conflict `id`. Guarded by `SUPA_DUAL_WRITE`/`supaReady()` — no-ops silently if either is false, exactly like the existing quotation/state upserts.
2. **`supaUpsertSettings(configObj)`** — new function; upserts the full settings object as one `jsonb` row keyed `'CONFIG'` into the `settings` table (mirrors the Sheets `Settings!A:C` CONFIG-row pattern).
3. **Hooked into existing save paths** — `gSaveClient()` now calls `supaUpsertClient(client)` right after the Sheets write succeeds; `gSaveAppSettings()` calls `supaUpsertSettings(_collectAppSettings())` at the start of the save (same JSON object that's stringified for the Sheets row, so both writes always agree). Neither call blocks or gates the Sheets save — if Supabase write fails or `supa`/session isn't ready, Sheets save proceeds exactly as before.
4. **Verified** — all `<script>` blocks in `index.html` still parse cleanly (`new Function()` check, no syntax errors introduced).
5. **Memory cleanup** — `MEMORY.md` index had 3 stale lines: Supabase entry said "Phase 0 = write schema SQL next" (schema was already live since 2026-06-21), and the mobilization-calculator + cost-formula-redesign entries said "spec agreed, not built" when both shipped weeks ago. All three corrected; the now-resolved `project_stale_memory_index.md` TODO memory was deleted.

### Still pending (per the migration plan's "NEXT" list — quotations, state, clients, settings now dual-written)
1. Wire **reads** behind `USE_SUPABASE` (`loadQuotationJson` → `supaGetState` first, Sheets fallback), then flip the flag once proven.
2. **Phase 2** — one-time data migration Sheets → Supabase (verify row counts) for all tables, not just the 4 dual-written so far.
3. Tighten RLS from permissive "any authenticated" to per-company/role.
4. **Phase 3 (Synology)** — still deferred, no hardware yet.
5. ~~Remaining tables not yet dual-written~~ — all 16 schema tables now dual-written as of the session below.

## What was changed on 2026-07-02 (session 2 — Supabase Phase 1 complete: all remaining tables dual-written)

Closed out the rest of the Phase 1 "NEXT" list — every table in `supabase_schema.sql` now has a dual-write hook. Same additive/guarded pattern throughout: every `supa*` call is gated on `SUPA_DUAL_WRITE`/`supaReady()`, never throws to the caller, and Sheets remains the sole source of truth (nothing reads from Supabase yet — `USE_SUPABASE` is still `false`).

1. **New generic helper `supaReplaceTable(table, rows)`** — delete-all + bulk insert, mirrors the existing "clear then rewrite" pattern already used by Sheets saves for Price DB / Logistics DB (`priceDbClear`+`priceDbUpdate`, `logDbClear`+`logDbUpdate`). Used for every table where the app treats the whole set as replaceable rather than row-by-row upsertable.
2. **`users`** — `supaUpsertUser(u)` hooked into `saveUserRow`, `submitAddUser`, `toggleUserActive` (all upsert on `email`); `supaDeleteUser(email)` hooked into `removeUserRow`.
3. **`user_prefs`** — `supaUpsertUserPref(email,prefType,value)` upserts on `(email,pref_type)`; hooked into `gSaveDashPref` (`DASHPREF`), `gSaveDashAllow` (`DASHALLOW`), `gSaveFollowed` (`FOLLOWED`).
4. **`approval_requests`** — `supaUpsertApprovalRequest(req)` (tolerates partial req objects, e.g. `_markOverrideApproved` only sends the changed fields); hooked into all 4 write paths: `gSaveApprovalRequest` (covers `submitApprovalRequest` + `_markOverrideApproved`), the inline save in `doApprovalAction`, `acceptCounter`, and `cancelApprovalRequest`.
5. **`activity_log`** — `supaInsertActivity(action,serial)` plain insert (bigint identity PK, append-only); hooked into `gLogToSheets` (called by every `logActivity()`).
6. **`pending_orders`** — `supaUpdateOrderStatus(orderId,status,quotSerial,sentAt)` hooked into `_setOrderStatus`. **Creation is NOT mirrored** — Wufoo submissions write directly Sheets-only via the separate Google Apps Script webhook project (not part of `index.html`); only in-app status transitions (Pending → In Progress → Done) dual-write.
7. **`messages`** — `supaInsertMessage(m)` hooked into `gSendMessage`'s success path; `supaMarkMessageRead(id,readAt)` hooked into `_msgMarkRead`.
8. **Price DB (4 tables)** — `price_services`/`price_materials`/`price_hardware`/`cabinet_templates` all use `supaReplaceTable`, hooked into: `_saveServicesToPriceDb` (services, full capacity/cost-breakdown fields → `cost_data` jsonb), `initPriceDB` (services + cabinet templates on init), `importPriceDbExcel` (generic Materials/Hardware/Services Excel import — target table resolved from `targetSheet` name), `dedupeServicesSheet` (services after dedup).
9. **Logistics DB (2 tables)** — `logistics_materials`/`logistics_trucks` via `supaReplaceTable`, hooked into `_logSaveMats`/`_logSaveTrucks`.
10. **Verified** — `new Function()` parse check on every `<script>` block passes; a script cross-reference confirmed all 17 `supa*` functions called are defined (no typos, no dangling calls).

### Now truly pending (nothing left to dual-write)
1. ~~Wire reads behind `USE_SUPABASE`~~ — quotation state done, see session below. Clients/settings/users/etc. reads not yet wired (deliberately — proving one table at a time before expanding, per the plan's "go slowly" approach).
2. **Phase 2** — one-time historical data migration Sheets → Supabase (verify row counts per table).
3. Tighten RLS from permissive "any authenticated" to per-company/role.
4. **Phase 3 (Synology)** — still deferred, no hardware yet.
5. `pending_orders` creation still Sheets-only (Wufoo GAS webhook) — would need editing the separate Apps Script project to also POST to Supabase; not started, low priority while Sheets is still the read path.

## What was changed on 2026-07-02 (session 3 — Supabase: quotation-state read path wired behind USE_SUPABASE)

First read-path wiring — the next real step after Phase 1's dual-write was complete for all 16 tables (see the two sessions above). Deliberately scoped to ONE table (`quotation_states`, the highest-value one — this was the original motivation for the whole migration, see "Ceiling" note in the 2026-06-21 performance session) rather than wiring every table's reads at once, per the migration plan's "go slowly" approach.

1. **`loadQuotationJson(serial,callback)` now branches on `USE_SUPABASE`** — when true and `supaReady()`, it calls `supaGetState(serial)` first; a hit calls back immediately (skips Sheets entirely — no column-A scan, no chunked-column reassembly). A miss (or `USE_SUPABASE=false`, the current default) falls through to the existing Sheets logic, which was extracted unchanged into a new internal function `_loadQuotationJsonFromSheets(serial,callback)`. The public `loadQuotationJson` signature and all 3 call sites are untouched.
2. **`USE_SUPABASE` stays `false`** — this change is inert in production today. No behavior change until the flag is explicitly flipped.
3. **New console helper `supaVerifyRead(serial)`** (~index.html:13582) — run in the browser console after `supaConnect()`; loads the same quotation's state from both Supabase and Sheets in parallel and diffs them, logging exactly which top-level JSON keys differ (or a ✓ MATCH). This is the self-serve way to prove the read path is correct on real data before flipping `USE_SUPABASE=true` — no code changes needed to test it.
4. **Verified** — `new Function()` parse check on every `<script>` block passes.

### Recommended next steps (not done — for the next session)
1. Run `supaConnect()` then `supaVerifyRead('QT-...')` on a few real quotations in the browser console to confirm Supabase/Sheets agreement.
2. Once several quotations verify clean, flip `USE_SUPABASE=true` and watch for regressions in day-to-day use (Sheets is still written in parallel as a safety net — nothing to undo, just flip back to `false`).
3. Then expand the same try-Supabase-first/fallback-to-Sheets pattern to `gLoadClients` (more involved — it also joins transaction history from the `Quotations` sheet, so the Supabase equivalent needs a `quotations` query by client name, not just a straight table read) and `gLoadAppSettings`.

## What was changed on 2026-07-02 (session 4 — Supabase verification live-tested, 3 bugs found + fixed, Phase 2 migration script added)

User actually ran the verification steps from session 3 live (`supaConnect()` → `supaVerifyRead()`). This surfaced 3 real, unrelated-to-each-other bugs, all fixed in this session:

1. **Pre-existing dashboard chart crash** — `drawChart('dash-chart', ..., null)` is called with a `null` target (dashboard revenue chart has no target-line overlay) from 2 call sites, but `drawChart()` unconditionally looped `target.length` — `Cannot read properties of null (reading 'length')` on every Dashboard render. Bug existed since 2026-05-25 (confirmed via `git blame`), unrelated to Supabase — it just became visible because `supaConnect()`'s OAuth redirect reloads the page back onto the Dashboard. **Fix:** wrapped the target-line drawing in `if(target&&target.length)`.
2. **`supaVerifyRead()` popped a blocking `alert()` dialog** — it reused `_loadQuotationJsonFromSheets` (the real Sheets read path), which calls `alert()` on a not-found/error state. Appropriate for normal app use, but it interrupted the console diagnostic with a modal. **Fix:** `supaVerifyRead` now temporarily swaps `window.alert` for a `console.warn` for the duration of the check only, restored on both the success and catch paths. Also added an explicit `!gToken` guard with a clear message.
3. **False-positive MISMATCH from jsonb key reordering** — first real verify on `QT-W00000019` reported 7 differing top-level keys (`log`, `areas`, `pCalc`, `client`, `bondIns`, `siteVisit`, `costReport`) even though the data was actually identical. Root cause: Postgres `jsonb` does not preserve JS object key order, so a round-tripped nested object comes back with keys in a different order, and plain `JSON.stringify()` is order-sensitive. **Fix:** added `_canonicalJson(v)` (recursively sorts object keys before stringifying) and switched both the top-level equality check and the per-key diff to use it. Also added per-key value logging (`supabase: ... | sheets: ...`) on a genuine mismatch, to make real bugs easy to spot going forward.
4. **Root cause of repeated "still shows old error" reports** — user kept re-running the check but got the same stale result twice in a row even after a normal hard refresh (`Ctrl+Shift+R`); `typeof _canonicalJson` came back `"undefined"` proving the browser was still serving cached JS. Resolved by a full cache clear / incognito window — plain hard-refresh was NOT sufficient in this case (worth remembering for future "the fix isn't showing up" reports on this app).
5. **Result: 3 real quotations verified `✓ MATCH`** (including `QT-W00000019` after the key-order fix, plus 2 more the user manually re-saved/re-locked to test) — the Supabase read path (`supaGetState` in `loadQuotationJson`) is now confirmed correct against live production data.
6. **`supaMigrateAll()` added** — the Phase 2 one-time historical migration, requested next by the user (chose "migrate first" over "flip now and let Sheets-fallback handle gaps"). Reads every row from the `Quotations` and `Quotation State` Sheets tabs and upserts each into Supabase via the existing `supaUpsertQuotation`/`supaUpsertState` functions (same write path as live saves — can't duplicate or corrupt data). Processes through a new concurrency-limited batch runner `_migrateBatch(items, concurrency, fn)` (cap 4 in-flight) to avoid hammering the Sheets API on a large dataset. Idempotent — safe to re-run. Prints final Supabase row counts for both tables at the end so they can be diffed against the Sheets tab row counts (minus the header row) to confirm completeness. **Not yet run** — that's the next step for the user.
7. **Verified** — `new Function()` parse check on every `<script>` block passes throughout; confirmed `supaUpsertQuotation`/`supaUpsertState`/`_migrateBatch` are all defined and reachable (function-declaration hoisting) before `supaMigrateAll` calls them.

### Recommended next steps (updated)
1. ~~User runs `supaMigrateAll()`~~ — DONE (see session below), fully verified.
2. ~~Flip `USE_SUPABASE=true`~~ — DONE (see session below).
3. Expand the same try-Supabase-first/fallback-to-Sheets read pattern to `gLoadClients` (more involved — also joins transaction history from `Quotations` by client name) and `gLoadAppSettings`.
4. **Note for future cache-related bug reports on this app:** a plain hard-refresh did NOT clear cached JS in this session — needed a full browser cache clear or an incognito window. If a user reports "I refreshed and the fix still isn't showing," don't assume the deploy is stale — ask them to check `typeof <newFunctionName>` in the console first, and escalate straight to cache-clear/incognito instead of repeating hard-refresh instructions.

## What was changed on 2026-07-02 (session 5 — Migration completed live, rate-limit fix, USE_SUPABASE flipped)

Closes out the Supabase read-path rollout started in sessions 3–4.

1. **First `supaMigrateAll()` run hit Google Sheets' per-minute API quota** — 149/149 quotation headers succeeded cleanly, but 55 of 119 state rows failed with `429 Too Many Requests` partway through (the migration fires far more calls in a short burst than normal app use; the app's own background polls — approvals every 60s, messages every 45s, orders — were also competing for the same quota and 429'd during the run, visible in the console log).
2. **Fix: `_sheetsGetWithRetry(range, maxRetries)`** — retries a Sheets read up to 5x with exponential backoff (1.5s/3s/6s/12s/24s) specifically on 429/rate-limit responses, added to `index.html`. State-row batch concurrency dropped 4→2 with a 120ms pacing gap per request, plus a 2s cooldown pause between the headers phase and the states phase. Failed serials are collected and logged explicitly so a re-run only needs to be safe, not exhaustive to reason about (commit `6215058`).
3. **Second `supaMigrateAll()` run succeeded fully** — took several rounds of backoff (the console showed a wall of retry warnings and raw 429 network errors, which look alarming but are the retry logic working as designed, not failures) but finished clean: `{quotHeaders: 149, quotHeaderErrors: 0, states: 119, stateErrors: 0, failedSerials: []}`. User read the wall of red console errors as "still broken" — worth remembering that a long batch job's retry noise can look identical to a failure at a glance; the actual `[migrate] DONE` summary line is the source of truth, not the presence of red text above it.
4. **Verified via direct Supabase SQL** (not just app console logs) — `select count(*) from quotations` = 148, `select count(*) from quotation_states` = 119, and a `left join` check for orphaned state rows (states with no matching quotation) returned zero rows. The 148-vs-149 header count gap is one duplicate serial in the source Sheet (two rows sharing the same serial number) that collapsed into one upsert — expected, harmless, not data loss.
5. **`USE_SUPABASE` flipped `false → true`** (commit `a93c2fa`) — `loadQuotationJson()` now tries `supaGetState()` first for any browser session that has called `supaConnect()`. Sheets remains the automatic fallback on any miss, and dual-write (`SUPA_DUAL_WRITE=true`) keeps both stores in sync on every future save.
6. **Important nuance flagged to user:** flipping this flag is NOT an org-wide cutover. `supaReady()` requires `supaSession`, which is only set after a user manually runs `supaConnect()` in their own browser session (a deliberate one-time step per the Phase 1 design — auto-connecting at login was explicitly avoided to prevent OAuth redirect loops). So today only the user's own connected session reads from Supabase; every other staff member's browser continues reading from Sheets exactly as before, unaffected, until they too run `supaConnect()`.

### Current state of the Supabase migration (as of the session below)
- Phase 0 (schema) ✅ · Phase 1 (dual-write, all 16 tables) ✅ · Phase 2 (historical migration, quotations+states) ✅ · Reads flipped Supabase-first for quotations/state ✅, settings ✅, clients ✅ (all for connected sessions)
- Not yet done: reads for users/login-auth (deliberately held back, see below); org-wide auto-connect to Supabase (still manual `supaConnect()` per session); RLS tightening (still permissive "any authenticated"); Phase 3 Synology backup (no hardware yet)
- **UPDATE 2026-07-05 — see "Performance remediation" session below**: org-wide auto-connect now shipped (no longer manual per session); approvals/messages/Price DB/Logistics DB reads also flipped; users/login-auth read decided AGAINST permanently, not just deferred (see that session for why).

## What was changed on 2026-07-02 (session 6 — Supabase reads extended to Settings + Clients)

Continued the read-path rollout from session 5 (quotation state only). User explicitly held back the login/authorization path as more sensitive than the rest — see the AskUserQuestion decision below.

1. **Scope decision:** offered the user a choice on whether to include the Users/login-authorization read path (`gCheckRole`) in this pass. They chose to leave it Sheets-only for now — it's the most security-sensitive read (decides who can sign in and what role/access they get), so it's deliberately deferred to a separate, more careful review rather than bundled in with routine settings/clients reads.
2. **New Supabase helper functions** (all return `null` on any error/empty so callers cleanly fall back to Sheets, same pattern as `supaGetState`):
   - `supaUpsertSetting(key,value)` — generic single-key upsert into the `settings` table (for logos and any future one-off keys beyond the `CONFIG` blob)
   - `supaGetAllSettings()` — returns a `{key:value}` map of the whole `settings` table
   - `supaGetUserPref(email,prefType)` — single-value read from `user_prefs` (`FOLLOWED`/`DASHPREF`/`DASHALLOW`)
   - `supaGetClients()` — full `clients` table read
   - `supaGetQuotationsForTxns()` — reads `quotations` (serial/created_at/client_name/total/status/service_type) for building client transaction history
3. **`gSaveLogoRow` now dual-writes** — was previously the one Settings-tab writer not hooked to Supabase; now calls `supaUpsertSetting(key,val)` alongside the Sheets write, so `LOGO_APP`/`LOGO_CO_*` stay in sync like everything else.
4. **`gLoadAppSettings` reads Supabase-first** — new `_applyLoadedSettingsMap(map)` helper applies a `{CONFIG, LOGO_APP, LOGO_CO_*}` map from either source; the Sheets path is untouched (still parses the JSON-string CONFIG value), the Supabase path uses the already-parsed jsonb object directly.
5. **`gLoadDashPref`, `gLoadDashAllowFor`, `gLoadFollowed` all read Supabase-first** — same fallback pattern; `_applyFollowedIds(ids)` factored out of `gLoadFollowed` so both read paths share the exact same apply logic (was previously inlined only in the Sheets branch).
6. **`gLoadClients` reads Supabase-first**, with one known limitation: the Supabase `quotations` table doesn't store the `segment`/`contact_name` columns the Sheets-based transaction-history "project" label falls back through (`qr[8]||qr[4]`) — there's no equivalent to reconstruct from Supabase alone. Used `service_type` as the closest available substitute. This only affects a cosmetic label in the client's transaction list (id/date/value/status are all exact); flagged explicitly rather than silently accepted. Fixing properly would mean either adding `segment`/`contact_name` columns to the `quotations` table (schema change + backfill) or accepting the current approximation — left as a known gap, not fixed in this pass.
7. **Cleanup mid-session:** a first draft of the Clients Supabase-read path had a half-finished generic `_matchClientTxns()` helper called once with dummy no-op arguments and then immediately redone manually below it (leftover from iterating on the join logic) — caught before commit and simplified to a single inline loop matching the Sheets-path style.
8. **Verified** — `new Function()` parse check on every `<script>` block passes; cross-referenced all 24 `supa*` function calls in the file against their definitions (zero missing).

## What was changed on 2026-07-02 (session 7 — Cost Report fabrication profit fix + GitHub Pages deploy failure)

1. **Cost Report was hiding built-in fabrication service profit** — `_buildCostReportSnapshot()`'s `directCost` treated a services-mode fabrication line's full selling price as pure cost, even though `SERVICES[i].price` is designed to already include margin (`computeServiceCosts()` in Cost Breakdown → Services computes the true unit cost as `opCost`, separate from `price` — see the 2026-06-09 session 2 "Services have built-in profit" note). Result: the Cost Report's profit/margin KPIs only ever reflected the mobilization/installation contingency-buffer-markup chain, never fabrication's own margin.
2. **Fix (commit `fa3cced`)** — new `_fabServiceMarginTotal()` sums `(price × client-supply-uplift − opCost) × qty` across every fabrication service line item (services-mode `svcItems` by `SERVICES` index; BOM-mode `bomItems[].services` matched by name), but only when a service's monthly capacity is configured (`computeServiceCosts().monthlyCapacity > 0` — without capacity, `opCost` is unknowable, so that line conservatively stays counted as cost, unchanged). `_buildCostReportSnapshot()` subtracts this from `directCost` (raising profit); `_buildCostReportHtml()` shows it as an explicit reclassified line in the Direct costs table so the footer stays auditable. Carcass-mode fabrication is unaffected — `CARCASS_PRICES` has no separate cost/price split today, so nothing to reclassify there (a separate pre-existing design choice, not fixed in this pass).
3. **GitHub Pages deploy failure (unrelated to the code)** — the push landed and the **build step succeeded**, but the **"Deploy to GitHub Pages" step failed** after hanging ~10 minutes (confirmed via `GET /repos/.../actions/runs/28601936356/jobs` — build job `conclusion:success`, deploy job `conclusion:failure`, 15:30:13–15:40:14 UTC). This is a transient GitHub infrastructure issue, not a code/build problem. The live site kept serving the previous commit indefinitely; a hard refresh or full cache clear on the user's end could never have shown the new code, because there was genuinely nothing new published yet.
4. **Diagnosis method for future "still shows undefined after cache clear" reports on this app** — don't stop at telling the user to clear cache again. Check the actual GitHub Actions run for the pushed commit: `curl -s "https://api.github.com/repos/rotaligatos/modcraft-app/actions/runs?per_page=5"` to find the run by `head_sha`, then `.../actions/runs/<id>/jobs` to see per-step `conclusion`. If the deploy job failed or is still running, no amount of client-side cache-busting will help — the fix is a fresh push (even a trivial one, e.g. a docs update) to retrigger the Pages workflow.
5. **Retriggered via this very commit** — pushing this CLAUDE.md update forces a new "pages build and deployment" run, which should carry the `fa3cced` `index.html` content forward this time.

## What was changed on 2026-07-03 (session 8 — Pages outage resolved: switched deploy to GitHub Actions source)

Continuation of the session-7 deploy failure. The retrigger commit did NOT fix it — full incident timeline and resolution below. **Deployment now uses the official GitHub Actions Pages workflow (`.github/workflows/deploy-pages.yml`); Settings → Pages → Source = "GitHub Actions".** The old "Deploy from a branch" mode is retired for this repo.

1. **Six consecutive deploy failures**, all identical: build job succeeds in seconds, deploy job loops on `Current status: deployment_queued` for exactly 10 minutes, then "Timeout reached, aborting!". Attempts: original push (15:29 UTC Jul 2), retrigger commit, manual re-run, push after unpublish/republish of the Pages site, push after deleting the `github-pages` environment, push after disabling/re-enabling Actions, and a morning retry (23:42 UTC). None worked.
2. **Root cause found via web search, not the status page**: GitHub had an official **"Incident with Pages"** (stspg.io/wgv67m39tbml) — "slow and failing Pages deployments", opened 16:54 UTC Jul 2, resolved 18:25 UTC. Our failures started at 15:29, *before* GitHub acknowledged. Crucially: during troubleshooting we **unpublished and re-created the Pages site inside the outage window** (~16:00–16:12 UTC), which left the branch-based site record itself in a corrupted state — which is why the 23:42 retry failed 5+ hours *after* the incident was resolved, and why the site 404'd (unpublish removed the old content and nothing could deploy).
3. **Fix (commit `cf42bd1`)**: added `.github/workflows/deploy-pages.yml` (official `actions/configure-pages` + `upload-pages-artifact` + `deploy-pages` template, serving repo root, no build step) and flipped Settings → Pages → Source to **"GitHub Actions"**. First run succeeded immediately (00:08 UTC Jul 3); site live again with the `fa3cced` cost-report fix confirmed present (`_fabServiceMarginTotal` in the served page).
4. **Change is deploy-pipeline-only** — same URL, same OAuth origins, same Google Site embed, no user-facing impact. Fully reversible via the same dropdown.
5. **Lessons for future deploy incidents on this repo**:
   - `deployment_queued` → 10-min timeout = GitHub-side Pages backend issue; repo-side remedies (re-run, unpublish/republish, delete environment, Actions toggle) don't fix it. Check `https://www.githubstatus.com/api/v2/incidents.json` (the *incident history*, not just the current-status summary — the summary showed "operational" the whole time) and search GitHub Community discussions for the symptom.
   - **Do NOT unpublish/re-provision the Pages site during an active Pages incident** — that's what corrupted the site record and extended the outage past the incident itself.
   - Unauthenticated GitHub API is limited to 60 req/hr per IP; poll the live site URL (no limit) instead of the Actions API when watching for recovery.
   - GitHub's official support contact form has no Pages/Actions category for free-tier accounts; the practical escalation channel is GitHub Community Discussions (`github.com/orgs/community/discussions/categories/pages-q-a`).

## What was changed on 2026-07-04/05 (session — Outsource extended to all modes, approval routing bug, quotation summary overhaul, Stage 1/2 parity fixes)

### Outsource feature extended beyond BOM mode (commits `9fb5ff6`, `21872d8`)
1. **Outsource in cutting-list (services) mode** — previously the "search catalog or manually add a not-yet-in-DB item and price it" Outsource feature only existed in BOM mode; a real production scenario (cutting-list quotation needs to outsource one material) meant switching fabrication modes just to add it, losing all cutting-list entries. Generalized via a new `_outRowsArr(a,ci,cat)` lookup helper — `ci<0` = area-level rows (`qAreas[a].outsourceMaterials/outsourceHardware`), `ci>=0` = per-BOM-item rows (unchanged) — letting the same render/handler functions (`addOutsourceRow`, `removeOutsourceRow`, `onOutsourceRowChange`, `onOutsourceItemSearch`, `saveOutsourceToDB`, `renderOutsourceSection`) serve both shapes.
2. **Outsource in carcass mode too** — same area-level mechanism; `getAreaLevelOutsourceCost(a)` sums qty×price across both arrays; `getAreaOutsourceSubtotal(a)` branches by `qFabMode` (BOM = per-item sum, carcass/services = area-level); `getAreaSubtotal(a)` includes it unconditionally in both modes (matching BOM's existing precedent, not gated by `isDirectClient()`).
3. **New area-level fields** — `outsourceMaterials:[]`/`outsourceHardware:[]` added to `addArea()` and `initQuotation()`'s initial `qAreas` array, alongside the existing per-BOM-item ones nested inside `bomItems[]`.
4. **`renderOutsourceSection(a,-1)`** — inserted into `renderItems()` at the end of both the carcass-mode and services-mode render blocks (right after their "Area N subtotal" spans).

### Approval Routing bug — dropdown never actually saved a selection (commit `875c842`)
5. **Root cause** — Settings → Approval Routing's `<select onchange="_setApprRoute(...)">` built the handler string with `JSON.stringify(co)` (produces **double-quoted** output) embedded inside a **double-quote-delimited** `onchange="..."` HTML attribute. The moment a company name's own `"` appeared, the browser silently truncated the attribute — `_setApprRoute()` never fired, `APPR_ROUTING` stayed `{}` forever, so Save had nothing to persist. This also explains the `Uncaught SyntaxError: ... PagePopupController ... Unexpected end of input` console errors seen while diagnosing.
6. **Diagnosis method** — direct Supabase SQL queries (via MCP) proved the settings *write* itself succeeded (`updated_at` advanced) but `value->'approvalRouting'` stayed `{}` even after the user visibly picked approvers in the UI — isolating the bug to the dropdown never updating `APPR_ROUTING` in memory at all, not a save-path problem.
7. **Fix + established convention reinforced**: never build an `onchange="..."` (or any double-quote-delimited HTML attribute) using `JSON.stringify()` for interpolated string values — it emits double quotes that collide with the attribute delimiter. Use single-quoted JS string literals instead (`\''+val.replace(/'/g,"\\'")+'\'`), which is the pattern used everywhere else in this file. Verified via a live DOM test: rendering the actual settings HTML and dispatching a real `change` event on the generated `<select>` now correctly updates `APPR_ROUTING`.
8. **Side fix (commit `9bbee59`, shipped first while still chasing the root cause)** — `supaUpsertSettings`/`supaUpsertSetting` had no `.catch()` on the async Supabase upsert, silently swallowing failures; added `.catch()` + a "skipped — not connected" console warning. This surfaced no error (proving the write path itself was fine) and helped narrow the search to the dropdown wiring.

### Quotation summary panel — hidden fee, then full consolidation (commits `a303d87` → `444788a`)
A single quotation (Fabrication-only + Assembly, Site Visit enabled, Cutting list + Design charge active) surfaced a chain of real issues in the **internal (non-printout) quotation summary panel** — not the client-facing print output, which was correct and untouched throughout.

9. **Hidden site-visit fee (commit `a303d87`)** — when Site Visit is enabled but *not* charged separately, its fee is silently folded into the "Assembly" line's total (`mobBase+instBase+assmBase`) — but the "(incl. site visit)" note and the admin-only "Site visit in mob" breakdown row were both gated on `ni` (Installation present) only, so a **Fabrication-only + Assembly** quotation showed an inflated Assembly total (e.g. `10×₱850=₱8,500` shown as ₱11,500) with zero explanation. Fixed by changing all 3 gates from `ni` to `(ni||na)`.
10. **Root cause of "why is Design charge shown 3 times, Assembly 2 times" (commit `cd3c359`)** — the summary was actually **two independent, unlinked render blocks**: a top banner + a "Service charges" detail block (both in the itemized "lines" section) **plus** a separate "Totals — clear breakdown" chips grid that re-rendered Design charge/Fabrication/Assembly/Bond & Insurance *again* right before Subtotal. Consolidated into **one ordered list, no duplicates**: `Fabrication → (Fab. contingency, admin-only) → Assembly/Mobilization & Installation → Cutting list charge → Design charge → Site visit → Subtotal → VAT/Premium → Total`. Cutting list charge is now shown here (was previously invisible anywhere in this internal summary) — the client-facing printout is unaffected and still keeps it silently folded into fabrication, per the original design. Applied identically to Stage 1 (`recalc`) and Stage 2 (`recalcFQ`).
11. **Site visit regrouped under Service Charges with an explicit Total row (commit `bdc7b96`)** — user feedback: showing Site visit as its own line further down with a vague "(incl. above)" note didn't read as clearly as grouping it directly under "SERVICE CHARGES" beneath Assembly, with the math spelled out. Now renders: `Assembly ₱8,500.00` → `Site visit ₱3,000.00` → `Total ₱11,500.00` (bold), for both the `ni` case (Mobilization + Installation + Site visit + Total) and the `na` case (Assembly + Site visit + Total). A standalone Site visit line still exists as a fallback for the rare case with no Assembly/Installation to group it under.
12. **Outsource cost was completely invisible in the summary (commit `3eca11d`)** — the "Fabrication" line deliberately excludes `outsourceBase` (Outsource gets its own contingency/buffer/markup rates via `getOutRates()`, different from regular fab rates), but nothing ever added it back as its own visible line — only its individual margin *deltas* showed in the admin-only box, never the base cost or the final marked-up total. Added an "Outsource" line (showing `outsourceFinal`, the fully marked-up amount) right after Fabrication, whenever an area has outsourced items.

### Stage 2 (Final Quotation) had NO Outsource cost support at all (commit `f58982b`)
13. **The bigger issue found while adding the Outsource display line** — `recalcFQ()`'s `_pCalc` hardcoded `outsourceBase:0, outsourceFinal:0`; the raw outsourced cost was silently folded into `fabBase` and marked up using the **wrong rates** (regular fab contingency instead of the dedicated Outsource contingency/buffer/markup) — meaning outsourced items were genuinely **undervalued** at the Final Quotation stage. User's words: *"if that is not included to stage 2 then we must include it or else it will have no purpose and the final quote will be under value."*
14. **Fix** — mirrored Stage 1 exactly: `outsourceBase` computed via `getAreaOutsourceSubtotal()` per area, marked up with `getOutRates()`'s own rates (not the regular fab rates); `regularBase = fabBase-outsourceBase+clCost`, `regularFabC = regularBase×(1+cf%)×(...)`, `fabC = regularFabC+outsourceFinal` — this `fabC` feeds directly into `combined` in Stage 2 (unlike Stage 1 where `fabC` is a display-only variable and `combined` recomputes from `regularFabC+outsourceFinal` separately — a pre-existing, harmless asymmetry between the two stages' variable naming, not a bug). Added the same visible "Outsource" line + admin-only Outsource contingency/buffer/markup rows as Stage 1.
15. **Verified via live `recalcFQ()` calls in the preview browser**: an outsourced item changes the Stage 2 grand total by exactly its marked-up cost × VAT (`₱13,230 × 1.12 = ₱14,817.60`); removing all outsourced items reproduces the exact same total as before this fix (no regression for the common no-outsource case).

### Stage 1 vs Stage 2 admin-box parity gaps (commits `d774f2f`, `be7b8d3`+`a9c1f7f` retrigger, `444788a`)
16. **Mislabeled "Inst. contingency" on Assembly-only quotations (commit `d774f2f`)** — Stage 2's admin box always labeled the `instC`-derived row "Inst. contingency", even on a **Fabrication-only + Assembly** quotation with zero Installation. The dollar amount was always correct (Assembly does share the same contingency/buffer/markup rate fields as Installation in this codebase — `instContingency`/`instBuffer`/`instMarkup`, a naming/rate-sharing artifact from when Assembly was added after Installation, not evidence that Mobilization/Installation cost is mixed into an Assembly-only total) — only the label was wrong. Now reads `(ni?'Inst.':'Assembly')+' contingency (...)'`, matching the existing na-vs-ni convention already used for the Service Charges line above it.
17. **Stage 1's admin box was missing this row entirely (commit `be7b8d3`, deploy failed once → retriggered as `a9c1f7f`)** — side-by-side screenshots of the same quotation (QT-M00000012) showed Stage 1's admin box lacking a row Stage 2 had, **despite both stages' grand totals matching exactly** — proving this was a pure Stage-1 display gap (the cost was always baked into Stage 1's total), not a math difference. Added both the `Mob. contingency` (ni-only) and `(ni?'Inst.':'Assembly') contingency` (ni-or-na) rows to Stage 1's admin items array, in the same order and with the same conditional labeling as Stage 2, so both stages' admin breakdowns now read identically for the same quotation.
18. **Dropped misleading "+buf+mk" suffix (commit `444788a`)** — both the `Mob. contingency` and `Inst./Assembly contingency` admin rows appended "+buf+mk" to their labels, implying an available breakdown of the buffer/markup components that was never actually shown anywhere (unlike Outsource, which genuinely does show 3 separate lines: contingency/buffer/markup). Simplified both to just `"<Name> contingency (X%)"`, matching the existing `"Fab. contingency (X%)"` convention which already silently folds its buffer component under one rate label without a misleading suffix. Label-only change — the underlying dollar amount is unchanged.

### Key pattern reinforced this session
19. **Stage 1 (`recalc()`) and Stage 2 (`recalcFQ()`) are separate, hand-duplicated implementations of the same cost-calculation and summary-rendering logic** — they do not share code and routinely drift out of sync (found this session: Outsource missing entirely from Stage 2, admin-box rows missing from Stage 1, a labeling fix applied to one stage initially and needing a matching fix in the other). **When fixing any quotation cost/summary bug, check both `recalc()` and `recalcFQ()` — a fix in one almost never automatically covers the other.**

## Known remaining areas to watch
- **⚠️ Price DB direct-Sheet edits need a manual Supabase resync** — since Phase 4a (2026-07-05), `loadPriceDatabase()` reads Supabase first for Services/Materials/Hardware/CabinetTemplates. Editing through the app's own **Import Materials Excel / Import Hardware Excel** buttons (Settings → Price Database) is automatic — writes both Sheets and Supabase. But editing the **Google Sheet directly** (e.g. manual fixes, the Materials dedup cleanup) only updates Sheets — Supabase silently goes stale until someone runs `supaMigratePriceDb()` in the browser console afterward. No error, no warning — connected users just keep seeing old data. **Rule: direct Sheet edit → always follow with `supaMigratePriceDb()`.**
- **Fullscreen ✅ COMPLETE** — works on GitHub Pages; suppressed in Google Sites embed (no `allowfullscreen`); ⛶ button opens app in new tab from embed. No hint banner needed (user decision 2026-06-14).
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

## What was changed on 2026-07-05 (session — performance remediation: app slowness with only 5 users)

User raised a real concern: even with just 5 users, the app was already slowing down/unresponsive — a serious adoption risk if it doesn't improve before real rollout. Root cause diagnosis: the Supabase migration (Phase 0-2, shipped 2026-06-21 through 2026-07-02) was fully built and proven but never actually *used* by anyone besides whoever manually ran `supaConnect()` in a console — every real user was still on 100% Google Sheets, which has a real per-call latency floor plus a shared team-wide rate limit, compounded by two 45-60s background pollers per open tab. Fixed in phases, testing + confirming each before moving to the next, per explicit user request.

### Phase 1 — Auto-connect every user to Supabase (commits `d8376be`, `35e8ebe`, `e031677`, `16d9371`)
1. **`_supaAutoConnect(popup)`** — triggers the one-time Google→Supabase OAuth handshake automatically after login instead of requiring the manual console command. Guarded per (browser, account) via a localStorage flag written **before** the popup is used (not after success), so a failed/blocked/cancelled attempt never retries or loops — it silently leaves that browser on Sheets, exactly as before.
2. **Popup-based, not full-page redirect** — first version used `supaConnect()`'s `window.location` redirect, which reloads the whole app and visibly looked like "login, back to login, login again" (confirmed in testing). Fixed: `gSignIn()` now pre-opens a blank popup synchronously within the sign-in click (required — browsers block `window.open()` called later from an async callback), `_supaAutoConnect(popup)` decides afterward whether to use it or close it unused. The popup is cleaned up on every sign-in failure path (popup-level OAuth failure, token-response error, Sheets read failure, unregistered user, device-not-authorized) so it's never left orphaned.
3. **Popup made a small corner toast, not a big dialog** (`_supaPopupFeatures()`) — 380×460 anchored to the bottom-right corner instead of a 480×640 centered dialog, per user feedback that it looked "overwhelming and unprofessional." `_supaWritePopupPlaceholder()` writes branded "Connecting…" content into the popup immediately on open so it's never a stark blank window.
4. **Fixed the popup reappearing on every login** — root cause: `gSignIn()` pre-opened the popup unconditionally on every click, before it was possible to know (email isn't known until after Google auth) whether the one-time connect was still needed; the actual OAuth attempt was correctly guarded, but the popup itself still visibly flashed every time. Fixed: skip the pre-open entirely when `supa && supaSession` is already truthy (restored from localStorage) — after the first successful connect, no popup opens on any later login.
5. **Fast database status card** (Settings → Company & DB → "Fast database (Supabase)") — `renderSupaStatus()` shows Connected/Not connected for the current browser session, plus a manual **"Connect now"** button (`_supaManualConnect()`) as a fallback for anyone whose auto popup got blocked — a real click, so no pre-open workaround needed.
6. **Dismissible connect-nudge banner** (`_maybeShowSupaConnectBanner`/`showSupaConnectBanner`/`_dismissSupaConnectBanner`) — bottom-left corner, appears ~6s after login only if still not connected (giving the real automatic attempt time to finish first), points at Settings → Company & DB. Dismissal is per-session (sessionStorage) — reappears next login if still not connected, doesn't nag within a session.
7. **Lami backup reminder** (`_lamiRemindSupaConnect`) — if the banner is closed via the **×** (ignored) rather than **Go** (already fixing it), Lami adds a chat message about it and lights the (previously-unused) `chip-alert-ring` dot on her chip button if her panel is closed, cleared when the panel opens.

### The Google Sites embed connection bug (found while testing Phase 1 live)
8. **NOT a caching bug** — first suspected the long-standing "Google Sites iframe caches the embed" issue; ruled out by fetching the *exact* URL the iframe's `view-source:` revealed (`?v=4`) directly — it was already serving fully current code. Both incognito and regular Chrome inside the embed also matched.
9. **Real root cause: storage partitioning.** The auto-connect/manual-connect popup is a normal top-level window, so it persists the Supabase session to the regular, unpartitioned localStorage for `rotaligatos.github.io`. But the app running inside a Google Sites iframe is a **cross-site iframe context** for that same origin — browsers deliberately partition an iframe's storage separately from a top-level popup's storage for the identical origin, specifically to prevent cross-site tracking. The popup completed the OAuth handshake correctly every time; it just wrote to a storage bucket the iframe-embedded app could never see. This is a browser security boundary, not a bug in our code.
10. **Fix (commit `cba4e9d`)** — the popup now hands the session directly to the opener via `postMessage` (origin-checked to `https://rotaligatos.github.io`) instead of relying on shared storage; the opener listens and calls `supa.auth.setSession()` directly, persisting it in its own storage partition. Works identically whether the opener is a plain tab or inside any iframe. **Confirmed working live in the actual Google Sites embed** via the manual Connect button.
11. **Known side effect** — anyone who already had a failed auto-connect attempt *before* this fix has a "used up" guard flag and won't auto-retry (the guard doesn't distinguish "user rejected it" from "failed due to our bug"). They need one manual "Connect now" click — same one-time action, just not automatic for them specifically. This is exactly what the Phase 1 banner + Lami reminder (items 6-7 above) now surface automatically.

### Phase 2 — Verified real usage (not just a connected session)
12. Queried Supabase directly (`auth.users`, API logs) rather than trusting the UI: confirmed two real staff accounts had genuinely signed in via Google, and live REST traffic (`GET /rest/v1/quotations`, `/clients`, `/settings`, `/user_prefs`, storage list calls) was actually hitting Supabase during real usage — not silently falling back to Sheets.

### Phase 3 — Approvals + messages pollers moved off Sheets (commit `6466464`)
13. `gLoadApprovalRequests()`/`gLoadMessages()` now try Supabase first (`supaGetApprovalRequests`/`supaGetMessages`), falling back to Sheets on genuine error. Unlike Price DB (below), an **empty** result here is a normal state (no pending requests / no messages yet) — returns `[]`, not treated as "not synced."
14. Found + fixed two real gaps while wiring this: `supaUpsertApprovalRequest` never captured the requester's display name (only email) — approval cards read via Supabase would've shown a blank "By:" line; fixed by adding `from` to the dual-written payload. `_msgMarkRead()` required a cached Sheets row index to do anything at all, including the Supabase-side update — meaning marking a Supabase-sourced message read would have silently no-op'd; fixed to always fire the Supabase update, only conditionally fire the Sheets update.
15. `_mergeApprovalReqsIntoNotifs()` extracted as a shared merge step so the Supabase-shaped and Sheets-shaped rows normalize identically — no duplicated, driftable logic (the Stage1/Stage2 lesson applies here too).

### Phase 4a — Price DB backfill + read flip (commits `dd14e3f`, `0db4f6e`)
16. Checked Supabase directly before writing anything: `price_services` had 48 rows, but `price_materials`/`price_hardware`/`cabinet_templates` were all **zero** — their dual-write only fires on re-import/re-init, which nobody had done since that code shipped.
17. `supaMigratePriceDb()` — one-time console-run backfill seeding Supabase from the current Sheets Price DB.
18. `loadPriceDatabase()` now tries Supabase first via `supaGetPriceDb()` — **opposite empty-handling rule from Phase 3**: here an empty table means "not backfilled," not a valid state, so ALL FOUR tables must have data or it falls back to Sheets *entirely*, never mixing sources (verified this exact scenario — Materials empty — correctly falls back instead of serving a blank dropdown).
19. **Real incident + fix**: running `supaMigratePriceDb()` twice (re-pasted before seeing "done") caused `price_materials` to look tripled (153,816 rows). Root-caused to `supaReplaceTable()`'s delete-then-insert not being atomic — a second overlapping call's delete can fire while the first's (large, slow) insert is still in flight. Fixed: per-table in-flight lock (`_supaReplaceInFlight`) skips a second concurrent call outright instead of racing; large tables now insert in 500-row chunks instead of one giant request; `supaMigratePriceDb()` itself also guards against double-invocation (`_priceDbMigrationInFlight`).
20. **Then discovered the 153,816 number was real, not a duplication bug** — re-ran once cleanly (guard confirmed no double-run happened) and got the exact same total, with genuine repeated (name,unit,price) rows confirmed present in the source Google Sheet itself (e.g. `"Yellow/Warm White PB 4x8 (12mm, Matte)"` appearing 3×). Not a code bug at all — a real data-hygiene question for the user's Materials tab, deferred as a separate cleanup task (harmless either way — duplicate rows don't break pricing, just clutter the dropdown).
21. **Operational rule documented** (see "Known remaining areas to watch" above): editing the Price DB Google Sheet directly (vs. the app's Import Excel buttons) does not dual-write to Supabase — must run `supaMigratePriceDb()` afterward or connected users see stale data with no warning.

### Phase 4b — Logistics DB backfill + read flip (commits `0192577`, `e588acb`)
22. Same pattern as 4a: `logistics_materials`/`logistics_trucks` confirmed empty in Supabase; `supaMigrateLogisticsDb()` backfill built (reuses the now-race-safe `supaReplaceTable()` for free); `gLoadLogisticsDb()` flipped to Supabase-first with the same "all tables must be non-empty or fall back together" rule.
23. **Turned out to be dormant** — this account has never actually connected a Logistics DB Google Sheet (Settings → Logistics DB showed "Not connected"). Code is deployed and correctly no-ops (skips both Sheets and Supabase) when `LOGISTICS_DB_ID` is unset. Nothing more to do unless/until the feature is ever set up.

### Phase 4c — Users/login-auth read: decided AGAINST, not just deferred
24. Checked Supabase's `users` table directly: also completely empty (same "dual-write never fired" pattern). But unlike 4a/4b, **decided not to backfill or flip this one at all** — login happens once per session (not polled), so the performance upside is a single marginally-faster read per person per day, while the downside (stale Supabase data — e.g. an Admin deactivating someone or changing a role directly in the User Roles sheet, very plausible for a roles sheet) means someone could log in with the wrong permissions or be wrongly denied access. Cost/benefit doesn't clear the bar the way it did for the polling reads or Price DB. **`gCheckRole()` stays Sheets-only permanently by deliberate decision.**

### Remaining from the original 5-phase plan
- **Phase 4d (Orders)** — still on hold; new Wufoo submissions land via a separate Google Apps Script webhook writing straight to Sheets, bypassing Supabase entirely; flipping this read would show nothing for new orders until that separate script (outside this file) is also updated. Not started.
- **Phase 5 (single-file size)** — lowest priority; the 1.5MB/23,000-line single-file architecture itself wasn't the main cause of the reported slowness (that was almost entirely the Sheets backend + inactive Supabase migration), so this remains deferred until/unless it becomes the bottleneck.
- **Drawing-analysis auto-save needs same-session continuity** — reflecting a Designers Support analysis into a quotation stashes the full raw file + output in memory (`qDrawingAnalysis`), but it's only written to Storage/Drive at Stage 1/2 lock or Client Approve (same timing `qBoardLayout` already used). If the browser is closed between reflecting and locking, only a lightweight summary (fileName/fileType/analyzedAt/componentCount) survives in the saved draft — locking in a later session without re-analyzing correctly no-ops rather than resurrecting stale data, but the user needs to keep the tab open from reflect through lock/approve for the save to actually happen.
- **HPL lamination auto-detect is regex-based, English-only** — `prodComputeBom()` flags a component as HPL via `/\bhpl\b/i` against `material`+`notes`; only recognizes 2 substrate buckets (Plywood → Manual HPL Lamination; PB/MDF/-MR variants → HPL Lamination) per the user's specified rule. Compact Laminate, HDF, or an undetectable substrate/face-count correctly flags for manual review rather than guessing — expected, not a bug, but worth remembering if a real cutting list's HPL note uses unusual phrasing that the regex still catches but the substrate parser doesn't.

## What was changed on 2026-07-16 (session — Lami TTS fix, client-supplied materials, cutting-list print mode, perf, quality-of-life)

### Lami TTS overlapping-speak race (commit `8ac1a8c`)
1. **Root cause of "talks, abruptly cuts off, resumes"** — this was misdiagnosed in an earlier session as a generation-speed stall and "fixed" with a head-start sentence buffer (commit `84daa20`). That fix introduced a NEW bug: when the buffer flushed 2+ sentences at once, it called `_ttsAppendClean()` once per sentence in a loop — each call independently checked `if(!_ttsSpeaking) setTimeout(_ttsPump,40)`, but `_ttsSpeaking` isn't set `true` until that scheduled `_ttsPump` actually *runs* (not when scheduled), so multiple sentences flushed together each saw "not speaking yet" and each scheduled their own `_ttsPump` — two pump chains then raced to speak from the same `_ttsQueue` concurrently (overlapping `speak()` calls), which is what actually caused the abrupt mid-sentence cutoff.
2. **Fix** — join the buffered sentences into ONE string and make a single `_ttsAppendClean()` call per flush (`_ttsSplitChunks` re-splits it back into the same per-sentence chunks, so output is unchanged) — only one `_ttsPump` gets scheduled per flush. Verified via mocked `speechSynthesis`: old pattern fired 2 overlapping `speak()` calls within ~40ms while the first utterance was still playing; new pattern fires 1 immediately and the second only after the first utterance's `onend`.

### Client-supplied materials — un-graying + cost counted normally (commits `e9e2ec0`, `3deb812`)
3. **Removed the opacity/pointer-events lock** on the Materials section (both BOM mode `renderBOMSection` and cutting-list mode `renderItems`) when Client-supplied materials is on — the client rarely supplies 100% of materials, so the company still needs to enter qty/price for whatever it supplies itself; the informational badge is unchanged.
4. **Materials now count normally toward the quotation total** when Client-supplied materials is on — previously `getBOMItemUnitCost()` and `getAreaSubtotal()` excluded ALL materials cost while the toggle was on; removed the `!qClientSupplyMat` gate on materials in both functions (hardware/outsource were already unconditionally counted; services keep their existing uplift, unchanged). Zero out or delete rows for whatever the client actually provides.

### Cutting-list: Edge Tape catalog fix (commit `dcdf8cc`)
5. The manual cutting-list Materials/Hardware add-row search falls back to hardcoded `MAT_CATALOG`/`HW_CATALOG` suggestion lists when the connected Price DB has no match — "Edge Tape 0.4mm (per roll)" was only in `HW_CATALOG`, so it only ever suggested under Hardware, never Materials, even though this app's own convention prices edge banding tape as a material. Moved the entry to `MAT_CATALOG`.

### New quotation print mode: Services, Materials & Hardware (commit `a9b4186`)
6. New itemized print mode in the quotation preview toggle bar (`buildItemizedPrintRows()`), gated to cutting-list (services) mode + "Fabrication only" quotations only — not offered for BOM/carcass modes or quotations that include Installation; falls back to "By area" automatically if the fab mode/service type changes while selected.
7. For **World Class Laminate, Inc.** quotations specifically, the Materials section in this mode hides unit price and amount (SKU name + qty only) — services and hardware pricing are unaffected. Outsourced materials/hardware are folded into their matching section so each area's printed subtotal still equals the real `getAreaSubtotal()` total.

### Performance: stop wasted BOM+catalog recompute on field edits (commit `328c4e2`)
8. `_prodComponentFieldCorrected` was re-running `prodComputeBom()` — the full guillotine board-packing simulation across every material group — on every single EBT or grooving correction, even though neither field is part of `prodComputeBom`'s grouping key or piece list. Now only a `faces` correction (which IS part of the grouping key) triggers the BOM recompute.
9. `_prodFindCatalogMatches` was re-tokenizing every catalog entry's name from scratch on every call (once per BOM/hardware group during a reflect pass). Each catalog item's tokenization is now cached on the item object itself (`item.__tok`) — safe since `dbMaterials`/`dbHardware` are only ever replaced wholesale on a fresh Price DB load.

### Designers Support: auto-save + re-access drawing analyses (commits `6e25a89`, `a8add60`)
10. When a Designers Support analysis is reflected into a quotation, the raw uploaded file + complete AI output are now captured (`qDrawingAnalysis` global, near `qBoardLayout`) and persisted to **Supabase Storage (primary) + Google Drive (failover)** — the standing file-storage architecture decision — at the same lock/approve points `_saveBoardLayoutToDrive()` already uses (Stage 1 lock, Stage 2 lock-send, Client Approve), not earlier, since `qSerial` is only a preview number before locking.
11. New Supabase table `drawing_analyses` (one row per quotation — metadata + Storage/Drive paths only, never the analysis JSON itself, so the list stays fast regardless of accumulation) backs a new **"Saved Analyses" tab** in Designers Support: a global, filterable list (by serial/client/file name) with **View/Edit** (reopens the saved output into the existing review UI unchanged), **Download raw file**, and **Print** (new `_buildDrawingAnalysisPrintHtml`, modeled on `_buildBomHtml`, not the tightly-coupled interactive `prodBuildResultHtml`).
12. New binary-safe upload helpers (`_driveUpsertBinaryFile`, `supaUploadQuotationBinaryFile`, `_base64ToBlob`) — the existing `_driveUpsertFile`/`supaUploadQuotationFile` treat content as plain text and would corrupt a real binary file (e.g. a PDF) if passed a base64 string directly.
13. **Bug found + fixed same session**: `qDrawingAnalysis` was initially wired into the same state-persistence functions as `qBoardLayout` (`captureQuotationSnapshot`/regular Save Draft state save) — fine for `qBoardLayout` (small BOM summary), but `qDrawingAnalysis` also carries the raw file as base64 (often 1-2MB+), so every ordinary "Save Draft" click was embedding the entire file into the quotation's state record (and, via `qOptionsList[i].snapshot`, once per quotation option). Fixed with `_daLightweightSummary()` — state persistence now saves only `{fileName, fileType, analyzedAt, componentCount}`; `_saveDrawingAnalysisToDrive()` is unaffected since it reads the live `qDrawingAnalysis` global directly. Tradeoff: reflecting then locking must happen in the same browser session for the full save to fire (see "Known remaining areas to watch").

### Designers Support: catalog-match revert + field-aware matching (commits `6a45526`, `e0d939c`)
14. **Materials/hardware catalog matches can now be changed after the fact** — previously, once a flagged match was picked (or auto-resolved with a single confident match), the candidate list got wiped and the picker disappeared for good. `catalogMatchRow` now keeps `matchCandidates` on the row permanently; every resolved row shows a persistent "Not right? Change match" link (`_prodCatalogRowReopenPicker`) that reopens the same picker, merged with an always-available Outsource option (`_prodCatalogRowMatchPicked` now handles `val==='outsource'` too). Removed the now-redundant standalone Outsource checkbox.
15. **Field-aware, order-independent catalog matching** — `_prodFindCatalogMatches` previously did plain bag-of-words token overlap (already order-independent for whole words, but blind to which field each word represents). New `_prodParseMaterialDescriptor(text)` extracts substrate (PB, MDF, MDF-MR, PB-MR, Plywood, Compact Laminate, HDF + synonyms), face count (1F/2F + synonyms), texture (matte/stipple/supermatte/crosscut/woodgrain/softwood/hardwood/textile/stone), and thickness from free text, independent of word order — whatever's left is color text, compared via order-independent word containment. `_prodFieldMatchScore` treats a known substrate mismatch as a hard exclude; blended with the existing token-overlap score so hardware (no substrate/face/texture concept) falls back cleanly.
16. **Found + fixed the same class of bug as the earlier `faces` grouping gap**: `prodComputeBom`'s grouping key/output never carried `colorB`/`textureB` (the second face's color/finish for split-face materials, e.g. Black one side / White the other) even though the AI schema already extracts them separately — so a split-face material's search term only ever mentioned the primary color. Added `colorB`/`textureB` to the grouping key and to the search-term construction in `prodBuildSummary`.

## What was changed on 2026-07-17 (session — HPL lamination auto-detect)

1. **Designers Support now auto-detects HPL and adds the lamination service + sheet material** (commit `7799af2`) — when a component's `material`/`notes` mentions "HPL" (`/\bhpl\b/i`), `prodComputeBom()` flags the BOM group (`hpl` added to the grouping key, so an HPL-laminated panel is never silently merged with a plain melamine-faced board of the same substrate/color/thickness/faces) and `prodBuildSummary()` adds two extra lines beyond the substrate board: the HPL sheet as a normal matched/flagged material row, and a lamination SERVICE whose catalog name depends on substrate (via `_prodParseMaterialDescriptor`) — **Plywood → "Manual HPL Lamination 1/2 Face (Plywood)"**, **PB/MDF (incl. -MR variants) → "HPL Lamination 1/2 Face (MDF/PB)"** — these 4 exact service names/prices already existed in `INIT_SERVICES` (~line 18105-18108), just not wired to the drawing-analysis pipeline before. Quantity is the panel's own area (sqm), not doubled for 2-face, since the 1F/2F SKUs are already priced ~2x apart in the catalog for the extra labor. Unrecognized substrate or undetectable face count flags for manual review rather than guessing, consistent with the pipeline's flag-not-guess philosophy.

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
