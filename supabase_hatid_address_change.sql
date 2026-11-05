-- HATID — change of delivery address on an existing job (Rommel 2026-11-05). Project nssviuuagtlvxjvvvagt.
-- Dispatch / manager / admin change it directly; Sales Support changes it directly while the ticket waits for dispatch
-- (status proposed), otherwise asks and dispatch approves or declines.
-- A delivery schedule in signing or approved that holds the job goes back for signing (the cost may change); the signers are told.
-- Truck already loaded / on the road: the driver gets a notice to acknowledge ("OK, got it" / "With concern"), like a drop-order change.
-- The sales agent is told; the client too if HATID already sent them a message about this delivery.

create table if not exists public.job_address_requests (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  company text,
  old_address text, old_destination_id uuid,
  new_address text not null, new_destination_id uuid,
  new_lat double precision, new_lon double precision,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','applied','declined','withdrawn')),
  requested_by uuid, requested_name text, created_at timestamptz not null default now(),
  resolved_by uuid, resolved_name text, resolved_at timestamptz, response_note text,
  schedule_returned uuid, driver_notice uuid
);
create index if not exists job_address_requests_job on public.job_address_requests(job_id, created_at desc);
create index if not exists job_address_requests_pending on public.job_address_requests(status) where status = 'pending';
alter table public.job_address_requests enable row level security;
drop policy if exists jar_read on public.job_address_requests;
create policy jar_read on public.job_address_requests for select using (
  exists (select 1 from job_staff s where s.id = auth.uid() and s.active and (s.companies is null or job_address_requests.company = any(s.companies))));
grant select on public.job_address_requests to authenticated;

alter table public.job_trip_notices drop constraint if exists job_trip_notices_kind_check;
alter table public.job_trip_notices add constraint job_trip_notices_kind_check check (kind = any (array['reorder','order_request','address']));

