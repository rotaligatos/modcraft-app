-- Command Center access (Rommel 2026-10-03): who may use the Command Center, and at what level.
-- Run on the MODCRAFT project (nkpekroogqsmfilypowd).
--   owner   — everything, including this access list.
--   manager — manages users in every app (Modcraft, PMES, KEYSTONE, HATID, ShelfSync); sees this list, can't change it.
-- Before this, the Command Center was open to every Modcraft Admin/Director (app_is_admin_tier()).
-- Those people are seeded as owners, so nobody loses access today.
-- Every change is logged (user_access_log, app 'COMMAND CENTER'); the list can never be left without an active owner.
-- Per-app / per-company limits are deliberately NOT here yet (Rommel will define them).

create table if not exists public.cc_access (
  email text primary key check (email = lower(btrim(email)) and email like '%@%'),
  name text,
  level text not null default 'manager' check (level in ('owner','manager')),
  active boolean not null default true,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz,
  updated_by text
);

create or replace function public.cc_level() returns text
 language sql stable security definer set search_path to 'public' as $$
  select level from public.cc_access where email = public.app_current_email() and active limit 1
$$;
create or replace function public.cc_can_manage() returns boolean
 language sql stable security definer set search_path to 'public' as $$ select public.cc_level() is not null $$;
create or replace function public.cc_is_owner() returns boolean
 language sql stable security definer set search_path to 'public' as $$ select coalesce(public.cc_level() = 'owner', false) $$;
revoke execute on function public.cc_level(), public.cc_can_manage(), public.cc_is_owner() from public, anon;
grant execute on function public.cc_level(), public.cc_can_manage(), public.cc_is_owner() to authenticated;

alter table public.cc_access enable row level security;
drop policy if exists "cc_access read" on public.cc_access;
drop policy if exists "cc_access write" on public.cc_access;
create policy "cc_access read" on public.cc_access for select to authenticated
  using (email = public.app_current_email() or public.cc_can_manage());
create policy "cc_access write" on public.cc_access for all to authenticated
  using (public.cc_is_owner()) with check (public.cc_is_owner());
revoke all on public.cc_access from anon;
grant select, insert, update, delete on public.cc_access to authenticated;

-- Never leave the Command Center without an active owner
create or replace function public.cc_guard_last_owner() returns trigger
 language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.cc_access where active and level = 'owner') then
    raise exception 'At least one active owner must remain on the Command Center access list.';
  end if;
  return null;
end $$;

create or replace function public.user_access_log_row()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if tg_table_name='users' and tg_op='UPDATE'
     and (to_jsonb(new)-'updated_at') = (to_jsonb(old)-'updated_at') then return null; end if;
  insert into public.user_access_log(app,email,action,before,after,changed_by)
  values (case tg_table_name when 'pmes_users' then 'PMES' when 'users' then 'MODCRAFT' when 'jobboard_users' then 'HATID'
                             when 'shelfsync_users' then 'SHELFSYNC' when 'cc_access' then 'COMMAND CENTER' else 'KEYSTONE' end,
          coalesce(new.email, old.email), lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          nullif(public.app_current_email(),''));
  return null;
end $function$;

drop trigger if exists cc_access_stamp on public.cc_access;
drop trigger if exists cc_access_log on public.cc_access;
drop trigger if exists cc_access_last_owner on public.cc_access;
create trigger cc_access_stamp before insert or update on public.cc_access
  for each row execute function public.user_access_audit();
create trigger cc_access_log after insert or update or delete on public.cc_access
  for each row execute function public.user_access_log_row();
create constraint trigger cc_access_last_owner after update or delete on public.cc_access
  deferrable initially deferred for each row execute function public.cc_guard_last_owner();

-- Seed: today's Command Center users (Modcraft Admin/Director) become owners
insert into public.cc_access(email,name,level,notes)
select lower(btrim(email)), max(name), 'owner', 'Modcraft '||max(role)||' when Command Center access was introduced'
from public.users where active and role in ('Admin','Director') group by lower(btrim(email))
on conflict (email) do nothing;

-- The page's own check
create or replace function public.cc_me() returns jsonb
 language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'email', public.app_current_email(),
    'name', coalesce((select name from public.cc_access where email = public.app_current_email() limit 1),
                     (select name from public.users where lower(btrim(email)) = public.app_current_email() and active limit 1)),
    'level', public.cc_level(),
    'allowed', public.cc_can_manage()) $$;

