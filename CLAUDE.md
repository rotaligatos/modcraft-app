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
13. **Wufoo API key obtained** — ``<in the Apps Script project — NOT recorded here, see Security below>``; placed in GAS script; `doGet` run manually once for Drive OAuth approval
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
- ✅ **Price DB staleness — FIXED 2026-08-11 (`9516cac`). The old rule below is retired; do not
  reinstate it.** `loadPriceDatabase()` reads Supabase first (Phase 4a, 2026-07-05), and editing the
  Price Database **Google Sheet directly** never reached Supabase — only the app's own Import
  buttons dual-write. So a newly added, renamed or repriced SKU was invisible to every signed-in
  user, silently. **This is the whole explanation for the recurring "an SKU is missing" reports.**
  Measured on 2026-08-11: all 153,552 material rows carried the same `updated_at` of **2026-07-18**
  — one bulk write, nothing since. The mirror held DuraSave in Real White and Warm White only (no
  Coastal Driftwood), and the edgeband at its pre-rename name and old ₱20 price.
  ⚠ **The old rule was "direct Sheet edit → always follow with `supaMigratePriceDb()`". That is a
  reminder, not a safeguard, which is why it failed repeatedly.** A banner asking someone to notice
  and click was the same mistake one step along. Now: `_checkPriceDbFreshness()` compares the
  spreadsheet's Drive `modifiedTime` against the newest mirrored row BEFORE the load decision — if
  the sheet is newer the mirror is **not used at all** (the app reads the sheet, which is right by
  definition) and `_autoSyncPriceDb()` re-mirrors in the background. When freshness cannot be
  determined it uses the mirror exactly as before, so an unrelated Drive failure never makes the
  catalogue slow for everyone. Nobody has to remember or notice anything.
- **Fullscreen ✅ COMPLETE** — works on GitHub Pages; suppressed in Google Sites embed (no `allowfullscreen`); ⛶ button opens app in new tab from embed. **Installing the app (2026-08-10, `5675047`) sidesteps this entirely — no iframe, so fullscreen just works.**
- **Blank PDF on Send email** — RESOLVED ✅ (confirmed 2026-06-13)
- **Carcass pricing tab** — now persisted ✓
- **Drive saves in Google Sites embed** — RESOLVED ✅ (confirmed 2026-06-13)
- **First-time setup flow** — user needs to: sign in → Settings → Test connection → Create missing tabs → Save settings
- **Google Sites iframe cache** — RESOLVED 2026-08-10 for anyone on that build or later: the app now
  detects a stale build itself and offers a reload (`_checkForNewBuild`, commit `8942164`). Bump
  `?v=N` on the embed ONCE to pull everyone onto it; after that it is self-announcing. **Installing
  the app avoids the embed altogether** — see the PWA entry in the 2026-08-10 session.
- **Cross-session approval apply** — `_applyApprovedRequest()` updates the quotation form only if it is open in the same browser session; requester must navigate away and back to see the approved state if they were on a different page when approval happened
- **User Roles sheet column R** — Claude API key is stored in header row column R (index 17); this is the same column used by the `Projects` ACC_KEY for data rows — no conflict because Claude key is only read from `rows[0]` (header) and ACC_KEY data is read from `rows[1+]` (data rows)
- **`_localActions` guard duration** — approval/counter actions are guarded for 30 s against poll revert; if the Sheets write takes longer than 30 s (network issue), the next 60 s poll may briefly revert the status before the write completes
- **`SERVICES.price` deferred** — price field kept in Services tab for now; it is actively used by `getAreaSubtotal()` for services-mode cost calculation; editable in Cost Breakdown card header; full redesign deferred to Phase 3
- **Semantic duplicates in Price DB** — "Clean duplicates" button only catches exact-name matches; user must manually standardize semantically similar service names using the amber similarity highlight in Settings → Services tab
- **Wufoo attachment via Drive (DONE ✓)** — API key ``<in the Apps Script project — NOT recorded here, see Security below>`` deployed; Drive OAuth approved; new submissions automatically upload to Team Drive; fetch URL directly (no auth header — S3 pre-signed URL)
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
- **HPL lamination auto-detect is regex-based, English-only** — `prodComputeBom()` flags a component as HPL via `/\bhpl\b/i` against `material`+`notes`; only recognizes 2 substrate buckets (Plywood → `HPL Lamination (Plywood, N Face)`; PB/MDF/-MR variants → `HPL Lamination (MDF/PB, N Face)` — renamed 2026-07-30, see that session) per the user's specified rule. Compact Laminate, HDF, or an undetectable substrate/face-count correctly flags for manual review rather than guessing — expected, not a bug, but worth remembering if a real cutting list's HPL note uses unusual phrasing that the regex still catches but the substrate parser doesn't.

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

1. **Designers Support now auto-detects HPL and adds the lamination service + sheet material** (commit `7799af2`) — when a component's `material`/`notes` mentions "HPL" (`/\bhpl\b/i`), `prodComputeBom()` flags the BOM group (`hpl` added to the grouping key, so an HPL-laminated panel is never silently merged with a plain melamine-faced board of the same substrate/color/thickness/faces) and `prodBuildSummary()` adds two extra lines beyond the substrate board: the HPL sheet as a normal matched/flagged material row, and a lamination SERVICE whose catalog name depends on substrate (via `_prodParseMaterialDescriptor`) — **Plywood → "HPL Lamination (Plywood, 1/2 Face)"**, **PB/MDF (incl. -MR variants) → "HPL Lamination (MDF/PB, 1/2 Face)"** *(names as renamed on 2026-07-30; originally "Manual HPL Lamination …(Plywood)" and "HPL Lamination … (MDF/PB)")* — these 4 exact service names/prices already existed in `INIT_SERVICES` (~line 18105-18108), just not wired to the drawing-analysis pipeline before. Quantity is the panel's own area (sqm), not doubled for 2-face, since the 1F/2F SKUs are already priced ~2x apart in the catalog for the extra labor. Unrecognized substrate or undetectable face count flags for manual review rather than guessing, consistent with the pipeline's flag-not-guess philosophy.

## What was changed on 2026-07-18 (session — Supabase liveness/RLS/access grants, critical Stage 2 crash fix, Wufoo consolidation, approval authority)

Large session, several distinct threads. All shipped, deployed, and verified live.

### Supabase disconnection visibility (commit `20cb3fa`)
1. `supaReady()` previously only checked session-object truthiness, never actual connectivity — the root cause of a previously-documented 11-day silent dual-write outage that went completely unnoticed. `_supaCheckLiveness()` now runs a real query 8s after login and every 15 min while logged in; `renderSupaStatus()` (Settings → Company & DB) shows three real states — Connected (verified) / Connection problem (session looks fine but a live check just failed) / Not connected — instead of the old binary.
2. `_supaHandleConfirmedBroken()`/`_supaClearBrokenSince()` — durable (localStorage) "broken since" tracking; shows an urgent banner immediately on a confirmed break, escalates to the Admin via in-app message once broken 24h+, one notification per episode, auto-clears on recovery.

### RLS tightened to company/role scoping — Supabase-side, no index.html deploy needed for the policies themselves
3. 10 core tables (quotations, quotation_states, clients, board_layouts, drawing_analyses, pending_orders, approval_requests, activity_log, user_prefs, users) moved from blanket "authenticated full access" to real scoping, ported from the existing `filterApprovalsByRouting()` JS model: Admin/Director see everything; Manager+`receive_all` sees everything; everyone sees their own company; active delegates inherit whatever their delegator can see. Left deliberately open (shared, non-company catalogs): settings, price_services/materials/hardware, cabinet_templates, logistics_materials/trucks, mapping_audit. `messages` already had correct per-user policies — used as the reference pattern.
4. New Postgres SECURITY DEFINER helpers in `public` schema: `app_current_email()`, `app_current_role()`, `app_is_admin_tier()`, `app_sees_all_companies()`, `app_visible_companies()`, `app_normalize_company(text)` (keyword-based — module/cebu/else — NOT exact string match), `app_company_visible(text)`.
5. **Two real bugs caught before any policy went live, both would have silently locked out real staff**: (a) 7 of 12 real users have "Module **System** and Services, Inc." (singular) vs the app's canonical "Module **Systems**..." (plural) — exact-match would have locked them out; fixed via keyword normalization, same pattern `_mobOriginFor()` already uses. (b) 4 of 12 real user emails have trailing whitespace in the Sheet — fixed via `btrim()` on both sides of every email comparison.
6. **Prerequisite**: `public.users` only had 4 rows (dual-write only fires on Admin-driven saves, most staff never re-saved since that shipped). Added `supaMigrateUsers()` (commit `8c77378`) — one-time backfill from User Roles, same pattern as `supaMigrateAll()`. Also fixed `supaUpsertUser()` silently dropping `delegateActive`/`receiveAll` (only `delegate_to` survived) — added `delegate_active`/`receive_all` columns and wired them in.
7. Verified live against real data (not a branch — branches start empty) by switching to the `authenticated` Postgres role and setting `request.jwt.claims` per real test user: Admin/Director see everything, Manager+receive_all sees everything, plain Manager/Supervisor/Staff see only their own company, unknown/no-JWT sessions see zero rows everywhere (fails closed), `WITH CHECK` confirmed blocking a cross-company INSERT.
8. Fixed a real `auth_rls_initplan` perf issue in the app's own new `app_current_email()` (wrapped `auth.jwt()` as `(select auth.jwt())` so Postgres evaluates it once per query, not once per row) — matters as `price_materials` (153k rows) and `quotations` keep growing.
9. **Known, deliberately NOT fixed**: this same Supabase project also hosts 22 `pmes_*` tables (a full Production Management/Execution System with real live data) that have BOTH `anon` and `authenticated` "full access" policies — since Modcraft's anon key is public, that system is currently reachable by anyone with the key, no login required. Confirmed by the user this will be addressed in that app's own separate development track, not folded into Modcraft's RLS work.

### Explicit per-company access grants (commit `1ae7813`) + routing fix (commit `53630bc`)
10. User pointed out reusing `receive_all` (the approval-routing "receive from all companies" flag) to also silently gate quotation/client visibility was confusing. Added a dedicated `access_companies text[]` column on `public.users` (normalized keys) — granular per-company grants, available to any role (not just Manager+), shown as checkboxes in **Settings → Users → "Additional company access"** (hidden for Admin/Director since redundant). `app_visible_companies()` now unions: own company + `access_companies` + delegation-inherited company. `receive_all` unchanged — the two mechanisms coexist (receive_all = all companies present+future, unbounded; access_companies = a specific list, bounded).
11. **Follow-up bug found while re-verifying the design**: `filterApprovalsByRouting()` (the Approvals page's own client-side display filter) had no knowledge of `accessCompanies` — a grant let Supabase RLS return another company's `approval_requests` rows, but the UI silently re-hid them before rendering. Only affected the Approvals page (quotations/clients/orders have no equivalent re-filter, worked correctly from the start). Fixed by removing the hard `Staff`/`Team Lead` early-return and letting every role flow through the same `visibleCos`-building + merge logic, now populated with `accessCompanies` too.
12. As of this session, real grants are live: Allan Lagsao (MSSI Manager) → WCL+CWL, Michael Delos Reyes (WCL Manager) → CWL, several MSSI Staff → WCL+CWL or WCL only.

### Full codebase review — not security-only, found real live bugs (commits `3d2ff60`, `27a9727`)
13. **`recalcFQ()` (Stage 2) has thrown an uncaught `ReferenceError` on every "Fabrication with Installation" quotation since 2026-05-26 (commit `92edc8d`) — nearly 2 months, live.** Line ~15477 referenced a bare `instRate` never declared in that function's scope (only exists as an unrelated local inside a different function, `renderFQCards()`). Confirmed real impact via SQL: **22 live quotations** (11 Approved, 11 Locked) are that service type — the Stage 2 summary panel and grand total silently failed to render for all of them whenever staff opened Stage 2. Fixed by swapping the typo for the variable `recalcFQ()` already correctly computes under the same name Stage 1 uses: `instUnitPrice`. Reproduced the crash live before fixing, confirmed gone after.
14. **4 more Stage1/Stage2 drift bugs found in the same audit, same function, all fixed alongside**: `_pCalc.svCost` hardcoded to 0 in Stage 2 regardless of separately-charged site visit (suppressed the printout's Site Visit line); admin box's "Discount buffer" row unconditional in Stage 2 (showed even at 0%); MSSI/Designers commission admin rows dropped their "(X%)" suffix in Stage 2; **Stage 2's admin box was missing the "Site visit in mob" transparency row entirely** — the exact fix Stage 1 got 2026-07-04 (commit `a303d87`) never made it to Stage 2.
15. **Supabase `users` table had 3 duplicate rows** (allan.lagsao, michael.delosreyes, stiffany.gabut) — `supaUpsertUser()` lowercased email before upserting but never trimmed it, so a raw-Sheet value with trailing whitespace and a later-cleaned version created two rows instead of updating one. Fixed both `supaUpsertUser()` and `supaDeleteUser()` with `.trim()`; ran a one-time SQL cleanup removing the 3 existing duplicates (back to exactly 12 real rows).
16. Also investigated and confirmed benign: 29 quotations with no `quotation_states` row (all pre-migration test/legacy junk from May/June — "Testes", "kamote", `total:0.00`), zero broken `onclick`/`onchange` UI references across ~1050 checked, no orphaned FK rows anywhere.

### Wufoo attachment consolidation (commits `8db343d`, `699bbfe`, `0b62743`)
17. **`_copyOrderAttachmentsToQuotationFolder()`** — when a quotation exported from a Wufoo order is locked/approved, its original attachment(s) now get copied (not just linked — self-contained even if the shared order folder is reorganized) into the quotation's own Drive + Supabase Storage folder, named `QT-XXXX — Client — Wufoo attachment N.ext`, alongside the drawing analysis/board layout/printouts already saved there. Extracts the Drive file ID from the order's attachment URL, fetches real content via the Drive API, uses the same idempotent upsert helpers `_saveDrawingAnalysisToDrive()` already uses. Legacy pre-Drive-migration Wufoo URLs (no extractable file ID) are skipped cleanly, not treated as an error. Forward-only — no retroactive backfill.
18. **Fixed the same day**: those save hooks (board layout, drawing analysis, Wufoo attachment) only fired on Stage 2 lock/approve, never Stage 1 — a quotation locked at Stage 1 but never reaching Stage 2 (rejected, cancelled, or client only needed an estimate) would have its folder missing all three. Added the same 3 calls to both Stage 1 lock branches.
19. **`_cleanupCancelledQuotationFiles()`** — when a quotation is explicitly cancelled (`confirmCancelQuotation()`, the ONLY place `qCancelled` gets set, requires typing a reason), its supplementary files (drawing analysis, board layout, Wufoo attachment copies) are removed from Drive/Storage — the quotation's own record (state, Draft/Final printouts, BOM report, cost detail) is never touched. Uses an **allowlist match on 4 exact filename markers** (not a blanket folder wipe) so a bug here can only ever under-delete, never accidentally remove a real deliverable. Immediate (no grace period — there's no "un-cancel" action anywhere in the app), forward-only. Also deletes the `drawing_analyses`/`board_layouts` Supabase table rows for the serial.

### Fine-grained approval authority (commits `2ac63b0`, `596d60f`)
20. **Discount escalation threshold** — top management policy: a Manager can approve their own discount up to a configurable % (default 10, `CF.discountEscalationThreshold`, editable in Settings → Approval Routing, Admin/Director only). Above it, the request always routes to a Director (falling back to Admin if none active) — regardless of Settings → Approval Routing's normal assignment, and regardless of whether the requester is themselves a Manager who'd normally self-approve via PIN. Director/Admin exempt at any amount (they ARE the escalation target). Applied to both `onDiscRequest()` (Stage 1) and `fqOnDiscRequest()` (Stage 2) from the start. Discount-only for now, not CF override/non-VAT/premium.
21. **Mandatory PIN setup before approving** — closes the "1234" shared fallback gap. The moment a user without a personal PIN tries to approve anything (any of discount/VAT/override/unlock/premium — all funnel through the one shared `_openPinModal()`), they're redirected to set a PIN first, then their original action resumes automatically (`_pendingPinResume`). Never redirects someone into setting up a PIN on another approver's behalf (gated on `isSelf`). Side fix bundled in: `submitSetPin()` never dual-wrote to Supabase (`supaUpsertUser(me)` added).

### Confirmed healthy, no code needed
22. **Serial-number atomic claim service** — URL is configured and genuinely working (confirmed via the in-app "Test claim" button; an external curl-based test gave a false negative, likely due to Google routing/authenticating a cookie-less external request differently than the logged-in browser's own `fetch()` — worth remembering next time testing a Google-hosted webhook externally).
23. **Synology NAS nightly backups** — confirmed healthy via direct DSM inspection: unbroken daily `pg_dump` sequence 07/07–07/18 with no gaps, today's file real and correctly sized (1.7MB). An earlier "last saved 9 days ago" concern turned out to be a misread of the DSM UI, not a real gap. (Minor, non-blocking: the script's own `last_run.log` self-logging writes 0 bytes despite the actual dump succeeding — cosmetic, not fixed this session, would need the script's source pasted to diagnose.)

## What was changed on 2026-07-19 (session — Cabinet POC Phase 4: AI reads elevation drawing, feeds parametric engine)

> All work this session is in the **standalone** `poc_cabinet.html` (Drawing Intelligence Pipeline) — NOT the deployed `index.html`, except where noted. This is Phase 4 of the original 5-phase roadmap (see 2026-06-09 session 4): "AI reads elevation → feeds engine." **Phase 3 (cutting layout/nesting) was already shipped separately in the deployed app on 2026-07-07** (`guillotinePackBoards()`, a different pipeline that runs on AI-extracted BOM from Designers Support, not the POC's parametric engine) — this session did not touch that.

### Phase 4 built from scratch, then iteratively hardened against real drawings
1. **First pass (commit `4f71100`)** — added an "AI reads a drawing" panel to `poc_cabinet.html`: Claude API key input (localStorage), image upload, Analyze button. Sends the image to `claude-sonnet-4-6` with a strict-JSON prompt extracting **intent only** (type + W/H/D + material — never geometry/EBT/hardware, per the pipeline's core architectural principle). Scoped to base cabinets only for the first pass; non-base detections flagged with the AI's guess instead of silently applied. Out-of-range dimensions clamped to the engine's slider bounds and visibly flagged. "Apply to engine →" fills the sliders and calls the real `render()`/`buildCabinet()` — same code path as manual entry.
2. **Multi-cabinet detection (commit `f90b9d1`)** — first real drawing (3 cabinets: open base, 2-door base, 2-door under-sink) collapsed into one wrong guess, and cropping to isolate one cabinet lost context (the toe-kick got cropped out, causing a correct base cabinet to be misread as wall-hung). Rewrote the prompt to detect ALL cabinets in one image, left to right, using shared context per cabinet; each renders its own card + its own Apply button. Widened supported types from base-only to all **9 confirmed** engine types (base, wall, tall, drawer, sink, corner, cornerwall, openshelf, microwave) since the real drawing needed sink too — the 5 parked/unverified types stay excluded.
3. **Detected-cabinet-count display (commit `a93951b`)** — explicit "Detected N cabinets (M auto-fillable)" line so it's obvious at a glance whether all cabinets were found.
4. **Per-dimension verification flags (commit `36abe84`)** — real-drawing testing showed the AI folded an outer wall/slab-overhang reference dimension into a cabinet's width (should use the door/opening span instead), and applied a floor-to-slab height as carcass height with no flag that a deduction was needed. Added explicit "dimension discipline" rules (width = cabinet's own span, never the outer reference; height deductions must cite evidence VISIBLE IN THAT drawing, not a generic "typical countertop" assumption; depth always flagged on elevation-only views) plus a per-cabinet `needsVerification:{width,height,depth}` rendered as a distinct "⚠ Verify: ..." badge separate from the confidence tag.
5. **max_tokens fix (commit `8d853df`)** — the more verbose verification-flag prompt pushed a 3-cabinet response past the old `max_tokens:1024`, truncating the JSON mid-response (surfaced as a cryptic parse error). Raised to 8192 + added an explicit `stop_reason==='max_tokens'` check with a clear "response was cut off" message.
6. **Type-verification flag + door/shelf extraction (commit `be16da0`)** — sink-fixture-to-cabinet matching was still wrong even after an x-position instruction (a likely genuine model weak spot for pixel-precise spatial reasoning, not fixable by more prompt wording alone) — added `needsVerification.type`: whenever a fixture symbol (not a structural feature) decided the classification, flag TYPE itself instead of silently committing. Also extended extraction to `door` (single/double/bifold/pullout/none) and `shelfType`/`shelfCount`, applied to the engine's existing `p-door`/`p-shelftype`/`p-shelf` fields — still "intent, not geometry," just two more input parameters the engine already had UI for.
7. **Sink/shelf exclusion + evidence-required door detection (commit `daf1e63`)** — user's domain insight: WCLI sink cabinets never have a shelf (pipe clearance) — confirmed `buildSinkOpen()` already has a solid bottom panel (not open-bottom) and no shelves. Added an explicit cross-check: a cabinet with a visible shelf cannot be classified 'sink' regardless of a nearby fixture. Also researched real cabinet/architectural-elevation drawing conventions (NKBA, AWI, general drafting practice) to ground door detection — a single diagonal line more often means glazing (glass), not "there's a door"; real door swing is dashed lines converging at a hinge point; conventions vary by office. Door is now only reported with an actual recognizable graphic cue; no cue → defaults to 'none' + new `needsVerification.door` flag instead of guessing "single."
8. **Boundaries-first reasoning (commit `fa1ace7`)** — a re-test showed the width fix had regressed (100mm crept back in) and a shelf/door mark got attributed to the wrong neighboring cabinet. User's diagnosis: both trace to the same root cause (imprecise cabinet-boundary tracking), not separate bugs — likely worsened by the growing prompt diluting the original width rule. Restructured around two explicit ordered steps placed early for primacy: **Step 1** establishes each cabinet's own left/right boundary from the group's own opening-span dimension chain (never the outer wall/slab reference); **Step 2** requires every other attribution (width/shelf/door/fixture) to use only evidence strictly inside that boundary, flagging BOTH neighbors as ambiguous rather than guessing when something straddles a boundary line.
9. **Leader-line evidence rule + model swap to `claude-opus-4-8` (commit `816c87f`)** — one residual issue: a door-swing dotted line belonging to the neighboring cabinet bled into the wrong cabinet's evidence. Added the user's proposed drafting convention: a mark (door indicator, shelf line, hardware symbol, note) belongs to the cabinet it's physically drawn INSIDE, unless a visible leader line/pointer explicitly connects it elsewhere — applied explicitly to door/hardware marks, not just text labels. Also swapped the model to `claude-opus-4-8` per user's request to test whether a more capable model handles the boundary/spatial reasoning more reliably (an experiment, not a guaranteed fix — framed as such; **POC only, the deployed app's Designers Support pipeline is untouched, still `claude-sonnet-4-6`**).
10. **CONFIRMED PERFECT (2026-07-19)** — re-ran the same 3-cabinet kitchen elevation on this version: all 3 cabinets correctly identified (types, dimensions, door, shelf), boundaries correctly tracked, sink correctly cross-checked by elimination, no more evidence bleed. Closes the multi-cabinet detection accuracy arc that started with the very first single-cabinet test on this same drawing.

### Working method established this session (reusable pattern for future Phase 4 work)
Every fix above traced to a real, specific failure the user found on an actual WCLI drawing — none were speculative. When multiple symptoms showed up together (width regression + shelf misattribution + door misattribution), the user traced them to one shared root cause (imprecise boundary tracking) rather than treating them as separate bugs — restructuring around that root cause (boundaries-first) fixed more at once than another round of reactive per-symptom patches would have, and avoided further diluting the prompt.

### Parked 2026-07-19 — no more good test samples right now
Most drawings on hand are bedroom/living-room (not cabinetry, out of scope for this simulation) rather than kitchen/cabinet elevations with dimensioned cabinet runs. **Next step when resumed:** validate against a SECOND, different real cabinet drawing (ideally a type not yet tested — wall/tall/drawer) to confirm the fixes aren't overfit to the one drawing they were tuned against; if it holds up, consider whether to port the model bump + accumulated prompt lessons back into the deployed app's Designers Support pipeline (separate decision — see the Opus-upgrade consideration in the 2026-06-09 session 4 entry above).

## What was changed on 2026-07-19/20 (session — FORGE app: 12 rounds of real-drawing-driven fixes, still not fully resolved)

> All work in this section is in the **standalone** `forge.html` — NOT the deployed `index.html`. FORGE is a separate app (per the multi-app-ecosystem decision) built on top of the confirmed `poc_cabinet.html` rules engine, adding an interactive 3D "twin" view: upload a drawing, see every detected cabinet rendered together, click/explode/edit parts, all in the browser. `poc_cabinet.html` itself was **not touched** this session (explicit standing instruction). This picks up from the 2026-07-19 Cabinet POC Phase 4 entry above, which is where the underlying AI-reads-a-drawing capability was first proven on a single drawing before FORGE generalized it into a full interactive tool.

### Core interaction bugs fixed (Rounds 11–14)
1. **Stable per-instance identity across repeated deletions** — deleting a shelf/door instance re-numbered the survivors, so a second delete on the same part collided with the first or hit the wrong box; also caused a surviving double-door leaf to flip to the wrong hinge side. Fixed by tagging every surviving box with its TRUE original index before the array gets compacted.
2. **Module split was silently duplicating work** — splitting a cabinet into N modules gave every module the FULL original shelf count (not a proportional share), and a manual split fought `buildTall`'s own automatic >8ft auto-split, producing more modules than chosen. Both fixed; also fixed a real height-clamp bug where every cabinet's height was silently capped at 2700mm regardless of type, under-reporting a genuinely tall unit by however much got clamped away.
3. **Delete key now works**, independent-module height resize now redistributes across siblings to keep the total height constant (previously each module was fully disconnected).
4. **Edgeband visualization rebuilt** — the old whole-part red/cyan outline only said "has banding somewhere," not where. Now shows a shaded (solid view) or outlined (glass view) neon-green strip at the actual banded edge location.

### Editing tools added (Rounds 12, 15)
5. **Draft save/load** — save the uploaded image + AI result + every edit to a file, reload without re-spending API tokens. First version used localStorage and hit the browser's ~5-10MB quota fast (each draft embeds the image); switched to real downloadable `.json` files.
6. **Shelf subtract, per-module height boxes with live mismatch feedback, and a "resize/reposition/change shelf type" panel per part** — e.g. a shortened door can be pinned to the top/bottom/custom position of its original opening; a shelf can be converted from adjustable to fixed with the correct WCLI dimension/hardware convention (splits into two parts + recomputes hardware only when a cabinet ends up genuinely mixed).
7. **Fascia/filler cabinet type + full cabinet-type reclassification** — a real MSSI drawing had a 100mm top fascia the pipeline had no concept of; promoted the already-built-but-unused `buildFiller()` into the supported type list. Also added a Type dropdown to reclassify any detected cabinet (e.g. base misread as sink) without starting over.

### Two real, confirmed layout bugs found via live testing (Rounds 18–19)
8. **Two-tier layouts (wall cabinet directly over a base cabinet) were splitting apart** instead of stacking — the combined-scene layout had no way to say "these two share a horizontal position," so a wall-over-base column (the most common real kitchen layout) got pushed into one long row. Fixed by having the AI report each cabinet's actual left-edge X position (`x_mm`) instead of relying purely on reading order.
9. **The whole scene was left-right MIRRORED versus the source drawing** — confirmed via actual screen-space projection math, not just eyeballing: a cabinet further right in the drawing rendered further LEFT on screen, because the camera angle needed for doors to face the viewer (see Round 6 in the 2026-07-19 POC section above) happens to invert which way is "right" for this 3D engine's axes. Fixed by negating the cross-cabinet horizontal position at the one place it gets assigned.

### Diagnostic tooling → root cause → still open (Rounds 20–22)
10. After the two fixes above, the SAME real drawing was still rendering wrong, and 3 rounds of screenshot-based guessing weren't converging. Built a **position-debug table** (index/type/x_mm/width/floorOffset per cabinet, with automatic overlap detection) plus a raw-AI-response viewer directly in the app, specifically so the next report could come with real data instead of another screenshot.
11. That data immediately revealed two concrete, confirmed AI misreadings: a wall+base cabinet pair was being **collapsed into one fake "tall" cabinet**, and the AI was grabbing the wrong kind of "filler" — a small width-chain reveal number instead of the real fascia board. Both fixed with targeted prompt rules (a wall-over-base column is always two entries, never one tall one; a bare width-chain filler number is never a `filler` TYPE entry).
12. A follow-up re-test showed the position-debug tool ITSELF had a false-positive bug — it flagged a wall cabinet at 1550mm and a base cabinet at floor level as "overlapping" just because their X spans crossed, without checking they're at completely different heights and can never collide. Fixed to a real 2D (X and Y) overlap test.

### Status: genuinely NOT fully resolved
Positioning is now solid (no mirroring, no false overlaps, correct tier stacking — reproduced and verified against the real drawing's actual reported data multiple times). **Two things are still open on live re-tests of the same drawing:** the AI inconsistently detects all cabinets between separate runs of the identical file (a real base cabinet was present in one run, missing in the next — AI non-determinism, not a positioning bug), and the fascia has never actually been found in any live-API run despite the prompt fix. See `project_forge_app.md` in memory for the full round-by-round detail, verification steps, and exact commit hashes (12 commits total, `d62576d` through `0c3a75d`).

## What was changed on 2026-07-20 (session — Designers Support: extraction-failure detection, catalog search redesign)

Deployed `index.html` changes (unlike the FORGE section above, this is the live app).

1. **Fixed a real bug where the AI writes a detailed, accurate summary of a cutting list but never actually populates the structured components table** — a user's real 75-component pharmacy cutting list (5 furniture groups) came back with a perfect prose description and an empty extraction, satisfying the tool schema (which only required `components` to be present, not non-empty) while looking like a plain success. Added: (a) real `stop_reason` capture from the streaming response, so a genuine token-limit cutoff gets flagged instead of silently passing if the truncated JSON still happens to parse; (b) a new detector — a non-trivial, number-containing summary paired with zero components now shows a clear amber warning instead of the misleading green "Analysis complete!"; (c) a stronger prompt instruction that the summary is never a substitute for full row-by-row extraction. **User confirmed on a live re-test: the fix worked, extraction now succeeds on the same file.**
2. **Redesigned materials/hardware catalog matching for a flagged row.** The automated matcher (`_prodFindCatalogMatches`) scores the ENTIRE catalog but only ever showed the top 6 candidates within 60% of the best score — when that cap hid a genuinely correct catalog item, Outsource was the only fallback. First pass bolted on a separate "search manually" link as a second path; **the user pushed back correctly** ("why not search the whole thing than put a cap — wasted effort if it won't give the right recommendation"), since the cap was never actually saving search work, only hiding results. Corrected to one unified always-searchable list per flagged row: empty query shows the AI-suggested candidates first (same one-click convenience for the easy case), typing anything immediately searches the full uncapped catalog by substring.

See `project_drawing_analysis_dxf_direction.md` in memory for full verification detail and commit hashes (`0740a5a`, `0a0efbf`, `9dc9ae8`).

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

## What was changed on 2026-07-24/27 (session — MSSI website build)

> All work in `C:\Users\WCLI Rommel\Desktop\MSSI Webpage` — the **separate MSSI public site**,
> not the deployed `index.html`. **Full detail in that folder's `HANDOFF.md`** (file map, decisions,
> open items). Only the ModCraft-relevant points are summarised here.
>
> ⚠️ The MSSI Webpage folder is **not a git repo** — only two backup HTML files protect it.

**Strategy — two client lanes, one queue.** Fabricators/installers (their own cutting lists,
usually Fabrication-only) vs GCs/developers + homeowners going direct (drawings, full service).
Discriminator is `cl-service`, already on every quotation. Three intake channels — webpage /
internal (Wufoo → eventually native) / offline — should land in `pending_orders` with a `source`
field, giving per-source SLA and conversion reporting. Goal: **no order enters the business
except through a form.**

**Cutting list built and ported** (12 design iterations against real client samples). Fields are
deliberately shaped to drop into the Designers Support pipeline pre-structured, skipping AI
extraction. Confirmed rules that matter to ModCraft:
- Edge codes **L/S not W/H** (follows the piece, so height>width can't confuse it); `4S` = all
  round, matching ModCraft's own EBT code — no dialect translation needed
- **Edgebanding lives in the materials database**, not a separate catalogue
- **HPL is a finish laminated onto a substrate**, never a board — substrate + faces derive the
  service (plywood → manual · MDF/PB → machine · else flagged), thickness comes from the
  **substrate only**. 1F melamine is a valid substrate
- Per-LM services carry **along L / along W**; curved work = Manual Edgebanding with a manual mm run
- Off-catalogue entries flagged gold = the estimator's to-do list, and a signal for what to add
  to the catalogue. Same flag-not-guess philosophy as Designers Support
- **Still stand-in SKUs** — wiring Supabase `price_materials` + services is what makes the
  variability reduction real

**Order form now captures what a quotation needs:** `cl-service`, `cl-delivery`, `cl-segment`,
`cl-lead`. (`cl-type` defaults Direct; `cl-agent` assigned on pickup.)

**Aftercare / warranty surfaced publicly** — reply within the hour, assess within 48 h, close in
4–5 days, 6 months from Certificate of Completion. Positioning: MSSI is priced above backyard
shops, so the site's job is justifying the gap.

**⚠️ Privacy rules now standing (apply to ModCraft too):** no employee names published; **no
residential client names** — a private home is identified by property or area only. Corporate
clients stay named. Recorded in the plan doc.

**Google Drive findings:**
- Project photos are in `SCM Photos / WCLI` (owner `wcli-it-admin`), 12 folders
- **Drive files are private — verified all three embed methods blocked.** Drive cannot serve
  images to a public site, and making them public is unwise (hotlink throttling; 3–6 MB originals)
- **Drive IS synced on this machine at `G:`**, but `SCM Photos` isn't in the synced set (arrives
  via "Shared with me", which Drive for desktop doesn't sync). Fix = add a shortcut to My Drive
- Right architecture for site imagery: **Drive = archive · admin page = curation · Supabase
  Storage = public delivery.** The admin mockup's "Sync now" button already promises this

**Scope terminology corrected:** "interior fit-out" removed everywhere — the Installation card
claimed *"feature walls, ceilings, and full interior fit-out"*, work MSSI doesn't do and a
scope-dispute risk. Now **architectural joinery**.

## Testing approach
- Use the `preview_start` / `preview_eval` MCP tools to load `index.html` locally
- Mock `window.gApiFetch`, `window.sheetsGet/Append/Update`, `window.gToken` for unit tests
- Always verify no console errors after changes
- Always commit + push after verified changes

## What was changed on 2026-07-28/29 (session — MSSI website → ModCraft order pipeline)

Two apps this session: **ModCraft `index.html`** and the **separate MSSI Webpage folder**
(now a git repo — see its own `HANDOFF.md`).

### Quotation: Project name (commit `d1019a2`)
New `cl-project` field in client information, below Project location / Pickup-Delivery, full
width. Persists in `getFullQuotationState().client.project`, restores, clears on new quotation,
and prints as the first row of the client details table.

Also surfaced in the directory, which reads the **Quotations sheet** not the state JSON — so it
had to become a real column: **T · Project Name**, ranges `A:S → A:T` (7 places). The existing
header self-heal widens live sheets automatically. Directory column sits between Client and
Service, on by default, toggleable; search matches project name alongside client/serial/service.
Supabase: `project_name` column + partial index, wired into the dual-write and `supaMigrateAll`.

### Orders: sub-tabs, statuses, delete (commit `ff2532d`)
The queue was one flat dropdown-filtered list, 144 deep, **every card red** — because a finished
order's response clock never stopped, so a job closed in 3h eventually read as 300h overdue.

- Sub-tabs with live counts: **New** (Pending) · **On going** (In Progress) · **Completed** ·
  **Cancelled** · **Archived** · **All**. New is split from On going so fresh arrivals cannot be
  buried; it is the default tab.
- Sort by received date, newest/oldest. Oldest-first is the working order — closest to breaching.
- `Cancelled` (manual, keeps the record) and `Archived` (automatic when the linked quotation is
  closed or cancelled, via `_archiveOrdersForQuotation` hooked into `doCloseProject` and
  `confirmCancelQuotation`). Both stop the clock. Both reopenable.
- Finished order with no sent time shows an em dash, not a misleading `0m`.
- **Delete is Admin-only, enforced twice**: the button only renders for an Admin, and
  `deleteOrder` re-checks the role before touching anything. Removes from Sheets **and** Supabase
  (`supaDeleteOrder`, added — it did not exist). Confirm text steers toward Cancel instead.

### Orders: website fields + form kind (commit `548a6e7`)
8 columns appended **AB..AI** — Order Kind, Address, Project Name, Delivery, Segment, Lead
Source, Target Date, Notes. **Appended, never inserted**: `_setOrderStatus` writes Status /
Quotation Serial / Sent At by column letter (X:Z). Range `A:AA → A:AI` in all three places.

`Request Type` already means New vs Revision (Wufoo), so form kind needed its own column.
`ORDER_KINDS`: Wufoo (default, existing rows unaffected) · Cutting List · Service Request ·
Site Visit. **Site Visit is exempt from the SLA** — no timer, neutral bar, elapsed shows a dash.

Card renders by kind: Wufoo keeps Board/Floor/service flags; a website order hides them (always
blank) and shows project/delivery/address/segment/lead source/notes. A cutting-list order is
summarised by contents — pieces · materials · HPL · hardware · area.

Supabase: same 8 columns + **`order_cutting_lists`** (one row per order; `panels`/`hpl`/
`hardware` jsonb + totals). Anon may insert; staff read only if they can see the parent order.

### Data
Deleted 10 development-era June orders (blank client **and** company, 06-08 to 06-09) from
Supabase. **Not** all of June — 48 of the 58 June orders have real client data. One of the 10
(#8693) claimed quotation `QT-W00000026`, but that quotation's `source_order` is null and it was
created 2026-07-27 for a real client — a stale one-way link, safe to drop.
**The 10 are still in the Sheets tab** — see Open items.

### Gap 1 — ~~two stores, neither complete~~ CORRECTED 2026-07-29
**This section was wrong.** The Wufoo webhook already dual-writes to Supabase — the local
`_gas_wufoo_webhook_updated.gs` has a `_supaInsertOrder()` posting to the
`insert_pending_order` RPC, and it is deployed. Verified rather than assumed: **75** of 135
`pending_orders` rows carry a `raw` jsonb holding the Wufoo POST (`Field2`, `EntryId`),
which only the Apps Script produces — `supaMigrateOrders()` reads the Sheet and never writes
that column. Newest bridged order 2026-07-28.

So the stores are:
- **Wufoo → Sheet AND Supabase** (webhook dual-writes).
- **Website → Supabase only.**

**Supabase is therefore the complete queue; the Sheet holds Wufoo's half.** The problem was never
the bridge — it is the *fallback*. `gLoadPendingOrders` is Supabase-first, so a session that has
not connected drops to the Sheet and silently sees a short queue that looks complete. Fixed
2026-07-29: the Orders page now says so, on the empty branch too. The lasting fix is that everyone
stays connected (auto-connect, 2026-07-05) — not a second copy of the data.

Related: the live Pending Orders sheet header is still 27 columns. `ensurePendingOrdersTab` only
writes the header when the tab is missing — unlike Quotations, there is no header self-heal.
Reading `A:AI` on a 27-column sheet is harmless (undefined becomes ''), but the header is stale.

### Other open items from this session
- **No spam protection.** `pending_orders` allows anon insert with `check(true)`. Anyone with the
  publishable key can file unlimited orders. Fine for launch-day, not for long.
- **The webpage cutting list still uses stand-in SKUs** — not wired to the live ModCraft
  catalogue. Materials will arrive as sample SKUs that will not resolve.
- **135 open orders**, none with a quotation serial, all clocks running. Real enquiries handled
  outside the app. Archiving them would make the queue meaningful again — user has not decided.
- **Site visit flow undecided** — it lands and is off-SLA, but what it does next (become a site
  visit charge on a quotation? schedule?) is open. `qSiteVisit` has no date or coordinates.

### Gap 2 / Gap 3 — BUILT 2026-07-29 (commit `4154cc8`) — spec kept below for reference
`exportOrderToQuotation` copies **client fields only**. For a cutting-list order it must also
hand the line items to Designers Support as **components** (not quotation line items, or the
geometry is lost). That runs into Gap 3: Designers Support has **no non-AI entry point** —
`prodSendPdf`/`prodSendText` both call Claude. A pre-structured list must populate the components
array directly with `needsReview:false`.

Everything downstream is reusable unchanged:
`components → prodComputeBom → nesting → prodBuildSummary → Reflect to quotation`.

**Two conversions are required in that step, both verified as real problems:**
1. **EBT format.** Same vocabulary, different notation for combinations —
   webpage `1L 1S` / `2L 1S` / `1L 2S` vs ModCraft `1s/1l` / `1s/2l` / `2s/1l`. Singles match
   case-insensitively. ModCraft's fallback parser looks for T/B/L/R, so `1L 1S` scores as *one
   long edge and nothing else* — a **silent under-count of edge banding**, not an error.
2. **Grain.** `L`/`W` to `length`/`width`, per-row flips resolved against the job default.

### Findings worth keeping (from reading both codebases)
- **Grain is captured everywhere and used nowhere.** `prodState.woodgrainDir` appears 3 times —
  default, dropdown, and **inside the AI prompt**. `c.grain` appears twice — a table cell and an
  Excel column. The packer's rotation comes from a *global* `machineType` (panelsaw = never
  rotate, cnc = always). So a piece marked grain-along-width packs identically to one along
  length. Wiring per-piece grain into `allowRotate` is the single biggest yield gain available.
- **Edge banding has no material line on the Designers Support path.** `prodBuildSummary` pushes
  materials for the substrate board and the HPL sheet only; edge banding emerges solely as a
  *service* from `edgebandingLM`. The tape itself is never costed there. (Edge tape *does* exist
  as a material in the catalogue and in cabinet templates — the gap is this path.)
- **HPL is inferred, not declared.** `/\bhpl\b/i` on material+notes, then substrate parsed from a
  phrase, faces guessed, `needsReview` when unclear. The webpage states all three explicitly.
- **The webpage flattens the HPL composite into a display string** —
  `HPL_BUILDS["HPL-WHT-MT on MDF-18R · 2F"] = {th:18}` — so ModCraft would have to parse it back
  out. Send the parts, not the label.
- **HPL area conventions differ.** Webpage `area = L×W×qty×2` for 2F (both faces counted);
  ModCraft uses **single-side area** priced with a 2-Face SKU at 2× rate. Feeding one into the
  other bills **four faces**. Silent — the number just doubles.
- **A real SKU retires the whole matching subsystem.** `catalogMatchRow`,
  `_prodFindCatalogMatches`, the field-aware scorer and the jargon-learning loop exist *only*
  because the AI produces free text. A client-typed SKU is an exact key — on that path all of it
  can be skipped and the row marked resolved on arrival.
- **Boring is priced per hole** in ModCraft (₱3–₱20 by type); the webpage records it per piece
  with no hole count. That number cannot be computed from what the form collects today — a gap in
  the **form**, not in ModCraft.
- **Grooving specificity** — the webpage says "Grooving"; ModCraft prices three
  (₱15 melamine / ₱20 compact laminate / ₱65 router).

### Convention reinforced
`index.html` is **CRLF**. Any patch script matching or inserting multi-line strings must use
`\r\n`, or matches silently find nothing. Helper used this session:
`const crlf = s => s.split('\n').join('\r\n')` applied to both the pattern and the replacement.

## What was changed on 2026-07-29 (session — website cutting list → Designers Support)

### Decision taken: Wufoo is NOT being retired yet
Rommel: *"it really depends on the acceptance of the website as new order form of clients."*
So the bridge stays — which is the option that holds either way, because retiring Wufoo later
costs nothing more than switching the webhook off.

### The Wufoo bridge was already built — see the corrected Gap 1 section above
75 of 135 `pending_orders` rows were written by the Apps Script, not by a backfill. Both
handoff docs claimed nothing bridged the stores; neither was checked against the database.
**Method worth reusing:** `raw` is written only by the webhook, never by `supaMigrateOrders()`,
so it discriminates *how* a row arrived. When a doc claims a pipeline is missing, find a column
only that pipeline writes and count it.

### Gap 3 — `prodLoadStructuredList()`: a non-AI entry point (commit `4154cc8`)
`prodSendPdf`/`prodSendText` both call Claude, because a drawing has to be READ before it can
be structured. A list the client typed is already exact, so it must not pay for an extraction
pass that can only introduce error. The new entry point sets `prodState.result` directly and
computes `_bom`/`_services` itself. Everything downstream is untouched —
`prodComputeBom` → nesting → `prodBuildSummary` → Reflect to quotation neither know nor care
where the components came from. `_prodNormalizeComponent()` defaults every field the strict
tool schema and the review UI expect. The green banner reads **"Cutting list loaded."** rather
than "Analysis complete!" (`result._structured`), because nothing was analysed.

### Gap 2 — `_cutListToAnalysis()`: the translation (same commit)
`exportOrderToQuotation` now stages a cutting-list order into Designers Support as
**components**; the order card also gets its own **Cutting list** button
(`openOrderCuttingList`). Components, not quotation lines — length, width, grain and edge codes
are what the nesting and edge-banding maths run on, and a quotation line has nowhere to keep them.

**Edge codes — the fix is not a lookup table.** The site codes LONG/SHORT so a code follows the
piece; `EBT_CODE_MAP` is keyed on the length/width *fields*. Those agree only while
length ≥ width, so `_webEbtToModcraft(code,L,W)` converts through the piece's real dimensions
and emits whichever ModCraft code yields the same banded metres. Verified: all 9 site codes give
identical LM whichever way round a piece is entered. The old path scored `1L 1S` at 0.80 m where
1.20 m was banded — silent, because the T/B/L/R fallback matched the `L` and ignored the rest.

**HPL — send the parts, not the label.** A panel whose material is a composite build resolves
back through the order's own `hpl[]` rows to substrate + finish + face count. The `hpl[]` rows
are deliberately **not** emitted as components: this app derives the sheet and the
substrate-correct lamination service from the *panel* area, so emitting both would count the
boards twice — and the site's 2F area is already doubled, which together bills **four faces**.
Confirmed by test: the HPL door carries 0.560 m² single-side, not 1.120.

**Flags, never guesses** — matching the AI path's philosophy:
| Input | Why it cannot be derived | What happens |
|---|---|---|
| Boring | priced per hole; `prodComputeServices` drops a service at qty 0 | flagged per component — it would otherwise vanish without trace |
| Grooving | one word on the form, three catalogue prices | lands in `grooving`, flagged to pick which |
| Client-typed material | not a catalogue pick | flagged, not fuzzy-matched |
| 1F/2F | the form never asks | stated **once** in the summary, not on every row |

Material family is only taken from words actually present in the label — never inferred from an
SKU prefix. An unrecognised label falls through to the catalog matcher as free text, exactly as an
AI-extracted name would.

### Also
- `order_cutting_lists` totals now load with the queue (`supaGetOrderCutListTotals`), so the
  card's long-dead *"attached but not loaded yet"* branch finally resolves.
- Orders page states plainly when it is running off the Sheets fallback (commit `2376b01`).

### ⚠ SECURITY — the Wufoo API key is published
`rotaligatos/modcraft-app` is a **public** repo and `CLAUDE.md` is tracked, so the Wufoo API
key sat on `raw.githubusercontent.com` in plain text. It reads form entries — every order
submission, with client names, emails and phone numbers. Redacted from this file 2026-07-29, but
**git history still holds it, so redaction is not the fix: rotate the key in Wufoo
(Account → API Information), then update `WUFOO_API_KEY` in the Apps Script project.** The
Supabase publishable key alongside it is fine — that one is designed to be public.
Rule going forward: **no live secret in a tracked file.** Keys live in the Apps Script project.


## What was changed on 2026-07-29 (session 2 — cost-factor override, margin recognition, SKU search, notifications)

Twelve commits, `d59b591`..`d098e28`. Started from three user reports — override percentages not
reflecting, margin looking too low, and no visible project cost in the override — and the thread
kept turning up adjacent defects.

### The cost-factor override never reached the quotation it was for
The override got its own approve path on 2026-06-16 (`openCustomCFFromRequest` → `confirmCustomCF`
→ `_markOverrideApproved`) and was **never wired to `_persistApprovedFieldToQuotation`**, which every
other approval type has used since 2026-07-19. So `confirmCustomCF` wrote the rates into whatever
quotation was loaded in the approver's browser — and an approver acts from the Approvals page,
where that is usually a different quotation or none.

Reproduced before fixing: request for QT-W00000027 with QT-W00000031 open. The rates landed on
QT-W00000031, QT-W00000027 kept the global rates, the request was marked approved, and the
requester was messaged "has been reviewed and applied". **Two failures** — the target silently
missed the change, and a bystander silently received it, which a later Save would have made
permanent. (`d59b591`)

Three more defects in the same modal, found while fixing it:
- `openCustomCFFromRequest` **never set `modalCtx`** — a leftover `'fq'` sent a Stage 1 override into
  Stage 2. Same defect as the unlock bug fixed 2026-06-20.
- Its fields seeded from `qCustomCF`, i.e. another quotation's rates shown as the starting point.
- The Sale/Cost/Profit strip reads `_pCalc` — the *open* quotation. Now shows "—" and names the
  quotation to open instead of four confident figures belonging to a different job.

### The requester's screen never updated (the "have to refresh the whole app" report)
`_mergeApprovalReqsIntoNotifs()` copied `status` and `by` from the polled record **but not
`cfValues`**. A requester's own notif is created when they SEND the request, and an override
request carries no numbers at that point — the approver supplies them. `_applyApprovedRequest()`
gates the override branch on `notif.cfValues`, so with it still null the branch was skipped: badge
flipped to Approved, toast fired, quotation kept the old rates. `cfValues`/`reqDisc`/`ctx` now come
across whenever present, since they carry the approver's decision and are always newer than
anything held locally. Verified 189,118.54 → 118,366.24 with no refresh. (`5561a0a`)

### Override figures now match the Cost Report
They had **separate definitions of direct cost**. The modal omitted the cutting-list charge (inside
`regularBase`), bond & insurance, and the fabrication-service-margin reclassification added
2026-07-02 — so the same quotation showed a different profit depending on the screen, and the
modal always read pessimistic. Both now call one **`_directCostFromPCalc()`**.

Also: **Total (incl. VAT)** added to the strip. The old figures were a second simplified copy of
`recalc()`'s tail that stopped at subtotal-before-commissions, so "Sale (ex-VAT)" did not equal the
quotation's own ex-VAT subtotal. Rather than extend the copy, the panel now applies the entered
rates, runs **the quotation's own `recalc()`**, reads the result and restores — the numbers are the
quotation's by construction. Typing path debounced 180 ms since a recalc rebuilds line items.
(`d207773`, `5561a0a`)

### The approval request appeared to need sending twice
"Send request" opened a **second** approval screen with its own "Send request" button. Users
reported exactly that. The second screen only added the routing line and an optional note, and the
reason box already collects the reason — so it now sends on one click and shows who it routes to
before you send. (`d207773`)

### Margin recognition — what is cost and what is margin
Fabrication is services + materials + hardware, but **only services** ever had their built-in
margin taken back out (`_fabServiceMarginTotal`, 2026-07-02). `dbMaterials` is `{name,unit,price}` —
no cost field anywhere — so the full catalogue price counted as direct cost.

- **Materials + hardware** (`fe1701f`): `CF.materialMarginPct`, default **30% OF THE SELLING PRICE**
  (a ₱100 material cost ₱70), confirmed with Rommel. No landed-cost/COGS data exists, so it is a
  **stated assumption, not a measurement** — global in Cost Factors, overridable per quotation,
  reported as its own line. Reporting only; never changes the client's total.
- **Client rule** (`d57b994`): `_materialMarginCounts()` replaced the blanket `isDirectClient()` gate.
  Direct → counts. Subsidiary **WCLI** → does NOT (materials are transferred, not sold).
  Subsidiary **CWLI** → counts (genuine inter-company sale). Applies in **every mode**. Company
  matched by **keyword, not exact string** — this data has real spelling drift and exact compares
  have locked people out before; "Cebu World Laminate" does not contain "world class".
- **Carcass** (`5702108`): `CARCASS_PRICES` is one selling price with no cost side, so the whole
  margin counted as cost. Cost is now built from the cabinet template — services at their true
  `opCost`, materials/hardware at (100 − pct)% of price — and margin = price − that. A type with
  **no template contributes nothing** and the Cost Report names it, because an incomplete template
  would compute too low a cost and **overstate** profit invisibly. All 13 types have full templates,
  so it only fires on a newly added type. No Direct gate here: in carcass mode materials are inside
  the cabinet price everyone pays, not a separate line a Subsidiary is spared.
- **opCost guard** (`5702108`): `opCost = totalExpense / capacity`, so a service with capacity set but
  **no cost breakdown entered** computes 0 — and both callers were crediting its ENTIRE price as
  margin. That is "not costed yet", not "free". Both now require `opCost > 0`. **This bug was in the
  July services fix too**, not just the new carcass code. These figures decide how far a price can
  be cut, so they must never err high.

Verified: ₱60,000 of materials+hardware → Direct reclassifies ₱18,000 (profit 182,853.18 →
200,853.18, margin 54.5% → 59.8%), Subsidiary WCLI ₱0, client total unchanged throughout.

### ⚠ SKU search — "some users cannot find a SKU, I can" (`edbc607`)
Reported with DuraSave. **The data was never missing.** Every material row rendered a `<datalist>`
containing the **entire catalogue**, and `price_materials` is **153,552 rows / 124,132 distinct
names**. Measured at that size: **6.19 MB of HTML and 445 ms to build, per row, per render.**
Browsers cap how many datalist suggestions they render and degrade long before that, so which SKUs
appeared came down to the machine and browser. Nothing errored — the item simply was not among the
ones the browser chose to show.

Filtering now happens in JS with at most **60 options** handed over, refreshed as the user types
(the browser was already doing case-insensitive substring matching, so behaviour is unchanged —
only bounded and deterministic). Applied to all four pickers with the same pattern: cutting-list
materials, cutting-list hardware, BOM rows, outsource rows. Also **memoised
`getMatSource()`/`getHwSource()`**, which rebuilt a merged 153k array plus a seen-map on every
keystroke. Verified with DuraSave planted at index 140,000: found by typing, picking fills
name/unit/₱3,000, keystroke 28 ms vs 445 ms.

### Quotation additions
- **Project size** (`6619bad`) — card under Carcass / Unit Count, visible in every mode. Blank =
  detected from the fabrication scope via `getTotU()` (the same count Installation/Assembly bill
  against, so it follows the mode); a number overrides; clearing returns to detection. Prints
  between the client details table and the line-item table. Presentational only.
- **Additional notes** (`664f525`) — box at the bottom of the services list, appearing once a
  service is chosen. Free text per area, prints as an ADDITIONAL NOTES block. `oninput` writes
  straight to the model with **no re-render**, deliberately.

### Messaging & notifications
- **Disappearing message** (`4ca2a85`) — `renderMsgPanel()` rebuilds the composer's innerHTML and the
  poll calls it **every 45 s** while the panel is open, throwing away anything half-typed. The
  composer is now left alone while in use (text present, or focus in it); it still rebuilds when
  idle so a late-loading user list appears.
- **Approvals reach people off-app** (`aa20fa4`) — `submitApprovalRequest` **never messaged the
  approver at all**, and `doApprovalAction` never messaged the requester with the outcome. Both only
  announced themselves through the in-app poll. Both now go through `gSendMessage`, which fans out
  to every configured channel.
- **Google Chat** (`aa20fa4`) — `CHAT_WEBHOOK_URL` setting + `_sendMessageChat()`. **Relayed through
  the existing Apps Script mailer, deliberately: a browser cannot POST to a Chat webhook, because
  the API wants `application/json` and that triggers a CORS preflight `chat.googleapis.com` does not
  answer.** Requires `_gas_mailer_with_chat.gs` (in the repo) pasted over `doPost` in the mailer
  project → Deploy → **New version of the existing deployment** (a New *deployment* mints a
  different `/exec` URL and silently leaves the old code serving). Both relays are fire-and-forget:
  `no-cors` means failures are **silent by construction**; the in-app message is always written
  first and stays the record.

### Lami's icon disappearing (`d098e28`)
The chip is draggable and its position is saved, but `_lamiApplyPos()` wrote the saved left/top back
**with no bounds check**, and nothing re-checked it. A narrower window, the Google Sites iframe, or
leaving fullscreen could place it past the edge — where it stayed permanently, since dragging it
back requires reaching it. Now clamped to the current viewport, the corrected value written back,
plus a resize listener. Verified at 1280×720: `{3400,1800}` → `{1220,660}`; a sane `{120,90}`
untouched; narrowing to 600px pulls x=1200 → 540.

### Open decisions from this session (none started)
1. **CWLI is not billed materials in cutting-list mode**, so its material margin computes to ₱0 —
   a genuine conflict with the client rule, not an oversight. Recognising it means **charging** for
   them: `isDirectClient()` in `getAreaSubtotal()` becoming "not WCLI". That is a pricing change and
   was deliberately not done unilaterally.
2. **BOM mode bills materials and hardware to Subsidiary clients**; cutting-list mode does not.
   Pre-dates this work.
3. **153,552 material rows / 124,132 distinct names** — worth reviewing for duplicates now that
   search is bounded.
4. **Hardware moves off the assumed 30%** when the procurement cost data lands.
5. **Google Chat posts to a space**, so everyone in it sees approval requests including client
   name, serial and the stated reason — relevant to the no-client-names rule. Per-person DMs need a
   Chat app in a Google Cloud project, a much larger job.


## What was changed on 2026-07-29 (session 2, continued — project size reworked, per-service notes)

Two further commits after the docs above: `b9aa411`, `926087d`.

### Project size counts COMPONENTS, not cabinets
The first pass used `getTotU()` — the unit count Installation and Assembly bill against. Wrong
measure. Components now come from the cabinet **type**, which is the reference the POC's parametric
engine establishes, via a components-per-unit figure entered once per type in
**Settings → Carcass pricing** (`CARCASS_COMPONENTS`). Carcass and BOM both use it (a BOM item
carries a type too). Cutting-list mode takes the count from the **Designers Support analysis**;
that pipeline is not reliable yet, so with no analysis attached it falls to manual entry.

**Detection declines rather than under-reporting.** If any type in the quotation has no
components-per-unit set, the total would be quietly short — so it reports nothing and names the
types that need a figure. A typed number always wins and is the fallback for everything detection
cannot reach.

**Locking now requires a project size.** Lock is disabled with the reason in its tooltip, and
`doLockOnly()` refuses outright and scrolls to the card — the button is not the only way in.
`_updateLockGate()` runs at the end of `updateLockUI()`, which re-enables the button, so the gate
has the last word. **Stage 2 lock is NOT gated** — only Stage 1.

Follow-up fix in `926087d`: the refresh was hooked into `renderItems()`, but changing a carcass type
or quantity calls `recalcSoon()` only and never re-renders the list — so the count went stale on
exactly the edits that change it. Moved into `recalc()`. The detected figure now also shows in the
field as its placeholder; previously the box stayed empty and the number was buried in the note,
which made it look dead.

### Additional notes moved to one per service
First pass put a single box per area under the subtotal. Corrected: **one box per performed
service, directly beneath that service**, so adding another service adds another box. Stored on the
service item (`svcItems[i].note`); the printout labels each note with its service name. A note saved
under the old per-area shape (`area.svcNote`) still prints.

### Decision taken: Google Chat space is restricted, not private
A webhook can only post to a **space**, never a DM, and the posted text carries client name,
quotation serial, discount percentage and the requester's stated reason — which routes around the
app's own role gating (`canViewCostReport()` restricts margin data to Admin/Director/Manager).
**Rommel's decision 2026-07-29: limit the space to Managers and up.** No code needed; membership
only.

Two consequences, accepted: Staff/Encoders get no Chat nudge (email + in-app still reach them, and
approvals flow upward anyway), and managers see every message including person-to-person ones
addressed to others.

**Parked, not urgent:** send only *approval* notifications to Chat and leave person-to-person
messages on email + in-app (~10 min). And proper **direct messages** — genuinely solves the privacy
problem since only the recipient sees it, but a webhook cannot do it: needs a Google Cloud project,
a configured Chat app, a service account, and **admin publishing the app to the domain**. The API
path is settled (`spaces.setup` with `spaceType: DIRECT_MESSAGE` + `chat.bot` scope, then
`spaces.messages.create`) — realistically half a day, mostly console config rather than code.

## What was changed on 2026-07-30 (session — SKU search root cause, client-supplied materials)

Four commits, `b202e59`..`759f9b5`. Two user reports, both traced to something other than what
they looked like.

### ⚠ "jhover cannot find a SKU" — the data was never missing
Reported as *High Gloss Real White* and *DuraSave* absent from the material pickers in both the
quotation and Designers Support. Neither was missing. Two separate causes, found by measuring
rather than by searching for the names:

1. **Word order.** The picker matched on a substring, so *"real white high gloss"* found nothing
   while *"high gloss real white"* found it. Now tokenised and scored: every typed word must
   appear somewhere in the name, in any order (`b202e59`). Whoever typed the words the way the
   SKU happens to read them found it; whoever did not, did not — which is exactly why one person
   could see an item another could not.
2. **A blank-unit twin shadowing the good row.** `lookupInSource` returned the *first* name match.
   Now it returns the best one — a populated unit first, then a non-zero price (`2b594b8`).

**Why the twins exist — the real finding.** The Price DB Materials sheet has **153,552 rows /
124,132 distinct names**, and roughly **39,420 of them have a blank unit**: about **29,420 shadow a
good row of the same name**, and about **10,000 have no populated alternative at all**. The unit
column simply stops being filled from around alphabetical position ~93,000 onward (the boundary
sits near *"Toast MDF 4x8 2F Floor Sample…"*) — so this is one truncated import, not scattered
data entry.

**Therefore: never "clean up" by deleting blank-unit rows.** ~10,000 SKUs exist only as a
blank-unit row and would be destroyed. The app was made immune instead, which is why this is a
fix and not a data migration. The agreed tidy-up, if it ever happens, is **fill the missing units,
delete nothing**, against a copy of the tab, dry-run first. Parked at Rommel's request.

### Client-supplied materials — the rules, stated by Rommel
> *"Current system, it is just an information for the client. this is to avoid miscommunication
> thinking that the material they commit is included in the cost rather than what they commit to
> bring. The client material cost must show only if they click it on because not everyone want to
> supply their own material."* … *"Material supplied by the client should have no price field."*

So: the printed table is **information only**, it appears **only when the toggle is on**, and those
rows carry **no price**. `qClientSupplyMatList` has no price field and is never summed — which was
already true.

Two corrections of my own in the same thread, both worth remembering:
- I claimed the client-facing line *"excluded from the quoted material cost"* contradicted the
  code. It did not — I had conflated it with the 2026-07-16 change to the **Materials section**
  (where the company's own materials do count). Reverted in `759f9b5`.
- `3c5cff0` had ungated the table so it printed whether or not the toggle was on. Also reverted.
  **Read the toggle as the user's stated intent, not as a state to defend against.**

### "Prices missing under a Triplestar SKU" (stephanie) — false alarm, twice
Both reports resolved to deliberate behaviour, not bugs:
- **Subsidiary** clients have materials excluded from cutting-list cost (`isDirectClient()` in
  `getAreaSubtotal` — see OPEN item 1+2, still undecided).
- `hideMatPricing` blanks unit price and amount on the *Services, Materials & Hardware* printout
  for **World Class Laminate, Inc.** quotations specifically (2026-07-16).

**Pattern worth keeping:** two of three "missing data" reports this session were not missing data.
Measure the mechanism before hunting for the record.

---

## What was changed on 2026-07-30 (session 2 — HPL SKU rename, and what it turned up)

### The names were actively misleading
Rommel: *"for the HPL Lamination we do things by manual only regardless of substrate. Traditional
but it lasts a lifetime… we laminate the whole 4 x 8 or by component really depends."*

I read that as meaning the word **Manual** in the SKU denoted the *method*, concluded the PB/MDF
rows were a machine service nobody performs, and rewrote `prodBuildSummary`'s routing to send every
substrate to the manual SKU. Wrong. Rommel: *"This two are different, the Manual HPL Lamination is
for plywood."* Both are hand-laid; the price differs because **plywood is more work**. The original
substrate split was correct, and my change would have over-quoted every MDF/PB panel by 2.55x.
Reverted, and the commit pair was dropped before pushing — the live app never contained it.

**The lesson is the naming, not the mistake.** "Manual HPL Lamination" gives no hint it means
plywood. So the four SKUs were renamed to lead with the substrate:

| Was | Now | ₱ |
|---|---|---|
| `HPL Lamination 1 Face (MDF/PB)` | `HPL Lamination (MDF/PB, 1 Face)` | 351 |
| `HPL Lamination 2 Face (MDF/PB)` | `HPL Lamination (MDF/PB, 2 Face)` | 702 |
| `Manual HPL Lamination (1 FACE)` | `HPL Lamination (Plywood, 1 Face)` | 896 |
| `Manual HPL Lamination (2 FACE)` | `HPL Lamination (Plywood, 2 Face)` | 1791 |

### Everywhere a service name is a key — checked before touching anything
- **`quotation_states`: 0 of 157** reference any HPL service, so no saved quotation needed migrating.
  Worth knowing the two mechanisms differ: services mode stores `svcItems[].svcIdx`, a **positional
  index**; BOM mode stores a **name** and resolves by exact lowercase match. A rename breaks the
  second; a reorder breaks the first.
- **`price_services`** — updated **in place**. Never delete+insert: `supaGetPriceDb()` reads it back
  `.order('id')` precisely because `svcIdx` is positional, so moving a row would silently repoint
  every saved line item after it.
- **`cabinet_templates`** — 1 row (Wall Cladding).
- **CONFIG `serviceCapacity` and `serviceCostData`** — keyed by name; all 4 keys renamed with their
  values carried, or the capacity and cost breakdown would have been orphaned.
- **`index.html`** — `INIT_SERVICES`, the Wall Cladding `INIT_TEMPLATES` row, and the routing.
- **MSSI website** — `hplSvcName()` in `portal.html` *and* `cutlist-template.html` still emitted the
  old strings; every website cutting list would have arrived with a name the catalogue no longer
  contains, landing in the fuzzy matcher that form exists to avoid.

### ⚠ The Google Sheet Price DB still holds the OLD names
Supabase is a mirror. **Running `supaMigratePriceDb()` before the Sheet is updated re-imports the old
names and undoes all of this.** The fix is one pass through the app: open Settings → **Save settings**,
which runs `_saveServicesToPriceDb()` and rewrites the Services sheet from the now-renamed `SERVICES`.
Do that **before** any future price-DB migration.

### Cabinet templates are quietly disconnected from the catalogue (pre-existing)
Rommel asked to check the carcass templates. **30 template lines reference names that do not exist in
any catalogue** — unrelated to the rename (no HPL name appears among them, which is itself the proof
the rename landed cleanly).

Three look like stale spellings of live services, and account for most of it:

| Template says | Catalogue has | Lines |
|---|---|---|
| `Boring 35mm dia. (Hinges)` | `Boring 35mm (Hinges)` | 8 cabinet types |
| `Boring (Hinges)` | `Boring 35mm (Hinges)` | 1 |
| `Boring (Glider)` | `Boring 8mm (Glider)` | 1 |

Four have no catalogue equivalent at all — a business question, not a typo: **Assembly labor**,
**Drawer box Assembly**, **Installation Handle**, **Tapering**. Plus 4 materials and 7 hardware lines
on Toilet Partition and Wall Cladding.

**5 of the 7 orphan service names still hold `serviceCapacity` entries** with no catalogue row behind
them — invisible dead data, since the Services tab is built from the Price DB. (The same is true of
two older HPL orphans, `HPL Lamination (1 Face)` / `(2 Face)`, left from an earlier rename.)

**Impact:** an orphan line still prices, at whatever the template hardcoded — so it never follows a
catalogue price change, and its margin cannot be recognised (`opCost` is unresolvable, and the
`opCost > 0` guard conservatively counts it as pure cost). Nothing is broken; it is drift.
**The three stale spellings ARE now fixed** (Rommel, 2026-07-30: "go with 1, then 2 I'll take care of
later"). 11 template rows renamed in Supabase, names only — qty, price and unit untouched:

| Was | Now | Rows |
|---|---|---|
| `Boring 35mm dia. (Hinges)` | `Boring 35mm (Hinges)` | 9 |
| `Boring (Hinges)` | `Boring 35mm (Hinges)` | 1 |
| `Boring (Glider)` | `Boring 8mm (Glider)` | 1 |

Service orphans went **19 lines to 8**. Ten of the eleven matched the catalogue price exactly.
**One did not and was left alone:** Overhead Cabinet reads `qty 0.8 x P40` where every other
cabinet reads `qty 4 x P10` and the catalogue is P10/hole — it looks like the line total was
typed into the price field. Correcting it changes what an Overhead Cabinet quotes, so it belongs
with the missing-SKU pile.

**Still open (Rommel is handling):** 19 orphan lines remain — 8 services (`Assembly labor`,
`Drawer box Assembly`, `Installation Handle`, `Tapering`), 4 materials and 7 hardware,
mostly on Toilet Partition and Wall Cladding. Those need **adding to the catalogue** — pricing, not
spelling.

### ⚠ A third spelling lives in the app defaults
`INIT_SERVICES` uses `Boring (Hinges 35mm)` — matching neither the live catalogue
(`Boring 35mm (Hinges)`) nor the old template spelling. The defaults are internally consistent,
so **Initialize DB** would overwrite the Services tab with its own names and re-orphan everything
just reconnected, plus more. Left alone: aligning the defaults to the live catalogue is a much
bigger job than a typo fix. **Just know that button is loaded.**

### Also noticed, not changed
`INIT_SERVICES` prices these per **sqm**; the live catalogue rows say **piece** at the same numbers,
and the drawing pipeline passes `qty: bm.totalArea` in **sqm**. Either the unit label is wrong or the
basis changed without the price following. Worth settling — it decides whether a 0.5 sqm panel bills
₱175 or ₱351.

---

---

## What was changed on 2026-08-02 (session — duplicate clients, website→directory sync, Stage 2 lock gate)

Four commits: `3f72bd5`, `455cedc`, `876c9f2`, plus a docs correction. Everything below was found
by querying live data or driving the real function — nothing by reading code alone.

### 1. ModCraft was creating a second record for clients it already had (`3f72bd5`)
**Evidence, not theory:** clients `22` and `23` are both `LIMSHEN`, created 55 minutes apart. The
second quotation had a business name typed, and the matcher's contact-name branch was gated on
`&&!bizName`, so typing a business name **disabled** it — while the business branch could not
match row 22's empty one. A match was impossible; a duplicate was certain.

Three call sites each had their own copy of the matching logic and the reopen-link at
`getFullQuotationState` did not even lowercase. One `_findExistingClient(email,biz,contact,list)`
now serves all three: **email → business name → contact name**, the last only where the business
names do not CONTRADICT, so two people of the same name at different firms stay separate. Names
normalise for case, repeated spaces and a trailing period (`Studio Tille Inc` finds
`STUDIO TILLE INC.`). On a match it backfills only **missing** fields — client 22 has no email
today purely because the duplicate carried it. The client search box now searches email too.

### 2. Registered website client → ModCraft directory row (`455cedc`, `supabase_client_directory_sync.sql`)
A Postgres trigger on `client_accounts`. **Not for duplicates** — (1) fixed those. The prize is the
**email**: 11 of 20 client records carry none, so matching falls back to names, and someone
registering as "Studio Tille Interiors" against a record reading "STUDIO TILLE INC." cannot be tied
together by anything. The trigger **matches before it inserts**, same three keys and order as the
JS — a naive insert-per-account would be a duplicate factory, since most registrants are existing
customers. New rows get company `Module Systems and Services, Inc.` (what the website stamps on its
own orders) and a numeric id.

> ⚠ **The id must stay numeric.** `index.html` picks the next one with `Math.max(mx, c.id||0)`, so a
> single non-numeric id makes that `NaN` and every client created afterwards gets `id: NaN`. Proven
> in node before the insert was written.
>
> ⚠ **The SQL and JS matchers must change together** or this becomes what it was built to prevent.

Testing note: a test address collided with a REAL client (35 already held
`interiors@studiotille.com`), so the trigger correctly matched and backfilled two blank fields on a
live record. Reverted. **Use `*.example` addresses when testing against production.**

### 3. Final Quotation lock now needs a project size (`876c9f2`)
Stage 1 has required one since 2026-07-29; Stage 2 had **no gate at all**, so a quotation could
reach a locked Final Quotation with no size — the hole the Stage 1 gate was opened to close. Both
stages now share `_projectSizeGateOk` / `_projectSizeGateFail` / `_applyGateToBtn`. One deliberate
difference: the Project Size card lives inside `#s1-wrap`, so on Stage 2 it is hidden and scrolling
to it would do nothing — Stage 2 sends the user to Stage 1 first. `_updateFQLockGate` runs LAST in
`updateFQLockUI`, because the branch above re-enables the button.

**Impact: 10 quotations, not 27** (see the correction below). All cutting-list mode with no
Designers Support analysis, so nothing can derive a count; each needs a number typed once, only at
the moment someone locks the Final Quotation. Nine of the ten are test data.

### 4. ⚠ A doc claim I repeated without checking, and it was the only thing wrong
OPEN item 7 said `CARCASS_COMPONENTS` was empty. Rommel had filled all 13 types in that morning.
Every other figure in that message was verified against the database; that one line came from this
file, and it was the one that was wrong. **Any claim here that a setting is empty is one query
against where the setting lives** — `settings.CONFIG -> 'carcassComponents'`.

### 5. Found while checking one quotation — `fqLocked` missing on 9 legacy states (NOT fixed, parked)
13 quotations have `quotations.final_locked_at` set. Only 4 carry `fqLocked: true` in their state
JSON. The **9 that disagree were all final-locked on or before 2026-07-06**; every one locked after
`QT-M00000016` (same day) is correct — a clean cutoff, so **the bug is already fixed and nothing is
still breaking**. They also lack `fqSentStatus` / `fqClientApproved`.

Consequence: reopening one shows **Stage 2 as unlocked**, so a quotation the client already has
could be edited and re-locked. Repair offered (set `fqLocked` + `fqSentStatus` from each row's own
`final_locked_at`, only where the activity log confirms a final lock; never invent
`fqClientApproved` — a client sign-off is a real business fact). **PARKED at Rommel's request**
until he has spoken to the users, because `QT-260619-3668` is in both this set and item 6.

### 6. `QT-260619-3668` (MABA CONSTRAK) — stored as ₱0.00, should be ~₱32,981.26
Real work: created from **Wufoo Order #8724**, locked, approved and *"Final quotation locked. Sent
via email."* by **Joanna Marie Buenconsejo** on 19 June. Its saved `pCalc` has **every field zero**
while the state holds ₱26,245 of materials and hardware. Recomputed with the app's own
`getAreaSubtotal`/`getAreaMatSubtotal`/`getAreaHwSubtotal` and the quotation's own rates
(fab contingency 10%, VAT 12%, no fab buffer since Fabrication-only): **₱32,981.26**.

**It is the only such record** — across all 175 states, no other quotation has a zero total with
real line value. So there is no code fix indicated on this evidence. The all-zero `pCalc` looks
like a snapshot taken before a recalc ran, not a pricing error. **Whether the client's emailed PDF
was also zero is unknown** — the printout rebuilds from a live recalc at print time, not from the
stored total. Matters because the Project List, dashboard and all revenue/KPI reporting read
`quotations.total`, so this job currently counts as ₱0 revenue. **Rommel is checking with the users
before anything is changed.**

### 7. "Share via apps" never closed the order — the SLA clock ran on (`a38924e`)
Of the five buttons in the Share modal, `doShareNative` was the **only** one that never called
`orderMarkSentFromQuotation`. It did everything else on success — closed the modal, set
`qSentStatus='Shared'`, logged *"shared via device share sheet with PDF attached"*, saved — so it
was an omission, not a decision.

The worst one to miss: it is the top button, the only one that genuinely **attaches the PDF**, and
the natural choice on mobile. The quotation reached the client, the log said so, and the order sat
in *On going* with the clock still running against the staff member.

The call sits inside `navigate.share()`'s `.then()`, so it fires only on a real send — verified with
a mocked share sheet that an `AbortError` (user dismissed it) and a generic rejection both leave the
order **open**. Falsely closing an order would be worse than the bug.

> **Still true, left deliberately:** *Copy to clipboard* closes the order (copying is not proof
> anything reached the client — a judgement call, not a defect), and **Lock & Send's "Send via
> email" does NOT** close it. If the team treats that as really sending, it needs the same call.

### 8. Orders: "Completed" → **IQ Lock/Sent** (`62c1793`)
Rommel's rename, and a better name: the order is not finished, the *Initial Quotation* has gone to
the client. Changed in **both** places so they cannot drift — `ORDER_TABS` and the green pill on the
card. Stored status is still `'Done'`; nothing written, filtered or synced changed.

**The lifecycle, confirmed in code:** New (`Pending`) → **Export to Quotation** → On going
(`In Progress`) → **share the quotation** → IQ Lock/Sent (`Done`, clock stops at `sentAt`). Lock and
approve touch the order at **all** — only sharing does.
**Archived** has no trigger in the Orders page at all: it happens only from the quotation side, via
`doCloseProject` or `confirmCancelQuotation`, and only for orders linked by `quotSerial` — so the
53 orders with no serial can never reach it. Their only exit is Cancel.
> ⚠ Untested risk: `orderMarkSentFromQuotation` writes `qSerial||qBaseSerial` (which carries an
> option suffix, e.g. `-3`) while `_archiveOrdersForQuotation` matches on `qSerial` at close time.
> Different active option → no match → the order never archives. No order has a serial yet, so this
> is unproven, but the app does use option serials.

### 9. Quotation ageing lifecycle — built at last (`59367ba`)
See the OPEN list item 8 above for the full entry. Short version: described everywhere since the
early days, never implemented (`calc:function(){return 3;}`, demo archive row, nothing ever wrote
`'Archived'`). Now **derived, never stored** — `_computeQuotationStatus()` rebuilds `status` from
flags on every save, so a stored `'Archived'` would be silently wiped. Forward-only via
`QUOT_AGE_START`; only quotations actually with a client age.
**Restore** (`QUOT_REVIVED`, a Settings key like `FOLLOWED_`) **restarts** the clock rather than
exempting the quotation, so one that goes quiet again ages out normally.

### 10. Order cards show which channel they came from (`9a990dc` → `bd79263`)
`ORDER_KINDS` gained `channel` (`wufoo` | `web`); the mark leads the existing kind pill rather than
adding a sixth badge. **Wufoo = the real logo** (`Wufoo logo.jpg`, data URI in a CSS class injected
once — ~15KB, so never inlined per card; it is a JPEG on white, so `border-radius:50%` clips the
corners or every pill shows a white square). **Website = an "M" monogram**, cream on MSSI dark.

> Two failed attempts, and the lesson is the useful part: **nothing containing the word "MSSI"
> survives 11px.** The wordmark read as a smudge; the favicon rendered as a plain black square. No
> better source file fixes either — the shape is wrong for the size. Wufoo reads because it is ONE
> letter in a solid shape. The M is a **channel initial, not MSSI's logo**; the real wordmark needs
> a taller pill.
>
> Found only by taking a **screenshot**. The DOM checks all passed — correct sizes, correct fills,
> no errors — while the thing was visually unusable. When a change is visual, look at it.

### Worth knowing
`isDirectClient()` reads the **live DOM** (`el('cl-type').value`), not the saved state — so any
cost path that depends on it is evaluating the form as it stands, not the quotation as saved.

A `<use>` whose referenced `<symbol>` is missing renders **0×0 with no error** — silent, and it bit
me mid-session when a test wiped `document.body.innerHTML`. `_ensureChannelSprite()` re-creates the
sprite if absent, but that is the failure mode if these marks ever go blank.

---

## What was changed on 2026-08-02/03 (session 2 — revisions, audit trail, signatures, and a delete that never deleted)

Eleven commits, `7f08478`..`abc112a`. Everything below was found by running the code
or by Rommel using the app — none of it by reading.

### 1. A revision now shows on the serial (`7f08478`, `791aed0`)
Unlocking a locked quotation superseded a version already issued, but the serial never
changed — so a client could hold two different documents bearing the **same number**.
(`confirmRevise` had the opposite fault: a brand-new unrelated serial, with the link to
the original surviving only in a "Revised from:" field.)

Format `.R1` — a **dash already means an option** (`QT-M00000012-3`), so a revision of an
option reads `QT-M00000012-3.R1` and stays unambiguous. **Unlock creates the revision;
the suffix is STAMPED at re-lock**, so a draft mid-edit never displays a revision number
for a version no client has seen (Rommel: *"no revision should appear if only draft"*).

Safe by construction: every base-serial regex in the file is start-anchored, so the suffix
is stripped wherever the base is needed — directory grouping, Drive folders, dedup.
Both directory loaders updated: a later revision **supersedes**, taking its identity AND
status; equal revisions are option variants and keep the existing most-advanced-status merge.

> Two pre-existing bugs surfaced: **`qRevisedFrom` was never persisted** (so the printout's
> "Revised from:" vanished on reopen) and **never cleared in `initQuotation`** (so a new
> quotation inherited the previous one's). Same shape as the ✓ Verified badge bug from June.

### 2. Audit trail — nothing logged can be lost, and it now says WHAT changed (`ec0e136`, `763a4fb`)
Rommel: *all changes must be recorded in the log and cannot be erased.*

**"Cannot be erased" was already true** and is worth knowing: Supabase `activity_log` has
INSERT + SELECT policies only — **no UPDATE, no DELETE**. 458 entries, 84 quotations,
5 users, unbroken since 2026-07-02.

**"All changes recorded" was not.** `gLogToSheets` dropped entries three silent ways:
returned early when the token/user was not ready, swallowed a failed Sheets append with
`.catch(function(){})`, and `supaInsertActivity` gave up quietly when not connected. In all
three the entry still appeared in the on-screen log, so it **looked** recorded. Now queued
in localStorage and retried (next log, every 2 min, 12s after login), never discarded, with
owed destinations tracked per entry so a partial write is not mistaken for a complete one.
An amber topbar badge appears only when entries are genuinely stuck.

Saves also now diff against the previous save and record the money fields plus any line whose
**quantity or price** changed:
`Changed: Total ₱21,309.06 → ₱24,185.24 (+₱2,876.18) · Wardrobe / Closet qty 4 → 6`.
Cosmetic edits are ignored on purpose. Capped at six line changes but **states the count**
("and 5 more changes") rather than truncating silently.

### 3. ⚠ Deleting a quotation never removed it from Supabase (`0075b40`)
`deleteQuotation` and `deleteSelectedQuotations` cleared memory and both Sheets tabs and
**never touched Supabase**. There was no `supaDeleteQuotation` at all, though
`supaDeleteOrder` and `supaDeleteUser` exist. Not cosmetic: `loadQuotationJson` reads
**Supabase first**, so a deleted quotation's state could still load, and the moment the
Project List moves off Sheets every quotation ever "deleted" would reappear.
`quotation_states`, `board_layouts` and `drawing_analyses` are `ON DELETE CASCADE`.

### 4. Signatures on the printout (`cd84047`, `e400104`, `4f0d9f2`)
Four signature blocks existed with no way to fill any without printing and signing by hand.
**Anyone** uploads their own from the avatar menu; **an Admin** can upload on a user's behalf
from Settings → Users (Admin-only, guarded twice, and the activity log records BOTH names —
it is one person putting another's mark on documents). Stored as `SIG_<email>` in Settings,
the same row mechanism as the company logos; reuses `_shrinkLogoDataUrl` (45k cell cap).

**Copied INTO the quotation at lock, not looked up at print time** — an issued document must
not change if someone later edits their signature. Re-locking does not reassign the preparer.
Centred on the rule; the image lives in the fixed-height gap so signed and unsigned blocks
stay the same height.

Only `prepared` is wired. `qSignatures` carries `checked`/`noted` slots and the printout
already reads them — **the approver flow is still Rommel's to define** (he has said it will
use the PIN).

### 5. Cost Breakdown header showed a stale op cost and margin (`982172f`)
One card read 61.34% in the header and 59.53% in its summary bar — same
`computeServiceCosts` call, the header simply never refreshed. The gap was exactly
₱1.4474/lm, the consumable just added. The header block had **no id**, so
`_refreshCbdSummary` could not patch it. Not consumable-specific: price, capacity %,
operator cost and allocation all left it stale. Other cards looked right only because they
had not been edited in that session.

### 6. Client autofill filled 6 of 8 fields (`8c4fb5a`)
Picking a known client left **City** blank and the **account type** on whatever was already
selected, though both are stored on every record. Account type decides Direct vs Subsidiary,
which changes what materials are billed. Now 8 of 8, with `_lastAcceptedClType` re-baselined
so the fill is not read as a user-initiated change offering to renumber the serial.

> Related, and the actual cause of "why does autofill barely fill anything": the client
> directory is mostly empty — of 20 records, **address 4, contact 7, email 9**, and **7 are
> completely bare**. The matcher fix from earlier (`3f72bd5`) backfills blanks on save, so
> records fill in as quotations are worked.

### 7. Quantity fields could not show thousands (`abc112a`)
A `type=number` input loses ~17px to the spinner arrows, so usable text space was 16px
(services, 55px col), 19px (materials/hardware, 58px) and 31px (carcass, 70px) — five digits
need 32px. **Every one was short.** All line-item quantity columns are now 78px (39px usable,
six digits fit). Width comes from the 2fr name column, which truncates anyway — this matters
because the app is embedded in a Google Site where total width is whatever the iframe grants.

> I widened the row grids first and left a header at 58px, offsetting every column after it
> by 20px. Header and row templates must always be changed together.

### Layout — proposed, mockup shown, NOT built
Rommel asked whether to make the quotation page double-column and full width. Measured
first: `#s1-wrap` is **2046px tall with no line items**, the total sits **1710px down**, and
removing the 800px cap (one line, `index.html:381`) gains 425px of width but saves **zero**
height. Client information alone is **657px** and is filled once.

So: **not** a symmetric double column, and full width is limited by the Google Sites iframe
anyway (`_fsAvailable()` is false there, so users cannot fullscreen to compensate).
Recommended instead, in order: (1) **sticky running total** with Lock/Preview, (2) **collapse
Client information** once filled, (3) widen fluid to ~1400px, (4) pair the short 40px cards.
A scrollable before/after mockup was sent: scroll height **1754px → 838px**, total stays on
screen. **Awaiting Rommel's decision, and the embed's actual width** — if narrow, the rail
should become a slim bar pinned to the bottom instead of a 224px side column.

---

# OPEN — 2026-08-03 (SUPERSEDED by the 2026-08-08 list — kept for the detail only)

### A. Supabase cleanup — SQL agreed, NOT RUN YET
Rommel approved deleting the testing-period quotations. As of session end: **209
quotations / 180 states, 98 still pending deletion.** The statement (his to run, in the
Supabase SQL editor — I do not execute permanent deletes):
```sql
delete from quotations
where created_at::date <= '2026-07-12'
  and initial_locked_at is null and final_locked_at is null
  and (source_order is null or btrim(source_order) = '');
```
> ## ⚠⚠ STRUCK 2026-08-06 — DO NOT RUN THIS STATEMENT ⚠⚠
> **"Supabase only — the Sheet is unaffected" is exactly why it must not be run.** The Google
> Sheet remains the Project List's read path for anyone not connected to Supabase, so this would
> delete from one store and leave all 56 rows in the other. They would reappear, and the two
> stores would disagree — worse than doing nothing. The 98 figure is also stale; it is 56.
>
> **Replaced by: Project List → filter to Draft → tick the rows → "Delete selected"**, the
> existing Admin bulk delete, which removes from memory, the Sheet and Supabase together and logs
> each deletion. See the "Test-data cleanup" entry in the current OPEN list for the full scope and
> the two sets worth checking before deleting.

Expect **98 rows**; 209 → 111. Children cascade. Supabase only — the Sheet is unaffected.

> ⚠ The `never locked` conditions are deliberate and were argued for. Dropping them takes
> 77 more, including **`QT-260619-3668` (MABA CONSTRAK)**, which is under investigation
> (item B), and the 9 `fqLocked` rows (item C). **Do NOT use "old serial format" or a bare
> date cutoff as the rule** — 137 quotations are old-format, including everything Joanna
> Buenconsejo and Andrei Salvador ever produced. Real staff were working well before
> 12 July: Andrei from 5 Jun, Joanna 19 Jun, Jhover 23 Jun.

### B. `QT-260619-3668` (MABA CONSTRAK) — stored ₱0.00, should be ~₱32,981.26
Unchanged. Real Wufoo order, locked and emailed by Joanna on 19 June. Rommel is checking
with the users. Only such record across all states. See the 2026-08-02 session for detail.

### C. 9 quotations final-locked but state never recorded it
Unchanged, parked. Already fixed in-app on 2026-07-06; these are legacy rows. Repair is
ready. Held because MABA is in both sets.

### D. Signature flow for Checked by / Noted by
`qSignatures.checked` / `.noted` exist and the printout reads them. Rommel will use the PIN;
the flow (stamp automatically on PIN approval vs a separate deliberate "sign" action) is
his decision and not yet made.

### E. Quotation page layout
Mockup sent and approved in principle? — not yet. Needs his go-ahead **and the Google Sites
embed's actual width** before choosing side rail vs bottom bar. See the session entry above.

### F. Signature image quality
Rommel's uploaded signature has a grey box because the source image has an opaque
background. A tight transparent PNG (~400px wide) fixes it. If a genuinely transparent PNG
still boxes, the JPEG fallback in `_shrinkLogoDataUrl` is firing at the 45k cap and the PNG
budget should be raised rather than worked around.

---

# ⚠ OPEN — earlier items (as of 2026-07-30)

Everything below is pending. Nothing here is started.

### 1 + 2. Subsidiary material billing — these are ONE problem, not two
The three modes disagree about whether a subsidiary is billed for materials:

| Mode | Materials billed to |
|---|---|
| Carcass | everyone — they are inside `CARCASS_PRICES` |
| BOM | everyone — billed as line items |
| **Cutting list** | **Direct only** (`isDirectClient()` in `getAreaSubtotal`) |

Cutting-list is the outlier. Rommel's rule — WCLI is *transferred* materials, CWLI is a *genuine
sale* — implies the gate should be **"not WCLI"**, neither "Direct only" nor "everyone". Applying
that consistently in `getAreaSubtotal` and `getBOMItemUnitCost` fixes both items at once.

**Measured against the 152 saved quotation states** (rather than assumed):

| | Count |
|---|---|
| Direct | 143 |
| Subsidiary — CWLI | 3 (all carcass) |
| Subsidiary — WCLI | 4 (2 carcass, 1 BOM, 1 cutting-list) |
| Subsidiary — unset | 2 carcass |

So subsidiaries are **9 of 152 (~6%)**, and 7 of those are carcass where materials cannot be
separated either way. **Item 1 affects zero existing quotations** — CWLI has only ever used carcass
mode, and there its material margin is *already* recognised, because `_fabCarcassMargin` applies
`_materialMarginCounts()` and CWLI passes it. **Item 2 affects two quotations.**

It is a **pricing change** (CWLI cutting-list totals go up, WCLI BOM totals go down), so it was not
made unilaterally. **Residual that no gate fixes:** carcass always bills materials to WCLI, because
they are inside `CARCASS_PRICES`. Separating that needs a cost/price split per cabinet type — the
same data gap as item 4.

### 3. Price DB Materials — ~39,420 blank-unit rows (root cause found 2026-07-30)
153,552 rows / 124,132 distinct names. The "duplicates" are mostly **blank-unit twins**: ~29,420
shadow a good row of the same name, and ~10,000 have **no populated alternative**. The unit column
stops being filled from roughly alphabetical position ~93,000 (near *"Toast MDF 4x8 2F Floor
Sample…"*), so it is one truncated import.

**⚠ Do not delete blank-unit rows** — ~10,000 SKUs exist only as one. The app is already immune
(`lookupInSource` prefers the populated row, `2b594b8`), so nothing is broken; the rows just
clutter. If tidied: **fill the missing units, delete nothing**, on a copy of the tab, dry-run
first. Parked at Rommel's request.

**Remember:** a direct Google Sheet edit does not reach Supabase — run `supaMigratePriceDb()` after.

### 4. Hardware off the assumed 30%
Rommel has procurement/COGS data for **hardware** to load, either into Modcraft or an admin
procurement app. When it lands, hardware moves from the stated 30% assumption to measured cost —
same mechanism services already use via `computeServiceCosts()`. Materials stay assumed until
landed cost exists for them too.

### 5. ⚠ Wufoo API key still needs rotating
Redacted from `CLAUDE.md` on 2026-07-29 but **git history still holds it, and this repo is public**.
Rotate in Wufoo (Account → API Information), then update `WUFOO_API_KEY` in the Apps Script project.

### 6. Website order pipeline (parked 2026-07-29; site work continued 2026-07-30)
Gap 2 + Gap 3 shipped. Left: wire the **live ModCraft catalogue** into the webpage cutting list
(stand-in SKUs currently land in the fuzzy matcher an exact SKU would let it skip), and two gaps in
the **form** — boring needs a hole count (priced per hole; a service at qty 0 is dropped entirely)
and grooving needs its three variants. The form also never asks **1F/2F**.

The website itself moved on 2026-07-30 (design polish, live WCL finish ranges, logo vectors, map
fixes) — **its own pending list lives in `MSSI Webpage/HANDOFF.md`**, which is the authority for
that side. Nothing there changes Modcraft; the three gaps above are still the whole Modcraft-facing
ask.

### 7. Components-per-unit — DONE 2026-08-02 (Rommel filled it in)
`CARCASS_COMPONENTS` now holds all 13 types (Settings → Carcass pricing):
Wardrobe/Closet 31 · Work Space Table 28 · Kitchen Drawer 25 · Sink 10 · Vanity 10 ·
Overhead 10 · Kitchen Base 9 · Kitchen Tall 8 · Luggage 8 · Fridge 7 · Kitchen Hanging 7 ·
Toilet Partition 5 · Wall Cladding 1.

Carcass and BOM project size therefore **auto-detects**. Verified against the 17 approved
carcass quotations awaiting a Final Quotation lock: zero unmapped types, and detection
yields real numbers (490, 357, 260, 250, 250, 110 …).

> ⚠ This entry previously read "empty for all 13 types" and was **stale**, which produced a
> wrong impact estimate for the Stage 2 gate (27 blocked, when the true figure is 10). If a
> claim here decides anything, re-check it against the CONFIG row — `value->'carcassComponents'`
> in the `settings` table — rather than trusting this file.

### 8. Stage 2 lock gate — DONE 2026-08-02
Final Quotation lock now requires a project size, same as Stage 1. Both stages share one rule
(`_projectSizeGateOk` / `_projectSizeGateFail` / `_applyGateToBtn`) rather than a copy each.
Stage 2 sends the user to Stage 1 first, because the Project Size card lives inside `#s1-wrap`
and is hidden on Stage 2.

**Remaining exposure: 10 quotations** — approved, awaiting a Final Quotation lock, cutting-list
(services) mode, no Designers Support analysis, so nothing can detect a count for them. Each
needs a project size typed once. The other 17 auto-detect (see item 7).

### 9. ⚠ PMES is readable with no login — waiting on its Google sign-in
The 22 `pmes_*` tables carry anon SELECT policies and `pmes_production_jobs` exposes
`quotation_serial`, `payment_status`, `payment_reference`. **Not a policy mistake:** the PMES app
makes no auth calls and uses the website's own publishable key, so it depends on them. Rommel has
confirmed PMES will get Google sign-in. **Do not drop the anon policies before that lands** — it
would take PMES down. When it does: drop the 22 anon policies and revoke the 7 RLS-free `pmes_*`
views from anon. Full detail in the 2026-08-01 session 2 entry below.

### 10. Attachments now carry up to 10 files — see session 3 below
`pending_orders.attachments` holds the full list; `attachment_1/2` mirror the
first two for the Wufoo webhook. Order cards list each file by its own name.

### 11. Exercise a signed attachment link once in the real app
`viewOrderAttachment` mints a one-hour signed link for website attachments. The storage policy is
proven across five identities, but the call itself needs a signed-in staff session, which these
sessions cannot produce. Open one website-filed attachment in the real app to close it out.

### 12. Intermittent outbound connection failures — WATCH
Twice on 2026-07-29: the browser showed `ERR_CONNECTION_TIMED_OUT` on every Supabase REST call, and
`git push` failed twice with "Failed to connect to github.com port 443" — while `curl` reached both
hosts from the same machine in under a second. Third attempts succeeded. Not a code fault and not
the services. If staff report the app hanging, orders not loading, or the Sheets-fallback banner
appearing, this is the likely cause. Note the notification relays post `no-cors`, so a dropped
request is **silent by construction** — a Chat/email nudge can vanish with no error anywhere.

## What was changed on 2026-08-01 (session — page width, and the catalogue opened to the website)

Mostly an MSSI-website session (see that folder's `HANDOFF.md`), but three things land here.

### 1. `.page` was capped at a reading width (commit `1579707`)
Every page sat in a **1080px** column with ~420px of empty screen down each side of a 1920
display. That is a prose measure, and this app is dashboards, project tables, order queues and
quotation grids. Raised to **1700px** — one number, and `1080px` appeared exactly once in the
file. On anything narrower nothing changes, because max-width only ever caps.

**Rommel's standing rule, recorded so it applies by default:** *"if it can [be] viewed in one
screen by utilizing screen then it should be design like that… its more efficient."* Do not ask
when the answer is obvious; build it wide. A centred reading column is for prose.

> **Noted, NOT fixed:** at 1280px the app scrolls sideways to 1349px. The overflow is in the
> **topbar** — the fullscreen button and avatar cluster — and is byte-for-byte identical with the
> old 1080px value, so it predates the change.

### 2. Three price-free catalogue views now exist in Supabase
The MSSI order form is anonymous, but `price_materials` / `price_hardware` / `price_services` are
readable only by authenticated users. Rather than opening those tables:

| View | Exposes | Rows |
|---|---|---|
| `catalogue_materials` | name, unit, category | 124,132 |
| `catalogue_hardware` | name, unit | 143 |
| `catalogue_services` | name, unit | 57 |

**Price is deliberately never exposed** — the client picks a SKU, ModCraft prices it afterwards.
Granted to `anon` and `authenticated`.

Each view **groups by name**, which collapses the ~29,420 blank-unit duplicate rows that shadow
good ones and keeps the populated unit. Two indexes were added to `price_materials`:
`_name_trgm` (GIN/pg_trgm — `ILIKE '%x%'` cannot use a btree, and was seq-scanning 153k rows per
keystroke; a three-word search is now **17.7ms**) and `_name_btree` (the trigram index cannot
answer an exact-name lookup, which is what a pasted SKU is).

**These views read from `price_materials`, so anything that rewrites that table flows through.**
The standing rule still applies: a direct edit to the Price DB **Sheet** does not reach Supabase —
run `supaMigratePriceDb()` afterwards.

### 3. A data error to fix in the Price DB Sheet
**`Boring 59mm (Grommet)` is priced `/lm`. All boring is per hole** — confirmed by Rommel. The
website's cutting list already treats every boring service as per hole; the catalogue does not.
Fix it in the **Sheet**, not Supabase — a Supabase-only edit is undone by the next
`supaMigratePriceDb()`.

Worth knowing why it matters: ModCraft **drops a service at qty 0**, so a boring line with no hole
count does not arrive vague — it disappears. The website now collects the count
(`Boring 35mm (Hinges) × 4 holes`), which is the other half of the same fix.

---

## What was changed on 2026-08-01 (session 2 — the website cutting list proven, and two data leaks closed)

Worked alongside the MSSI website (`MSSI Webpage/HANDOFF.md` is the authority for that side).
Two ModCraft commits, `d7fac3f` and `e67421b`, plus Supabase policy work.

### 1. The cutting list was discarding data the website already sends
The launch question was whether a website cutting list, exported to a quotation and fed to
Designers Support, produces an *accurate* result. It did not — `_cutListToAnalysis` was written
against the **old** form and the website moved on when it went onto the real catalogue (2026-08-01
session 1). Two things arrived and were thrown away:

| Website sends | ModCraft produced (before) |
|---|---|
| `Real White PB 4x8 **2F** (18mm, Matte)` | `faces: 0` + "the web form never asks 1F/2F" |
| `Boring 35mm (Hinges) **× 4 holes**` | "the web form collects no hole count" |

**Faces.** The SKU *is* the spec, and this app already owns a parser for that exact string —
`_prodParseMaterialDescriptor` returns `{substrate:'PB', faces:2, texture:'matte', thickness:18}`.
The website path simply never called it. That matters because `prodComputeBom`'s grouping key is
`[material,color,texture,thickness,**faces**,colorB,textureB,isHpl]` and `_prodFieldMatchScore`
matches on faces too — so a 2-face board was grouped and matched as though the face count were
unknown.

**Holes.** `prodComputeServices` sums `holeSchedule[].qty` into `holeCount`, and a service at
qty 0 is dropped entirely — so a boring request was not arriving vague, **it was disappearing**.
The count is now parsed into `holeSchedule` with the diameter and hole type read off the service
name. A chip with genuinely no count still flags rather than pricing at zero.

**Verified by driving the real functions.** All nine of the site's edge codes, in both
orientations (18 cases), convert to identical banded length — including `1L` on a 400×800 piece,
where the long edge sits in the *width* field, correctly becoming `1s`. A five-row two-cabinet
list mixing a 1F and a 2F board of the same substrate and thickness now yields cutting 10.45 LM,
edgebanding 14.84 LM (14.132 × 1.05 wastage), 20 holes, and two BOM groups split correctly by
face count at 1.72 and 1.23 m² — every figure matching an independently hand-computed
expectation, **zero rows flagged for review**.

**Not a bug, confirmed:** an unrecognised edge code zeroes that row's banding but flags it
loudly, so it can never go out silently short. (The site's all-round code is `4S`; `2L 2S` is not
one of its nine and correctly flags.)

### 2. Client shop drawings were world-readable AND world-listable
`order-attachments` was a **public** bucket *and* carried a policy `"anyone can read order
attachments"` granting SELECT to `public`. Anyone holding the publishable key — printed in the
website's own source — could **list every attachment by name**, getting the order reference and
the client's own filename, then download each one without logging in. Proven against a
rolled-back test row before changing anything, with a `quotations` row as a control (correctly
returned nothing).

Caught while the bucket still held **zero files**, so there was nothing to repair.

Bucket is private, the public read policy is dropped, and two scoped policies replace it: staff
read attachments belonging to an order they can already see (matched on the first path segment,
which is the order id), and a signed-in client reads their own. Admin tier included so an
orphaned upload is never stranded. **Anonymous UPLOAD is untouched** — the order form has to stay
able to attach a drawing.

`viewOrderAttachment` now mints a **one-hour signed link on click** for `supabase://` references.
**The file itself never expires** — the clock starts when staff click, so a drawing filed on a
Friday opens fine on Monday, after a long holiday, or a year later. What dies is a link copied
out of ModCraft into an email or a screenshot.

Verified across five identities: owning-company staff and the owning client see the file; a
different client, another company's staff and an anonymous outsider see nothing; Admin sees it.
Drive and Wufoo attachments are untouched and still open exactly as before.

> **Not verified from here:** the signed link is created by a signed-in staff session, which
> these sessions cannot produce. The policy it depends on is proven; exercise the call once in
> the real app.

### 3. Corrections to stale figures in this file
- **`pending_orders` holds 53 rows, not 135** (oldest 2026-07-05, 52 of 53 written by the Wufoo
  webhook). The "135 open orders" line was already stale before this session.
- Every table holding client information returns **zero rows to anon** — clients, quotations,
  pending_orders, order_cutting_lists, job_applications, users, messages, settings. The wide
  SELECT *grants* look alarming in the catalog but carry no anon policy, so they yield nothing.
  RLS fails closed.

### 4. ⚠ PMES is readable by anyone, and it is not a policy mistake
The 22 `pmes_*` tables each carry an anon SELECT policy. `pmes_production_jobs` exposes
`quotation_serial`, `payment_status` and `payment_reference`. Verified why: the PMES app
(`Desktop/Modcraft Product Manufacturing Execution System (PMES)/modcraft-pmes-app`) makes **no
auth calls at all** — `grep` for `signInWith|auth.|getSession` returns nothing — and `config.js:15`
holds **the same publishable key as the public website**. So the anon policies exist because PMES
depends on them.

**Do NOT drop those policies before PMES has sign-in — it would take the app down.** Rommel has
confirmed PMES *will* get Google sign-in; when it lands, drop the 22 anon policies and revoke the
7 RLS-free `pmes_*` views from anon. Adding auth there is cheap: one client at `app.js:18`, every
read through the `Data.*` helpers, and all 22 tables already have `authenticated` policies.

Also worth knowing: **that folder is not a git repo** — ~3,000 lines with no version control.

### 5. New Supabase objects this session (not in `supabase_schema.sql`)
`rate_limit_hits`, `app_client_fingerprint()`, `app_rate_limit_ok()`, `catalogue_search()`,
`catalogue_resolve()`, `catalogue_list()`, `client_companies`, `client_accounts`,
`client_company_invites`, `client_company_id()`, `client_company_emails()`. See the MSSI handoff
for what they are for.

---

## What was changed on 2026-08-01 (session 3 — attachments, tripwires, and the silent-loss rule)

Continues session 2 in the same sitting. ModCraft commits `2bc7e71`, `73c101c`,
`cccf68f`. The MSSI side is in `MSSI Webpage/HANDOFF.md` session 3.

### 1. Show every attachment, not just the first two (`2bc7e71`)
A website order can now carry **10 files at 100MB** (was 2 at 25MB — both numbers
were ours, and the cap silently discarded the rest). `pending_orders.attachments`
holds the full list; `attachment_1/2` still mirror the first two so the Wufoo
webhook and Sheets columns V/W are untouched. The order card lists each file
**by its own filename** rather than "File 1 / File 2", truncating at 26 chars
with the full name on hover. Rows without `attachments[]` fall back to the two
legacy columns, so every existing row renders exactly as before.

### 2. The tripwire — refuse to trust a parse that does not match (`73c101c`)
**This is the important one.** Three separate faults in one day were the same
shape: data arrived correctly, part of it was quietly dropped, and the result was
simply SMALLER — indistinguishable from a correct one. Rommel's point stands:
*"you cannot really check every time especially during peak season."*

Every cutting list already carried totals the **client's browser** computed, and
nothing ever compared them. `_cutListToAnalysis` now checks rows, pieces, and
payload panels against what it built. A mismatch puts
**"⚠ THIS LIST DID NOT ARRIVE INTACT"** at the FRONT of the summary, naming the
exact difference, and `_integrity` carries the declared and parsed figures.

**It flags and still imports, deliberately** — refusing on a false positive would
strand a real job at the busiest moment.

> **Standing rule, both codebases: anything that caps, skips, or fails to parse
> must be LOUD, never short.** A crash announces itself; a quietly smaller result
> does not.

### 3. Flag a row that adds nothing to the board count (`cccf68f`)
Checked rather than assumed whether the stages after import can lose a row. They
mostly cannot: a blank material becomes an **"Unknown"** group that is still
counted and still allocated a board, and a zero quantity is treated as one. The
one real gap — a row with no length or width contributes no area and no boards
and says nothing — is now flagged per row, naming the missing dimension. A
missing quantity is flagged too, since being silently counted as one is a
decision the estimator should see.

### 4. Corrections to what I claimed earlier in the day
- I called the MSSI Excel template broken (10 columns where the importer reads
  12). **False alarm.** I read the `.xlsx` sitting in the folder instead of
  tracing the download button, which builds the workbook fresh in the browser.
  Checking the artifact instead of the path is the same mistake as trusting a
  stale doc.
- I implied a broad unguarded region downstream of import. **Overstated** — see
  item 3; the BOM stage does not silently shrink.

### 5. ⚠ PMES — Rommel has confirmed it will get Google sign-in
Until it does, **do not drop the 22 anon policies** — that app makes no auth
calls and uses the public website's own publishable key, so removing them takes
it down. When sign-in lands: drop the 22 anon SELECT policies and revoke the 7
RLS-free `pmes_*` views from anon.

### 6. Do not patch this file with Python heredocs
Python silently turns `\n` and `\b` inside a string into real control characters.
It put literal newlines inside a regex literal in `portal.html` and broke the
whole script — every hoisted function stayed callable, so the page looked
perfectly healthy while its tail had never run. Use the Edit tool, or node.
Always re-verify with `new Function()` over each `<script>` block afterwards.

## What was changed on 2026-08-03/04 (session — silent-loss sweep, contingency control, rate freeze, VAT by account type, Team performance)

17 commits, `a840e1e`..`e196559`, all deployed and verified live on GitHub Pages. Almost every
item below was found by RUNNING the code or by Rommel using the page — not by reading it.

### The recurring shape
Nine of the twelve bugs were the same failure: **something arrives, part of it is quietly
dropped, and the smaller result looks identical to a correct one.** Where a fix was possible the
rule applied was: **loud, never short.**

### Fixed
1. **Orders never archived** (`a840e1e`) — `_archiveOrdersForQuotation` compared serials with
   `===`. The order stores whichever serial was live when it was *shared*; closing happens on
   whatever is live *then*. Driven against the real functions: **4 of 6** share/close combinations
   failed, including both revision cases (`.R1`, new the day before). A loop matching nothing
   raises nothing, so the order sat in *IQ Lock/Sent* forever. New `_serialRoot()` strips both the
   option (`-2`) and revision (`.R1`) suffixes. Not yet triggered in production.
2. **Supabase saves could fail silently** (`ac62d86`) — `QT-W00000038` was renumbered, logged as
   "Final quotation draft saved", and never reached Supabase; saves either side of it landed.
   Three causes: `supaUpsertQuotation` had **no `.catch`** (a network rejection never sets
   `r.error` and the surrounding try/catch cannot see an async rejection — confirmed zero warnings
   raised by the old code); `supaUpsertState` **discarded the parent-stub's error**, reporting the
   symptom not the cause; and the failure counter was **memory-only**, so a refresh erased the
   evidence. Failures now persist to `localStorage` with their text, and Settings → Company & DB
   lists the last five with time and serial. Toast wording corrected — it claimed "your work still
   saved normally", untrue now that state is READ from Supabase first.
   **The root cause of the W00000038 loss itself was never established** — the evidence was gone.
3. **Price catalogue could load short** (`ca24179`) — `_supaFetchAllRows` assumed the page size it
   asked for was the page size it got. PostgREST caps at `pgrst.db_max_rows` = **10000 on this
   project, exactly equal to PAGE**, so it works by coincidence. Simulated at a 1000-row cap, the
   old code returned **1,000 of 153,552 rows, silently**. It now takes the real page size from the
   first response and compares against an exact count; short means it says so and falls back to
   Sheets. Also: **BOM and Outsource hand-rolled "first exact match wins"** where cutting-list used
   `lookupInSource`'s best-of-duplicates — the same SKU could fill differently per mode. Latent
   (measured: zero names currently have a worse first row), now unified.
4. **Quotation name came from Google, not Settings** (`4058dcc`) — `prepared_by` was `gUser.name`
   off the Google profile. Several staff share a mailbox (`designer-ce1/2/3`, `ppic2`), so the name
   was the mailbox's. Now taken from the Roles sheet row already matched at login; the Google name
   is the fallback for blank cells and the old 4-column format. Editing your own name in
   Settings → Users updates the live session too.
5. **Contingency & charges card** (`083f5d3`, `df223e8`, `62f0e23`) — fabrication-only quotations
   had no way to touch the contingency at all (fab buffer is `ni`-gated; the CF override card is
   hidden for that service type). New per-quotation card: **rate (%)** plus **Charge under**
   (separate line / included in fabrication). **Not approval-gated** (Rommel's call) — so each
   committed change logs old to new, and a coral "Reduced to N%" pill shows on the card.
   `_fabContLast` means typing 1, 12, 12.5 logs once.
   **Two follow-ups the same session:** it never appeared on a *new* quotation (`initQuotation`
   sets the Assembly and override cards' visibility explicitly and I had not added this one), and
   it was then moved up under **Scope of work** because it changes the fabrication price.
6. **Site visit read P0.00 while charged** (`23daf7a`) — `sv-cost-disp` was refreshed only when one
   of its three FIELDS was edited; ticking Active touches no field and `recalc` never refreshed it.
   Display only — verified the money was right in all four configurations (+P1,680 = P1,500 x
   1.12). `recalcFQ` had always refreshed its copy; Stage 1 never did.
7. **Charges could bill off service quantities** (`4ff9e8e`) — cutting-list and design charges are
   per CARCASS, but took their count from `getInstallCarcassUnits()`, which falls back to
   `getTotU()` when the Carcass / Unit Count card is blank — and in cutting-list mode `getTotU()`
   sums **service line quantities**. A real job (240 lm + 310 lm + 96 holes) reads as **646
   units**: cutting list **P323,100 instead of P6,100**, folded silently into fabrication where
   nobody would see it. No live quotation had hit it (measured). `_chargeCarcassUnits()` never
   takes that fallback; a blank count floors at 1 unit **plus an amber warning**, and both cards
   now show their arithmetic. **`getInstallCarcassUnits()` deliberately untouched — Installation,
   Assembly and PPIC still take that fallback (see OPEN).**
8. **Design charge is per carcass unit only** (`68b3ab7`) — the per-area rate existed only because
   cutting-list mode had no carcass number; that gap is filled, so it had become a second near-flat
   fee (187 of 194 quotations have exactly one area). Field removed from Settings;
   `CF.designChargePerArea` kept for old saved settings, nothing reads it.
9. **Locked quotations were not frozen** (`d46a25e`) — a locked quotation recomputed from TODAY's
   Settings, and `doApprove` / `confirmSend` / `skipSend` / every `doShare*` /
   `confirmClientApprove` / `confirmCancelQuotation` write that back over the stored total — all of
   which happen AFTER locking. Demonstrated: one issued at P90,720 reprinted and would re-save at
   P100,800. **Rommel: freeze at lock, release only on unlock.** `_capturePricingRates()` copies
   `CF`, `CARCASS_PRICES`, `MOB_LOCATIONS`, `INST_COST` whole (~4.4 KB in state);
   `_withFrozenRates()` swaps the globals, runs, restores in a `finally`; `recalc`, `recalcFQ` and
   `_buildPrintBody` all go through it so the printout holds too. Pill **"Rates as at lock"**;
   releasing measures and announces the delta. **Existing locked quotations are NOT backfilled** —
   the rates they were issued at are not knowable, and inventing them would cement a wrong number.
10. **Design charge display option** (`b7667c2`) — separate line, or folded into fabrication and
    not shown. Independent of the contingency fold; all four combinations verified identical at
    P109,760.
11. **VAT default by account type** (`e74db30`) — a Subsidiary (WCLI/CWLI) transfers cost into its
    own system which adds VAT there, so quoting VAT-inclusive charges 12% twice. **Direct stays
    VAT-inclusive; Subsidiary defaults to VAT-exclusive**, and for a Subsidiary non-VAT needs no
    approval (the Request button is hidden). **Choosing Vatable is never gated, either direction** —
    it cannot under-charge. Direct dropping VAT still opens the PIN modal. Announced with
    before/after, since it moves the total 12%.
12. **Printout says VAT EXCLUSIVE** (`92a09d0`) — omitting the VAT row made its absence ambiguous;
    silence reads as "VAT included". Marked in three places: a `VAT | VAT EXCLUSIVE` row,
    `GRAND TOTAL (VAT ex.)`, `TOTAL COST (VAT ex.):`. Keyed on the treatment, not the account type.
13. **Team performance** (`d5d9a26`, `0272d59`, `e196559`) — it was live but counted
    `status==='closed'`, a status that stopped existing when the ladder was redefined: **zero of
    223 quotations match**, so Closed/Rate/Revenue read 0 for everyone. It timed created to lock,
    and ranked anyone who ever prepared a quotation.
    Now: **per-user "Include in Team performance"** switch (Settings → Users, Admin-only, OFF by
    default, User Roles col Z, ranges A:Y → A:Z, new `users.include_in_kpi` column); the clock is
    **order received → quotation sent in WORKING hours**, reusing `calcWorkingMinutes` so it can
    never disagree with the order card's SLA timer; Won/Rate/Revenue key off **Client Approved**;
    **company filter** All / WCL / MSSI / CWL / Unassigned. Unticked preparers are **named in a
    footer** (Admin and Director exempt — that was pure noise).
    **Company filter rebuilt** (`e196559`): it inferred company from the serial prefix, which only
    exists post-2026-07-04, so **137 of 223 quotations were silently dropped** by any company
    choice. Rommel: *"if they quoted for WCLI, CWLI or MSSI, it's always there"* — it is, on the
    form, just never stored. **Quotations sheet gains column U = Company** (ranges A:T → A:U);
    `_quotCompanyKey()` prefers it and falls back to the prefix. Rows hidden for having no company
    are counted and stated under the table.
    **"Orders answered"** = completed received→sent cycles, i.e. the sample size behind the
    average response time.
14. **Deleting a quotation logged nothing** (`e196559`) — permanent destruction with no trace,
    against the "everything recorded, nothing erased" rule, and the reason the Sheet-vs-Supabase
    row gap could not be explained. Now logs serial, client and value.

### Corrections to earlier claims in this file
- **`index.html`'s working copy is LF**, not CRLF (git converts on checkout). Edits matched fine.
- **OPEN item 6 was stale** — hole counts ARE collected and parsed.
- **Supabase counts are inflated versus the app.** `supaDeleteQuotation` did not exist until
  `0075b40` (2026-08-02), so every quotation ever deleted from the Sheet is still in Supabase.
  The dashboard (reading the Sheet) is right; SQL counts in this file that predate that commit —
  including the "24 Subsidiary quotations carrying VAT" list — may include deleted rows.

### Findings reported, NOT acted on
- **Subsidiary quotations carrying VAT** — 24 found (P2.45M, P262,898 of VAT). **But only 2 are
  genuinely inter-company**; 16 have external client names (Bella Ferma, STUDIO TILLE, VALERA
  MARKETING, Peter Bena Construction...). For those the wrong field is the **account type**, not
  the VAT — removing VAT would under-bill by P237,149. Rommel: users adjust these themselves.
- **The Wi-Fi stall.** Reproduced: after ~2 min idle the first packet is dropped, giving 7.1 s /
  15.2 s stalls (Windows SYN retransmit 1+2+4 / +8). **The ping to the router itself was LOST**, so
  the loss is on the Wi-Fi link, before the router — not the ISP, not Cloudflare, not Supabase, not
  Tailscale (its interface carries only private ranges; one default route, via Wi-Fi). Windows
  wireless power saving is **Medium on battery**, Maximum Performance on AC — but a drop happened
  while plugged in, so the remaining laptop-side suspect is **MIMO Power Save = Auto SMPS**; beyond
  that it is the access point. **Cost three failed `git push` attempts this session.** System
  settings, Rommel's to change.

## What was changed on 2026-08-05 (session — 12 fixes: Stage 2 leak, locked prices, audit log, hardware catalogue, additional orders)

Twelve commits, `bad19ac`..`9a624ca`, all deployed and verified live. Every one was found by
RUNNING the code or by Rommel using the page; none by reading alone.

### The two agreed at the end of 2026-08-04, both built
1. **Order queue card** (`bad19ac`) — Dashboard, under Team performance, same company filter and
   the same widget gate (a sixth widget key would need adding to every saved DASHPREF / DASHALLOW
   row before anyone could see it). Four tiles — still new · in progress · reached quotation ·
   past SLA — then average age of the open queue, the oldest order waiting, and how many answered
   arrivals were late. Reuses `calcWorkingMinutes` and `ordersSlaSettings.defaultHours`
   deliberately, so it can never disagree with the order card's timer. Company matched by
   **keyword** (`_orderCompanyKey`) — "Module System" singular is the real value on 7 users.
   Everything it cannot count is STATED: site visits (SLA-exempt), orders with no received time,
   rows hidden by the filter, cancelled/archived, and the Sheets-only partial queue.
   **Surfaced a real gap:** only `exportOrderToQuotation` sets *In Progress*, but the quotation
   backlink appears only once that quotation is SAVED — so "In progress: 9 / Reached quotation: 0"
   are both true. The tile now names it ("9 with no saved quotation yet") = an export abandoned or
   still open in someone's tab.
2. **Walk-in / Email arrival + response clock** (`dc63eda`) — Team performance could time only
   **6 of 225** quotations, because an order carries a received time and a directly-started
   quotation carries nothing. Rommel's design: the encoder says how the job arrived, that starts
   the clock, Initial Quotation lock stops it. **Two sources, not one tick** — CWLI does not use
   Wufoo, their orders come by email, so calling every non-order job a walk-in would mislabel a
   whole company's work. An email order is real client WAIT, so its received time is **backdatable**
   (defaults to now; a future time is refused with a toast). Reminder fires on the client name and
   never nags again once picked. An order-backed quotation locks both radios and says where its
   clock comes from. Self-reported by the person measured — deliberate trade, so every start,
   source change and backdate goes to the activity log. Locked quotations with no source picked are
   counted and NAMED under the table. One shared column, not two: once the start is deliberate the
   quantity is the same either way. **Storage:** Quotations V=Job Source, W=Job Started;
   `job_source`/`job_started_at` on Supabase. Forward-only — the 101 already-locked walk-ins never
   get a start time. Not in the option snapshot on purpose (the job arrived once).

### Bugs Rommel reported, all root-caused by reproduction
3. **QT-M00000070 read ₱0.00 at Final, ₱3,043.04 at Initial** (`df8459b`) — the pricing was never
   wrong; **Stage 2 was reading another quotation's numbers.** `fqInitialized` was only ever reset
   by `initQuotation()`, which opening a saved quotation never calls — so after viewing Stage 2 on
   quotation A, opening B and clicking Final Quotation **skipped `initFinalQuotation()` entirely**
   (`goStage` guards on that flag) and B kept A's `fqFabBasis`, `fqFabCostOverride`, `fqInstRegion`,
   `fqInstWorkers`, `fqInstDays`, `fqInstPlanner` and `fqBondIns`. Reproduced on 70's real state:
   fresh load 2,766.40/2,766.40 · after another quotation (blank) 2,766.40/**0** · after another
   quotation with a real number 2,766.40/**111,998.88**. The zero is the mild case; the third row
   is the dangerous one, and bond insurance leaked the same way, switching itself on and adding
   real money. `restoreFullQuotationState` now clears `fqInitialized`. Safe to re-run:
   `initFinalQuotation()` never touches `fqLocked`/`fqSentStatus`/`fqClientApproved` and approvals
   are guarded by `fqApprovalsFromSave` — all three verified intact. **Also fixed the quieter
   half:** `fqFabBasis`/`fqFabCostOverride` were never persisted, so a typed cutting-list cost was
   lost on reopen; both now save, with a new `fqBasisFromSave` flag stopping `initFinalQuotation`
   resetting them.
   > ⚠ **One casualty predates the fix: `QT-M00000087` (GYMFIX), final-locked and Client Approved
   > at ₱0.00 on 2026-08-04.** Its line items are worth ₱500; its sibling `QT-M00000088` with the
   > identical ₱500 line totals **₱616.00** (500 × 1.10 × 1.12). Correcting it needs an unlock of a
   > client-approved quotation — Rommel's call, NOT done.
4. **"The line item format doesn't appear anymore"** (`d42bef4`) — not lost; the
   *Services, Materials & Hardware* print mode was gated to **"Fabrication only"**, so it never
   appeared on a Fabrication-with-Installation quotation. The gate was too strict: itemised rows
   replace only the per-area scope table and everything below (Fabrication subtotal, Mobilization &
   Installation, design charge, site visit, discount, bond, VAT, grand total) is the same shared
   totals section either way. Gate is now the fab-mode check alone; BOM and carcass still hide it.
   Verified the risk directly — **totals identical both ways**: Fabrication only 3,326.40/3,326.40,
   with Installation 618,247.41/618,247.41, both equal to `_pCalc.grand`.
5. **"What is the 850 in the summary?"** (`14ef50a`) — ₱850 is the assembly cost per carcass, but
   the line beside it was wrong: `instUnitPrice` is derived as `instLaborCost / instUnits`
   (carcasses) yet was printed against `totU`, which in cutting-list mode sums **service**
   quantities — linear metres and holes. The line read *"2342.56 units × ₱3,563.25"*, implying
   **₱8,347,126.92** against a line actually charging **₱83,438.54** — ~100× overstated. **Display
   only**; `instBase` comes from `instLaborCost` and never touched `totU`, and the client printout
   does not carry the note. Carcass mode was never affected (there `getTotU()` already IS the
   carcass count). Stage 2 does not share the bug — checked, not assumed.
6. **Override needed several attempts, then landed late** (`2ebb90b`) — two faults.
   (a) `_ccfTargetSerial` and `_pendingOverrideNotifIdx` are sticky globals that were never cleared
   on cancel, and `fqOpenCustomCF()` cleared neither on the way in. A leftover target serial makes
   `_onOpen` false, so confirming an override on the quotation **on screen silently did nothing** —
   hence "twice or several times". Worse the other way: a leftover index marked **somebody else's
   request** approved with these rates and wrote them into that request's quotation. Same class as
   the 2026-07-29 fix one level up — that fixed *where the rates go*, this fixes *which request is
   being answered*. All cleared by one `_ccfClearRouting()`, called from `openCustomCF`,
   `fqOpenCustomCF` and a new `closeCustomCF()` wired to Cancel and the ×.
   (b) The requester waited for the 60 s poll, which **skips while the tab is hidden**. The poll
   body is extracted to `_pollApprovalsNow(force)` and now also runs on `visibilitychange` and when
   the notification bell opens. Background polling still skips while hidden — the force flag is
   what distinguishes an on-demand call.
7. **Save/Discard asked on every open** (`c4c906a`) — `confirmUnsavedThen()` treated a quotation as
   having unsaved work whenever `items[]` or `bomItems[]` was non-empty, but `initQuotation()`
   **seeds both with a default Kitchen Base Cabinet** — so a blank form always matched. It was
   testing whether the default scaffolding existed, not whether anyone had done anything. Now
   compares against `_pristineQuotSig`, a signature of meaningful content only (field values, area
   names, cabinet types/quantities, row counts) so lazily-created arrays cannot register as an
   edit. The risk is the opposite failure, so that was tested hardest: **all 13 kinds of edit still
   prompt**; untouched forms do not, including right after `renderItems()` and `recalc()`.

### Rommel's rule: a locked quotation must not change
8. **Locked quotations keep the price they were locked at** (`f3aeda0`) — *"do not change the
   locked and sent quotation unless the user interven or unlocked the quotation."* Freezing the
   rates (2026-08-04) stopped Settings moving a locked price but could not stop a recompute
   drifting for any other reason, and approve/share/close/cancel all re-save AFTER the client has
   the quotation. Each stage now records its total at lock (`qLockedTotal`/`fqLockedTotal`,
   `_captureLockedTotal()` at all five lock sites) and a save while that stage is locked writes the
   recorded figure. Stage 1 and Stage 2 pinned independently. **Unlocking clears `qLocked`/
   `fqLocked`, which releases the guard on its own** — no separate clearing path to fall out of
   step. Re-locking pins the new figure. Never silent: when the guard bites, the attempted figure
   and the difference go to the activity log. Quotations locked before this adopt the `pCalc` they
   were last saved with — precisely the number in the Quotations sheet.
   Verified with sheet writes captured: at lock 1,680 · drifted to 6,720 while locked → **writes
   1,680** + logs · after unlock → 6,720 · re-locked then drifted → 6,720 · old locked quotation
   adopts 1,680 and refuses 6,720 · Stage 2 locked writes 3,360 and refuses 16,783 · plain draft
   writes freely.

### Designers Support
9. **Reflect into the quotation you are working on** (`277e893`) — reflecting ALWAYS called
   `initQuotation()`, so it started a brand new quotation every time; that is the only reason it
   touched the serial, and why it cleared the client and reset Account Category to Direct. Rommel:
   *"it should just reflect it... However, I agree that it should be gated and asked."* It now asks.
   Choosing the open quotation leaves serial, client, project and Account Category alone — a CWLI
   job stays CWLI on its C serial — and the analysis lands as a **new area named after the file**,
   so nothing entered is removed (the first area is reused only while empty). The question is
   skipped when there is nothing to add to. **Also fixed the silent discard:** every other path
   that starts a fresh quotation goes through `confirmUnsavedThen`; reflect was the only one that
   did not, and wiped a quotation holding 6 wardrobes with no prompt.

### Price catalogue
10. **Hardware editable in Settings** (`9853db9`) — Settings → Price Database now carries an
    editable hardware catalogue (search, edit name/UOM/price, add, remove, then Save settings),
    the same shape as Services. **Deliberately NOT in the quotation** — Rommel: *"if you put it in
    the quotation, they will just keep adding unnecessary things."* Hardware only: Materials is
    153,552 rows and cannot be listed inline. Guarded — writes nothing unless edited, refuses an
    empty list rather than wiping 143 items, drops unnamed rows, and a background Price DB reload
    cannot clobber unsaved edits.
    **Two real bugs fixed alongside.** *"Import Hardware Excel"* was neither an append nor a clean
    replace: a PUT to `<tab>!A:C` only overwrites the cells the new values cover, so importing 6
    rows over 143 left rows 7–143 as the OLD data — two catalogues silently mixed — while Supabase
    (delete-all + insert) ended with 6, and since the app reads Supabase first every connected
    user's catalogue would have collapsed to 6 items while the Sheet still looked right. It now
    clears before writing, both buttons read **"Replace … from Excel"**, and both confirm.
    And `saveOutsourceToDB` appended to the **Sheet only**, so an item saved from an Outsource row
    looked saved, reloaded and came back missing — now writes both via a shared `_priceDbAddRow`.
    Checked first: 143 hardware rows, all with units and prices, Sheet and Supabase in agreement.

### Audit trail
11. **The change log was recording the previous quotation's contents** (`9c58f13`) —
    `_auditBaseline()` was **defined and never called**, so `_auditPrev` was set once per session
    and carried across quotations. Work on A, save; open B, save untouched, and the log recorded
    *"removed <all of A's lines> · added <all of B's lines>"* against B. The activity log is
    permanent and cannot be erased, so this was the worst possible place for it. Now baselined in
    both `initQuotation()` and `restoreFullQuotationState()`.
    **Two categories were never captured at all:** outsourced rows (`outsourceMaterials`/
    `outsourceHardware`), and **BOM cabinet contents** — only cabinet type and quantity were
    recorded, so changing materials/hardware/services INSIDE a cabinet, which is most of the work
    in BOM mode, was invisible. Now logged as *"Kitchen Base Cabinet › MDF 18mm qty 4 → 7"*.

### New feature
12. **Additional orders** (`9a624ca`) — Rommel: extra work asked for after everything is final is
    not covered, and adjusting a finalised Final Quotation *"will definitely create distortion,
    problem with the transparency and tracking."* The Project List now carries an **"Additional"**
    button on every issued quotation (not Draft — nothing to add to; not Cancelled — not live). It
    creates a SEPARATE quotation with its own serial, carries the client across, and records the
    link — on the quotation, on the printout as *"Additional order from: QT-XXXXXXXX"*, in the
    Project List and in the database. **The scope starts EMPTY on purpose:** this quotation is the
    additional work only, and copying the original's items would have production build everything
    twice. **Not a revision, deliberately:** a revision SUPERSEDES (same job, new version, `.R1`),
    an additional order ACCUMULATES (extra work, own serial, both stay live). The link reads both
    ways — opening the original shows *"N additional orders: QT-…"*.
    **Storage:** Quotations column X (A:W → A:X, all three headers and every range moved together),
    state JSON, `additional_from` on Supabase with a partial index.

### Sheet columns after this session
`Quotations!A:X` — 24 columns. New this session: **V = Job Source · W = Job Started ·
X = Additional From**. All three headers (save row, tab creation, `_syncQuotHeader`) are identical
and 24 wide; verified by test, along with the written row and all three directory readers.
> Fixed on the way: `_syncQuotHeader` built a **21**-entry header but read and wrote `A1:T1` — 20
> columns — so `Company` was never written and `cur.length < HDR.length` stayed permanently true,
> rewriting the header every session and never converging. The tab-creation header was also still
> 13 columns against 23-value rows.

### Method notes worth keeping
- **Reproduce before fixing, always.** Every one of these was demonstrated failing first — the
  ₱0 Stage 2, the 100× service-charge label, the cross-quotation audit entries, the Save/Discard
  prompt, the override that silently did nothing.
- **Test the fix's opposite risk hardest.** For the Save/Discard fix that meant proving all 13
  kinds of edit still prompt; for the locked-total guard, that a draft still saves freely; for the
  hardware catalogue, that it refuses to wipe 143 items.
- **Store `.slice()`, not the array**, when collecting results in a browser test — twice a result
  looked wrong because the harness held a live reference and showed the final contents.
- A stale page in the preview tab carries state between test blocks; `initQuotation()` first, or a
  reload, before asserting on "untouched form" behaviour.

---

## What was changed on 2026-08-05 (session 2 — UOM display bug, price discrepancy, approvals visibility, scoped discount)

Six commits, `0752904`..`724c0c9`, all deployed and confirmed serving. Every fix below was found
by RUNNING the code or by Rommel using the page — none by reading it. **Two of the three things
reported as bugs were not bugs; the machinery was sound and the app was failing to say so.**

### ⚠ The service UOM dropdown was showing "lm" for 33 of 61 services (`0752904`)
Reported as "why is the UOM different from PPIC" — Board Assembly read **₱150 /sq. m** in Cost
Breakdown and **lm** in the Services tab, for the same service. The database says `/sq. m`; the
Cost Breakdown was right.

**A `<select>` whose value matches no `<option>` does not render blank — the browser silently
falls back to the FIRST option.** `UNIT_OPTS` holds `lm` first and does not contain `/lm`, `/pc`,
`/sq. m` or `min. charge`, which is what **33 of the 61 live services** are priced in. Every one
displayed `lm`.

Not merely a wrong label — the dropdown was **armed**. `onchange` writes straight back to the
service, so anyone touching it, even to set what they believed it already was, converted `/sq. m`
to `lm`. ₱150 per square metre and ₱150 per linear metre are not the same price.

`_unitOptsHtml(sel)` now always includes the unit the service actually has, marked
`(as catalogued)`. Same trap fixed in the Designers Support reflect-summary dropdown.

> **Standing lesson — this is a whole bug CLASS, not one bug.** Any `<select>` built from a fixed
> option list but fed a value from data will silently show the wrong thing. It bit the client
> material Type field the same day (below). When replacing a fixed list under a select, either
> include the stored value as an option or use a free-text input.

**PPIC vs services, for the record:** they are different measures and cannot share a UOM. PPIC
capacity is `teamsPerDay × cabPerTeamDay` = **carcasses/day**, feeding installation only. A
service card's is `teams × shifts × output/shift` in **the service's own selling unit**. They
share only `workdaysPerMonth`. PPIC *does* have a UOM, but per **cabinet type**
(`ppicSettings.installation.typeUom`), not per service.

### Normalize units button (`c371538`) — BUILT, NOT YET RUN
Settings → Price Database, beside "Clean duplicates". Maps spelling variants to the canonical
form already in `UNIT_OPTS` and already in real use: `/lm`→`lm`, `/pc`→`piece`, `/sq. m`→`sqm`.
Previews every change and asks before writing; writes **both** the Sheet and Supabase in one
action, so it cannot leave the mirror stale. Logs what it changed.

`min. charge` (2 services) is **deliberately excluded** — it is not a spelling of a unit, it is a
pricing rule sitting in the unit column, and choosing a unit for it is a pricing decision.

**Rommel approved this but it has not been run.** Catalogue spread: `/lm` 24 · `lm` 14 · `hole` 7
· `piece` 5 · `/pc` 5 · `/sq. m` 2 · `min. charge` 2 · `carcass` 1 · `sqm` 1.

### Client-supplied material types expanded, and now free text (`a5d81e5`)
Was 4 types. Now 13, grouped raw board → melamine-laminated board → surfacing → edging: Raw Board
Plywood · Raw Board Marine Plywood · Raw Board MDF · Raw Board MDF-MR · Melamine Laminate MDF ·
Melamine Laminate MDF-MR · Melamine Laminate PB · Melamine Laminate PB-MR · PVC Board · HPL ·
HPL Postforming · Compact Laminate · Edgebanding.

**Made free text with those as suggestions, not a `<select>`** — Rommel asked for manual entry,
and it also sidesteps the fallback trap above: swapping the list under a select would have made
every quotation still holding `Raw Plywood` or `Melamine Laminated MDF/PB/Plywood` display a
DIFFERENT material and save it on the next touch.

Old values are deliberately **not remapped** — they sit on quotations already sent to clients. A
new row starts **blank** rather than defaulting to the first type; an empty field is visible, a
plausible-but-wrong default is not, and it prints onto the client's copy.

### ⚠ Service lines ignored the client-supplied uplift, so the price "changed" on preview (`09776ba`)
Reported as a price jump between the quotation page and the printout. **The printout was right.**
Every line differed by exactly ×1.20 — the client-supplied materials multiplier.

The panel was contradicting **itself**: rows read 1,954.10 + 2,093.55 = 4,047.65 while the
subtotal directly beneath them said 4,857.17. `getAreaSubtotal` and the printout applied the
uplift; only the form's own rows did not.

**A second, worse bug in the same place, probably never yet hit in production:** the live patch
that runs while typing read `SERVICES[svcIdx].price`, not `_svcEffectivePrice(si)` — so it ignored
a typed unit price as well as the uplift. Override a rate to 99 on qty 118.43 and the row showed
**1,954.10 for a line billing 14,069.48**.

Four places computed the same figure and three disagreed. Now one definition —
**`_svcUnitPrice(si)` / `_svcLineTotal(si)`** — used by the form row, the live patch and the
printout. Unit price still shows the BASE rate (it is what the user edits); the Services header
states the uplift instead.

### Approvals: no way in, and a badge that went dark exactly when it mattered (`f46dd82`)
Reported as "the counter-offer did not reflect on the quotation" **and** "the discount is not
shown in the printout". Both were the same cause, and nothing was broken: **a counter-offer is an
OFFER — the discount only exists once the requester accepts it.**

Full trail on QT-M00000102: 5% requested 06:33 → countered at 3% 07:19 → requester messaged →
**message READ 07:24** → nothing. Four reasons, all fixed:

1. **THERE WAS NO APPROVALS NAV TAB.** The only ways in were the bell dropdown and a pop-up that
   is gone once dismissed. Now a nav tab, gated on the existing `Approvals` access key.
2. **THE BADGE COUNTED `pending` ONLY.** The moment an approver counters, the request leaves
   pending — so **the requester's badge dropped to ZERO at the exact moment the ball moved to
   them.** `_apprNeedsMyAction(n)` now counts pending (unchanged) **plus a counter on your own
   request**. Five hand-rolled copies of that badge existed, each with its own rule and the
   counter case missing from all five; now one definition, `_updateNotifBadge()`.
3. **The message stated the outcome and stopped** — now says it is NOT applied, names the button
   and the tab, and is sent **urgent**.
4. **The approver could not see it was with them** — the card now reads "waiting for `<name>` to
   accept or decline" to the approver, "press Accept 3% counter below" to the requester.

**Lami announces it too** (Rommel's idea) — she already announced new requests to approvers, but
the requester got only a toast. She now speaks the outcome, and for a counter says the part that
matters: nothing is applied until they accept.

### Discount can be limited to parts of the job (`9f743ae`)
Five tickboxes: **Materials · Edgeband · Hardware · Services · Installation**.

**Nothing ticked = the whole quotation, running the exact previous arithmetic.** Scoping engages
only once a box is ticked, so no saved quotation moves.

**Edgeband is the edge TAPE MATERIAL** (Rommel's decision), not the edgebanding labour, which
stays under Services. Carved OUT of Materials so ticking both cannot discount it twice —
`_isEdgeTapeName()` matches the catalogue's own wording.

**Not offered in carcass mode** (Rommel's decision) — one price covers a whole cabinet there and
any split would be invented. The card hides itself and ticks made in another mode are ignored.

The discount comes off the chosen buckets **after** they have been carried up the same markup
chain as the rest of the price. **Changing the scope invalidates an approval already given**,
exactly as changing the percentage does. Stated in all three places: the approver's request
("Discount of 10% on materials and services only requested"), the printout ("Discount (10% on
materials and services only)"), and the form. Landed in **both** stages.

Verified the parts reconcile: the four fabrication buckets discounted separately add to exactly
the whole-quotation discount (340.00 = 100+50+40+150). Mobilization, design charge and site visit
are outside the five buckets by design — Rommel declined adding them.

### Choose which services the client-supplied uplift applies to (`724c0c9`)
The ×1.20 hit every service. Now a tickbox per service, in the Client-supplied materials card
next to the multiplier, listing only the services actually in that quotation, with All/None.

**EXCLUSIONS are stored, not inclusions** (`qClientMatSvcExcl`, keyed by lowercased service
name). An empty list = every service uplifted = the previous behaviour, and a service added later
is uplifted **automatically** rather than quietly escaping because nobody ticked it —
under-charging in silence is the failure that matters. Name-keyed, so it holds across areas and
in BOM mode, whose service rows carry a name rather than a catalogue index.

Five call sites moved off the blanket multiplier to `clientMatMultFor()`: shared per-line price,
BOM item cost, area subtotal, discount buckets, fabrication margin recognition. The four
now-dead blanket-multiplier variables were removed so nobody reuses one by accident.

Three places stopped overclaiming: the card ("all services are multiplied"), the badge ("uplift
applied" regardless — now "on 1 of 2 services", or says plainly that none carry it), and the
Settings help text.

### New globals (2026-08-05 session 2)
```javascript
qDiscScope          // {materials,edgeband,hardware,services,installation} — all false = whole quotation
DISC_SCOPE_KEYS     // iteration order for the five buckets
qClientMatSvcExcl   // {serviceNameLower:true} — services the client-supplied uplift does NOT apply to
```

### New functions (2026-08-05 session 2)
```javascript
_unitOptsHtml(sel)              // unit dropdown that shows a non-standard stored value instead of falling back to "lm"
normalizeServiceUnits()         // Price DB: /lm→lm, /pc→piece, /sq. m→sqm; previews, confirms, writes Sheet+Supabase
_canonServiceUnit(u)            // the spelling map (min. charge deliberately absent)
_svcUnitPrice(si)/_svcLineTotal(si) // the ONE definition of what a service line bills
_apprNeedsMyAction(n)           // pending, plus a counter-offer on your own request
_discScopeOn()/_discScopeLabel()/_discRawBases()/_isEdgeTapeName(nm)
onDiscScopeChange(k,on)/renderDiscScope()
clientMatMultFor(nameOrItem)    // per-service client-supplied uplift
_svcNameOf(si)/_svcKey(nm)/_quotedServiceNames()
onClientMatSvcToggle(nm,on)/_clientMatSvcAll(on)/_clientMatSvcPickerHtml()
```

### Method notes worth keeping
- **Two of three reported "bugs" were not bugs.** The counter-offer and the missing printout
  discount were one working feature that could not be seen. Diagnose before fixing: the whole
  approval trail was reconstructible from the database in three queries.
- **A `<select>` fed a value outside its option list is a silent-loss generator.** Two separate
  instances in one day.
- **When a figure looks wrong, check whether the panel contradicts itself first.** The service
  lines not summing to their own subtotal pointed straight at the cause.
- `innerText` returns **nothing** for a hidden page — a badge check "failed" purely because the
  quotation page was not the active one. Assert on `innerHTML` when the page may be hidden.
- Node heredocs choke on `'`-quoted JS containing `\'` — use the Edit tool for those, not a patch
  script.

---

## What was changed on 2026-08-06 (session 3 — signatures, subsidiary billing, minimum charges)

Fourteen commits, `9c5c5bf`..`ed75a93`. Every fix below was found by RUNNING the code or by Rommel
using the page. **Three separate features were built to a rule Rommel stated and then corrected
mid-build — the corrections are recorded because in each case the first reading was wrong.**

### Checked by / Noted by signature flow (`15d9c5e`, `9c5c5bf`, `adf9eb5`, `dc6b8d4`, `c928e07`, `94d8812`)
Built on the existing approval machinery — same routing table, same PIN gate, same request/notify
path. Lock → **Request signature** → Checked by → PIN → (above the company threshold) → Noted by.

- **Signatories are assigned in Settings → Approval Routing**, and are open to **any active user**,
  not just Manager/Director/Admin. Rommel: *"since we did not define any seniority, keep the list
  open to other users."* The other approval rows stay restricted — those are authority decisions;
  signing is an attestation.
- **Noted-by threshold is PER COMPANY and measured BEFORE VAT** (*"the basis would be the total
  project cost before vat"*). Blank means always required — a missing threshold must never quietly
  skip a sign-off.
- **Unlocking clears both signatures**, and so does **any Stage 2 change that moves the cost**.
  `qSigBaseTotal` records the figure the signatures were given against and `recalcFQ` clears them
  when it moves. Watching the TOTAL rather than individual cards is what makes it complete — a card
  added later is covered automatically, because it can only matter by changing that number. An edit
  that leaves the cost alone (renaming an area) does NOT force a re-signing.
- **Sending is warned, never blocked.**
- The signature indicator lives in the quotation header beside the serial and status pills, not
  buried above the form — Rommel had to ask twice where it was.

**Four bugs found while building it, all fixed:**
1. The Request button was **dead exactly when it was needed** — it only appears once locked, and
   `updateLockUI` disables every button inside `#s1-wrap` on lock unless it carries
   `data-lock-exempt`. It also worked on the pass that created it and died on the next refresh,
   which is how a fault gets reported as "sometimes it is not there".
2. `renderSignatureBar` was hooked into `_updateLockGate`, which **`updateLockUI` does not call** —
   so the bar never refreshed on lock. Now called at the end of `updateLockUI` itself.
3. `_findSignatory` looks up the **quotation's** company, not the user's. `findApproverForAction`
   keys on `currentUserCompany` — right for other approvals, but it would let a Subsidiary
   quotation take its threshold from one company and its signatory from another.
4. `confirmSignature` now **re-checks the signer and that the request is still pending**.
   `openSignatureAction` sets the target index BEFORE validating, so anything reaching confirm
   directly would have signed a request belonging to someone else.

**PINs, as a consequence of opening the signatory list:**
- **"Require own PIN"** per user (Settings → Users, col **AA**, `users.require_pin`). Ticking it
  refuses the shared `1234` for that person.
- **Mandatory for Manager/Director/Admin** — Rommel: *"why is the tick expanded for those manager,
  admin and director position? They have a pin capability already."* Their card now states it
  rather than offering a switch. **Five of the six had no PIN**; Rommel confirmed knowing that,
  since the app link had not gone out.
- **A deadlock fixed:** "Set / Change PIN" was gated on `isApprover()`, so a Staff signatory could
  never set the PIN their own signature required. Available to everyone now.
- **Reset PIN and the PIN badge** were Manager/Director/Admin only — a Staff signatory was
  unresettable and their PIN state invisible. Shown for every user.
- **A prompt at every login** until a required PIN is set. Deliberately not dismissible-once:
  someone in that state cannot approve or sign at all.

### Materials & hardware billing by account (`e36cc31`)
Rommel's rule, stated then corrected twice:
| | Materials | Hardware | Services |
|---|---|---|---|
| **Direct** (any quoting company) | in | in | in |
| **Subsidiary WCLI** | **out** | **out** | in |
| **Subsidiary CWLI** | in | in | in |

Defaults, not rules — a **"Charge materials & hardware"** toggle overrides either way, shown only
on Subsidiary quotations. `qChargeMatHw` is `null` while untouched (meaning "follow the default",
so changing a default later still reaches old quotations) and stores an explicit true/false once
toggled.

**Applied to all three fabrication modes**, which was most of the work — only cutting-list had any
rule, and it was wrong both ways: gated on `isDirectClient()` so **CWLI was wrongly excluded**, and
it **dropped hardware**, which stays in.

**Carcass became possible because the data made it so:** the carcass price IS the cabinet
template's own build-up — verified equal for **12 of the 13 types** — so the real material and
hardware values are subtracted rather than a share estimated. A type with no template keeps its
full price rather than guessing.

⚠ **Large effect on carcass.** Kitchen Base is materials ₱4,147 + hardware ₱956 of a ₱6,237 price,
so **~82% comes out** for a WCLI carcass quotation. **11 existing Subsidiary quotations** (4 BOM,
7 carcass) were charging materials they should not have been.

**Pre-existing bug fixed on the way:** `INIT_TEMPLATES` rows are raw arrays
`[cabinet, category, name, unit, qty, price]` while the Price DB gives objects — any lookup written
for one silently finds nothing in the other.

### Minimum charge per service family (`a4ac3fb`, `f5fc164`, `ed75a93`)
Rommel: *"Apply the minimum charge if the service cost will not reach the minimum amount
specified... when sum up... the total of two services will become 1000."*

The `(minimum charge)` rows existed but **nothing enforced them** — a ₱165 cutting line went out at
₱165. The floor is now **per family, summed across the whole quotation, each family independent**.

A family is defined by the catalogue row itself: its price is the floor, and the words left after
removing "(minimum charge)" are what a service must contain to belong. **Nothing hardcoded** — add
such a row for any service and it works. **Most specific wins**, so Edgebanding EVA Transparent
answers to its own floor rather than the plain EVA one. A minimum row never counts toward its own
floor; a family with no work is untouched (a floor applies to work done, it is not a standing fee).

Applied at quotation level (not inside `getAreaSubtotal`, which runs per area), in **both stages**,
and skipped when Stage 2 is priced off a single typed cutting-list figure.

**Each top-up is its own visible amber line** naming the family, what was quoted and the floor it
was raised to. Verified against Rommel's own example: cutting 165 + 100 = 265 → 500; adding
edgebanding 102 makes the two families **exactly 1,000**.

**A real false positive found by checking the live catalogue:** **"Cutting List Preparation"**
(₱500/carcass) contains the word Cutting, so it joined the cutting family — and at ₱500 satisfied
the floor **entirely on its own**, meaning genuine cutting work got no top-up. The rule silently not
firing. Rommel: *"literally a different work and should not be included."*

Fixed generally rather than as a special case: the minimum-charge card in Cost Breakdown now
**lists every service under each floor**, states the words that decide membership, and each member
has an **×** to exclude it (restorable). Excluded services are listed struck through under "counted
as different work" rather than vanishing — an exclusion that looks like a failed match is its own
trap. `MIN_CHARGE_EXCL` ships with Cutting List Preparation excluded and is saved with settings.

**Still open on this:** "Handgrab Groove" and "Flush Handle Groove" fall under NO minimum — they
say *groove*, not *grooving*. If they should count toward the ₱400, renaming them is cleaner than
loosening the matching.

### A renumber left its old Project List row behind (`e3eeb88`)
Different bug from the morning's, same family. That one stopped quotations being FILED under the
number they were first previewed as. This is the leftover **list row**: changing the client's
company claims a new serial, but the row under the old number was never removed — so one job showed
as two lines, the live one and an abandoned shell frozen at its pre-change value.

Confirmed on FOR SIMULATION: `QT-W00000061` (Draft, ₱1,297.30 as Subsidiary) beside `QT-M00000105`
(Initial Quotation, ₱3,758.83 as Direct), **one minute apart**, the second recording the first in
`prevSerials`. Two quotations affected.

`_cleanupPrevSerialRows` runs **after the new row saves, never at the moment of renumber** —
deleting first and then failing to save would leave the quotation with no row at all, invisible in
the Project List. `qPrevSerials` is deliberately NOT cleared; it is what the "(was …)" note reads.

### Lami taught this session's work (`483ed3c`)
Her manual mentioned none of it. Added the Approvals tab and **the counter-offer rule that
generates support questions** (nothing changes until the REQUESTER accepts), the signature flow,
PIN rules, discount scope, per-service uplift, project size and additional orders.

**She was actively teaching something wrong:** the guide said client-supplied materials *"excludes
materials from cost"* — untrue since 2026-07-16. Corrected. Her manual is hand-maintained and goes
stale silently; check it whenever a feature ships.

### Why the drafts pile up (investigated, no code)
58 drafts, and it is **not** the Share button. **Draft simply means never locked** — sharing does
not change it. **35 of the 58 are the pre-12-July test pile**; clearing those leaves 23 real
work-in-progress. Also worth knowing: **42 rows labelled "Locked" and 13 "Approved" are legacy
status names** that display as Initial/Final Quotation, so the live pipeline is healthier than the
raw count suggests.

### Method notes worth keeping
- **Rommel corrected the rule mid-build three times** (hardware in/out for WCLI, CWLI charged or
  not, which services a minimum covers). Playing the rule back as a table before building caught
  each one; building straight from the first statement would have shipped three wrong features.
- **Check a naming-based rule against the real catalogue before shipping it.** The Cutting List
  Preparation false positive was invisible in principle and obvious in one query.
- **A rule that silently does not fire is worse than one that fires wrongly** — both minimum-charge
  problems were of that shape.
- Inline handlers live inside single-quoted JS string literals: **any `'` in them truncates the
  handler**. Hit again this session with `typeof x==='function'` inside an `onchange`.

---

## What was changed on 2026-08-06/07 (session — one definition of a win, status rename, dashboard grid, orders search, running total)

Eleven commits, `3795278`..`db2d9d7`. Everything below was found by RUNNING the code or by Rommel
using the page — none of it by reading.

### THE definition of a win — client approval of the FINAL QUOTATION (commit `1d518af`)
Rommel: *"Win is the final approval of client in the final quotation. no argument to that. there's
no win before that. and this should reflect in the dashboard or any report."*

**Three different definitions were live at once**, on the same page:
| Where | Counted as won |
|---|---|
| Dashboard "Conversion rate" | `finalLockedAt` — US locking Stage 2. A quotation sent and never answered counted. |
| Team performance Won/Rate | a recorded approval at either stage, **OR** anything that had merely reached "In Final Quotation" |
| Reports win rate | the status LABEL, counting `Closed` too |

All three now call **`_isClientApprovedEntry`**, which requires a recorded client sign-off on the
Final Quotation. Stage 1 approval and the status-rank inference no longer count. The
`'Client Approved'` label IS accepted, because `_computeQuotationStatus` produces it from
`fqClientApproved` alone — that is the recorded fact, not a guess about it.

**Root cause fixed alongside — the approval never reached the data.** `confirmClientApprove()`
sets `fqClientApproved`/`fqClientApprovedAt`, but the row written to the Quotations sheet wrote the
**Stage 1** variable (`qClientApprovedAt`), so column Y stayed empty: **0 of 160 rows carried a date
while 3 states carried `fqClientApproved:true`**. The row and `sessionQuotations` now write the
Stage 2 values; column Y is relabelled **Final Client Approved** in all three header definitions.

**Effect on live data:** wins 21 → 3, rate 13.1% → 1.9%, revenue ₱3,730,777.78 → ₱35,369.59. Not a
regression — the old figure was inference standing in for a fact nobody recorded. **The team has
clicked Client Approved on a Final Quotation three times.** The number stays near zero until that
becomes habit; the fix makes it capturable, not retroactive.

### Status rung renamed → "Approved Initial Quotation" (commits `b7ff116`, `31f711f`)
Rommel spotted `Final | Approved` and asked why something says *approved final* while the stage says
initial. It never did — the bare legacy word `Approved` only ever meant the INITIAL quotation was
approved; it just did not say *what* was approved. Ladder now reads:

`Draft → Initial Quotation → Approved Initial Quotation → Awaiting Client Approval → Client Approved → Closed`

Both legacy spellings (`Approved`, `In Final Quotation`) map to it, so the 14 stored rows carrying an
old string display and filter correctly with no re-save. Kept as keys in the pill-colour, rank and
ageing maps too.

**Stage vs Status, settled:** Status is what happened to the job (derived, rewritten every save);
**Stage is just which tab was open when it was last saved** (`qStage===2?'Final':'Initial'`). Stage
is not a business fact and can lag. Verified: 14 rows sit at `Initial | Approved Initial Quotation`
and are *correct*; 4 rows at `Final | Approved` are wrong — and there **the STATUS is the stale
one**, not the Stage (those are 4 of the 9 legacy quotations missing `fqLocked`).

Project List: Status column default width **90px → 180px** (the widest label measures 153px + 24px
padding and cells are nowrap+ellipsis, so it clipped); the resize handle existed on every column but
was 6px and invisible until hover — now 9px with a visible divider.

**Also fixed:** the Lami KPI briefing read `kpi.byStatus.Locked` and `.Approved`, neither of which is
a key in `byStatus`, so managers were told **"Locked=undefined, Approved=undefined"**.

### Dashboard — customisable widget grid + 11 new KPIs (commits `2a7d6aa`, `c6ecbc8`, `ab9dd18`)
Prototype first (`dashboard_redesign.html`, `DASHBOARD_REDESIGN.md`, commit `3795278`) — standalone,
`index.html` untouched. **React-Grid-Layout / Recharts / Framer Motion were rejected**: this is one
32,000-line file with no build step, so they would mean a bundler and a rewrite. Everything asked for
is ~380 lines of plain JS.

Then into the app. **Not a rewrite:** every pre-existing card lives in a hidden `#dash-stock` and is
**MOVED** into the grid, never rebuilt — so each id keeps its identity and `_dashUpdateKPIs`,
`renderDashFollowed`, `_renderClaudeApiCard`, the `dash-chart` canvas and the team `<select>` all
needed no change. A removed widget parks back in stock; verified the revenue chart's canvas survives
a remove/add cycle.

- 12-column dense grid, unit = 3 cols × 108px; drag by the handle, corner-drag to resize (snaps
  3/6/9/12 × 1–4), **Tidy up** re-packs largest-first, **Add widget** from a catalogue of 24.
- New widgets from `_dashMetrics()` — computed once per render off dirData + sessionQuotations +
  pendingOrders, **no per-quotation state fetches**: open pipeline, won revenue, average deal size,
  value by company, top clients, quotation funnel, quotation ageing, revisions & additions, awaiting
  client approval, orders past SLA, data to fix.
- **Per-card visualisation switcher** (`c6ecbc8`): gear → bar / donut / ranked list / funnel, saved
  with the layout. Five widgets carry a series and support it; single-figure cards get no gear.
- Access unchanged in spirit, stricter in reach: an Admin/Manager DASHALLOW restriction can now
  target **any** widget individually, and old rows keyed on a legacy group name still apply.

**Three bugs prevented, not shipped:**
1. the pref loader coerced every key with `!!`, which would have turned the saved layout array into
   `true` and silently reset everyone's dashboard on each login (`_applyDashPref` skips it now);
2. the old `dashToggleWidget` was defined **after** the new one and would have silently overridden
   it (removed; the "My widgets" tab is now the library);
3. the resize maths assumed 12 columns, but the grid drops to 6 below 900px — the Google Sites embed
   — where it went negative; it now reads the grid's real geometry and declines with a message.

`'Conversion rate'` relabelled **'Win rate'**. `'Unsigned quotations'` was **dropped rather than
faked** — signatures live only in each quotation's state JSON.

**Customize regression, caught by Rommel and fixed (`ab9dd18`):** the new edit mode buried the widget
list and the per-user restrictions behind a second click on "Add widget". Nothing was lost — but he
could not find restrictions he already had. Customize opens the panel immediately again.

### Orders — search the queue (commit `089f4a0`)
One box over: entry number, client, company, contact, both emails, agent, project, address, notes,
service, substrate, request type, channel, linked quotation serial, segment, lead source, source
company. **Codes count as much as names** (`8724`, `M00000090`), words match in any order.
**Tab counts follow the search**, so searching from the wrong tab shows where the order actually is
instead of an unexplained empty list.

### Quotation — running total pinned (commit `db2d9d7`)
Stage 1 measures **2,903px** tall (it has grown ~850px since it was last measured), so the grand total
sat ~2,900px down. Offered three sizes; **Rommel chose the smallest deliberately — bar only, nothing
moved, no width change.**

The bar's buttons are **MIRRORS**: each clones the real toolbar button's label, icon and disabled
state and clicks the original, so the project-size gate, locked state, view-only mode and pending
badge all still come from one place. It also states VAT treatment, discount and scope, minimum
charge, and frozen-rates — previously only findable by scrolling to the summary.

Two bugs fixed in testing: the refresh was hooked **before** the `_pCalc` assignment so the bar showed
the PREVIOUS recalculation; and a fixed 74px reserve against a 100px bar hid the last card (now set
from the bar's real height).

### Rommel's test file, and a general gap
`QT-W00000026` (Zhiel Ashton Taligatos, ₱23,866.15) was his test file counting as a win. He removed it
— **from the Google Sheet only**, leaving a Supabase row untouched since 2 August. Deleted directly
(state row cascaded). **`gLoadDirData` reads `Quotations!A:Y` from the SHEET**, never Supabase, so the
Project List and every dashboard KPI are Sheet-backed — meaning the orphan was never affecting his
figures, only my SQL. **General gap: any quotation deleted from the Sheet while not Supabase-connected
leaves an unreachable stale row.**

### Estimates measured, not guessed (for the roadmap)
- **Mobile approvals app** — the blocker is extracting the pricing engine. Measured: `_recalcCore`
  399 lines + `_recalcFQCore` 284 + ~550 of helpers, but only **~47 DOM reads total**, and the worst
  helpers are tiny (`isDirectClient` 2 lines, `getCompanyName` 10). The maths already runs off globals,
  which is what a saved state restores. **≈4–5 sessions** for the full PWA with push (push on iPhone
  requires the app be installed — Safari 16.4+).
- **BUT remote approval already works** — the app is a URL. Measured at 375px: the Approvals page
  **does not overflow**; the topbar is **1473px wide** and scrolls sideways; buttons are 28–35px,
  under the 44px tap minimum. **≈1 session** to collapse the nav, size the buttons, and put the
  figures into the Chat/email notification. Rommel's actual point was remote approval, so this is the
  route to take first.
- **Website cutting list into Modcraft** (Rommel's request) — goes in as a Designers Support tab and
  feeds the existing `_cutListToAnalysis` → `prodLoadStructuredList` bridge, so no new plumbing; it
  also fixes the stand-in-SKU item for free because the real catalogue is already in memory.
  **≈1–1.5 sessions.**
  > ⚠ **`cutlist-template.html` defines `function recalc()` — Modcraft's `recalc()` IS the quotation
  > pricing engine.** A naive paste would silently override it and break pricing app-wide (same class
  > as the `dashToggleWidget` bug above). `var SERVICES` collides too — that is the live service
  > catalogue. **The port must be namespaced.**

### Method notes worth keeping
- **Two of three "bugs" Rommel reported were not bugs** — the counter-offer flow and the missing
  Customize panel were both working and merely unreachable. Diagnose before fixing.
- **A name defined later wins.** Twice this session a new function would have been silently
  overridden (or would have overridden) an existing one. Check for collisions before porting anything.
- **Measure the mechanism before estimating.** The mobile-app estimate fell from 4–5 sessions to 1
  once the actual DOM coupling and the actual phone rendering were measured.
- **I re-raised a parked item after being asked to drop it**, and Rommel said it distorted his
  understanding. When something is parked, leave it parked.

---

## What was changed on 2026-08-07 (session 2 — site-visit-only, quotation layout)

Two commits after the handoff above: `900cf0f`, `8aadebd`. Both found by Rommel or his users
on the real app.

### A site-visit-only request is charged at cost (`900cf0f`)
A user reported a **₱1,500 site visit producing a ₱2,788.50 subtotal**, with nothing on screen
to explain the gap.

**Cause.** The Site visit card's *Charge under: Mobilization* folds the fee into `mobBase`, where
it picks up mobilization contingency × buffer × markup — **×1.86** at these rates. The summary
printed the raw ₱1,500, and the admin row that would have explained it (*"Site visit in mob"*) is
gated on `(ni||na)`, both false on a visit-only job. So the uplift was invisible — and the client's
printout showed **neither** a site-visit nor a mobilization line, because `_pCalc.svCost` is 0 when
charged under mob and there is no mobilization line without installation.

Rommel: *"if site visit only is the requirement no other cost should be added such as mobilization
additional markup etc... only vat in accordance to our established company rule."*

**Fix.** A tick — **"Site visit only request"** — rather than inferring it from an empty scope,
because a design charge may legitimately ride along. When ticked the visit is treated as its own
line, so it never enters `mobBase`; *Charge under* greys out with the reason stated, so nobody can
set Mobilization out of habit and re-inflate it; and the empty *Fabrication ₱0.00* row is dropped.
Applied to **both** stages.

**Deliberately narrow.** Fabrication-only and fab+installation are untouched. An earlier draft
extended the rule to fabrication-only, which Rommel had not asked for and which would have changed
live pricing — he pulled it back, correctly.

VAT needed no work: `_vatDefaultForType` already gives Direct 12% inclusive, Subsidiary exclusive.

Verified: tick off → ₱2,789.33 / ₱3,124.04 unchanged; tick on → **₱1,500 + ₱180 = ₱1,680** Direct,
**₱1,500** flat Subsidiary; the tick beats *Charge under* both ways; a design charge rides along at
cost (₱1,800 exactly); Stage 1 and Stage 2 agree; the tick persists; a normal fab+installation
quotation still prices differently under Mobilization vs Separate line.

### Quotation page — two steps, two columns (`8aadebd`)
Measured first: Stage 1 was **2,903px** in a fixed **800px** column on 1440px screens. Client
information alone was **701px** filled once and never read again; five cards were a 40px toggle
each taking a full-width row.

- **Step 1 = client. Step 2 = the quotation**, in two columns above 1180px. Work on the left
  (scope, mobilization, installation, pricing, summary); set-once and reference cards on the right
  (contingency, project size, the charge toggles, bond, other cost, scheduling, activity log).
- Below 1180px the rail falls underneath in the same order — **no separate phone design needed**,
  which is what made this cheap. Rommel's own scoping: *"the approval is what I think is needed
  when it comes to phone"*, so the quotation page only has to not break at narrow widths.
- The step bar carries the client forward, so step 2 never leaves you wondering who you are pricing.
- Cards are **MOVED**, never rebuilt — same approach as the dashboard grid, so every id and handler
  survives. Anything not named stays in the main column, so a card added later lands sensibly.

**Result: step 1 = 772px, step 2 = 1,213px** (main 1,142 / rail 1,084), against 2,903px. Nothing
inside the quotation page overflows at any width.

> ⚠ **Two ids landed on the WRONG cards** while doing this — `activity-card` went onto the
> Scheduling card, and `sched-card` onto **Stage 2's** JS-built scheduling card, which would have
> let Stage 2's card be dragged into Stage 1's rail. Caught only by checking each id against its
> own card title. Stage 2's is now `fq-sched-card`. **This is precisely what the queued collision
> checker is for** — a mislabelled id throws nothing and surfaces only when something quietly
> appears in the wrong place.

### Method notes
- **Rommel corrected an over-reach.** Told "site visit only", I generalised to fabrication-only as
  well. He pulled it back: *"I didn't say that it should be removed to other cost we already
  establish."* Implement the rule given, not the rule inferred.
- **My own test rigs were wrong three times this session** — measuring mid-CSS-transition, measuring
  a container that stretches to fit the thing it should constrain, and setting a container width
  expecting a viewport media query to fire. Each produced a confident, wrong number. When a
  measurement surprises you, suspect the rig before the code.
- **Mockups earn their keep.** The A+B mockup proved option B (merging the five toggles) made the
  page *longer*, not shorter — the opposite of what I had told him.

## What was changed on 2026-08-08 (session — deploy unblocked, collision checker, remote approval, cutting-list tab, theme, Wufoo attachments)

Eight commits, `d049bb6`..`c065ebd`. Everything below was found by RUNNING the code, by querying
live data, or by Rommel using the page.

### The deploy was not the GitHub outage
Six consecutive runs looked cancelled. The real cause: **one run stuck in `waiting` since the day
before**, holding the `pages` concurrency slot. `concurrency: group: pages, cancel-in-progress:
false` lets one run hold and one queue — so every new push queued behind the stuck one and was
cancelled by the next. **Each "retrigger" made it worse**, taking the previous queue slot. Cancelling
the stuck run released everything in under a minute.

> If a deploy stalls again, look for a non-completed OLDER run before pushing anything:
> `curl -s "https://api.github.com/repos/rotaligatos/modcraft-app/actions/runs?per_page=8"` and check
> for `status: waiting`. An empty commit is the wrong move.

### Collision checker + pre-commit hook (`d049bb6`, `4e0d0b0`)
`tools/check-collisions.mjs` reports duplicate top-level function names, duplicate top-level vars,
duplicate element ids, and any `<script>` that does not parse — all silent in the browser, all of
which have already bitten this app. Wired as `.githooks/pre-commit` via `core.hooksPath`, checking
the STAGED content. `.gitattributes` pins the hook to LF or a fresh clone gets `bad interpreter:
/bin/sh^M` and the check silently disables itself.

Ids are read from the static markup AND from JS string literals, because the 2026-08-07 wrong-card
bug was a JS-built card carrying an id the markup already had — a markup-only scan misses it. An id
emitted from two places in JS is reported but does not fail (a create-if-missing guard is a real
reason for it; the two in the file today are both that).

Declarations are matched at column 0, which is this file's real style: all 1339 top-level functions
sit there and every indented one is a nested local. Comments and string/template literals are masked
first.

> **The masker was silently dropping half the declarations.** `Array.from()` splits by code POINT but
> `src[i]` indexes by UTF-16 UNIT, and index.html holds 98 emoji — so the mask drifted 98 characters
> and hid ~660 declarations. Caught only by cross-checking the count against `grep`. Use `split('')`.

`tools/check-collisions.test.mjs` covers both directions — 7 faults it must catch (including the
`dashToggleWidget` and `users-wrap` bugs) and 7 it must NOT flag. Proven to block a real commit by
shadowing `recalc` in index.html.

### Remote approval — the cheap route (`e41a5d4`)
Measured at 375px first: **the Approvals page does not overflow; the topbar does.** Its nav group
(brand + 12 tabs, all nowrap) has a min-content width of 1206px, needing ~1466px to lay out, so the
document was dragged to 1472px and every page panned sideways.

The nav group now scrolls on its own axis. **That rule starts at 1500px, not at phone widths, because
a 1280 laptop overflowed too** — same defect, same fix, and it costs nothing visually (on a wide
screen the strip does not scroll at all). Below 900px the brand, role pill and fullscreen button go
as well, roughly doubling the visible nav; messages, notifications and the avatar stay. Tap targets
on the approval path were 28-35px against the 44px minimum.

`navigate()` now brings the active tab into view. It scrolls with **`behavior:'auto'`, not
`'smooth'`** — smooth is suppressed in ordinary situations (reduced-motion among them) and when it is,
the scroll simply does not happen and nothing is raised. Measured: smooth left scrollLeft at 0, auto
moved it to the intended 666.

The approval notification now carries the figures — total, what it becomes if approved, the
reduction, and the discount scope. **The resulting total is not re-derived**: it comes from applying
the requested value, running the quotation's own recalc, reading `_pCalc` and restoring, the same
apply/read/restore `_ccfUpdateProfitNow` uses.

> **Margin is included only when the requester could already see it.** `gSendMessage` puts one string
> into the Sheets row, the Supabase row, the email AND the Chat post, and `gLoadMessages` returns rows
> where you are the SENDER as well as the recipient — so composing it would otherwise hand an Encoder
> the profit figure `canViewCostReport()` denies them.

### Cutting List tab in Designers Support (`1f2bb29`)
A website order carrying a cutting list already dropped into Designers Support; a client who emails
or walks in with one had no way in, because every other entry point calls Claude and paying an
extraction pass to read an exact list can only add error.

This is the website's form brought here, producing the SAME `cl` object `_cutListToAnalysis` already
consumes — one conversion, not two. **IIFE-wrapped deliberately**: the source file declares
`function recalc()` and `var SERVICES` at top level, which in this app are the pricing engine and the
live service catalogue. Only the `MCL` namespace reaches global scope; both were verified intact.

Two things are better here than on the website, because the catalogue is in memory: materials come
from live SKUs through the same bounded search the quotation uses (so they arrive resolved rather
than in the fuzzy matcher), and services are offered by their real catalogue names — which name the
three grooving prices separately and carry the boring diameter and type. **The same list that flags
twice from the website now flags nothing.** Boring also gets a hole count on the chip, since
`prodComputeServices` drops a service at qty 0 — a count-less boring line does not arrive vague, it
disappears.

The summary states where the list came from, and `cl.totals` is deliberately unset for a typed list:
those totals would be computed in the same browser from the same rows, so comparing them is circular.
The panels-vs-components check still runs, and that is the one that catches a row lost in conversion.

> Found on the way: **hardware was being dropped in full, silently.** The converter reads
> `{item, qty, unit, notes}` and this was emitting `{name, note}`, so every line was skipped without a
> word — caught only by counting what came out the far end.

### A new quotation starts at nothing (`b6e0749`)
`initQuotation` seeded a Kitchen Base Cabinet at qty 1, so an untouched quotation was already worth
₱7,275.35. Always true; the total just sat ~2,900px down where nobody saw it, and pinning the running
total made it visible. Seeded at qty 0 now, and the same for `addArea`, which was quietly adding
another ₱7,275 to a quotation already being worked on. The row added by an explicit "+ Add item"
click keeps qty 1 — that one was asked for.

Also: the running total said "minimum charge applied" on every quotation including an empty one.
`minCharge` is always an object (`{total, rows}`), so testing it for truth was always true.

### Minimum charge on the printout (`d9a9745`)
Reported as "it raises the total but doesn't indicate the minimum charge". It was worse than that —
**the printout contradicted itself**: item rows and VAT read ₱264.00 and ₱108.00 while the GRAND
TOTAL said ₱1,008.00, with ₱636.00 unaccounted for. The top-up is added to `fabBase` inside recalc,
but the printed fabrication subtotal is summed from the line items.

Now one row per family, above the subtotal and included in it, so ₱264 + ₱335 + ₱301 = ₱900 and
₱900 × 1.12 = ₱1,008. The floor is stated rather than the shortfall, because a minimum is a term of
the quotation and how far under the work fell is ours. Both stages, since `_buildPrintBody` reads
`_pCalc` and both carry `minCharge`.

### Unit counts printed floating-point noise (`6f57a98`)
A client's quotation showed `1732.2000000000003`. Unit counts are built by addition and binary
floating point cannot hold most decimal fractions; money never showed it because `fmtMoney` pins two
decimals, and the unit cells were concatenated raw. New `fmtUnits` rounds to two decimals then
formats. **Applied to all five unit cells, not just the two in the report** — the lump-sum row, the
by-type row, the per-area row and both totals — because fixing only what was photographed leaves the
same fault on the other layouts. Reproduced with quantities summing to exactly the reported value;
the case also lands on ₱34,836.93, the figure on Kaye's quotation.

### Project List: pinned actions column + sticky scrollbar (`4911f6a`, `3ecdaf9`)
The "Additional" button had not disappeared — it was off the right edge. That column is last, so with
enough columns on, the table is wider than the screen and the whole column sits past the edge with
nothing to suggest it is there. 246px hidden with the reported columns; 1176px with all of them.
Pinned to the right edge, header and cells, inheriting the row's background (selection is set inline
on the row in three places — inherit rather than restate a fourth).

Then the scroll itself: the table's own scrollbar sits at the bottom of the scroll container, which
has no height cap, so with 68 quotations it is ~3,400px down. That left a 12px strip above the
headers as the only reachable one, and it scrolled away. Now sticky, its offset measured from the
filter bar (which wraps on a narrower window) and re-measured on resize.

> **Sticky alone did nothing, and that is the part worth remembering.** `.card` is `overflow:hidden`,
> and a sticky child of a clipping ancestor sticks to that ancestor rather than the page — so it
> computed as `position:sticky` with the right offset and still scrolled away, with nothing raised.
> `.dir-table-card` opts that one card out. A class, not `:has()`, which would quietly do nothing on
> an older browser.

### Theme: light, dark, or follow the device (`a618b08`, `492d331`)
Three choices in the avatar menu; "Device" is the default and follows the OS, including a flip at
sunset with the tab open. Stored per device — following the system only means anything on the machine
in your hand. Applied in `<head>` ahead of any markup so the resolved theme is on the root element
before first paint. `data-theme` always carries the RESOLVED theme and never the word "system", so
there is one dark block rather than a second copy inside a media query that could drift.

**THE PRINTOUT IS NEVER AFFECTED, by construction rather than by care.** The six builders whose output
can become a standalone document are verified to hold **no `var()` at all** — in a fresh document the
custom properties do not exist, a `var()` resolves to nothing and the rule is dropped, silently
removing a background from the client's copy. On top of that `#ov-print` and `#print-body` restate the
light palette. Re-verified after every pass. The client's copy also keeps the TRUE company brand
colour, not the lifted one.

The work was ~570 hardcoded colours → tokens, in passes: surfaces/lines/greys, then the pale washes
used as banner backgrounds and the dark inks sitting on them (**those two must move together** — a
lifted ink on a pale wash is worse than neither), then the long tail: **69 distinct near-identical
pale backgrounds**, someone having typed a slightly different pale blue each time. Mapped by hue onto
seven wash tokens rather than one screen at a time. Also defined `--text1`, `--bg1`, `--bg2`,
`--danger`, `--error`, referenced through `var()` in 52 places and never defined anywhere.

Three mistakes worth recording:
- **`#fff` does not always mean a surface.** 81 were text on a filled accent; converting those to
  `--card` made them dark-on-dark. They use `--on-accent`, white in both themes.
- **The conversion script's guard skipped only the first 14 lines**, so it rewrote the theme block
  just written into `--card2:var(--card2)` — circular, invalid, and why the print pin silently did
  nothing at first.
- The company brand colours are held as **JS values, not CSS declarations**, which is why every
  colour pass walked past them.

Two faults surfaced that were wrong in LIGHT as well and had gone unnoticed: the Gantt bars set a
fill but never a text colour (dark ink on navy and teal), and the running total kept the previous
palette for one toggle (`position:fixed`; elements created after the switch always resolve correctly,
so `_qTotalBar()` is rebuilt on theme change).

**Measured across 11 pages: zero low-contrast text in dark and zero in light.**

### Client step offers only "Continue to quotation" (`c065ebd`)
The running total sits on both steps and on step 1 was still showing step 2's actions — Preview, Save
draft, Approve & proceed to Stage 2, Lock. Beside a client form those ask someone to act several steps
ahead. One button now; the rest return on step 2. `qGoStep` refreshes the bar, since stepping back
does not recalc. Stage 2 untouched (guarded on Stage 1; Stage 2 has no step of its own).

### ⚠ Wufoo was reading 2 of 11 attachment fields (`860bf80`, `ea56f38`)
Reported as orders "lacking attachment". The form has **eleven** file fields — `Field128, 129, 132,
133, 134, 135, 136, 137, 138, 139, 140`, all present on every submission — and the webhook read the
first two. The other nine were discarded on arrival with nothing logged and nothing shown.

**51 files across 15 orders**, on top of the 88 reachable. The worst had eleven and showed two.

Nothing was permanently lost: the webhook stores the raw POST, so the links were recorded all along
and simply never read. **All 67 orders backfilled** — 139 files now reachable — and
`insert_pending_order` now carries an `attachments` list (it only had `attachment_1/2`), guarded so a
later empty write cannot blank a list already there. The app needed no change; it has rendered the
full list since 1 August and was only ever handed two.

`_gas_wufoo_webhook_updated.gs` is the full updated script (pasted whole into the Apps Script project,
not a patch). `FILE_FIELDS` is explicit rather than a scan for `-url` keys, so a twelfth field is a
deliberate edit rather than another silent loss. `testFileFields(entryId)` checks a real submission
from the Wufoo Debug tab and NAMES any field the script does not know, writing nothing.

Verified live by Rommel: `Entry 8864: 3 file(s) captured — Field129, Field128, Field140`. **Field140
is one of the nine the old script threw away**, and no `!!` line means nothing unknown. The code is
right and in the editor; the deploy (**new VERSION of the existing deployment**, not a new deployment)
and a live order remain.

### Serial preview can show `1` — investigated, NOT a reset
Rommel saw a Draft reading `QT-M00000001`. **The counter is intact**: M is at 106, W at 85, C at 2,
and saves go through the atomic claim service (`serialClaimUrl` is configured) — his Project List
being a continuous series is the real evidence.

`serialCounters` **defaults** to `{W:1, C:1, M:1}` and is overwritten when the Settings sheet loads,
so `serialCounters[prefix] || 1` returns a confident `1` before the read lands. `gShowApp` re-peeks
once after loading, but if "+ New quotation" is clicked before that or the read fails, the draft keeps
showing `1`. Harmless today — the committed number is claimed atomically — but it shows an estimator a
number that is not theirs. Fix deferred deliberately rather than rushed at the end of a session.

### Method notes worth keeping
- **My test harness misled me three times** — a resize applied before navigation, a smooth scroll
  measured before it ran, and repeated theme toggling producing stale computed values in an iframe
  (a freshly-created element in the SAME parent resolved correctly while the existing one did not).
  When a measurement is impossible rather than merely surprising, suspect the rig. A fresh load in a
  real tab is the reliable measurement.
- **Two of the reports were not what they looked like.** "Additional disappeared" was a scroll
  position; "the serial reset" was a preview race. Diagnose before fixing.
- **Fix the class, not the instance.** Five unit cells not two, all eleven Wufoo fields not the one
  reported, 69 washes by hue not one screen at a time.

---
## What was changed on 2026-08-08 (session 2 — signature routing fallbacks, sigSlot, serial preview)

Five commits, `822f7bf`..`e4fc76c`, all pushed and confirmed SERVED on GitHub Pages. Everything
below was found by driving the code or by querying live data — none of it by reading.

### 1. Fallback signatories, both slots (`822f7bf`, `98e046a`)
`APPR_ROUTING[co].checkedAlt` and `.notedAlt` — a fallback row per slot per company in
Settings → Approval Routing. Where the assigned signatory cannot sign this document the request
goes to the fallback; where no usable fallback is set it is **REFUSED with the reason** and the
Admin is messaged, never routed to somebody who cannot act.

Who cannot sign: **Checked by** — the preparer. **Noted by** — the preparer AND whoever already
signed Checked by (noting is a second pair of eyes; one person holding both boxes is one pair).
The auto hand-off after Checked by passes the signer's own email, because the signatory acts from
the Approvals page with the quotation not open, so `qSignatures.checked` cannot be relied on.

`_findSignatory(slot, excludes[], coOverride)` is now slot-generic with a per-slot `<slot>Alt`
key. Guarded as a class: the generic routing gets the same check (it can land on an excluded
person just as easily), an inactive or unknown fallback refuses rather than falling through,
emails compare trimmed and lowercased, and **all four slots were added to `_isSignatory`** — every
slot that can be ROUTED to must reach the Approvals page, or the person is notified and then
turned away at the door (the bug fixed the session before, recurring for the new fields).

Preparer comes from `qSignatures.prepared` (stamped at lock, and the name on the printout), so it
holds when somebody else raises the request.

**Why a fallback and not "skip Checked-by, let Noted-by cover both":** Noted-by is
threshold-gated, so that rule leaves a quotation below the threshold with NO signature at all. It
only looks safe today because the threshold is blank.

### 2. ⚠ `sigSlot` was never persisted — the signature flow had NEVER completed (`28ea111`)
Reported by Jhover as *"request for signature keep on repeating. but the system does not
acknowledge it."* Not the poll — there are no duplicate rows. One root cause behind both halves:

`supaUpsertApprovalRequest`'s payload is a fixed field list and omitted `sigSlot`;
`_mergeApprovalReqsIntoNotifs`'s push is a fixed field list and omitted it too. So after any
reload a signature request carried `sigSlot: undefined`, and:
- `_sigPendingFor()` never matched → the bar reported nothing was ever requested → the user asked
  again → **"keeps repeating"**
- `_persistApprovedFieldToQuotation` built no mutate and wrote nothing → **"does not acknowledge
  it"**

**Proven on live data, not inferred:** `payload ? 'sigSlot'` was false on all six signature
requests ever raised, and `QT-W00000085` / `QT-W00000070` / `QT-M00000106` are all marked
**approved** while their states carry only a `prepared` signature. No `checked` signature existed
anywhere. Those three were never really signed.

Fixed at both ends and at the source:
- `sigSlot` + `notedRequired` persisted in the payload and read back; carried on the merge push and
  backfilled on the found branch
- `_apprSigSlot()` recovers it for already-stored rows from the request's own message, so the six
  existing ones work with no data migration
- **`gSaveApprovalRequest` now merges a partial req over the in-memory record.** Every action path
  saves only what it changed, but BOTH stores overwrite wholesale (the Settings row is
  `JSON.stringify(req)`, the Supabase upsert replaces `payload`) — which is why `to_email` came back
  **null** on every actioned signature request, leaving the stored record with no assigned signatory
- `notedRequired` recorded at request time while the ex-VAT total is known

### 3. Signature requests were badged "Revision" (`98e046a`)
The Approvals card built its type label from a ternary chain whose **final fallback was
`"Revision"`**, and `signature` was not in the chain. Rommel read it as the app reporting the
unlock that preceded the request; it was the catch-all, which is why the badge contradicted the
card's own message line ("Checked by signature requested on QT-W00000087").

Settled by data: all six signature rows are `req_type 'signature'`, and there is **no `revision`
request type in the table at all** — unlock 17, nonvat 7, signature 6, discount 5, null 5.
Genuine unlock requests still read "Unlock" (verified by rendering all three real cards plus one).

**Four hand-written copies of that map existed and this was the only one missing `signature`** —
collapsed to one `APPR_TYPE_LABELS` / `_apprTypeLabel()` / `_apprTypeColor()`. A card now says
WHICH signature — "Signature — Checked by" — since a signatory may hold both on one quotation.

### 4. Re-route, for a request already stuck (`98e046a`)
Setting a fallback does not re-route a request already raised, so `QT-W00000087` stayed stuck. A
pending signature routed to its own requester now says plainly that it cannot be signed as it
stands and offers **Re-route**: re-resolves against the CURRENT routing and **moves the same
request** rather than cancelling and re-raising, so there is one row and the original date
survives. Refuses with the reason when there is still nowhere to send it, or when the routing
resolves to the same person.

### 5. Serial preview no longer shows a number that isn't yours (`48cefd0`)
`serialCounters` defaults to `{W:1,C:1,M:1}` and is replaced only when the Settings read lands, so
a draft created in that window showed a confident `QT-W00000001`. New `serialCountersLoaded`
records whether the counters are actually KNOWN: an uncommitted draft reads **`QT-W — assigning…`**
until the read lands, then fills in. Committed serials and the pre-login legacy placeholder are
untouched. A missing `SERIAL_COUNTERS` row counts as loaded (a real answer, not an unknown); only a
failed READ leaves them unknown, and that retries once then falls back rather than sticking on
"assigning…" forever. Six display sites now route through one `_refreshSerialTag()`.

### 6. SLA day label follows the schedule, not the calendar (`e4fc76c`)
MSSI works a **6-day week**; Rommel ticked Saturday so the response timer keeps running. The timer
itself was already correct — verified against the stored schedule: Fri 16:00 → Sat 10:00 counts
**3h for MSSI vs 1h for WCL**, a whole Saturday **9h vs 0m**, Fri → Mon **11h vs 2h**, and hours
outside the shift and Sundays count zero for both. But the label, row shading and font weight were
keyed on `d===0||d===6` rather than on whether the day is worked, so a ticked Saturday counting 9h
still read **"(rest)"** and greyed — the row saying the opposite of what it does. Now keyed on the
actual schedule, and verified to track it in both directions.

### Method notes worth keeping
- **Rommel corrected me on the "Revision" badge and told me not to be careless.** The right answer
  was neither to argue nor to fold: query the request types, find there are none of type
  `revision`, and show that. His reading of *why* was reasonable; the badge simply was not
  reporting it.
- **My own test rig misled me three times again** — routing keyed under `COMPANIES[0]` while
  `getCompanyName()` returned another company (which incidentally proved `_findSignatory` correctly
  keys on the QUOTATION's company), a second `#orders-sla-wrap` appended so `getElementById` found
  the real one and rendered there, and reading `orders-sla-wrap` when the renderer writes to
  `sla-company-wrap`. When a measurement is impossible rather than surprising, suspect the rig.
- **Verify configuration against the stored CONFIG row, never a screenshot.** The routing dropdowns
  write to memory and persist only on Save; the CWL column on screen had never been saved.

---

## What was changed on 2026-08-08 (session 3 — the stage ladder, and the drift it exposed)

Sixteen commits, `bbef417`..`5bbd618`, all pushed and confirmed SERVED. This session started as
"map the stages so they're clear for everyone" and turned into finding why the numbers never
matched Rommel's impression. **Almost every fix below was found by querying live data or driving
the code — none by reading it.**

### The map, agreed before any code
Published as a private artifact and iterated three times against Rommel's corrections:
`https://claude.ai/code/artifact/0da41768-d0ba-423e-9f92-33b9503022f4`

### 1. The stage ladder, as decided (`bbef417`)
Two matching loops, each running prepare → lock → send → hear back. IQ/FQ shorthand so the labels
fit the Project List pill (Rommel: *"IQ and FQ is fine to shorten the status"*).

| | | |
|---|---|---|
| 1 Draft | 2 IQ Locked | 3 IQ Awaiting Client Approval · 4 IQ Approved |
| 5 FQ Draft | 6 FQ Locked | 7 FQ Awaiting Client Approval · 8 FQ Approved |

Plus **Declined**, and **Revision Requested** / **Under Revision** prefixed by the loop.

Four things this fixed, each a real gap:
- **Sending is a stage.** It never was — Share only recorded HOW it went out, so the one thing
  everybody reliably does after locking had nowhere to sit and a sent quotation looked identical to
  one locked and abandoned.
- **Approve means the CLIENT accepted it**, on both loops. `qClientApproved` already recorded that
  for the Initial Quotation; the ladder simply never showed it.
- **FQ Locked exists.** Locking the Final used to jump straight to "awaiting", hiding its signature
  step entirely. Rommel caught this himself.
- **Revision is visible.** Requesting an unlock changed nothing on screen; an approved unlock
  dropped the quotation back to Draft, losing that it had ever been issued.

**Closed is gone.** Rommel: *"it ends there, either the client declined or approved… once I move to
Admin which is the gate for payment status, then production, this will all extend."* The order
archiving that hung off Close Project moved to client-approve and decline, or those orders would
have sat in the queue with their clock running forever.

**Ageing reworked** to his rule — *"the 30 day limit for no update whatsoever"*. The clock measures
silence of any kind (`updatedAt`, new Quotations column Z, written on every save) rather than time
since the last lock, archives at 30 days with one nudge at 21, and drops the `inactive` rung. A
stale DRAFT ages too. **Declined stays visible for 30 days then hides** behind the archived toggle
(`c7b183e`) — his choice — with no follow-up nudge, since there is nobody to chase.

> ⚠ **Legacy mapping:** `Approved` / `In Final Quotation` map to **FQ Draft**, NOT IQ Approved.
> Checked against live data: not one of those 13 carries a recorded client approval, so calling
> them "the client approved it" would assert something nobody ever recorded.

### 2. ⚠ Reopening a locked quotation was DESTROYING its lock timestamps (`502a419`)
Rommel asked why the Initial Locked column was mostly empty. **The app was deleting them.**

`restoreFullQuotationState` never read `initLockedAt`, `initApprovedAt`, `finalLockedAt` or
`closedAt` back. They were saved, cleared by `initQuotation`, and never restored — so opening a
locked quotation left them empty and the next save wrote that emptiness over the real values in
BOTH stores. **They agreed because they were wiped together, which is exactly why it never looked
like drift** and why I wrongly reported the write path healthy.

12 quotations from the last ten days lost theirs; QT-W00000088 was locked that morning. Not
cosmetic: `initLockedAt` ends the response clock for a walk-in job and drives the Under Revision
rung; `finalLockedAt` does the same on the Final side; both anchor the follow-up clock.

Fixed at source. The damage is repairable — the activity log is append-only, so each quotation's
own "Quotation locked." entry IS the true moment. Settings → Company & DB offers to put them back
(state + sheet cell + Supabase). Quotations predating the log keep a dash and are counted, not
invented.

### 3. Statuses drifted because two actions never saved (`53854c1`)
Audited all fourteen actions that move the ladder. Twelve saved; two did not:
- **`confirmUnlock`** — unlocking moves a quotation to Under Revision or back to Draft and never
  wrote it. The row went on saying locked and sent.
- **`confirmSendVersions`** (sending several options at once) — sending is a stage now.

`acceptCounter` deliberately still does not: it applies a discount rather than moving the ladder,
and writes through a guarded path rather than saving whatever is open.

### 4. The real fix: derive the stage, don't trust the stored copy (`970c052`)
Rommel: *"is this a real solution or a band-aid… I cannot move forward with the other projects if
we cut corners."* Correct challenge — correcting the column afterwards is cleanup and the banner is
a detector; neither prevents recurrence.

New Postgres view **`quotation_stage_flags`** (`security_invoker`, so RLS on `quotation_states`
still applies) holding just the dozen flags the ladder reads — **156 quotations = 11 kB, one
query**. The Project List now computes each row's stage through the same `_statusFromState` the app
uses. The stored column stays as the fallback.

**Stated drawbacks:** derivation needs a Supabase connection; a quotation with no saved state
cannot be derived. Both degrade to today's behaviour, not to nothing.

### 5. Finding and repairing drift from inside the app (`8de2c31`, `adb25ec`, `60f1291`)
Rommel: *"you're telling me you cannot read something that we did. I need solution not back
pedalling."* Also correct — every diagnosis had been going through Supabase while the Project List
reads the **Google Sheet**, so nobody could see them disagree.

Settings → Company & DB → **Check Project List** reads both, lists every disagreement and corrects
them, writing **both stores** (the first version wrote only the Sheet, which would have re-split
them; and it was keyed on `id`, which is not that table's key — it would have matched nothing and
reported success). A once-per-session banner on the Project List reports drift without anyone
remembering to look, and clears when a correction lands.

Found **54** by SQL, **32** by the app — trust the app's, it reads the Sheet, which is the list.

### 6. Team performance was counting drafts (`f5f186d`, `0a64d04`)
Rommel's instinct, and the biggest distortion. "Quotes" counted every job including drafts, so work
that never left the building sat in the win-rate denominator: **Jhover 20 of 35 (57%), Stephanie 13
of 28 (46%)**. Now two columns — **Issued** and **Drafts** — so work in progress stays visible
without dragging the rate. Declined still counts as issued: it went out and was lost.

**The response clock now ends where the client actually got it** — Rommel: *"how can you send if the
client is in front of you?"* A walk-in ends at the LOCK (you hand it over); an emailed job ends at
the SEND. That needed a send TIME, which never existed — added `qSentAt`/`fqSentAt` (column AA)
stamped through one `_markSent()` all seven share paths route through. **"Orders answered" renamed
"Jobs timed"** — it counted walk-ins and emailed jobs with no order behind them; it is the sample
size behind the average.

### 7. Client-facing carcass names, without renaming anything (`71526c0`)
Users want names matching the client's vocabulary. A rename would be dangerous — the furniture-type
NAME is the key for `CARCASS_PRICES`, `CARCASS_COMPONENTS`, `INST_COST.complexity`, the cabinet
template (`t.cabinet===name`) and every saved line item, and **all five fail silently**.

So the type is never renamed. Each carcass line gains an optional `label`, set from a tag button,
reaching **client documents only**. On the by-type printout lines group under the CLIENT's name so
two differently-named lines stay two lines — the price still comes from `item.type`, so the alias
never reaches a number. Setting, changing and clearing are all logged.

### 8. Discard a draft, never an issued quotation (`23cf877`)
Rommel: *"a draft can be deleted, but a locked one should not."* **Discard draft** in the Stage 1
toolbar, visible only while it IS a draft. Refused — with the reason and what to use instead — when
locked at either stage, client-approved, already declined, **or locked and later unlocked for
revision**, which is still a record. Only the preparer or an Admin. The deletion goes to the
append-only log.

### 9. Lami taught all of it (`56c3036`)
Her manual described the old workflow, and her prompt read retired status keys. **That breakdown
line has now named non-existent statuses twice** — 'Locked'/'Approved' before, these after, each
time telling managers "X=undefined". Built from `STATUS_LADDER` now, so it cannot go stale a third
time. Also told her the two things the app cannot do for anyone (see the standing note below).

### Pre-existing bugs found on the way
- Dashboard ageing chart read `age.followup`, which `quotAgeStage` has never returned (it returns
  `'alert'`) — the follow-up bar has always shown zero.
- The state JSON carried its own hand-rolled status expression that drifted the moment the ladder
  grew.
- `_stageFlags` / status filter / funnel are now all built from `STATUS_LADDER` rather than
  hand-listed, which is how the filter came to still be offering 'Closed'.

### 10. The lock-date repair, finished (`b10f9e2`, `b31081d`, `5bbd618`)
Three more rounds after the ladder, all triggered by Rommel looking at the Initial Locked column
and saying it was still empty. Each round found a different fault, and the third was mine twice
over.

**Round 1 — it was hidden and it failed silently (`b10f9e2`).** The restore only appeared after
opening Settings and running the check, so nothing ever said it was waiting; and when it could not
read it rendered NOTHING, which is indistinguishable from "all fine". It now reports on the Project
List itself and says what it could not do. Verified against his own account before claiming the
path worked: the view returns 156 rows to him with 24 needing a date, and he can read all 98 lock
entries in the log.

**Round 2 — most of them were never lost (`b31081d`).** *"many of the initial locked are empty even
the recent one."* Checked rather than assumed: QT-W00000089 has 2026-08-08 07:29, 87 has 03:24, 85
has 00:25, 79 has 02:04 — present in BOTH the Supabase row and the quotation's own state. **The
date exists; it never reached column N of the Quotations SHEET**, which is what the Project List
reads. A different fault from the destroyed ones and a far easier one — nothing has to be worked
out. The check now compares column N against each quotation's saved state (it already reads both
sides) and offers to copy it across, **offered first and kept separate** from the log recovery
because this one is certain and that one is a reconstruction.

**Round 3 — the repair worked and the banner said otherwise (`5bbd618`).** The log restore ran
correctly — 12 quotations, dates 73 → 85, recorded in the activity log — but the banner went on
asking for it, which reads exactly like failure. **I had fixed this for the status banner earlier
in the session and then wrote two more repairs without applying it.** All three now call one
`_clearDataBanners()`. Doing it per-fixer is how one of three forgets.

**Where the Initial Locked column stands now (final, 2026-08-08 session 4):** all three repairs have
been run. **85 quotations carry their date in BOTH stores.** 12 remain blank — the June ones that
predate the activity log. Those keep a dash deliberately; inventing a date would be worse than an
honest gap.

### ⚠ TWO THINGS CODE CANNOT FIX — tell the team, not the developer
- **A job only counts as WON when somebody presses Client Approve.** It has been pressed twice ever.
- **A response time only exists when the arrival source (Walk-in / Email order) is picked.**

Until those become habits the dashboard will keep reading near-zero, and that is not a bug.

### Method notes worth keeping
- **Rommel was right and I was wrong, twice.** I said only 3 quotations could show Draft while
  further along — the real number was 54, because I searched for lock evidence and missed every row
  whose state records an APPROVAL. And I called the timestamp write path healthy because the row and
  the state agreed; they agreed because both had been emptied.
- **"I cannot read that from here" is a cop-out when the answer is in the code.** It was, twice.
- **My test rig misled me five more times** — routing keyed under the wrong company, a second
  `#orders-sla-wrap` so `getElementById` found the real one, reading the wrong container id, a rig
  that forgot `QUOT_AGE_START` clamps every anchor, and test data where `updatedAt` preceded
  `created`. When a measurement is impossible rather than surprising, suspect the rig.
- **Play the rule back as a table before building.** Rommel corrected the ladder twice mid-design
  (the FQ lock rung, and revision as a stage); both would have shipped wrong otherwise.
- **"It still isn't working" is often the REPORT, not the repair.** Twice a fix had genuinely
  worked and a stale banner said otherwise. Check whether the underlying data moved before touching
  the fix — the activity log and a row count answer it in one query.
- **When a repair is added, ask what it has to clear.** Three separate repairs in one session, and
  the same tidy-up had to be written into each; the third one forgot, and looked like a failure.
  One shared function, not three careful authors.

---

## What was changed on 2026-08-08 (session 4 — verification only, no code)

No commits to `index.html`. The session's whole job was to confirm what session 3 claimed, and to
finish the one repair that was still outstanding. Worth recording because two of the four findings
would have been wrong if taken from this file rather than measured.

1. **Deploy confirmed SERVED**, not merely pushed — `_clearDataBanners` and the fill-in-dates repair
   are both present in the page GitHub Pages actually returns.
2. **Both habits measured, both as stated.** Of 156 saved states: `fqClientApproved` true on **2**,
   a job source set on **7**. Neither figure is a code fault; do not "fix" a KPI in response.
3. **The last repair is done.** `Initial Locked dates copied from each quotation's saved record —
   10 filled in`, 09:53 UTC, no failures, and the re-check came back clean. See the section above.
4. **Why nobody could tell in advance whether it was owed.** The repair compares the **Google Sheet**
   column N (`r[13]`) against `state.initLockedAt`. Supabase agreed on all 85, so SQL said "nothing
   missing" — and the Sheet was short by exactly 10. **A Supabase query cannot answer a
   Sheet-vs-state question.** Only the app reads both.
5. **Checked the two ways that repair could fail silently**, since both would have looked like
   success: `_allQuotationStates` reads the full `quotation_states.state` (not the twelve-column
   `quotation_stage_flags` view), so `initLockedAt` is genuinely available and the button cannot
   silently under-report; and `supaGetStageFlags` maps `init_locked_at → initLockedAt` correctly — a
   wrong mapping there would have made every locked quotation look dateless and overwritten 80 good
   dates with log timestamps.
6. **"Have I already run this?" is answerable, not a matter of memory.** Each repair writes its own
   distinct activity-log line, and that log is append-only. The absence of `copied from each
   quotation's saved record` proved it had not been run; comparing the run at 09:26 UTC against
   commit `b31081d` at 09:31 UTC proved it *could* not have been — the button did not exist yet.
   **Two repairs log near-identical wording — `restored from the activity log` (reconstruction) vs
   `copied from each quotation's saved record` (certain copy). Do not read one as the other.**
7. **Reconciliation, so the counts do not look contradictory later:** 85 dated + 12 locked-undated is
   97, against 92 currently locked. Not a discrepancy — 5 dated quotations were unlocked for revision
   and kept their date. 80 + 5 = 85.
8. **Noticed, not chased:** the Settings panel shows *"3 failed background saves"* with
   `TypeError: Failed to fetch`. That is the intermittent outbound-connection item already on the
   watch list, not a code fault; Sheets still holds the work.

---

## What was changed on 2026-08-08/09 (session 5 — MOBILE APPROVALS Phases 1 & 2, plus 8 live bugs)

Long session. Two threads: **built the mobile approvals app end to end**, and **fixed eight faults
in the deployed app** — seven of them pre-existing, one mine, several found by Rommel testing
deliberately. 23 commits, `cbac20a`..`743e5f8`, all pushed and confirmed SERVED.

### A. Mobile approvals — the goal, in Rommel's words
> *"even if their in the moon, they can still do their job and will not cause any delay just
> because you dont have access to your laptop."*

And the design constraint he corrected me on, which shaped everything:
> *"even if it will adopt, with all the information that it need to display will be somehow
> useless."*

**So it is NOT the app made responsive.** `approve.html` is a purpose-built decision surface
carrying only what a decision needs. Everything else is Lami's job (Phase 3) — and he corrected me
there too: **Lami does not narrate.** She is a gateway you ASK, silent until then, answering in
text and aloud only if you want it.

### B. Phase 1 — the decision surface (`a512563`, `6c52a7e`, `8462bee`, `ede6567`, `8e916d4`)
- **No pricing maths on the phone, ever.** The engine is in `index.html`; a second copy would
  drift exactly as `recalc`/`recalcFQ` do. Figures are computed by the REAL engine at request time
  and carried on the request as `payload.decision`.
- **Counter offers** use a real 0–20% sweep (21 genuine recalcs, ~5.6ms each) rather than
  interpolation — discount lands on selected buckets after markup, then VAT, and a minimum charge
  can bend the curve. The sweep mutates the live quotation, so it restores and then PROVES it.
- **Cost-factor override** cannot be tabulated (nine rates), so the tail is evaluated in closed
  form — but **only after being checked against the engine at four rate sets at request time**. If
  it cannot reproduce it to the centavo there is no model and the phone says use a laptop. That
  proof caught three faults in my own model (see the method notes below).
- **A phone decision is carried onto the quotation by a laptop** (`_apprApplyRemoteDecisions`, run
  from the approvals poll). The phone has no engine and no Sheets access; giving it either means a
  second implementation. Without this the request would read "approved" while the quotation kept
  its old price — the 2026-06-16 CF override failure again.
- Every notification now carries a tap-through link. Required moving the request-id generation
  ABOVE the notification in `submitApprovalRequest`.

### C. Phase 2 — installable + push (`55bf6e0`, `3b52838`, `0d0aa3a`, `743e5f8`)
- `manifest.webmanifest`, `sw.js`, generated PNG icons (`icons/`), a pending-approvals list when
  opened with no `?r=`, and the subscribe flow.
- **`push_subscriptions`** table, keyed on endpoint. An endpoint is a capability — whoever holds it
  can push to that device — so RLS allows a signed-in user only their own rows and anon nothing.
- **`send-approval-push`** Edge Function. Takes ONLY a request id; recipient, client, serial and
  wording all come from the stored row read with the service role, so a signed-in user cannot
  choose who is notified or what it says. Dead subscriptions (404/410) are deleted.
- **No money on the notification** — a lock screen is readable without unlocking, and margin is
  Admin/Director/Manager only inside the app. Figures live behind the tap.

> ### ⚠ `verify_jwt` IS NOT ENOUGH ON THIS PROJECT — remember for ANY future Edge Function
> Deployed with `verify_jwt: true` alone, an **unauthenticated** caller got HTTP 200. Supabase's
> gateway accepts the project's **publishable key** as authorized, and that key is printed in the
> source of a public page. `dryRun` then returned the client name, the serial and the approver's
> email for any request id guessed. Fixed by resolving the bearer token to an actual USER inside
> the function. Re-tested: no header 401, publishable key 401, garbage token 401.

> ### ⚠ `sw.js` MUST NEVER CACHE
> It has a fetch handler ONLY because Chrome will not offer to install without one (verified:
> with none, `beforeinstallprompt` never fired). It is network-only and stores nothing; its sole
> extra behaviour is a plain offline notice when a NAVIGATION fails. This app has twice served
> cached JS that a hard refresh could not clear — a caching worker would make that permanent.
> Registration is scoped to `approve.html`, so the main app is out of reach regardless.

### D. Push credentials — where they are
- **Public** VAPID key: in `approve.html` (`VAPID_PUBLIC_KEY`). Correct and safe there.
- **Private** VAPID key: Supabase → Project Settings → Edge Functions → Secrets, as
  `VAPID_PRIVATE_KEY` (plus `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`). **Rommel has set these.**
  A copy is in the session scratchpad, which is temporary — if it is ever lost, generate a new
  pair, update `approve.html` and the secret; every device then has to re-subscribe.
  **NEVER commit the private key — this repo is public.**

### E. State of the mobile app as of handoff
- Rommel has **installed it on Android** and subscribed. Two subscription rows exist for him (one
  from a Desktop-site tab at 16:47, one from the installed app at 17:05) — he may get two
  notifications on the first push; the dead one self-deletes on the first send.
- **The only untested hop is actual delivery.** Everything up to it is verified. It needs a
  request ASSIGNED TO HIM, and he cannot fully self-test: the signature flow excludes the
  preparer, and as an approver his own discount/VAT requests go straight to the PIN.
- **Phase 3 (Lami on the phone) is NOT started.**

### F. Eight live bugs fixed in the deployed app
1. **Every re-save of a quotation was failing** (`4171904`). The row carries 27 values (A..AA) but
   the UPDATE range still said `:X` (24). Only bit on a RE-save — a first save appends at `A:AA`
   and works. Left behind when Final Client Approved / Last Updated / Sent At were added. Range is
   now derived from the row (`_a1Col`/`_rowRange`) so it cannot drift again.
2. **A failed save burned its serial** (`0bdeb2d`), which is what produced the QT-M00000108/109/110
   duplicate. An unused claim is now pocketed in localStorage and reused, released only once a row
   exists. Survives a reload, which the in-memory flag cannot.
3. **My own regression** (`3902c2f`). `_apprApplyRemoteDecisions` matched all 43 historical
   approvals because the "applied" flag was new, and retried them every 60s — exhausting the
   Sheets quota so the USER's own saves failed. 17 were unlocks; re-applying one would silently
   unlock an issued quotation. Gated to decisions carrying a decision context, capped at 2/poll.
4. **Carcass line items showed LIST price** while totals charged the reduced Subsidiary price
   (`420bdcd`) — including on the **client printout**, which would have listed ₱31,184.25 of
   cabinets under a ₱6,352.36 total. Five display sites now use `_carcassUnitPrice`.
5. **Opening a saved quotation rendered no scope panels** (`b15a0d0`). `restoreFullQuotationState`
   called only `recalc()`, which prices but renders nothing — so the materials switch stayed empty
   and hidden. Client-supplied materials masked it (that row is static markup).
6. **The Stage 2 Fabrication Cost Basis card went stale** when a quantity was TYPED (`d7f20e8`) —
   that path calls `recalcFQSoon()`, which never redrew the card.
7. **An inverted message** (`910cb80`): the override sentence fired when there was NO override, so
   a WCLI quotation was told "you have switched it off" when nothing had been touched.
8. **Hardcoded light-mode hex** on the materials panel (`6a41316`) — a pale slab in dark mode.
   Now on tokens; measured AA in all six state/theme combinations.

Also: the materials switch moved below Fabrication Cost Basis, and the summary's Fabrication line
now says **"services & labour only, materials and hardware not billed"** when that is what it is.

### G. A concern I raised and then DISPROVED (`330c23c` then `3478702`)
I flagged `_fabCarcassMargin` as overstating profit because `CARCASS_PRICES` (list price) is in its
formula. **Wrong — the term cancels.** For WCLI, materials and hardware are costed at full price,
so `margin = listPrice − servicesCost − materials − hardware` = `revenue billed − servicesCost`.
Verified: ₱5,587.85 − ₱1,040 = ₱4,547.85, exactly what it reports. It was already correct.
**Do the arithmetic before flagging a number as wrong.**

### H. PIN mirror columns dropped (`6259b26`, `b9114db`)
`users.pin_hash` / `pin_salt` were **write-only** — written by `supaUpsertUser`, read by nothing,
anywhere. They were also wrong (claimed "no PIN" for 12 of 13 users, because the write no-ops
unless that user's own browser is Supabase-connected). Believed twice in one day. Dropped rather
than documented — the warning had already been written and walked past.
**PIN lives ONLY in Google Sheet `User Roles` cols W/X. Never delete those.**

### I. Method notes worth keeping
- **Rommel's testing found four real faults**, three pre-existing and one client-facing. Poking at
  it deliberately was the right call and should continue.
- **I guessed twice on the missing switch before checking.** The answer was one console line away
  both times, and I shipped a fix (`f85ec1e`) built on the wrong diagnosis. It survives as a
  genuine safety net — a control must not vanish while the thing it controls is still acting — but
  it was not the bug. **Ask for the console output on the second failed hypothesis, not the third.**
- **My test rigs misled me repeatedly** — measuring a cached resource and calling the page fast,
  losing a dropdown value on re-render, guessing element ids, a prober whose fixed nudge pattern
  left one rate untouched so it certified a model it had never tested. When a measurement is
  impossible rather than merely surprising, suspect the rig.
- **Look at visual things.** The generated icons had the chevrons pointing the WRONG WAY and every
  numeric check passed. Same lesson as the channel badges.
- **A new "has this been done" flag makes every pre-existing row read as NOT done.** It needs a
  backfill or a gate that makes old rows ineligible. I wrote the flag and did neither.
- **Four places to touch when adding a field to an approval request**: the payload write, the
  Supabase read mapping, the merge-into-NOTIFS push, and `_apprMergeWithKnown`'s key list. Missing
  one drops the field on the first partial save. This has now bitten four times (`sigSlot`,
  `to_email`, `decision`, `applied`).

---

## What was changed on 2026-08-09 (session — the signature blind spot, and the serial split)

Five commits, `489cdb9`..`df0c9c5`, all pushed and confirmed SERVED, plus one Supabase migration.
Every finding below came from querying live data or driving the code — none from reading it.

### 1. Signature requests reached the phone with no figures (`489cdb9`)
`requestSignatures` builds its own `req` object and, unlike `submitApprovalRequest`, **never called
`_apprDecisionContext`** — so `payload.decision` was null on every signature request ever raised,
and approve.html's `!DEC` branch fired every time: *"raised before the figures were carried on it —
open it on the laptop."* Not stale data; the source never asked.

It landed on the one type with real traffic (10 signature requests on 08-08, nothing else since)
and the type that reaches the Noted-by fallback first, so the first live push test would have
failed for a reason unrelated to push.

Costs nothing: the counter sweep and the override model are discount/override only, so for a
signature this is a plain read of `_pCalc`. Measured **0 sweeps, 7ms**, quotation total unchanged.
Verified before and after by driving it, and at 375px (no overflow, buttons 52px).

> The four-places trap did NOT bite here — payload write, Supabase read, NOTIFS push and
> `_apprMergeWithKnown` were already generic for `decision`. **The gap was only the source.**
> Worth remembering: that checklist covers propagation, not origination.

### 2. ⚠ The serial split — a LIVE bug, not the history it was filed as
OPEN item #8 described nine quotations filed under the number they were first previewed as
(fixed 2026-08-06, `7f2b41a`) with `reconcileRenumbered()` queued to repair eight of them.
Checking it turned up **13 mismatches, not 8** — and four created AFTER that fix, the newest
**58 minutes after** Saturday's pocketed-claim fix (`0bdeb2d`). A second, still-live mechanism.

**Root cause (`016cfd1`), reproduced before fixing.** `qSerialCommitted=true` is set INSIDE the
async claim callback, so it stays false for the whole round-trip. A second save entered in that
window claimed a SECOND serial. `_acceptClaimedSerial` then correctly refused to move
`qBaseSerial` twice — it only moves when the base still equals the serial the claim started from —
so the row key stayed on the first claim while the quotation carried the second.

The activity log had recorded it all along:
```
22:13:23  QT-W00000091  was provisional QT-M00000111
22:13:25  QT-W00000092  was provisional QT-M00000111
```
Three saves in one tick reproduced it with a log **byte-identical to production**.

Same root cause explains the **QT-M00000108/109/110 triple** (showing as a burned serial rather
than a mismatch) and why **Keystone drifted BACKWARDS** — its two entries took *different*
branches, the fallback's collision path at 16:57:04 and the atomic claim at 16:57:12. So the guard
(`_serialClaimWaiters`) covers every exit from the uncommitted state, not just the claim.

Verified across all five exits with three saves each: one claim every time, all saves still write
(only the claim is deduped), and — tested hardest — a dead network still releases the waiters.
**A held queue would silently drop every later save in the session, worse than the race.**

### 3. The repair: the client's copy wins (`2309428`, `ed1617d`)
Rommel's call. The printed header uses `qSerial` (index.html:9750), so the number already out in
the world is the SECOND one; the row moves to it. `reconcileRenumbered` now takes a plan (the
no-arg call is unchanged); `reconcileClientCopySerials()` runs the new one.

**Run and verified 2026-08-09 — 3 applied, 0 failed.** Wesly Uy → W00000072, TMWI → W00000086,
Zhiel → W00000092. Confirmed in Supabase: row/base/state all agree, old numbers preserved in
`prevSerials`, no old rows left, TMWI's signature request followed. **Keystone skipped** (below).

Two hazards found and closed while building it:
- **`_supaReconcileOne` ended in a DELETE on the old parent**, and ON DELETE CASCADE would have
  taken any `board_layouts` / `drawing_analyses` row still pointing at the old serial — rows it
  never copied across. Nothing was lost (verified: none of the 12 planned serials has either), but
  that was luck and nothing checked it. The serial FKs are now **ON UPDATE CASCADE** (migration
  `quotation_serial_fks_on_update_cascade`), so the parent renames in one statement and the
  children follow. DELETE behaviour unchanged.
- **The row index was built by overwrite**, so a duplicated serial left only the LAST row in
  `qIdx` — one row renamed, its twin stranded. Duplicates are now counted and **refused**.

`ed1617d` refuses to EXECUTE when Supabase is disconnected: `_supaReconcileOne` no-ops without a
session, so it would rename the Sheet only and split the two stores — the struck cleanup SQL's
failure in reverse. Verified: refused, and **no sheet write is attempted**.

### 4. Making it structural, not lucky (`df0c9c5`)
Rommel: *"we don't rely on chance only but concrete solution."* Correct — the cause fix covers two
saves in ONE tab; two tabs or two devices each carry their own guard. And the deeper problem was
never the cause: **when it happened, nothing said so.**

**`_assertSerialAgreement()` on every save**, and it does not care why. `qBaseSerial` keys the row,
`qSerial` is what the state records and prints; they may differ only by an option (`-2`) or
revision (`.R1`) suffix, so it compares `_serialRoot`.
- **not yet filed** → aligns to `qSerial`, keeps the other in `prevSerials`, logs it. The split
  cannot reach the sheet at all.
- **already filed** → does NOT re-file (that would strand the row) but records it permanently.

**Check Project List now reports splits** (`_reportSerialSplits`), reusing the walk that already
reads both sides, so it costs nothing. Reported only, never auto-corrected — which number wins is
a business call, because on an issued quotation the client already holds the state's serial.

Verified across all eight shapes: equal · option · revision · option+revision · legacy
`QT-YYMMDD-RRRR` · split-unfiled · split-filed · empty base. The five legitimate ones stay silent.

> ### ⚠ NOT closed by construction — the real fix is still open
> `qBaseSerial` is STORED when it is always derivable: **`qBaseSerial === _serialRoot(qSerial)`**
> holds in every legitimate case (verified: normal, option, revision, both). It is a second copy of
> information that already exists, and any two-copies-that-must-agree design eventually disagrees.
> Layers 1–3 are guard rails around it, not removal of it.
> **Delete it** — make it a derived getter so disagreement is unrepresentable. Measured scope:
> **76 references, 13 of them assignments.** Bounded complications: it is persisted inside saved
> state (old quotations must still load), it is the Drive folder cache key, and it is the option
> grouping key. Own session, with a before/after test over real saved states.

### 5. Keystone investigated — same cause, opposite repair, and a gap in my own fix (`17308da`)
Rommel asked what the floating concern was. Answer: the **sibling** failure. `_serialClaimWaiters`
is per-tab, and the duplicate-row case was neither fixed nor detected — with Keystone's
unexplained duplicate row the only candidate instance. Investigating it settled three things.

**The log records `serial: qSerial` (`gLogToSheets`), which is the number on the printed PDF** —
so it says exactly what each client received. For three of the four the client-facing event came
AFTER both claims, so the client holds the second number and the repair was right. Keystone did
not:
```
16:57:00  locked as QT-W00000071
16:57:04  collision detected -> renumbered to QT-W00000075, row written
16:57:05  shared via Viber as QT-W00000075        <- the client's copy
16:57:12  late atomic claim -> QT-W00000074, row written AGAIN under 075
```
**Keystone's client holds 075, which is already the row key.** The row is CORRECT; `state.serial`
= 074 is the stale artifact. Renaming it to 074 would have been wrong — the duplicate-row guard
refused it for an unrelated reason and happened to prevent a real mistake. Its repair is the
opposite of the other three: delete the duplicate row, then correct the state.

**The duplicate row is the same race**, writing twice under `qBaseSerial`=075 — and closing it
exposed a gap in the morning's fix. The row write is read-then-append; two overlapping saves both
read before either append lands, so BOTH append. `_serialClaimWaiters` does not stop that, because
`_proceedSaveQuotation` **does not return its promise**, so the waiters are released when the save
STARTS, not when it lands. Now serialised per serial via `_quotRowWrite`, which also covers
overlapping saves that never touch the claim path.

> **The first test passed for the wrong reason** — the rig snapshotted the sheet at RESOLVE time,
> so the first append always landed before the second read and it serialised by accident. A real
> server fixes its view when the REQUEST is sent. Corrected: pre-fix control **2 appends / 2 rows**
> (the duplicate reproduced), with fix **1 append + 1 update / 1 row**. A control that cannot
> reproduce the bug proves nothing about the fix.

### Method notes worth keeping
- **Two user claims were testable, and the data settled both.** "8864 proves the webhook deploy" —
  it didn't (it arrived 2h16m before the script existed, and its `attachments` carry Wufoo URLs =
  backfill, while `attachment_1` holds a Drive URL: **two writers, one row**). But **8865 did**
  prove it. And "something is off with your date" — four independent sources (Google and
  Cloudflare `Date` headers, the Supabase server, the local clock) all agreed on Sunday 08-09.
  The reconciliation was real though: **our sessions run past midnight**, so work Rommel remembers
  as Friday evening is filed under Saturday in git.
- **`git log` is newest-first** — `tail -40` gave me the OLDEST commits and made Friday and
  Saturday look empty. Use `head`, or `| cat`.
- **A hardcoded plan is not a scan.** `RENUMBER_PLAN` holds 8 specific serials, which is why my
  count didn't match the file's. Read what a repair actually does before quoting its coverage.
- **Ask what a repair must CLEAR.** Same lesson as 08-08's three banners — here it was: what must
  a rename touch? The survey (approval_requests, orders, boards, drawings, revision links,
  activity log) is what found the cascade hazard.
- **The activity log is the diagnostic tool of choice on this app.** It is append-only and it
  recorded the double claim to the second, weeks before anyone looked.

---

## What was changed on 2026-08-11 (session — user filter, Stage 2 override, PWA, order links, and a repair that was WRONG)

Eleven commits, `74b22e4`..`5a3231f`, all pushed and confirmed SERVED. Everything below was found by
running the code, querying live data, or by the team using the app.

### Shipped and verified
1. **Project List "Only mine" filter** (`74b22e4`) — Rommel corrected the queued ask: **filter, not
   sort**. A VIEW filter, not a permission. Matches the same expression the save writes into the
   User column, so it cannot fail to match your own work. Verified against the real distribution
   (171 all / 31 mine / 34 Jhover / 81 Rommel); persists; survives re-renders.
2. **⚠ Stage 2 never inherited an approved override** (`86a7f5a`) — reported on QT-W00000052.
   `initFinalQuotation` gated ALL inheritance on `if(!fqApprovalsFromSave)`, and that flag comes
   from `state.fqVatApproved!==undefined` — **a key every save writes unconditionally**. The
   sentinel could never be false, so Stage 2 inherited nothing unless opened in the same session
   the quotation was created. `fqCustomCFApproved` was true on **0 of 157**. Now inherited **per
   field**, so a real Stage 2 approval is still never reset. Gaps were CF 3, VAT 76, discount 8,
   premium 0; nothing already issued moved. Existing quotations self-heal on next open — confirmed
   by Rommel: W52 now matches the Initial Quotation.
3. **Modcraft is installable** (`5675047`) — its own section above.
4. **Orders show what became of each order's quotation** (`e4c63e4`) — serial + live status + value,
   clickable via `openQuotationFromDir` (which already guards unsaved work). Where there is none it
   says why: In Progress → *exported, no quotation saved yet* (that is the 10).
5. **Status pills were under AA** (`17b8d56`) — app-wide, not just the new card. Fixed the INK via
   new `--pill-*` tokens; base palette untouched so nothing else moved. Worst 3.06 → **4.66**.
6. **⚠ Opening a quotation from the Project List showed the PREVIOUS one** (`30261a5`) — its own
   section above. A hand-rolled copy of `navigate()`.
7. **An archived option can be brought back** (`e32ba30`) — Rommel's "un-archive" question was
   about **options**, not quotations (I answered the wrong thing first). Approving one option
   archives the others but KEEPS them; there was no way to reach them. "N archived" is now a button
   → Restore. Also fixed a bug it made reachable: `confirmOptionApprove` archived only ACTIVE
   options, so re-approving left **two approved at once**.
8. **⚠ The creator no longer loses their quotation** (`8542794`) — reported as a user mix-up on
   QT-W00000076 (Japan Baking Inc): Joanna made it, the list showed Stephanie. Every save rewrote
   column B (Created) and column H (User) with *now* and whoever was saving, so both followed the
   last saver. Measured: **14 credited to the wrong person, 61 with a moved created date** (two
   claiming they were created that same morning). It also skewed Team performance and the new "Only
   mine" filter, which read the same field. The row lookup now reads `A:H` and keeps what the row
   already recorded; a first save still records its creator; a blank legacy User is filled in.
   Rommel's rule: *"the original who open should keep that quotation. However, if any changes were
   made by other users, it should show in the log files."* — which it already does, and column Z
   (Last Updated) still moves.

### ⚠⚠ THE REPAIR IS DISABLED — READ BEFORE TOUCHING IT (`4cff4e0`, disabled by `5a3231f`)
`reconcileQuotationCreators()` was built to repair those 14 + 61. **Its premise was wrong.** It
assumed the EARLIEST `activity_log` entry for a serial is that quotation being created. It is not:
`gLogToSheets` stamps `serial: qSerial` — whatever quotation is open in that person's browser — so
unrelated admin actions land on an unrelated serial.

Caught by spot-checking the dry run **before applying**:
```
M00000090  earliest = "Signature uploaded for Rommel Taligatos"   → Jhover actually built it
M00000106  earliest = "Signature uploaded for Allan Lagsao"       → Jhover, from Order #8843
M00000091  earliest = "Message sent to Jhover Galupo"             → Rafael, from Order #8844
M00000028  earliest = "Quotation unlocked (approved by ...)"      → an approval, not a creation
```
**Five of its thirteen credit changes pointed at Rommel purely because he is the admin whose
session was open.** Applying it would have replaced one wrong answer with a different wrong answer,
on live data, permanently.

**DROP the created-date repair entirely.** An unrelated admin action makes the earliest entry too
early; a renumber (first entries logged under the provisional serial) makes it too late. Not
recoverable, and a differently-wrong date is not an improvement.

> **The lesson, and it nearly cost real data:** I verified the *mechanism* (the log is append-only
> and records who did what) and inferred the *meaning* (earliest entry = creation) without checking.
> A dry run is only as good as the assumption behind it — read what the rows actually SAY, not just
> how many there are.

### ✅ REBUILT 2026-08-11 (`e8eed32`) — and the prescribed markers were BOTH wrong
This entry originally said to rebuild on two activity-log markers, "48 and 17 serials". Checked
against the data before writing anything: **one is void and the other is the worse copy of a fact
the state already holds.** Same lesson as above, one level down — the counts were right and the
meaning was assumed.

- **`"Quotation created from Order #NNNN"` is UNUSABLE BY SERIAL** — the identical failure.
  `exportOrderToQuotation` clears `qSerial`, so every export before the next save reuses the same
  **preview** number. `QT-M00000107` carries **eight** such entries for five different orders by
  three people; `M00000106` five; `M00000108` six. **Ten of the serials it names do not exist as
  quotations at all.** Matched by **ORDER NUMBER** instead it is sound — all 11 order-created
  quotations resolve to exactly one exporter — but every one **already agrees** with column H, so
  it yields no corrections whatsoever.
- **`"Signature applied to Prepared by (NAME)"` is real but redundant and dirtier.**
  `state.signatures.prepared` already holds the same name **plus the email**, as structured data.
  On the 4 serials where the two disagree (`M00000106`, `W00000052`, `W00000070`, `W00000080`) it is
  the **LOG** that is contaminated — its entry sits before or after the state's own stamp, from
  someone else's session. Using the log would have added four errors.

**`checkQuotationCredits(execute)`** replaces it: signature out of the state, exporter matched by
order number where there is no signature, **nothing from the log by serial**. Measured on all 169
rows — **1 correction, 54 confirmed, 1 with two hands, 113 with no evidence either way.**

- The 1 is **`QT-W00000076` (Japan Baking Inc), Stephanie → Joanna** — exactly the one Rommel
  reported. **The "14 mis-credited" figure was an artefact of the broken repair's own comparison.**
- The 1 "two hands" is `QT-W00000034`: Kaye exported it from Order #8834, **Rafael signed it**,
  column H says Kaye. It changes nothing and prints both, because which of them owns it is a
  question for a human.
- The 113 are reported as a gap, not as a clean bill of health. Of those, 108 show only one person
  in their log, so nothing suggests they are wrong; **14 show more than one and are simply
  unknowable** — of which only `QT-W00000027` (column H = Stephanie, log shows only Jhover and
  Rommel) looks odd, and the log is too unreliable there to call it.

`reconcileQuotationCreators()` stays, permanently refusing, and now points at the replacement.

**Surfaced as a button** (`b4ff744`), in **Settings → Company & DB → Check Project List**, with the
other repairs — a console-only repair is one nobody runs. `_findQuotationCredits` is the single
analysis both the panel and the console call, so they cannot disagree. 21 assertions, covering the
button path: it makes the identical change, confirms first, does nothing before a check has run,
and the panel stays silent when it cannot read.

**Contrast, measured:** full-strength `--coral` on `--wash-amber` is **3.49:1** in light — under the
4.5 needed at 12.5px. Now `--pill-coral` (the ink darkened 2026-08-11 for exactly this), 5.1:1. The
identical pairing one block up in `_reportSerialSplits` had the same miss and is fixed with it.

> ⚠ **Found, NOT fixed — every `.btn-primary` in the app fails AA in dark mode.** White on
> `rgb(91,149,209)` = **3.15:1**, all **31** of them. Pre-existing and app-wide, so it was left out
> of a credits repair — but note the 2026-08-08 dark-mode pass claimed "zero low-contrast text in
> dark", and that measurement evidently did not cover button labels on accent backgrounds. Fixing
> it changes the primary button on every screen, so it is Rommel's call to see first.

### Still open from today
- ~~**Client Declined is a one-way door**~~ — **NOT AN ASK. Corrected by Rommel 2026-08-11:**
  *"I never asked for the decline but the archived for the option which you already corrected."*
  He meant restoring an **archived option**, which shipped in `e32ba30`. The decline observation was
  mine, not his, and it was written into the open list as though he had raised it. **Do not raise
  it again unless he does.**
- **The in-quotation Reactivate banner is dead code.** `_qIsArchived()` tests `status==='Archived'`,
  which is not on `STATUS_LADDER` and is never written — archived is derived from age now. The
  Project List's Restore button uses the correct derived test and works.
- ✅ **SERIAL DATA CLEANED 2026-08-11 — renumbers and duplicates both done, live.**
  `reconcileRenumbered(true)` applied 7 (6 renames + the MASTECH duplicate); verified in the
  database that every row now matches the number the quotation itself carries. Then
  `removeDuplicateQuotationRows(true)` cleared the 3 duplicate rows (`QT-W00000031`,
  `QT-W00000041`, `QT-C00000004`) — the sheet went 70 rows to 67. **Check Project List now reports
  only Bella Ferma**, deliberately left for Stephanie. `qBaseSerial` removal is unblocked once
  that one is settled.

  ⚠ **Two things I got wrong here. Both are the same mistake — asserting from the wrong source.**

  **(a) The Project List CANNOT show a duplicate row.** `gLoadDirData` dedupes by base serial, so
  two rows always render as ONE line and a search returns "1 quotation". Rommel checked two serials
  that way, saw one row each, and I closed the item on it. Only Check Project List, which counts
  raw rows, can see them — it then reported three. **Never treat the Project List as evidence about
  rows.**

  **(b) The first duplicate rule refused all three real cases.** It removed only rows identical
  apart from Date, taken from Keystone where two rows were written 529ms apart. But a stale copy is
  FROZEN while the live row keeps updating, so it differs *by definition* — C00000004's orphan
  still held ₱27,524,032.69, the bloated pre-cabinet-count figure from 08-10. The differences were
  the evidence and the check treated them as the objection.

  **The right rule:** two rows under one serial are always one quotation (there is exactly one
  saved state per number), so the question is never "are these copies" but "which row is LIVE" —
  the first, since `_proceedSaveQuotation` breaks on first match. That is now cross-checked against
  Supabase's own total for the serial, and refused if the live row turns out not to be the first.

  ⚠ Still true if a duplicate reappears: `sheetsDeleteRowByKey` also breaks on first match, so it
  would delete the LIVE row. Delete by index — `_sheetsDeleteRowsByIndex`.

---

## What was changed on 2026-08-11 (session 2 — A DRAFT HAS NO QUOTATION NUMBER: the cause fix)

Rommel, after clicking the credits repair: *"why it keeps happening? Can we do a permanent solution
to avoid mix up, issues on numbers. I cannot do this forever you know."* Correct, and the answer was
one cause, not many. Commits `7e2bae5`, `9e87bab`, `ef05328`.

### ⚠⚠ THE RULE, AND DO NOT UNDO IT
**A quotation has NO number until one is claimed at its FIRST SAVE.** An unsaved draft carries
`qDraftKey` — `DRAFT-xxxxxx`, six random hex, unique to that draft on that machine.
**`_peekNextSerial()` IS DELETED. Never reintroduce a "what the next number would be" preview.**

`initQuotation()` used to set `qSerial = _peekNextSerial()`. The counter does not move until someone
saves, so **every draft open anywhere in the company showed the same number at the same time**, and
everything logged, exported or filed until the first save carried it.

Six separately-documented problems were all that one line:
| Symptom (each previously "fixed" on its own) | |
|---|---|
| Order exports landing on the wrong serial | `QT-M00000107` carries **8** entries, 5 orders, 3 people; **10** of the serials named never existed |
| The row/state serial split | 9 quotations |
| Four contaminated "Signature applied to Prepared by" entries | the log disagreeing with the state |
| "The serial reset to 1" | the peek before counters loaded |
| The double-claim race → 108/109/110 | two claims in flight for one draft |
| **The creator repair that had to be disabled** | it failed ENTIRELY because it read those entries as fact |

The repair Rommel ran that morning was itself logged under `QT-M00000111`, **a serial that does not
exist** — the bug stamping itself onto the record of its own repair. That is the one-line proof.

### What was removed, not just unused
`_peekNextSerial`, `_claimPeekedSerial`, `_syncBaseSerialToPreview`, `serialCountersLoaded` (a
write-only flag — the same shape as the `pin_hash` mirror columns dropped 2026-08-08), and the
module-load `var qSerial = makeSerial()` placeholder. All existed only to keep a fake number honest.

### New
```javascript
qDraftKey          // 'DRAFT-xxxxxx' while unsaved; '' once a real serial exists
_newDraftKey()     // mints one
_quotRefLabel()    // what to PRINT where a number goes: qSerial, else 'DRAFT-xxxxxx — DRAFT, not yet numbered'
```

### ⚠ `!qSerial` CHANGED MEANING — it now means "this is a draft", not "nothing is open"
All 120 `qSerial` reads were audited, not sampled. Sixteen guard on emptiness. Fifteen were already
right; **the four Drive/Storage savers are now MORE correct** — they used to file under a borrowed
number and now correctly wait. **Any new `!qSerial` guard must decide which it means.** The three
that were wrong:
1. **The client-facing printout header** printed a blank. Preview & Print is lock-exempt, so this
   reaches a client's screen — now `_quotRefLabel()`.
2. **`generateBomReport` archived to Drive under an empty serial**, which would have created a
   folder and a file named `" — Client — BOM"` belonging to no quotation. It now opens the report
   and says the archive waits for the number.
3. **`generateBomReport`'s own first guard** read `!qSerial` as "nothing is open" and would have
   refused a good draft while saying no quotation was open.

Checked and safe: options (`createNewOption` requires a lock, which requires a save, so it never
sees a draft), approval requests (already `||'—'`), `_canDiscardDraft`, `_archiveOrdersForQuotation`,
`_assertSerialAgreement`, and every `sessionQuotations`/`dirData` lookup — an empty key matches
nothing. `_fallbackSerialCheck` (no claim service) used to collision-check the previewed number;
it now mints one and **refuses the save** if it cannot, rather than filing under an empty key.

### Orders link at pickup (`ef05328`) — Rommel's observation, and he was right
The order got **no** link between export and share, which is why 9 read *"In Progress · no quotation
saved yet"* indefinitely. There was nothing to record. Now `exportOrderToQuotation` stores the draft
key immediately and `_acceptClaimedSerial` swaps it for the real number at claim (without that swap
the card would say "being drafted" forever and `_archiveOrdersForQuotation` would never match).
Card reads *"being drafted — DRAFT-96c48f (number assigned when it is saved)"*, then the normal
clickable serial. Returns before `_orderQuotationEntry`, which looks up `dirData` and would never
find a draft key.

### Why the number is claimed at SAVE and not at LOCK (Rommel asked; the answer matters)
A saved quotation needs a key — the Quotations row, the state record, the Drive folder, options and
the Project List are all filed under it. If the number arrived at lock, a saved-but-unlocked
quotation (56 of them) would be filed under its draft key and **renamed** at lock — and renaming an
already-filed row is exactly the mechanism that produced the split and the duplicate rows.
**Claim at the first moment a permanent record exists, never before.**

### Not changed
The **status ladder is untouched.** A quotation only enters the Project List once saved, so an
unsaved draft was never on the ladder. "Draft" still means *saved but never locked*.

### Verified in a browser against the real code, not by reading
No number before login · a new quotation shows only its draft key · two drafts get distinct keys ·
navigating away and back keeps the draft (this one matters — `navigate()` and `confirmUnsavedThen()`
both tested `qSerial` as "is a quotation open", and without the draft key they would have silently
discarded it) · a pre-save action logs under the draft key · saving claims `QT-W00000200`, files the
row under it, matches `qBaseSerial`, advances the counter, logs the join · reopening a saved
quotation, options, revisions, the printout header and the serial-agreement assert all unaffected ·
a tripwire on every write path (`sheetsAppend`, Drive folder, Drive file, Supabase upload) asserting
none is ever called with an empty or leading-dash key while a draft — **zero violations** · the same
run after saving confirming the BOM does archive as `QT-W00000400 — Ripple Test Client — BOM.html` ·
full order chain Pending → *being drafted* → `QT-W00000500` with the link following.

> ⚠ **A `\d` in a `node -e` patch script became a literal `d`**, so the save-refusal guard rejected
> every valid serial and refused the save outright. Caught only because the save test failed.
> **Use the Edit tool for anything containing a regex or a backslash** — this is the third time a
> shell/heredoc has mangled an escape in this repo. Every regex added in a session should be
> re-listed and eyeballed before commit (`git diff | grep -oE '/[^/]*/[gimsuy]*'`).

### Still open after this
It does **not** repair the 9 existing split rows or the 2 duplicate rows — those still need
`reconcileRenumbered()` (8), Bella Ferma (1), and `reconcileDuplicateRows`. `qBaseSerial` still
exists as a stored copy; it is now much safer (only ever set from a real claim) but removing it is
still the next structural step, and it is unblocked once those rows are clean.

---

## What was changed on 2026-08-12 (session — approval routing typo, BOM client names, price DB completeness, Client Declined made reversible)

Five separate reports/requests, worked through in order.

### Approval routing ignored because of a company-name typo (commit `96accfc`)
Rommel: *"why I keep receiving request for unlock even though I already defined the approval
route?"* Routing WAS configured correctly — unlock → Allan for WCL/MSSI, Stiffany for CWL — but
`findApproverForAction` looked it up by **exact match** on `currentUserCompany`, and **8 of 13
users** are on `"Module System and Services, Inc."` (singular) in User Roles while the routing
table is keyed on the canonical `"Module Systems and Services, Inc."` (plural). For every one of
those eight — every estimator who raises a request — the lookup found nothing and fell through to
"first active Manager/Director/Admin", landing on Rommel. Not just unlock: non-VAT was silently
doing the same, invisible only because it also routes to an Admin-tier person by default.
New `_canonCompany()` matches by keyword (same pattern `_quotCompanyKey`/`_orderCompanyKey` already
use), applied at all three lookups: `findApproverForAction`, `_findSignatory`'s fallback, and
`_notedRequired`'s threshold lookup. Fixing the data instead would work until the next hire.

**Follow-up, same thread:** an approver seeing a request via Admin/Director's full-visibility
(`filterApprovalsByRouting` returns everything for that tier, by design) had no way to tell it
apart from an actual assignment. New `_apprAssigneeName(n)` + an "Assigned to: NAME" line on both
the Approvals card and the bell panel, shown only while pending (once actioned, "Actioned by"
already answers it).

### Client names on BOM cabinets, matching carcass mode (commit `6908209`)
The carcass "Name for client" alias (2026-07 session) only existed for `qAreas[].items[]`, not
`bomItems[]`. `setItemAlias(a,i,which)` now serves both arrays through one implementation;
`_carcassClientName` renamed `_lineClientName` since it no longer serves only carcass. The alias
reaches client documents only — pricing, the BOM report, the cutting list and every report stay on
`bItem.type`. Verified: unit cost identical for two same-type cabinets with different aliases, the
BOM report contains no alias text, both printout layouts (by-area, by-type) honour it and merge
same-type same-alias lines while keeping differently-aliased lines separate.

### Price DB — completeness, not just freshness (commits `9516cac`, `1d10768`, `22e02b4`)
See the "Price DB staleness" entry earlier in this file for the freshness fix itself. Same day, a
sync interrupted mid-run left the mirror at **5,000 of ~145,000 materials** — DuraSave among the
missing, reported by Rommel as a plain "SKU should exist" (correct; it did, in the sheet — the app
just wasn't reading the sheet). A truncated-but-recent mirror passes freshness by construction (its
rows carry a fresh timestamp), so **completeness is now checked separately and first**: a successful
sync records the row count it wrote; the loader refuses a mirror short of that count, however recent
it looks. The "Sync fast copy from Sheets" button was also moved out of the warning banner and made
permanent — it had been hidden exactly when the truncation made the detector blind to the problem.

### Orders "suddenly archived" traced to Client Declined destroying recoverable work (commit `bc43d39`)
Rommel's report: *"When Orders suddenly got archived. Some with quotation already and locked."*
Checked the actual data first — all 6 currently-archived orders matched the documented design
exactly (4 client-approved/won, 2 declined), nothing anomalous. First pass wrongly generalised this
into a design discussion about win-triggering; Rommel redirected: *"wait, what are we even
discussing about client declined? we are talking about archive of orders."* — correctly separating
the ORDER-archiving question from what turned out to be the real, connected finding underneath it.

**The actual finding:** clicking "Client Declined" is `confirmCancelQuotation()`, which — until
today — set `qCancelled=true` (permanent, no undo anywhere in the app) AND immediately deleted the
drawing analysis, raw upload, and board layout from Drive/Storage, on the reasoning (written into
the function's own comment) that decline was final so there was no undo window to protect. That is
exactly what broke: a client saying no today and yes next month is ordinary, and the design work
was gone before anyone could revive it — *"when they revive it, the quotation needs to be redone."*

Rommel's decision: *"Decline, yes but revivable."* Two changes:
1. **`_cleanupCancelledQuotationFiles()` and its call are removed outright** — nothing deletes
   supplementary files on decline any more. The function had exactly one caller; an unused
   destructive function is worse than not having it.
2. **A "Reactivate" button** beside the status pill, shown whenever `qCancelled`, with the original
   reason and date. Clears the decline, reopens whichever order it had archived
   (`_reopenOrdersForQuotation` — the literal inverse of `_archiveOrdersForQuotation`, reusing
   `reopenOrder()` rather than a second copy of the status-change logic), logs both the reactivation
   and what it undoes. No PIN — declining itself needs none, so undoing it holds the same bar.

⚠ **This reverses the 2026-08-11 note that said not to raise Client Declined again** — that note
was correct for what was actually said that day (Rommel meant restoring an archived OPTION), but
Rommel has now separately and explicitly asked for decline to be reversible, and it is built.

**A contrast check went sideways and is worth recording as a caution, not a finding.** The banner
text first measured 3.66:1 in light mode — under the 4.5 needed. Investigated rather than patched:
the reading came from a DOM background-walker landing on a **leftover coral-tinted element from
earlier testing in the same long-lived preview tab**, not the real header. A fresh page load still
produced a wrong-looking amber background for the same reason (accumulated test-page state, not a
clean quotation-page context). Measuring the two tokens the row's source literally uses
(`background:var(--card)`, `color:var(--text2)`) via a clean isolated probe gave 5.74:1 light /
8.18:1 dark — both pass. **No code change was needed; three consecutive bad readings were the rig.**
Long-lived test tabs accumulate DOM state across unrelated features — a stale coral/amber div from
an earlier test can silently corrupt a later contrast check. Reload before trusting a contrast
number in a tab that has been used for several different feature tests.

### Still open from today
- **Should a WON quotation still auto-archive its order?** Rommel: *"I don't remember having such
  direction."* `confirmClientApprove()` calls `_archiveOrdersForQuotation(...,'quotation won')` —
  this was added when Close Project was removed (2026-08-08), to stop orders sitting with their
  clock running forever, but was not something Rommel recalls directing. **Not changed** — ask him
  directly: keep it, remove it, or tie it to a different trigger (e.g. the quotation's own 30-day
  ageing-archived stage) before touching `confirmClientApprove`.
- The pre-existing, unrelated, genuinely dead `_qIsArchived()` / `_updateReactivationBanner()` /
  `doReactivate()` subsystem (tied to the OLD ageing-archived status value that is never actually
  written) is a **different "Reactivate" concept** from the one shipped today. Same label, same
  icon, unrelated code, no collision (checked) — but worth knowing there are now two, so a future
  session does not try to merge them. The old one stays exactly as documented in the entry below.

## What was changed on 2026-08-12 (session 2 — option locking, and the mobilization/transportation investigation)

### ✅ FIXED — unlocking an option didn't stick; switching away and back silently relocked it (`20c5cd0`)
Rommel: *"when they lock quotation of option 1, the option 2 also gets locked... when you unlock one
option for example option 1, option 1 should be unlocked and options must remain on their current
state."*

**Root cause, confirmed by reproduction, not by reading.** `doLockOnly()` correctly stamps
`qOptionsList[activeId].locked=true` on the option it locks. `confirmUnlock()` correctly clears the
LIVE `qLocked` variable in the moment — but never cleared the OPTION's own `.locked` flag. And
`switchToOption()` always lets the option's own `.locked` win over whatever the snapshot says on
switch-IN (deliberately, so a stale snapshot can't misreport lock state). So the sequence was:
unlock option 1 (looks unlocked, right now) → switch to option 2 → switch back to option 1 →
`switchToOption` reads the STALE `qOptionsList[1].locked` (still `true`, never cleared) and
re-locks it. That is the exact shape of "option 1 shows locked again" — most likely what Rommel's
team described as "option 2 also gets locked," garbled in the retelling of a confusing back-and-forth.

**Fix:** `confirmUnlock()`'s Stage-1 branch now also clears `qOptionsList[activeId].locked` — the
exact mirror of what `doLockOnly()` sets. One line.

**Reproduced with the real functions** (`doLockOnly`, `createNewOption`, `switchToOption`,
`confirmUnlock`), not a synthetic mock of the lock logic: before the fix, lock opt1 → branch opt2 →
switch to opt1 → unlock → switch to opt2 → switch back to opt1 showed `qLocked===true` again.
After the fix, the same sequence holds `qLocked===false` through the round trip, and option 2's own
`.locked` flag is confirmed untouched throughout — genuinely independent, as it should be.

⚠ **First test run gave a false "still broken" reading** — `confirmUnlock()` is async
(`_verifyApproverPin().then(...)`), and reading `qLocked` synchronously right after calling it
captured the pre-unlock state before the `.then()` callback had run. Corrected by awaiting properly
before asserting. Worth remembering for any future test of this function.

### ⚠ NOT confirmed, NOT fixed — mobilization reads zero after unlock; Designers Support Transportation "still locked"
Two more parts of the same report. Investigated at length; did not reach a fix, and said so rather
than guess. Recorded here so the next session does not re-walk the same ground.

**Mobilization → zero on unlock:** built a direct repro of the actual mechanism unlocking triggers
(`_thawRates()` → `recalc()`) against a quotation with `qMobCalc` populated and the service type
set to Fabrication with Installation. **Did not reproduce** — `_pCalc.mobBase` was identical before
and after (₱15,000 → ₱15,000). `ni` (installation-included) is read live from the `cl-service` DOM
select on every `recalc()` call, not from anything unlock could leave stale, and `_thawRates()`
only ever calls Stage 1's bare `recalc()` — it never calls Stage 2's `recalcFQ()` at all, so
unlocking Stage 2 does not even refresh Stage 2's own mobilization figure at unlock time (it goes
stale, not to zero, until something else triggers a Stage-2 recalc).

**One real, confirmed structural asymmetry found along the way, NOT yet fixed:** Stage 1's
mobilization fallback (`_recalcCore`, ~line 8908) defaults the region cost to **₱3,500** when the
region selector has no valid value. Stage 2's equivalent (`_recalcFQCore`, ~line 22154) defaults to
**₱0** in the same situation. Same class of Stage1/Stage2 drift this codebase has repeatedly had.
This is a plausible contributor if Stage 2's `fq-mob-area` element is ever unpopulated when a
Stage-2 recalc runs, but it was not caught in the act — flagged, not fixed, until it can be
reproduced.

**Designers Support Transportation "still locked":** checked every plausible gate.
`computeTransportation()`'s own `canSearch` depends only on the AI toggle, the API key, and the
destination field being filled — **nothing checks `qLocked`/`fqLocked` at all**. Searched the whole
Mobility & Accommodation Planner render region (~line 30700–31790) for any lock-state reference —
**zero matches**. The Mobilization Calculator card on the quotation page itself
(`renderMobCalc`/`computeMobCalcAI`, ~line 5564–5760) was also checked — its `disabled` attributes
are tied to whether a line is excluded (`ex`), not to lock state either. **No code-level gate tying
either tool to the quotation's lock state was found.** This does not mean nothing is wrong — it
means the cause is not a simple "checks qLocked" gate, and needs either a live repro with the
Designers Support tab actually open in a real signed-in session, or the exact button/field Rommel's
team found unresponsive, named specifically.

### What to ask for next time this comes up
1. **Exact button or field** that stayed "locked" in Designers Support — a screenshot or the precise
   label, not "the transportation tool" generally. Two different UI surfaces both mention
   transportation (the quotation's own Mobilization card vs. the separate Designers Support →
   Mobility & Accommodation Planner tab) and the investigation could not tell which from the report.
2. **Whether the zero was seen in Stage 1 or Stage 2** — the two stages have separate, hand-written
   mobilization calculations (see the ₱3,500-vs-₱0 asymmetry above), and "mobilization" without a
   stage is not enough to point at one function over the other.
3. If possible, catch it live and check the browser console for `[pricedb]`/`[migrate]`/error output
   at the moment mobilization reads zero — the existing console warnings in this app are usually the
   fastest way to the real cause, faster than reconstructing the sequence after the fact.

# OPEN — updated 2026-08-12 (session 2) (THIS IS THE AUTHORITATIVE LIST)

## Quotation credits — `reconcileQuotationCreators()` is dead; use `checkQuotationCredits()`
The old one stays deployed and permanently refuses (Rommel has the command in his scrollback); it
credited quotations to whoever's admin session happened to be open. **Do not re-enable it, and do
not rebuild it on activity-log markers** — both markers the handoff prescribed turned out wrong
too. See the ✅ REBUILT note in the 2026-08-11 session entry for what the data actually says.

**Settings → Company & DB → Check Project List** now lists it with the other repairs, with a
"Correct all N" button (`checkQuotationCredits()` / `(true)` is the same thing from the console).
**It has one correction to make: `QT-W00000076` (Japan Baking Inc), Stephanie → Joanna** — the row
Rommel reported. Everything else is either confirmed, or carries no evidence either way and says so.
Safe to re-run; refuses if Supabase is disconnected.

## ⚠⚠ A DRAFT HAS NO QUOTATION NUMBER — do not undo this
Shipped 2026-08-11 (`7e2bae5`), the cause fix behind six separate "number" problems. An unsaved
draft carries `qDraftKey` (`DRAFT-xxxxxx`); a real serial is claimed at **first save**, never before,
and **never at lock** (that would reintroduce the rename-a-filed-row mechanism that caused the split).
**`_peekNextSerial()` is deleted — never reintroduce a next-number preview.** Note `!qSerial` now
means "this is a draft", not "nothing is open" — any new guard must decide which. Full detail in the
2026-08-11 session 2 entry above.

## ⚠ FIRST THING NEXT SESSION
1. ~~Keystone~~ **DONE 2026-08-10** — see the 2026-08-10 session below. Row 64 (the orphan)
   deleted, `state.serial` corrected 074 → 075, 074 kept in `prevSerials`. Verified: row, state
   and base all agree; Keystone is off the mismatch list. All four split quotations are now closed.
2. **Remove `qBaseSerial`** — the by-construction fix for the serial split (see the box above).
   76 references, 13 assignments. Own session with a before/after test over real saved states.
   ⚠ Note it does **not** address the duplicate-row failure mode — that is a different problem
   (two rows for one job, rather than one row under the wrong number), already closed separately
   by `_quotRowWrite`.
3. ~~Ask Rommel: should a client-approved (won) quotation still auto-archive its order?~~
   **ANSWERED + SHIPPED 2026-08-12 (`dc2e78b`).** No — removed outright, no replacement trigger.
   See that session's entry for the full reasoning (stays on record until production/logistics can
   signal real completion, which does not exist yet).
4. **Mobilization reads zero after unlock; Designers Support Transportation "still locked" after
   unlocking.** Reported 2026-08-12, investigated at length, NOT reproduced or fixed — see that
   session's entry (session 2) for everything ruled out. Need from Rommel: which stage (1 or 2),
   and the exact button/field, before this can be chased further. One real but unconfirmed lead:
   Stage 2's mobilization region fallback defaults to ₱0 where Stage 1's defaults to ₱3,500.

## What was changed on 2026-08-10 (session — Keystone closed, and the duplicate made legible)

### Keystone `QT-W00000075` resolved (`9ae0f59`) — RUN AND VERIFIED
The two Sheet rows were confirmed identical in **26 of 27 columns** — only the Date differed,
`08:57:03.620Z` vs `08:57:04.149Z`, **529ms apart**. That is the double-append race caught exactly:
two saves both read column A before either append landed.

`reconcileDuplicateRows()` — plan-driven, dry run first, same shape as the other repairs.
**Which row goes is not arbitrary:** `_proceedSaveQuotation` finds its row with `break` on the
FIRST match, so the earlier row is the live one it keeps updating and any later row is an orphan
that will never be written again. `sheetsDeleteRowByKey` also breaks on first, so using it would
have deleted the LIVE row and kept the orphan — hence `_sheetsDeleteRowsByIndex`, deleting by
index, highest first so one delete cannot shift the next. Supabase needed no row delete (`serial`
is its primary key, so the duplicate was Sheet-only); the state fix went to both.

Applied 2026-08-10: 1 applied, 0 failed. Verified in Supabase — row key, `state.serial` and
`baseSerial` all `QT-W00000075`, `prevSerials` holds `QT-W00000074`. **9 mismatches remain, all
previously known** (8 in `RENUMBER_PLAN` + Bella Ferma).

> **Rommel's rule, stated 2026-08-10:** *"we keep the client portion since it's consistent with the
> quotation itself and the printout."* Keystone was sent to the client as **075**, seven seconds
> before the stray claim produced 074 — so the ROW was right and the STATE was the artifact, the
> reverse of the other three. Same principle, opposite mechanical direction. Do not assume the
> repair direction from the symptom; read the log, which records `serial: qSerial` — the number on
> the printed PDF.

### A duplicate row now reads as a duplicate (`09aa4ca`)
The split report counted ROWS and called them quotations, so Keystone showed as two identical
lines and the headline read "10 quotations" when it was 9. The duplicate was visible only as an
accidentally repeated line — the weakest possible way to surface a distinct fault. Now the
headline counts distinct serials, and any serial on more than one row gets its own coral callout
naming it and saying what it means. Contrast checked in both themes (14.73 light, 12.03 dark).

### ⚠ The carcass count is required, not invented (`93b1720`)
Reported as *"its super bloated"* on **QT-C00000004** (Stiffany Gabut, CWL): a ₱27,374,680
quotation with ₱10,273,375 of installation against ₱136k of fabrication.

**Cause:** `getInstallCarcassUnits()` fell back to `getTotU()` in services mode when no carcass
count was entered — contradicting the comment directly above it, which says svcItems quantities
are panel/edge-banding counts in mixed units and **NOT a cabinet count**. It billed 1,112.69
linear metres and holes as 1,112 cabinets to install. The quotation already knew its project size
was 228 COMPONENTS; nothing knew how many cabinets there were, because a cutting list does not say.

**Rommel's call:** *"since carcass is critical instead of inventing it, why not show notification
that it is required since many are dependent on it. Then prevent lock activation."* — better than
the floor-at-1 option offered, and it made the fix simpler.

- `getInstallCarcassUnits()` returns **0** in services mode when blank. Zero is safe ONLY because
  of the gate — a quotation with no count can never be issued — so it cannot become a silent
  under-charge, which is the failure that would actually cost money.
- `_carcassCountRequired()` is true only in services mode AND when something is installed or
  assembled. Carcass and BOM modes are untouched: their item quantities ARE a real cabinet count.
- The lock gate now covers both requirements. `_projectSizeGateOk/Fail` became
  `_lockGateOk`/`_lockGateFail`/`_lockGateReason` and route to whichever card is missing —
  **renamed rather than left with a name that no longer says what it checks.**
- `renderCarcassCountNote()` states it on the card itself, not only in a disabled button's tooltip.

Verified through the normal `recalc()` path: blank → units 0, lock disabled, Lock refuses and the
quotation stays unlocked; count 30 → instBase **₱10,273,375 → ₱108,098**; Fab-only → not required;
Fab-only + Assembly → required; carcass mode → untouched; the service dropdown moves the gate both ways.

**Scope:** only 3 quotations in the database are services-mode with installation. QT-260603-8162 has
no service lines (₱1,200). **QT-W00000052 reviewed by Rommel 2026-08-10 — fine, no action.**

✅ **QT-C00000004 CLOSED 2026-08-11** (Rommel: *"yes the c4 is close already"*). The gate worked as
intended — its own activity log shows the correction: `Project size 0 → 228` entered 08-10 05:25,
total ₱27,524,032.69 → **₱631,128.99** at lock 06:50, and it has since been locked, unlocked,
revised and shared normally at **₱487,740.38**. Nothing further to do on the carcass count.
(The separate DUPLICATE ROW concern for this serial is still open — see the OPEN list.)

### "You are running an old version" (`8942164`)
The Google Sites embed serves a cached build long after a fix ships, and a plain hard refresh often
does not clear it. Same conversation repeatedly: fix deployed and verified, someone reports it
missing, time spent hunting a bug that is not there. Rommel: *"even I sometime got confused also."*

No build step, no version file. Pages sends `Last-Modified`, so `document.lastModified` is when the
build THIS TAB loaded was published; a cache-busted HEAD says what is published now. Checked ~20s
after login, every 15 min, and on `visibilitychange` — the realistic case is a tab left open for
days across several deploys.

Fails safe in every direction: no header → `document.lastModified` falls back to "now" per spec and
it never fires; failed fetch ignored; only ever a dismissible banner. 60s tolerance for clock skew.
Skipped on localhost/`file://` and during a sign-in round-trip (reloading mid-OAuth loses the
callback). Reload preserves every existing parameter and only swaps the cache-buster.

> ⚠ **Bootstrap:** anyone already on an old build cannot be warned by code they do not have. Bump
> `?v=N` on the embed ONCE to pull everyone onto this build; after that it is self-announcing.

> **The first version was untestable and I did not notice.** It read `window.location` inline —
> which cannot be overridden in a browser — so all six test cases silently hit the localhost guard
> and passed without testing anything. Restructured so the guards and the comparison take their
> inputs as arguments; now genuinely covered by 15 cases.

### ⚠ Stage 2 never inherited an approved override (`86a7f5a`)
Reported on **QT-W00000052**: a cost-factor override approved at Stage 1 did not reflect on the
Final Quotation.

`initFinalQuotation()` gated ALL inheritance on `if(!fqApprovalsFromSave)`, and that flag comes
from `state.fqVatApproved!==undefined` — **a key every save writes unconditionally** (line 28574).
So it was true for any quotation ever saved and reopened, and Stage 2 inherited nothing.
Inheritance only worked if Stage 2 was opened in the SAME SESSION the quotation was created,
before the first save. Normal use loses it every time.

Measured: **`fqCustomCFApproved` true on 0 of 157 quotations**, while 3 carry an approved Stage 1
override — so those priced at the override in Stage 1 and the global rates in Stage 2. W52 is one
(markup 20% via the override, 30% global at Stage 2).

**The same flaw hit VAT, discount and premium.** Gaps: CF 3, VAT 76, discount 8, premium 0.
Nothing already issued moved — 0 of the CF and discount gaps are locked at Stage 2, and the single
locked VAT-gap quotation has a frozen total.

Now inherited **per field**. The original intent stands and is preserved exactly — a real Stage 2
approval must never be reset by Stage 1's — and per-field says precisely that: take Stage 1's value
only where Stage 2 has none of its own. Verified including the protection case (a Stage 2 with its
own override keeps it; a Stage 2 with its own 3% discount keeps that AND inherits the override it
lacked). **Existing quotations self-heal the next time Stage 2 is opened** — no repair script.

> Same family as every other Stage1/Stage2 drift: the two stages are hand-duplicated. But note the
> shape here — the bug was a **sentinel that could never be false**, because the field it tested is
> always written. When a guard keys on "did this state have X", check whether X is written
> unconditionally.

### Modcraft is installable — the way off the Google Sites embed (`5675047`)
Rommel: *"I'm thinking if we can make the app installable so we can get away with google site?"*
Neither tedious nor risky, because `approve.html` had already proved the pattern in this repo.

`app.webmanifest` (separate — approve.html's is scoped to `./approve.html` and cannot serve the
main app), the manifest/theme-color/apple-touch-icon tags, and a **root-scope** registration of the
existing `sw.js`. No `orientation` in the manifest: this is desktop-first and pinning it to portrait
would be wrong on the machines it is mostly used on.

**Verified on the live site**, not inferred: root worker `activated` and controlling the page,
secure context, manifest resolves as `application/manifest+json` (a wrong MIME type silently breaks
installability), icons 192/512/maskable all 200, and **approve.html's registration intact alongside
it**.

- **approve.html's worker is deliberately untouched.** Scoped to `./approve.html`, which is
  narrower and therefore wins for that path, and its push subscriptions are bound to it. Push works
  and its first live test is still pending.
- **Two registrations share one `sw.js`, which caches NOTHING.** That is precisely what makes the
  overlapping scopes harmless.
- Never registers on `file://` or localhost — a worker installed from the dev preview would sit in
  front of it for every later session.

**Additive on purpose. Nothing was taken away** — the Google Site still works, both point at the
same URL, nobody is forced to move. Retire the Site later, once it is already redundant.

> ⚠ **One consequence:** installed, there is no iframe, so today's Supabase session does not carry
> over — one "Connect now" each. After that auto-connect works *properly* instead of fighting the
> storage partition that forced the manual button in the first place (see 2026-08-05).

> `sw.js`'s header claimed it was scoped to approve.html "so the main app is out of reach
> regardless", and its offline notice talked only about approvals. Both stop being true the moment
> it serves the main app, so both were corrected. A comment that lies is what produced the
> `getInstallCarcassUnits` bug.

### ⚠ Opening a quotation from the Project List showed the PREVIOUS one (`30261a5`)
Reported as a delay — *"it retains the previous quotation, then going back and returning updates
it."* It was **not** a delay, not the network, and not a race: it happened every single time, and
the quotation data was never wrong. Only the **pinned total bar** was stale, showing the previous
quotation's serial, stage and grand total.

`restoreFullQuotationState` reveals the page **last**, after everything that renders into it. The
total bar refuses to redraw unless the quotation page is on screen (`_qTotalBar`'s `onQuot` early
return), so `recalc()`'s refresh of it ran while the page was still hidden, took the "not my page"
branch, switched the bar OFF, and kept the old figures. The hand-rolled `.active` class toggle that
followed never asked it again. Going back and returning goes through `navigate()`, which does.

Reproduced before fixing: bar showed A's ₱65,478.17 after opening B, then B's ₱14,550.70 once
navigated away and back.

**Fixed by calling `navigate('quotation')` instead of a hand-rolled copy of it.** That block did
most of what `navigate()` does but not all — it also does `_navScrollActiveIntoView()`,
`_qTotalBar()`, and clears `dirSelected`. Anything added to `navigate()` later is now picked up
here instead of quietly going missing.

Three risks checked rather than assumed, and all three would have been regressions:
- `canNavigate('quotation')` allows **Quotations OR Projects**, so view-only users still get in.
- `_buildQuotationLayout()` is idempotent (containers built once, every move guarded), so the call
  earlier in the restore plus `navigate()`'s is harmless — verified no duplicated cards or rails.
- `navigate()` calls `initQuotation()` only when `qSerial` is empty, which **would have wiped the
  state just restored**. `qSerial` is set at the top of the restore and always gets a value.

> **The shape worth keeping:** a hand-rolled copy of an existing routine that does *most* of it.
> The copy does not stay in step, and the gap surfaces as something that "fixes itself on the
> second try". When a symptom is *intermittent-looking but actually deterministic*, suspect an
> ordering or a duplicated code path, not timing.

### Also worth knowing
- **`QT-W00000048` (Prime Dimension) is in Supabase but not the Sheet**, so the in-app check never
  lists it while a SQL query does. That is the known orphan gap (Supabase ~171 rows vs Sheet ~75),
  not a new fault — but it is why the two counts differ by one.
- **Calling a function directly proves the logic, not that the app ever reaches it.** Rommel asked
  what this meant; it is worth keeping. A note that only appears when summoned is invisible to a
  user. Test through the path the app actually uses (`recalc()`, the button's own handler). This
  has bitten twice: `renderSignatureBar` hooked to a function `updateLockUI` never called, and the
  build-check rig above.

## QUEUED — requested by the team 2026-08-10

### 1. Filter the Project List by user — ✅ DONE (`74b22e4`)
Rommel corrected the ask: **filter, not sort** — "so what they can see are the quotation made by
them only." (Sorting by the Assigned column already existed and is a different thing; at 171
quotations, sorting still leaves you hunting for your own block.)

A user dropdown in the filter bar with **"Only mine (N)"** first, then everyone else. A **VIEW
filter, not a permission** — everyone can still see everything; this only changes what is on
screen. Choice persisted to `localStorage`.

"Only mine" matches the same expression the save writes into the User column
(`gUser.name||gUser.email`), so it cannot fail to match something you saved. Verified against live
data first: that column holds real names (Rommel 81, Jhover 34, Stephanie 31, Joanna 15, Kaye 10),
no blanks, no shared-mailbox aliases. The dropdown is built from the rows present, never the
roster, and is only rewritten when the option set changes — otherwise an open dropdown would be
dropped mid-click on the next render.

### 2. Attach a screenshot or file to a quotation as evidence
Their examples: a client declines by message → attach the screenshot; a client asks to change
materials → attach the email or photo. The point is a durable record of WHY something happened.

**The storage half already exists** and should be reused, not rebuilt:
`supaUploadQuotationBinaryFile()`, `_driveUpsertBinaryFile()`, `_base64ToBlob()`, and the
per-quotation folder that already holds the state JSON, printouts, board layouts, drawing analyses
and copied Wufoo attachments.

What is missing: an attach control + a note/reason, a list to view and download, and a link from
the **activity log**, since an attachment is evidence *for an event* and the log is the app's
existing permanent record.

Decisions to settle with Rommel before building:
- **Where it lives** — a card on the quotation, or an action on the activity-log entry it explains?
- **Deletion** — evidence probably should not be deletable at all, or Admin-only with a log entry.
  Worth deciding deliberately rather than defaulting.
- ⚠ **`_cleanupCancelledQuotationFiles()` deletes supplementary files when a quotation is
  cancelled.** Evidence must be EXEMPT from that, or the record of *why it was cancelled* is
  destroyed by the cancellation — exactly the case they are asking for. Its allowlist is matched on
  4 exact filename markers, so a new marker has to be added and deliberately left out of the wipe.

### 3. Make the serial and client name clickable on the Approvals page — STILL OPEN
(The same pattern shipped for ORDERS on 2026-08-11 via `_orderQuotationLine` / `openQuotationFromOrder`
— reuse that: it calls `openQuotationFromDir`, which already routes through `confirmUnsavedThen`.)

### 3 (detail)
`renderApprovals()` shows serial + client as plain text; an approver has to go and find the
quotation themselves. Make both open it, the way Project List rows already do.

⚠ Must route through **`confirmUnsavedThen()`** — an approver may have a quotation part-written,
and navigating away without that guard silently discards it. The Project List rows go through it;
this must too.

## Cleared 2026-08-09
Signature requests carry their figures to the phone · the double-claim serial race (cause) ·
three of the four split quotations repaired onto the client's number · a split can no longer reach
the sheet silently · Check Project List reports splits · the `_supaReconcileOne` cascade hazard ·
duplicate rows refused rather than half-renamed · serial FKs ON UPDATE CASCADE ·
**item #4 (QT-W00000087 re-route) confirmed done** — both slots signed 08-08.

## Cleared 2026-08-08 (session 3)
The stage ladder as agreed · sending as a rung · FQ Locked · revision visible · Closed removed ·
ageing on last-update with a 30-day archive · declined hidden after 30 days · lock timestamps no
longer destroyed on reopen · the two actions that never saved · stage derived rather than trusted ·
in-app drift detection and repair (statuses, lost lock dates, and dates that never reached the
Sheet) · every repair clearing its own banner · drafts out of the win rate · the response clock
ending per arrival source · client-facing carcass names · discard a draft · Lami taught all of it.

## Cleared 2026-08-08 (session 2)
Fallback Checked-by **and** Noted-by · the "repeating" signature request (it was `sigSlot` never
being persisted — the flow had never completed) · partial saves nulling `to_email` · signature
requests badged "Revision" · Re-route for a stuck request · serial preview showing `1` · SLA day
label on a 6-day week.

## Cleared 2026-08-08
Deploy backlog (was a stuck run, not the outage) · collision checker + pre-commit hook · remote
approval on a phone · cutting-list tab in Designers Support · new quotation starts at nothing ·
minimum charge shown on the printout and the column reconciles · unit-count float noise ·
pinned actions column · sticky horizontal scrollbar · light/dark/device with **zero** low-contrast
text in either theme · 51 lost Wufoo attachments recovered.

## Signature flow — LIVE for WCL and MSSI as of 2026-08-08 session 2
Routing set by Rommel and verified against the STORED config (not the screen — see the CWL
trap below). All 39 combinations of 13 preparers × 3 companies were driven through
`_findSignatory`:

| | WCL | MSSI |
|---|---|---|
| Checked by | Joanna | Joanna |
| Checked by (fallback) | Allan Lagsao | Allan Lagsao |
| Noted by | Allan Lagsao | Allan Lagsao |
| Noted by (fallback) | Rommel | Rommel |

**No dead ends, nobody signs both boxes, every resolved signatory has a signature on file.**
Rommel only appears when Joanna or Allan is already in the chain — the `notedAlt` row absorbs
the double-signing he had accepted as a temporary cost, so that cost never materialised.

Still true and still his: **the Noted-by threshold is `{}`**, so Noted by is required on every
quotation regardless of value — nothing can complete on Checked by alone.

Signature images on file (7, from `settings` `SIG_*`): Allan, Joanna, Rommel, Jhover, Kaye,
Rafael, Stephanie. **Missing: Stiffany Gabut, Michael Delos Reyes, Kathleen Tiu.**

## ⚠ CWL — PARKED 2026-08-08, pick up at the deployment (Rommel: "next week")
Set up for future use only; CWL is not deployed yet. Two things must happen before anyone there
can sign, both measured from what is STORED, not from what the screen showed:

1. **Re-apply the CWL column in Settings → Approval Routing and press Save.** The screen showed
   Joanna / Stiffany / Stiffany / Rommel; the database still holds the older
   Stiffany / Michael / Rommel / **(blank)**. The CONFIG row *was* written at 05:15 — that write
   carried the Saturday SLA change — so the CWL dropdowns were almost certainly edited in a tab
   that was not the one that saved. **A blank `notedAlt` dead-ends any CWL quotation Rommel
   prepares himself** (`noted` is him, he is excluded as preparer, and there is no fallback).
2. **Upload Stiffany's signature** (and Michael's if he stays as the fallback). As stored, CWL
   Checked by resolves to Stiffany and the fallback to Michael, and **neither has a signature on
   file**, so no CWL quotation can be checked by anyone. Signing is refused without one rather
   than printing a blank name.

**Lesson worth keeping: verify routing against the stored CONFIG row, never against a
screenshot.** The dropdowns write to `APPR_ROUTING` in memory and persist only on Save, so a
screen and the database can disagree indefinitely with nothing to show for it.

## ⚠ FIRST THING NEXT SESSION — the two habits, not more code
The ladder, the derivation, the detection and the repair are all done. What is left is behavioural,
and no amount of code fixes it:
- **Client Approve has been pressed twice, ever.** Until estimators press it when a client says yes,
  win rate and won revenue stay near zero and the dashboard will look broken when it is not.
- **The arrival source (Walk-in / Email order) has to be picked** or a quotation has no response
  time and drops out of the average. The Team performance footer already names who is affected.

Do NOT respond to "the dashboard shows no wins" by changing the KPI. Check whether the button was
pressed first — that has already been the answer once.

## Run once, in the app (Rommel) — ✅ ALL DONE 2026-08-08
**Settings → Company & DB → Check Project List.** All three repairs are run and confirmed in the
append-only activity log — nothing here is outstanding:
- ✅ 08:11 UTC — `Project List statuses corrected — 2 updated`. Re-check afterwards came back clean
  ("Every Status matches what the quotation actually is", 71 checked, 3 skipped for having no state).
- ✅ 09:26 UTC — `Initial Locked dates restored from the activity log — 12 quotations`.
- ✅ 09:53 UTC — `Initial Locked dates copied from each quotation's saved record — 10 filled in`,
  **no failures**.

The 12 that stay blank are the June quotations predating the activity log. That is correct —
**leave them.** Do not add a repair that invents a date for those.

## Rommel's to do
- **Test the mobile app** — installed and subscribed on his Android. Needs a request routed to him
  (see the MOBILE APPROVALS section above). Watch the invisible half too: approve from the phone,
  then open that quotation on a laptop a minute later and confirm the price actually moved.
- ~~QT-M00000109 duplicate~~ **DONE** — he deleted both 108 and 109. Their Storage files remain
  (deleting a quotation does not remove them); recoverable if that Peace Maker quotation is ever
  wanted back.
- **Tell the WCL and MSSI staff to try the signature flow** — cleared 2026-08-08, see above. Expect
  one wrinkle: Allan is a Manager, so his own PIN is mandatory; if he has not set one the app sends
  him to set it and then resumes the signing. That is designed behaviour, not an error.
- ~~**`QT-W00000087`** — press Re-route~~ **DONE** — confirmed 2026-08-09: both slots signed on
  08-08 (Checked by Allan 11:24, Noted by Rommel 13:40).
- **CWL at its deployment (next week)** — see the parked section above: re-apply the CWL routing
  column and Save, and upload Stiffany's signature.
- ~~**Deploy the Wufoo webhook**~~ **DONE — deployed and confirmed running 2026-08-09.** Proven by
  order **8865** (Sat 08-08 17:40 PHT): its `attachments` array carries a `docs.google.com` URL
  written AT INSERT, and neither the array nor a Drive upload was possible under the old script.
  ⚠ **8864 is NOT the evidence** — it arrived 2h16m before the script existed, and holds a Drive
  URL in `attachment_1` but a `wufoo.com` URL in `attachments[0]`: **two writers in one row**, the
  old script at insert and the backfill afterwards. That mismatch is the discriminator; reuse it.
  **Still open, resolves itself:** no order since has carried a file outside Field128/129, so the
  nine extra fields have not fired live. Corpus check: **68 orders, 0 mismatched** between
  `attachments` and the file fields Wufoo actually sent; 15 carry 3+; 140 files total.
- ⚠ **DO NOT run `reconcileQuotationCreators()`** — disabled 2026-08-11, wrong premise. See the
  session entry. The forward fix is fine; only the historical repair is void.
- ✅ **Bella Ferma RESOLVED 2026-08-12.** Confirmed in the database: `QT-W00000036` no longer
  exists; the sole surviving record is `QT-W00000039` (Bella Ferma, ₱898,462.14, IQ Approved), row
  and quotation in agreement. It was one job. Check Project List confirms zero serial mismatches
  and zero duplicate rows — **every quotation number in the system now agrees with itself.**
  **`qBaseSerial` removal is UNBLOCKED** — see the item below, next up.
  ⚠ Also unblocks the two KPI figures parked behind it in the 2026-08-06 session (won revenue /
  win rate) — they were double-counting this ₱898,462.14. Re-derive before quoting either number.
- **Rotate the Wufoo API key** — still in public git history. The only item with a security clock.
- **GYMFIX `QT-M00000087`** — final-locked and Client Approved at ₱0.00, should be ₱616. Unlock,
  recalculate, re-lock.
- **MABA CONSTRAK `QT-260619-3668`** — needs Joanna's sent PDF; cannot be recomputed (its service
  lines carry no stored price and resolve positionally into a catalogue since reordered).
- **Bella Ferma** (W00000036 / W00000039) — one job or two? Blocks both KPI decisions, AND it is
  one of the 13 serial mismatches (deliberately absent from `RENUMBER_PLAN` — removing the older
  row would drop ₱640,323 of live pipeline).
- **Run `reconcileRenumbered()`** — repairs 8 stale-serial records (dry run first). ⚠ **This is a
  HARDCODED 8-serial plan, not a scan** — it covers only the 2026-07-30→08-05 W↔M company-change
  set. The four from the double-claim race were a *different* mechanism and are already repaired
  (see 2026-08-09), and Bella Ferma is deliberately excluded.
- **Keystone `QT-W00000075`** — see the two reminders at the top of this list.
- **Clear ~56 old drafts** — Project List → filter Draft → Delete selected. **Not** the struck SQL.
- **Deactivate Andrei Salvador** — `designer-ce2@` still shows `active: true` (MSSI) as of
  2026-08-09. Confirm against the Sheet — the Supabase mirror can lag.
- **"Handgrab Groove" / "Flush Handle Groove"** — under no minimum charge (they say *groove*, not
  *grooving*); rename if they should count toward the ₱400.

## Still true 2026-08-09 — the two habits, measured again
- **Client Approve**: `quotations.client_approved_at` set on **0 of 171**; only **2** saved states
  carry `fqClientApproved`. Win rate and won revenue stay near zero until estimators press it.
- **Arrival source**: set on **7 of 171**. Without it a quotation has no response time.

Do NOT respond to "the dashboard shows no wins" by changing the KPI. Check the button first.

## ✅ RESOLVED 2026-08-08 — `users.pin_hash` / `pin_salt` are GONE, and cannot mislead again
**PIN state lives in exactly one place: the Google Sheet `User Roles`, columns W (hash) and X
(salt).** `parseUserRows` reads them into `sheetUsers[].pinHash`, and every check in the app —
`_verifyApproverPin`, `_openPinModal`, the mandatory-PIN gate, the "PIN set ✓" badge — uses that.
**Never delete Sheet W/X: that would destroy every PIN in the company.**

The Supabase mirror columns were **dropped** (migration `drop_write_only_pin_columns_from_users`,
code commit `6259b26`). They were **write-only** — `supaUpsertUser` wrote them and *nothing,
anywhere, ever read them* (verified across Modcraft, the MSSI website, PMES, and every view,
function, RLS policy and index in the database). They were also **wrong**: `supaUpsertUser`
silently no-ops unless that individual user's own browser is Supabase-connected, so a PIN set on an
unconnected browser never arrived. The column claimed "no PIN" for **12 of 13 users**.

**Why it mattered, and the lesson.** It was believed twice in one day, and Rommel had to correct it
both times. The second correction was the sharp one: *"you said no pin, but allan was able to
approve where you said is not going to work if no pin."* He was right, and the contradiction was
internal — `_pinRequiredFor()` returns true for **Manager/Director/Admin**, so `_verifyApproverPin`
refuses *everything* for a Manager with no PIN, **including the legacy 1234**. Allan is a Manager
and had approved twice. His approvals already proved he had a PIN; the column never needed
querying. **When two of your own statements cannot both be true, resolve them against each other
before reaching for a data source.**

⚠ **A Staff approval does NOT prove a PIN** — the `1234` fallback is still open to Staff unless
"Require own PIN" is ticked. Manager/Director/Admin approvals do prove it.

The warning that used to sit here had been written and was walked past anyway. Deleting the column
was the fix; documenting it was not. Restore path if ever needed: `rollback_pin_columns.sql` +
`git revert 6259b26` + `supaMigrateUsers()` (values come back from the Sheet, so no secret is
stored — this repo is public).

## ✅ WITHDRAWN 2026-08-08 — the carcass margin concern was wrong (I raised it, then disproved it)
I flagged `_fabCarcassMargin` as overstating profit on a Subsidiary quotation because it has
`CARCASS_PRICES[type]` — the **list** price — in its formula, while WCLI is billed far less.
**That was wrong. The term cancels.** For WCLI, `_materialMarginCounts()` is false, so the
template's materials and hardware are costed at their FULL price:

```
reported margin = listPrice − servicesCost − materials − hardware
revenue billed  = listPrice − materials − hardware        (_carcassUnitPrice)
∴ reported margin = revenue billed − servicesCost
```

Verified numerically: revenue ₱5,587.85 − services cost ₱1,040 = ₱4,547.85, exactly what it
reports. The identity holds whether or not the template total equals the list price, because both
sides take materials and hardware from the same template rows.

**So it already measures "what you billed minus what the services cost you", which is correct.**
The one assumption baked in is that transferred materials cost this company nothing — which IS the
stated rule ("WCLI costs them on their own side"). It only becomes wrong if that policy changes.

**The lesson, not the fact:** I saw a list price in a margin formula and concluded it was being
used as revenue, without doing the algebra. Raising a false concern cost a round trip and would
have put a wrong item on this list permanently. Do the arithmetic before flagging a number as
wrong — the same discipline as reproducing before fixing.

Two genuinely open, same area: **item 1+2** below (subsidiary material billing differing between
BOM and cutting-list mode), and the narrower point that carcass services with no Cost Breakdown
entry are counted at full price, so their margin shows as zero rather than unknown — conservative,
but it means carcass margin understates until Cost Breakdown is filled in.

## MOBILE APPROVALS — where it stands, and what is next (2026-08-09)
**Phases 1 and 2 are complete, deployed and served.** `approve.html` + `sw.js` +
`manifest.webmanifest` + `icons/` + the `send-approval-push` Edge Function + the
`push_subscriptions` table. Rommel has installed it on Android and subscribed.

**The one thing never proven: a notification actually arriving.** Everything up to delivery is
verified. It needs a request ASSIGNED TO HIM — his own list correctly reads "Nothing waiting", and
he cannot self-test (the signature flow excludes the preparer; his own discount/VAT requests go
straight to the PIN because he is an approver). **First real request routed to him is the proof.**

**Immediate follow-ups, small:**
- He has **two push subscriptions** (a Desktop-site tab and the installed app). First push may
  buzz twice; a dead endpoint self-deletes on send. Remove the older one if it duplicates.
- If load is still slow, the next candidate is the two SEQUENTIAL startup round trips
  (session → role → list). Not done tonight because it touches working auth code.

**Phase 3 — Lami on the phone. NOT started.** Per Rommel: she does NOT narrate. Silent until
asked; a gateway to everything the screen cannot hold ("what services are involved in this
project"), answering in text, aloud only on request. Voice INPUT works on Android and NOT on iOS
Safari (`SpeechRecognition` unsupported) — decided against paying for speech-to-text to close
that; iPhone users type the question. She will need the quotation state and the client history,
and the same `canViewCostReport()` gating the rest of the app uses.

⚠ **When Lami answers "what services are involved", note `svcItems` stores `{qty, svcIdx}` with NO
name** — `svcIdx` is a POSITIONAL index into `price_services` ordered by id. Load it in exactly
that order or she will confidently name the WRONG services. Where a line stores its own `price`,
cross-check it against the catalogue and refuse to answer if they disagree.

## NEXT SESSION
**The two reminders at the top of this list — Keystone, then removing `qBaseSerial`.** Rommel
asked to be reminded of both (2026-08-09). Then the two habits, then his list.

Known and deliberately left, so nobody "fixes" them by surprise:
- **`QT-W00000075` (Keystone Construction) appears twice** in the Quotations sheet — a genuine
  duplicate row. No longer harmless: it **blocks** the last of the four serial repairs, because
  `reconcileClientCopySerials()` refuses to rename one of a pair and strand the other. Reminder #1.
- **Supabase holds ~170 quotations, the Sheet ~74.** The difference is quotations deleted from the
  Sheet before `supaDeleteQuotation` existed (added 2026-08-02). Harmless orphans — but it is why
  a SQL count and the app's count disagree, and why the app's number is the one to trust.
- **`_stageFlags` is loaded once per session.** A quotation another user changes mid-session shows
  its stored status until the next reload. Acceptable; noted so it is not mistaken for drift.
- **Stage 4 vs 5 rests on `fqStarted`**, set when Stage 2 is first opened. It is a real flag saved
  with the quotation, but it is the only thing separating "the client said yes" from "we are
  working on the Final" — nothing else records that the Final was ever touched.

## Status ladder — investigated 2026-08-08, unresolved
Rommel: the team cannot see quotations moving. Measured against saved state (`state->>'locked'`, NOT
`qLocked` — the state keys are `locked`/`approved`/`sentStatus`/`fqLocked`):

| Status shown | Rows | Locked in saved state |
|---|---|---|
| Draft | 60 | **0** |
| Initial Quotation | 40 | 38 |
| Locked *(legacy word)* | 30 | 30 |
| Approved *(legacy)* | 13 | 13 |
| Client Approved | 2 | 2 |

Everything except Draft is consistent. **Not one quotation created since the ladder was redefined has
ever had Initial Approve clicked**, and only 2 have reached Client Approved — so after "Initial
Quotation" every remaining rung needs an in-app action nobody performs. The one thing the team DOES
do next — send it — **is not a rung at all**; there is no `sent_at` on `quotations` (only on orders).
60 rows still carry the legacy status words.

Rommel then said most of those Drafts ARE locked, which the data contradicts. **Do not guess: get one
serial he believes is locked but shows Draft** and trace row + state + timestamps + activity log. Two
candidates — the lock being refused by the project-size gate (it now refuses outright with a reason,
and someone may be moving on), or the save after locking failing silently.

Before redesigning the ladder, the open question for Rommel is what actually happens after a
quotation is sent — does the client reply by email/Viber, is it chased, when is it dead? The likely
missing rungs are "sent, awaiting client" and an explicit Won/Lost, so a job that dies silently stops
looking identical to one still in play.

## Next up — agreed order, not started
1. **Serial preview can show `1`** (~20 min). `serialCounters` defaults to `{W:1,C:1,M:1}`, so a
   draft created before the Settings read lands shows a confident wrong number. The counter is fine
   (M at 106) and the committed serial is claimed atomically, so this is display only — but it shows
   an estimator a number that is not theirs. Fix: do not show a number until the counter is known,
   and refresh when it arrives. Deliberately deferred rather than rushed at the end of a session.
2. **Wufoo verification** once an order lands (above).
3. Then reconsider whether the full mobile app with push is still wanted — the cheap route shipped
   2026-08-08 and may be enough.

## Parked
9 legacy quotations missing `fqLocked` (4 show a wrong status) · subsidiary material billing differs
between BOM and cutting-list mode · Price DB ~39,420 blank-unit rows (fill units, **delete nothing** —
~10,000 SKUs exist only as one) · hardware still on the assumed 30% pending procurement data ·
Materials editing needs a search-first design · `getInstallCarcassUnits()` blank-count fallback ·
website order pipeline (live SKUs, hole count, grooving variants) · PMES sign-in (do not drop the anon
policies first) · Cabinet POC unverified types + oven tower · FORGE detection · Supabase orphan
detector · **`pending_orders` allows anon insert with `check(true)`** — anyone with the publishable
key can file unlimited orders; fine for launch-day, not for long.

## Standing rules confirmed this session
- **Never let a colour token into the six standalone print builders.** In a fresh document the
  variables do not exist, the rule is dropped, and a background silently disappears from the client's
  copy. Re-check after any colour work: they must contain zero `var(--`.
- **A stuck deploy is usually an older run holding the concurrency slot.** Look for
  `status: waiting` before pushing; an empty commit joins the same queue and cancels the one ahead.
- **Run `tools/check-collisions.mjs` after any bulk edit** — the pre-commit hook does it, but scripted
  passes over index.html have twice rewritten code they should not have touched.
- **Direct Price DB Sheet edit → always follow with `supaMigratePriceDb()`.**

---
# OPEN — 2026-08-07 (SUPERSEDED by the 2026-08-08 list above — kept for the detail only)

## Cleared on 2026-08-06/07
Test file `QT-W00000026` (deleted, both stores) · per-card chart-type switcher · Orders search ·
Customize/restrictions panel reachable again · running total bar · one definition of a win · status
rung renamed · Status column width + resize handle · Lami's undefined KPI counts ·
**site-visit-only charged at cost** · **quotation page two-step + two-column layout**.

## DEPLOY BACKLOG — RESOLVED 2026-08-08 (a stuck run held the concurrency slot, not the outage)
GitHub Pages stopped starting runs mid-session (they declared a Partial System Outage, then
"operational" while runs still queued). One run was **cancelled** outright; the retrigger sat
`pending` for over an hour. **Everything from `db2d9d7` onward is committed and pushed but was NOT
being served**, including the running total bar, the site-visit fix and the new layout.

```bash
curl -s https://rotaligatos.github.io/modcraft-app/ | grep -c q-total-bar   # 0 = still stuck
curl -s https://rotaligatos.github.io/modcraft-app/ | grep -c sv-only       # site-visit fix
curl -s https://rotaligatos.github.io/modcraft-app/ | grep -c s1-step2      # new layout
```

If still 0, push an empty commit to retrigger. **Do NOT touch the Pages configuration** — doing
that during the July incident turned a short outage into a day-long one. The app itself served
HTTP 200 throughout; users were on the older build, not broken.

## Blocking — the signature flow is unusable until these are done (all re-verified 2026-08-07)
| | State |
|---|---|
| **Checked by** unassigned | Empty for all three companies. It goes first, so nothing can start. |
| **Noted-by threshold** | `{}` → Noted by always required. Valid, but a decision. |
| **Signature images** | 7 on file. Kathleen, Michael, Stiffany still missing. Signing is refused without one. |
| **PINs** | **5 approvers still have none.** Kathleen approves non-VAT for all three companies and cannot. |

## Verify before anyone quotes
- **Subsidiary billing** — a WCLI carcass quotation drops ~82%. Correct by the rule, but check one
  real job. 11 existing subsidiary quotations were charging materials they should not have been.
- **Win rate reads ~2%** until estimators click Client Approved on the Final Quotation. Worth telling
  them that is now what makes a job count.

## Rommel's to do
- **Rotate the Wufoo API key** — the only item with a security clock.
- **GYMFIX `QT-M00000087`** — still ₱0.00, should be ₱616. Unlock, recalculate, re-lock.
- **MABA CONSTRAK `QT-260619-3668`** — needs Joanna's sent PDF; cannot be recomputed (its service
  lines carry no stored price and resolve positionally into a catalogue since reordered).
- **Bella Ferma** (W00000036 / W00000039) — one job or two? Blocks both KPI decisions.
- **Run `reconcileRenumbered()`** — repairs 8 stale-serial records (dry run first).
- **Clear ~56 old drafts** — Project List → filter Draft → Delete selected. **Not the struck SQL.**
- **Deactivate Andrei Salvador** — `designer-ce2@` still active across all three companies.
- **"Handgrab Groove" / "Flush Handle Groove"** — under no minimum charge (they say *groove*, not
  *grooving*); rename if they should count toward the ₱400.
- **Google Sites embed width** — only still needed for the larger quotation-page rework.

## Parked
9 legacy quotations missing `fqLocked` (4 show a wrong status) · subsidiary material billing differs
between BOM and cutting-list mode · Price DB ~39,420 blank-unit rows (fill units, **delete nothing**
— ~10,000 SKUs exist only as one) · hardware still on the assumed 30% pending procurement data ·
Materials editing needs a search-first design · `getInstallCarcassUnits()` blank-count fallback ·
website order pipeline (live SKUs, hole count, grooving variants) · PMES sign-in (do not drop the
anon policies first) · Cabinet POC unverified types + oven tower · FORGE detection · Supabase orphan
detector (would need to compare against the Sheet, which only the app can read) · the larger
quotation-page rework — **DONE 2026-08-07**, see the session record above.

## Mockups kept for reference (standalone, not deployed)
- `dashboard_redesign.html` — the widget grid prototype the real dashboard was built from
- `quotation_layout_mockup.html` — A (collapse client) + B (merge toggles). **B was proved wrong
  here**: merging the five 40px toggle cards made the page LONGER, not shorter
- `quotation_responsive_mockup.html` — fixed 800px vs adaptive, measured at six widths in a real
  iframe (45% shorter at ≥1280px, slightly longer on a phone, which is the right trade)
- `quotation_steps_mockup.html` — the two-step + light/dark demo. Its **"Show hardcoded colours"**
  switch demonstrates the dark-mode problem: 2,057 token references would flip, **1,588 hardcoded
  hex colours would not**. Twelve values cover ~500 of them (`#fff` alone is 191), so dark mode is
  ~1 mechanical session — plus print styles must stay light or PDFs come out dark.

## Next up — agreed order, not started
0. **Collision checker + pre-commit hook (~15 min)** — agreed 2026-08-07, do this FIRST. A script
   over `index.html` reporting: duplicate top-level `function` names, duplicate top-level `var`
   names, duplicate element `id="..."`, and that every `<script>` block parses. Wired as a git
   pre-commit hook so it runs whether or not anyone remembers.
   **Why:** a later definition silently wins in JS, and `getElementById` silently finds the first
   duplicate id. Both have already bitten this app — `dashToggleWidget` nearly shipped shadowed on
   2026-08-06, and a duplicate `id="users-wrap"` made the Users page render blank into a hidden div.
   Neither throws an error, so only a check finds them. Must exist before the cutting-list port.
1. **Remote approval, the cheap route (~1 session)** — collapse the topbar on a phone, size buttons
   to 44px, put the figures into the Chat/email notification. This was Rommel's actual point:
   *"the approval is what I think is needed when it comes to phone."* Measured: the Approvals page
   itself does NOT overflow at 375px; the **topbar is ~1,447px** and is the only thing that does —
   it is also the single remaining overflow on the quotation page, so fixing it clears both.
   Buttons are 28–35px against a 44px tap minimum. The full PWA-with-push is ~4–5 sessions and is
   NOT what he asked for; do this first and reconsider after.
2. **Website cutting list into Modcraft (~1–1.5 sessions)** — Designers Support tab feeding the
   existing bridge. **Wrap the ported file in an IIFE** so `recalc` and `SERVICES` never reach global
   scope — prevention by construction, not by vigilance. Modcraft's `recalc()` is the pricing engine.
3. Then reconsider whether the full mobile app with push is still wanted.

## Roadmap — do not start without asking
Mobile approvals app (PWA + push) · Wall Cladding treatment (still unspecified) · Order intent
New/Revision/Additional (half exists; the missing piece is which quotation a revision attaches to).

---
# OPEN — 2026-08-06 (SUPERSEDED by the 2026-08-07 list above — kept for the detail only)

Everything still live from here has been carried up into the 2026-08-07 list. Read this only for the
background detail on an item, never as the current state.

## ✅ AUDITED 2026-08-05 — the "four parts" job is BUILT. Do not rebuild it.

The previous handoff listed this as "AGREED, DESIGNED, NOT BUILT — start here". **That was
already false when it was written.** Three commits landed the work right after that handoff
commit (`92ce0c0`), and the OPEN list was never updated:

| Commit | Part |
|---|---|
| `17ba238` | 1 — Stage 2 gets its own scope of work |
| `79dafb5` | 2 — the change log now covers Stage 2 |
| `4822e7e` | 3 + 4 — client approval at Stage 1, additional orders roll up |

A full audit was run 2026-08-05 by **driving the code, not reading it**. All four pass:

1. **Stage 2 owns its scope** ✅ — forked a quotation, added work to Stage 2 only: Stage 1 held
   at ₱1,120.00 while Stage 2 rose to ₱5,600.00, separate arrays (1 line vs 2). The specific trap
   the design warned about holds: `recalc()` with `qStage===2` still prices Stage 1 from its own
   areas. Survives save/reload and option snapshots.
   Implementation note: it does NOT use a `qStage`-keyed accessor. `_scopeCtx` marks the duration
   of a Stage 2 *edit*, and `recalc()` stands down while set — correct by construction.
   `_buildPrintBody` and `_collectBomData` DO key on `qStage`, which is right: you print the stage
   you are viewing.
2. **Change log covers Stage 2** ✅ — a Stage 2 edit logs
   *"Changed: Now on Final Quotation · Final Quotation: Cutting qty 10 → 40"*, naming the stage so
   the two cannot be confused in the permanent record.
3. **Client approval at Stage 1** ✅ — `_isClientApprovedEntry()` returns true on
   `e.clientApproved || e.fqClientApproved`, i.e. the flag at either stage, with a status-rank
   fallback for older rows.
4. **Additional orders** ✅ — `_rollupJobs()` **rolls them up under the original job**. Verified on
   a chain (job → additional → additional-of-additional): one job, revenue summed, extras counted,
   cycles cannot hang it.

### Two things Rommel still needs to decide (both were decided without him)
- **The ~16× KPI jump already went live.** He asked to be told BEFORE it did. Measured on real
  data 2026-08-05 it is **36.5×**, not 16× — another large quotation reached Final since the
  estimate: won revenue **₱43,947.75 → ₱1,602,277.41**.
- **Five older quotations (₱1,558,329.66) count as won by inference**, not by a recorded approval —
  the rank fallback treats "In Final Quotation" as won on the reasoning that Stage 2 is unreachable
  without client approval. True of the app, but inferred rather than recorded for pre-flag rows.
  Accept, or count only recorded approvals?
- ~~Roll-up trade-off~~ **DECIDED 2026-08-06 — keep it.** The original preparer keeps the credit;
  whoever prepares an additional order gets no separate win. Accepted knowingly. No work required,
  do not re-raise.
- ⚠ **The 36.5× KPI figure is misleading — re-measured 2026-08-06.** NOT a broad reclassification:
  **97% of it is Bella Ferma counted twice** (₱898,462 + ₱640,323 — the suspected duplicate). The
  rest is ₱8,775 + ₱7,726 + ₱3,043. If Stephanie confirms one job, real won revenue is ~₱940K and
  the jump is ~21×, not 36.5×. **Both KPI decisions are parked behind Bella Ferma** — there is
  nothing useful to decide while the largest number in the set is unresolved.
  Also found: **not one quotation has a recorded approval timestamp** — every "won" figure today
  is inferred or comes from a status label with no date. And **GYMFIX counts as won at ₱0.00**,
  dragging average deal size down until it is corrected.
## Rommel's to do

### ⚠ NEEDED BEFORE THE SIGNATURE FLOW CAN BE USED (built 2026-08-06, unusable until these are done)
1. **Assign Checked by and Noted by** per company — Settings → Approval Routing. Any active user
   can be picked, not just managers.
2. **Set the Noted-by threshold** per company, same page. Measured on the total BEFORE VAT. Blank
   means Noted by is ALWAYS required. The ₱20,000 discussed was an example, not a decision.
3. **Signature images.** Signing is refused without one rather than printing a blank name. Four
   approvers have none: Kathleen Joyce Tiu, Allan Lagsao, Michael Delos Reyes, Stiffany Gabut.
   Uploaded from the avatar menu, or by an Admin from Settings → Users.
4. **Tick "Require own PIN"** for anyone named as a signatory who is not already an approver.
   Manager/Director/Admin are mandatory automatically.

### ⚠ VERIFY BEFORE QUOTING — the subsidiary billing change is large
**A WCLI carcass quotation now drops ~82%** (Kitchen Base: materials ₱4,147 + hardware ₱956 of a
₱6,237 price). Correct by the stated rule — you bill the work, not the boards — but check it
against one real job before it goes to a client. **11 existing Subsidiary quotations** (4 BOM,
7 carcass) were charging materials they should not have been.

### Other
- **Deactivate Andrei Salvador's account** — `designer-ce2@…` is still Active with access to all
  three companies. Keeping the seat as a spare is fine; leaving it able to sign in is not.
- **"Handgrab Groove" and "Flush Handle Groove" fall under NO minimum charge** — they say *groove*,
  not *grooving*. If they should count toward the ₱400, rename them; loosening the matching would
  catch things it should not.
- ~~QT-M00000102 (One Oak Craft)~~ **DONE 2026-08-05** — Joanna accepted the 3% counter at 08:09.
  Verified: subtotal 33,506.86 less 3% = 32,501.65, x1.12 VAT = 36,401.85, matching the stored
  total exactly. The total rose from 35,318.93 only because the SCOPE grew ~1,972 after the request
  was sent. Worth knowing: an approved discount percentage stays attached and follows the scope, so
  work added after approval is discounted too and nobody re-approves the larger amount.
- ~~Run the Normalize units button~~ **CLOSED 2026-08-05** — Rommel: units are fine, he edits them manually. Kept in the app for whenever it is wanted. NOTE FOR ANY FUTURE UOM QUESTION: **the unit string does not affect any computation.** A service line costs qty x price; the unit is never read by the arithmetic. Exactly one place in the app branches on a unit string (`hw.unit==='lm'` marks a hardware row as edge tape) and the hardware catalogue has no `lm` rows. So spelling variants are cosmetic. What the unit DOES decide is what a person types in the quantity box, and what the client sees on the printout — a 2.4m x 0.6m panel is 1.44 sqm or 2.4 lm, and only a human can tell which is meant. Board Assembly went from `/sq. m` to `lm` during this session (either deliberately or via the pre-fix dropdown); Rommel reviewed and is content. Service UOM is edited in **Settings -> Services / Price Database** — NOT PPIC, whose UOM is per cabinet type for installation capacity.
  (The button remains in Settings → Price Database: 31 services would change spelling only —
  `/lm`→`lm`, `/pc`→`piece`, `/sq. m`→`sqm` — previewed and confirmed before writing, Sheet and
  Supabase together. `min. charge` on 2 services is deliberately left alone: it is a pricing rule
  in the unit column, not a unit. Closed as cosmetic, not needed.)
- **QT-M00000087 (GYMFIX)** — final-locked and Client Approved at **₱0.00**; should be **₱616.00**
  (₱500 line × 1.10 contingency × 1.12 VAT; its sibling QT-M00000088 with the identical line is
  ₱616.00). Correcting it means unlocking a client-approved quotation — his call, not done.
  **Investigated 2026-08-06 — see the zero-total findings below.** Clean to repair: its service
  carries an explicit ₱500, so the figure is not in doubt. Unlock → recalculate → re-lock.
- ~~Tick who is measured~~ **DONE + CLOSED 2026-08-06** — 5 measured: Jhover Galupo, Joanna Marie
  Buenconsejo, Kaye Ibardaloza, Rhodalyn Dela Pena (CWLI), Stephanie Rose Oliveros.
  **Andrei Salvador and Rafael Colot are deliberately NOT included** (Rommel, 2026-08-06) — they
  prepare quotations but are not measured. **Do not re-raise this.** The Team performance footer
  that names unticked preparers will list them; that is expected, not a gap.
  Managers/Directors/Admins are unticked by design and exempt from that footer.
- **Test-data cleanup** — ⚠ **DO NOT RUN THE SQL. It is struck (decision 2026-08-06).** The
  statement recorded in the 2026-08-03 OPEN item A deletes from **Supabase only**, and the Google
  Sheet is still the Project List's read path for anyone not connected. It would leave every row
  in the Sheet, so they would reappear and the two stores would diverge — worse than doing nothing.

  **Use the app instead: Project List → filter to Draft → tick the rows → "Delete selected".**
  That is the existing Admin bulk delete: it removes from memory, the Sheet AND Supabase together,
  and since 2026-08-03 it logs each deletion. Doing it by hand is also safer than any script,
  because the client name is visible on every row as you go.

  Scope, re-measured 2026-08-06 (**the old "98 rows" figure was stale — it is 56**, ₱6,179,562 of
  draft value, oldest 2026-05-26, newest 2026-07-08; all unlocked, none ever issued). Most is
  obvious test data (*Tsttesttest*, *Sana*, *jojojojojojojojoj*, *Testes*, *Yesyesyes*,
  *George Clooney*, *ano na*, *sasve ulit*). **The rest is not**, and carries real line items:
  World Class Laminate, Inc. (6, ₱1.93M), Peace Maker (4, ₱563K), RTMO Digital Solutions (2,
  ₱542K), Yummy Bakeshop (2, ₱291K), plus 13 by Jhover and Joanna — of which
  **QT-M00000018→M00000025 are eight near-identical repeat-saves** (₱4,165.89, 7 line items each,
  same day, one named STUDIO TILLE) and **QT-M00000027 (Joanna, ₱90,813.44, 9 line items)** is the
  one worth checking before it goes. Re-count before starting: this figure has already moved once.
- **Google Sites embed width** — needed before the quotation-page layout rework.
- ~~Checked by / Noted by signatures — how?~~ **DESIGN SETTLED 2026-08-06**, see the signature-flow
  spec below. Still Rommel's to supply: **the per-company threshold amounts**, and the missing
  signature images (Andrei Salvador's, and all four approvers').
- **Rotate the Wufoo API key** — public in git history; the only item with a security clock.
- ~~Wi-Fi power settings~~ **DONE 2026-08-05.**
- **Price DB blank-unit rows** — re-measured exactly 2026-08-06: **153,552 rows / 124,132 distinct
  names; 39,420 blank-unit rows, of which 29,420 have a populated twin and 10,000 have NO
  alternative.** Fill the units, **delete nothing** — deleting would destroy those 10,000 SKUs
  outright. Purely cosmetic now: `lookupInSource` already prefers the populated row, and the unit
  string affects no computation (see the CLOSED Normalize-units entry above).

### Zero-total quotations — investigated 2026-08-06
Three quotations store ₱0.00 against real line items. One is not a bug:

- **`QT-W00000060` (KEYSTONE) — NOT A BUG, resolved.** Subsidiary/WCLI, materials only, no
  services. Cutting-list mode does not bill materials to WCLI, so ₱0.00 is correct by design.
- **`QT-M00000087` (GYMFIX)** and **`QT-260619-3668` (MABA)** share one signature: cutting-list
  mode · **"Fabrication only"** · saved from **Stage 2** · **no `fqFabBasis` recorded**. Two
  quotations seven weeks apart with the same fingerprint is not coincidence.
- **The failure mode is CLOSED** — verified on current code: reopening now clears `fqInitialized`,
  `initFinalQuotation()` runs, `fqFabBasis` comes back as `'own'`, and Stage 2 prices correctly.
- **The historical cause was NOT proven.** The Stage 2 leak fixed 2026-08-05 (`df8459b`) is
  consistent with the evidence but did not reproduce — current code returned the correct total in
  that exact scenario. Recorded as a hypothesis, not a finding.
- ⚠ **MABA cannot be repaired by recomputing.** Its two service lines carry **no stored price** and
  resolve positionally into `SERVICES`, and that catalogue has been reordered, renamed and
  re-imported repeatedly since June — indexes 4 and 5 no longer mean what they meant. Materials are
  solid at ₱26,150; the services are not recoverable from the record. And because the printout
  rebuilds from a live recalc at print time rather than from the stored total, **what MABA CONSTRAK
  actually received is unknown to us.** Ask Joanna for the sent PDF or email; recomputing today
  would invent a number the client never saw.

## NEW 2026-08-05 — raised by Rommel, not started

### 1. Mobile approvals app — ROADMAP, not scheduled (Rommel, 2026-08-05: "not yet")

**The goal, in his words: *"to make all users especially the approver to be always on top of
things."*** That is the objective to design against — the mobile app is the currently-favoured
means, not the end. Anything that closes the gap between a request being raised and the right
person knowing about it serves the same goal, and cheaper wins may exist (the Approvals nav tab
and the badge that no longer goes dark on a counter, both shipped 2026-08-05, were exactly that).

Decisions below are settled for whenever it IS picked up. **Do not start without asking** — it
begins with extracting the pricing engine out of `index.html`, which touches the live app.

Rommel: *"Im having challenges to keep on catching up the request. What I want to do here is a
mobile app just for those so I can immediately approve, review or disapprove the request even when
im away with my laptop."*

**Scope is approvals ONLY** — not the quotation app on a phone. Approve · review · counter ·
disapprove, for unlock / override / discount / non-VAT / premium, wherever he is.

Why this is now the bottleneck, in his own data: QT-M00000102 took **46 minutes** from request to
counter, then sat another **~50 minutes** unaccepted. Approvals gate locking, revision, discounts
and CF overrides — every one stops an estimator until he answers.

**Everything it needs already exists server-side.** `approval_requests` is a real Supabase table
with RLS, dual-written on every action; `messages` already fans out to email and Google Chat;
`APPR_ROUTING` decides who each request goes to; PIN verification is SHA-256 + salt in
`users.pin_hash` / `pin_salt`. A phone client would talk to the same table the desktop app does —
no new backend, no second source of truth.

**DECIDED 2026-08-05 (Rommel):**
- **Installable, with push notifications.** Push is the point — email and Chat already arrive and
  are still missed.
- **Show the money: total, discount amount AND margin.**
- **THE KEY REQUIREMENT, in his words:** *"I want to work like the override that shows the figures
  when I make the adjustments. This way, Im not blinded by just approving or rejecting countering
  the request."* So the figures must be **LIVE as he types a counter percentage**, exactly as
  `_ccfUpdateProfit()` does on the CF override modal — type 3%, see the resulting total and margin;
  type 5%, see them move. Not a static summary of the request.

**The one hard architectural question — where the live figures come from.**
`_ccfUpdateProfit()` gets its numbers by running the quotation's own `recalc()` and reading
`_pCalc`. A phone has no quotation loaded, and a second implementation of the pricing maths on
mobile WOULD drift — the same failure as `recalc`/`recalcFQ`, and as the four disagreeing copies of
the service line total fixed this session. Three options, in order of preference:
1. **Fetch the quotation's state and compute from it** — `quotation_states` already holds the whole
   state as one JSON row and RLS already allows the approver to read it. Most faithful, but needs
   the pricing engine available to the phone, i.e. extracting it from `index.html` into a shared
   file both load. That extraction is the real cost of this feature and is also the right long-term
   move.
2. **Store the few numbers a live preview needs on the request itself** (discountable base, direct
   cost, VAT flag) and do linear arithmetic on the phone. Cheap and no engine needed — but ⚠ it
   goes stale: QT-M00000102's scope grew ~₱1,972 AFTER the request was sent, so a request-time
   snapshot would have shown the wrong figures.
3. Read-only mobile that opens the laptop for anything needing judgement — rejected by the
   requirement above.

**Still to settle:** authentication on a phone (Google sign-in works; is a PIN enough authority on
a device that may sit unlocked in a bag?), and that a counter still requires the requester to
accept afterwards.

**Standing constraint worth remembering:** Google Chat webhooks post to a SPACE, not a DM, so the
current notification path already exposes client name, serial and reason to everyone in that space
(restricted to Managers+ per 2026-07-29). Real per-person push would avoid that.

### 2. Wall Cladding — change of treatment
Rommel wants the treatment of **Wall Cladding** changed. **Nothing specified yet — ask what the new
treatment should be before touching anything.**

Context for when he explains: Wall Cladding is one of the 13 `CARCASS_NAMES`, with its own carcass
price and a `cabinet_templates` row. It carries most of the orphan template lines (materials and
hardware names with no catalogue match — see the 2026-07-30 session). Its components-per-unit is
**1**, the lowest of the 13, which suggests it is already treated as an area/sheet product rather
than a cabinet. That may be exactly what he wants changed.
### 3. Order intent — New / Revision / Additional — QUEUED 2026-08-06, not started
Rommel: *"Orders can be defined if new or revision or additional. Just queue this to activities."*

**Half of it already exists.** `pending_orders.request_type` carries **New** (69 orders) and
**Revision** (3) today, straight from the Wufoo form, and the order card already shows it as a
badge. What is missing is **Additional**, and — more importantly — the field currently means
nothing to the app: `exportOrderToQuotation` behaves identically whichever value it holds. It is a
label, not an instruction.

The work is therefore less about adding a third value than about making the field DO something,
now that all three destinations exist in the app:

| Intent | What export should do |
|---|---|
| **New** | today's behaviour — a fresh quotation, client fields pre-filled |
| **Revision** | revise the quotation this order refers to (`openRevise` — new version, `.R1` on the serial, the old one superseded) rather than starting a blank one |
| **Additional** | create an ADDITIONAL order quotation linked to the original (the "Additional" button built 2026-08-05: own serial, empty scope, `additionalFrom` set), so production never builds anything twice |

**The piece that does not exist yet:** Revision and Additional both need to know WHICH quotation
they attach to, and nothing on the order captures that. Options — ask the client for the serial on
the form (most reliable, needs a Wufoo/website field), match on client + project name (no extra
field, but ambiguous for repeat clients), or have the estimator pick it at export time (always
works, one extra step). Worth settling before building; the rest is straightforward.

Also note `ORDER_KINDS` (Wufoo / Cutting List / Service Request / Site Visit) is a DIFFERENT axis —
it is the FORM the order arrived on, not what the client wants done. Intent and channel are
independent: a cutting-list order can perfectly well be a revision. Do not collapse the two.
### 4. Checked by / Noted by signature flow — ✅ BUILT 2026-08-06 (see the session record above)
Rommel's design, settled in full. Mirrors the existing VAT/discount approval machinery rather
than inventing a second mechanism.

**Setup**
- **Checked by** and **Noted by** signatories are assigned in **Settings → Approval Routing**,
  alongside `nonvat`/`discount`/`override`/`premium` — so per company, changeable without code.
- **Noted-by threshold**, set by Admin or Director, **defined PER COMPANY** ("ruling may be
  different from each"). Above it, Noted by is required; below it, Checked by alone.
- **Threshold basis: total project cost BEFORE VAT** (fixed — not the grand total). Rommel:
  *"the basis would be the total project cost before vat."* VAT is not project cost.
- The ₱20,000 figure is an EXAMPLE. Build the setting now; the real numbers come later
  ("this is something i need to discuss but i want to include this to the set up now").

**Flow**
1. User locks the quotation → a **Request signature** button appears.
2. User presses it → request routes to **Checked by** first.
3. Checked by enters their **PIN** → on approval it **automatically forwards to Noted by**
   (only when the ex-VAT total is above that company's threshold).
4. Same rules as VAT/discount: PIN-gated, **does not proceed if not approved**, requester
   **notified either way**.
5. A correction means the user must **trigger the request again** — corrections never inherit
   the previous signatures.

**Decided alongside it**
- **Unlocking CLEARS both signatures automatically.** Enforced, not left to the user to
  remember — a changed document must never carry a signature approving the older version. Same
  principle as changing a discount's scope cancelling its approval.
- **Sending is NOT blocked** — warn but allow. The user is told the quotation is unsigned and it
  is recorded in the activity log, so a slow approver never stops a job going out.

**What already exists to build on:** `qSignatures.checked` / `.noted` and the printout that reads
them; `APPR_ROUTING` and `findApproverForAction()`; PIN verification (`_verifyApproverPin`);
`submitApprovalRequest` + the poll + Lami announcements; `_freezeRates`/unlock hooks for the
clearing rule.

**Still open:** the actual threshold amounts per company, and whether any role may sign for
another (delegation already exists for approvals — does it extend to signing?).

### 5. Additional-order credit — DECIDED 2026-08-06, no change needed
Rommel chose **original preparer keeps the credit** — i.e. the behaviour already shipped. The
whole job counts once, under whoever prepared the original; whoever prepares an additional order
gets no separate win. Accepted knowingly. **No work required; do not re-raise.**
## Still to build / decide
- **Materials editing in the app** — parked 2026-08-05. Hardware is done; Materials is 153,552 rows
  so it cannot be an inline list. Needs a **search-first** tab: type to find, edit price/unit, add
  new, and save **only what changed** (targeted row updates, never a whole-table rewrite).
- **`getInstallCarcassUnits()`** — Installation, Assembly and PPIC still take the blank-carcass-count
  fallback that was fixed for the two charges on 2026-08-04. Same 646-vs-12 failure mode. Separate
  pricing decision.
- **Carcass/BOM final-locked quotations** — only checked for internal consistency (stored total
  matches its own saved calc), NOT recomputed from line items. A leak there would look consistent.
  Offer to recompute properly if certainty is wanted.
- ~~`QT-M00000070` is filed under `QT-W00000037`~~ **DIAGNOSED + FIXED 2026-08-06.** Not a one-off:
  **nine** quotations were filed under the number they were first PREVIEWED as while displaying and
  printing under the number they were saved with. Cause was the preview path, not the renumber path
  — `qBaseSerial` was set only `if(qBaseSerial==='')`, so it froze on the first preview and never
  followed later ones (the counters load late after sign-in, and switching company moves the
  quotation to another series). Fixed by `_syncBaseSerialToPreview()` (`7f2b41a`), and
  `reconcileRenumbered()` (`dc13d9b`) repairs the eight safe rows — **still to be RUN by Rommel**;
  Bella Ferma is excluded pending Stephanie.
- ~~67, 68, 69, 70 and 76 missing from Supabase~~ **EXPLAINED 2026-08-06.** Not a dual-write
  failure. **70 and 76 are filed under `QT-W00000037` and `QT-W00000043`** (same cause as above).
  **67, 68 and 69 never existed** — the serial counter advances on every renumber, so gaps are
  normal.
- **MABA CONSTRAK `QT-260619-3668`** — stored ₱0.00. ⚠ **Cannot be repaired by recomputing** — its
  service lines carry no stored price and resolve positionally into a catalogue reordered many
  times since June. Materials are solid at ₱26,150; the services are gone from the record, and what
  the client received is unknown (the printout rebuilds live, not from the stored total). Needs
  Joanna's sent PDF. See the zero-total findings above.
- **PMES sign-in** — 22 tables still anon-readable; do not drop the policies before it has auth.
- **Website order pipeline** — live SKUs into the webpage cutting list; hole count + grooving
  variants in the form. See `MSSI Webpage/HANDOFF.md`, which is authoritative for that side.
- **MSSI footer** still says "Concept — not the live site"; the site is not deployed anywhere.


---

# OPEN — 2026-08-04 (SUPERSEDED by the 2026-08-05 list above — kept for the detail only)

### AGREED FOR NEXT SESSION — two pieces of the performance picture, neither built

**1. Walk-in clients.** Rommel, 2026-08-04: a quotation started directly, with no Wufoo or website
order behind it, is a **walk-in client**, and walk-ins must be included in the performance
measurement. Nothing has been built. Open questions: what starts the clock when there is no
`receivedAt` (the quotation's own `created` timestamp is the obvious candidate — is that fair?);
whether walk-ins share the Avg. response column or get their own; and how a walk-in is identified
(absence of `sourceOrder` is the natural test, and it is already stored).

**2. Overall team card.** Rommel, 2026-08-04: a separate card, at the bottom or alongside Team
performance, showing the whole picture rather than per-person rows — **including the orders that
never became quotations**:
   - how many orders are still **Pending**
   - how many have reached **quotation**
   - how many have **lapsed the defined SLA**
   Everything needed exists: `pendingOrders` carries `receivedAt` / `sentAt` / `status` /
   `quotSerial`, `calcWorkingMinutes()` gives working-hours elapsed, and `ordersSlaSettings`
   holds the per-company SLA hours and calendar. Note **Site Visit orders are SLA-exempt** and must
   be excluded from the lapsed count. Current shape of the data: **59 orders, 47 still in New, 3
   ever carried through to a sent quotation** — so the card will mostly show a large pending
   backlog, which is the point.

### Still Rommel's
- ~~Cleanup SQL~~ **STRUCK 2026-08-06 — do not run it.** Supabase-only, so it would leave all the
  rows in the Sheet and split the two stores. Use Project List → Draft → Delete selected instead.
  See the current OPEN list.
- **Google Sites embed width** — needed before the quotation-page layout rework (mockup approved in
  principle: sticky running total, collapsed client card, 1754px → 838px scroll).
- **Checked by / Noted by signatures** — stamp automatically on PIN approval, or a separate "sign"
  action? `qSignatures.checked` / `.noted` exist and the printout already reads them.
- **Signatures missing**: Andrei Salvador (`designer-ce2`) is the only *preparer* without one. The
  approvers — Kathleen Joyce Tiu, Allan Lagsao, Michael Delos Reyes, Stiffany Gabut — have none,
  and are needed once the flow above is settled.
- **Wi-Fi power settings** (see above).
- ~~Tick who is measured~~ **DONE + CLOSED 2026-08-06** — 5 measured: Jhover Galupo, Joanna Marie
  Buenconsejo, Kaye Ibardaloza, Rhodalyn Dela Pena (CWLI), Stephanie Rose Oliveros.
  **Andrei Salvador and Rafael Colot are deliberately NOT included** (Rommel, 2026-08-06) — they
  prepare quotations but are not measured. **Do not re-raise this.** The Team performance footer
  that names unticked preparers will list them; that is expected, not a gap.
  Managers/Directors/Admins are unticked by design and exempt from that footer.

### Still to build / decide
- **`getInstallCarcassUnits()`** — Installation, Assembly and PPIC still take the blank-count
  fallback that was fixed for the two charges. Same 646-vs-12 failure mode. Separate pricing
  decision. One locked quotation is in that set (`QT-260603-8162`, Peace Maker, P541,474) but it
  has no service lines, so nothing was inflated there.
- **Order queue coverage** — only **3 of 59** orders have both a received and a sent time; 47 are
  still in *New*. Team performance measures almost nothing until the queue is worked through the
  app. A process gap, not a code one.
- **MABA CONSTRAK `QT-260619-3668`** — stored P0.00, should be ~P32,981.26. Still parked, and the
  9 quotations missing `fqLocked` are parked behind it.
- **PMES sign-in** — 22 tables still anon-readable; do not drop the policies before it has auth.
- **Wufoo API key** — still needs rotating; it is in public git history.
- **Price DB blank-unit rows** — ~39,420; fill the units, delete nothing (~10,000 have no
  populated twin).

---

## What was changed on 2026-08-14/15 (session — separate PWA icons for both apps, then a real install bug found)

### Distinct home-screen icons — DONE, deployed (`a9b54f2`)
Both installable apps (`index.html` via `app.webmanifest`, `approve.html` via `manifest.webmanifest`)
shared the exact same icon files, so on a phone home screen the two were indistinguishable. First
pass was Claude hand-drawing simple flat SVG marks (a Lami-mascot smiley for Modcraft, a checkmark
for Approval) — **Rommel rejected the look outright** ("I don't like what it looks like. Stop it.")
and asked for a Gemini prompt instead, describing the app's real functionality so Gemini could
propose several directions. That prompt was written and handed over (not reproduced here — see the
session transcript if it's ever needed again); Rommel ran it himself and picked a result: a navy
clipboard with a teal % and a ₱ badge for **Modcraft**, and a navy fountain pen writing a teal
signature for **Modcraft Approval** (renamed from "Approvals" in this same pass, per request —
manifest `name`/`short_name` and `approve.html`'s `apple-mobile-web-app-title`, which iOS uses
instead of the manifest on older versions).

Rommel saved the Gemini output — a single JPEG mocking up both icons side-by-side on two fake phone
screens — directly into the repo's `icons/` folder. It was **not** a clean icon export: extracting
usable square art meant cropping it out of the phone-mockup image with `sharp` (installed on demand
in the scratchpad, since neither `sharp` nor any image lib is a project dependency), by eye,
iterating on the crop box until the neighbouring home-screen icons stopped bleeding into the
corners. Found and fixed one real defect during that process: the mockup's own icon squares carry a
baked-in soft rounded-corner + drop-shadow treatment, which produced ugly grey triangle artifacts
when composited onto the maskable variant's flat white safe-zone canvas — fixed with a SECOND, more
tightly-cropped "flat" source (fully inside the rounding) used only for the maskable build, kept
separate from the slightly looser crop used for the plain "any"-purpose sizes.

Shipped: `icons/modcraft/` and `icons/approvals/` (icon-180/192/512 + a maskable-512, each verified
by simulating a real circular adaptive-icon crop and by rendering down to actual 48×48 display size
before committing — both survive with clean margin). Both manifests and both HTML files'
`apple-touch-icon`/`icon` links updated to the new per-app paths; the old shared root-level
`icons/icon-*.png` and the raw mockup JPEG were removed once extraction was confirmed good.

### ⚠⚠ NOT FIXED — installing both apps on one phone collapses them into ONE install
Reported immediately after deploy: Rommel uninstalled and reinstalled both apps to see the new
icons. Installed **Modcraft first**, then tried to install **Modcraft Approval** — the browser said
it was **already installed**, and only one icon appears on the home screen. This is not a caching
problem (the icon work above is separately confirmed correct and live) — it is a genuine PWA
identity collision, diagnosed but **deliberately left unfixed this session** per Rommel's explicit
instruction to document and hand over first rather than keep changing things blind.

**Root cause, confirmed by reading both manifests and both service-worker registrations directly —
not guessed:**

| | Modcraft (`app.webmanifest`) | Modcraft Approval (`manifest.webmanifest`) |
|---|---|---|
| `scope` | `"./"` — the **whole origin** | `"./approve.html"` |
| `start_url` | `"./index.html"` | `"./approve.html"` |
| `id` | **not set** | **not set** |
| SW registration | `index.html`: `register('./sw.js',{scope:'./'})` | `approve.html`: `register('./sw.js',{scope:'./approve.html'})` |

Modcraft's manifest scope (`"./"`) is the **entire site**, which already **contains**
`approve.html` — Approval's whole scope sits nested inside Modcraft's. Per the Web App Manifest
spec, when a manifest has no explicit `id`, a browser falls back to `start_url` (resolved against
scope) to decide an app's identity, and when one installed app's scope already covers another
app's `start_url`, Chrome/Android's install manager can treat the second one as *the same app,
different page* rather than a separate installable entity — which matches exactly what was
reported: install Modcraft (claims the whole origin as its scope) → try to install Approval
(`start_url` already falls inside that claimed scope) → "already installed."

This is the textbook scenario the manifest **`id` field** exists to solve: an explicit, unique `id`
on each manifest overrides scope-based identity inference entirely, per spec, regardless of scope
overlap. Neither manifest sets one today.

> ## ⚠⚠ STRUCK 2026-08-15 — THE `id` HALF OF THIS DIAGNOSIS IS WRONG
> **An omitted `id` defaults to `start_url`** ([MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/id):
> *"If `id` is not specified or the value is invalid in any way … the `start_url` value is used"*).
> The two `start_url`s already differed — `/modcraft-app/index.html` vs `/modcraft-app/approve.html`
> — so **the two apps already had distinct identities**, and "neither manifest sets an `id`" was
> never the cause. Adding `id`s alone would have been a knowing no-op, and shipping it as "the fix"
> would have cost a wasted device-test cycle.
> **Scope containment was the whole cause.** See the 2026-08-15 session entry below for the fix.
> Note also: a relative `id` resolves against the **ORIGIN** of `start_url`, not the manifest's
> directory — so `"id": "modcraft"` becomes `https://origin/modcraft`, not `…/modcraft-app/modcraft`.
> Use a root-relative path.

**Not yet attempted, and why:** the fix itself (adding a distinct `id` to each manifest, e.g.
`"id": "/modcraft-app/"` and `"id": "/modcraft-app/approve.html"` — exact values need checking
against the spec's resolution-against-scope-or-manifest-URL rules before writing them) is small and
low-risk to WRITE, but **cannot be verified by anything in this repo's own tooling** — there is no
way to simulate "does Android now offer to install this as a separate app" from a script or a
headless browser; it needs Rommel's own phone, an actual uninstall of both apps, and a real
reinstall attempt. Whether narrowing Modcraft's own `scope` away from `"./"` is also needed (so it
no longer claims `approve.html` at all) is a second open question — worth checking whether index.html
ever needs to navigate outside its own path first, since narrowing scope wrongly could break something
currently relying on the wide scope.

**Also raised in the same message, likely describing the SAME symptom from a different angle, not a
separate ask:** *"there's supposed to have two design in the app. one for support and one for main.
which currently you made only for main app."* Read in context (right after describing the
already-installed collision and "the icon, there's 1 only") this most likely means: because the two
installs collapsed into one, only ONE of the two already-correct icon designs is actually visible/in
effect on the phone right now — not a request for a third, different icon. **Confirm this reading
with Rommel before building anything new** — if it turns out to mean something else entirely (e.g.
literally wanting a distinct icon for something called "support"), that needs its own clarification,
not an assumption.

> ✅ **CONFIRMED 2026-08-15.** Rommel: *"Im just saying that theres 2 icon, 1 for each but I only
> see 1."* The working guess was right — it describes the install collision, **not** a request for a
> third icon. Both icon designs exist and are correct; only one was visible because the two installs
> had merged. **No new icon work. Do not raise this again.**

### Also worth knowing
- `git push` failed twice this session with `Failed to connect to github.com port 443` while
  `curl` reached the exact same GitHub endpoint fine — same intermittent-connectivity class already
  on the watch list (see "Intermittent outbound connection failures" earlier in this file). Running
  with `GIT_CURL_VERBOSE=1` showed the underlying HTTPS connection actually succeeding on a later
  attempt (401 anonymous probe → 200 with cached credentials) — the failures were real timeouts, not
  something wrong with the repo or the commit. If this recurs, `GIT_CURL_VERBOSE=1 git push` is the
  fastest way to see whether it is a genuine connect failure or something later in the exchange.
- Repeated the same commit-message mistake as an earlier session (reusing a stale title from memory
  instead of writing a fresh one) once before catching it — see `feedback` memory on this if it
  keeps happening; worth writing the title as a first, separate, deliberate step before the `git
  commit` command is composed at all, not inline with everything else.

---

## What was changed on 2026-08-15 (session — the PWA install collision fixed: scope, not `id`)

One commit, `67cab3c`, deployed and confirmed SERVED. Fixes the bug left open the session before.

### The recorded diagnosis was half wrong, and checking the spec is what caught it
The handoff blamed **both** the missing `id` and the scope overlap. Read the spec before writing
anything, per Rommel's instruction — and the `id` half does not survive it:

**An omitted `id` defaults to `start_url`.** The two `start_url`s already differed
(`/modcraft-app/index.html` vs `/modcraft-app/approve.html`), so **the two apps already had distinct
identities**. Adding explicit `id`s would have changed nothing about this bug. Shipping that as "the
fix" would have burned a device-test cycle and looked like a fix that failed.

Also learned, and worth keeping: **a relative `id` resolves against the ORIGIN of `start_url`, not
the manifest's directory** — `"id": "modcraft"` becomes `https://origin/modcraft`, NOT
`…/modcraft-app/modcraft`. Root-relative is the only honest way to write it here.

### Scope containment was the entire cause
A manifest `scope` is a plain **path PREFIX**. `app.webmanifest`'s `"./"` resolved against its own
URL to `https://rotaligatos.github.io/modcraft-app/` — the whole directory, which **contains**
`approve.html`. So Chrome saw that page as belonging to the already-installed Modcraft app and
offered "open in app" instead of installing Approval separately.

Rommel confirmed the trigger was **a clean Chrome tab at the approve.html URL** (not a link followed
from inside the installed Modcraft window), which rules out the in-app-navigation explanation and
leaves plain scope containment.

### The fix
1. **`app.webmanifest` scope `"./"` → `"./index.html"`** — the only prefix that covers index.html
   while excluding approve.html. Both files live in the same directory, so there is no other option
   short of moving files (which would break the Google Site embed URL, the Supabase redirect config,
   Google OAuth origins, everyone's bookmarks, and the existing install).
2. **A `history.replaceState` normaliser at the very top of `<head>`, before the manifest link.**
   The narrow scope leaves the bare `/modcraft-app/` URL (no filename) outside scope, which could
   stop Chrome offering to install Modcraft from a bookmark. This rewrites the address onto
   `index.html` **without navigating** — no reload, no refetch, nothing in the auth flow touched.
   Deliberately skipped inside an iframe (the Google Site embed) and in the Supabase auth popup
   (`?supaAuthPopup=1`), so neither of those paths can be affected at all; also skipped on `file://`
   and when a filename is already present. Query and hash are preserved.
3. **Explicit `id`s added anyway**, set to exactly the current implicit values
   (`/modcraft-app/index.html`, `/modcraft-app/approve.html`) so nobody already installed is
   orphaned. **Hygiene, not the fix** — it stops a future `start_url` change silently
   re-identifying either app.

### Why index.html could take the narrow scope safely
Checked rather than assumed: index.html **never does a cross-page navigation.** The only
`location.replace` (`_reloadForNewBuild`) preserves `location.pathname`, and the Google/Supabase
OAuth redirect runs **in the popup**, not the opener (`_supaAutoConnect` → `window.open`, and the
opener's own code carries the comment *"No signInWithOAuth here in the opener"*). So once launched at
`start_url`, the app stays on `/modcraft-app/index.html` for the whole session.

### Verified
Both manifests parse as served by a real browser with distinct ids/scopes/icon sets · containment
proved broken in both directions (approve.html outside Modcraft's scope, index.html still inside it,
approve.html still inside Approval's own) · all 8 icon files 200 on the live site with byte sizes
matching disk · the normaliser passes **9 cases** covering every URL shape (bare dir, query+hash
preserved, already-index.html, approve.html untouched, iframe, auth popup with the param in either
position, `file://`, localhost root) — and the test **extracts the snippet out of the shipped file**
so it cannot drift from what deploys · index.html boots with `recalc`/`navigate`/`initQuotation`/
`gShowApp` all defined and a clean console · collision checker clean · all three files confirmed
serving live on GitHub Pages, no stuck workflow run.

### ⚠ Cannot be verified from here — needs Rommel's phone
There is no way to simulate "does Android offer this as a separate app" from a script or headless
browser. **The test: uninstall BOTH apps completely, install Modcraft, then install Approval, and
confirm two separate home-screen entries with their own icons.** Also worth confirming Modcraft
still installs from the bare `/modcraft-app/` bookmark URL — that is the one thing the normaliser
exists to protect, and it is the only residual risk in this change.

### Method notes
- **A 404 sweep on all 8 icons was the preview server, not the app.** `preview_server.ps1` has a
  `.png` MIME branch but did not serve them from subdirectories; the same 8 URLs are 200 on the live
  site with byte sizes matching disk exactly. Suspect the rig — again.
- **I offered "leave it, not worth the risk" as an option after having already built the feature.**
  Rommel, correctly: *"what kind of option is that? You made it worked and now your telling me this?"*
  Do not offer abandoning finished work as a choice.

---

## What was changed on 2026-08-15 (session 3 — QT-M00000115: one VAT flag, and the list showing YOUR change)

Two commits, `9f26ede` and `a707c5b`, both deployed and confirmed SERVED. Started from Rommel:
*"For QTM115 quotation project cost versus what was displayed in the project list is not the same."*

### ⚠ THREE different numbers, and I chased the wrong one first
- Quotation screen: **₱1,775.90** ("VAT exclusive · rates as at lock")
- Stored total, Sheet **and** Supabase: **₱1,989.00**
- His Project List: **₱4,285.90**

**I assumed the list showed ₱1,989.00 and said so confidently**, then built a duplicate-row theory on
it. His screenshots and his own **Check Project List** run disproved both — the only duplicate row is
`QT-M00000114`, and M115 was not flagged at all. **Ask for the screenshot and the built-in check
BEFORE theorising.** Both were one message away.

### Fault 1 — VAT was two flags, so the same job priced 12% apart (`9f26ede`)
Stage 1 priced from `qVatApproved`; Stage 2 rendered its radio from a **separate** `fqVatApproved`
and read that back in `recalcFQ`. Nothing kept them in step. On M115 they disagreed (Stage 1 off,
Stage 2 on) — exactly the ×1.12. Its own activity log had recorded the guard catching it:
*"Locked total kept at ₱1,989.00 — a recompute produced ₱1,775.90 (−₱213.11)."*

**Measured: 86 of 174 quotations had the two disagreeing**, 5 Final-Quotation locked, 3 with locked
totals differing by exactly the VAT factor.

VAT cannot legitimately differ by stage — same client, same account type, same sale — so it is now
**one flag**. `fqVatApproved` is **deleted as a variable**; the Stage 2 radio renders from
`qVatApproved`, `recalcFQ` falls back to it, and the approved-non-VAT persist path writes one field
instead of branching on stage. The state still carries an `fqVatApproved` **key**, written FROM
`qVatApproved` as a mirror an older cached build can read — nothing reads it back as truth, so they
cannot drift again.

**`_resolveLegacyVatSplit(state)`** migrates old saves to the treatment the **ISSUED** document
carried — Stage 2's if the Final was locked, else Stage 1's — because that is the figure the client
holds and what the locked-total guard protects. M115 → VAT on → ₱1,989.00, matching the list.
Announced in the activity log, once per serial per session.

### Fault 2 — the Project List showed YOUR last change, not the latest (`a707c5b`)
Rommel: *"regardless if I'm the one who update, it doesnt make sense that it retain my last changes
versus the latest changes of the user or whoever."* Correct, and it was two "load once and never
again" bugs stacked:

- **`gLoadDirData` returned early if `sessionQuotations` had ANY entry** — one save pinned the whole
  list to that session for the life of the tab. `renderDirectory` only read the sheet when `dirData`
  was completely empty. Neither could ever pick up another person's work.
- **All 7 merge sites laid `sessionQuotations` over `dirData` unconditionally**, so even a fresh read
  put your older copy straight back on top.

₱4,285.90 was real — **his own save at 16:05:21 on 14 Aug**, shown back to him for a day while
everyone else correctly saw ₱1,989.00. **The stored data was never wrong.**

`dirData` is now treated as a cache: **expires after 30s** (`DIR_MAX_AGE_MS`, `_dirIsStale()`) and
re-reads when the list is opened, *under* rows already on screen — the spinner is cold-load only, or
every visit flickers. The merge is recency-based through one shared helper **`_mergeSessionOver`**
(replacing 7 hand-rolled copies): a session entry wins only when genuinely newer. **Exact, not
heuristic** — every row carries `updatedAt` (column Z) and every session entry stamps its own. A row
with no timestamp predates that column, so the session copy still stands (original behaviour).

**Deliberately NOT pruning `sessionQuotations`** once the sheet catches up: ~10 other call sites read
it for things like "has this ever been saved", and deleting entries would change those answers. It
can no longer shadow anything, so letting it grow within a session is harmless.

### Verified
VAT: 7 resolution cases, extracted **from the shipped file** so the test cannot drift (the real M115
shape, both reverse splits, final-locked and not, both-agree untouched, pre-schema save untouched);
dedupe confirmed; driven through the real function in the real app. Newest-wins: 7 cases in the real
app against the real numbers — the later save wins ₱1,989.00 over ₱4,285.90, your own newest still
appears at once, a legacy row yields to the session copy, a session-only quotation still shows,
staleness true at 31s / false when just loaded. Both: collision checker clean, no console errors, no
encoding damage (0 replacement chars, em-dashes/peso/emoji counts intact), both confirmed serving.

### Method notes
- **A scripted patch must be CRLF-aware.** `index.html`'s working copy is **CRLF** (37,087 lines;
  autocrlf converts on checkout) — a `\n` pattern silently matches nothing. ⚠ **This contradicts the
  2026-08-04 note claiming the working copy is LF.** Detect it in the script rather than assuming.
  Always re-check `U+FFFD`/em-dash/peso/emoji counts afterwards.
- **Suspect the rig, twice more.** A "logs once" assertion failed because the harness shared one
  sink across 7 fresh instances; and `/tmp` does not exist on Windows — use the scratchpad.
- **The activity log solved this**, again. `serial: qSerial` on every entry meant the whole history —
  the VAT toggles, both locks, the guard firing — was reconstructible in one query.

### The repairs kept finding new things because the app was CREATING them (`4d7141b`, `a5ed564`, `d93897c`, `95aebca`)
Rommel, on being told to click three repair buttons: *"why do I have to keep on doing this and why
does it always find something. this only means that we are not correcting the root cause."* Right.
Checked whether the findings were backlog — **they were not.** Both were created AFTER the fixes
meant to prevent them (QT-M00000114 on 08-14, QT-W00000116 on 08-15).

**1. An approval updated the state but never the row (`4d7141b`).**
`_persistApprovedFieldToQuotation` writes into the quotation's STATE. Status and Locked are a
projection of that state, written only by `gSaveQuotation` — so an approval actioned by someone
else left the row behind until the requester happened to open and save. QT-W00000116's log is the
proof: locked 09:27:48, `Quotation unlocked (approved by Allan Lagsao)` 09:46:50, **and no save
ever follows**. Every unlock/non-VAT/discount/premium/signature approved by another person created
drift the same way. ⚠ `confirmUnlock` (the local PIN path) DOES save — only the approved-request
path did not, which is exactly how this survived the 2026-08-08 fix. New `_syncRowFromState`
writes Status + Locked to Sheet AND Supabase plus memory, straight after the state write.

**2. It then asked a human to fix a derived value.** Status is DERIVED — correcting it to its own
derivation is not a judgement anyone can get wrong. `fixProjectListStatuses(auto)` now corrects
without asking and says so with a toast; above 25 it still goes to a person (that many at once
means something systemic). One implementation shared with the manual button.

**3. Credits ignored the rule Rommel had already settled (`a5ed564`).**
*"whoever authored the quotation will remain as the owner… I'm an admin. and I made some changes or
I decided to approve the vat. does it make me the owner. of course not."* The checker weighed the
**Prepared-by signature** as authorship — but that is stamped **at LOCK**, so it names whoever
locked it. Evidence is now RANKED, first match wins, never cross-checked:
**1)** who claimed the number · **2)** who exported the Wufoo order · **3)** the signature, last
resort only. QT-W00000034: Kaye exported it from Order #8834, Rafael locked it — column H already
said Kaye and was **right all along**, reported only because the signature disagreed. Ranking
removes the conflict by construction, so the "two hands on it, you decide" question cannot arise.
The signature is kept as a fallback, not dropped: for older quotations it is the only record, and
QT-W00000076 resolves through it.

**4. The duplicate-row panel asked for a decision it made impossible (`d93897c`).**
*"How would I know if I'm making the right decision when I checked the project list there's only 1
qtm114."* He could not — the panel itself said *"The Project List itself cannot show you this"* and
offered a **count** as evidence. `_dupRowFindings` now carries what each row SAYS (row, client,
value, status, assigned, last updated), rendered marked KEEP/REMOVE, formatted with `fmtMoney`/
`fmtDT` so it compares directly against the line on screen: *KEEP row 57 ₱119,521.06 IQ Awaiting
Client Approval, updated 08/15/26 10:09 · REMOVE row 58 ₱0.00 Draft, never*. **"Which row is live"
was never a judgement** — every save stops at the FIRST match, so that is the live one. That was my
jargon, not something he was meant to decide.

**5. Duplicates can no longer be created (`95aebca`, Rommel approved: "yes").**
The row write is look-then-add. Two saves in the same instant — two tabs, or a laptop and a phone —
both look, neither finds a row, and BOTH add one. `_quotRowWrite` serialises within a page but is a
plain object in one tab and **cannot see another**, which is why the 2026-08-09 fix did not stop
this. `_healDuplicateRowsFor` looks again immediately after appending and removes any extra copy,
keeping the first. Deletes **by row position** (`_sheetsDeleteRowsByIndex`, descending) — never by
searching the serial, which finds the first match, the row to KEEP.
> ⚠ The one damaging outcome is **over-deleting**: two tabs healing at once compute positions from
> their own read and a delete shifts rows under the other. If that left the quotation with no row it
> would vanish from the Project List. So the result is verified and, if nothing is left, the row is
> **restored from the copy still in memory**, logged as a recovery and reported as 0 removed.
Forward-only: existing duplicates still need the button.

**6. Nothing is deleted without a copy being kept (`23d7bad`, Rommel's ask).**
*"for such dangerous decision, will it be possible that it will autoback up or will stage in a like a
recycle bin or trash and retain it for a week… in case it was misanalyze there's a point that we can
actually restore it."* He was right, and the live data is why: the REMOVE row on QT-M00000114 is
**not** the empty draft the earlier examples used — it holds **₱146,081.29** and the same status as
the row being kept (row 81 ₱119,521.06 updated 08/15 · row 83 ₱146,081.29 frozen 08/14 15:52). The
which-row-is-live reasoning is sound, but sound reasoning is not a reason to make something
irreversible.

Every removal now copies the whole row into a **`Deleted Rows`** tab of the same Google Sheet —
full contents as JSON, plus when / who / source sheet / serial / a free-text reason, so a restore
months later still says why it went. **Nothing is ever purged** (a week was the ask; clearing the
archive would be the same mistake it prevents).

> ⚠ Two design points that must not be undone:
> - It lives **inside `_sheetsDeleteRowsByIndex`**, not at the three call sites, so no future caller
>   can delete without archiving. One path doing the right thing and another not is exactly what
>   produced several faults in this file.
> - The archive is a **PRECONDITION**: if the copy cannot be written, the row stays. A failed backup
>   must never be followed by a successful delete. Tested explicitly.

Restore is in **Settings → Company & DB → "Deleted rows"**, beside Check Project List — Rommel's
placement: *"so its visible and accessible."* Lists what went, by whom, its value and why, each with
**Put it back** (`restoreDeletedRow`), which re-appends the row with exactly its old contents and
keeps the archive copy either way. Appended, not reinserted at its old position — the sheet has
moved on and every lookup here scans column A, never row numbers.

**7. ⚠⚠ THE ACTUAL ROOT CAUSE — a save could CREATE a row when one already existed (`251c1b9`).**
Rommel rejected a reconcile-then-migrate plan as another workaround: *"Why not check the logic why
this occur rather than countering again the symptoms again. in my mind, whenever a user update a
quotation, it should only overwrite the same file, not create a new file."* He was right — items 5
and 6 above both treat the symptom.

The row write had **three** paths that append, and all three read *"I could not find the row"* as
*"it is not there, so make one"*:

| Branch | Fires on |
|---|---|
| `d.error` | **ANY** read failure — `sheetsGet` surfaces quota (this app hits 429s), expired tokens and dropped connections all as `d.error`, and it created the tab and appended for every one |
| `!vals.length` | an empty or partial response |
| `rowIdx < 0` | absent from whatever came back |

**So the duplicate was never a race — it was created deliberately, by design.** That is why
`_quotRowWrite` (2026-08-09) and `_healDuplicateRowsFor` (`95aebca`) never stopped it: both were
aimed at concurrency, and concurrency was not the cause.

An append now needs **positive evidence** that no row exists: a clean read, of a sheet that plainly
has content, in which the serial genuinely does not appear, for a quotation `_quotRowKnown()` does
not already know has a row (confirmed during a save, appended by one, or loaded from the directory).
Anything short of that **fails the save out loud**, names the reason, and logs that no duplicate was
created. A failed save is visible and retryable; a duplicate stays invisible for days — and the
Supabase dual-write has already happened by that point, so the work is never lost.
`_isMissingTabError()` keeps the one legitimate create: only a genuinely absent tab (Google answers
with a parse error naming the range) qualifies.

> ⚠ **QUOTATION OPTIONS ARE UNAFFECTED — verified, not assumed**, after Rommel flagged the risk
> ("This should not affect the quotation option creation, just a reminder"). Options share **ONE**
> row: `_doCreateNewOption` sets `qBaseSerial=qSerial` and the row write uses `qBaseSerial||qSerial`,
> so option 2, option 3 and revision `.R1` all resolve to the base serial and take the UPDATE path.
> If anything this protects them — an option save that hit a read failure previously appended a
> duplicate. **Any future change here must re-check that options still resolve to the base serial.**

### Method notes (session 3, part 2)
- **"Is this backlog or new?" is the question that finds a root cause.** Both findings were new,
  which immediately disproved "just clean it up and move on".
- **A repair that keeps finding work is a symptom, not a service.** Three of these were the app
  creating drift, detecting it, and delegating the cleanup to a human.
- **Suspect the rig — three more times.** A `.like()` mock captured only the first argument
  (it takes `(column, pattern)`), so both queries returned the same branch and a PASSING rule looked
  broken; a shared log sink across 7 instances broke a "logs once" assertion; and `/tmp` does not
  exist on Windows.
- **Look at rendered output, don't just assert on it.** The duplicate table passed its assertions
  while showing raw `119521.06` and an ISO timestamp — useless for comparing against the screen.

---

## What was changed on 2026-08-15 (session 4 — the value-column checker was investigated and rejected; the audit gap behind it fixed)

One commit, `7b4adc4`, deployed and confirmed serving. Started as item 2 of the handoff (a checker
for the Project List's total column). **It should not be built, and investigating why turned up the
real defect underneath it.**

### The checker was specified with a rule that would have corrupted a live quotation
The handoff said: repair from `fqLockedTotal` if `fqLocked`, else `qLockedTotal`, else the state's
`pCalc.grand`. Two things were wrong with it before a line was written.

**First, the key name.** Stage 1's locked total is stored as **`lockedTotal`**, not `qLockedTotal` —
that is the *global's* name, not the state's. Measured: 72 states carry `lockedTotal`, **zero**
carry `qLockedTotal`. A repair written from the handoff would have found nothing at Stage 1 and
fallen through to `pCalc.grand` on every single quotation.

**Second, and worse, the fallback.** Across all 175 saved states there is exactly **one** total
mismatch, and on that one — **QT-W00000065 (DCD Studio)** — the rule would have rewritten ₱34.32 to
₱1,000, a quotation the client already holds. +2,800%.

The obvious correction (trust a stored locked total whenever it exists) is *also* wrong.
**QT-W00000080 (KME)** has an identical flag shape — `locked:false`, `fqLocked:false`, `lockedTotal`
present, `pCalc` differs — but there the row is right and `lockedTotal` is the stale figure, because
it was genuinely reopened and re-priced. **Two rules, opposite answers, indistinguishable from the
state.** No flag-based rule can separate them; the distinguisher is *why* they diverged, which lives
in the approval requests and the activity log.

⚠ **So the "Not built — the total column has no checker" item is now CLOSED as deliberately not
built, not as pending.** If it is ever revisited: the mismatch class is one row in 175, and both
candidate repair rules are proven to break a real quotation.

### QT-W00000065 — I was wrong about it, and the correction matters
I reported it as a silent drift with "nobody deciding to". **That was wrong.** There is an approved
**unlock request** on it: `req_1786588378178_on68f4`, raised by Jhover 13 Aug 02:33, approved by
Allan, `applied:true`. The quotation was deliberately reopened and the price guard released exactly
as designed — Rommel's own rule, *"unless the user intervene or unlocked the quotation."*

Two of my own filters produced the false lead, and both are worth remembering:
- `NOT IN` against `activity_log.serial`, which is **nullable** — the classic NULL trap. It made a
  count return 0 when the row plainly qualified. **List the rows; don't count them.**
- Excluding `'%Stage 2 unlocked%'` from an `ilike '%unlock%'` search — but **the price guard's own
  message ends "Unlock the quotation to change the price."**, so the guard's log line reads as an
  unlock. That is what first told me W65 had never been unlocked.

What remains true is commercial, not technical: the client was quoted **₱34.32** (₱27.18 cutting +
₱7.14 edgebanding) for work whose minimums are ₱500 + ₱500, issued 6 Aug minutes around
minimum-charge enforcement shipping that same day. It is unlocked now, presumably to fix precisely
that. **Rommel's call, no code involved.**

### ⚠ The real defect: an approval applied in the background left no trace (`7b4adc4`)
When an approved unlock is applied while the quotation is **not open on screen**, the app changes
the saved record — clears `locked`, wipes `sentStatus`/`sentAt`, releases the frozen price — and
wrote **nothing** to that quotation's history. The on-screen branch of `_applyApprovedRequest` logs
*"Quotation unlocked (approved by X)"*, but it is gated on `appliesToOpenQuotation`; the state-writing
path in `_persistApprovedFieldToQuotation` logged nothing at all.

That is exactly why W65 read as corruption: locked, shared via Viber, then the lock simply gone with
no line saying who or why.

**It could not be logged before.** `logActivity(action)` took no serial and `gLogToSheets` hardcoded
`serial: qSerial||qDraftKey||''` — the quotation *on screen*. The apply path acts on a quotation that
is by definition not open, so a line written there would have been filed onto **someone else's**
quotation. Both existing `logActivity` calls in the phone-apply path already had this defect: they
name the target serial *in their text* while being filed under the open one.

Fixed: `logActivity(action, serial)` and `gLogToSheets(action, serial)`. The on-screen panel still
shows only the open quotation's own history (`qLog`/`renderActivityLog` are skipped when the serial
is someone else's), and a draft still logs under its `DRAFT-` key. The line is written **centrally**,
in `_persistApprovedFieldToQuotation` where the change is actually made, with provenance passed down
as a third argument — so one decision leaves **one** line, on the right quotation, instead of two on
the wrong one.

**Verified against the real functions, with a control.** Five stamping cases (no serial → open
quotation and shows in the panel; another serial → that quotation and *not* in the panel; the open
serial passed explicitly → still shows; a draft on screen → its draft key; a background approval
while a draft is open → the target serial, not the draft). Then W65's exact scenario end to end:
with the serial argument ignored (old behaviour) the entry lands on **QT-M00000115**, an unrelated
quotation; with the fix, on **QT-W00000065**. The simulated apply reproduces W65's stored state
exactly — `locked:false`, `sentStatus:''`, `lockedTotal` preserved at 34.32 — which is what confirms
the mechanism rather than merely fitting it.

### Flagged, deliberately NOT changed
The two unlock paths disagree about the client's approval: the on-screen one clears
`qClientApproved`/`qClientApprovedAt` when reopening (*"re-editing after unlock invalidates any prior
client sign-off"*), the background state mutate does not — it clears the fq fields in the `fq` branch
only. W65 still reads `clientApproved: true` while unlocked, which is why its status shows
"IQ Approved". Making them agree changes whether a client sign-off survives a reopen, which is a
business rule, not a tidy-up.

### A client-approved Initial Quotation is now closed to editing (`3b2bd58`)
Rommel, asked how far an unlock should roll the status back, replaced the question with a simpler
rule: *"when the initial quotation is already Approved by the client, then it should not be allowed
to be edited. And changes should already happen in the final quotation wherein they have the option
still to provide multiple options. When an attempt was made to request for revision for already an
approved quotation, a pop message should appear... For any unlock by the user to quotation that is
not approved yet by the client or still waiting for client approval, status should change
accordingly."*

- `requestUnlock()` and `openRevise()` refuse once the client has approved, with a popup saying the
  change belongs in the Final Quotation. Both the approver's PIN route and the non-approver's
  send-request route are gated at the same point, so neither can slip past.
- **Not-yet-approved quotations needed no work** — with no approval flag set, `_statusFromState`
  never enters the Final-loop branch and already falls through to `IQ Under Revision`. The status
  only failed to move on *approved* quotations, and this rule removes that case entirely.
- The gate tests `qClientApproved || qApproved` — **the same test `_statusFromState` uses** — so what
  it refuses and what the Project List shows cannot disagree. `approved` is the older flag for the
  same moment, so legacy quotations are covered.
- **Forward-only** (Rommel: *"no need to get back to already existing quotation. This should reflect
  on new revisions only."*). The 3 quotations already sitting reopened-but-approved are left alone.

### ⚠ The revision number had never once appeared for anyone but Rommel
He noticed `.R1` was missing. The mechanism was entirely present and correct — `confirmUnlock` sets
`qRevisionPending`, `doLockOnly`/`confirmSend` call `_applyRevisionBump()` — but **only the PIN path
ever set the flag.** The approval-request unlock paths, on-screen and state-writer alike, cleared the
lock and never marked a revision as owed.

Measured on the live log: **53 of 71 unlocks came through the request route.** The only four
revisions ever stamped were his own via the PIN, all on test quotations since deleted — which is why
no serial, row or state anywhere carries `.R`. Nobody else could ever have got one.

Both paths now owe it, and `revisionPending` rides on the saved state so it survives to whenever the
quotation is next opened. Still stamped **at re-lock, never at unlock** — a draft is an unfinished
edit, not a version — and the row key stays on the base serial, so nothing is renamed.

> ⚠ Do not "fix" this by stamping at unlock. And note `_applyRevisionBump` sets
> `qSerialCommitted=false`; the row key deliberately keeps the base serial while `qSerial` carries
> `.R1`, which is why a revision never appears as a `quotation_states` row key.

### ⚠ Options: an approved unlock left the option itself locked (`54098ad`)
Rommel's report: *"they unlocked the option 1 and option 2, and locked the option 1 only, the option
2 is also locked."* He also linked it to mobilization reading zero.

An option carries its **own** `locked` flag, set by `doLockOnly`, and `switchToOption` lets that flag
win over the snapshot on the way in. `confirmUnlock` has cleared it since 2026-08-12 — **but only
`confirmUnlock`.** The approved-request unlock (on-screen branch AND state writer) cleared `qLocked`
and left the option flag true, so the quotation looked unlocked until you switched options, and
switching back re-locked it.

**Third instance of the same shape in one day** — the PIN path fixed once, the request path never
brought along (see also the revision flag, `3b2bd58`). 53 of 71 unlocks come through the request
route, so for anyone who is not an approver unlocking via PIN, the flag never cleared at all. Both
paths now call one shared helper (`_unlockActiveOption` / `_unlockActiveOptionInState`).

> ⚠ **When fixing anything about locking, unlocking or approval, fix BOTH routes.** The PIN path
> (`confirmUnlock`, `doApprovalAction`) and the approval-request path (`_applyApprovedRequest` +
> `_persistApprovedFieldToQuotation`) are separate implementations of the same decision, and the
> request path carries ~75% of real traffic.

**The mobilization half was NOT reproduced.** `restoreQuotationSnapshot` did overwrite
`mobCalc`/`mobTransport`/`mobAccom` on **absence**, turning "this option predates the field" into
"this option has no mobilization" — hardened so absent now means unknown (present-but-empty still
clears; `locked` was always guarded this way). But measured: only **10 of 40** option snapshots lack
`mobCalc`, **all June test-era quotations with no mobilization to lose**. So it is real in code and
costs nothing today. **Mobilization-reads-zero remains unexplained** — if it recurs, get the stage
and the exact field, and check whether it followed an option switch.

### ✅ `qBaseSerial` REMOVED — the number is stored once (`91c9801`)
The long-standing structural item, done. `qBaseSerial` was a second copy of the quotation number kept
in step by hand in **eleven** places; it is now a **read-only derived property** — a getter on
`window` returning `_serialRoot(qSerial)`. All eleven assignments are gone; assigning warns and is
inert. 77 references → 69.

**Why the derivation is exact** (this is the fact that makes it safe, and it was checked before any
edit): `getDisplaySerial()` builds `qBaseSerial+'-'+optionId`, so **the option suffix is DISPLAY ONLY
and `qSerial` never carries it.** A revision keeps the row on the base. So `_serialRoot(qSerial)`
equals the old `qBaseSerial` for plain, option-active, revision and draft alike.

**Checked against all 175 saved quotations BEFORE changing anything: 174 already identical.** The one
exception is `QT-W00000048` — the Supabase-only orphan absent from the Sheet — whose state carries
`QT-M00000086`; it now files under the number the quotation itself carries, which is the settled rule
for a split (the client's copy wins).

> ⚠ `baseSerial` is **still WRITTEN** into the saved state (line ~30164), so a browser on an older
> cached build still reads what it expects. It is simply no longer read back —
> `restoreFullQuotationState` derives from `state.serial` and only *warns* if the stored field
> disagrees. Do not remove that write until every client is known to be on this build or later.
>
> ⚠ `_assertSerialAgreement` is now largely moot by construction. Left in place: it still guards the
> Sheet row key, which is a different store.

Verified on a fresh load: no console errors, every function that reads it defined, eight serial shapes
deriving correctly (plain · option active · revision · revision+option · second revision · both legacy
formats · empty), filing key stable across all of them, assignment refused.

### Method notes
- **Investigate before building, even when the handoff specifies the design.** The specified rule was
  wrong in two independent ways, and one query found both. Same shape as the disabled credits repair:
  mechanism verified, meaning assumed.
- **A patch script that throws before `writeFileSync` leaves the file untouched** — that fail-safe
  caught three bad anchors on the `qBaseSerial` change with no cleanup needed. Keep the write last.
- **Plain-string replace matches SUBSTRINGS, not lines.** `"  qSerial=''; qBaseSerial='';…"` is inside
  the 8-space-indented copy of itself, so a 2-space anchor matched twice. Anchor on the preceding line
  whenever indentation is the only difference, and never trust an indented one-liner to be unique.
- **Two symptoms reported together often share one cause, but verify rather than assume.** The option
  lock and mobilization-zero were reported as one thing; the option half reproduced exactly, the
  mobilization half turned out to affect only dead test data. Fixing both was right; *claiming* both
  were the report would not have been.
- **`restoreQuotationSnapshot` throws on a snapshot missing `areas`/`assembly`/`siteVisit`/
  `cuttingList`** — build test snapshots from a real `captureQuotationSnapshot()` and delete keys,
  never hand-roll a minimal one.
- **"Feature X never appears" is a question about which code path users actually take.** The revision
  code was correct and had been for two weeks; the flag that arms it sat on the one route almost
  nobody uses. Counting the two routes in the activity log settled it in one query.
- **A missing artifact can mean the records were deleted, not that the code failed.** Four revisions
  were stamped and none survives, because all four were test quotations Rommel later removed.
- **A handoff naming a stored field may be naming the global instead.** `qLockedTotal` vs
  `lockedTotal` — check the data, not the prose.
- **When two candidate rules disagree on identical inputs, neither is the rule.** That is the signal
  to stop and find the real distinguisher, not to pick the more plausible one.
- `activity_log` columns are `at / user_email / action / serial` — **not** `created_at`.

---

## What was changed on 2026-08-15 (session 4b — the order response clock, and status alignment)

Eight more commits, `40d6d4c`..`378d161`. All deployed and confirmed serving. Every finding below
came from querying live data or driving the code.

### ⚠ The response clock was not stopping — two causes, both measured (`4ebd2b6`, `ff79e88`, `7f4fd86`)
Rommel: *"how come the time does not stop even if many of this were sent already?"* He was right, and
it was worse than a display fault — orders sat at 71h and 76h and climbing on quotations sent days
earlier.

1. **The link died with the session.** `orderMarkSentFromQuotation` did nothing unless
   `qSourceOrderId` was set, and that is assigned only by `exportOrderToQuotation` and lives in
   memory. Reload the tab, or open the quotation from the Project List rather than from its order,
   and the Share buttons had nothing to close. **8 of the 9 open orders had no usable link**, four of
   them on quotations already marked *"Shared via Viber"*. The order has always stored the quotation
   serial, so it is now looked up from that side too (`_orderAwaitingQuotation`), matched on
   `_serialRoot` so an option or revision suffix still resolves. A Done/Cancelled/Archived order is
   never matched, so a later re-share cannot reopen something finished.
2. **Three send paths never stopped it at all.** Lock & Send (`confirmSend`) and the multi-option
   send (`confirmSendVersions`) marked the quotation sent and left the order running. Measured across
   the whole activity log: **Share→Viber 121, Lock & Send→messaging 28, Share→Email 14, Lock &
   Send→email 11, Share→via apps 6, Copy 5** — so **39 real sends** went through the path that never
   stopped the clock.

> **The rule, now uniform and checkable in one line:** every function that calls `_markSent` also
> calls `orderMarkSentFromQuotation`, with exactly ONE deliberate exception — **copy to clipboard**
> (Rommel: *"what is not included that will stop the clock is the copy to clipboard and download"*).
> Download and Skip do neither. **Locking never stops the clock**, by any route — verified against
> all 15 real log strings.

### Mark Done removed, and the stranded clocks corrected from the log (`c9698e2`)
Rommel: the button is redundant now the Share buttons work. It also could never have repaired
anything — it stamps `sentAt` as NOW, so a job answered on 6 August would read as answered today,
slower than it was. `_setOrderStatus` gained an optional explicit send time; every ordinary caller
omits it and still gets now.

**`_findUnclosedSentOrders` / `fixUnclosedSentOrders`** (Settings → Company & DB) reads the
append-only activity log for the real moment. Deliberately narrow because it writes history: the
FIRST send only, never an entry recorded before the order arrived, never a draft key, never a
non-send line, never an already-finished order. **Run 2026-08-15: 7 orders corrected** (8836, 8848,
8852, 8854, 8856, 8857, 8858), all at their true send times.

⚠ The matcher was initially missing `"Sent versions to client: …"`. Rommel: *"some of the team is
also using other options I mentioned to send to clients so you should check their log as well."*
**Take the phrasings from the functions themselves, never guess them.**

### Three unlinked orders traced by hand — and why auto-tracing was rejected
The team confirmed four orders were quoted in the app but never linked. Verified each against the
log before writing: **8814→QT-W00000038, 8833→QT-W00000034, 8842→QT-W00000044** applied;
**8834** refused because the serial Rommel gave (`QT-W00000046`) has project *"Ronald Rellera"*,
which belongs to order **8840**, not 8834.

**Automatic tracing was investigated and rejected on the evidence:** ROBERT VALERA has four
quotations, so orders 8833/8834 each match all four by name; and the team's `MSRF#` convention
already collides — **`MSRF#8842` appears on both `QT-W00000044` and `QT-W00000065`**. An auto-link
would have closed the wrong order and left a real one running. A candidate *picker* was offered
(app finds, person decides — the duplicate-row pattern) and not yet taken up.

### Team performance filters by whose team (`bbf8169`)
Rommel: *"It should filter based on the company of the user and by subsidiary that they catered."*

**Every one of the 109 quotations by the Module Systems staff** — Jhover 40, Stephanie 36, Joanna 21,
Kaye 12 — **was raised under World Class Laminate or Cebu World, never their own company.** MSSI is
in practice a shared service centre. The single filter keyed on the QUOTATION, so "Module Systems"
returned **nothing** and "World Class" showed MSSI's work as WCL's. Now two: **Team** (the person's
company) and **Catered for** (the quotation's). Both use `_quotCompanyKey`, so the singular
*"Module System and Services, Inc."* in the Sheet still maps.

### The order card leads with the quotation's status (`d8d853f`, `378d161`)
Rommel: *"I want to flow similar with the quotation … so its clear whether I check in the project
list or order."* Once a real quotation exists the card shows its ladder status — same words, same
theme-aware pill classes as the Project List. **Nothing is stored or synced**: it reads the quotation
at render time, so it cannot drift.

**Only `Cancelled` overrides it** — a person pressed Cancel on the order and nothing in the quotation
records that. **`Archived` defers**, because archiving is the quotation's own doing.

> ⚠ **Corrected by Rommel:** I illustrated this with "archived after the job was won", which **cannot
> happen** — the win trigger was removed 2026-08-12 (`dc2e78b`). **`confirmCancelQuotation` is the
> ONLY caller of `_archiveOrdersForQuotation`**, so the Archived tab holds declined jobs only, and
> now reads *Declined* rather than *Archived*. A won job is the start of the work, not the end.

### An order action stops landing in an unrelated draft (`b95b60c`)
Deleting orders 8758/8796/8821 filed *"Order #8821 deleted"* against `DRAFT-ed2929`. `gLogToSheets`
treated `''` and *not given* identically, so an explicit "no quotation" was impossible. Now
`undefined` = use the screen; `''` = belongs to no quotation. Order actions file against the order's
own quotation when it has one (`_orderLogSerial`), and nothing when it does not.

### Re-close a reopened quotation at the issued figure (`40d6d4c`)
`_findReopenedIssued` / `reCloseIssuedQuotations`. **The Lock button cannot do this** —
`doLockOnly` calls `_captureLockedTotal`, which pins whatever the quotation computes NOW, so pressing
Lock on QT-W00000065 would have written ₱1,000 over the ₱34.32 the client holds. This moves `locked`
only. **Run 2026-08-15: W65 re-closed, still pinned at ₱34.32.**

### Method notes
- **Rommel corrected me three times and was right every time**: copy-to-clipboard should not stop the
  clock; the other send paths are in real use (39 sends); and a won job is never archived. **Play the
  rule back before building, and when he says a behaviour was already decided, check the code rather
  than the memory of it.**
- **A test case you invent to prove logic is not evidence of behaviour.** "Archived after the job was
  won" passed the test and misrepresented the app. Illustrate with states that actually occur.
- **Ambiguity is a reason not to automate.** Four candidates for one client, and a naming convention
  that already collides, is the signal to build a picker rather than a matcher.

---

## ⚠ APPROVAL ROUTING — the rule, as Rommel defined it 2026-08-15 (`e171985`, `349b97a`)

**Routing allocates responsibility according to the process. It does not describe authority.**
Rommel: *"it does not define authority but allocation of responsibility based on the process"*, and
*"whoever is set in the routing that is the person who is responsible for it that is why we define
it."*

| Who | May act on a routed request |
|---|---|
| The person in the routing | **yes — it is theirs** |
| Their **active delegate** | **yes** — delegation (Settings → Users) is the one function meant to change the flow |
| **Admin** | bypass, **recorded as an exception** |
| **Director** | bypass, **recorded as an exception** — same level of authority and access as Admin |
| **Manager** | **refused** |
| anyone else | **refused** |

### What was wrong, and why it was invisible
`findApproverForAction` has always resolved ONE named person, but **nothing ever checked that the
person clicking Approve was that person.** Two things combined:
1. **Visibility is deliberate** — `filterApprovalsByRouting` shows a Manager every request from their
   own company, so managers can see what is happening in their area.
2. **The PIN gate proved identity, never authority.** `doApprovalAction` set
   `_pinModalApprover=findApproverForSelf()` — the CURRENT user — so it asked *"is this really you?"*
   and never *"is this yours to decide?"*.

Found on live data: **three discount requests routed to Rommel, all three approved by Allan Lagsao**
(Manager). Rommel: *"What is the point of routing if someone can just snatch the approval just
because they saw it even though their not authorize?"*

`_apprWhoMayAct(n)` now decides, checked **before the PIN** so someone who may not act is told rather
than asked for a PIN and refused afterwards. Every bypass sets `overrodeRouting` on the request and
writes its own activity-log line naming who it was routed to.

> ⚠ **Signatures were ALREADY correct and are stricter — do not "align" them.** `confirmSignature`
> checks the signatory twice and allows **no delegate and no override, not even Admin**, because a
> signature puts a named person's mark on a client document. That asymmetry is deliberate.
>
> ⚠ **The six decision types have no fallback row and do not need one** (asked and answered
> 2026-08-15). Signature slots have `checkedAlt`/`notedAlt` precisely *because* nobody can sign for
> another person; decisions do not, because Admin/Director hold that authority themselves —
> *"That's why there's admin, since we have the same level of authority and access."*

### Live configuration as at 2026-08-15
Routing is **fully configured** for all three companies × all action types. Noted-by thresholds set
to **₱20,000** each. Discount / CF Override / Premium / Accommodation → **Rommel** (all three
companies); Non-VAT → **Kathleen Joyce Tiu**; Unlock → **Allan** (WCL, MSSI) / **Stiffany** (CWL);
Checked by → **Joanna** (WCL, MSSI) / **Stiffany** (CWL), with fallbacks set.

⚠ **Nobody has a delegate configured** — all six approvers have `delegate_to` empty. **Delegation is
available to every approver in Settings → Users, Kathleen included** (Rommel, 2026-08-15: *"she has
the delegation function as well in the user setting"*), so absence already has an in-process answer
that needs no bypass — it simply is not set up yet. Until it is, an absent approver's items fall to
an Admin/Director bypass. Working as designed; worth knowing before reading a rise in overrides as a
fault.

⚠ **PINs live ONLY in the Google Sheet (User Roles cols W/X)** — the Supabase mirror was dropped
2026-08-08 for being wrong, so PIN state **cannot be checked from SQL**. With enforcement live, a
routed approver with no PIN can no longer be quietly covered by someone else.

### Method note
I described this gap as though it were the design, and was told so: *"Your being reckless again …
get back on how we design it before telling me this."* **The intent was recorded in this file and in
`findApproverForAction` itself — routing table, delegation, escalation threshold. Read the intent
before describing current behaviour as a choice.** I then compounded it by reverting a correct
Director fix after misreading a rebuke as "stop changing things".

---

# OPEN — updated 2026-08-15 (session 4, END OF DAY) — THIS IS THE AUTHORITATIVE LIST

## Nothing is waiting on the developer. Three things are waiting on people.
1. **⚠ Rotate the Wufoo API key.** Still in public git history since July. The only item with a
   security clock on it. Wufoo → Account → API Information, then update `WUFOO_API_KEY` in the Apps
   Script project.
2. **Orders 8834 and 8840** — the team says which quotation each was. **Settings → Company & DB →
   Check Project List** now lists the candidates with their evidence and a Link button (Admin only).
   8834 is either `QT-W00000040` (RJJ Kitchenette, never sent — order correctly stays open) or
   `QT-M00000101` (Africano Kitchen, sent 12 Aug). 8840 is very likely `QT-W00000046` (Ronald
   Rellera, sent 3 Aug).
3. **Two habits no code can fix.** **Client Approve** has been pressed twice ever, so win rate and
   won revenue read near-zero. **Arrival source** (Walk-in / Email order) is set on 16 of 189, so
   most jobs have no response time. Do NOT "fix" either by changing the KPI — check whether the
   button was pressed first. That has already been the answer once.

## Now that approval routing is enforced — two things to check
- **Nobody has a delegate configured.** Every absence now falls to an Admin/Director bypass rather
  than a named stand-in. Delegation is available to every approver in Settings → Users. See the
  APPROVAL ROUTING section above for the full rule.
- **PINs cannot be checked from SQL** (Google Sheet cols W/X only). A routed approver with no PIN can
  no longer be quietly covered by someone else — worth confirming Kathleen, Allan and Stiffany have
  one.

## Open, unexplained
- **Mobilization reads zero.** Reported 2026-08-12, never reproduced. The option-lock half of that
  report WAS real and is fixed (`54098ad`). The snapshot path that could null mobilization was
  hardened, but the only affected snapshots are ten June test options with nothing to lose. **If it
  recurs: get the stage (1 or 2), the exact field, and whether it followed an option switch.**
- **Order #8862 carries a `sent_at` of 8 Aug while still In Progress.** The app only writes a send
  time when marking Done, so it was probably closed then reopened. Flagged, not touched — it will
  distort the average when it does close.
- **The Orders page sometimes falls back to reading the Google Sheet** (amber banner), which holds
  more rows than Supabase. While that banner is up, the tab counts and any SQL query will disagree.

## Parked by Rommel
- **Colour / readability sweep.** Not a priority; he will say when. The measured one: **all 31
  `.btn-primary` buttons fail AA in dark mode** (white on `rgb(91,149,209)` = 3.15, needs 4.5).
- **Six remaining unlinked orders** (8820, 8862 and others) — the Admin picker exists; it needs the
  team's knowledge, not more code.

## Longer-term, unchanged
Subsidiary material billing differs between BOM and cutting-list mode · Price DB ~39,420 blank-unit
rows (**fill the units, delete nothing** — ~10,000 SKUs exist only as one) · hardware still on the
assumed 30% pending procurement data · **PMES sign-in (do not drop its anon policies first)** ·
website order pipeline (live SKUs, hole count, grooving variants) · Cabinet POC unverified types +
oven tower · FORGE detection.

---

# OPEN — superseded, kept for detail — updated 2026-08-15 (session 3)

## ⚠ ONE click left for Rommel — everything else now handles itself
Rommel ran the checks on 2026-08-15: **"Every Status matches"**, *1 credit corrected*, *1 date filled
in*. Only one item remains, and it is the only one that still needs a person:

- **Remove the stale copies** — `QT-M00000114` has **2 rows**. The panel now SHOWS both, so the
  click is informed: *KEEP row 81 ₱119,521.06 IQ Awaiting Client Approval, updated 08/15/26 10:09* ·
  *REMOVE row 83 ₱146,081.29 IQ Awaiting Client Approval, 08/14/26 15:52*. Forward-only prevention
  shipped (`95aebca`), so this is the last existing duplicate — no new ones can be created. And it
  is now **reversible**: the row is archived to the `Deleted Rows` tab first and can be put back
  from Settings → Company & DB → **Deleted rows** (`23d7bad`).
  > ⚠ Note the REMOVE row carries **real money**, not the ₱0.00 draft the first examples assumed.
  > Row 81 is still the correct keep — it holds ₱119,521.06, which is what the Project List reads,
  > and row 83 froze mid-edit at 15:52 on 14 Aug (its own activity log shows ₱146,081.29 at 15:48,
  > changed away at 15:52). Do not "simplify" the KEEP/REMOVE display back to a count.

**Do NOT re-add "clicks for the user" that a rule already answers.** Status now auto-corrects
(derived value → its own derivation, no judgement possible) and credits resolve by ranked evidence.
The remaining manual step exists only because it deletes rows that predate the prevention.

## Watch these — shipped this session, correct in test, not yet observed in production
Not defects, and **do not "fix" them pre-emptively** — just the things to look at first if something
seems off in the next few days:
1. **`_resolveLegacyVatSplit`** resolves 86 quotations as they are opened, one activity-log line
   each. Expected. If a total moves 12% on open, that is this — and it is moving it TO the figure
   the quotation was locked and issued at.
2. **Status now auto-corrects** on opening the Project List (`fixProjectListStatuses(true)`). It
   should be silent after the first pass; repeated corrections of the SAME serial would mean
   something is still writing a stale status.
3. **Extra Sheets reads.** `dirData` expiry (30s), the heal's re-read after an append,
   `_syncRowFromState` per approval, and the archive read before a delete. All on infrequent
   actions, but this app **does** hit 429 quota limits — if those reappear, this is where to look.
4. **The save can decline to rewrite the row** (`118f888`). A NORMAL save overwrites its own row —
   that is every ordinary save. The decline only fires when the READ failed, which is precisely
   where the old code created a duplicate. The read now retries with backoff on 429 first, so
   this should be rare. When it does happen the user sees *"Quotation QT-XXXX saved. The Project
   List row will catch up on your next save."* — **not** a loss message, because nothing is lost
   (Supabase and the state are already written). ⚠ Rommel: *"if this will what appear then
   everyone will panic"* — do NOT reword this back into anything that reads as a failed save.
5. **Approvals applied in the background now leave a line** (`7b4adc4`, session 4) — e.g. *"Unlock
   approved by Allan Lagsao — applied to this quotation (from a phone)."* on the quotation it
   actually changed. One line per decision; the phone path no longer writes its own. If a quotation's
   history starts showing entries that belong to a different job, that is the serial argument being
   passed wrongly somewhere and it is the thing to look at.

## For Rommel — one commercial decision, no code involved
**QT-W00000065 (DCD Studio)** went to the client at **₱34.32** — ₱27.18 cutting + ₱7.14 edgebanding —
for work whose minimum charges are ₱500 + ₱500, so a recompute today gives **₱1,000**. It was issued
6 Aug, minutes around minimum-charge enforcement shipping that same day.

It is **already unlocked** (Jhover requested it 13 Aug, Allan approved) so it is open for revision
right now, presumably for exactly this. Nothing is broken and nothing needs fixing in the app — the
only question is whether the revision goes to the client at ₱1,000. **Do not let anyone "repair" the
₱34.32 in the Project List instead** — see the closed checker item below for why that would be wrong.

⚠ **STILL UNDECIDED as of 2026-08-15 — do not record it as settled.** Rommel answered "honour ₱34.32,
stop the drift" earlier that day, but **on a premise that turned out to be wrong** (I had reported a
silent price drift; there was none — the quotation had been deliberately unlocked). He was told so,
and has not re-decided. A later remark that "its revision belongs in the Final Quotation" was *my
inference from the new client-approved rule*, not his decision about this quotation.

Two facts he needs when he does decide:
- **Today's gate does not re-close it.** The rule blocks new attempts to reopen a client-approved
  quotation; W65 is ALREADY reopened (`locked:false`, `fqStarted:false`, unchanged since 13 Aug), so
  there is nothing for the gate to bite on and Stage 1 remains editable on that job.
- Consequently anyone who opens and saves it moves the Project List figure from ₱34.32 to ₱1,000 —
  not silently any more, but without a decision having been taken either.

## Known, not urgent — Supabase holds ~189 quotations, the Sheet ~85
Quotations deleted from the Sheet before `supaDeleteQuotation` existed (2026-08-02) never reached
Supabase. **So any SQL count of `quotations` overcounts by roughly 100** — trust the app's number,
not a query. It also means the Project List read cannot be flipped to Supabase until those orphans
are reconciled. That flip is now **optional hardening** (`serial` is the PRIMARY KEY there, so a
duplicate would be rejected outright rather than prevented in app logic) — it is no longer the fix,
because `251c1b9` addressed the cause.

## ✅ CLOSED 2026-08-15 (session 4) — the total-column checker was investigated and REJECTED
It is still true that `checkProjectListData()` compares status only and nothing checks column G.
**Do not build the repair.** Measured on live data: the mismatch class is **one row in 175**, and
both candidate rules are proven to break a real quotation.

- The rule this list used to prescribe (`fqLockedTotal` → `qLockedTotal` → `pCalc.grand`) names
  **`qLockedTotal`, which does not exist in the state** — it is the global's name; the stored key is
  **`lockedTotal`** (72 states have it, 0 have `qLockedTotal`). It would therefore fall through to
  `pCalc.grand` on every quotation, and on **QT-W00000065** that rewrites ₱34.32 → ₱1,000 on a
  quotation the client already holds.
- The obvious correction (prefer a stored locked total whenever present) breaks **QT-W00000080**,
  which has an identical flag shape but is legitimately mid-revision, so its row correctly follows
  the new price.

Two rules, opposite answers, identical inputs → no flag-based rule exists. The distinguisher is the
approval requests and the activity log, not the state. Full working in the 2026-08-15 session 4
entry above.

## ✅ PWA install — CLOSED 2026-08-15 (session 4)
Rommel: *"PWA is working fine based on earlier update."* Both apps install separately with their own
icons. The scope fix (`67cab3c`) did it; nothing further is owed. **Ignore the "still pending — one
device test" section below, kept only for the background on how it was diagnosed.**

## ⚠ Still pending from session 2 — one device test, then it is closed
The PWA install collision is **fixed and deployed** (`67cab3c`, confirmed serving). Nothing left to
build. What remains is Rommel's test, which no tooling here can do:

1. **Uninstall BOTH apps completely**, then install **Modcraft**, then install **Modcraft Approval**.
   Expected: two separate home-screen entries, each with its own icon.
2. **Also check Modcraft still installs from the bare `https://rotaligatos.github.io/modcraft-app/`
   URL** (a bookmark, not the home-screen app). That is the only residual risk the narrow scope
   introduces, and the `replaceState` normaliser exists specifically to protect it.
3. **If it still collapses**, the remaining lever is bigger and needs a decision, not another patch:
   the two apps must stop sharing a directory — either move `index.html` under `/modcraft-app/app/`
   (breaks the Google Site embed URL, Supabase redirect config, Google OAuth origins and everyone's
   bookmarks) or serve `approve.html` from a separate origin (changes the push subscription
   endpoints and every notification link already sent). Neither is worth doing on a guess — get the
   test result first.
4. ~~Confirm what "one for support and one for main" meant~~ **DONE** — it described this same
   collision, not a third icon. **Do not raise it again.**

## Everything else
Nothing else changed this session that affects prior open items. **The 2026-08-12 session 2 list
above (line ~5537, "OPEN — updated 2026-08-12 (session 2)") is still the authoritative source for
all OTHER open work** — the 4 "FIRST THING NEXT SESSION" items there (remove `qBaseSerial`;
mobilization-reads-zero-after-unlock investigation; the two already-resolved items struck through)
are unchanged and still pending, in that order, once the device test above confirms this is closed.
