-- HATID: undo only PART of a release (Rommel 2026-11-24).
-- The person asking ticks which released lines (and how many) go back; the rest stay released.
-- A partial undo keeps the queue number Released (photos, timing kept); the put-back items
-- become the order's balance for another day. Lines never move to another order.
-- lines = null on a request means the whole release (unchanged behaviour).

alter table ticket_undo_requests add column if not exists lines jsonb;
alter table ticket_undo_requests add column if not exists lines_text text;

-- What a released queue number gave out, per order and line (for the ask window).
create or replace function ticket_undo_release_lines(p_visit uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v pk_visits;
begin
  select * into v from pk_visits where id = p_visit;
  if v.id is null or not pk_sees(v.company) or v.status <> 'done' then return '[]'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('o', o.id, 'so_no', o.so_no, 'lines', x.ls) order by o.so_no)
    from pk_visit_orders vo join pk_orders o on o.id = vo.order_id
    cross join lateral (select jsonb_agg(jsonb_build_object('i', (t->>'i')::int, 'qty', (t->>'qty')::numeric, 'unit', l->>'unit', 'desc', l->>'desc') order by (t->>'i')::int) ls
                          from jsonb_array_elements(coalesce(vo.taken, '[]')) t join jsonb_array_elements(o.lines) l on (l->>'i')::int = (t->>'i')::int
                         where (t->>'qty')::numeric > 0) x
   where vo.visit_id = v.id and x.ls is not null), '[]');
end $$;

-- Ask to undo part of a release. p_lines = [{"o": order id, "i": line no, "q": qty to put back}]
create or replace function ticket_undo_request_part(p_id uuid, p_reason text, p_lines jsonb)
returns ticket_undo_requests language plpgsql security definer set search_path to 'public' as $$
declare me job_staff; pl record; r ticket_undo_requests; v_norm jsonb; v_bad text; v_all boolean; v_txt text;
begin
  select * into me from job_staff where id = auth.uid() and active;
  if me.id is null then raise exception 'Sign in first.'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Say what was processed by mistake.'; end if;
  select * into pl from ticket_undo_plan('pickup', p_id);
  if pl.blocked is not null then raise exception '%', pl.blocked; end if;
  if pl.from_status <> 'done' then raise exception 'Only a released queue number can be partly undone.'; end if;
  if not (me.companies is null or pl.company = any(me.companies)) then raise exception 'This ticket is not in your company.'; end if;
  if not (me.role in ('admin','manager') or me.pickup_role is not null) then raise exception 'Only the pick-up team can ask to undo a pick-up step.'; end if;
  if exists (select 1 from ticket_undo_requests x where x.status = 'pending' and x.visit_id = p_id) then
    raise exception 'An undo is already waiting for approval on this ticket.'; end if;

  -- the released lines of this queue number, joined to what was asked
  with rel as (
    select vo.order_id o, o.so_no, (t->>'i')::int i, (t->>'qty')::numeric got, l->>'unit' unit, l->>'desc' dsc
      from pk_visit_orders vo join pk_orders o on o.id = vo.order_id
      cross join jsonb_array_elements(coalesce(vo.taken, '[]')) t
      join jsonb_array_elements(o.lines) l on (l->>'i')::int = (t->>'i')::int
     where vo.visit_id = p_id and (t->>'qty')::numeric > 0),
  ask as (
    select (a->>'o')::uuid o, (a->>'i')::int i, sum((a->>'q')::numeric) q
      from jsonb_array_elements(coalesce(p_lines, '[]')) a where coalesce((a->>'q')::numeric, 0) > 0 group by 1, 2)
  select
    (select string_agg(coalesce(rel.dsc, 'an item not on this queue number'), ', ') from ask a left join rel on rel.o = a.o and rel.i = a.i where rel.o is null or a.q > rel.got),
    (select jsonb_agg(jsonb_build_object('o', a.o, 'i', a.i, 'q', a.q) order by rel.so_no, a.i) from ask a join rel on rel.o = a.o and rel.i = a.i),
    (select bool_and(coalesce(a.q, 0) = rel.got) from rel left join ask a on a.o = rel.o and a.i = rel.i),
    (select string_agg(s, '; ' order by so) from (
       select rel.so_no so, 'SO ' || rel.so_no || ': ' || replace(pk_items_text(jsonb_agg(jsonb_build_object('qty', a.q, 'unit', rel.unit, 'desc', rel.dsc) order by a.i)), E'\n', ', ') s
         from ask a join rel on rel.o = a.o and rel.i = a.i group by rel.so_no) z)
    into v_bad, v_norm, v_all, v_txt;
  if v_bad is not null then raise exception 'More than was released, or not on this queue number: %.', v_bad; end if;
  if v_norm is null then raise exception 'Pick at least one item to put back.'; end if;
  if v_all then return ticket_undo_request('pickup', p_id, p_reason); end if;

  insert into ticket_undo_requests (kind, visit_id, company, label, from_status, back_to, step_at, reason, requested_by, requested_name, lines, lines_text)
  values ('pickup', p_id, pl.company, pl.label, 'done', 'done', pl.step_at, btrim(p_reason), me.id, coalesce(nullif(btrim(me.name), ''), me.email), v_norm, v_txt)
  returning * into r;
  perform pk_log(null, p_id, 'undo_request', 'Part of the release — put back: ' || v_txt || ' — ' || btrim(p_reason));
  perform ticket_undo_notify(ticket_undo_approvers(pl.company), 'undo_request', 'Undo asked — ' || coalesce(pl.label, ''),
    r.requested_name || ': part of the release — put back ' || left(v_txt, 200) || ' · ' || left(btrim(p_reason), 200), r.id);
  return r;
