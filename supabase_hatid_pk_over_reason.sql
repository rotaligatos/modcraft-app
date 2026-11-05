-- HATID pick-up: reason for going over the target time (Rommel 2026-11-05)
-- Logistics must give a reason when a counted pick-up is released past the target,
-- so the reasons can be added up in the Promptness report.
-- The reason rides inside p_taken as "_over" = {reason, note} so pk_step keeps its signature.

alter table pk_visits add column if not exists over_reason text;
alter table pk_visits add column if not exists over_note text;
alter table pk_visits add column if not exists over_reason_name text;
alter table pk_visits add column if not exists over_reason_at timestamptz;

create or replace function pk_over_reason_ok(p text) returns boolean language sql immutable as $$
  select p in ('or_si','or_prep','or_stock','or_quality','or_queue','or_equipment','or_client','or_load','or_system','or_other')
$$;

create or replace function public.pk_step(p_visit uuid, p_step text, p_photos text[] DEFAULT NULL::text[], p_taken jsonb DEFAULT NULL::jsonb)
 RETURNS pk_visits
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me job_staff := pk_me(); v pk_visits; vo record; o pk_orders; v_lines jsonb; v_sales numeric; v_t pk_settings; v_min numeric; v_left boolean;
  v_folder text; i int; ns record; v_in jsonb; v_tk jsonb; v_or text; v_on text; v_tgt numeric;
