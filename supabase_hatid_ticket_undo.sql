-- HATID: undo a step processed by mistake, approved by the warehouse manager or an admin (Rommel 2026-11-22, concern #5)
-- A user asks; an active warehouse manager (pickup_role = 'wh_manager') covering the company, or an admin, approves.
-- Nobody approves their own request unless they are an admin. A warehouse manager can undo a step up to 7 days old; an admin any time.
-- Delivery: dispatched -> scheduled, on site -> departed, problem -> before the problem, completed -> back on the road / on site.
-- Pick-up: SI sent -> waiting, accepted -> SI sent, ready -> accepted, released -> ready (items given back to the order).
-- An undone release keeps its original loaded time for promptness (pk_visits.first_loaded_at), and a message already
-- sent about the undone step gets a correction message.

create table if not exists ticket_undo_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('delivery','pickup')),
  job_id uuid references jobs(id) on delete cascade,
  visit_id uuid references pk_visits(id) on delete cascade,
  company text not null,
  label text,
  from_status text not null,
  back_to text not null,
  step_at timestamptz,
  reason text not null,
  requested_by uuid,
  requested_name text,
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','approved','declined','withdrawn')),
  decided_by uuid,
  decided_name text,
  decided_at timestamptz,
  decide_note text,
  effects jsonb,
  check ((kind = 'delivery' and job_id is not null) or (kind = 'pickup' and visit_id is not null))
);
create unique index if not exists ticket_undo_one_open_job on ticket_undo_requests (job_id) where status = 'pending' and job_id is not null;
create unique index if not exists ticket_undo_one_open_visit on ticket_undo_requests (visit_id) where status = 'pending' and visit_id is not null;
create index if not exists ticket_undo_status_idx on ticket_undo_requests (status, created_at desc);

alter table ticket_undo_requests enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'ticket_undo_requests' and policyname = 'staff read undo requests') then
    create policy "staff read undo requests" on ticket_undo_requests for select to authenticated
      using (exists (select 1 from job_staff s where s.id = auth.uid() and s.active and (s.companies is null or company = any(s.companies))));
  end if;
end $$;
grant select on ticket_undo_requests to authenticated;

alter table pk_visits add column if not exists first_loaded_at timestamptz;

-- Promptness of a re-released pick-up counts from the first release, not the second
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.pk_step'::regproc);
  if position('coalesce(v.first_loaded_at, now())' in d) = 0 then
    n := replace(d, 'extract(epoch from now() - v.arrived_at)', 'extract(epoch from coalesce(v.first_loaded_at, now()) - v.arrived_at)');
    if n = d then raise exception 'pk_step: promptness line not found — not changed'; end if;
    execute n;
  end if;
end $$;

create or replace function ticket_undo_status_label(p_kind text, p_status text) returns text
language sql immutable as $$
  select case when p_kind = 'delivery' then case p_status when 'scheduled' then 'Scheduled' when 'dispatched' then 'Departed' when 'in_progress' then 'On site'
                                                         when 'issue' then 'Problem reported' when 'completed' then 'Delivered' else p_status end
              else case p_status when 'waiting' then 'Waiting' when 'notified' then 'SI sent' when 'accepted' then 'SI accepted'
                                 when 'ready' then 'Ready for loading' when 'done' then 'Released' else p_status end end;
$$;

-- Who may approve an undo for this company: an admin, or an active warehouse manager covering it
create or replace function ticket_undo_can_decide(p_company text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from job_staff s where s.id = auth.uid() and s.active
    and (s.role = 'admin' or (s.pickup_role = 'wh_manager' and (s.companies is null or p_company = any(s.companies)))));
$$;

create or replace function ticket_undo_approvers(p_company text) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(s.id), '{}') from job_staff s where s.active
    and (s.role = 'admin' or (s.pickup_role = 'wh_manager' and (s.companies is null or p_company = any(s.companies))));
$$;

create or replace function ticket_undo_notify(p_users uuid[], p_kind text, p_title text, p_body text, p_req uuid) returns void
language sql security definer set search_path = public as $$
  insert into job_notifications (user_id, kind, title, body, ref_type, ref_id)
  select distinct u, p_kind, p_title, p_body, 'undo', p_req from unnest(p_users) u where u is not null and u <> auth.uid();