end $$;

-- Apply: whole release as before; part of a release when r.lines is set.
create or replace function ticket_undo_apply(r ticket_undo_requests)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare j jobs; v pk_visits; vo record; o pk_orders; v_lines jsonb; v_tk jsonb; v_rows job_outbox[]; v_last timestamptz; n int := 0; fx jsonb := '{}';
  v_q jsonb; v_cut numeric;
begin
  if r.kind = 'delivery' then
    select * into j from jobs where id = r.job_id for update;
    if r.from_status = 'completed' then
      select max(created_at) into v_last from job_events where job_id = j.id and event_type = 'completed';
      select array_agg(x) into v_rows from job_outbox x where x.job_id = j.id and x.kind in ('delivered','partial','returned')
        and x.created_at >= coalesce(v_last, '-infinity') - interval '5 seconds';
      n := ticket_undo_correct_outbox(v_rows, j.quotation_serial || coalesce(' · ' || j.client_name, ''), 'delivery result');
      update jobs set status = r.back_to, delivery_outcome = null, received = null, received_by_name = null, balance_items = '[]' where id = j.id;
      update job_trips set done_at = null, updated_at = now()
       where trip_date = j.scheduled_date and truck_id = j.truck_id and trip_no = coalesce(j.trip_no, 1) and done_at is not null;
      fx := jsonb_build_object('corrections', n, 'cleared', array['delivery result','received by']);
    elsif r.from_status = 'issue' then
      select max(created_at) into v_last from job_events where job_id = j.id and event_type = 'issue';
      select array_agg(x) into v_rows from job_outbox x where x.job_id = j.id and x.kind = 'issue' and x.created_at >= coalesce(v_last, '-infinity') - interval '5 seconds';
      n := ticket_undo_correct_outbox(v_rows, j.quotation_serial || coalesce(' · ' || j.client_name, ''), 'problem report');
      update jobs set status = r.back_to where id = j.id;
      fx := jsonb_build_object('corrections', n);
    else
      update jobs set status = r.back_to where id = j.id;
    end if;
    insert into job_events (job_id, event_type, notes) values (j.id, 'undo',
      '↩ ' || ticket_undo_status_label('delivery', r.from_status) || ' undone — back to ' || ticket_undo_status_label('delivery', r.back_to)
      || '. Asked by ' || coalesce(r.requested_name, '—') || ': ' || r.reason || '. Approved by ' || coalesce((select coalesce(nullif(btrim(name), ''), email) from job_staff where id = auth.uid()), '—')
      || case when n > 0 then '. Correction sent (' || n || ')' else '' end);
    return fx;
  end if;

  select * into v from pk_visits where id = r.visit_id for update;
  if r.from_status = 'notified' then update pk_visits set status = 'waiting', notified_at = null, notified_name = null where id = v.id;
  elsif r.from_status = 'accepted' then update pk_visits set status = 'notified', accepted_at = null, accepted_name = null where id = v.id;
  elsif r.from_status = 'ready' then update pk_visits set status = 'accepted', ready_at = null, ready_name = null where id = v.id;
  elsif r.from_status = 'done' and r.lines is not null then
    -- part of the release: only the chosen quantities go back; the queue number stays Released
    for vo in select * from pk_visit_orders where visit_id = v.id loop
      select jsonb_object_agg(a->>'i', (a->>'q')::numeric) into v_q from jsonb_array_elements(r.lines) a where (a->>'o')::uuid = vo.order_id;
      if v_q is null then continue; end if;
      select * into o from pk_orders where id = vo.order_id for update;
      -- what this visit gave out, less what goes back (never below zero)
      select jsonb_agg(jsonb_build_object('i', (t->>'i')::int, 'qty', (t->>'qty')::numeric - least((t->>'qty')::numeric, coalesce((v_q->>(t->>'i'))::numeric, 0))) order by (t->>'i')::int)
             filter (where (t->>'qty')::numeric - least((t->>'qty')::numeric, coalesce((v_q->>(t->>'i'))::numeric, 0)) > 0)
        into v_tk from jsonb_array_elements(coalesce(vo.taken, '[]')) t;
      select jsonb_agg(case when c.q > 0 then jsonb_set(l, '{taken}', to_jsonb(greatest(0, (l->>'taken')::numeric - c.q))) else l end order by (l->>'i')::int),
             sum(c.q * case when (l->>'qty')::numeric > 0 then (l->>'amount')::numeric / (l->>'qty')::numeric else 0 end)
        into v_lines, v_cut
        from jsonb_array_elements(o.lines) l
        cross join lateral (select least(coalesce((v_q->>(l->>'i'))::numeric, 0),
                                          coalesce((select sum((t->>'qty')::numeric) from jsonb_array_elements(coalesce(vo.taken, '[]')) t where (t->>'i')::int = (l->>'i')::int), 0)) q) c;
      update pk_orders set lines = coalesce(v_lines, lines), status = 'balance', closed_at = null, updated_at = now() where id = o.id;
      update pk_visit_orders set taken = coalesce(v_tk, '[]'), sales = greatest(0, round(coalesce(sales, 0) - coalesce(v_cut, 0), 2)) where visit_id = v.id and order_id = o.id;
      -- the released message was wrong: correct it, then send the right one (if anything is still released on this SO)
      select array_agg(x) into v_rows from job_outbox x where x.pk_order_id = o.id and x.pk_key = 'done:' || v.id;
      n := n + ticket_undo_correct_outbox(v_rows, 'SO ' || o.so_no || coalesce(' · ' || o.client_name, ''), 'items released');
      update job_outbox set pk_key = 'done:' || v.id || ':undone:' || extract(epoch from clock_timestamp())::bigint where pk_order_id = o.id and pk_key = 'done:' || v.id;
      if v_tk is not null then perform pk_msg_done(o.id, v.id); end if;
      perform pk_log(o.id, v.id, 'balance', 'Items put back by an undo — left for a later pick-up');
    end loop;
    fx := jsonb_build_object('corrections', n, 'partial', true, 'put_back', r.lines_text);
  elsif r.from_status = 'done' then
    for vo in select * from pk_visit_orders where visit_id = v.id loop
      select * into o from pk_orders where id = vo.order_id for update;
      select jsonb_agg(case when t.q is null then l else jsonb_set(l, '{taken}', to_jsonb(greatest(0, (l->>'taken')::numeric - t.q))) end order by (l->>'i')::int)
        into v_lines
        from jsonb_array_elements(o.lines) l
        left join lateral (select sum((t2->>'qty')::numeric) q from jsonb_array_elements(coalesce(vo.taken, '[]')) t2 where (t2->>'i')::int = (l->>'i')::int) t on true;
      update pk_orders set lines = coalesce(v_lines, lines), status = 'in_queue', closed_at = null, updated_at = now() where id = o.id;
      update pk_visit_orders set taken = '[]', sales = null where visit_id = v.id and order_id = o.id;
      select array_agg(x) into v_rows from job_outbox x where x.pk_order_id = o.id and x.pk_key = 'done:' || v.id;
      n := n + ticket_undo_correct_outbox(v_rows, 'SO ' || o.so_no || coalesce(' · ' || o.client_name, ''), 'items released');
      update job_outbox set pk_key = 'done:' || v.id || ':undone:' || extract(epoch from now())::bigint where pk_order_id = o.id and pk_key = 'done:' || v.id;
    end loop;
    update pk_visits set status = 'ready', first_loaded_at = coalesce(first_loaded_at, loaded_at), loaded_at = null, loaded_by = null, loaded_name = null,
           photo_urls = '{}', minutes = null, per_so = null, within = null, over_reason = null, over_note = null, over_reason_name = null, over_reason_at = null
     where id = v.id;
    fx := jsonb_build_object('corrections', n, 'first_loaded_at', v.loaded_at, 'photos', coalesce(array_length(v.photo_urls, 1), 0));
  end if;
  perform pk_log(null, v.id, 'undo',
    case when r.lines is not null then 'Part of the release undone — put back: ' || coalesce(r.lines_text, '—') || '. Still released'
         else ticket_undo_status_label('pickup', r.from_status) || ' undone — back to ' || ticket_undo_status_label('pickup', r.back_to) end
    || '. Asked by ' || coalesce(r.requested_name, '—') || ': ' || r.reason || case when n > 0 then '. Correction sent (' || n || ')' else '' end);
  return fx;
