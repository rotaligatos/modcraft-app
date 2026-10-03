-- ============================================================================
-- 2026-10-04 — Command Center › Website: site switches + client account control.
-- Run AFTER supabase_lock_staff_tables.sql (uses app_is_internal()).
--
-- 1. website_settings   one row of switches the MSSI website obeys. Read by anyone (the
--                       site needs it signed out); changed only by Command Center Owners/Managers.
--                       ENFORCED IN THE DATABASE, not just the page: a closed form refuses the
--                       insert even if someone calls the API directly. Staff are exempt, so you
--                       can keep testing while the site is closed to the public.
--                       Wufoo and anything that is not a website order is never affected.
-- 2. website_client_flags   staff-side flags per client email: suspended, test account, notes.
--                       Separate table on purpose — client_accounts is read with select('*') by the
--                       portal, so new columns there would either break it or show staff notes.
-- 3. pending_orders.is_test  set by trigger from the flags (a client cannot set it).
-- 4. Command Center functions: cc_website_clients, cc_website_client_set, cc_website_client_orders.
-- 5. Portal helper: client_my_status().
-- Every change is written to user_access_log as app WEBSITE.
-- Additive and reversible — see ROLLBACK at the bottom.
-- ============================================================================

-- 1. Switches ----------------------------------------------------------------
create table if not exists public.website_settings (
  id                    smallint primary key default 1 check (id = 1),
  accounts_open         boolean not null default true,
  cutting_list_open     boolean not null default true,
  service_requests_open boolean not null default true,
  site_visits_open      boolean not null default true,
  maintenance           boolean not null default false,
  public_message        text,
  updated_at            timestamptz default now(),
  updated_by            text
);
insert into public.website_settings (id) values (1) on conflict (id) do nothing;
alter table public.website_settings enable row level security;
revoke all on public.website_settings from anon, authenticated;
grant select on public.website_settings to anon, authenticated;
grant update (accounts_open, cutting_list_open, service_requests_open, site_visits_open, maintenance, public_message)
  on public.website_settings to authenticated;
drop policy if exists "anyone reads the switches" on public.website_settings;
create policy "anyone reads the switches" on public.website_settings for select to anon, authenticated using (true);
drop policy if exists "command center changes the switches" on public.website_settings;
create policy "command center changes the switches" on public.website_settings for update to authenticated
  using ((select public.cc_can_manage())) with check ((select public.cc_can_manage()));

-- 2. Client flags ------------------------------------------------------------
create table if not exists public.website_client_flags (
  email      text primary key check (email = lower(btrim(email)) and email <> ''),
  status     text not null default 'active' check (status in ('active', 'suspended')),
  is_test    boolean not null default false,
  notes      text,
  updated_at timestamptz default now(),
  updated_by text
);
alter table public.website_client_flags enable row level security;
revoke all on public.website_client_flags from anon, authenticated;
grant select, insert, update on public.website_client_flags to authenticated;
drop policy if exists "command center manages client flags" on public.website_client_flags;
create policy "command center manages client flags" on public.website_client_flags for all to authenticated
  using ((select public.cc_can_manage())) with check ((select public.cc_can_manage()));

-- stamp + log (own log function: the shared user_access_log_row maps unknown tables to KEYSTONE)
drop trigger if exists website_settings_stamp on public.website_settings;
create trigger website_settings_stamp before update on public.website_settings
  for each row execute function public.user_access_audit();
drop trigger if exists website_client_flags_stamp on public.website_client_flags;
create trigger website_client_flags_stamp before insert or update on public.website_client_flags
  for each row execute function public.user_access_audit();

create or replace function public.website_log_row()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'updated_at' - 'updated_by') = (to_jsonb(old) - 'updated_at' - 'updated_by') then
    return null;
  end if;
  insert into public.user_access_log (app, email, action, before, after, changed_by)
  values ('WEBSITE',
          -- read email through jsonb: website_settings has no email column, and NEW.email would fail there
          coalesce(to_jsonb(new) ->> 'email', to_jsonb(old) ->> 'email', 'site switches'),
          lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) - 'updated_at' - 'updated_by' end,
          case when tg_op <> 'DELETE' then to_jsonb(new) - 'updated_at' - 'updated_by' end,
          nullif(public.app_current_email(), ''));
  return null;
end $$;
drop trigger if exists website_settings_log on public.website_settings;
create trigger website_settings_log after update on public.website_settings
  for each row execute function public.website_log_row();
