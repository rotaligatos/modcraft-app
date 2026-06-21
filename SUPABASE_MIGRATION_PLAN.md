# Modcraft — Supabase + Synology Migration Plan

> **Status:** PLANNING. Nothing here is built yet. We will do this **slowly and incrementally**, one small piece at a time, so the live app on Google Sheets keeps working the whole way.
>
> **Audience note:** written for someone new to Supabase. Plain-language explanations + a glossary at the bottom.

---

## 1. What we're doing (in plain terms)

Today, Modcraft stores all its data in **Google Sheets** and files in **Google Drive**. That works, but it has limits: we chunk big data across 10 sheet columns (45,000 characters each), we hit Google API rate limits, and there's no real database under it.

We want to move the data to a **real database**. The plan is to use **two things together**:

- **Supabase (cloud)** = the *live* database the app talks to every day. Think of it as "Google Sheets, but a proper database" — plus built-in login, file storage, and live updates. The app still has **no server of its own**; the browser talks to Supabase directly, exactly like it talks to Google Sheets now.
- **Synology NAS (office)** = a *backup copy* of everything, refreshed every night and kept physically in your office. You own it. If anything ever goes wrong in the cloud, you have a full local copy.

**One source of truth (Supabase) + one backup you own (Synology).** We do **not** run two live databases that sync with each other — that's complex and error-prone. We keep it simple.

---

## 2. Target architecture

```
   Browser (index.html on GitHub Pages / Google Site)
        │  supabase-js  (HTTPS — same idea as today's API calls)
        ▼
   ┌─────────────────────────────────────────────┐
   │  SUPABASE CLOUD (Singapore region) — PRIMARY │
   │   • Postgres database (all data)             │
   │   • Auth (Google sign-in — unchanged for users)
   │   • Storage (quotation PDFs / state / logos) │
   │   • Realtime (notifications, approvals live) │
   └─────────────────────────────────────────────┘
        ▲   nightly: pg_dump + storage mirror (NAS pulls a copy)
        │
   ┌─────────────────────────────────────────────┐
   │  SYNOLOGY NAS (office) — BACKUP NODE          │
   │   • /backups/modcraft_YYYY-MM-DD.sql          │
   │   • mirror of the storage files               │
   │   • retention (keep N days) + Hyper Backup    │
   └─────────────────────────────────────────────┘
```

---

## 3. How the data maps (Google Sheets → Supabase tables)

Each Google Sheets tab becomes a proper database table. The biggest immediate win: **the "Quotation State" chunking hack disappears** — the whole state fits in one column.

| Today (Google Sheet/tab) | Becomes (Supabase table) | Notes |
|---|---|---|
| `Quotations` | `quotations` | serial (id), client, status, total, stage, lifecycle timestamps, prepared_by, company, source_order |
| `Quotation State` | `quotation_states` | serial (id) + **`state` (one JSON column)** — no more 10-column chunking |
| `Clients` | `clients` | name, biz name, contact, email, segment, type, company |
| `User Roles` | `users` | role, company, active, device_id, feature access (JSON), delegation, **pin_hash / pin_salt** |
| `Settings` (CONFIG + per-user keys) | `settings` (config JSON) + `approval_requests` + `user_prefs` | the `APPREQ_` / `DASHPREF_` / `FOLLOWED_` keys become real tables |
| `Activity log` | `activity_log` | timestamp, user, action, serial |
| `Pending Orders` | `pending_orders` | Wufoo order fields |
| `Messages` | `messages` | user-to-user messaging |
| Price DB sheet (Services/Materials/Hardware/CabinetTemplates) | `price_services`, `price_materials`, `price_hardware`, `cabinet_templates` | |
| Logistics DB sheet (Materials/Trucks) | `logistics_materials`, `logistics_trucks` | |

**Files** (quotation PDFs, state backups, company logos) move from Google Drive → **Supabase Storage** buckets (`quotations`, `logos`).

---

## 4. The phases (we go slowly — each phase is reviewable before the next)

