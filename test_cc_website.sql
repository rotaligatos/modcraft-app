-- TEST for supabase_cc_website.sql — CHANGES NOTHING.
-- Paste the whole file into Supabase > SQL editor > Run (choose "Run without RLS" if asked: the
-- only tables it creates are temporary or are part of the fix being tested).
-- It applies the fix, runs 20 checks, then deliberately FAILS with the results — which undoes everything.
-- PASS = every line says PASS.

begin;
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

create or replace function pg_temp.as_(p_role text, p_email text, p_sql text) returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims',
    case when p_email is null then '{"role":"anon"}'
         else json_build_object('email',p_email,'role','authenticated','sub','00000000-0000-0000-0000-0000000000bb')::text end, true);
  execute 'set local role '||p_role;
  begin
    if p_sql ~* '^\s*(insert|update|delete)' and p_sql !~* 'returning' then execute p_sql; else execute p_sql into v; end if;
    execute 'reset role';
    return coalesce(v,'ok');
  exception when others then
    execute 'reset role';
    return 'REFUSED';
  end;
end $f$;
create temp table res(n serial, test text, got text, want text);
create or replace function pg_temp.chk(t text, got text, want text) returns void language sql as $f$
  insert into res(test,got,want) values (t,got,want) $f$;
create or replace function pg_temp.ord(id text, kind text, email text) returns text language sql as $f$
  select format('insert into public.pending_orders(id,received_at,order_kind,status,source_company,request_type,client_name,customer_email) values (%L,now(),%L,''Pending'',''Module Systems and Services, Inc.'',''New'',''QA'',%L)', id, kind, email) $f$;

insert into public.client_accounts(email, full_name) values ('qa.client@example.com','QA Client'), ('qa.client2@example.com','QA Two');

