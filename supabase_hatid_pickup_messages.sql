-- HATID Pick-up: client + sales agent status messages (2026-10-27)
-- Ready (warehouse prepared everything) · Released (logistics loaded) · Missed (6:30 PM no-show).
-- Sent through job_outbox like delivery. Per company on/off in pk_settings (default on).
-- Each message is sent once per order per event (job_outbox.pk_order_id + pk_key).

alter table pk_orders add column if not exists client_contact text,
  add column if not exists client_phone text, add column if not exists client_email text;
alter table pk_settings add column if not exists msg_client boolean not null default true,
  add column if not exists msg_agent boolean not null default true;
alter table job_outbox add column if not exists pk_order_id uuid references pk_orders(id) on delete cascade,
  add column if not exists pk_key text;
create index if not exists job_outbox_pk_order_idx on job_outbox (pk_order_id, pk_key) where pk_order_id is not null;

alter table job_outbox drop constraint if exists job_outbox_kind_check;
alter table job_outbox add constraint job_outbox_kind_check check (kind = any (array['delivered','partial','returned','issue','delay','daily',
  'daily_auto','daily_followup','sched_client','sched_agent','manual','truck_check','load_concern','quality','trip_done','trip_notice','photo',
  'pickup_noshow','pickup_concern','pickup_photo','prep_client','prep_agent','onway_client','onway_agent','prep_request',
  'pkready_client','pkready_agent','pkdone_client','pkdone_agent','pkmissed_client','pkmissed_agent']));

create or replace function pk_site_name(s text) returns text language sql immutable as $$
  select case s when 'plant1' then 'Plant 1' when 'annex' then 'Annex' else coalesce(s, '') end $$;

-- Queue one pick-up message to the client (SMS + email) and the sales agent (Chat + email + SMS).
create or replace function pk_msg_send(p_order uuid, p_kind text, p_key text, p_csubj text, p_ctext text, p_asubj text, p_atext text,
  p_agent_chat boolean default true) returns integer
language plpgsql security definer set search_path = public as $$
declare o pk_orders; s pk_settings; a job_agents; ns record; n int := 0; ph text; d date := pk_today();
begin
  select * into o from pk_orders where id = p_order;
  if o.id is null then return 0; end if;
  if exists (select 1 from job_outbox where pk_order_id = o.id and pk_key = p_key) then return 0; end if;
  select * into s from pk_settings where company = o.company;
  select * into ns from job_notify_settings where id;
  select * into a from job_agents where id = o.agent_id and active;
  if coalesce(s.msg_client, true) and p_ctext is not null then
    ph := nullif(regexp_replace(coalesce(o.client_phone, ''), '\D', '', 'g'), '');
    if ph is not null then
      insert into job_outbox (pk_order_id, pk_key, company, ref_date, kind, channel, recipient, recipient_label, subject, body, status, last_error, to_role)
      values (o.id, p_key, o.company, d, p_kind || '_client', 'sms', ph, coalesce(o.client_name, 'Client'), p_csubj, p_ctext,
        case when ns.sms_enabled then 'pending' else 'skipped' end, case when ns.sms_enabled then null else 'SMS sending is not set up yet' end, 'client'); n := n + 1;
    end if;
    if nullif(btrim(o.client_email), '') is not null then
      insert into job_outbox (pk_order_id, pk_key, company, ref_date, kind, channel, recipient, recipient_label, subject, body, status, last_error, to_role)
      values (o.id, p_key, o.company, d, p_kind || '_client', 'email', lower(btrim(o.client_email)), coalesce(o.client_name, 'Client'), p_csubj, p_ctext,
        case when ns.email_enabled then 'pending' else 'skipped' end, case when ns.email_enabled then null else 'Email sending is not set up yet' end, 'client'); n := n + 1;
    end if;
  end if;
  if coalesce(s.msg_agent, true) and a.id is not null and p_atext is not null then
    if p_agent_chat and a.chat_webhook is not null then
      insert into job_outbox (pk_order_id, pk_key, company, ref_date, kind, channel, recipient, recipient_label, subject, body, to_role)
      values (o.id, p_key, o.company, d, p_kind || '_agent', 'chat', a.chat_webhook, a.name || ' (Chat)', p_asubj, p_atext, 'agent'); n := n + 1;
    end if;
    if nullif(btrim(a.email), '') is not null then
      insert into job_outbox (pk_order_id, pk_key, company, ref_date, kind, channel, recipient, recipient_label, subject, body, status, last_error, to_role)
      values (o.id, p_key, o.company, d, p_kind || '_agent', 'email', lower(a.email), a.name, p_asubj, p_atext,
        case when ns.email_enabled then 'pending' else 'skipped' end, case when ns.email_enabled then null else 'Email sending is not set up yet' end, 'agent'); n := n + 1;
    end if;
    if nullif(regexp_replace(coalesce(a.phone, ''), '\D', '', 'g'), '') is not null then
      insert into job_outbox (pk_order_id, pk_key, company, ref_date, kind, channel, recipient, recipient_label, subject, body, status, last_error, to_role)
      values (o.id, p_key, o.company, d, p_kind || '_agent', 'sms', regexp_replace(a.phone, '\D', '', 'g'), a.name, p_asubj,
        left(regexp_replace(p_atext, '^\S+\s', ''), 300),
        case when ns.sms_enabled then 'pending' else 'skipped' end, case when ns.sms_enabled then null else 'SMS sending is not set up yet' end, 'agent'); n := n + 1;
    end if;
  end if;
  if n = 0 then   -- record that nothing could go out, so it shows in the order history and isn't retried
    perform pk_log(o.id, null, 'msg_none', case p_kind when 'pkready' then 'Ready' when 'pkdone' then 'Released' else 'Missed pick-up' end
      || ' message not sent — no client mobile/email and no sales agent contact');
  else
    perform pk_log(o.id, null, 'msg_' || p_kind, n || ' message' || case when n = 1 then '' else 's' end || ' queued');
    perform job_outbox_kick();
  end if;
  return n;
