-- HATID: a revision of an approved schedule stays off the jobs (dispatch/trucks) until approved; the manager chooses apply now or by the scheduler (2026-11-25). Applied.
alter table delivery_schedules
  add column if not exists plan jsonb,
  add column if not exists plan_apply text check (plan_apply in ('now','scheduler')),
  add column if not exists plan_approved_at timestamptz,
  add column if not exists plan_applied_at timestamptz,
  add column if not exists plan_applied_by uuid,
  add column if not exists plan_skipped jsonb;
comment on column delivery_schedules.plan is 'Revision draft: { job_id: {t: truck_id|null, n: trip_no, s: drop_seq} } for the jobs the revision changes. Jobs stay untouched (dispatch and trucks keep the approved plan) until it is applied. Null when no revision is open or waiting to be applied.';

-- The schedule as the revision would make it: jobs with the open revision's changes laid over them
create or replace function public.job_schedule_snapshot(p_pool uuid, p_date date)
 returns jsonb language sql stable security definer set search_path to 'public' as $function$
  with pl as (
    select plan from delivery_schedules where pool_id = p_pool and delivery_date = p_date and plan is not null
  ), base as (
    select j0.*, (select plan from pl) -> (j0.id::text) as pe from jobs j0
     where j0.scheduled_date = p_date and j0.status in ('proposed','scheduled','dispatched','in_progress','completed','issue')
  ), eff as (
    select b.*, case when b.pe is null then b.truck_id else nullif(b.pe->>'t', '')::uuid end as etruck,
           case when b.pe is null then b.trip_no else coalesce((b.pe->>'n')::int, 1) end as etrip,
           case when b.pe is null then b.drop_seq else (b.pe->>'s')::int end as eseq
      from base b where b.status <> 'proposed' or b.pe is not null
  ), j as (
    select j.*, t.label, t.plate_no, t.wheels, coalesce(t.rated_capacity_kg, t.max_weight_kg) as cap,
           coalesce(c.driver, t.default_driver) as driver, coalesce(c.helper, t.default_helper) as helper,
           coalesce(c.contact_no, t.contact_no) as contact, d.name as dest_name, d.km_from_plant as km, ag.name as agent_name
    from eff j join trucks t on t.id = j.etruck
    left join truck_crews c on c.truck_id = t.id and c.work_date = p_date
    left join delivery_destinations d on d.id = j.destination_id
    left join job_agents ag on ag.id = j.agent_id
    where t.pool_id = p_pool
      and (auth.role() = 'service_role' or job_can_access_pool(p_pool, false))
  ), sec as (
    select etruck as truck_id, coalesce(etrip, 1) as trip_no, min(label) as label, min(plate_no) as plate_no, min(wheels) as wheels, min(cap) as capacity,
           min(driver) as driver, min(helper) as helper, min(contact) as contact_no, sum(coalesce(estimated_weight_kg, 0)) as total_weight,
           jsonb_agg(jsonb_build_object('job_id', id, 'serial', quotation_serial, 'company', company, 'customer', client_name,
                     'address', coalesce(nullif(address, ''), dest_name), 'job_type', job_type, 'doc_refs', doc_refs, 'weight', estimated_weight_kg,
                     'agent_id', agent_id, 'agent', agent_name, 'drop_key', job_drop_key(id, client_name, address, drop_split))
                     order by coalesce(eseq, 999), km nulls last, created_at, id) as drops
    from j group by etruck, coalesce(etrip, 1)
  ), trucks_out as (
    select coalesce(jsonb_agg(jsonb_build_object('truck_id', truck_id, 'trip_no', trip_no, 'label', label, 'plate_no', plate_no, 'wheels', wheels,
           'capacity', capacity, 'driver', driver, 'helper', helper, 'contact_no', contact_no, 'total_weight', total_weight,
           'coded', coalesce(job_is_coded(truck_id, p_date), false), 'drops', drops) order by label, trip_no), '[]'::jsonb) v
    from sec
  ), courier_out as (
    select coalesce(jsonb_agg(jsonb_build_object('truck_id', null, 'courier', true, 'trip_no', 1,
           'label', case cv.service when 'grab' then 'Grab ' else 'Lalamove ' end || cv.name, 'service', cv.service, 'plate_no', j.courier_ref,
           'booking', j.courier_ref, 'track', j.courier_track_url, 'paid_by', j.courier_paid_by, 'capacity', cv.max_kg,
           'total_weight', coalesce(j.estimated_weight_kg, 0), 'coded', false,
           'drops', jsonb_build_array(jsonb_build_object('job_id', j.id, 'serial', j.quotation_serial, 'company', j.company, 'customer', j.client_name,
                     'address', coalesce(nullif(j.address, ''), d.name), 'job_type', j.job_type, 'doc_refs', j.doc_refs, 'weight', j.estimated_weight_kg,
                     'agent_id', j.agent_id, 'agent', ag.name)))
           order by cv.service, cv.sort_order, j.courier_booked_at, j.id), '[]'::jsonb) v
    from jobs j join job_courier_vehicles cv on cv.id = j.courier_vehicle_id
    join logistics_pools lp on lp.id = p_pool
    left join delivery_destinations d on d.id = j.destination_id
    left join job_agents ag on ag.id = j.agent_id
    where j.truck_id is null and j.scheduled_date = p_date and j.company = any(lp.companies)
      and job_pool_of(null, j.company) = p_pool
      and (auth.role() = 'service_role' or job_can_access_pool(p_pool, false))
      and j.status in ('scheduled','dispatched','in_progress','completed','issue')
  )
  select (select v from trucks_out) || (select v from courier_out);