select pg_temp.chk('01 anyone can read the switches', pg_temp.as_('anon',null,'select count(*)::text from public.website_settings'), '1');
select pg_temp.chk('02 signed-out cutting list while open', pg_temp.as_('anon',null,pg_temp.ord('QA-T2','Cutting List','')), 'ok');
select pg_temp.chk('03 Command Center closes cutting list', pg_temp.as_('authenticated','rommel.taligatos@worldclasslaminate.com.ph','with u as (update public.website_settings set cutting_list_open=false where id=1 returning 1) select count(*)::text from u'), '1');
select pg_temp.chk('04 outsider cannot change switches', pg_temp.as_('authenticated','qa.outsider@example.com','with u as (update public.website_settings set maintenance=true where id=1 returning 1) select count(*)::text from u'), '0');
select pg_temp.chk('05 signed-out cutting list while CLOSED', pg_temp.as_('anon',null,pg_temp.ord('QA-T5','Cutting List','')), 'REFUSED');
select pg_temp.chk('06 service request still open', pg_temp.as_('anon',null,pg_temp.ord('QA-T6','Service Request','')), 'ok');
select pg_temp.chk('07 Wufoo never blocked', pg_temp.as_('anon',null,pg_temp.ord('QA-T7','Wufoo','')), 'ok');
select pg_temp.chk('08 staff can still test while closed', pg_temp.as_('authenticated','rommel.taligatos@worldclasslaminate.com.ph',pg_temp.ord('QA-T8','Cutting List','rommel.taligatos@worldclasslaminate.com.ph')), 'ok');
select pg_temp.chk('09 signed-in client blocked while closed', pg_temp.as_('authenticated','qa.client@example.com',pg_temp.ord('QA-T9','Cutting List','qa.client@example.com')), 'REFUSED');
select pg_temp.chk('10 Command Center reopens cutting list', pg_temp.as_('authenticated','rommel.taligatos@worldclasslaminate.com.ph','with u as (update public.website_settings set cutting_list_open=true where id=1 returning 1) select count(*)::text from u'), '1');
select pg_temp.chk('10b Command Center suspends a client', pg_temp.as_('authenticated','rommel.taligatos@worldclasslaminate.com.ph','select 1::text from (select public.cc_website_client_set(''qa.client@example.com'',''suspended'',false,''QA note'')) x'), '1');
select pg_temp.chk('11 outsider cannot suspend anyone', pg_temp.as_('authenticated','qa.outsider@example.com','select 1::text from (select public.cc_website_client_set(''qa.client2@example.com'',''suspended'',false,null)) x'), 'REFUSED');
select pg_temp.chk('12 suspended client cannot order', pg_temp.as_('authenticated','qa.client@example.com',pg_temp.ord('QA-T12','Service Request','qa.client@example.com')), 'REFUSED');
select pg_temp.chk('13 suspended client cannot edit profile', pg_temp.as_('authenticated','qa.client@example.com','with u as (update public.client_accounts set full_name=''X'' where email=''qa.client@example.com'' returning 1) select count(*)::text from u'), '0');
select pg_temp.chk('14 portal sees suspended status', pg_temp.as_('authenticated','qa.client@example.com','select public.client_my_status()'), 'suspended');
select pg_temp.chk('15 mark client2 as test account', pg_temp.as_('authenticated','rommel.taligatos@worldclasslaminate.com.ph','select 1::text from (select public.cc_website_client_set(''qa.client2@example.com'',''active'',true,null)) x'), '1');
select pg_temp.chk('16 test client order filed', pg_temp.as_('authenticated','qa.client2@example.com',pg_temp.ord('QA-T16','Cutting List','qa.client2@example.com')), 'ok');
select pg_temp.chk('17 order marked test by database', (select is_test::text from public.pending_orders where id='QA-T16'), 'true');
select pg_temp.chk('18 sign-ups closed: new account refused', (select pg_temp.as_('authenticated','rommel.taligatos@worldclasslaminate.com.ph','with u as (update public.website_settings set accounts_open=false where id=1 returning 1) select count(*)::text from u')||'/'||pg_temp.as_('authenticated','qa.new@example.com','insert into public.client_accounts(email,full_name) values (''qa.new@example.com'',''New'')')), '1/REFUSED');
select pg_temp.chk('19 sign-ups closed: existing client still saves profile', pg_temp.as_('authenticated','qa.client2@example.com','insert into public.client_accounts(email,full_name) values (''qa.client2@example.com'',''QA Two edited'') on conflict (email) do update set full_name=excluded.full_name'), 'ok');
select pg_temp.chk('20 Command Center lists clients / outsider refused', pg_temp.as_('authenticated','rommel.taligatos@worldclasslaminate.com.ph','select (count(*)>=2)::text from public.cc_website_clients()')||'/'||pg_temp.as_('authenticated','qa.outsider@example.com','select count(*)::text from public.cc_website_clients()'), 'true/REFUSED');
select pg_temp.chk('21 view-as-client shows the test order', pg_temp.as_('authenticated','rommel.taligatos@worldclasslaminate.com.ph','select count(*)::text||'' ''||bool_and(is_test)::text from public.cc_website_client_orders(''qa.client2@example.com'')'), '1 true');
select pg_temp.chk('22 maintenance blocks site visits, not Wufoo', (select pg_temp.as_('authenticated','rommel.taligatos@worldclasslaminate.com.ph','with u as (update public.website_settings set maintenance=true where id=1 returning 1) select count(*)::text from u')||'/'||pg_temp.as_('anon',null,pg_temp.ord('QA-T22','Site Visit',''))||'/'||pg_temp.as_('anon',null,pg_temp.ord('QA-T22b','Wufoo',''))), '1/REFUSED/ok');
select pg_temp.chk('23 outsider cannot read client flags', pg_temp.as_('authenticated','qa.outsider@example.com','select count(*)::text from public.website_client_flags'), '0');
select pg_temp.chk('24 every change logged as WEBSITE', (select (count(*)>=6)::text from public.user_access_log where app='WEBSITE'), 'true');

do $$
declare r text;
begin
  select string_agg(case when got=want then 'PASS ' else 'FAIL ' end||test||case when got=want then '' else ' (got '||coalesce(got,'null')||', wanted '||want||')' end, ' | ' order by n)
    into r from res;
  raise exception 'TEST RESULT (nothing was saved): %', r;
end $$;