$$;

-- Where a ticket would go back to, and when the step being undone happened
create or replace function ticket_undo_plan(p_kind text, p_id uuid, out from_status text, out back_to text, out step_at timestamptz,
  out company text, out label text, out blocked text)
language plpgsql stable security definer set search_path = public as $$
declare j jobs; v pk_visits; v_arr timestamptz; v_dep timestamptz; v_sos text;
begin
  if p_kind = 'delivery' then
    select * into j from jobs where id = p_id;
    if j.id is null then blocked := 'Delivery not found.'; return; end if;
    company := j.company; from_status := j.status; label := j.quotation_serial || coalesce(' · ' || j.client_name, '');
    select max(created_at) filter (where event_type = 'dispatched'), max(created_at) filter (where event_type = 'arrived')
      into v_dep, v_arr from job_events where job_id = j.id;
    if j.status = 'dispatched' then back_to := 'scheduled'; step_at := v_dep;
    elsif j.status = 'in_progress' then back_to := 'dispatched'; step_at := v_arr;
    elsif j.status in ('issue','completed') then
      back_to := case when v_arr is not null and (v_dep is null or v_arr >= v_dep) then 'in_progress' when v_dep is not null then 'dispatched' else 'scheduled' end;
      select max(created_at) into step_at from job_events where job_id = j.id and event_type = j.status;
      if j.status = 'completed' then
        if exists (select 1 from jobs x where x.redelivery_of = j.id and x.status <> 'rejected') then blocked := 'A redelivery was already made from this delivery — undo or cancel that first.'; end if;
        if j.balance_job is not null and exists (select 1 from jobs x where x.id = j.balance_job and x.status <> 'rejected') then blocked := 'A delivery for the balance was already made — cancel that first.'; end if;
      end if;
    else blocked := 'Only a delivery that has departed, arrived, reported a problem or been completed can be undone.';
    end if;
  elsif p_kind = 'pickup' then
    select * into v from pk_visits where id = p_id;
    if v.id is null then blocked := 'Queue number not found.'; return; end if;
    select string_agg(o.so_no, ', ' order by o.so_no) into v_sos from pk_visit_orders vo join pk_orders o on o.id = vo.order_id where vo.visit_id = v.id;
    company := v.company; from_status := v.status; label := v.label || coalesce(' · ' || v.client_name, '') || coalesce(' · ' || v_sos, '');
    if v.status = 'notified' then back_to := 'waiting'; step_at := v.notified_at;
    elsif v.status = 'accepted' then back_to := 'notified'; step_at := v.accepted_at;
    elsif v.status = 'ready' then back_to := 'accepted'; step_at := v.ready_at;
    elsif v.status = 'done' then back_to := 'ready'; step_at := v.loaded_at;
      if exists (select 1 from pk_visit_orders vo join pk_visit_orders vo2 on vo2.order_id = vo.order_id and vo2.visit_id <> vo.visit_id
                 join pk_visits v2 on v2.id = vo2.visit_id
                 where vo.visit_id = v.id and v2.arrived_at > v.arrived_at and v2.status <> 'cancelled') then
        blocked := 'The balance of this order was already picked up on a later queue number — that has to be undone first.';
      end if;
    else blocked := 'Only a pick-up that has moved past waiting (and is not cancelled) can be undone.';
    end if;
  else blocked := 'Unknown ticket type.';
  end if;
end $$;

