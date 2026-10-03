-- HATID: removing or replacing a sales agent (Settings › Sales agents › Edit › Remove agent)
-- Run once in the Supabase SQL editor of the HATID project (nssviuuagtlvxjvvvagt).
--
-- Rule (Rommel, 2026-10-03): an agent who leaves is ARCHIVED, never deleted, so every past job
-- and pick-up keeps their name. A plain delete would blank the agent on those records
-- (jobs.agent_id and pk_orders.agent_id are ON DELETE SET NULL).
--
-- Reasons:
--   'mistake'   entered by mistake / duplicate → deleted for good, only when it holds no records
--   'replaced'  left, a new agent takes over   → archived, linked to the replacement (replaced_by);
--                                                open jobs and pick-ups move to the replacement
--   'left'      left, no replacement yet       → archived; open jobs and pick-ups are left
--                                                without an agent so nothing goes to someone who left
-- Finished records always keep the original agent.
-- Office staff (admin, manager, dispatcher) covering the agent's company only.

alter table public.job_agents
  add column if not exists archived_at timestamptz,
  add column if not exists archived_reason text,
  add column if not exists archived_note text,
  add column if not exists archived_by text,
  add column if not exists replaced_by uuid references public.job_agents(id) on delete set null;

do $$ begin
  alter table public.job_agents add constraint job_agents_archived_reason_check
    check (archived_reason is null or archived_reason in ('replaced','left'));
exception when duplicate_object then null; end $$;

create or replace function public.job_agent_remove(p_agent uuid, p_reason text, p_replacement uuid default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a job_agents%rowtype; r job_agents%rowtype; who text; nj int; np int; used text[] := '{}'; mj int := 0; mp int := 0;
begin
  if p_reason not in ('mistake','replaced','left') then raise exception 'Choose why the agent is going'; end if;
  select * into a from job_agents where id = p_agent;
  if not found then raise exception 'Agent not found'; end if;
  if a.archived_at is not null then raise exception '% is already archived', a.name; end if;
  select coalesce(s.name, s.email) into who from job_staff s
   where s.id = auth.uid() and s.active and s.role in ('admin','manager','dispatcher')
     and (s.companies is null or a.company is null or a.company = any(s.companies));
  if who is null then raise exception 'Only office staff covering this company can remove an agent'; end if;

  select count(*) into nj from jobs where agent_id = p_agent;
  select count(*) into np from pk_orders where agent_id = p_agent;
  if nj > 0 then used := used || (nj || ' job' || case when nj = 1 then '' else 's' end); end if;
  if np > 0 then used := used || (np || ' pick-up' || case when np = 1 then '' else 's' end); end if;

  if p_reason = 'mistake' then
    if coalesce(array_length(used, 1), 0) > 0 then
      return jsonb_build_object('result', 'refused', 'used', to_jsonb(used));
    end if;
    delete from job_agents where id = p_agent;
    return jsonb_build_object('result', 'deleted', 'name', a.name);
  end if;

  if p_reason = 'replaced' then
    if p_replacement is null then raise exception 'Choose the agent who takes over'; end if;
    if p_replacement = p_agent then raise exception 'An agent cannot replace themselves'; end if;
    select * into r from job_agents where id = p_replacement;
    if not found or not r.active or r.archived_at is not null then raise exception 'The replacement must be an active agent'; end if;
    if r.company is not null and r.company is distinct from a.company then
      raise exception 'The replacement belongs to %, not %', r.company, coalesce(a.company, 'all companies');
    end if;
    update jobs set agent_id = p_replacement
     where agent_id = p_agent and status in ('proposed','scheduled','dispatched','in_progress','issue');
    get diagnostics mj = row_count;
    update pk_orders set agent_id = p_replacement
     where agent_id = p_agent and status in ('open','in_queue','balance');
    get diagnostics mp = row_count;
  else
    update jobs set agent_id = null
     where agent_id = p_agent and status in ('proposed','scheduled','dispatched','in_progress','issue');
    get diagnostics mj = row_count;
    update pk_orders set agent_id = null
     where agent_id = p_agent and status in ('open','in_queue','balance');
    get diagnostics mp = row_count;
  end if;

  update job_agents set active = false, archived_at = now(), archived_reason = p_reason,
         archived_note = nullif(btrim(coalesce(p_note, '')), ''), archived_by = who,
         replaced_by = case when p_reason = 'replaced' then p_replacement end, updated_at = now()
   where id = p_agent;
  return jsonb_build_object('result', 'archived', 'name', a.name, 'replacement', r.name,
    'moved_jobs', mj, 'moved_pickups', mp, 'kept', to_jsonb(used));
end $$;

-- Undo an archive done by mistake. The agent comes back active; jobs moved to a replacement stay
-- with the replacement (change them one by one if needed).
create or replace function public.job_agent_restore(p_agent uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a job_agents%rowtype;
begin
  select * into a from job_agents where id = p_agent;
  if not found then raise exception 'Agent not found'; end if;
  if not exists (select 1 from job_staff s where s.id = auth.uid() and s.active and s.role in ('admin','manager','dispatcher')
       and (s.companies is null or a.company is null or a.company = any(s.companies))) then
    raise exception 'Only office staff covering this company can restore an agent';
  end if;
  update job_agents set active = true, archived_at = null, archived_reason = null, archived_note = null,
         archived_by = null, replaced_by = null, updated_at = now() where id = p_agent;
  return jsonb_build_object('result', 'restored', 'name', a.name);
end $$;

revoke all on function public.job_agent_remove(uuid, text, uuid, text) from public, anon;
revoke all on function public.job_agent_restore(uuid) from public, anon;
grant execute on function public.job_agent_remove(uuid, text, uuid, text) to authenticated;
grant execute on function public.job_agent_restore(uuid) to authenticated;