$function$;

-- While a revision is open or waiting to be applied, the jobs on that date stay as approved
create or replace function public.job_plan_guard() returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare po uuid; pn uuid; pname text;
begin
  if coalesce(current_setting('hatid.plan_apply', true), '') = '1' then return new; end if;
  if new.truck_id is not distinct from old.truck_id and new.trip_no is not distinct from old.trip_no
     and new.scheduled_date is not distinct from old.scheduled_date
     and (new.drop_seq is not distinct from old.drop_seq or old.status <> 'scheduled') then return new; end if;
  select pool_id into po from trucks where id = old.truck_id;
  select pool_id into pn from trucks where id = new.truck_id;
  select p.name into pname from delivery_schedules s join logistics_pools p on p.id = s.pool_id
   where s.plan is not null and ((s.pool_id = po and s.delivery_date = old.scheduled_date) or (s.pool_id = pn and s.delivery_date = new.scheduled_date)) limit 1;
  if pname is not null then
    raise exception 'The delivery schedule for % has a revision open, so trucks, trips and drop order on that date are changed in the revision (Day planner) and reach the trucks once it is approved.', pname
      using errcode = 'P0001';
  end if;
  return new;
end $function$;
create or replace trigger jobs_plan_guard before update of truck_id, trip_no, scheduled_date, drop_seq on jobs for each row execute function job_plan_guard();

