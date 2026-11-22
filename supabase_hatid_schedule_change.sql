-- HATID: change an APPROVED delivery plan by request (2026-11-22, Rommel's concern #6).
-- A supervisor/scheduler asks; the Supply Chain Manager (the schedule 'approve' signer, Michael)
-- approves the request, or forwards it to a supervisor, or has a standing delegate. Admin = fallback.
-- After approval the plan opens for editing; when re-submitted it goes straight to the approver
-- for one signature (no full review/confirm chain). Reopen and address changes keep the full chain.
-- SCM project nssviuuagtlvxjvvvagt.

alter table delivery_schedules add column if not exists change_mode boolean not null default false;
alter table delivery_schedules add column if not exists change_request_id uuid;
alter table delivery_schedules drop constraint if exists delivery_schedules_status_check;
alter table delivery_schedules add constraint delivery_schedules_status_check
  check (status = any (array['draft','for_review','for_confirmation','for_approval','for_change_approval','approved','returned']));
alter table delivery_schedule_signoffs drop constraint if exists delivery_schedule_signoffs_step_check;
alter table delivery_schedule_signoffs add constraint delivery_schedule_signoffs_step_check
  check (step = any (array['prepare','review','confirm','approve','change']));

create table if not exists delivery_schedule_change_requests (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references delivery_schedules(id) on delete cascade,
  revision int not null,
  reason text not null,
  requested_by uuid, requested_name text, requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','approved','declined','withdrawn','done')),
  assigned_to uuid, assigned_name text, forwarded_by uuid, forwarded_name text, forwarded_at timestamptz, forward_note text,
  decided_by uuid, decided_name text, decided_on_behalf_of text, decided_at timestamptz, decision_note text,
  done_at timestamptz
);
create unique index if not exists dscr_one_open on delivery_schedule_change_requests(schedule_id) where status in ('pending','approved');
alter table delivery_schedule_change_requests enable row level security;
drop policy if exists dscr_read on delivery_schedule_change_requests;
create policy dscr_read on delivery_schedule_change_requests for select to authenticated
  using (exists (select 1 from delivery_schedules ds where ds.id = schedule_id and job_can_access_pool(ds.pool_id, false)));
grant select on delivery_schedule_change_requests to authenticated;

create table if not exists job_schedule_delegations (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references job_staff(id) on delete cascade,
  to_user uuid not null references job_staff(id) on delete cascade,
  active boolean not null default true,
  set_at timestamptz not null default now(), ended_at timestamptz
);
create unique index if not exists jsd_one_active on job_schedule_delegations(from_user) where active;
alter table job_schedule_delegations enable row level security;
drop policy if exists jsd_read on job_schedule_delegations;
create policy jsd_read on job_schedule_delegations for select to authenticated
  using (exists (select 1 from job_staff where id = auth.uid() and active));
grant select on job_schedule_delegations to authenticated;

-- Who may approve a change for this pool, as which approver?
-- null = cannot; '' = as themselves (approver or admin); text = on behalf of that approver.
create or replace function job_sched_change_can(p_pool uuid, p_assigned uuid default null, p_forwarded_name text default null)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare me job_staff; pl logistics_pools; nm text;
begin
  select * into me from job_staff where id = auth.uid() and active;
  if me.id is null then return null; end if;
  select * into pl from logistics_pools where id = p_pool;
  if 'approve' = any(me.schedule_steps) and (me.companies is null or me.companies && pl.companies) then return ''; end if;
  if me.role = 'admin' then return ''; end if;
  if p_assigned is not null and p_assigned = me.id then return coalesce(p_forwarded_name, 'the approver'); end if;
  select coalesce(a.name, a.email) into nm from job_schedule_delegations d join job_staff a on a.id = d.from_user
   where d.to_user = me.id and d.active and a.active and 'approve' = any(a.schedule_steps)
     and (a.companies is null or a.companies && pl.companies) limit 1;
  return nm;
end $$;

-- Approvers of a pool plus their active delegates (who to tell).
create or replace function job_sched_change_people(p_pool uuid)
returns uuid[] language sql stable security definer set search_path to 'public' as $$
  with pl as (select companies from logistics_pools where id = p_pool),
  ap as (select s.id from job_staff s, pl where s.active and 'approve' = any(s.schedule_steps) and (s.companies is null or s.companies && pl.companies))
  select coalesce(array_agg(distinct x), '{}') from (
    select id x from ap
    union select d.to_user from job_schedule_delegations d join job_staff t on t.id = d.to_user where d.active and t.active and d.from_user in (select id from ap)
  ) q;
$$;

create or replace function job_sched_change_request(p_pool uuid, p_date date, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare me job_staff; s delivery_schedules; pl logistics_pools; r delivery_schedule_change_requests; who text; dl text;
begin
  select * into me from job_staff where id = auth.uid() and active;
  if me.id is null then raise exception 'No HATID access'; end if;
  if not job_can_access_pool(p_pool, false) then raise exception 'You can''t access this pool'; end if;
  if me.role not in ('admin','manager','dispatcher') and not (me.schedule_steps && array['review','confirm']) then
    raise exception 'Only schedulers and supervisors can ask to change an approved plan'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Say what needs to change and why'; end if;
  select * into s from delivery_schedules where pool_id = p_pool and delivery_date = p_date for update;
  if s.id is null or s.status <> 'approved' then raise exception 'Only an approved plan needs a change request'; end if;
  if exists (select 1 from delivery_schedule_change_requests where schedule_id = s.id and status in ('pending','approved')) then
    raise exception 'A change request for this plan is already open'; end if;
  select * into pl from logistics_pools where id = p_pool;
  who := coalesce(me.name, me.email);
  dl := to_char(p_date, 'Mon FMDD, YYYY') || ' · ' || pl.name;
  insert into delivery_schedule_change_requests (schedule_id, revision, reason, requested_by, requested_name)
  values (s.id, s.revision, btrim(p_reason), me.id, who) returning * into r;
  insert into delivery_schedule_events (schedule_id, revision, action, by_user, by_name, note) values (s.id, s.revision, 'change_requested', me.id, who, btrim(p_reason));
  perform job_notify(array(select x from unnest(job_sched_change_people(p_pool)) x where x <> me.id), 'schedule_action',
    'Change requested on an approved delivery plan', dl || ' — ' || who || ': ' || btrim(p_reason), s);
  return to_jsonb(r);
end $$;

create or replace function job_sched_change_forward(p_req uuid, p_to uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare me job_staff; t job_staff; r delivery_schedule_change_requests; s delivery_schedules; pl logistics_pools; who text; dl text;
begin
  select * into me from job_staff where id = auth.uid() and active;
  select * into r from delivery_schedule_change_requests where id = p_req for update;
  if r.id is null or r.status <> 'pending' then raise exception 'This request is no longer waiting'; end if;
  select * into s from delivery_schedules where id = r.schedule_id;
  select * into pl from logistics_pools where id = s.pool_id;
  if me.id is null or not ((('approve' = any(me.schedule_steps)) and (me.companies is null or me.companies && pl.companies)) or me.role = 'admin') then
    raise exception 'Only the approver can pass this request on'; end if;
  select * into t from job_staff where id = p_to and active;
  if t.id is null or t.id = me.id then raise exception 'Pick someone else to decide'; end if;
  if not (t.companies is null or t.companies && pl.companies) then raise exception '% doesn''t cover this pool', coalesce(t.name, t.email); end if;
  if t.role not in ('admin','manager','dispatcher') and cardinality(t.schedule_steps) = 0 then raise exception '% isn''t a scheduler or supervisor', coalesce(t.name, t.email); end if;
  if t.id = r.requested_by and t.role <> 'admin' then raise exception 'The person who asked can''t decide their own request'; end if;
  who := coalesce(me.name, me.email);
  dl := to_char(s.delivery_date, 'Mon FMDD, YYYY') || ' · ' || pl.name;
  update delivery_schedule_change_requests set assigned_to = t.id, assigned_name = coalesce(t.name, t.email), forwarded_by = me.id,
         forwarded_name = who, forwarded_at = now(), forward_note = nullif(btrim(p_note), '') where id = r.id returning * into r;
  insert into delivery_schedule_events (schedule_id, revision, action, by_user, by_name, note)
  values (s.id, s.revision, 'change_forwarded', me.id, who, 'To ' || r.assigned_name || coalesce(': ' || r.forward_note, ''));
  perform job_notify(array[t.id], 'schedule_action', 'Change request passed to you', dl || ' — ' || who || ' asked you to decide: ' || r.reason
    || coalesce(E'\n' || r.forward_note, ''), s);
  return to_jsonb(r);
end $$;

create or replace function job_sched_change_decide(p_req uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare me job_staff; r delivery_schedule_change_requests; s delivery_schedules; pl logistics_pools; onb text; who text; dl text; everyone uuid[];
begin
  select * into me from job_staff where id = auth.uid() and active;
  if me.id is null then raise exception 'No HATID access'; end if;
  select * into r from delivery_schedule_change_requests where id = p_req for update;
  if r.id is null or r.status <> 'pending' then raise exception 'This request is no longer waiting'; end if;
  select * into s from delivery_schedules where id = r.schedule_id for update;
  if s.status <> 'approved' then raise exception 'The plan is no longer approved — this request is out of date'; end if;
  onb := job_sched_change_can(s.pool_id, r.assigned_to, r.forwarded_name);
  if onb is null then raise exception 'Only the approver (or the person they chose) can decide this'; end if;
  if r.requested_by = me.id and me.role <> 'admin' then raise exception 'You can''t decide your own request'; end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then raise exception 'Give the reason for declining'; end if;
  select * into pl from logistics_pools where id = s.pool_id;
  who := coalesce(me.name, me.email) || case when onb <> '' then ' (for ' || onb || ')' else '' end;
  dl := to_char(s.delivery_date, 'Mon FMDD, YYYY') || ' · ' || pl.name;
  update delivery_schedule_change_requests set status = case when p_approve then 'approved' else 'declined' end, decided_by = me.id,
         decided_name = coalesce(me.name, me.email), decided_on_behalf_of = nullif(onb, ''), decided_at = now(), decision_note = nullif(btrim(p_note), '')
   where id = r.id returning * into r;
  if p_approve then
    update delivery_schedules set status = 'returned', returned_from = 'approved', approved_at = null, returned_by = me.id, returned_at = now(),
           return_reason = 'Change approved: ' || r.reason, change_mode = true, change_request_id = r.id, updated_at = now()
     where id = s.id returning * into s;
    insert into delivery_schedule_events (schedule_id, revision, action, by_user, by_name, note) values (s.id, s.revision, 'change_approved', me.id, who, coalesce(nullif(btrim(p_note), ''), r.reason));
    select array_agg(id) into everyone from job_staff where active and (companies is null or companies && pl.companies);
    perform job_notify(everyone, 'schedule_returned', 'Approved plan opened for a change', dl || ' — change approved by ' || who || ': ' || r.reason
      || E'\nEdit the plan, then submit it — it goes straight back for one approval.', s);
  else
    insert into delivery_schedule_events (schedule_id, revision, action, by_user, by_name, note) values (s.id, s.revision, 'change_declined', me.id, who, btrim(p_note));
    perform job_notify(array[r.requested_by], 'schedule_progress', 'Change request declined', dl || ' — declined by ' || who || ': ' || btrim(p_note), s);
  end if;
  return to_jsonb(r);
end $$;

create or replace function job_sched_change_withdraw(p_req uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare me job_staff; r delivery_schedule_change_requests; s delivery_schedules;
begin
  select * into me from job_staff where id = auth.uid() and active;
  select * into r from delivery_schedule_change_requests where id = p_req for update;
  if r.id is null or r.status <> 'pending' then raise exception 'This request is no longer waiting'; end if;
  if me.id is null or (r.requested_by <> me.id and me.role <> 'admin') then raise exception 'Only the person who asked can withdraw it'; end if;
  update delivery_schedule_change_requests set status = 'withdrawn', decided_by = me.id, decided_name = coalesce(me.name, me.email), decided_at = now() where id = r.id returning * into r;
  select * into s from delivery_schedules where id = r.schedule_id;
  insert into delivery_schedule_events (schedule_id, revision, action, by_user, by_name, note) values (s.id, s.revision, 'change_withdrawn', me.id, coalesce(me.name, me.email), null);
  return to_jsonb(r);
end $$;

-- The approver turns a standing delegate on (p_to) or off (null).
create or replace function job_sched_delegate_set(p_to uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare me job_staff; t job_staff;
begin
  select * into me from job_staff where id = auth.uid() and active;
  if me.id is null or not ('approve' = any(me.schedule_steps)) then raise exception 'Only the schedule approver can delegate'; end if;
  if p_to is not null then
    select * into t from job_staff where id = p_to and active;
    if t.id is null or t.id = me.id then raise exception 'Pick someone else'; end if;
    if t.role not in ('admin','manager','dispatcher') and cardinality(t.schedule_steps) = 0 then raise exception '% isn''t a scheduler or supervisor', coalesce(t.name, t.email); end if;
  end if;
  update job_schedule_delegations set active = false, ended_at = now() where from_user = me.id and active;
  if p_to is not null then
    insert into job_schedule_delegations (from_user, to_user) values (me.id, p_to);
    perform job_notify(array[p_to], 'schedule_action', 'You can approve plan changes', coalesce(me.name, me.email)
      || ' set you to approve changes to approved delivery plans on their behalf, until they switch it off.', null::delivery_schedules);
  end if;
  return jsonb_build_object('to', p_to, 'name', coalesce(t.name, t.email));
end $$;

-- What the schedule window needs: open request, what I may do, delegation.
create or replace function job_sched_change_info(p_pool uuid, p_date date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare me job_staff; s delivery_schedules; r delivery_schedule_change_requests; pl logistics_pools; onb text; dto jsonb; dfrom jsonb; asg jsonb;
begin
  select * into me from job_staff where id = auth.uid() and active;
  if me.id is null or not job_can_access_pool(p_pool, false) then return null; end if;
  select * into pl from logistics_pools where id = p_pool;
  select * into s from delivery_schedules where pool_id = p_pool and delivery_date = p_date;
  if s.id is not null then
    select * into r from delivery_schedule_change_requests where schedule_id = s.id order by requested_at desc limit 1;
  end if;
  onb := job_sched_change_can(p_pool, r.assigned_to, r.forwarded_name);
  select jsonb_build_object('id', t.id, 'name', coalesce(t.name, t.email)) into dto
    from job_schedule_delegations d join job_staff t on t.id = d.to_user where d.from_user = me.id and d.active;
  select jsonb_build_object('id', a.id, 'name', coalesce(a.name, a.email)) into dfrom
    from job_schedule_delegations d join job_staff a on a.id = d.from_user where d.to_user = me.id and d.active limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', coalesce(name, email)) order by coalesce(name, email)), '[]') into asg
    from job_staff where active and id <> me.id and (companies is null or companies && pl.companies)
     and (role in ('admin','manager','dispatcher') or cardinality(schedule_steps) > 0);
  return jsonb_build_object(
    'request', case when r.id is null then null else to_jsonb(r) end,
    'can_request', (me.role in ('admin','manager','dispatcher') or me.schedule_steps && array['review','confirm']),
    'can_decide', onb is not null, 'on_behalf', nullif(onb, ''),
    'can_forward', (('approve' = any(me.schedule_steps)) and (me.companies is null or me.companies && pl.companies)) or me.role = 'admin',
    'is_approver', 'approve' = any(me.schedule_steps),
    'delegate_to', dto, 'delegate_from', dfrom, 'people', asg);
end $$;

-- "Needs you": open change requests I can decide and changed plans I can sign.
create or replace function job_sched_change_mine()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare out jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('pool_id', ds.pool_id, 'date', ds.delivery_date, 'pool', pl.name, 'kind', k.kind, 'reason', k.reason, 'by', k.by_name)
         order by ds.delivery_date), '[]') into out
  from delivery_schedules ds join logistics_pools pl on pl.id = ds.pool_id
  cross join lateral (
    select 'request' kind, r.reason, r.requested_name by_name, r.assigned_to, r.forwarded_name from delivery_schedule_change_requests r
     where r.schedule_id = ds.id and r.status = 'pending' and r.requested_by is distinct from auth.uid()
    union all
    select 'sign', r.reason, r.requested_name, r.assigned_to, r.forwarded_name from delivery_schedule_change_requests r
     where ds.status = 'for_change_approval' and r.id = ds.change_request_id
  ) k
  where job_can_access_pool(ds.pool_id, false) and job_sched_change_can(ds.pool_id, k.assigned_to, k.forwarded_name) is not null
    and not exists (select 1 from delivery_schedule_signoffs so where so.schedule_id = ds.id and so.revision = ds.revision and so.signed_by = auth.uid() and k.kind = 'sign');
  return out;
end $$;

grant execute on function job_sched_change_can(uuid, uuid, text), job_sched_change_people(uuid), job_sched_change_request(uuid, date, text),
  job_sched_change_forward(uuid, uuid, text), job_sched_change_decide(uuid, boolean, text), job_sched_change_withdraw(uuid),
  job_sched_delegate_set(uuid), job_sched_change_info(uuid, date), job_sched_change_mine() to authenticated;
revoke execute on function job_sched_change_people(uuid) from anon;

-- The approval chain, with the change path added.
create or replace function public.job_schedule_action(p_pool uuid, p_date date, p_action text, p_note text default null, p_signature text default null, p_passcode text default null)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  me job_staff; s delivery_schedules; snap jsonb; pl logistics_pools;
  waiting text; nxt_step text; label text; everyone uuid[]; next_people uuid[]; signers uuid[];
  who text; dlabel text; onb text; rq delivery_schedule_change_requests;
begin
  select * into me from job_staff where id = auth.uid() and active;
  if me.id is null then raise exception 'No HATID access'; end if;
  if not job_can_access_pool(p_pool, false) then raise exception 'You can''t access this pool'; end if;
  if p_action in ('submit','review','confirm','approve','change_approve') then perform job_passcode_verify(me.id, p_passcode); end if;
  select * into pl from logistics_pools where id = p_pool;
  if p_action = 'submit' then
    insert into delivery_schedules (pool_id, delivery_date) values (p_pool, p_date) on conflict (pool_id, delivery_date) do nothing;
  end if;
  select * into s from delivery_schedules where pool_id = p_pool and delivery_date = p_date for update;
  if p_signature is not null and (p_signature !~ ('^signatures/' || me.id::text || '/[0-9]+-signature\.png$')
       or not exists (select 1 from storage.objects o where o.bucket_id = 'job-media' and o.name = p_signature)) then
    raise exception 'Invalid signature file — sign again'; end if;
  who := coalesce(me.name, me.email);
  dlabel := to_char(p_date, 'Mon FMDD, YYYY') || ' · ' || pl.name;
  select array_agg(id) into everyone from job_staff where active and (companies is null or companies && pl.companies);
  if s.change_request_id is not null then select * into rq from delivery_schedule_change_requests where id = s.change_request_id; end if;

  if p_action = 'submit' then
    if me.role not in ('admin','manager','dispatcher') then raise exception 'Only dispatchers, managers and admins can submit a schedule'; end if;
    if me.companies is not null and not (pl.companies <@ me.companies) then
      raise exception 'This pool serves %, so its schedule is prepared by staff covering all those companies', array_to_string(pl.companies, ' and '); end if;
    if s.status not in ('draft','returned') then raise exception 'This schedule is already in approval — withdraw it first to change it'; end if;
    if p_signature is null then raise exception 'Sign before submitting'; end if;
    snap := job_schedule_snapshot(p_pool, p_date);
    if jsonb_array_length(snap) = 0 then raise exception 'No trucks have jobs on this date yet'; end if;
    update delivery_schedules set revision = revision + 1, status = case when change_mode then 'for_change_approval' else 'for_review' end,
           snapshot = snap, submitted_by = me.id, submitted_at = now(),
           approved_at = null, return_reason = null, returned_by = null, returned_at = null, returned_from = null, updated_at = now()
     where id = s.id returning * into s;
    insert into delivery_schedule_signoffs (schedule_id, revision, step, signed_by, signer_name, signer_title, signature_url)
    values (s.id, s.revision, 'prepare', me.id, who, me.title, p_signature);
    nxt_step := case when s.change_mode then 'change' else 'review' end;

  elsif p_action in ('review','confirm','approve') then
    waiting := case p_action when 'review' then 'for_review' when 'confirm' then 'for_confirmation' else 'for_approval' end;
    if s.id is null or s.status <> waiting then raise exception 'This schedule isn''t waiting for that step'; end if;
    if not (p_action = any(me.schedule_steps)) then raise exception 'You''re not set up to % delivery schedules', p_action; end if;
    if exists (select 1 from delivery_schedule_signoffs where schedule_id = s.id and revision = s.revision and signed_by = me.id) then
      raise exception 'You already signed this schedule — this step needs a different person'; end if;
    if p_signature is null then raise exception 'Sign before continuing'; end if;
    insert into delivery_schedule_signoffs (schedule_id, revision, step, signed_by, signer_name, signer_title, signature_url)
    values (s.id, s.revision, p_action, me.id, who, me.title, p_signature);
    update delivery_schedules set status = case p_action when 'review' then 'for_confirmation' when 'confirm' then 'for_approval' else 'approved' end,
           approved_at = case when p_action = 'approve' then now() end, updated_at = now()
     where id = s.id returning * into s;
    nxt_step := case p_action when 'review' then 'confirm' when 'confirm' then 'approve' end;

  elsif p_action = 'change_approve' then
    if s.id is null or s.status <> 'for_change_approval' then raise exception 'This plan isn''t waiting for a change approval'; end if;
    onb := job_sched_change_can(p_pool, rq.assigned_to, rq.forwarded_name);
    if onb is null then raise exception 'Only the approver (or the person they chose) can approve this change'; end if;
    if exists (select 1 from delivery_schedule_signoffs where schedule_id = s.id and revision = s.revision and signed_by = me.id) then
      raise exception 'You prepared this plan — the change needs a different person to approve'; end if;
    if p_signature is null then raise exception 'Sign before continuing'; end if;
    insert into delivery_schedule_signoffs (schedule_id, revision, step, signed_by, signer_name, signer_title, signature_url)
    values (s.id, s.revision, 'change', me.id, who, concat_ws(' — ', me.title, case when onb <> '' then 'for ' || onb end), p_signature);
    update delivery_schedules set status = 'approved', approved_at = now(), change_mode = false, change_request_id = null, updated_at = now()
     where id = s.id returning * into s;
    update delivery_schedule_change_requests set status = 'done', done_at = now() where id = rq.id;
    who := who || case when onb <> '' then ' (for ' || onb || ')' else '' end;

  elsif p_action in ('reject','withdraw','reopen') then
    if p_action = 'reject' then
      if s.id is null or s.status not in ('for_review','for_confirmation','for_approval','for_change_approval') then raise exception 'Only a schedule in approval can be returned'; end if;
      if cardinality(me.schedule_steps) = 0 and me.role not in ('admin','manager')
         and not (s.status = 'for_change_approval' and job_sched_change_can(p_pool, rq.assigned_to, rq.forwarded_name) is not null) then
        raise exception 'Only signers can return a schedule'; end if;
    elsif p_action = 'withdraw' then
      if s.id is null or s.status not in ('for_review','for_confirmation','for_approval','for_change_approval') then raise exception 'Only a schedule in approval can be withdrawn'; end if;
      if me.role not in ('admin','manager','dispatcher') then raise exception 'Only dispatchers, managers and admins can withdraw'; end if;
    else
      if s.id is null or s.status <> 'approved' then raise exception 'Only an approved schedule can be reopened'; end if;
      if not ('approve' = any(me.schedule_steps)) and me.role <> 'admin' then raise exception 'Only the approver or an admin can reopen an approved schedule'; end if;
      update delivery_schedule_change_requests set status = 'withdrawn', decided_by = me.id, decided_name = who, decided_at = now(),
             decision_note = 'Plan reopened for full re-approval' where schedule_id = s.id and status in ('pending','approved');
    end if;
    if coalesce(btrim(p_note), '') = '' then raise exception 'Give the reason'; end if;
    update delivery_schedules set status = 'returned', return_reason = btrim(p_note), returned_by = me.id, returned_at = now(),
           returned_from = s.status, approved_at = null, updated_at = now(),
           change_mode = case when p_action = 'reopen' then false else change_mode end,
           change_request_id = case when p_action = 'reopen' then null else change_request_id end
     where id = s.id returning * into s;
  else
    raise exception 'Unknown action';
  end if;

  if p_signature is not null then update job_staff set signature_url = p_signature where id = me.id; end if;
  insert into delivery_schedule_events (schedule_id, revision, action, by_user, by_name, note) values (s.id, s.revision, p_action, me.id, who, nullif(btrim(p_note), ''));

  select array_agg(distinct signed_by) into signers from delivery_schedule_signoffs where schedule_id = s.id and revision = s.revision;
  if nxt_step = 'change' then
    next_people := array(select x from unnest(job_sched_change_people(p_pool) || case when rq.assigned_to is not null then array[rq.assigned_to] else '{}'::uuid[] end) x
                          where not (x = any(coalesce(signers, '{}'))));
    perform job_notify(next_people, 'schedule_action', 'Changed delivery plan needs your approval',
      dlabel || ' — submitted by ' || who || coalesce(' · change: ' || rq.reason, ''), s);
  elsif nxt_step is not null then
    select array_agg(id) into next_people from job_staff
     where active and nxt_step = any(schedule_steps) and (companies is null or companies && pl.companies)
       and not (id = any(coalesce(signers, '{}')));
    label := case nxt_step when 'review' then 'review' when 'confirm' then 'confirmation' else 'approval' end;
    perform job_notify(next_people, 'schedule_action', 'Delivery schedule needs your ' || label, dlabel || ' — ' ||
      case p_action when 'submit' then 'submitted' when 'review' then 'reviewed' else 'confirmed' end || ' by ' || who, s);
    perform job_notify(signers, 'schedule_progress', 'Delivery schedule ' || case p_action when 'submit' then 'submitted' when 'review' then 'reviewed' else 'confirmed' end,
      dlabel || ' — by ' || who || '; now waiting for ' || label, s);
  elsif p_action = 'approve' then
    perform job_notify(everyone, 'schedule_approved', 'Delivery schedule approved', dlabel || ' — approved by ' || who, s);
  elsif p_action = 'change_approve' then
    perform job_notify(everyone, 'schedule_approved', 'Changed delivery plan approved', dlabel || ' — approved by ' || who, s);
  elsif p_action = 'reject' then
    perform job_notify(everyone, 'schedule_returned', 'Delivery schedule returned for revision', dlabel || ' — returned by ' || who || ': ' || btrim(p_note), s);
  elsif p_action = 'reopen' then
    perform job_notify(everyone, 'schedule_returned', 'Approved delivery schedule reopened', dlabel || ' — reopened by ' || who || ': ' || btrim(p_note), s);
  else
    perform job_notify(signers || coalesce((select array_agg(id) from job_staff where active and cardinality(schedule_steps) > 0 and (companies is null or companies && pl.companies)), '{}'),
      'schedule_returned', 'Delivery schedule withdrawn', dlabel || ' — withdrawn by ' || who || ' to revise: ' || btrim(p_note), s);
  end if;
  return to_jsonb(s) - 'snapshot';
end $function$;

-- An address change returns the plan for the FULL chain, also while a change is in progress.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.job_address_apply'::regproc);
  d := replace(d, $q$ds.status in ('for_review','for_confirmation','for_approval','approved')$q$,
                  $q$ds.status in ('for_review','for_confirmation','for_approval','for_change_approval','approved')$q$);
  d := replace(d, $q$update delivery_schedules set status = 'returned', returned_from = s.status, approved_at = null,$q$,
                  $q$update delivery_schedules set status = 'returned', returned_from = s.status, approved_at = null, change_mode = false, change_request_id = null,$q$);
  if position('for_change_approval' in d) = 0 or position('change_mode = false' in d) = 0 then raise exception 'job_address_apply patch did not apply'; end if;
  execute d;
end $$;