-- Command Center functions: Admin/Director → Command Center access
do $$
declare f record; src text;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname in ('cc_log_jobboard','cc_log_sheet_change','cc_log_shelfsync','cc_pin_status','pmes_delegate_create','pmes_delegate_revoke')
  loop
    src := pg_get_functiondef(f.oid);
    src := replace(src, 'public.app_is_admin_tier()', 'public.cc_can_manage()');
    src := replace(src, 'app_is_admin_tier()', 'public.cc_can_manage()');
    execute src;
  end loop;
  -- PIN clear/copy is also used by Modcraft's own Settings → Users, so Modcraft admins keep it too.
  select p.oid into f from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='cc_sync_user_pins';
  src := pg_get_functiondef(f.oid);
  src := replace(src, 'public.app_is_admin_tier()', '@@CC@@');
  src := replace(src, 'app_is_admin_tier()', '@@CC@@');
  src := replace(src, '@@CC@@', '(public.app_is_admin_tier() or public.cc_can_manage())');
  execute src;
end $$;

-- User lists edited from the Command Center
drop policy if exists "jobboard_users read" on public.jobboard_users;
drop policy if exists "jobboard_users write" on public.jobboard_users;
create policy "jobboard_users read" on public.jobboard_users for select using (email = app_current_email() or cc_can_manage());
create policy "jobboard_users write" on public.jobboard_users for all using (cc_can_manage()) with check (cc_can_manage());

drop policy if exists "shelfsync_users read" on public.shelfsync_users;
drop policy if exists "shelfsync_users write" on public.shelfsync_users;
create policy "shelfsync_users read" on public.shelfsync_users for select to authenticated using (email = app_current_email() or cc_can_manage());
create policy "shelfsync_users write" on public.shelfsync_users for all to authenticated using (cc_can_manage()) with check (cc_can_manage());

drop policy if exists "keystone_users read" on public.keystone_users;
drop policy if exists "keystone_users write" on public.keystone_users;
create policy "keystone_users read" on public.keystone_users for select to authenticated using (email = app_current_email() or ks_is_admin_tier() or cc_can_manage());
create policy "keystone_users write" on public.keystone_users for all to authenticated using (cc_can_manage() or ks_is_admin_tier()) with check (cc_can_manage() or ks_is_admin_tier());

drop policy if exists "pmes_users read" on public.pmes_users;
drop policy if exists "pmes_users write" on public.pmes_users;
create policy "pmes_users read" on public.pmes_users for select to authenticated using (email = app_current_email() or pmes_rank() >= 30 or cc_can_manage());
create policy "pmes_users write" on public.pmes_users for all to authenticated using (cc_can_manage() or pmes_rank() >= 40) with check (cc_can_manage() or pmes_rank() >= 40);

drop policy if exists adm_caps_read on public.adm_user_caps;
drop policy if exists adm_caps_write on public.adm_user_caps;
create policy adm_caps_read on public.adm_user_caps for select to authenticated using (lower(btrim(email)) = app_current_email() or ks_is_admin_tier() or cc_can_manage());
create policy adm_caps_write on public.adm_user_caps for all to authenticated using (cc_can_manage() or ks_is_admin_tier()) with check (cc_can_manage() or ks_is_admin_tier());

drop policy if exists "access log read" on public.user_access_log;
create policy "access log read" on public.user_access_log for select to authenticated using (cc_can_manage());
drop policy if exists "shadow log admin read" on public.user_shadow_log;
create policy "shadow log admin read" on public.user_shadow_log for select to authenticated using (cc_can_manage());
drop policy if exists pmes_delegations_cc_read on public.pmes_delegations;
create policy pmes_delegations_cc_read on public.pmes_delegations for select to authenticated using (cc_can_manage());

-- Modcraft's own user copy: Modcraft admins (Settings → Users) and Command Center users
drop policy if exists "own row or admin read" on public.users;
drop policy if exists "admin insert" on public.users;
drop policy if exists "admin update" on public.users;
drop policy if exists "admin delete" on public.users;
create policy "own row or admin read" on public.users for select to authenticated using (lower(btrim(email)) = app_current_email() or app_is_admin_tier() or cc_can_manage());
create policy "admin insert" on public.users for insert to authenticated with check (app_is_admin_tier() or cc_can_manage());
create policy "admin update" on public.users for update to authenticated using (app_is_admin_tier() or cc_can_manage()) with check (app_is_admin_tier() or cc_can_manage());
create policy "admin delete" on public.users for delete to authenticated using (app_is_admin_tier() or cc_can_manage());
