-- HATID pick-up: the courier (Grab, Lalamove, ...) cancelled the booking (Rommel 2026-11-05).
-- The queue number is cancelled (it never counts in promptness), the SOs go back to the expected list marked
-- "rider cancelled", and the clock starts again from zero when the new rider arrives and gets a new number.
-- The new number keeps the SI numbers already entered, and the warehouse's prepared ticks stay on the lines.

alter table public.pk_orders add column if not exists rider_cancelled jsonb;

create or replace function public.pk_rider_cancelled(p_visit uuid, p_reason text)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v pk_visits; me job_staff := pk_me(); r text := nullif(btrim(p_reason), '');
begin
  if not pk_can(array['sales_support','logistics']) then raise exception 'Only Sales Support or Logistics can record a cancelled courier.'; end if;
  select * into v from pk_visits where id = p_visit for update;
  if v.id is null or not pk_sees(v.company) then raise exception 'Queue number not found.'; end if;
  if not v.courier then raise exception 'This number is not for a courier rider.'; end if;
  if v.status in ('done','cancelled') then raise exception '% is already %.', v.label, case v.status when 'done' then 'released' else 'cancelled' end; end if;
  if r is null then raise exception 'Say why the courier cancelled (e.g. the item did not fit the vehicle).'; end if;
  update pk_visits set status = 'cancelled' where id = v.id;
  update pk_orders o set status = case when exists (select 1 from jsonb_array_elements(o.lines) l where (l->>'taken')::numeric > 0) then 'balance' else 'open' end,
      rider_cancelled = jsonb_build_object('at', now(), 'by', coalesce(me.name, me.email), 'reason', r, 'label', v.label,
        'service', v.rider_service, 'other', v.rider_service_other, 'rider', pk_rider_text(v.rider_service, v.rider_service_other, v.rider_name, v.rider_vehicle, v.rider_plate)),
      updated_at = now()
   where id in (select order_id from pk_visit_orders where visit_id = v.id);
  perform pk_log(null, v.id, 'courier_cancelled', concat_ws(' — ', nullif(pk_rider_text(v.rider_service, v.rider_service_other, v.rider_name, v.rider_vehicle, v.rider_plate), ''), r)
    || '. Number cancelled; the clock restarts when the new rider arrives.');
end $function$;

revoke all on function public.pk_rider_cancelled(uuid, text) from public, anon;
grant execute on function public.pk_rider_cancelled(uuid, text) to authenticated;

-- pk_arrive: unchanged, plus (1) SI numbers carried over from a courier-cancelled number, (2) the
-- "rider cancelled" mark cleared once the SOs are in the queue again.
create or replace function public.pk_arrive(p_orders uuid[], p_courier boolean default false, p_client text default null)
 returns pk_visits language plpgsql security definer set search_path to 'public' as $function$
declare me job_staff := pk_me(); v pk_visits; o record; v_site text; v_co text; v_mssi boolean; v_n int; v_series text; v_day date := pk_today();
  v_bal boolean; v_cnt boolean; v_walk boolean; v_client text;
begin
  if not pk_can(array['sales_support']) then raise exception 'Only Sales Support can log a client''s arrival.'; end if;
  if coalesce(array_length(p_orders, 1), 0) = 0 then raise exception 'Pick the SO(s) the client came for.'; end if;
  if (select count(*) from pk_orders where id = any(p_orders)) <> array_length(p_orders, 1) then raise exception 'Ticket not found.'; end if;
  for o in select * from pk_orders where id = any(p_orders) for update loop
    if not pk_sees(o.company) then raise exception 'Ticket not found.'; end if;
    if o.status not in ('open','balance') then raise exception 'SO % is %.', o.so_no, replace(o.status, '_', ' '); end if;
    if o.status = 'open' and not o.on_time and o.late_allowed_at is null then
      raise exception 'SO % was loaded past the cut-off. The Warehouse Manager has to allow it first.', o.so_no; end if;
    if v_site is not null and v_site <> o.site then raise exception 'The SOs are for different sites.'; end if;
    if v_mssi is not null and v_mssi <> o.mssi_qt then raise exception 'An MSSI quotation gets its own queue number — log it separately.'; end if;
    v_site := o.site; v_co := coalesce(v_co, o.company); v_mssi := o.mssi_qt; v_client := coalesce(v_client, o.client_name);
  end loop;
  select bool_and(status = 'balance'), bool_or(status = 'open' and on_time), bool_and(kind = 'walkin') into v_bal, v_cnt, v_walk
    from pk_orders where id = any(p_orders);
  v_series := case when p_courier then 'R' when v_mssi then 'M' else 'C' end;
  perform pg_advisory_xact_lock(hashtext('pk_queue|' || v_site || '|' || v_day || '|' || v_series));
  select coalesce(max(queue_no), 0) + 1 into v_n from pk_visits where site = v_site and queue_day = v_day and series = v_series;
  insert into pk_visits (site, company, series, queue_day, queue_no, label, client_name, courier, is_balance, counted, walkin,
                         arrived_at, arrived_by, arrived_name, so_count)
  values (v_site, v_co, v_series, v_day, v_n,
          pk_site_prefix(v_site) || '-' || case v_series when 'C' then '' else v_series end || lpad(v_n::text, 3, '0'),
          coalesce(nullif(btrim(p_client), ''), v_client), coalesce(p_courier, false), coalesce(v_bal, false), coalesce(v_cnt, false) and not coalesce(v_bal, false),
          coalesce(v_walk, false),
          case when v_walk then least(now(), (select min(uploaded_at) from pk_orders where id = any(p_orders))) else now() end,
          auth.uid(), coalesce(me.name, me.email), array_length(p_orders, 1))
  returning * into v;
  insert into pk_visit_orders (visit_id, order_id, counted, si_no)
  select v.id, x.id, x.status = 'open' and x.on_time,
         case when x.rider_cancelled is not null then (select vo.si_no from pk_visit_orders vo join pk_visits pv on pv.id = vo.visit_id
                                                       where vo.order_id = x.id and pv.status = 'cancelled' and vo.si_no is not null
                                                       order by pv.arrived_at desc limit 1) end
    from pk_orders x where x.id = any(p_orders);
  update pk_orders set status = 'in_queue', missed_first = null, missed_last = null, missed_count = 0, rider_cancelled = null, updated_at = now() where id = any(p_orders);
  perform pk_log(null, v.id, 'arrived', v.label || case when p_courier then ' (courier rider)' else '' end);
  return v;
end $function$;
