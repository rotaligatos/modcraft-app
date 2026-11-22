-- HATID undo approvals: only the warehouse manager (or an admin), who can delegate (Rommel 2026-11-22)
-- Rea Buenaventura is the warehouse SUPERVISOR: her Pick-up role stays "Warehouse Manager" for the queue work,
-- but she does not approve undos unless the manager delegates to her.
-- Approver = admin, or job_staff.can_approve_undo covering the company.
-- Delegation, both ways (as for delivery-plan changes): a standing delegate the manager switches on/off,
-- or passing one request to someone. A delegate approves "for" the manager.

alter table job_staff add column if not exists can_approve_undo boolean not null default false;
update job_staff set can_approve_undo = true where id = '201159b8-b0ef-49d5-aeaf-c06ad68e7eca';   -- Micko Ortiz, Warehouse Manager

alter table ticket_undo_requests add column if not exists assigned_to uuid;
alter table ticket_undo_requests add column if not exists assigned_name text;
alter table ticket_undo_requests add column if not exists forwarded_by_name text;
alter table ticket_undo_requests add column if not exists decided_for text;

create table if not exists ticket_undo_delegations (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null,
  from_name text,
  to_user uuid not null,
  to_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index if not exists ticket_undo_deleg_one on ticket_undo_delegations (from_user) where active;
alter table ticket_undo_delegations enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'ticket_undo_delegations' and policyname = 'staff read undo delegations') then
    create policy "staff read undo delegations" on ticket_undo_delegations for select to authenticated using (job_is_active_staff());
  end if;
end $$;
grant select on ticket_undo_delegations to authenticated;

-- Is this person an approver in their own right for the company?
create or replace function ticket_undo_is_approver(p_user uuid, p_company text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from job_staff s where s.id = p_user and s.active
    and (s.role = 'admin' or (s.can_approve_undo and (s.companies is null or p_company = any(s.companies)))));
$$;

-- '' = may decide as themselves; text = may decide for that approver; null = may not
create or replace function ticket_undo_can(p_company text, p_assigned uuid, p_fwd text default null) returns text
language sql stable security definer set search_path = public as $$
  select case
    when ticket_undo_is_approver(auth.uid(), p_company) then ''
    when p_assigned = auth.uid() and exists (select 1 from job_staff s where s.id = auth.uid() and s.active and (s.companies is null or p_company = any(s.companies)))
      then coalesce(p_fwd, 'the warehouse manager')
    else (select coalesce(nullif(btrim(f.name), ''), f.email) from ticket_undo_delegations d join job_staff f on f.id = d.from_user
           join job_staff me on me.id = auth.uid() and me.active and (me.companies is null or p_company = any(me.companies))
          where d.active and d.to_user = auth.uid() and ticket_undo_is_approver(d.from_user, p_company) limit 1)
  end;
$$;

create or replace function ticket_undo_can_decide(p_company text) returns boolean
language sql stable security definer set search_path = public as $$ select ticket_undo_can(p_company, null) is not null; $$;

-- Approvers for a company, their active delegates, and (for one request) the person it was passed to
create or replace function ticket_undo_approvers(p_company text) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct u), '{}') from (
    select s.id u from job_staff s where ticket_undo_is_approver(s.id, p_company)
    union select d.to_user from ticket_undo_delegations d where d.active and ticket_undo_is_approver(d.from_user, p_company)
      and exists (select 1 from job_staff t where t.id = d.to_user and t.active)) x;
$$;
revoke all on function ticket_undo_approvers(text) from public, anon, authenticated;

create or replace function ticket_undo_decide(p_req uuid, p_approve boolean, p_note text default null) returns ticket_undo_requests
language plpgsql security definer set search_path = public as $$
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
    ticket_undo_status_label(r.kind, r.from_status) || ' → ' || ticket_undo_status_label(r.kind, r.back_to) || ' · approved by ' || nm, r.id);
  return r;
end $$;

-- Pass one request to someone (warehouse manager or admin only)
create or replace function ticket_undo_forward(p_req uuid, p_to uuid) returns ticket_undo_requests
language plpgsql security definer set search_path = public as $$
declare me job_staff; r ticket_undo_requests; t job_staff;
begin
  select * into me from job_staff where id = auth.uid() and active;
  select * into r from ticket_undo_requests where id = p_req for update;
  if r.id is null or r.status <> 'pending' then raise exception 'This request is no longer waiting.'; end if;
  if me.id is null or not ticket_undo_is_approver(me.id, r.company) then raise exception 'Only the warehouse manager or an admin can pass a request on.'; end if;
  select * into t from job_staff where id = p_to and active;
  if t.id is null or not (t.companies is null or r.company = any(t.companies)) then raise exception 'Pick an active user who covers %.', r.company; end if;
  if t.id = r.requested_by then raise exception 'That person asked for it — they can''t approve it.'; end if;
  update ticket_undo_requests set assigned_to = t.id, assigned_name = coalesce(nullif(btrim(t.name), ''), t.email),
         forwarded_by_name = coalesce(nullif(btrim(me.name), ''), me.email) where id = r.id returning * into r;
  perform ticket_undo_notify(array[t.id], 'undo_request', 'Undo passed to you — ' || coalesce(r.label, ''),
    r.forwarded_by_name || ' asks you to decide: ' || ticket_undo_status_label(r.kind, r.from_status) || ' → ' || ticket_undo_status_label(r.kind, r.back_to) || ' · ' || left(r.reason, 200), r.id);
  return r;
end $$;