end $$;

-- Decide: same rules; the message to the asker says what was put back on a partial undo.
create or replace function ticket_undo_decide(p_req uuid, p_approve boolean, p_note text default null)
returns ticket_undo_requests language plpgsql security definer set search_path to 'public' as $$
declare me job_staff; r ticket_undo_requests; pl record; fx jsonb; nm text; v_for text; v_admin boolean;
begin
  select * into me from job_staff where id = auth.uid() and active;
  select * into r from ticket_undo_requests where id = p_req for update;
  if r.id is null then raise exception 'Request not found.'; end if;
  if r.status <> 'pending' then raise exception 'This request was already %.', r.status; end if;
  v_for := ticket_undo_can(r.company, r.assigned_to, r.forwarded_by_name);
  if me.id is null or v_for is null then raise exception 'Only the warehouse manager (or someone they delegated) or an admin can approve an undo.'; end if;
  v_admin := me.role = 'admin';
  if r.requested_by = me.id and not v_admin then raise exception 'You can''t approve your own request — the warehouse manager or an admin has to.'; end if;
  nm := coalesce(nullif(btrim(me.name), ''), me.email) || case when v_for <> '' then ' for ' || v_for else '' end;
  if not p_approve then
    if nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'Say why the undo is declined.'; end if;
    update ticket_undo_requests set status = 'declined', decided_by = me.id, decided_name = nm, decided_for = nullif(v_for, ''), decided_at = now(), decide_note = btrim(p_note) where id = r.id returning * into r;
    if r.kind = 'delivery' then insert into job_events (job_id, event_type, notes) values (r.job_id, 'note', '↩ Undo declined by ' || nm || ': ' || btrim(p_note));
    else perform pk_log(null, r.visit_id, 'undo_declined', nm || ': ' || btrim(p_note)); end if;
    perform ticket_undo_notify(array[r.requested_by], 'undo_declined', 'Undo declined — ' || coalesce(r.label, ''), nm || ': ' || btrim(p_note), r.id);
    return r;
  end if;
  if not v_admin and r.step_at is not null and r.step_at < now() - interval '7 days' then
    raise exception 'This step is more than 7 days old — only an admin can undo it.'; end if;
  select * into pl from ticket_undo_plan(r.kind, coalesce(r.job_id, r.visit_id));
  if pl.blocked is not null then raise exception '%', pl.blocked; end if;
  if pl.from_status is distinct from r.from_status then
    raise exception 'The ticket has moved on since the request (now %) — ask again.', ticket_undo_status_label(r.kind, pl.from_status); end if;
  fx := ticket_undo_apply(r);
  update ticket_undo_requests set status = 'approved', decided_by = me.id, decided_name = nm, decided_for = nullif(v_for, ''), decided_at = now(),
         decide_note = nullif(btrim(coalesce(p_note, '')), ''), effects = fx where id = r.id returning * into r;
  perform ticket_undo_notify(array[r.requested_by], 'undo_done', 'Undone — ' || coalesce(r.label, ''),
    case when r.lines is not null then 'Part of the release put back: ' || left(coalesce(r.lines_text, ''), 200)
         else ticket_undo_status_label(r.kind, r.from_status) || ' → ' || ticket_undo_status_label(r.kind, r.back_to) end || ' · approved by ' || nm, r.id);
  return r;
end $$;

revoke all on function ticket_undo_release_lines(uuid) from public, anon;
revoke all on function ticket_undo_request_part(uuid, text, jsonb) from public, anon;
grant execute on function ticket_undo_release_lines(uuid) to authenticated;
grant execute on function ticket_undo_request_part(uuid, text, jsonb) to authenticated;
