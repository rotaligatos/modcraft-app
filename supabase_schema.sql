-- ============================================================================
-- Modcraft — Supabase Schema (Phase 0)
-- ============================================================================
-- WHAT THIS IS
--   The complete database structure for Modcraft, translated from the Google
--   Sheets tabs into proper PostgreSQL tables. Paste this whole file into the
--   Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).
--
-- SAFE TO RUN
--   • It only CREATES things — it never drops or touches your live Google
--     Sheets/Drive. After running, you just have an empty database sitting
--     next to the still-running app. Nothing in index.html changes yet.
--   • It is idempotent: every statement uses IF NOT EXISTS / CREATE OR REPLACE,
--     so you can re-run the whole file safely if you tweak it.
--
-- WHAT IT SETS UP
--   1. All tables (one per Google Sheet tab — see SUPABASE_MIGRATION_PLAN.md §3)
--   2. Helpful indexes
--   3. auto-updating updated_at timestamps
--   4. Row-Level Security (RLS): ON for every table, with a PERMISSIVE starter
--      policy = "any logged-in user can read/write" (same trust model as the
--      shared Google Sheet today). We tighten by company/role in a later phase.
--   5. Storage buckets for files (quotations, logos)
--
-- AFTER RUNNING
--   • Turn on Google sign-in:  Authentication → Providers → Google
--   • Verify tables exist:      Table Editor (you'll see them all)
--   • Region reminder:          create the project in Singapore (closest to PH)
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. Extensions + shared helper
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto";   -- for gen_random_uuid()

-- Trigger function: keep an updated_at column fresh on every UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ============================================================================
-- 1. QUOTATIONS  (Google tab: "Quotations" — the index of all quotations)
--    Old sheet columns A:R. Lifecycle timestamps were cols N–Q; source order R.
-- ============================================================================
create table if not exists public.quotations (
  serial            text primary key,          -- e.g. 'QT-260601-4083'  (col A)
  created_at        timestamptz not null default now(),  -- full ISO datetime (col)
  client_name       text,
  client_id         text,                       -- links to clients.id (loose ref)
  status            text,                        -- Active / Locked / Approved / Sent / Superseded / ...
  stage             smallint default 1,          -- 1 = Initial, 2 = Final
  total             numeric(14,2),               -- grand total
  service_type      text,
  company           text,                        -- one of the 3 COMPANIES
  prepared_by       text,                        -- user email
  revised_from      text,                        -- prior serial if this is a revision
  base_serial       text,                        -- base serial without option suffix
  -- lifecycle timestamps (were sheet cols N–Q) -----------------------------
  initial_locked_at   timestamptz,
  initial_approved_at timestamptz,
  final_locked_at     timestamptz,
  final_approved_at   timestamptz,
  -- source order (was sheet col R) -----------------------------------------
  source_order      text,                        -- Wufoo order id this came from
  updated_at        timestamptz not null default now()
);

create index if not exists idx_quotations_company   on public.quotations (company);
create index if not exists idx_quotations_client     on public.quotations (client_id);
create index if not exists idx_quotations_status     on public.quotations (status);
create index if not exists idx_quotations_created    on public.quotations (created_at desc);

drop trigger if exists trg_quotations_updated on public.quotations;
create trigger trg_quotations_updated
  before update on public.quotations
  for each row execute function public.set_updated_at();


-- ============================================================================
-- 2. QUOTATION_STATES  (Google tab: "Quotation State")
--    THE BIG WIN: the whole editable state JSON — previously chunked across
--    10 columns (B–K, 45k chars each) — now lives in ONE jsonb column.
-- ============================================================================
create table if not exists public.quotation_states (
  serial      text primary key
              references public.quotations(serial) on delete cascade,
  state       jsonb not null default '{}'::jsonb,   -- the entire quotation state
  cost_report jsonb,                                -- _buildCostReportSnapshot() output
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_quotation_states_updated on public.quotation_states;
create trigger trg_quotation_states_updated
  before update on public.quotation_states
  for each row execute function public.set_updated_at();


-- ============================================================================
-- 3. CLIENTS  (Google tab: "Clients")
-- ============================================================================
create table if not exists public.clients (
  id            text primary key,              -- existing client id
  name          text,
  biz_name      text,
  contact       text,
  email         text,
  address       text,
  segment       text,                          -- e.g. 'General Contractors', 'Homeowners'
  client_type   text,                          -- 'B2B' | 'B2C'
  company       text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_clients_company on public.clients (company);
create index if not exists idx_clients_name     on public.clients (name);

drop trigger if exists trg_clients_updated on public.clients;
create trigger trg_clients_updated
  before update on public.clients
  for each row execute function public.set_updated_at();


-- ============================================================================
-- 4. USERS  (Google tab: "User Roles" — cols A:X)
--    Keyed on email (Google sign-in matches users by email).
--    feature_access = the 13 ACC_KEYS as JSON. PIN now hashed (cols W/X).
-- ============================================================================
create table if not exists public.users (
  email            text primary key,
  name             text,
  role             text,                        -- Admin/Director/Manager/Supervisor/Approver/Encoder/Staff/Viewer
  company          text,
  active           boolean default true,
  device_id        text,                        -- device binding (optional)
  feature_access   jsonb default '{}'::jsonb,   -- { Dashboard:true, KPI:false, ... }
  delegate_to      text,                        -- email of delegate (approval delegation)
  pin_hash         text,                        -- SHA-256(pin+salt)  (was sheet col W)
  pin_salt         text,                        -- per-user salt       (was sheet col X)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_users_company on public.users (company);
create index if not exists idx_users_role     on public.users (role);

drop trigger if exists trg_users_updated on public.users;
create trigger trg_users_updated
  before update on public.users
  for each row execute function public.set_updated_at();


-- ============================================================================
-- 5. SETTINGS  (Google tab: "Settings" — the CONFIG row)
--    Simple key → JSON store. 'CONFIG' holds CF + MOB_LOCATIONS + scheduling +
--    terms + ordersSla + approvalRouting + msgTemplates + carcassPrices + ...
--    (The per-user FOLLOWED_/DASHPREF_/APPREQ_ keys move to dedicated tables
--     below — they don't belong in this config blob.)
-- ============================================================================
create table if not exists public.settings (
  key         text primary key,                -- e.g. 'CONFIG'
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_settings_updated on public.settings;
create trigger trg_settings_updated
  before update on public.settings
  for each row execute function public.set_updated_at();


-- ============================================================================
-- 6. USER_PREFS  (was Settings keys: FOLLOWED_<email>, DASHPREF_<email>,
--    DASHALLOW_<email>) — one row per (email, pref_type).
-- ============================================================================
create table if not exists public.user_prefs (
  email       text not null,
  pref_type   text not null,                   -- 'FOLLOWED' | 'DASHPREF' | 'DASHALLOW'
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (email, pref_type)
);

drop trigger if exists trg_user_prefs_updated on public.user_prefs;
create trigger trg_user_prefs_updated
  before update on public.user_prefs
  for each row execute function public.set_updated_at();


-- ============================================================================
-- 7. APPROVAL_REQUESTS  (was Settings keys: APPREQ_<id>)
--    nonvat / discount / override / premium requests + their status.
-- ============================================================================
create table if not exists public.approval_requests (
  id            text primary key,              -- existing request id
  req_type      text,                          -- 'nonvat' | 'discount' | 'override' | 'premium'
  serial        text,                          -- quotation it relates to
  client_name   text,
  company       text,
  from_email    text,                          -- requester
  to_email      text,                          -- routed approver
  note          text,
  counter_disc  numeric,                        -- manager's counter-offer % (discount)
  payload       jsonb default '{}'::jsonb,      -- type-specific data (cfValues, reqDisc, ...)
  status        text default 'pending',         -- pending/approved/accepted/countered/rejected/cancelled
  actioned_by   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_appreq_status  on public.approval_requests (status);
create index if not exists idx_appreq_serial   on public.approval_requests (serial);
create index if not exists idx_appreq_to       on public.approval_requests (to_email);

drop trigger if exists trg_appreq_updated on public.approval_requests;
create trigger trg_appreq_updated
  before update on public.approval_requests
  for each row execute function public.set_updated_at();


-- ============================================================================
-- 8. ACTIVITY_LOG  (Google tab: "Activity log")
-- ============================================================================
create table if not exists public.activity_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  user_email  text,
  action      text,
  serial      text
);

create index if not exists idx_activity_at      on public.activity_log (at desc);
create index if not exists idx_activity_serial   on public.activity_log (serial);


-- ============================================================================
-- 9. PENDING_ORDERS  (Google tab: "Pending Orders" — Wufoo submissions)
--    27 columns from the Wufoo webhook. _raw keeps the original row for
--    diagnostics. Status flows Pending → In Progress → Done.
-- ============================================================================
create table if not exists public.pending_orders (
  id                   text primary key,        -- Wufoo entry id (col A)
  received_at          timestamptz,             -- PHT, from DateCreated (col B)
  client_name          text,
  company_name         text,
  contact_number       text,
  customer_email       text,
  salesman_email       text,
  request_type         text,                    -- New / Revision
  type_of_service      text,
  floor                text,                    -- 1F / 2F
  board_substrate      text,
  haspe_flow           text,
  edging               text,
  boring               text,
  cutting              text,
  lipping              text,
  hg_included          text,
  hg_groove            text,
  hg_installation      text,
  hg_by                text,
  agent_name           text,
  attachment_1         text,                    -- Drive URL
  attachment_2         text,
  status               text default 'Pending',
  quotation_serial     text,                    -- set when exported to a quotation
  sent_at              timestamptz,
  source_company       text,
  raw                  jsonb,                   -- original sheet row (diagnostics)
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_orders_status   on public.pending_orders (status);
create index if not exists idx_orders_received  on public.pending_orders (received_at desc);

drop trigger if exists trg_orders_updated on public.pending_orders;
create trigger trg_orders_updated
  before update on public.pending_orders
  for each row execute function public.set_updated_at();


-- ============================================================================
-- 10. MESSAGES  (Google tab: "Messages" — user-to-user messaging)
-- ============================================================================
create table if not exists public.messages (
  id          text primary key,                -- existing message id
  created_at  timestamptz not null default now(),
  from_email  text,
  from_name   text,
  to_email    text,
  to_name     text,
  message     text,
  priority    text default 'normal',           -- 'normal' | 'urgent'
  status      text default 'unread',           -- 'unread' | 'read'
  read_at     timestamptz,
  context     jsonb default '{}'::jsonb
);

create index if not exists idx_messages_to     on public.messages (to_email);
create index if not exists idx_messages_from    on public.messages (from_email);
create index if not exists idx_messages_created  on public.messages (created_at desc);


-- ============================================================================
-- 11. PRICE DATABASE  (separate Price DB Sheet: Services/Materials/Hardware/
--     CabinetTemplates). Kept as 4 tables.
-- ============================================================================
create table if not exists public.price_services (
  id           bigint generated always as identity primary key,
  name         text,
  unit         text,
  price        numeric(14,4),
  -- capacity fields (SERVICE_CAPACITY) ------------------------------------
  svc_type     text,                            -- production / installation / outsourced
  teams        numeric,
  shifts_per_day numeric,
  output_per_shift numeric,
  cost_data    jsonb default '{}'::jsonb,        -- Phase-2 cost breakdown (overhead/manpower/consumables)
  updated_at   timestamptz not null default now()
);

create table if not exists public.price_materials (
  id           bigint generated always as identity primary key,
  name         text,
  unit         text,
  price        numeric(14,4),
  category     text,
  updated_at   timestamptz not null default now()
);

create table if not exists public.price_hardware (
  id           bigint generated always as identity primary key,
  name         text,
  unit         text,
  price        numeric(14,4),
  category     text,
  updated_at   timestamptz not null default now()
);

create table if not exists public.cabinet_templates (
  id           bigint generated always as identity primary key,
  cabinet      text,                            -- cabinet type name
  category     text,                            -- materials / hardware / services / outsource
  name         text,
  unit         text,
  qty          numeric,
  price        numeric(14,4),
  meta         jsonb default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);

create index if not exists idx_cabtpl_cabinet on public.cabinet_templates (cabinet);


-- ============================================================================
-- 12. LOGISTICS DATABASE  (separate Logistics DB Sheet: Materials/Trucks)
-- ============================================================================
create table if not exists public.logistics_materials (
  id            bigint generated always as identity primary key,
  name          text,
  board_size    text,                           -- '4x8' | '6x8' | 'custom'
  length_mm     numeric,
  width_mm      numeric,
  thickness_mm  numeric,
  weight_kg     numeric,
  cbm           numeric,                         -- auto-computed sheet volume
  notes         text,
  updated_at    timestamptz not null default now()
);

create table if not exists public.logistics_trucks (
  id            bigint generated always as identity primary key,
  type          text,
  max_weight_kg numeric,
  max_cbm       numeric,
  body_type     text,                           -- open / closed
  notes         text,
  updated_at    timestamptz not null default now()
);


-- ============================================================================
-- 12c. MAPPING_AUDIT  (new — not a Google Sheets tab)
--     Append-only trail of every Designers Support jargon-mapping learn event
--     (materials/hardware catalog resolution, faces/EBT/color/texture/material
--     corrections, service corrections). Modcraft's jargonMap itself stays
--     localStorage/per-browser (unchanged) — this table exists purely so
--     Admins can trace which mappings were learned, by whom, and whether the
--     source was genuinely ambiguous (was_flagged) when it was learned.
-- ============================================================================
create table if not exists public.mapping_audit (
  id           bigint generated always as identity primary key,
  saved_at     timestamptz not null default now(),
  saved_by     text,
  category     text,                          -- materials | hardware | faces | ebt | color | texture | material | services
  term         text,                          -- the AI's raw/ambiguous extracted text
  db_item      text,                          -- resolved catalog item / corrected value
  unit         text,
  was_flagged  boolean default false          -- true if needsReview was set when this was learned
);

create index if not exists idx_mapping_audit_saved_at on public.mapping_audit (saved_at desc);
create index if not exists idx_mapping_audit_category on public.mapping_audit (category);


-- ============================================================================
-- 12b. BOARD_LAYOUTS  (new — not a Google Sheets tab)
--     One row per material group per quotation, from the Designers Support
--     guillotine cutting simulation (prodComputeBom() in index.html). Feeds
--     the future Production Operation app; Modcraft itself only writes here
--     (at Stage 2 lock / Client Approved), it never reads this table back.
-- ============================================================================
create table if not exists public.board_layouts (
  id              bigint generated always as identity primary key,
  serial          text not null references public.quotations(serial) on delete cascade,
  material        text,
  color           text,
  texture         text,
  thickness_mm    numeric,
  board_size      text,                          -- e.g. '1220×2440mm'
  boards_needed   integer,
  utilization_pct numeric,                        -- guillotine-simulation packing efficiency
  oversized_count integer,                        -- pieces bigger than the board in either dimension
  areas           text,                           -- which quotation areas use this material group
  analyzed_at     timestamptz,                    -- when the Designers Support analysis ran
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_board_layouts_serial   on public.board_layouts (serial);
create index if not exists idx_board_layouts_material  on public.board_layouts (material);

drop trigger if exists trg_board_layouts_updated on public.board_layouts;
create trigger trg_board_layouts_updated
  before update on public.board_layouts
  for each row execute function public.set_updated_at();


-- ============================================================================
-- 12c. DRAWING_ANALYSES  (new — not a Google Sheets tab)
--     One row per quotation, pointing at the FULL Designers Support analysis
--     (raw uploaded file + complete AI output) saved to Storage/Drive at
--     quotation lock/approve time — see _saveDrawingAnalysisToDrive() in
--     index.html. Unlike board_layouts (write-only, for a future app), this
--     table IS read back by Modcraft itself: the Designers Support "Saved
--     Analyses" tab lists these rows so a past analysis can be reopened for
--     review/edit or reprinted. Deliberately lightweight (metadata + storage
--     paths only, not the analysis JSON itself) so listing/browsing stays
--     fast no matter how many analyses accumulate — the actual files are
--     fetched on demand only when a row is opened.
-- ============================================================================
create table if not exists public.drawing_analyses (
  id                bigint generated always as identity primary key,
  serial            text not null references public.quotations(serial) on delete cascade,
  file_name         text,
  file_type         text,                 -- 'elevation-drawing' | 'shop-drawing' | 'technical-drawing' | 'cutting-list'
  component_count   integer,
  analyzed_at       timestamptz,          -- when the Designers Support analysis ran
  saved_by          text,                 -- email of the user who locked/approved the quotation
  raw_file_path     text,                 -- Storage/Drive path to the original uploaded file
  output_file_path  text,                 -- Storage/Drive path to the full analysis output JSON
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_drawing_analyses_serial on public.drawing_analyses (serial);

drop trigger if exists trg_drawing_analyses_updated on public.drawing_analyses;
create trigger trg_drawing_analyses_updated
  before update on public.drawing_analyses
  for each row execute function public.set_updated_at();


-- ============================================================================
-- 13. ROW-LEVEL SECURITY  (RLS)
--     Turn RLS ON for every table, then add ONE permissive starter policy per
--     table: "any authenticated (logged-in) user can do everything."
--     This mirrors today's shared-sheet trust model. We tighten by
--     company/role in a later phase — at that point we just replace these
--     policies, no table changes needed.
-- ============================================================================
do $$
declare
  t text;
  tbls text[] := array[
    'quotations','quotation_states','clients','users','settings',
    'user_prefs','approval_requests','activity_log','pending_orders',
    'messages','price_services','price_materials','price_hardware',
    'cabinet_templates','logistics_materials','logistics_trucks','board_layouts',
    'mapping_audit','drawing_analyses'
  ];
begin
  foreach t in array tbls loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "authenticated full access" on public.%I;', t);
    execute format(
      'create policy "authenticated full access" on public.%I '
      || 'for all to authenticated using (true) with check (true);', t);
  end loop;
end$$;


-- ============================================================================
-- 14. STORAGE BUCKETS  (replaces Google Drive)
--     'quotations' — per-quotation PDFs, state.json backups, cost-detail.json
--     'logos'      — per-company logos
--     Both private; access governed by the storage policies below.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('quotations', 'quotations', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('logos', 'logos', false)
on conflict (id) do nothing;

-- Permissive starter policies on storage objects: any logged-in user can
-- read/write files in these two buckets (same trust model as the tables).
drop policy if exists "auth read modcraft files"   on storage.objects;
create policy "auth read modcraft files" on storage.objects
  for select to authenticated
  using (bucket_id in ('quotations','logos'));

drop policy if exists "auth write modcraft files"  on storage.objects;
create policy "auth write modcraft files" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('quotations','logos'));

drop policy if exists "auth update modcraft files" on storage.objects;
create policy "auth update modcraft files" on storage.objects
  for update to authenticated
  using (bucket_id in ('quotations','logos'))
  with check (bucket_id in ('quotations','logos'));

drop policy if exists "auth delete modcraft files" on storage.objects;
create policy "auth delete modcraft files" on storage.objects
  for delete to authenticated
  using (bucket_id in ('quotations','logos'));


-- ============================================================================
-- DONE.
-- Next (still no app changes): Authentication → Providers → Google → enable,
-- then add your app's URL to the allowed redirect URLs. After that we start
-- Phase 1 (wire index.html to Supabase behind the USE_SUPABASE flag,
-- quotations + state first).
-- ============================================================================
