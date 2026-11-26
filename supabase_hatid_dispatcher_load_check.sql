-- HATID: the dispatcher checks and locks the load (Rommel 2026-11-26)
-- Flow after the schedule is approved:
--   A. dispatcher assigns the driver (account) and helper (typed) for the truck
--   B. dispatcher checks every line of every drop: correct item, correct quantity, no quality issue
--      - a problem sends the line back to the warehouse (prepared is cleared); the trip can't lock until it is fixed
--   C. dispatcher locks the load
--   D. driver does the truck checklist (company trucks), taps "Load received", then departs
-- Clients get the "on the way" message when the driver receives the load (it used to go at the lock).

alter table jobs add column if not exists load_issue jsonb;
alter table job_trips add column if not exists load_locked_name text,
  add column if not exists load_received_at timestamptz,
  add column if not exists load_received_by uuid,
  add column if not exists load_received_name text;

-- Drivers can no longer write the load check; and they can't depart until they received the load
create or replace function public.job_load_guard()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare tr job_trips; v_role text;
begin
  if new.truck_id is null or new.scheduled_date is null then return new; end if;
  select role into v_role from job_staff where id = auth.uid();
  if new.load_check is distinct from old.load_check and coalesce(current_setting('hatid.unlock', true), '') <> '1' then
    if v_role = 'field' then
      raise exception 'The dispatcher checks the load — tell base if something is wrong (Report a load concern)' using errcode = 'P0001';
    end if;
    select * into tr from job_trips where trip_date = new.scheduled_date and truck_id = new.truck_id and trip_no = coalesce(new.trip_no, 1);
    if tr.load_locked_at is not null then
      raise exception 'The load for this trip is checked and locked — ask the logistics supervisor to unlock it' using errcode = 'P0001';
    end if;
  end if;
  if v_role = 'field' and old.status = 'scheduled' and new.status = 'dispatched' then
    select * into tr from job_trips where trip_date = new.scheduled_date and truck_id = new.truck_id and trip_no = coalesce(new.trip_no, 1);
    if tr.load_locked_at is null then
      raise exception 'Wait for the dispatcher to check and lock the load first' using errcode = 'P0001';
    end if;
    if tr.load_received_at is null then
      raise exception 'Tap “Load received” first (after the truck checklist)' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $function$;