create or replace function ticket_undo_request(p_kind text, p_id uuid, p_reason text) returns ticket_undo_requests
language plpgsql security definer set search_path = public as $$
declare me job_staff; pl record; r ticket_undo_requests;
begin
  select * into me from job_staff where id = auth.uid() and active;
  if me.id is null then raise exception 'Sign in first.'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Say what was processed by mistake.'; end if;
  select * into pl from ticket_undo_plan(p_kind, p_id);
  if pl.blocked is not null then raise exception '%', pl.blocked; end if;
  if not (me.companies is null or pl.company = any(me.companies)) then raise exception 'This ticket is not in your company.'; end if;
  if p_kind = 'delivery' and me.role not in ('admin','manager','dispatcher','field') then raise exception 'Only dispatch or the driver can ask to undo a delivery step.'; end if;
  if p_kind = 'pickup' and not (me.role in ('admin','manager') or me.pickup_role is not null) then raise exception 'Only the pick-up team can ask to undo a pick-up step.'; end if;
  if exists (select 1 from ticket_undo_requests x where x.status = 'pending' and (x.job_id = p_id or x.visit_id = p_id)) then
    raise exception 'An undo is already waiting for approval on this ticket.'; end if;
  insert into ticket_undo_requests (kind, job_id, visit_id, company, label, from_status, back_to, step_at, reason, requested_by, requested_name)
  values (p_kind, case when p_kind = 'delivery' then p_id end, case when p_kind = 'pickup' then p_id end, pl.company, pl.label,
          pl.from_status, pl.back_to, pl.step_at, btrim(p_reason), me.id, coalesce(nullif(btrim(me.name), ''), me.email))
  returning * into r;
  if p_kind = 'delivery' then
    insert into job_events (job_id, event_type, notes) values (p_id, 'note',
      '↩ Undo asked: ' || ticket_undo_status_label(p_kind, pl.from_status) || ' → ' || ticket_undo_status_label(p_kind, pl.back_to) || '. Reason: ' || btrim(p_reason));
  else
    perform pk_log(null, p_id, 'undo_request', ticket_undo_status_label(p_kind, pl.from_status) || ' → ' || ticket_undo_status_label(p_kind, pl.back_to) || ' — ' || btrim(p_reason));
  end if;
  perform ticket_undo_notify(ticket_undo_approvers(pl.company), 'undo_request',
    'Undo asked — ' || coalesce(pl.label, ''),
    r.requested_name || ': ' || ticket_undo_status_label(p_kind, pl.from_status) || ' → ' || ticket_undo_status_label(p_kind, pl.back_to) || ' · ' || left(btrim(p_reason), 200), r.id);
  return r;
end $$;

-- Queue a correction for messages already sent about the undone step; cancel the ones not sent yet
create or replace function ticket_undo_correct_outbox(p_rows job_outbox[], p_label text, p_what text) returns int
language plpgsql security definer set search_path = public as $$
declare x job_outbox; n int := 0; ns record; txt text;
begin
  select * into ns from job_notify_settings where id;
  txt := 'Correction: please disregard our earlier message (' || p_what || ') for ' || coalesce(p_label, 'your order')
      || '. It was recorded by mistake and has been reversed. We will update you again. Sorry for the confusion.';
  foreach x in array coalesce(p_rows, '{}') loop
    if x.status in ('pending','failed') then
      update job_outbox set status = 'skipped', last_error = 'Cancelled — the step was undone before it was sent' where id = x.id;
    elsif x.status in ('sent','sending') and x.channel <> 'drive' then
      insert into job_outbox (job_id, pk_order_id, company, ref_date, kind, channel, recipient, recipient_label, subject, body, status, last_error, to_role)
      values (x.job_id, x.pk_order_id, x.company, (now() at time zone 'Asia/Manila')::date, 'manual', x.channel, x.recipient, x.recipient_label,
              'Correction — ' || coalesce(p_label, ''), case when x.channel = 'sms' then left(txt, 300) else txt end,
              case when x.channel = 'sms' and not coalesce(ns.sms_enabled, false) then 'skipped'
                   when x.channel = 'email' and not coalesce(ns.email_enabled, false) then 'skipped' else 'pending' end,
              case when x.channel = 'sms' and not coalesce(ns.sms_enabled, false) then 'SMS sending is not set up yet'
                   when x.channel = 'email' and not coalesce(ns.email_enabled, false) then 'Email sending is not set up yet' end,
              x.to_role);
      n := n + 1;
    end if;
  end loop;
  if n > 0 then perform job_outbox_kick(); end if;
  return n;
end $$;