### Phase 0 — Set up Supabase + the schema  *(~1 day)*
1. Create a Supabase account + project, **region = Singapore** (closest to the Philippines = fastest).
2. Run the `CREATE TABLE` SQL (we'll write this together — you just paste it into Supabase's SQL editor).
3. Turn on **Google login** (your users sign in exactly the same way).
4. Turn on **RLS** (Row-Level Security). Start permissive (any logged-in user can read/write — same as today's shared sheet), then tighten by company/role later. *This finally gives real, server-enforced access control instead of UI-only.*
5. Create the **Storage buckets** for files.

> At the end of Phase 0, nothing in the live app has changed yet — we've just built the empty database next to it.

### Phase 1 — Switch the app's data layer  *(the main work — done incrementally)*
- Add `supabase-js` (one `<script>` tag; the app stays a single HTML file, no build step).
- Replace the Google Sheets/Drive helper functions **one domain at a time**, behind an on/off switch (`USE_SUPABASE`). Order: quotations + state first → clients → settings → price/logistics.
- **Safety:** during cutover we can *dual-write* (save to both Sheets and Supabase) so nothing is at risk; we only flip fully once it's proven.
- Example wins: `saveQuotationJson` becomes a single save (no chunking); `loadQuotationJson` a single read.

### Phase 2 — Move the existing data  *(~1 day)*
- A one-time script reads every Google Sheet tab and inserts the rows into Supabase; Drive files copy into Storage. We run it once, verify counts match, done.

### Phase 3 — Synology backup node  *(~half day)*
- On the NAS (DSM **Container Manager / Docker** or **Task Scheduler**), a nightly job:
  - `pg_dump "<Supabase DB connection string>" > /backups/modcraft_YYYY-MM-DD.sql`
  - mirror the Storage files to the NAS (e.g. `rclone`)
  - keep N days of backups; optionally Hyper Backup off-site
- Result: a full on-premise copy you own, refreshed nightly.

---

## 5. "What if I change my Supabase account later?"  (portability — IMPORTANT)

**Nothing is trapped. You are never locked in.** Supabase is open-source Postgres + storage, and all your data is exportable any time.

To move to a different Supabase account/project later:
1. **Export** your data — you already have it: the nightly Synology `pg_dump` (a plain `.sql` file) and the mirrored storage files *are* your portable copy. (You can also export on demand from Supabase.)
2. **Create** the new project on the new account and **restore** the `.sql` dump + re-upload the storage files.
3. **Update two values** in `index.html`: the project **URL** and the public **anon key**. Re-add the Google sign-in redirect URL.
4. Done — the app works against the new account.

Notes:
- **Login users:** because we use Google sign-in, people just sign in again on the new project; we match them by email. No password migration.
- **No proprietary format:** it's standard PostgreSQL. The same dump could even be restored into a self-hosted Postgres on your Synology if you ever want to go fully on-premise.
- This is exactly why the Synology backup matters: it makes you **account-independent** and **vendor-independent**.

---

## 6. Cost
- **Supabase:** the **free tier** almost certainly covers this app for a long time (plenty of database + storage + users). If you outgrow it, **Pro is ~$25/month**. No surprise charges on free.
- **Synology:** your existing/planned hardware (one-time).

---

## 7. How we'll proceed (slowly)
We tackle one phase at a time, you review before we move on:
1. **First:** write the Supabase schema SQL together (Phase 0) so you can paste it in and *see* the structure — no app changes yet.
2. **Then:** a small Phase-1 "spike" — migrate just **quotations + state** behind the `USE_SUPABASE` flag, so you see it working end-to-end with zero risk to the live app.
3. **Then:** decide whether to continue domain by domain.

Nothing here changes the live app until you're comfortable. The Google Sheets version keeps running the entire time.

---

## Glossary (plain language)
- **Supabase** — a cloud service that gives you a database + login + file storage, ready to use, no server to run.
- **Postgres / PostgreSQL** — the actual database engine inside Supabase. Industry-standard, open-source.
- **Table** — like one Google Sheet tab, but structured (columns with types). E.g. a `clients` table.
- **Row** — one record (one client, one quotation).
- **JSON column** — a single column that can hold a whole structured blob (this is how the entire quotation "state" fits in one cell — no chunking).
- **RLS (Row-Level Security)** — database rules for who can see/edit which rows (e.g. only your company's data). Server-enforced, not just hidden in the UI.
- **Storage bucket** — a folder in Supabase for files (PDFs, logos), replacing Google Drive.
- **anon key** — a public key the browser uses to talk to Supabase. Safe to put in the app; RLS is what actually protects the data.
- **pg_dump** — the command that exports the whole database to a single `.sql` file (our backup).
- **Realtime** — Supabase can push live updates to the app (e.g. a new approval appears instantly instead of waiting for a 60-second poll).
- **Spike** — a small, throwaway-able first try of one piece, to prove it works before doing the rest.