-- Unlock (shared by job_trip_update's unlock and job_trip_unlock)
create or replace function public.job_trip_unlock_do(r job_trips, p_reason text, p_name text)
 returns job_trips language plpgsql security definer set search_path to 'public'
as $function$
declare co text;
begin
  perform set_config('hatid.unlock', '1', true);
  update jobs set load_check = null, loaded_at = null, loaded_by = null
   where truck_id = r.truck_id and scheduled_date = r.trip_date and coalesce(trip_no, 1) = r.trip_no and status in ('scheduled','dispatched','in_progress','issue');
  perform set_config('hatid.unlock', '', true);
  update job_trips set load_locked_at = null, load_locked_by = null, load_locked_name = null,
         load_received_at = null, load_received_by = null, load_received_name = null, updated_at = now()
   where id = r.id returning * into r;
  insert into job_events (job_id, event_type, notes)
  select id, 'load_unlocked', 'Load check unlocked by ' || p_name || ': ' || p_reason || ' — the dispatcher must check and lock it again' from jobs
   where truck_id = r.truck_id and scheduled_date = r.trip_date and coalesce(trip_no, 1) = r.trip_no and status in ('scheduled','dispatched','in_progress','issue');
  insert into job_notifications (user_id, kind, title, body, ref_type, ref_date)
  select d, 'load_unlocked', '🔓 Load check unlocked — ' || job_trip_label(r.trip_date, r.truck_id, r.trip_no), p_name || ': ' || p_reason || '. Wait for the dispatcher to check and lock it again.', 'trip', r.trip_date
    from job_trip_drivers(r.trip_date, r.truck_id) d;
  co := (select company from jobs where truck_id = r.truck_id and scheduled_date = r.trip_date and coalesce(trip_no, 1) = r.trip_no limit 1);
  perform job_notify_office(co, 'load_unlocked', '🔓 Load check unlocked — ' || job_trip_label(r.trip_date, r.truck_id, r.trip_no),
    p_name || ': ' || p_reason || '. Check and lock the load again.', 'truck', r.truck_id, r.trip_date, auth.uid());
  return r;
end $function$;

create or replace function public.job_trip_update(p_date date, p_truck uuid, p_trip integer, p_patch jsonb DEFAULT '{}'::jsonb)
 returns job_trips language plpgsql security definer set search_path to 'public'
as $function$
declare r job_trips; v_role text; v_name text; t record; n_open int; reason text;
begin
  select role, coalesce(nullif(btrim(name), ''), email) into v_role, v_name from job_staff where id = auth.uid() and active;
  if v_role is null or v_role = 'viewer' or not job_can_access_pool(job_truck_pool(p_truck), false) then raise exception 'Not allowed'; end if;
  r := job_trip_row(p_date, p_truck, p_trip);
  if job_truck_tracked(p_truck, p_date) and not r.tracked then update job_trips set tracked = true where id = r.id; end if;
  if p_patch ? 'target_time' then
    if v_role = 'field' then raise exception 'Only the office sets target times'; end if;
    update job_trips set target_time = nullif(p_patch->>'target_time', '')::time, updated_at = now() where id = r.id;
  end if;
  if p_patch ? 'departed' and (p_patch->>'departed')::boolean then
    update job_trips set departed_at = coalesce(departed_at, now()), departed_by = coalesce(departed_by, auth.uid()), updated_at = now() where id = r.id;
    if r.load_locked_at is not null then perform job_trip_onway(p_date, p_truck, p_trip); end if;
  end if;
  if p_patch ? 'late_reason' then
    update job_trips set late_reason = nullif(p_patch->>'late_reason', ''), late_note = coalesce(nullif(p_patch->>'late_note', ''), late_note), updated_at = now() where id = r.id;
  end if;
  -- C. the dispatcher locks the load
  if coalesce((p_patch->>'lock')::boolean, false) and r.load_locked_at is null then
    if v_role not in ('admin','manager','dispatcher') then
      raise exception 'The dispatcher checks and locks the load' using errcode = 'P0001';
    end if;
    select tr.* into t from trucks tr where tr.id = p_truck;
    if not exists (select 1 from job_truck_drivers where day = p_date and truck_id = p_truck)
       and not (coalesce(t.fleet_type, '') <> 'company_owned' and exists (select 1 from truck_crews c where c.truck_id = p_truck and c.work_date = p_date and nullif(btrim(c.driver), '') is not null)) then
      raise exception 'Assign the driver first' using errcode = 'P0001';
    end if;
    select string_agg(coalesce(client_name, quotation_serial), ', ') into reason from jobs where truck_id = p_truck and scheduled_date = p_date and coalesce(trip_no, 1) = p_trip
      and status = 'scheduled' and load_issue is not null;
    if reason is not null then raise exception 'Back with the warehouse (problem at loading): % — lock when it is fixed', reason using errcode = 'P0001'; end if;
    reason := null;
    select string_agg(coalesce(client_name, quotation_serial), ', ') into reason from jobs where truck_id = p_truck and scheduled_date = p_date and coalesce(trip_no, 1) = p_trip
      and status = 'scheduled' and prepared_at is null;
    if reason is not null then raise exception 'Not prepared yet by the warehouse: % — it can''t be loaded until it is (or base gets it allowed without the missing items)', reason using errcode = 'P0001'; end if;
    select count(*) into n_open from jobs where truck_id = p_truck and scheduled_date = p_date and coalesce(trip_no, 1) = p_trip
      and status in ('scheduled','dispatched','in_progress','issue') and coalesce((load_check->>'all')::boolean, false) = false;
    if n_open > 0 then raise exception 'Check every item on every drop of this trip first (% drop(s) not fully checked)', n_open using errcode = 'P0001'; end if;
    reason := null;
    update job_trips set load_locked_at = now(), load_locked_by = auth.uid(), load_locked_name = v_name, updated_at = now() where id = r.id;
    insert into job_events (job_id, event_type, notes)
    select id, 'load_confirmed', 'Load checked and locked by ' || v_name || ' (items, quantity and quality)' from jobs
     where truck_id = p_truck and scheduled_date = p_date and coalesce(trip_no, 1) = p_trip and status in ('scheduled','dispatched','in_progress','issue');
    insert into job_notifications (user_id, kind, title, body, ref_type, ref_date)
    select d, 'load_locked', '🔒 Load checked — ' || job_trip_label(p_date, p_truck, p_trip),
      v_name || ' checked and locked the load. Do the truck checklist, then tap Load received.', 'trip', p_date
      from job_trip_drivers(p_date, p_truck) d;
    select * into r from job_trips where id = r.id;
  end if;
  -- D. the driver receives the load
  if coalesce((p_patch->>'received')::boolean, false) and r.load_received_at is null then
    if r.load_locked_at is null then raise exception 'Wait for the dispatcher to check and lock the load first' using errcode = 'P0001'; end if;
    select tr.* into t from trucks tr where tr.id = p_truck;
    if t.fleet_type = 'company_owned' and not exists (select 1 from job_truck_checks where day = p_date and truck_id = p_truck) then
      raise exception 'Do the truck checklist first — it is needed before this truck''s first trip of the day' using errcode = 'P0001';
    end if;
    update job_trips set load_received_at = now(), load_received_by = auth.uid(), load_received_name = v_name, updated_at = now() where id = r.id;
    insert into job_events (job_id, event_type, notes)
    select id, 'load_received', 'Load received by ' || v_name || case when v_role <> 'field' then ' (marked by the office)' else '' end from jobs
     where truck_id = p_truck and scheduled_date = p_date and coalesce(trip_no, 1) = p_trip and status in ('scheduled','dispatched','in_progress','issue');
    perform job_trip_onway(p_date, p_truck, p_trip);
  end if;
  if coalesce((p_patch->>'unlock')::boolean, false) and r.load_locked_at is not null then
    if not job_can_unlock_load() then raise exception 'Only the logistics supervisor (Review step) or an admin can unlock a locked load' using errcode = '42501'; end if;
    reason := nullif(btrim(p_patch->>'reason'), '');
    if reason is null then raise exception 'Give the reason for unlocking' using errcode = 'P0001'; end if;
    r := job_trip_unlock_do(r, reason, v_name);
  end if;
  if coalesce((p_patch->>'back')::boolean, false) then
    update job_trips set back_at = coalesce(back_at, now()), back_by = coalesce(back_by, auth.uid()), updated_at = now() where id = r.id;
  end if;
  select * into r from job_trips where id = r.id;
  return r;
end $function$;

create or replace function public.job_trip_unlock(p_date date, p_truck uuid, p_trip integer, p_reason text)
 returns job_trips language plpgsql security definer set search_path to 'public'
as $function$
declare r job_trips; v_name text; reason text := nullif(btrim(p_reason), '');
begin
  if not job_can_unlock_load() or not job_can_access_pool(job_truck_pool(p_truck), false) then
    raise exception 'Only the logistics supervisor (Review step) or an admin can unlock a locked load' using errcode = '42501'; end if;
  if reason is null then raise exception 'Give the reason for unlocking' using errcode = 'P0001'; end if;
  select coalesce(nullif(btrim(name), ''), email) into v_name from job_staff where id = auth.uid();
  select * into r from job_trips where trip_date = p_date and truck_id = p_truck and trip_no = p_trip;
  if r.id is null or r.load_locked_at is null then return r; end if;
  return job_trip_unlock_do(r, reason, v_name);
end $function$;

-- B. problem found at loading → back to the warehouse
create or replace function public.job_load_problem(p_job uuid, p_lines text[], p_kind text, p_note text, p_photo text DEFAULT NULL)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare j jobs; me job_staff; who text; tr job_trips; keys text[]; p jsonb; lc jsonb; k text; kinds jsonb := '{"short":"Short quantity","damaged":"Damaged / quality issue","wrong":"Wrong item / color / size"}';
begin
  if not job_is_office() then raise exception 'Only the dispatcher reports a loading problem here' using errcode = 'P0001'; end if;
  select * into me from job_staff where id = auth.uid(); who := coalesce(nullif(btrim(me.name), ''), me.email);
  select * into j from jobs where id = p_job for update;
  if j.id is null or not (me.companies is null or j.company = any(me.companies)) then raise exception 'Delivery not found.' using errcode = 'P0001'; end if;
  if j.status <> 'scheduled' then raise exception 'This delivery has already left.' using errcode = 'P0001'; end if;
  if not (kinds ? p_kind) then raise exception 'Pick what is wrong.' using errcode = 'P0001'; end if;
  if nullif(btrim(p_note), '') is null then raise exception 'Say what is wrong (e.g. 34 of 36 pcs, 2 boards chipped).' using errcode = 'P0001'; end if;
  select * into tr from job_trips where trip_date = j.scheduled_date and truck_id = j.truck_id and trip_no = coalesce(j.trip_no, 1);
  if tr.load_locked_at is not null then raise exception 'The load is already locked — ask the logistics supervisor to unlock it first.' using errcode = 'P0001'; end if;
  keys := job_prep_keys(j);
  if cardinality(keys) > 0 and (coalesce(cardinality(p_lines), 0) = 0 or exists (select 1 from unnest(p_lines) x where not x = any(keys))) then
    raise exception 'Pick the items with the problem.' using errcode = 'P0001'; end if;
  p := coalesce(j.prep, '{}') - 'all'; lc := coalesce(j.load_check->'lines', '{}');
  if cardinality(keys) = 0 then p := '{}'; lc := '{}';
  else foreach k in array p_lines loop p := p - k; lc := lc - k; end loop; end if;
  update jobs set prep = p, prepared_at = null, prepared_name = null,
    load_check = jsonb_build_object('lines', lc, 'all', false, 'at', now(), 'by', auth.uid(), 'by_name', who),
    loaded_at = null, loaded_by = null,
    load_issue = jsonb_build_object('kind', p_kind, 'label', kinds->>p_kind, 'note', btrim(p_note), 'lines', to_jsonb(coalesce(p_lines, '{}')), 'photo', p_photo,
      'by', auth.uid(), 'by_name', who, 'at', now())
   where id = p_job;
  insert into job_events (job_id, event_type, notes, created_by, actor_name, actor_role, photo_url, photo_urls)
  values (p_job, 'load_problem', 'Problem at loading — ' || (kinds->>p_kind) || ': ' || btrim(p_note) || '. Sent back to the warehouse.', auth.uid(), who, me.role,
    p_photo, case when p_photo is null then null else array[p_photo] end);
  insert into job_notifications (user_id, kind, title, body, ref_type, ref_id, ref_date)
  select s.id, 'load_problem', '📦 Fix before loading — ' || coalesce(j.client_name, j.quotation_serial),
    who || ': ' || (kinds->>p_kind) || ' — ' || btrim(p_note) || '. Prepare it again; the truck can''t be locked until you tick it prepared.', 'job', j.id, j.scheduled_date
    from job_staff s where s.active and s.pickup_role in ('warehouse','wh_manager') and (s.companies is null or j.company = any(s.companies)) and s.id <> auth.uid();
  return jsonb_build_object('ok', true);
end $function$;
grant execute on function public.job_load_problem(uuid, text[], text, text, text) to authenticated;
revoke execute on function public.job_trip_unlock_do(job_trips, text, text) from public, anon, authenticated;

-- Warehouse: re-preparing a drop sent back at loading closes the problem (no second "delivery confirmed" message)
create or replace function public.job_prep_set(p_job uuid, p_vals jsonb, p_all boolean DEFAULT false)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare j jobs; me job_staff; keys text[]; v jsonb; done boolean; who text;
begin
  if not job_prep_can('tick') then raise exception 'Only the warehouse can tick deliveries as prepared.' using errcode = 'P0001'; end if;
  select * into me from job_staff where id = auth.uid(); who := coalesce(nullif(btrim(me.name), ''), me.email);
  select * into j from jobs where id = p_job for update;
  if j.id is null or not (me.companies is null or j.company = any(me.companies)) then raise exception 'Delivery not found.' using errcode = 'P0001'; end if;
  if j.status not in ('proposed','scheduled') then raise exception 'This delivery has already left.' using errcode = 'P0001'; end if;
  keys := job_prep_keys(j);
  v := case when p_all then (select coalesce(jsonb_object_agg(k, true), '{}') from unnest(keys) k) || jsonb_build_object('all', true)
            else coalesce(j.prep, '{}') || coalesce(p_vals, '{}') end;
  done := case when cardinality(keys) = 0 then coalesce((v->>'all')::boolean, false) else (select bool_and(coalesce((v->>k)::boolean, false)) from unnest(keys) k) end;
  update jobs set prep = v, prepared_at = case when done then coalesce(prepared_at, now()) end,
    prepared_name = case when done then coalesce(prepared_name, who) end,
    load_issue = case when done then null else load_issue end where id = p_job;
  if done and j.prepared_at is null then
    if j.load_issue is not null then
      insert into job_events (job_id, event_type, notes) values (p_job, 'load_fixed', 'Warehouse (' || who || ') fixed the loading problem — ready to check again');
      perform job_notify_office(j.company, 'load_fixed', '✅ Fixed — check the load again: ' || coalesce(j.client_name, j.quotation_serial),
        who || ' prepared it again after: ' || coalesce(j.load_issue->>'label', '') || ' — ' || coalesce(j.load_issue->>'note', ''), 'job', j.id, j.scheduled_date, auth.uid());
    else
      insert into job_events (job_id, event_type, notes) values (p_job, 'prepared', 'Warehouse: all items prepared');
      perform job_prep_done(p_job);
    end if;
  end if;
  return jsonb_build_object('prepared', done, 'prep', v);
end $function$;

create or replace function public.job_prep_list(p_from date, p_to date)
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'serial', j.quotation_serial, 'company', j.company, 'client', j.client_name, 'date', j.scheduled_date,
      'status', j.status, 'truck', coalesce(t.label, case when j.courier_vehicle_id is not null then 'Grab / Lalamove' end), 'truck_id', j.truck_id, 'trip_no', j.trip_no, 'drop_seq', j.drop_seq,
      'board_pcs', j.board_pcs, 'items', j.items, 'doc_refs', j.doc_refs, 'notes', j.notes, 'prep', j.prep, 'prepared_at', j.prepared_at, 'prepared_name', j.prepared_name,
      'req_at', j.prep_req_at, 'req_name', j.prep_req_name, 'req_note', j.prep_req_note, 'req_lines', j.prep_req_lines, 'waived_at', j.prep_waived_at, 'load_issue', j.load_issue,
      'sched', (select ds.status from delivery_schedules ds where ds.delivery_date = j.scheduled_date and ds.pool_id = job_pool_of(j.truck_id, j.company) limit 1))
      order by j.scheduled_date, t.label nulls last, j.trip_no, j.drop_seq nulls last), '[]')
  from jobs j left join trucks t on t.id = j.truck_id
  where (job_prep_can('tick') or job_is_office())
    and j.scheduled_date between p_from and p_to and j.status in ('proposed','scheduled')
    and exists (select 1 from job_staff s where s.id = auth.uid() and s.active and (s.companies is null or j.company = any(s.companies)));