-- Standing delegate while away: p_to = null switches it off
create or replace function ticket_undo_delegate_set(p_to uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me job_staff; t job_staff;
begin
  select * into me from job_staff where id = auth.uid() and active;
  if me.id is null or not (me.role = 'admin' or me.can_approve_undo) then raise exception 'Only the warehouse manager can delegate undo approvals.'; end if;
  update ticket_undo_delegations set active = false, ended_at = now() where from_user = me.id and active;
  if p_to is null then return jsonb_build_object('to', null); end if;
  select * into t from job_staff where id = p_to and active;
  if t.id is null or t.id = me.id then raise exception 'Pick another active user.'; end if;
  insert into ticket_undo_delegations (from_user, from_name, to_user, to_name)
  values (me.id, coalesce(nullif(btrim(me.name), ''), me.email), t.id, coalesce(nullif(btrim(t.name), ''), t.email));
  insert into job_notifications (user_id, kind, title, body, ref_type)
  values (t.id, 'undo_delegate', 'You can approve undos', coalesce(nullif(btrim(me.name), ''), me.email) || ' asked you to approve undo requests while they are away.', 'undo');
  return jsonb_build_object('to', t.id, 'to_name', coalesce(nullif(btrim(t.name), ''), t.email));
end $$;

-- For the Undo requests screen: am I an approver, my current delegate, and who I can pick
create or replace function ticket_undo_delegate_info() returns jsonb
language sql stable security definer set search_path = public as $$
  with me as (select * from job_staff where id = auth.uid() and active)
  select jsonb_build_object(
    'approver', coalesce((select role = 'admin' or can_approve_undo from me), false),
    'delegate', (select jsonb_build_object('to', d.to_user, 'to_name', d.to_name, 'since', d.created_at) from ticket_undo_delegations d, me where d.from_user = me.id and d.active),
    'covering_for', (select coalesce(jsonb_agg(d.from_name), '[]') from ticket_undo_delegations d, me where d.to_user = me.id and d.active),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', coalesce(nullif(btrim(s.name), ''), s.email), 'role', s.role, 'pickup_role', s.pickup_role) order by s.name), '[]')
               from job_staff s, me where s.active and s.id <> me.id and (me.companies is null or s.companies is null or s.companies && me.companies)
                 and (s.role in ('admin','manager','dispatcher','viewer') or s.pickup_role is not null)));
$$;

create or replace function ticket_undo_for(p_kind text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me job_staff; r ticket_undo_requests; pl record; v_can text;
begin
  select * into me from job_staff where id = auth.uid() and active;
  if me.id is null then return null; end if;
  select * into r from ticket_undo_requests where status = 'pending' and (job_id = p_id or visit_id = p_id) order by created_at desc limit 1;
  select * into pl from ticket_undo_plan(p_kind, p_id);
  if pl.company is null or not (me.companies is null or pl.company = any(me.companies)) then return null; end if;
  v_can := case when r.id is not null then ticket_undo_can(r.company, r.assigned_to, r.forwarded_by_name) end;
  return jsonb_build_object(
    'request', case when r.id is not null then to_jsonb(r) end,
    'can_decide', r.id is not null and v_can is not null and (r.requested_by <> me.id or me.role = 'admin'),
    'decide_for', nullif(v_can, ''),
    'can_forward', r.id is not null and ticket_undo_is_approver(me.id, r.company),
    'can_withdraw', r.id is not null and (r.requested_by = me.id or me.role = 'admin'),
    'can_ask', r.id is null and pl.blocked is null and (
      (p_kind = 'delivery' and me.role in ('admin','manager','dispatcher','field')) or (p_kind = 'pickup' and (me.role in ('admin','manager') or me.pickup_role is not null))),
    'from_status', pl.from_status, 'back_to', pl.back_to,
    'from_label', ticket_undo_status_label(p_kind, pl.from_status), 'back_label', ticket_undo_status_label(p_kind, pl.back_to),
    'blocked', pl.blocked, 'step_at', pl.step_at);
end $$;

create or replace function ticket_undo_mine() returns jsonb
language sql stable security definer set search_path = public as $$
  with me as (select * from job_staff where id = auth.uid() and active),
  x as (select r.*, ticket_undo_can(r.company, r.assigned_to, r.forwarded_by_name) can from ticket_undo_requests r, me where (me.companies is null or r.company = any(me.companies)))
  select coalesce(jsonb_agg(to_jsonb(x) - 'can' || jsonb_build_object(
           'from_label', ticket_undo_status_label(x.kind, x.from_status), 'back_label', ticket_undo_status_label(x.kind, x.back_to),
           'can_decide', x.status = 'pending' and x.can is not null and (x.requested_by <> me.id or me.role = 'admin'),
           'decide_for', nullif(x.can, ''),
           'can_forward', x.status = 'pending' and ticket_undo_is_approver(me.id, x.company),
           'mine', x.requested_by = me.id) order by (x.status = 'pending') desc, x.created_at desc), '[]')
  from x, me
  where (x.status = 'pending' and (x.requested_by = me.id or x.can is not null))
     or (x.requested_by = me.id and x.decided_at > now() - interval '7 days')
     or (x.status <> 'pending' and x.decided_by = me.id and x.decided_at > now() - interval '2 days');
$$;

revoke all on function ticket_undo_is_approver(uuid, text), ticket_undo_can(text, uuid, text) from public, anon;
grant execute on function ticket_undo_is_approver(uuid, text), ticket_undo_can(text, uuid, text), ticket_undo_forward(uuid, uuid),
  ticket_undo_delegate_set(uuid), ticket_undo_delegate_info() to authenticated;