-- Save the revision draft (replaces the whole draft)
create or replace function public.job_schedule_plan_save(p_pool uuid, p_date date, p_plan jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare me job_staff; s delivery_schedules; pl logistics_pools; k text; v jsonb; jc text;
begin
  select * into me from job_staff where id = auth.uid() and active;
  if me.id is null or me.role not in ('admin','manager','dispatcher') then raise exception 'Only dispatchers, managers and admins can edit a revision'; end if;
  if not job_can_access_pool(p_pool, false) then raise exception 'You can''t access this pool'; end if;
  select * into pl from logistics_pools where id = p_pool;
  if me.companies is not null and not (pl.companies <@ me.companies) then raise exception 'This pool serves %, so its revision is edited by staff covering all those companies', array_to_string(pl.companies, ' and '); end if;
  select * into s from delivery_schedules where pool_id = p_pool and delivery_date = p_date for update;
  if s.id is null or s.status <> 'returned' or s.in_force is null or s.plan is null then
    raise exception 'This schedule has no revision being edited — press Revise schedule first' using errcode = 'P0001'; end if;
  if jsonb_typeof(coalesce(p_plan, '{}'::jsonb)) <> 'object' then raise exception 'Bad revision data'; end if;
  for k, v in select * from jsonb_each(coalesce(p_plan, '{}'::jsonb)) loop
    select company into jc from jobs where id = k::uuid;
    if jc is null or not (jc = any(pl.companies)) then raise exception 'A drop in the revision isn''t one of this pool''s jobs'; end if;
    if nullif(v->>'t', '') is not null and not exists (select 1 from trucks where id = (v->>'t')::uuid and pool_id = p_pool) then
      raise exception 'A drop in the revision is on a truck outside this pool'; end if;
  end loop;
  update delivery_schedules set plan = coalesce(p_plan, '{}'::jsonb), updated_at = now() where id = s.id;
  return jsonb_build_object('changes', (select count(*) from jsonb_object_keys(coalesce(p_plan, '{}'::jsonb))));
end $function$;

-- Put an approved revision on the jobs (dispatch and trucks see it from now on)
create or replace function public.job_plan_apply_internal(p_sched uuid, p_by uuid, p_who text)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare s delivery_schedules; k text; v jsonb; j jobs; nt uuid; done int := 0; skipped jsonb := '[]'; tl text; rl text;
begin
  select * into s from delivery_schedules where id = p_sched for update;
  select role into rl from job_staff where id = p_by;
  perform set_config('hatid.plan_apply', '1', true);
  for k, v in select * from jsonb_each(coalesce(s.plan, '{}'::jsonb)) loop
    select * into j from jobs where id = k::uuid for update;
    if j.id is null then skipped := skipped || jsonb_build_object('job_id', k, 'reason', 'not found'); continue; end if;
    if j.status not in ('proposed','scheduled') then
      skipped := skipped || jsonb_build_object('job_id', k, 'serial', j.quotation_serial, 'reason', 'already ' || j.status); continue; end if;
    nt := nullif(v->>'t', '')::uuid;
    if nt is null then
      update jobs set truck_id = null, trip_no = null, drop_seq = null, status = 'proposed' where id = j.id;
      insert into job_events (job_id, event_type, notes, created_by, actor_name, actor_role)
      values (j.id, 'rescheduled', 'Taken off its trip — for scheduling again (approved schedule revision, applied by ' || p_who || ')', p_by, p_who, rl);
    else
      update jobs set truck_id = nt, trip_no = coalesce((v->>'n')::int, 1), drop_seq = (v->>'s')::int, status = 'scheduled', scheduled_date = s.delivery_date where id = j.id;
      select label into tl from trucks where id = nt;
      insert into job_events (job_id, event_type, notes, created_by, actor_name, actor_role)
      values (j.id, 'rescheduled', 'On ' || coalesce(tl, 'truck') || ', trip ' || coalesce((v->>'n')::int, 1) || coalesce(', drop ' || (v->>'s'), '')
              || ' (approved schedule revision, applied by ' || p_who || ')', p_by, p_who, rl);
    end if;
    done := done + 1;
  end loop;
  perform set_config('hatid.plan_apply', '', true);
  update delivery_schedules set plan = null, plan_applied_at = now(), plan_applied_by = p_by, plan_skipped = skipped where id = s.id;
  return jsonb_build_object('applied', done, 'skipped', skipped);
end $function$;
revoke all on function public.job_plan_apply_internal(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.job_schedule_apply(p_pool uuid, p_date date)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare me job_staff; s delivery_schedules; pl logistics_pools; r jsonb; who text; everyone uuid[]; dlabel text;
begin
  select * into me from job_staff where id = auth.uid() and active;
  if me.id is null or me.role not in ('admin','manager','dispatcher') then raise exception 'Only dispatchers, managers and admins can apply a revision'; end if;
  if not job_can_access_pool(p_pool, false) then raise exception 'You can''t access this pool'; end if;
  select * into pl from logistics_pools where id = p_pool;
  if me.companies is not null and not (pl.companies <@ me.companies) then raise exception 'This pool serves %, so its revision is applied by staff covering all those companies', array_to_string(pl.companies, ' and '); end if;
  select * into s from delivery_schedules where pool_id = p_pool and delivery_date = p_date for update;
  if s.id is null or s.status <> 'approved' or s.plan is null then raise exception 'There is no approved revision waiting to be applied' using errcode = 'P0001'; end if;
  who := coalesce(me.name, me.email);
  r := job_plan_apply_internal(s.id, me.id, who);
  insert into delivery_schedule_events (schedule_id, revision, action, by_user, by_name, note)
  values (s.id, s.revision, 'apply', me.id, who, (r->>'applied') || ' change(s) applied to the trucks'
          || case when jsonb_array_length(r->'skipped') > 0 then '; ' || jsonb_array_length(r->'skipped') || ' skipped' else '' end);
  select * into s from delivery_schedules where id = s.id;
  select array_agg(id) into everyone from job_staff where active and (companies is null or companies && pl.companies);
  dlabel := to_char(p_date, 'Mon FMDD, YYYY') || ' · ' || pl.name;
  perform job_notify(everyone, 'schedule_approved', 'Revised delivery schedule applied to the trucks', dlabel || ' — revision ' || s.revision || ' applied by ' || who
    || '. Dispatch and the drivers now see it.', s);
  return r;
end $function$;

-- The scheduler is reminded (email + bell) until an approved revision is applied
create or replace function public.job_approval_still_waiting(n job_notifications) returns boolean language sql stable security definer set search_path to 'public' as $function$
  select case n.kind
    when 'schedule_action' then exists (select 1 from delivery_schedules s where s.id = n.ref_id and (s.status in ('for_review','for_confirmation','for_approval') or s.change_mode)
                                          and s.delivery_date >= (now() at time zone 'Asia/Manila')::date)
      and not exists (select 1 from job_notifications x where x.ref_type = 'schedule' and x.ref_id = n.ref_id and x.created_at > n.created_at and x.kind <> 'plan_apply')
    when 'plan_apply' then exists (select 1 from delivery_schedules s where s.id = n.ref_id and s.status = 'approved' and s.plan is not null
                                     and s.delivery_date >= (now() at time zone 'Asia/Manila')::date)
    when 'prep_request' then exists (select 1 from jobs j where j.id = n.ref_id and j.prep_req_at is not null and j.prep_waived_at is null)
    when 'undo_request' then exists (select 1 from ticket_undo_requests r where r.id = n.ref_id and r.status = 'pending' and (r.assigned_to is null or r.assigned_to = n.user_id))
    else false end
$function$;
create or replace trigger job_notif_approval_fanout after insert on job_notifications for each row
  when (new.kind = any (array['schedule_action','prep_request','undo_request','plan_apply'])) execute function job_notif_approval_fanout();

-- job_schedule_action gains p_apply; revise/cancel/reject handle the plan (applied via DO block)
do $do$
declare d text := pg_get_functiondef('job_schedule_action(uuid,date,text,text,text,text)'::regprocedure);
  pairs text[][] := array[
    array[$a$p_passcode text DEFAULT NULL::text)$a$,
          $b$p_passcode text DEFAULT NULL::text, p_apply text DEFAULT NULL::text)$b$],
    array[$a$who text; dlabel text; onb text; rq delivery_schedule_change_requests;$a$,
          $b$who text; dlabel text; onb text; rq delivery_schedule_change_requests; held boolean := false;$b$],
    array[$a$    if p_signature is null then raise exception 'Sign before continuing'; end if;
    insert into delivery_schedule_signoffs (schedule_id, revision, step, signed_by, signer_name, signer_title, signature_url)
    values (s.id, s.revision, p_action, me.id, who, me.title, p_signature);
    update delivery_schedules set status = case p_action when 'review' then 'for_confirmation' when 'confirm' then 'for_approval' else 'approved' end,
           approved_at = case when p_action = 'approve' then now() end,
           in_force = case when p_action = 'approve' then null else in_force end, updated_at = now()
     where id = s.id returning * into s;$a$,
          $b$    if p_signature is null then raise exception 'Sign before continuing'; end if;
    if p_action = 'approve' and s.plan is not null then
      if coalesce(p_apply, '') not in ('now','scheduler') then raise exception 'Choose whether the revision goes to the trucks now or the scheduler applies it' using errcode = 'P0001'; end if;
      held := p_apply = 'scheduler';
    end if;
    insert into delivery_schedule_signoffs (schedule_id, revision, step, signed_by, signer_name, signer_title, signature_url)
    values (s.id, s.revision, p_action, me.id, who, me.title, p_signature);
    update delivery_schedules set status = case p_action when 'review' then 'for_confirmation' when 'confirm' then 'for_approval' else 'approved' end,
           approved_at = case when p_action = 'approve' then now() end,
           plan_apply = case when p_action = 'approve' and plan is not null then p_apply else plan_apply end,
           plan_approved_at = case when p_action = 'approve' and plan is not null then now() else plan_approved_at end,
           in_force = case when p_action = 'approve' and not held then null else in_force end, updated_at = now()
     where id = s.id returning * into s;
    if p_action = 'approve' and s.plan is not null and not held then
      perform job_plan_apply_internal(s.id, me.id, who);
      select * into s from delivery_schedules where id = s.id;
    end if;$b$],
    array[$a$      if s.id is null or s.status <> 'approved' then raise exception 'Only an approved schedule can be revised'; end if;$a$,
          $b$      if s.id is null or s.status <> 'approved' then raise exception 'Only an approved schedule can be revised'; end if;
      if s.plan is not null then raise exception 'The approved revision hasn''t been applied to the trucks yet — apply it first, then revise again' using errcode = 'P0001'; end if;$b$],
    array[$a$      if s.id is null or s.status <> 'approved' then raise exception 'Only an approved schedule can be reopened'; end if;$a$,
          $b$      if s.id is null or s.status <> 'approved' then raise exception 'Only an approved schedule can be reopened'; end if;
      if s.plan is not null then raise exception 'The approved revision hasn''t been applied to the trucks yet — apply it first' using errcode = 'P0001'; end if;$b$],
    array[$a$'final_copy_path', s.final_copy_path, 'final_copy_at', s.final_copy_at)
       where id = s.id;$a$,
          $b$'final_copy_path', s.final_copy_path, 'final_copy_at', s.final_copy_at),
             plan = '{}'::jsonb, plan_apply = null, plan_approved_at = null, plan_skipped = null
       where id = s.id;$b$],
    array[$a$      if me.role not in ('admin','manager','dispatcher') then raise exception 'Only dispatchers, managers and admins can cancel a revision'; end if;$a$,
          $b$      if me.role not in ('admin','manager','dispatcher') then raise exception 'Only dispatchers, managers and admins can cancel a revision'; end if;
      if s.status = 'approved' then raise exception 'This revision is already approved — apply it to the trucks' using errcode = 'P0001'; end if;$b$],
    array[$a$           in_force = null, updated_at = now()
     where id = s.id returning * into s;
    perform job_notify(everyone, 'schedule_approved', case p_action$a$,
          $b$           in_force = null, plan = null, plan_apply = null, plan_approved_at = null, updated_at = now()
     where id = s.id returning * into s;
    perform job_notify(everyone, 'schedule_approved', case p_action$b$],
    array[$a$case when s.revision > 1 then ' (revision ' || s.revision || ' now in force)' else '' end, s);$a$,
          $b$case when held then ' (revision ' || s.revision || ' — reaches dispatch and the trucks when the scheduler applies it)' when s.revision > 1 then ' (revision ' || s.revision || ' now in force)' else '' end, s);
    if held and s.submitted_by is not null then
      perform job_notify(array[s.submitted_by], 'plan_apply', 'Apply the approved revision to the trucks',
        dlabel || ' — revision ' || s.revision || ' approved by ' || who || '. Dispatch and the drivers see it only after you press "Apply to trucks".', s);
    end if;$b$]
  ];
  i int;
