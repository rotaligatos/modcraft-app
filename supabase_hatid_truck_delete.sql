-- HATID: removing a truck (Fleet › Trucks › Edit › Delete truck)
-- Run once in the Supabase SQL editor of the HATID project (nssviuuagtlvxjvvvagt).
--
-- Rule (Rommel, 2026-10-03): a truck that holds records keeps them.
-- Deleting a truck in this database CASCADES to job_trips, GPS positions, checklists and
-- trip notices, and is blocked by fuel and maintenance logs, so a truck with records is
-- never deleted. Instead, when it is sold or decommissioned it is taken out of the app:
-- status 'retired' (so every existing truck list and the KEYSTONE feed already skip it)
-- plus removed_at / removed_reason, which also keeps it out of "Show retired trucks".
-- Past jobs and reports still name it.
--
-- Reasons: 'mistake' (entered by mistake / duplicate), 'sold', 'decommissioned'.
--   no records          → deleted for good (any reason)
--   records + mistake   → refused, lists what uses it
--   records + sold/decommissioned → removed from the app, records kept
-- Admin or manager of the truck's pool only.

alter table public.trucks
  add column if not exists removed_at timestamptz,
  add column if not exists removed_reason text,
  add column if not exists removed_note text,
  add column if not exists removed_by text;

do $$ begin
  alter table public.trucks add constraint trucks_removed_reason_check
    check (removed_reason is null or removed_reason in ('sold','decommissioned'));
exception when duplicate_object then null; end $$;

drop function if exists public.job_truck_delete(uuid);

create or replace function public.job_truck_remove(p_truck uuid, p_reason text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t trucks%rowtype; used text[] := '{}'; n int; who text;
begin
  if p_reason not in ('mistake','sold','decommissioned') then raise exception 'Choose why the truck is going'; end if;
  select * into t from trucks where id = p_truck;
  if not found then raise exception 'Truck not found'; end if;
  select coalesce(s.name, s.email) into who from job_staff s join logistics_pools p on p.id = t.pool_id
   where s.id = auth.uid() and s.active and s.role in ('admin','manager')
     and (s.companies is null or s.companies && p.companies);
  if who is null then raise exception 'Only an admin or manager can remove a truck'; end if;

  select count(*) into n from jobs where truck_id = p_truck; if n > 0 then used := used || (n || ' job' || case when n=1 then '' else 's' end); end if;
  select count(*) into n from job_trips where truck_id = p_truck; if n > 0 then used := used || (n || ' trip' || case when n=1 then '' else 's' end); end if;
  select count(*) into n from truck_fuel_logs where truck_id = p_truck; if n > 0 then used := used || (n || ' fuel log' || case when n=1 then '' else 's' end); end if;
  select count(*) into n from truck_maintenance where truck_id = p_truck; if n > 0 then used := used || (n || ' maintenance record' || case when n=1 then '' else 's' end); end if;
  select count(*) into n from job_truck_checks where truck_id = p_truck; if n > 0 then used := used || (n || ' truck checklist' || case when n=1 then '' else 's' end); end if;
  select count(*) into n from job_trip_notices where truck_id = p_truck; if n > 0 then used := used || (n || ' trip notice' || case when n=1 then '' else 's' end); end if;
  select count(*) into n from truck_positions where truck_id = p_truck; if n > 0 then used := used || (n || ' GPS reading' || case when n=1 then '' else 's' end); end if;

  if coalesce(array_length(used, 1), 0) = 0 then
    delete from trucks where id = p_truck;   -- set-up rows (availability, crews, tracker, cost rates, state) go with it
    return jsonb_build_object('result', 'deleted', 'label', t.label);
  end if;
  if p_reason = 'mistake' then
    return jsonb_build_object('result', 'refused', 'used', to_jsonb(used));
  end if;
  update trucks set status = 'retired', removed_at = now(), removed_reason = p_reason,
         removed_note = nullif(btrim(coalesce(p_note, '')), ''), removed_by = who
   where id = p_truck;
  return jsonb_build_object('result', 'removed', 'label', t.label, 'used', to_jsonb(used));
end $$;

-- Undo a sold/decommissioned removal (marked by mistake). The truck comes back as Retired;
-- set it to Active in Edit if it is really back in service.
create or replace function public.job_truck_restore(p_truck uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t trucks%rowtype;
begin
  select * into t from trucks where id = p_truck;
  if not found then raise exception 'Truck not found'; end if;
  if not exists (select 1 from job_staff s join logistics_pools p on p.id = t.pool_id
     where s.id = auth.uid() and s.active and s.role in ('admin','manager')
       and (s.companies is null or s.companies && p.companies)) then
    raise exception 'Only an admin or manager can restore a truck';
  end if;
  update trucks set removed_at = null, removed_reason = null, removed_note = null, removed_by = null where id = p_truck;
  return jsonb_build_object('result', 'restored', 'label', t.label);
end $$;

revoke all on function public.job_truck_remove(uuid, text, text) from public, anon;
revoke all on function public.job_truck_restore(uuid) from public, anon;
grant execute on function public.job_truck_remove(uuid, text, text) to authenticated;
grant execute on function public.job_truck_restore(uuid) to authenticated;