drop trigger if exists website_client_flags_log on public.website_client_flags;
create trigger website_client_flags_log after insert or update or delete on public.website_client_flags
  for each row execute function public.website_log_row();

-- helpers (definer: they read tables the caller cannot)
create or replace function public.website_client_suspended(p_email text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.website_client_flags
                  where email = lower(btrim(coalesce(p_email, ''))) and status = 'suspended')
$$;
create or replace function public.website_is_test(p_email text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.website_client_flags
                  where email = lower(btrim(coalesce(p_email, ''))) and is_test)
$$;
-- true for anything that is not a website form (Wufoo etc. are never blocked)
create or replace function public.website_accepts(p_kind text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when coalesce(p_kind, '') not in ('Cutting List', 'Service Request', 'Site Visit') then true
    else coalesce((select not s.maintenance and case p_kind
                                 when 'Cutting List'    then s.cutting_list_open
                                 when 'Service Request' then s.service_requests_open
                                 else s.site_visits_open end
                     from public.website_settings s where s.id = 1), true)
  end
$$;
revoke all on function public.website_client_suspended(text) from public;
revoke all on function public.website_is_test(text) from public;
revoke all on function public.website_accepts(text) from public;
grant execute on function public.website_accepts(text) to anon, authenticated;
grant execute on function public.website_client_suspended(text) to authenticated;

-- 3. Enforcement -------------------------------------------------------------
drop policy if exists "website switches (signed out)" on public.pending_orders;
create policy "website switches (signed out)" on public.pending_orders as restrictive for insert to anon
  with check (public.website_accepts(order_kind));
drop policy if exists "website switches and suspension (signed in)" on public.pending_orders;
create policy "website switches and suspension (signed in)" on public.pending_orders as restrictive for insert to authenticated
  with check ((select public.app_is_internal())
              or (public.website_accepts(order_kind)
                  and not public.website_client_suspended((select public.app_current_email()))));

-- The portal saves the account with upsert (INSERT … ON CONFLICT DO UPDATE), and Postgres checks INSERT
-- policies even when the row already exists — so an existing client must pass, or closing sign-ups would
-- also stop existing clients editing their profile.
create or replace function public.client_account_exists(p_email text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.client_accounts where email = lower(btrim(coalesce(p_email, ''))))
$$;
revoke all on function public.client_account_exists(text) from public;
grant execute on function public.client_account_exists(text) to authenticated;
drop policy if exists "new accounts only while open" on public.client_accounts;
create policy "new accounts only while open" on public.client_accounts as restrictive for insert to authenticated
  with check ((select public.app_is_internal())
              or public.client_account_exists(email)
              or coalesce((select accounts_open and not maintenance from public.website_settings where id = 1), true));
drop policy if exists "suspended clients cannot edit" on public.client_accounts;
create policy "suspended clients cannot edit" on public.client_accounts as restrictive for update to authenticated
  using ((select public.app_is_internal()) or not public.website_client_suspended(email))
  with check ((select public.app_is_internal()) or not public.website_client_suspended(email));

-- 4. Test orders are marked by the database, never by the client -------------
alter table public.pending_orders add column if not exists is_test boolean not null default false;
create or replace function public.pending_orders_mark_test()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.is_test := public.website_is_test(new.customer_email);
  return new;
end $$;
drop trigger if exists pending_orders_mark_test on public.pending_orders;
create trigger pending_orders_mark_test before insert on public.pending_orders
  for each row execute function public.pending_orders_mark_test();

-- 5. Command Center functions -----------------------------------------------
create or replace function public.cc_website_clients()
returns table (email text, full_name text, company_name text, client_company text, mobile text, segment text,
               lead_source text, created_at timestamptz, last_sign_in_at timestamptz, is_staff boolean,
               status text, is_test boolean, notes text, flags_updated_at timestamptz, flags_updated_by text,
               orders bigint, last_order_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.cc_can_manage() then raise exception 'Only Command Center Owners and Managers can see website clients.'; end if;
  return query
  select a.email, a.full_name, a.company_name, co.name, a.mobile, a.segment, a.lead_source, a.created_at,
         (select max(u.last_sign_in_at) from auth.users u where lower(btrim(u.email)) = a.email),
         (exists (select 1 from public.users x where lower(btrim(x.email)) = a.email and x.active)
          or exists (select 1 from public.keystone_users x where lower(btrim(x.email)) = a.email and x.active)
          or exists (select 1 from public.pmes_users x where lower(btrim(x.email)) = a.email and x.active)
          or exists (select 1 from public.cc_access x where lower(btrim(x.email)) = a.email and x.active)),
         coalesce(f.status, 'active'), coalesce(f.is_test, false), f.notes, f.updated_at, f.updated_by,
         (select count(*) from public.pending_orders o where lower(btrim(o.customer_email)) = a.email),
         (select max(o.received_at) from public.pending_orders o where lower(btrim(o.customer_email)) = a.email)
    from public.client_accounts a
    left join public.client_companies co on co.id = a.company_id
    left join public.website_client_flags f on f.email = a.email
   order by a.created_at desc;
end $$;

create or replace function public.cc_website_client_set(p_email text, p_status text, p_is_test boolean, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare v text := lower(btrim(coalesce(p_email, '')));
begin
  if not public.cc_can_manage() then raise exception 'Only Command Center Owners and Managers can change website clients.'; end if;
  if v = '' then raise exception 'Email is required.'; end if;
  if p_status not in ('active', 'suspended') then raise exception 'Status must be active or suspended.'; end if;
  insert into public.website_client_flags (email, status, is_test, notes)
  values (v, p_status, coalesce(p_is_test, false), nullif(btrim(coalesce(p_notes, '')), ''))
  on conflict (email) do update set status = excluded.status, is_test = excluded.is_test, notes = excluded.notes;
end $$;

-- What this client sees under My Orders: their own orders plus their invited company's.
create or replace function public.cc_website_client_orders(p_email text)
returns table (id text, received_at timestamptz, order_kind text, status text, project_name text,
               quotation_serial text, customer_email text, is_mine boolean, is_test boolean, files int, cutlist_totals jsonb)
language plpgsql stable security definer set search_path = public as $$
declare v text := lower(btrim(coalesce(p_email, ''))); co text[];
begin
  if not public.cc_can_manage() then raise exception 'Only Command Center Owners and Managers can view a client''s orders.'; end if;
  select coalesce(array_agg(b.email), array[]::text[]) into co
    from public.client_accounts a join public.client_accounts b on b.company_id = a.company_id
   where a.email = v and a.company_id is not null;
  return query
  select o.id, o.received_at, o.order_kind, o.status, o.project_name, o.quotation_serial, o.customer_email,
         lower(btrim(o.customer_email)) = v, o.is_test,
         coalesce(jsonb_array_length(case when jsonb_typeof(o.attachments) = 'array' then o.attachments end), 0),
         c.totals
    from public.pending_orders o
    left join public.order_cutting_lists c on c.order_id = o.id
   where coalesce(btrim(o.customer_email), '') <> ''
     and (lower(btrim(o.customer_email)) = v or lower(btrim(o.customer_email)) = any (co))
   order by o.received_at desc;
end $$;

-- 6. Portal helper -----------------------------------------------------------
create or replace function public.client_my_status()
returns text language sql stable security definer set search_path = public as $$
  select case when public.website_client_suspended(public.app_current_email()) then 'suspended' else 'active' end
$$;

revoke all on function public.cc_website_clients() from public;
revoke all on function public.cc_website_client_set(text, text, boolean, text) from public;
revoke all on function public.cc_website_client_orders(text) from public;
revoke all on function public.client_my_status() from public;
grant execute on function public.cc_website_clients() to authenticated;
grant execute on function public.cc_website_client_set(text, text, boolean, text) to authenticated;
grant execute on function public.cc_website_client_orders(text) to authenticated;
grant execute on function public.client_my_status() to authenticated;

-- ROLLBACK (if ever needed):
--   drop policy "website switches (signed out)" on public.pending_orders;
--   drop policy "website switches and suspension (signed in)" on public.pending_orders;
--   drop policy "new accounts only while open" on public.client_accounts;
--   drop policy "suspended clients cannot edit" on public.client_accounts;
--   drop trigger pending_orders_mark_test on public.pending_orders;   -- is_test column may stay
--   drop function public.cc_website_clients(), public.cc_website_client_set(text,text,boolean,text),
--                 public.cc_website_client_orders(text), public.client_my_status(),
--                 public.pending_orders_mark_test(), public.website_accepts(text),
--                 public.website_is_test(text), public.website_client_suspended(text),
--                 public.client_account_exists(text);
--   drop table public.website_client_flags, public.website_settings;   -- then drop public.website_log_row()
