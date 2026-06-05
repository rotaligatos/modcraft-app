# Modcraft App — Project Context for Claude

## What this project is
A single-file HTML quotation management app for **World Class Laminate, Inc. / RTMO Digital School** (interior fit-out / modular furniture company based in the Philippines). No server — the entire app is one file (`index.html`) deployed on **GitHub Pages** and embedded in a **Google Site**. All data persists in **Google Sheets** and **Google Drive** via the Google Sheets API and Drive API using OAuth 2.0.

## Live URLs
- **GitHub repo:** https://github.com/rotaligatos/modcraft-app
- **Live app (GitHub Pages):** https://rotaligatos.github.io/modcraft-app/
- **Google Sheets database:** https://docs.google.com/spreadsheets/d/1Rs79K8wX27lxVRddksNlYwdyesTCOjIhHCqH0jRMV-o
- **Google Drive folder:** The app creates "Modcraft Quotations" in the signed-in user's personal My Drive (NOT the old hardcoded folder `1hK4iox_XmAFWOD-mMGjpEHBENOxJneeB` which was the original broken approach)

## Key files
- `index.html` — the entire app (HTML + CSS + JS, ~9000 lines)
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
prodSettings         // { claudeKey, kerf, aiEnabled, cabinetRules, ... } saved to localStorage

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
- **Claude API key** stored in Google Sheets `User Roles` sheet header row column R (shared across all users)
- Per-area grouping; editable reflect summary; "Reflect to quotation" pushes AI result into quotation
- EBT legend and cabinet rules configurable in Settings → Designers Support
- `prodSettings` object (saved to `localStorage` as `mc_prod`): `claudeKey`, `kerf`, `aiEnabled`, `shopDrawing`, `cabinetRules`

### Clients page
- Full client directory loaded from `Clients` Sheets tab
- **B2B segments:** General Contractors, Architects & Interior Designers, Real Estate Developers, Commercial, Hotels & Hospitality
- **B2C segments:** Homeowners, Condo Owners, First-time Homebuyers
- Client search/autocomplete on quotation form; auto-creates client record from quotation info
- Transaction history per client (pulled from Quotations tab)

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
| Designers Support | Claude API key, kerf, EBT/cabinet rules |

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
6. **Quotation sticky header** — company banner + Stage 1/2 nav bar + options bar wrapped in `#q-sticky-header` (`position:sticky;top:0;z-index:100`) so they freeze when scrolling
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

## Known remaining areas to watch
- **Blank PDF on Send email** — `_buildPdfBlob()` currently calls `printQuotation('')` which opens the print dialog; auto-PDF-generation via html2canvas consistently produces blank output (html2canvas limitation in this app's context); user saves PDF from print dialog and attaches manually
- **Carcass pricing tab** in Settings — not yet verified as persisted through `gSaveAppSettings`
- **Drive saves in Google Sites embed** — token refresh via `prompt:''` is blocked in iframes; users must re-auth via banner ~hourly
- **First-time setup flow** — user needs to: sign in → Settings → Test connection → Create missing tabs → Save settings
- **Google Sites iframe cache** — after pushing a fix, the embed shows stale version; fix: edit the Google Site, append `?v=N` (increment N each time) to the embed URL, republish
- **Cross-session approval apply** — `_applyApprovedRequest()` updates the quotation form only if it is open in the same browser session; requester must navigate away and back to see the approved state if they were on a different page when approval happened
- **User Roles sheet column R** — Claude API key is stored in header row column R (index 17); this is the same column used by the `Projects` ACC_KEY for data rows — no conflict because Claude key is only read from `rows[0]` (header) and ACC_KEY data is read from `rows[1+]` (data rows)
- **`_localActions` guard duration** — approval/counter actions are guarded for 30 s against poll revert; if the Sheets write takes longer than 30 s (network issue), the next 60 s poll may briefly revert the status before the write completes

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