begin
  for i in 1 .. array_length(pairs, 1) loop
    if strpos(d, pairs[i][1]) = 0 then raise exception 'anchor % missing', i; end if;
    if strpos(substr(d, strpos(d, pairs[i][1]) + 1), pairs[i][1]) > 0 then raise exception 'anchor % not unique', i; end if;
    d := replace(d, pairs[i][1], pairs[i][2]);
  end loop;
  execute 'drop function public.job_schedule_action(uuid,date,text,text,text,text)';
  execute d;
end $do$;

create or replace function public.job_sched_of(p_job uuid) returns uuid language sql stable security definer set search_path to 'public' as $function$
  select ds.id from delivery_schedules ds, jsonb_array_elements(coalesce(ds.in_force->'snapshot', case when ds.status = 'approved' then ds.snapshot end, '[]')) x, jsonb_array_elements(x->'drops') d
   where (ds.status = 'approved' or ds.in_force is not null) and d->>'job_id' = p_job::text order by ds.updated_at desc limit 1;
$function$;

do $do$ declare d text := pg_get_functiondef('job_plan_apply_internal(uuid,uuid,text)'::regprocedure);
  a text := $a$update delivery_schedules set plan = null, plan_applied_at = now()$a$;
begin
  if strpos(d, a) = 0 then raise exception 'anchor missing'; end if;
  execute replace(d, a, $b$update delivery_schedules set plan = null, in_force = null, plan_applied_at = now()$b$);
end $do$;