begin
  select * into v from pk_visits where id = p_visit for update;
  if v.id is null or not pk_sees(v.company) then raise exception 'Queue number not found.'; end if;
  if v.status in ('done','cancelled') then raise exception '% is already %.', v.label, case when v.status = 'done' then 'released' else 'cancelled' end; end if;
  if p_step = 'notify' then
    if not pk_can(array['sales_support']) then raise exception 'Only Sales Support can notify the warehouse.'; end if;
    if exists (select 1 from pk_visit_orders where visit_id = v.id and si_no is null) then raise exception 'Enter the SI number for every SO first.'; end if;
    update pk_visits set status = 'notified', notified_at = coalesce(notified_at, now()), notified_name = coalesce(me.name, me.email) where id = v.id returning * into v;
    perform pk_notify(v.site, v.company, array['warehouse'], 'pickup_si', v.label || ' — SI forwarded',
      (select string_agg(o2.so_no || ' SI ' || vo2.si_no, ' · ') from pk_visit_orders vo2 join pk_orders o2 on o2.id = vo2.order_id where vo2.visit_id = v.id)
        || coalesce(' · ' || v.client_name, ''), v.id);
  elsif p_step = 'accept' then
    if not pk_can(array['warehouse']) then raise exception 'Only the warehouse can accept the SI.'; end if;
    if v.notified_at is null then raise exception 'Sales Support hasn''t sent the SI yet.'; end if;
    update pk_visits set status = 'accepted', accepted_at = coalesce(accepted_at, now()), accepted_name = coalesce(me.name, me.email) where id = v.id returning * into v;
  elsif p_step = 'ready' then
    if not pk_can(array['warehouse']) then raise exception 'Only the warehouse can mark the order ready.'; end if;
    if v.accepted_at is null then raise exception 'Accept the SI first.'; end if;
    update pk_visits set status = 'ready', ready_at = coalesce(ready_at, now()), ready_name = coalesce(me.name, me.email) where id = v.id returning * into v;
    perform pk_notify(v.site, v.company, array['logistics'], 'pickup_ready', v.label || ' is ready for loading', v.client_name, v.id);
  elsif p_step = 'loaded' then
    if not pk_can(array['logistics']) then raise exception 'Only Logistics can release the items.'; end if;
    if v.ready_at is null then raise exception 'The warehouse hasn''t marked it ready yet.'; end if;
    if coalesce(array_length(p_photos, 1), 0) not between 3 and 5 then raise exception 'Take 3 to 5 photos of the loaded items.'; end if;
    select * into v_t from pk_settings where company = v.company;
    v_tgt := coalesce(v_t.target_min, 15);
    v_min := round(extract(epoch from now() - v.arrived_at) / 60.0, 1);
    v_or := nullif(btrim(coalesce(p_taken #>> '{_over,reason}', '')), '');
    v_on := nullif(btrim(coalesce(p_taken #>> '{_over,note}', '')), '');
    if v.counted and not coalesce(v.is_balance, false) and round(v_min / greatest(v.so_count, 1), 1) > v_tgt then
      if v_or is null or not pk_over_reason_ok(v_or) then raise exception 'Pick the reason it went over the % min target.', v_tgt; end if;
      if v_or = 'or_other' and v_on is null then raise exception 'Say what the other reason is.'; end if;
    elsif v_or is not null and not pk_over_reason_ok(v_or) then v_or := null;
    end if;
    select * into ns from job_notify_settings where id;
    for vo in select * from pk_visit_orders where visit_id = v.id loop
      select * into o from pk_orders where id = vo.order_id for update;
      v_in := p_taken -> o.id::text;
      select jsonb_agg(jsonb_set(l - 'plan', '{taken}', to_jsonb((l->>'taken')::numeric + x.q)) order by (l->>'i')::int),
             sum(x.q * case when (l->>'qty')::numeric > 0 then (l->>'amount')::numeric / (l->>'qty')::numeric else 0 end),
             jsonb_agg(jsonb_build_object('i', (l->>'i')::int, 'qty', x.q)) filter (where x.q > 0)
        into v_lines, v_sales, v_tk
        from jsonb_array_elements(o.lines) l
        cross join lateral (select greatest(0, least((l->>'qty')::numeric - (l->>'taken')::numeric,
              case when v_in is not null then coalesce((v_in->>(l->>'i'))::numeric, 0)
                   when (l->>'want')::boolean then coalesce(nullif(l->>'plan', '')::numeric, (l->>'qty')::numeric - (l->>'taken')::numeric) else 0 end)) as q) x;
      select bool_or((l->>'qty')::numeric > (l->>'taken')::numeric) into v_left from jsonb_array_elements(v_lines) l;
      update pk_orders set lines = coalesce(v_lines, lines), status = case when coalesce(v_left, false) then 'balance' else 'done' end,
             closed_at = case when coalesce(v_left, false) then null else now() end, updated_at = now()
       where id = o.id;
      update pk_visit_orders set taken = coalesce(v_tk, '[]'), sales = round(coalesce(v_sales, 0), 2) where visit_id = v.id and order_id = o.id;
      if coalesce(v_left, false) then perform pk_log(o.id, v.id, 'balance', 'Items left for a later pick-up'); end if;
    end loop;
    update pk_visits set status = 'done', loaded_at = now(), loaded_by = auth.uid(), loaded_name = coalesce(me.name, me.email), photo_urls = p_photos,
           minutes = v_min, per_so = round(v_min / greatest(so_count, 1), 1), target_min = v_tgt,
           within = round(v_min / greatest(so_count, 1), 1) <= v_tgt,
           over_reason = case when v_or is not null then v_or end, over_note = case when v_or is not null then v_on end,
           over_reason_name = case when v_or is not null then coalesce(me.name, me.email) end, over_reason_at = case when v_or is not null then now() end
     where id = v.id returning * into v;
    if v_or is not null then perform pk_log(null, v.id, 'over_reason', v_or || coalesce(' — ' || v_on, '')); end if;
    perform pk_msg_done(vo2.order_id, v.id) from pk_visit_orders vo2 where vo2.visit_id = v.id;
    v_folder := 'HATID Pick-ups/' || v.company || '/' || v.queue_day || '/' || v.label || ' – ' || coalesce(regexp_replace(nullif(btrim(v.client_name), ''), '[/\\:*?"<>|]', '-', 'g'), 'client');
    for i in 1 .. array_length(p_photos, 1) loop
      insert into job_outbox (company, ref_date, kind, channel, recipient, recipient_label, subject, body, status, last_error)
      values (v.company, v.queue_day, 'pickup_photo', 'drive', v_folder || '/' || to_char(now() at time zone 'Asia/Manila', 'HH24MI') || '-loaded-' || i || '.jpg',
              'Google Drive', v_folder, p_photos[i],
              case when coalesce(ns.drive_enabled, false) then 'pending' else 'skipped' end,
              case when coalesce(ns.drive_enabled, false) then null else 'Saving photos to Google Drive is not set up yet' end);
    end loop;
    if coalesce(ns.drive_enabled, false) then perform job_outbox_kick(); end if;
  else
    raise exception 'unknown step %', p_step;
  end if;
  perform pk_log(null, v.id, p_step, null);
  return v;
end $function$;

-- Add or correct the reason later (released pick-ups that went over target)
create or replace function public.pk_over_reason(p_visit uuid, p_reason text, p_note text default null)
 returns pk_visits language plpgsql security definer set search_path to 'public' as $$
declare me job_staff := pk_me(); v pk_visits; v_on text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v from pk_visits where id = p_visit for update;
  if v.id is null or not pk_sees(v.company) then raise exception 'Queue number not found.'; end if;
  if not pk_can(array['logistics']) then raise exception 'Only Logistics can give the reason.'; end if;
  if v.status <> 'done' or coalesce(v.within, true) then raise exception '% did not go over the target.', v.label; end if;
  if not pk_over_reason_ok(p_reason) then raise exception 'Pick a reason from the list.'; end if;
  if p_reason = 'or_other' and v_on is null then raise exception 'Say what the other reason is.'; end if;
  update pk_visits set over_reason = p_reason, over_note = v_on, over_reason_name = coalesce(me.name, me.email), over_reason_at = now()
   where id = v.id returning * into v;
  perform pk_log(null, v.id, 'over_reason', p_reason || coalesce(' — ' || v_on, ''));
  return v;
end $$;
revoke all on function public.pk_over_reason(uuid, text, text) from public, anon;
grant execute on function public.pk_over_reason(uuid, text, text) to authenticated;
