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

## Google Drive structure (per signed-in user's My Drive)
```
Modcraft Quotations/          ← created automatically on first save
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
SHEETS_ID          // Google Sheets file ID
GOOG_CLIENT_ID     // OAuth client ID
gToken             // current access token (null if not signed in)
gTokenExpiry       // epoch ms when token expires
gDriveFolderId     // cached root Drive folder ID
gDriveFolderPromise // in-flight promise (prevents duplicate root folder creation)
gQuotFolderCache   // { serial: folderId } — per-quotation Drive subfolder IDs
gQuotFolderPromise // { serial: Promise } — in-flight subfolder creates (race guard)
CF                 // cost factors object (markup, VAT, contingencies, etc.)
MOB_LOCATIONS      // mobilization cost locations array
liveClients        // loaded from Sheets Clients tab; never replaced with demo on error
dirData            // loaded from Sheets Quotations tab; never replaced with demo on error
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
- World Class Laminate, Inc.
- RTMO Digital School
- Module (third entity)

## User roles
Admin → Manager → Supervisor → Approver → Encoder → Staff → Viewer
Certain actions (non-VAT, revision, unlock) require Manager/Supervisor PIN.

## Settings persistence
Settings are saved when the user clicks **"Save settings"** in the Settings page header.
They are loaded automatically at login (`gShowApp()` → `gLoadAppSettings()`).
Covers: CF (all cost factors), MOB_LOCATIONS, scheduling fields, validity, payment terms, T&C.

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

## Known remaining areas to watch
- **Carcass pricing tab** in Settings — not yet verified as persisted through `gSaveAppSettings`
- **Drive saves in Google Sites embed** — token refresh via `prompt:''` is blocked in iframes; users must re-auth via banner ~hourly
- **First-time setup flow** — user needs to: sign in → Settings → Test connection → Create missing tabs → Save settings

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