end $$;

-- Item list for a message: "20 pcs Oak 18mm; 4 pcs Edgeband" (at most 6, then "+N more")
create or replace function pk_items_text(p_lines jsonb) returns text language sql immutable as $$
  with x as (select row_number() over () rn, count(*) over () tot,
                    trim(both ' ' from regexp_replace(rtrim(rtrim(to_char((e->>'qty')::numeric, 'FM999999990.99'), '0'), '.'), '^$', '0') || ' ' || coalesce(e->>'unit', '') || ' ' || coalesce(e->>'desc', '')) t
               from jsonb_array_elements(coalesce(p_lines, '[]')) e)
  select string_agg(t, E'\n' order by rn) filter (where rn <= 6)
         || coalesce(max(case when tot > 6 then E'\n+ ' || (tot - 6) || ' more item' || case when tot - 6 = 1 then '' else 's' end end), '') from x $$;

create or replace function pk_greet(o pk_orders) returns text language sql stable as $$
  select coalesce(nullif(btrim(o.client_contact), ''), nullif(btrim(o.client_name), ''), 'Customer') $$;

-- READY: warehouse has prepared everything the client will take.
create or replace function pk_msg_ready(p_order uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare o pk_orders; co text; dl text;
begin
  select * into o from pk_orders where id = p_order;
  if o.id is null or o.status <> 'open' or o.pickup_date < pk_today() then return 0; end if;
  co := job_company_name(o.company);
  dl := case when o.pickup_date = pk_today() then 'today, ' || to_char(o.pickup_date, 'Dy DD Mon') else to_char(o.pickup_date, 'Dy DD Mon') end;
  return pk_msg_send(o.id, 'pkready', 'ready:' || o.pickup_date,
    'Ready for pick-up — ' || o.so_no,
    'Good day, ' || pk_greet(o) || '! Your order from ' || co || ' is READY for pick-up.'
      || E'\nSO No.: ' || o.so_no || E'\nPick-up: ' || dl || ' · ' || pk_site_name(o.site)
      || E'\nPlease give your SO number at the counter when you arrive.' || E'\n— ' || co,
    'Ready for pick-up — ' || o.so_no || coalesce(' · ' || o.client_name, ''),
    '📦 Ready for pick-up — SO ' || o.so_no || E'\nClient: ' || coalesce(o.client_name, '—') || E'\nPick-up: ' || dl || ' · ' || pk_site_name(o.site));
end $$;

-- RELEASED: logistics loaded the items. p_taken = [{i, qty}] for this visit.
create or replace function pk_msg_done(p_order uuid, p_visit uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare o pk_orders; v pk_visits; vo pk_visit_orders; co text; got text; left_t text; t text;
begin
  select * into o from pk_orders where id = p_order; select * into v from pk_visits where id = p_visit;
  select * into vo from pk_visit_orders where visit_id = p_visit and order_id = p_order;
  if o.id is null or v.id is null then return 0; end if;
  co := job_company_name(o.company);
  select pk_items_text(jsonb_agg(jsonb_build_object('qty', (t2->>'qty')::numeric, 'unit', l->>'unit', 'desc', l->>'desc') order by (l->>'i')::int))
    into got from jsonb_array_elements(coalesce(vo.taken, '[]')) t2 join jsonb_array_elements(o.lines) l on (l->>'i')::int = (t2->>'i')::int;
  select pk_items_text(jsonb_agg(jsonb_build_object('qty', (l->>'qty')::numeric - (l->>'taken')::numeric, 'unit', l->>'unit', 'desc', l->>'desc') order by (l->>'i')::int))
    into left_t from jsonb_array_elements(o.lines) l where (l->>'qty')::numeric > (l->>'taken')::numeric;
  t := to_char(coalesce(v.loaded_at, now()) at time zone 'Asia/Manila', 'FMHH12:MI AM');
  return pk_msg_send(o.id, 'pkdone', 'done:' || v.id,
    'Released — ' || o.so_no,
    'Thank you, ' || pk_greet(o) || '! Your items for SO ' || o.so_no || ' were RELEASED today at ' || t || '.'
      || coalesce(E'\nItems:\n' || got, '')
      || coalesce(E'\nStill to be picked up:\n' || left_t || E'\nPlease contact your sales agent to schedule the rest.', '')
      || E'\n— ' || co,
    'Released — ' || o.so_no || coalesce(' · ' || o.client_name, ''),
    '✅ Released — SO ' || o.so_no || E'\nClient: ' || coalesce(o.client_name, '—') || E'\n' || coalesce(v.label || ' · ', '') || t
      || coalesce(E'\nItems:\n' || got, '') || coalesce(E'\nBalance left:\n' || left_t, '') || E'\nLoad photos are saved in HATID.');
end $$;

-- MISSED: the client did not come on the pick-up date (sent by the 6:30 PM no-show run).
create or replace function pk_msg_missed(p_order uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare o pk_orders; a job_agents; co text; ag text;
begin
  select * into o from pk_orders where id = p_order;
  if o.id is null or o.status <> 'no_show' then return 0; end if;
  select * into a from job_agents where id = o.agent_id and active;
  co := job_company_name(o.company);
  ag := case when a.id is not null then 'your sales agent, ' || a.name || coalesce(' (' || nullif(btrim(a.phone), '') || ')', '')
             when nullif(btrim(o.salesperson), '') is not null then 'your sales agent, ' || o.salesperson
             else 'your sales agent' end;
  return pk_msg_send(o.id, 'pkmissed', 'missed:' || o.pickup_date,
    'Pick-up missed — ' || o.so_no,
    'Good day, ' || pk_greet(o) || '. We missed you today — your pick-up for SO ' || o.so_no || ' (' || to_char(o.pickup_date, 'Dy DD Mon') || ') did not push through.'
      || E'\nPlease contact ' || ag || ', to rebook your pick-up.' || E'\n— ' || co,
    'Pick-up missed — ' || o.so_no || coalesce(' · ' || o.client_name, ''),
    '⏰ Pick-up missed — SO ' || o.so_no || E'\nClient: ' || coalesce(o.client_name, '—') || ' did not come on ' || to_char(o.pickup_date, 'Dy DD Mon')
      || E'.\nPlease contact the client to rebook, or cancel the ticket if they no longer need it.',
    false);   -- agents with Chat already get the 6:30 PM no-show list there
end $$;

-- Sales Support: set or correct the client's contact on a pick-up ticket.
create or replace function pk_set_contact(p_order uuid, p_contact text, p_phone text, p_email text) returns pk_orders
language plpgsql security definer set search_path = public as $$
declare o pk_orders; ph text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), ''); em text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  if not pk_can(array['sales_support']) then raise exception 'Only Sales Support can change the client contact.'; end if;
  select * into o from pk_orders where id = p_order;
  if o.id is null or not pk_sees(o.company) then raise exception 'Ticket not found.'; end if;
  if ph is not null and ph !~ '^(\+?63|0)9\d{9}$' then raise exception 'Client mobile: enter a Philippine mobile number, e.g. 0917 123 4567'; end if;
  if em is not null and em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Client email doesn''t look right.'; end if;
  update pk_orders set client_contact = nullif(btrim(p_contact), ''), client_phone = ph, client_email = em, updated_at = now() where id = p_order returning * into o;
  perform pk_log(o.id, null, 'contact', 'Client contact updated');
  return o;
end $$;
grant execute on function pk_set_contact(uuid, text, text, text) to authenticated;
revoke execute on function pk_msg_send(uuid, text, text, text, text, text, text, boolean) from public, anon, authenticated;
revoke execute on function pk_msg_ready(uuid) from public, anon, authenticated;
revoke execute on function pk_msg_done(uuid, uuid) from public, anon, authenticated;
revoke execute on function pk_msg_missed(uuid) from public, anon, authenticated;

-- Hook the messages into the existing pick-up steps (edits the live definitions in place; each stops if its anchor moved).
do $m$
declare d text; a text;
begin
  -- 1) upload: keep the client's contact from the Odoo ticket (a blank never erases one already saved)
  d := pg_get_functiondef('pk_upload(jsonb)'::regprocedure);
  if position('client_email = coalesce' in d) = 0 then
    a := $a$  update pk_orders o set agent_id = (select a.id from job_agents a where a.active and job_norm(a.name) = job_norm(o.salesperson) limit 1) where o.id = v_id;$a$;
    if position(a in d) = 0 then raise exception 'pk_upload: anchor not found'; end if;
    execute replace(d, a, a || $b$
  update pk_orders set client_contact = coalesce(nullif(btrim(p->>'contact'), ''), client_contact),
    client_phone = coalesce(case when regexp_replace(coalesce(p->>'phone', ''), '[^0-9+]', '', 'g') ~ '^(\+?63|0)9\d{9}$' then regexp_replace(p->>'phone', '[^0-9+]', '', 'g') end, client_phone),
    client_email = coalesce(case when lower(btrim(coalesce(p->>'email', ''))) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then lower(btrim(p->>'email')) end, client_email)
   where id = v_id;$b$);
  end if;

  -- 2) warehouse ticks the last line prepared -> "ready for pick-up"
  d := pg_get_functiondef('pk_set_lines(uuid,text,jsonb)'::regprocedure);
  if position('pk_msg_ready' in d) = 0 then
    if position('v_all boolean;' in d) = 0 or position($a$returning * into o;
  return o;$a$ in d) = 0 or position('  update pk_orders set prepared_at' in d) = 0 then raise exception 'pk_set_lines: anchor not found'; end if;
    d := replace(d, 'v_all boolean;', 'v_all boolean; v_was timestamptz;');
    d := replace(d, '  update pk_orders set prepared_at', $b$  v_was := o.prepared_at;
  update pk_orders set prepared_at$b$);
    d := replace(d, $a$returning * into o;
  return o;$a$, $b$returning * into o;
  if v_all and v_was is null then perform pk_msg_ready(o.id); end if;
  return o;$b$);
    execute d;
  end if;

  -- 3) logistics saves the load photos -> "released"
  d := pg_get_functiondef('pk_step(uuid,text,text[],jsonb)'::regprocedure);
  if position('pk_msg_done' in d) = 0 then
    a := $a$returning * into v;
    v_folder :=$a$;
    if position(a in d) = 0 then raise exception 'pk_step: anchor not found'; end if;
    execute replace(d, a, $b$returning * into v;
    perform pk_msg_done(vo2.order_id, v.id) from pk_visit_orders vo2 where vo2.visit_id = v.id;
    v_folder :=$b$);
  end if;

  -- 4) 6:30 PM no-show run -> "we missed you, contact your agent to rebook"
  d := pg_get_functiondef('pk_noshow_tick()'::regprocedure);
  if position('pk_msg_missed' in d) = 0 then
    a := $a$   where pickup_date = d and kind in ('scheduled','same_day') and status = 'open';$a$;
    if position(a in d) = 0 then raise exception 'pk_noshow_tick: anchor not found'; end if;
    execute replace(d, a, a || $b$
  perform pk_msg_missed(x.id) from pk_orders x where x.pickup_date = d and x.kind in ('scheduled','same_day') and x.status = 'no_show';$b$);
  end if;

  -- 5) settings: on/off per company
  d := pg_get_functiondef('pk_save_settings(text,jsonb)'::regprocedure);
  if position('msg_client' in d) = 0 then
    a := '    noshow_emails = case';
    if position(a in d) = 0 then raise exception 'pk_save_settings: anchor not found'; end if;
    execute replace(d, a, $b$    msg_client = coalesce((p->>'msg_client')::boolean, msg_client), msg_agent = coalesce((p->>'msg_agent')::boolean, msg_agent),
    noshow_emails = case$b$);
  end if;
end $m$;