$function$;

-- GPS departure: clients still get "on the way"; the office is told if the driver never tapped Load received
create or replace function public.job_track_auto_depart(p_day date, p_truck uuid, p_trip integer, p_at timestamp with time zone)
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare j record; n int := 0; v_drv uuid; tr job_trips; co text;
begin
  select staff_id into v_drv from job_truck_drivers where day = p_day and truck_id = p_truck limit 1;
  for j in select id from jobs where truck_id = p_truck and scheduled_date = p_day and coalesce(trip_no, 1) = p_trip and status = 'scheduled' loop
    update jobs set status = 'dispatched' where id = j.id;
    insert into job_events (job_id, event_type, notes, created_by, created_at)
    values (j.id, 'dispatched', 'Trip ' || p_trip || ' departed — detected by GPS at ' || to_char(p_at at time zone 'Asia/Manila', 'FMHH12:MI AM'), v_drv, p_at);
    n := n + 1;
  end loop;
  if n > 0 then
    update job_trips set departed_at = coalesce(departed_at, p_at), updated_at = now() where truck_id = p_truck and trip_date = p_day and trip_no = p_trip returning * into tr;
    perform job_trip_onway(p_day, p_truck, p_trip);
    if tr.load_received_at is null then
      co := (select company from jobs where truck_id = p_truck and scheduled_date = p_day and coalesce(trip_no, 1) = p_trip limit 1);
      perform job_notify_office(co, 'no_receive', '⚠️ Left before the driver received the load — ' || job_trip_label(p_day, p_truck, p_trip),
        'GPS shows the truck left at ' || to_char(p_at at time zone 'Asia/Manila', 'FMHH12:MI AM') || '. The load was locked by ' || coalesce(tr.load_locked_name, 'the dispatcher') || ' but the driver did not tap Load received.', 'truck', p_truck, p_day);
    end if;
  end if;
  return n;
end $function$;

-- Trips already locked by the driver under the old flow count as received
update job_trips set load_received_at = load_locked_at, load_received_by = load_locked_by where load_locked_at is not null and load_received_at is null;

do $$ declare d text; begin
  d := pg_get_functiondef('public.job_track_base_event(uuid,timestamp with time zone,double precision,double precision,numeric)'::regprocedure);
  d := replace(d, 'but the driver has not confirmed the truck checklist and load.', 'but the dispatcher has not checked and locked the load.');
  d := replace(d, 'Left the base without a pre-departure check', 'Left the base without a load check');
  execute d;
end $$;