create or replace function ticket_undo_apply(r ticket_undo_requests) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j jobs; v pk_visits; vo record; o pk_orders; v_lines jsonb; v_rows job_outbox[]; v_last timestamptz; n int := 0; fx jsonb := '{}';
begin
  if r.kind = 'delivery' then
    select * into j from jobs where id = r.job_id for update;
    if r.from_status = 'completed' then
      select max(created_at) into v_last from job_events where job_id = j.id and event_type = 'completed';
      select array_agg(x) into v_rows from job_outbox x where x.job_id = j.id and x.kind in ('delivered','partial','returned')
        and x.created_at >= coalesce(v_last, '-infinity') - interval '5 seconds';
      n := ticket_undo_correct_outbox(v_rows, j.quotation_serial || coalesce(' · ' || j.client_name, ''), 'delivery result');
      perform set_config('hatid.unlock', '1', true);
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
  else
    select * into v from pk_visits where id = r.visit_id for update;
    if r.from_status = 'notified' then update pk_visits set status = 'waiting', notified_at = null, notified_name = null where id = v.id;
    elsif r.from_status = 'accepted' then update pk_visits set status = 'notified', accepted_at = null, accepted_name = null where id = v.id;
    elsif r.from_status = 'ready' then update pk_visits set status = 'accepted', ready_at = null, ready_name = null where id = v.id;
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
    perform pk_log(null, v.id, 'undo', ticket_undo_status_label('pickup', r.from_status) || ' undone — back to ' || ticket_undo_status_label('pickup', r.back_to)
      || '. Asked by ' || coalesce(r.requested_name, '—') || ': ' || r.reason || case when n > 0 then '. Correction sent (' || n || ')' else '' end);
  end if;
  return fx;
end $$;

create or replace function ticket_undo_decide(p_req uuid, p_approve boolean, p_note text default null) returns ticket_undo_requests
language plpgsql security definer set search_path = public as $$
declare me job_staff; r ticket_undo_requests; pl record; fx jsonb; nm text;
begin
  select * into me from job_staff where id = auth.uid() and active;
  select * into r from ticket_undo_requests where id = p_req for update;
  if r.id is null then raise exception 'Request not found.'; end if;
  if r.status <> 'pending' then raise exception 'This request was already %.', r.status; end if;
  if me.id is null or not ticket_undo_can_decide(r.company) then raise exception 'Only the warehouse manager or an admin can approve an undo.'; end if;
  if r.requested_by = me.id and me.role <> 'admin' then raise exception 'You can''t approve your own request — another warehouse manager or an admin has to.'; end if;
  nm := coalesce(nullif(btrim(me.name), ''), me.email);
  if not p_approve then
    if nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'Say why the undo is declined.'; end if;
    update ticket_undo_requests set status = 'declined', decided_by = me.id, decided_name = nm, decided_at = now(), decide_note = btrim(p_note) where id = r.id returning * into r;
    if r.kind = 'delivery' then insert into job_events (job_id, event_type, notes) values (r.job_id, 'note', '↩ Undo declined by ' || nm || ': ' || btrim(p_note));
    else perform pk_log(null, r.visit_id, 'undo_declined', nm || ': ' || btrim(p_note)); end if;
    perform ticket_undo_notify(array[r.requested_by], 'undo_declined', 'Undo declined — ' || coalesce(r.label, ''), nm || ': ' || btrim(p_note), r.id);
    return r;
  end if;
  if me.role <> 'admin' and r.step_at is not null and r.step_at < now() - interval '7 days' then
    raise exception 'This step is more than 7 days old — only an admin can undo it.'; end if;
  select * into pl from ticket_undo_plan(r.kind, coalesce(r.job_id, r.visit_id));
  if pl.blocked is not null then raise exception '%', pl.blocked; end if;
  if pl.from_status is distinct from r.from_status then
    raise exception 'The ticket has moved on since the request (now %) — ask again.', ticket_undo_status_label(r.kind, pl.from_status); end if;
  fx := ticket_undo_apply(r);
  update ticket_undo_requests set status = 'approved', decided_by = me.id, decided_name = nm, decided_at = now(), decide_note = nullif(btrim(coalesce(p_note, '')), ''), effects = fx
   where id = r.id returning * into r;
  perform ticket_undo_notify(array[r.requested_by], 'undo_done', 'Undone — ' || coalesce(r.label, ''),
    ticket_undo_status_label(r.kind, r.from_status) || ' → ' || ticket_undo_status_label(r.kind, r.back_to) || ' · approved by ' || nm, r.id);
  return r;
end $$;