-- Applies one change. Called only by the two RPCs below (not granted to users).
create or replace function public.job_address_apply(p_req uuid, p_by uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r job_address_requests; j jobs; me job_staff; who text; s delivery_schedules; dl text; on_road boolean := false; nid uuid;
  old_txt text; new_txt text; so text; signers uuid[]; everyone uuid[]; pl logistics_pools; told boolean; dest_changed boolean;
begin
  select * into r from job_address_requests where id = p_req for update;
  select * into j from jobs where id = r.job_id for update;
  select * into me from job_staff where id = p_by; who := coalesce(nullif(btrim(me.name), ''), me.email);
  if j.status in ('completed','rejected') then raise exception 'This delivery is already %, so its address can''t be changed.', case j.status when 'completed' then 'delivered' else 'cancelled' end using errcode = 'P0001'; end if;
  dest_changed := r.new_destination_id is not null and r.new_destination_id is distinct from j.destination_id;
  old_txt := coalesce(nullif(btrim(j.address), ''), '(no address)');
  new_txt := r.new_address;
  so := coalesce((select string_agg(x->>'ref', ', ') from jsonb_array_elements(coalesce(j.doc_refs, '[]')) x where coalesce(x->>'ref','') <> ''), j.quotation_serial);

  -- job_set_derived recomputes zone and trip rate when the destination changes
  update jobs set address = r.new_address,
         destination_id = coalesce(r.new_destination_id, destination_id),
         site_lat = r.new_lat, site_lon = r.new_lon,
         site_source = case when r.new_lat is not null then 'pinned' end,
         site_accuracy_m = null, site_at = case when r.new_lat is not null then now() end
   where id = j.id;

  insert into job_events (job_id, event_type, notes, created_by, actor_name, actor_role)
  values (j.id, 'address_changed', 'Delivery address changed by ' || who || E':\nFrom: ' || old_txt || E'\nTo: ' || new_txt
    || case when dest_changed then E'\nDestination: ' || coalesce((select name from delivery_destinations where id = j.destination_id), '—') || ' → ' || coalesce((select name from delivery_destinations where id = r.new_destination_id), '—') else '' end
    || E'\nReason: ' || r.reason
    || case when r.requested_by is distinct from p_by then E'\nAsked by ' || coalesce(r.requested_name, 'Sales Support') else '' end,
    p_by, who, me.role);

  -- the delivery schedule holding this job goes back for signing
  select * into s from delivery_schedules ds
   where ds.delivery_date = j.scheduled_date and ds.status in ('for_review','for_confirmation','for_approval','approved')
     and exists (select 1 from jsonb_array_elements(coalesce(ds.snapshot, '[]')) x, jsonb_array_elements(x->'drops') d where d->>'job_id' = j.id::text)
   limit 1 for update;
  if s.id is not null then
    select * into pl from logistics_pools where id = s.pool_id;
    dl := to_char(s.delivery_date, 'Mon FMDD, YYYY') || ' · ' || pl.name;
    select array_agg(distinct signed_by) into signers from delivery_schedule_signoffs where schedule_id = s.id and revision = s.revision;
    select array_agg(id) into everyone from job_staff where active and (cardinality(schedule_steps) > 0 or role in ('admin','manager','dispatcher'))
       and (companies is null or companies && pl.companies);
    update delivery_schedules set status = 'returned', returned_from = s.status, approved_at = null, returned_by = p_by, returned_at = now(),
           return_reason = 'Delivery address changed — ' || so || ' ' || coalesce(j.client_name, '') || ': ' || new_txt || ' (' || r.reason || '). Prepare and sign again.', updated_at = now()
     where id = s.id;
    insert into delivery_schedule_events (schedule_id, revision, action, by_user, by_name, note)
    values (s.id, s.revision, 'reject', p_by, who, 'Address changed — ' || so || ': ' || old_txt || ' → ' || new_txt || '. Reason: ' || r.reason);
    perform job_notify(coalesce(signers, '{}') || coalesce(everyone, '{}'), 'schedule_returned',
      '📍 Address changed — schedule back for signing', dl || E'\n' || so || ' ' || coalesce(j.client_name, '') || ': ' || old_txt || ' → ' || new_txt
      || case when dest_changed then ' (new destination — the trip cost may change)' else '' end || E'\nReason: ' || r.reason || E'\nChanged by ' || who || '. The schedule must be prepared and signed again.', s);
  end if;

  -- truck already loaded / on the road: the driver must acknowledge
  if j.truck_id is not null and j.scheduled_date is not null then
    select exists (select 1 from jobs x where x.truck_id = j.truck_id and x.scheduled_date = j.scheduled_date and coalesce(x.trip_no, 1) = coalesce(j.trip_no, 1)
                     and x.status in ('dispatched','in_progress','issue','completed'))
        or exists (select 1 from job_trips t where t.truck_id = j.truck_id and t.trip_date = j.scheduled_date and t.trip_no = coalesce(j.trip_no, 1)
                     and (t.departed_at is not null or t.gps_left_at is not null or t.load_locked_at is not null))
      into on_road;
    if on_road then
      update job_trip_notices set status = 'ok', response_note = 'Replaced by a newer address change', resolved_at = now()
       where job_id = j.id and kind = 'address' and status = 'pending';
      insert into job_trip_notices (trip_date, truck_id, trip_no, kind, job_id, reason, note, created_by)
      values (j.scheduled_date, j.truck_id, coalesce(j.trip_no, 1), 'address', j.id, r.reason, new_txt, p_by) returning id into nid;
    end if;
  end if;

  -- office (everyone but the person who did it)
  perform job_notify_office(j.company, 'address_changed', '📍 Delivery address changed — ' || so,
    coalesce(j.client_name, '') || ': ' || new_txt || E'\nReason: ' || r.reason || E'\nBy ' || who
    || case when on_road then E'\nThe truck is already loaded / on the road — the driver was asked to confirm.' else '' end, 'job', j.id, j.scheduled_date, p_by);
  if r.requested_by is not null and r.requested_by is distinct from p_by then
    insert into job_notifications (user_id, kind, title, body, ref_type, ref_id, ref_date)
    values (r.requested_by, 'address_changed', '✅ Address change done — ' || so, coalesce(j.client_name, '') || ': ' || new_txt || E'\nBy ' || who, 'job', j.id, j.scheduled_date);
  end if;

  -- client (only if HATID already messaged them about this delivery) + agent
  told := exists (select 1 from job_outbox o where o.job_id = j.id and (o.to_role = 'client' or o.kind like '%\_client' escape '\'));
  perform job_msg_send(j.id, 'address', j.scheduled_date, s.id,
    case when told then 'Delivery address updated — ' || so end,
    case when told then 'Hi ' || coalesce(j.client_name, '') || ', we updated the delivery address for ' || so
      || case when j.scheduled_date is not null then ' (delivery ' || to_char(j.scheduled_date, 'Mon FMDD') || ')' else '' end
      || ' to: ' || new_txt || '. If this is not right, please contact your sales agent right away.' end,
    'Address changed — ' || so,
    '📍 Delivery address changed — ' || so || ' ' || coalesce(j.client_name, '') || E'\nNew: ' || new_txt || E'\nWas: ' || old_txt || E'\nReason: ' || r.reason
      || case when s.id is not null then E'\nThe delivery schedule goes back for signing.' else '' end);

  update job_address_requests set status = 'applied', resolved_by = p_by, resolved_name = who, resolved_at = now(),
         old_address = j.address, old_destination_id = j.destination_id, schedule_returned = s.id, driver_notice = nid
   where id = r.id;
  return jsonb_build_object('request', r.id, 'schedule_returned', s.id is not null, 'schedule_date', s.delivery_date, 'driver_notice', nid is not null, 'client_told', told);
end $$;
revoke all on function public.job_address_apply(uuid, uuid) from public, anon, authenticated;

-- Change (office, or Sales Support while the ticket waits for dispatch) or ask (Sales Support once scheduled)
create or replace function public.job_address_change(p_job uuid, p_address text, p_destination uuid default null, p_reason text default null,
  p_lat double precision default null, p_lon double precision default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare me job_staff; j jobs; who text; rid uuid; office boolean; res jsonb; so text;
begin
  select * into me from job_staff where id = auth.uid() and active;
  if me.id is null then raise exception 'No HATID access' using errcode = '42501'; end if;
  office := me.role in ('admin','manager','dispatcher');
  if not office and coalesce(me.pickup_role, '') <> 'sales_support' then raise exception 'Only dispatch or Sales Support can change a delivery address.' using errcode = '42501'; end if;
  select * into j from jobs where id = p_job;
  if j.id is null or not (me.companies is null or j.company = any(me.companies)) then raise exception 'Delivery not found.' using errcode = 'P0001'; end if;
  if j.status in ('completed','rejected') then raise exception 'This delivery is already %, so its address can''t be changed.', case j.status when 'completed' then 'delivered' else 'cancelled' end using errcode = 'P0001'; end if;
  if nullif(btrim(p_address), '') is null then raise exception 'Type the new address.' using errcode = 'P0001'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Say why the address is changing.' using errcode = 'P0001'; end if;
  if p_destination is not null and not exists (select 1 from delivery_destinations d join delivery_zones z on z.id = d.zone_id join logistics_pools p on p.id = z.pool_id
       where d.id = p_destination and j.company = any(p.companies)) then raise exception 'That destination isn''t served for %.', j.company using errcode = 'P0001'; end if;
  if btrim(p_address) = coalesce(btrim(j.address), '') and (p_destination is null or p_destination = j.destination_id) then raise exception 'That is the same address.' using errcode = 'P0001'; end if;
  who := coalesce(nullif(btrim(me.name), ''), me.email);
  so := coalesce((select string_agg(x->>'ref', ', ') from jsonb_array_elements(coalesce(j.doc_refs, '[]')) x where coalesce(x->>'ref','') <> ''), j.quotation_serial);
  -- one open request per job: a newer one replaces it
  update job_address_requests set status = 'withdrawn', response_note = 'Replaced by a newer request', resolved_at = now() where job_id = j.id and status = 'pending';
  insert into job_address_requests (job_id, company, old_address, old_destination_id, new_address, new_destination_id, new_lat, new_lon, reason, requested_by, requested_name)
  values (j.id, j.company, j.address, j.destination_id, btrim(p_address), p_destination, p_lat, p_lon, btrim(p_reason), me.id, who) returning id into rid;
  if office or j.status = 'proposed' then
    res := job_address_apply(rid, me.id);
    return res || jsonb_build_object('applied', true);
  end if;
  perform job_notify_office(j.company, 'address_request', '📍 Address change asked — ' || so,
    coalesce(j.client_name, '') || E'\nNew: ' || btrim(p_address) || E'\nReason: ' || btrim(p_reason) || E'\nAsked by ' || who || '. Approve or decline in the job details.', 'job', j.id, j.scheduled_date, me.id);
  insert into job_events (job_id, event_type, notes, created_by, actor_name, actor_role)
  values (j.id, 'address_request', 'Address change asked by ' || who || ': ' || btrim(p_address) || E'\nReason: ' || btrim(p_reason), me.id, who, me.role);
  return jsonb_build_object('applied', false, 'request', rid);
end $$;
grant execute on function public.job_address_change(uuid, text, uuid, text, double precision, double precision) to authenticated;

-- Dispatch approves (applies) or declines a Sales Support request
create or replace function public.job_address_decide(p_req uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare me job_staff; r job_address_requests; who text; so text; j jobs;
begin
  select * into me from job_staff where id = auth.uid() and active and role in ('admin','manager','dispatcher');
  if me.id is null then raise exception 'Only dispatch approves an address change.' using errcode = '42501'; end if;
  select * into r from job_address_requests where id = p_req;
  if r.id is null or not (me.companies is null or r.company = any(me.companies)) then raise exception 'Request not found.' using errcode = 'P0001'; end if;
  if r.status <> 'pending' then raise exception 'This request was already handled.' using errcode = 'P0001'; end if;
  who := coalesce(nullif(btrim(me.name), ''), me.email);
  if p_approve then
    return job_address_apply(r.id, me.id) || jsonb_build_object('applied', true);
  end if;
  if nullif(btrim(p_note), '') is null then raise exception 'Say why it is declined.' using errcode = 'P0001'; end if;
  select * into j from jobs where id = r.job_id;
  so := coalesce((select string_agg(x->>'ref', ', ') from jsonb_array_elements(coalesce(j.doc_refs, '[]')) x where coalesce(x->>'ref','') <> ''), j.quotation_serial);
  update job_address_requests set status = 'declined', resolved_by = me.id, resolved_name = who, resolved_at = now(), response_note = btrim(p_note) where id = r.id;
  insert into job_events (job_id, event_type, notes, created_by, actor_name, actor_role)
  values (r.job_id, 'address_declined', 'Address change declined by ' || who || ': ' || btrim(p_note), me.id, who, me.role);
  if r.requested_by is not null then
    insert into job_notifications (user_id, kind, title, body, ref_type, ref_id, ref_date)
    values (r.requested_by, 'address_declined', '⛔ Address change declined — ' || so, coalesce(j.client_name, '') || ': ' || btrim(p_note) || E'\nBy ' || who, 'job', r.job_id, j.scheduled_date);
  end if;
  return jsonb_build_object('applied', false, 'declined', true);
end $$;
grant execute on function public.job_address_decide(uuid, boolean, text) to authenticated;

-- The driver acknowledges an address change like a drop-order change (only change: kind 'address' joins 'reorder')
create or replace function public.job_trip_notice_resolve(p_id uuid, p_status text, p_note text DEFAULT NULL::text)
 RETURNS job_trip_notices LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare n job_trip_notices; v_role text; v_name text; nxt int; k int := 0; j record;
begin
  select role, coalesce(nullif(btrim(name), ''), email) into v_role, v_name from job_staff where id = auth.uid() and active;
  select * into n from job_trip_notices where id = p_id for update;
  if n.id is null or v_role is null or v_role = 'viewer' or not job_can_access_pool(job_truck_pool(n.truck_id), false) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if n.status <> 'pending' then return n; end if;
  if n.kind in ('reorder','address') then
    if p_status not in ('ok','concern') then raise exception 'Answer OK or With concern'; end if;
    if p_status = 'concern' and nullif(btrim(p_note), '') is null then raise exception 'Write your concern' using errcode = 'P0001'; end if;
  else
    if v_role not in ('admin','manager','dispatcher') then raise exception 'Only the base approves a change of drop order' using errcode = '42501'; end if;
    if p_status not in ('approved','declined') then raise exception 'Approve or decline'; end if;
    if p_status = 'approved' then
      perform set_config('hatid.skip_reorder', '1', true);
      select min(drop_seq) into nxt from jobs where truck_id = n.truck_id and scheduled_date = n.trip_date and coalesce(trip_no, 1) = n.trip_no
        and status in ('scheduled','dispatched','in_progress','issue');
      for j in select id from jobs where truck_id = n.truck_id and scheduled_date = n.trip_date and coalesce(trip_no, 1) = n.trip_no
                 and status in ('scheduled','dispatched','in_progress','issue')
               order by (id = n.job_id) desc, drop_seq nulls last, created_at loop
        update jobs set drop_seq = coalesce(nxt, 1) + k where id = j.id; k := k + 1;
      end loop;
      perform set_config('hatid.skip_reorder', '', true);
    end if;
  end if;
  update job_trip_notices set status = p_status, response_note = nullif(btrim(p_note), ''), resolved_by = auth.uid(), resolved_by_name = v_name, resolved_at = now()
   where id = p_id returning * into n;
  return n;
end $function$;

-- Notifications for the new 'address' notice (driver on insert, office on the driver's answer)
create or replace function public.job_trip_notice_after()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare co text; lbl text; cl text;
begin
  co := (select company from jobs where truck_id = new.truck_id and scheduled_date = new.trip_date and coalesce(trip_no, 1) = new.trip_no order by drop_seq nulls last limit 1);
  lbl := job_trip_label(new.trip_date, new.truck_id, new.trip_no);
  if tg_op = 'INSERT' then
    if new.kind = 'reorder' then
      insert into job_notifications (user_id, kind, title, body, ref_type, ref_id, ref_date)
      select d, 'trip_reorder', '🔀 Drop order changed — ' || lbl, 'Base changed the order of your remaining drops. Open HATID and tap “OK, got it”.', 'trip', new.id, new.trip_date
        from job_trip_drivers(new.trip_date, new.truck_id) d;
    elsif new.kind = 'address' then
      cl := (select coalesce(client_name, quotation_serial) from jobs where id = new.job_id);
      insert into job_notifications (user_id, kind, title, body, ref_type, ref_id, ref_date)
      select d, 'trip_address', '📍 New delivery address — ' || coalesce(cl, 'a drop'), 'Base changed the address for ' || coalesce(cl, 'one of your drops') || ' to: ' || coalesce(new.note, '') || '. Open HATID and tap “OK, got it”.', 'trip', new.id, new.trip_date
        from job_trip_drivers(new.trip_date, new.truck_id) d;
    else
      cl := (select coalesce(client_name, quotation_serial) from jobs where id = new.job_id);
      perform job_notify_office(co, 'trip_request', '↪️ Driver asks to go out of order — ' || lbl,
        coalesce(new.created_by_name, 'Driver') || ' wants to do ' || coalesce(cl, 'another drop') || ' next: ' || new.reason || coalesce(' — ' || nullif(btrim(new.note), ''), '') || '. Approve or decline in HATID.',
        'trip', new.id, new.trip_date, new.created_by);
    end if;
  elsif new.status is distinct from old.status and new.status <> 'pending' then
    if new.kind = 'reorder' then
      perform job_notify_office(co, 'trip_ack',
        case new.status when 'ok' then '👍 Driver saw the new drop order — ' else '⚠️ Driver has a concern about the new drop order — ' end || lbl,
        coalesce(new.resolved_by_name, 'Driver') || case new.status when 'ok' then ': OK, got it.' else ': ' || coalesce(new.response_note, '') end,
        'trip', new.id, new.trip_date, new.resolved_by);
    elsif new.kind = 'address' and new.resolved_by is not null then
      cl := (select coalesce(client_name, quotation_serial) from jobs where id = new.job_id);
      perform job_notify_office(co, 'trip_ack',
        case new.status when 'ok' then '👍 Driver saw the new address — ' else '⚠️ Driver has a concern about the new address — ' end || coalesce(cl, lbl),
        coalesce(new.resolved_by_name, 'Driver') || case new.status when 'ok' then ': OK, got it.' else ': ' || coalesce(new.response_note, '') end,
        'trip', new.id, new.trip_date, new.resolved_by);
    elsif new.status in ('approved','declined') and old.status = 'pending' and coalesce(new.response_note, '') <> 'Replaced by a newer request' then
      insert into job_notifications (user_id, kind, title, body, ref_type, ref_id, ref_date)
      values (new.created_by, 'trip_request_' || new.status,
        case new.status when 'approved' then '✅ Base approved — go to ' else '⛔ Base declined — keep the order. Request: ' end
          || coalesce((select coalesce(client_name, quotation_serial) from jobs where id = new.job_id), 'that drop'),
        coalesce(new.resolved_by_name, 'Base') || coalesce(': ' || nullif(btrim(new.response_note), ''), ''), 'trip', new.id, new.trip_date);
    end if;
  end if;
  return new;
end $function$;

-- Messages: the outbox only accepts known kinds (added after the first test, migration hatid_address_change_outbox_kind)
alter table public.job_outbox drop constraint job_outbox_kind_check;
alter table public.job_outbox add constraint job_outbox_kind_check check (kind = any (array['delivered','partial','returned','issue','delay','daily','daily_auto','daily_followup','sched_client','sched_agent','manual','truck_check','load_concern','quality','trip_done','trip_notice','photo','pickup_noshow','pickup_concern','pickup_photo','prep_client','prep_agent','onway_client','onway_agent','prep_request','pkready_client','pkready_agent','pkdone_client','pkdone_agent','pkmissed_client','pkmissed_agent','address_client','address_agent']));
