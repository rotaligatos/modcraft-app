-- HATID: delete a truck (Fleet › Trucks › Edit › Delete truck)
-- Run once in the Supabase SQL editor of the HATID project (nssviuuagtlvxjvvvagt).
--
-- Deleting a truck CASCADES to job_trips, GPS positions, checklists and trip notices,
-- and is blocked outright by fuel and maintenance logs. So a plain delete would either
-- fail or silently erase delivery history. This function only removes a truck that has
-- NO history; otherwise it returns what is using it and changes nothing, and the app
-- offers "Retire instead". Admin or manager of the truck's pool only.

create or replace function public.job_truck_delete(p_truck uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t trucks%rowtype; used text[] := '{}'; n int;
begin
  select * into t from trucks where id = p_truck;
  if not found then raise exception 'Truck not found'; end if;
  if not exists (select 1 from job_staff s join logistics_pools p on p.id = t.pool_id
     where s.id = auth.uid() and s.active and s.role in ('admin','manager')
       and (s.companies is null or s.companies && p.companies)) then
    raise exception 'Only an admin or manager can delete a truck';
  end if;
  select count(*) into n from jobs where truck_id = p_truck; if n > 0 then used := used || (n || ' job' || case when n=1 then '' else 's' end); end if;
  select count(*) into n from job_trips where truck_id = p_truck; if n > 0 then used := used || (n || ' trip' || case when n=1 then '' else 's' end); end if;
  select count(*) into n from truck_fuel_logs where truck_id = p_truck; if n > 0 then used := used || (n || ' fuel log' || case when n=1 then '' else 's' end); end if;
  select count(*) into n from truck_maintenance where truck_id = p_truck; if n > 0 then used := used || (n || ' maintenance record' || case when n=1 then '' else 's' end); end if;
  select count(*) into n from job_truck_checks where truck_id = p_truck; if n > 0 then used := used || (n || ' truck checklist' || case when n=1 then '' else 's' end); end if;
  select count(*) into n from job_trip_notices where truck_id = p_truck; if n > 0 then used := used || (n || ' trip notice' || case when n=1 then '' else 's' end); end if;
  select count(*) into n from truck_positions where truck_id = p_truck; if n > 0 then used := used || (n || ' GPS reading' || case when n=1 then '' else 's' end); end if;
  if array_length(used, 1) > 0 then
    return jsonb_build_object('deleted', false, 'used', to_jsonb(used));
  end if;
  delete from trucks where id = p_truck;   -- set-up rows (availability, crews, tracker, cost rates, state) go with it
  return jsonb_build_object('deleted', true, 'label', t.label);
end $$;

revoke all on function public.job_truck_delete(uuid) from public, anon;
grant execute on function public.job_truck_delete(uuid) to authenticated;
