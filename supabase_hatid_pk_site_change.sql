-- HATID pick-up: change the pick-up location (Plant 1 <-> Annex) — Rommel 2026-11-05.
-- Sales Support moves the ticket (e.g. no stock at Annex, stock at Plant 1). It leaves the old site's lists and shows at
-- the new site for that site's Sales Support to endorse to its warehouse and logistics — the same steps as any ticket.
-- * Prepared ticks are cleared: the new site's warehouse prepares the items. The old site is told to put back any it prepared.
-- * If the client already has a queue number, the number moves with every SO on it: a new number in the new site's queue,
--   the clock keeps running from the original arrival, the steps start again from "waiting" (SI numbers kept).
-- * In-app notice to both sites; the client and the sales agent get a text/email (kind address_*, held during practice).

create or replace function public.pk_set_site(p_order uuid, p_site text, p_reason text)
 returns text language plpgsql security definer set search_path to 'public' as $function$
declare o pk_orders; me job_staff := pk_me(); r text := nullif(btrim(p_reason), ''); v pk_visits; v_n int; v_old text;
  v_ids uuid[]; v_sos text; x pk_orders; co text;
begin
  if not pk_can(array['sales_support']) then raise exception 'Only Sales Support can change the pick-up location.'; end if;
  if p_site not in ('plant1','annex') then raise exception 'Pick Plant 1 or Annex.'; end if;
  select * into o from pk_orders where id = p_order for update;
  if o.id is null or not pk_sees(o.company) then raise exception 'Ticket not found.'; end if;
  if o.status not in ('open','balance','no_show','in_queue') then raise exception 'SO % is % — the location can no longer be changed.', o.so_no, replace(o.status, '_', ' '); end if;
  if o.site = p_site then raise exception 'SO % is already for %.', o.so_no, pk_site_name(p_site); end if;
  if r is null then raise exception 'Say why the location changed (e.g. no stock at %).', pk_site_name(o.site); end if;
  v_old := o.site;

  if o.status = 'in_queue' then
    select pv.* into v from pk_visits pv join pk_visit_orders vo on vo.visit_id = pv.id
     where vo.order_id = o.id and pv.status not in ('done','cancelled') order by pv.arrived_at desc limit 1 for update;
  end if;
  if v.id is not null then
    if v.status = 'loading' then raise exception '% is already being loaded.', v.label; end if;
    select array_agg(order_id) into v_ids from pk_visit_orders where visit_id = v.id;
  else
    v_ids := array[o.id];
  end if;
  select string_agg(so_no, ', ' order by so_no) into v_sos from pk_orders where id = any(v_ids);

  update pk_orders set site = p_site, prepared_at = null, prepared_name = null, updated_at = now(),
         lines = (select coalesce(jsonb_agg(jsonb_set(l - 'prep_qty', '{prep}', 'false') order by (l->>'i')::int), '[]'::jsonb) from jsonb_array_elements(lines) l)
   where id = any(v_ids);

  if v.id is not null then
    perform pg_advisory_xact_lock(hashtext('pk_queue|' || p_site || '|' || v.queue_day || '|' || v.series));
    select coalesce(max(queue_no), 0) + 1 into v_n from pk_visits where site = p_site and queue_day = v.queue_day and series = v.series;
    update pk_visits set site = p_site, queue_no = v_n,
           label = pk_site_prefix(p_site) || '-' || case v.series when 'C' then '' else v.series end || lpad(v_n::text, 3, '0'),
           status = 'waiting', notified_at = null, notified_name = null, accepted_at = null, accepted_name = null, ready_at = null, ready_name = null
     where id = v.id returning * into v;
    perform pk_log(null, v.id, 'site_changed', 'Moved ' || pk_site_name(v_old) || ' → ' || pk_site_name(p_site) || ', new number ' || v.label
      || ' (clock keeps running from arrival). Reason: ' || r);
  end if;
  for x in select * from pk_orders where id = any(v_ids) loop
    perform pk_log(x.id, null, 'site_changed', 'Pick-up location ' || pk_site_name(v_old) || ' → ' || pk_site_name(p_site) || '. Reason: ' || r);
  end loop;

  perform pk_notify(p_site, o.company, array['sales_support','warehouse','logistics'], 'pickup_site',
    v_sos || ' moved here from ' || pk_site_name(v_old),
    coalesce(o.client_name || ' · ', '') || case when v.id is not null then 'Client is already waiting — new number ' || v.label || '. ' else '' end
      || 'Sales Support: endorse to the warehouse. Reason: ' || r, o.id);
  perform pk_notify(v_old, o.company, array['warehouse','logistics'], 'pickup_site',
    v_sos || ' moved to ' || pk_site_name(p_site),
    coalesce(o.client_name || ' · ', '') || 'No longer picked up here — put back any items already prepared. Reason: ' || r, o.id);

  co := job_company_name(o.company);
  for x in select * from pk_orders where id = any(v_ids) loop
    perform pk_msg_send(x.id, 'address', 'site:' || p_site || ':' || extract(epoch from now())::bigint,
      'Pick-up location changed — ' || x.so_no,
      'Good day, ' || pk_greet(x) || '! The pick-up location of your order from ' || co || ' has changed.'
        || E'\nSO No.: ' || x.so_no || E'\nNew pick-up location: ' || pk_site_name(p_site)
        || case when v.id is not null then E'\nPlease proceed to ' || pk_site_name(p_site) || ' — your new queue number is ' || v.label || '.' else E'\nPlease go to ' || pk_site_name(p_site) || ' when you pick up.' end
        || E'\nSorry for the inconvenience.' || E'\n— ' || co,
      'Pick-up location changed — ' || x.so_no || coalesce(' · ' || x.client_name, ''),
      '📍 Pick-up moved — SO ' || x.so_no || E'\nClient: ' || coalesce(x.client_name, '—') || E'\n' || pk_site_name(v_old) || ' → ' || pk_site_name(p_site) || E'\nReason: ' || r);
  end loop;

  return v_sos || ' moved to ' || pk_site_name(p_site) || case when v.id is not null then ' — new number ' || v.label else '' end;
end $function$;

revoke all on function public.pk_set_site(uuid, text, text) from public, anon;
grant execute on function public.pk_set_site(uuid, text, text) to authenticated;
