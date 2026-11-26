-- HATID — change the method of an SO: pick-up ⇄ delivery (Rommel 2026-11-27)
-- Why: S80270 / S77881 / S79743 (Arch. Dennis Ching) were pick-ups the client never came for, and the agent changed them
-- to delivery. The delivery upload refused them with "Everything … was already delivered or is on a job" because the
-- open pick-up ticket still held every item — nothing had been delivered. Now:
--   pk_to_delivery   — closes the pick-up ticket ("changed to delivery") so its items can go on a delivery job.
--   pk_from_delivery — takes a delivery job that hasn't been loaded off the plan ("changed to pick-up") and, unless
--                      p_create is false (the pick-up upload makes the ticket itself), opens a pick-up ticket for it.
-- Both: dispatch (admin / manager / dispatcher) or Sales Support; a reason is required and logged on both sides.

create or replace function public.pk_to_delivery(p_order uuid, p_reason text, p_job uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare me job_staff := pk_me(); o pk_orders; r text := nullif(btrim(p_reason), ''); who text; left_lines jsonb;
begin
  if me.id is null then raise exception 'No HATID access' using errcode = '42501'; end if;
  if not (me.role in ('admin','manager','dispatcher') or coalesce(me.pickup_role, '') = 'sales_support') then
    raise exception 'Only dispatch or Sales Support can change a pick-up to delivery.' using errcode = '42501'; end if;
  select * into o from pk_orders where id = p_order for update;
  if o.id is null or not pk_sees(o.company) then raise exception 'Ticket not found.'; end if;
  if o.status = 'in_queue' then raise exception 'SO % is in the pick-up queue right now (the client is at %) — finish or cancel that queue number first.', o.so_no, pk_site_name(o.site); end if;
  if o.status = 'done' then raise exception 'SO % was already fully picked up — there is nothing left to deliver.', o.so_no; end if;
  if o.status = 'cancelled' then return jsonb_build_object('so_no', o.so_no, 'already', true); end if;
  if r is null then raise exception 'Say why it is changing to delivery (e.g. client asked for delivery).'; end if;
  who := coalesce(nullif(btrim(me.name), ''), me.email);
  select coalesce(jsonb_agg(jsonb_build_object('desc', l->>'desc', 'qty', (l->>'qty')::numeric - coalesce((l->>'taken')::numeric, 0), 'unit', l->>'unit') order by (l->>'i')::int), '[]')
    into left_lines from jsonb_array_elements(coalesce(o.lines, '[]')) l
   where (l->>'qty')::numeric > coalesce((l->>'taken')::numeric, 0);
  update pk_orders set status = 'cancelled', closed_at = now(), updated_at = now() where id = o.id;
  perform pk_log(o.id, null, 'to_delivery', 'Changed to delivery — ' || r);
  if p_job is not null then
    insert into job_events (job_id, event_type, notes, created_by, actor_name, actor_role)
    values (p_job, 'note', 'Changed from pick-up: pick-up ticket ' || o.so_no || ' (' || to_char(o.pickup_date, 'Mon FMDD') || ', ' || pk_site_name(o.site) || ') closed. Reason: ' || r, me.id, who, me.role);
  end if;
  perform pk_notify(o.site, o.company, array['sales_support','warehouse','logistics'], 'pickup_site',
    o.so_no || ' changed to delivery',
    coalesce(o.client_name || ' · ', '') || 'No longer a pick-up — '
      || case when o.prepared_at is not null then 'the warehouse already prepared it: hand the items to dispatch for loading. ' else 'don''t prepare it for pick-up. ' end
      || 'Reason: ' || r || ' (' || who || ')', o.id);
  return jsonb_build_object('so_no', o.so_no, 'company', o.company, 'client_name', o.client_name, 'salesperson', o.salesperson, 'agent_id', o.agent_id,
    'client_contact', o.client_contact, 'client_phone', o.client_phone, 'client_email', o.client_email, 'instructions', o.instructions, 'lines', left_lines);
end $function$;

create or replace function public.pk_from_delivery(p_job uuid, p_reason text, p_site text default null, p_date date default null, p_create boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare me job_staff := pk_me(); j jobs; r text := nullif(btrim(p_reason), ''); who text; so text; s delivery_schedules; pl logistics_pools;
  signers uuid[]; everyone uuid[]; dl text; v_old pk_orders; v_id uuid; v_lines jsonb; v_tot numeric; on_road boolean := false; ag text;
begin
  if me.id is null then raise exception 'No HATID access' using errcode = '42501'; end if;
  if not (me.role in ('admin','manager','dispatcher') or coalesce(me.pickup_role, '') = 'sales_support') then
    raise exception 'Only dispatch or Sales Support can change a delivery to pick-up.' using errcode = '42501'; end if;
  select * into j from jobs where id = p_job for update;
  if j.id is null or not (me.companies is null or j.company = any(me.companies)) then raise exception 'Delivery not found.'; end if;
  so := upper(coalesce((select x->>'ref' from jsonb_array_elements(coalesce(j.doc_refs, '[]')) x where coalesce(x->>'ref', '') ~* '^S\d' limit 1), j.quotation_serial));
  if j.status = 'rejected' then raise exception 'This delivery (%) is already cancelled.', so; end if;
  if j.status not in ('proposed','scheduled') then raise exception 'This delivery (%) is already %, so it can''t change to pick-up.', so,
    case j.status when 'completed' then 'delivered' when 'dispatched' then 'on the road' when 'in_progress' then 'at the site' else 'under way' end; end if;
  if j.loaded_at is not null then raise exception '% is already loaded on the truck — unload it (untick Loaded) first.', so; end if;
  if j.courier_booked_at is not null then raise exception '% is booked on Grab / Lalamove — take it off the courier first.', so; end if;
  if j.truck_id is not null and j.scheduled_date is not null then
    select exists (select 1 from job_trips t where t.truck_id = j.truck_id and t.trip_date = j.scheduled_date and t.trip_no = coalesce(j.trip_no, 1)
                    and (t.departed_at is not null or t.gps_left_at is not null or t.load_locked_at is not null)) into on_road;
    if on_road then raise exception 'The truck for % is already loaded / on the road — it can''t change to pick-up now.', so; end if;
  end if;
  if r is null then raise exception 'Say why it is changing to pick-up (e.g. client will pick up).'; end if;
  if p_create then
    if p_site is null or p_site not in ('plant1','annex') then raise exception 'Pick Plant 1 or Annex.'; end if;
    if p_date is null or p_date < pk_today() then raise exception 'Pick a pick-up date from today on.'; end if;
    if so !~* '^S\d' then raise exception 'This delivery has no SO number, so a pick-up ticket can''t be made — load the pick-up ticket in Pick-up mode.'; end if;
    if jsonb_array_length(coalesce(j.items, '[]')) = 0 then raise exception 'This delivery has no item list — load the pick-up ticket in Pick-up mode instead.'; end if;
  end if;
  who := coalesce(nullif(btrim(me.name), ''), me.email);

  update jobs set status = 'rejected', updated_at = now() where id = j.id;
  insert into job_events (job_id, event_type, notes, created_by, actor_name, actor_role)
  values (j.id, 'rejected', 'Changed to pick-up' || case when p_create then ' (' || pk_site_name(p_site) || ', ' || to_char(p_date, 'Mon FMDD') || ')' else '' end
    || ' by ' || who || '. Reason: ' || r, me.id, who, me.role);

  -- on a delivery schedule being signed / approved → back for signing (same as an address change)
  select * into s from delivery_schedules ds
   where ds.delivery_date = j.scheduled_date and ds.status in ('for_review','for_confirmation','for_approval','for_change_approval','approved')
     and exists (select 1 from jsonb_array_elements(coalesce(ds.snapshot, '[]')) x, jsonb_array_elements(x->'drops') d where d->>'job_id' = j.id::text)
   limit 1 for update;
  if s.id is not null then
    select * into pl from logistics_pools where id = s.pool_id;
    dl := to_char(s.delivery_date, 'Mon FMDD, YYYY') || ' · ' || pl.name;
    select array_agg(distinct signed_by) into signers from delivery_schedule_signoffs where schedule_id = s.id and revision = s.revision;
    select array_agg(id) into everyone from job_staff where active and (cardinality(schedule_steps) > 0 or role in ('admin','manager','dispatcher'))
       and (companies is null or companies && pl.companies);
    update delivery_schedules set status = 'returned', returned_from = s.status, approved_at = null, change_mode = false, change_request_id = null, returned_by = me.id, returned_at = now(),
           return_reason = 'Changed to pick-up — ' || so || ' ' || coalesce(j.client_name, '') || ' (' || r || '). Prepare and sign again.', updated_at = now()
     where id = s.id;
    insert into delivery_schedule_events (schedule_id, revision, action, by_user, by_name, note)
    values (s.id, s.revision, 'reject', me.id, who, 'Changed to pick-up — ' || so || '. Reason: ' || r);
    perform job_notify(coalesce(signers, '{}') || coalesce(everyone, '{}'), 'schedule_returned',
      '📦 Changed to pick-up — schedule back for signing', dl || E'\n' || so || ' ' || coalesce(j.client_name, '') || E' is now a pick-up.\nReason: ' || r
      || E'\nChanged by ' || who || '. The schedule must be prepared and signed again.', s);
  end if;
  perform job_notify_office(j.company, 'job_to_pickup', '📦 Delivery changed to pick-up — ' || so,
    coalesce(j.client_name, '') || E'\nReason: ' || r || E'\nBy ' || who, 'job', j.id, j.scheduled_date, me.id);

  if p_create then
    select * into v_old from pk_orders where upper(so_no) = so and status <> 'cancelled' limit 1 for update;
    if v_old.status = 'in_queue' then raise exception 'SO % is in the pick-up queue right now — finish that pick-up first.', so; end if;
    select sum(coalesce((x->>'qty')::numeric, 0)) into v_tot from jsonb_array_elements(j.items) x;
    -- the job's lines; ₱ per line: the earlier pick-up ticket's amount for the same item, else the order value shared by quantity
    select coalesce(jsonb_agg(jsonb_build_object('i', n - 1, 'desc', x->>'desc', 'qty', coalesce((x->>'qty')::numeric, 0) + coalesce(t.taken, 0), 'unit', x->>'unit',
             'amount', coalesce(t.amount, case when v_tot > 0 then round(coalesce(j.order_value, 0) * coalesce((x->>'qty')::numeric, 0) / v_tot, 2) else 0 end),
             'want', true, 'prep', false, 'taken', coalesce(t.taken, 0)) order by n), '[]')
      into v_lines
      from jsonb_array_elements(j.items) with ordinality e(x, n)
      left join lateral (select sum(coalesce((l->>'taken')::numeric, 0)) taken, max((l->>'amount')::numeric) amount
                           from jsonb_array_elements(coalesce(v_old.lines, '[]')) l where lower(btrim(l->>'desc')) = lower(btrim(x->>'desc'))) t on true;
    select name into ag from job_agents where id = j.agent_id;
    if v_old.id is not null then
      update pk_orders set site = p_site, kind = case when p_date > pk_today() then 'scheduled' else 'same_day' end, pickup_date = p_date,
        client_name = coalesce(j.client_name, client_name), agent_id = coalesce(j.agent_id, agent_id), salesperson = coalesce(ag, salesperson),
        on_time = true, late_allowed_at = null, late_allowed_by = null, late_allowed_name = null, lines = v_lines, status = 'open', no_show_at = null,
        prepared_at = null, prepared_name = null, ticket_created_at = now(), created_est = false,
        client_contact = coalesce(j.client_contact_name, client_contact), client_phone = coalesce(j.client_phone, client_phone), client_email = coalesce(j.client_email, client_email),
        updated_at = now()
       where id = v_old.id returning id into v_id;
    else
      insert into pk_orders (company, site, kind, so_no, ticket_no, client_name, salesperson, agent_id, pickup_date, ticket_created_at, created_est, on_time, mssi_qt,
        instructions, lines, uploaded_by, uploaded_name, client_contact, client_phone, client_email)
      values (j.company, p_site, case when p_date > pk_today() then 'scheduled' else 'same_day' end, so, j.odoo_ticket, j.client_name, ag, j.agent_id, p_date, now(), false, true,
        j.company = 'MSSI', nullif(btrim(coalesce(j.notes, '')), ''), v_lines, me.id, who, j.client_contact_name, j.client_phone, j.client_email)
      returning id into v_id;
    end if;
    perform pk_log(v_id, null, 'from_delivery', 'Changed from delivery (' || coalesce(to_char(j.scheduled_date, 'Mon FMDD'), 'no date') || ') — ' || r
      || '. Counted as on time (the change of method was arranged by staff).');
    perform pk_notify(p_site, j.company, array['sales_support','warehouse'], 'pickup_site',
      so || ' changed from delivery to pick-up',
      coalesce(j.client_name || ' · ', '') || 'Pick-up on ' || to_char(p_date, 'Dy Mon FMDD') || ' at ' || pk_site_name(p_site) || '. Warehouse: prepare it. Reason: ' || r || ' (' || who || ')', v_id);
  end if;
  return jsonb_build_object('so_no', so, 'pk_order', v_id, 'schedule_returned', s.id is not null, 'schedule_date', s.delivery_date);
end $function$;

grant execute on function public.pk_to_delivery(uuid, text, uuid) to authenticated;
grant execute on function public.pk_from_delivery(uuid, text, text, date, boolean) to authenticated;