create or replace function ticket_undo_withdraw(p_req uuid) returns ticket_undo_requests
language plpgsql security definer set search_path = public as $$
declare me job_staff; r ticket_undo_requests;
begin
  select * into me from job_staff where id = auth.uid() and active;
  select * into r from ticket_undo_requests where id = p_req for update;
  if r.id is null then raise exception 'Request not found.'; end if;
  if r.status <> 'pending' then raise exception 'This request was already %.', r.status; end if;
  if me.id is null or (r.requested_by <> me.id and me.role <> 'admin') then raise exception 'Only the person who asked (or an admin) can withdraw it.'; end if;
  update ticket_undo_requests set status = 'withdrawn', decided_by = me.id, decided_name = coalesce(nullif(btrim(me.name), ''), me.email), decided_at = now() where id = r.id returning * into r;
  if r.kind = 'delivery' then insert into job_events (job_id, event_type, notes) values (r.job_id, 'note', '↩ Undo request withdrawn');
  else perform pk_log(null, r.visit_id, 'undo_withdrawn', null); end if;
  return r;
end $$;

-- The open request on one ticket (if any), what it would do, and what this person can do about it
create or replace function ticket_undo_for(p_kind text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me job_staff; r ticket_undo_requests; pl record;
begin
  select * into me from job_staff where id = auth.uid() and active;
  if me.id is null then return null; end if;
  select * into r from ticket_undo_requests where status = 'pending' and (job_id = p_id or visit_id = p_id) order by created_at desc limit 1;
  select * into pl from ticket_undo_plan(p_kind, p_id);
  if pl.company is null or not (me.companies is null or pl.company = any(me.companies)) then return null; end if;
  return jsonb_build_object(
    'request', case when r.id is not null then to_jsonb(r) end,
    'can_decide', r.id is not null and ticket_undo_can_decide(r.company) and (r.requested_by <> me.id or me.role = 'admin'),
    'can_withdraw', r.id is not null and (r.requested_by = me.id or me.role = 'admin'),
    'can_ask', r.id is null and pl.blocked is null and (
      (p_kind = 'delivery' and me.role in ('admin','manager','dispatcher','field')) or (p_kind = 'pickup' and (me.role in ('admin','manager') or me.pickup_role is not null))),
    'from_status', pl.from_status, 'back_to', pl.back_to,
    'from_label', ticket_undo_status_label(p_kind, pl.from_status), 'back_label', ticket_undo_status_label(p_kind, pl.back_to),
    'blocked', pl.blocked, 'step_at', pl.step_at);
end $$;

-- Requests this person can approve, plus their own (open, and decided in the last 7 days)
create or replace function ticket_undo_mine() returns jsonb
language sql stable security definer set search_path = public as $$
  with me as (select * from job_staff where id = auth.uid() and active)
  select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object(
           'from_label', ticket_undo_status_label(r.kind, r.from_status), 'back_label', ticket_undo_status_label(r.kind, r.back_to),
           'can_decide', r.status = 'pending' and ticket_undo_can_decide(r.company) and (r.requested_by <> me.id or me.role = 'admin'),
           'mine', r.requested_by = me.id) order by (r.status = 'pending') desc, r.created_at desc), '[]')
  from ticket_undo_requests r, me
  where (me.companies is null or r.company = any(me.companies))
    and ((r.status = 'pending' and (r.requested_by = me.id or ticket_undo_can_decide(r.company)))
      or (r.requested_by = me.id and r.decided_at > now() - interval '7 days')
      or (r.status <> 'pending' and r.decided_by = me.id and r.decided_at > now() - interval '2 days'));
$$;

revoke all on function ticket_undo_plan(text, uuid), ticket_undo_apply(ticket_undo_requests), ticket_undo_correct_outbox(job_outbox[], text, text),
  ticket_undo_notify(uuid[], text, text, text, uuid), ticket_undo_approvers(text) from public, anon, authenticated;
grant execute on function ticket_undo_request(text, uuid, text), ticket_undo_decide(uuid, boolean, text), ticket_undo_withdraw(uuid),
  ticket_undo_for(text, uuid), ticket_undo_mine(), ticket_undo_can_decide(text), ticket_undo_status_label(text, text) to authenticated;
