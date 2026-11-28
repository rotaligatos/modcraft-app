-- 2026-11-28 — Approval authority enforced in the database, and delegation with dates.
--
-- Rule (Rommel): whoever is assigned to a request is the one who acts on it, or their active
-- delegate. Admin and Director may re-assign it, or act on it themselves when it is urgent.
-- Everyone else (including the person who raised it) may only cancel it, or accept a counter-offer.
--
-- Before this, one policy covered SELECT/INSERT/UPDATE/DELETE and let the requester update their
-- own row, so a request could be set to "approved" by the person who raised it.

-- 1. Delegation window. Both optional: no "from" = starts now, no "until" = until switched off.
alter table public.users add column if not exists delegate_from date;
alter table public.users add column if not exists delegate_until date;

create or replace function public.app_today_ph() returns date
language sql stable as $$ select (now() at time zone 'Asia/Manila')::date $$;

-- Is the signed-in person the ACTIVE delegate of p_email today?
create or replace function public.app_is_delegate_of(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.users d
    where lower(btrim(d.email)) = lower(btrim(coalesce(p_email,'')))
      and d.active = true and d.delegate_active = true
      and lower(btrim(coalesce(d.delegate_to,''))) = public.app_current_email()
      and public.app_current_email() <> ''
      and (d.delegate_from  is null or d.delegate_from  <= public.app_today_ph())
      and (d.delegate_until is null or d.delegate_until >= public.app_today_ph())
  ) $$;

-- Delegation also grants sight of the delegator's company: same window applies.
create or replace function public.app_visible_companies() returns text[]
language sql stable security definer set search_path = public as $$
  select array_agg(distinct co) from (
    select public.app_normalize_company(u.company) as co from public.users u
    where lower(btrim(u.email)) = public.app_current_email() and u.active = true
    union
    select unnest(u.access_companies) as co from public.users u
    where lower(btrim(u.email)) = public.app_current_email() and u.active = true
    union
    select public.app_normalize_company(d.company) as co from public.users d
    where d.delegate_active = true and lower(btrim(d.delegate_to)) = public.app_current_email()
      and (d.delegate_from  is null or d.delegate_from  <= public.app_today_ph())
      and (d.delegate_until is null or d.delegate_until >= public.app_today_ph())
  ) x where co is not null $$;

-- 2. Policies: same visibility as before, plus the delegate of the assigned person.
drop policy if exists "routing-scoped access" on public.approval_requests;
drop policy if exists "approval read" on public.approval_requests;
drop policy if exists "approval insert" on public.approval_requests;
drop policy if exists "approval update" on public.approval_requests;
drop policy if exists "approval delete" on public.approval_requests;

create policy "approval read" on public.approval_requests for select to authenticated using (
  (select public.app_sees_all_companies())
  or lower(btrim(from_email)) = (select public.app_current_email())
  or lower(btrim(to_email))   = (select public.app_current_email())
  or public.app_is_delegate_of(to_email)
  or ((select public.app_current_role()) = 'Manager' and (
        public.app_normalize_company(company) is null
        or (select public.app_sees_all_companies())
        or public.app_normalize_company(company) = any((select public.app_visible_companies())::text[]))) );

create policy "approval insert" on public.approval_requests for insert to authenticated with check (
  (select public.app_is_admin_tier())
  or lower(btrim(from_email)) = (select public.app_current_email())
  or lower(btrim(to_email))   = (select public.app_current_email())
  or public.app_is_delegate_of(to_email) );

-- Who may TOUCH a row is broad (as before); what they may CHANGE is decided by the trigger below.
create policy "approval update" on public.approval_requests for update to authenticated
  using (
    (select public.app_sees_all_companies())
    or lower(btrim(from_email)) = (select public.app_current_email())
    or lower(btrim(to_email))   = (select public.app_current_email())
    or public.app_is_delegate_of(to_email)
    or ((select public.app_current_role()) = 'Manager' and (
          public.app_normalize_company(company) is null
          or public.app_normalize_company(company) = any((select public.app_visible_companies())::text[]))) )
  with check (true);

create policy "approval delete" on public.approval_requests for delete to authenticated
  using ((select public.app_is_admin_tier()));

-- 3. The decision guard.
-- Runs as the caller (NOT security definer): inside a definer function current_user is always the
-- owner, which would make the server-caller check below let everyone through.
create or replace function public.approval_requests_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  me text := public.app_current_email();
  is_admin boolean;
  assigned boolean;
  requester boolean;
  k text;
  protected text[] := array['reqDisc','cfValues','ctx','sigSlot','decision','amount','counterDisc','optionId','orderId'];
begin
  -- Server-side callers (edge functions with the service role, SQL editor) are not users.
  if me = '' or current_user in ('postgres','service_role','supabase_admin') then return new; end if;
  is_admin := public.app_is_admin_tier();

  if tg_op = 'INSERT' then
    -- An upsert of a row that already exists is an update; the update branch decides it.
    if exists(select 1 from public.approval_requests where id = new.id) then return new; end if;
    if is_admin or lower(btrim(coalesce(new.to_email,''))) = me or public.app_is_delegate_of(new.to_email) then
      return new;
    end if;
    if coalesce(new.status,'pending') <> 'pending' then
      raise exception 'A new request can only be raised as pending.' using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  assigned  := lower(btrim(coalesce(old.to_email,''))) = me or public.app_is_delegate_of(old.to_email);
  requester := lower(btrim(coalesce(old.from_email,''))) = me;
  if is_admin then return new; end if;

  -- Re-assigning is for Admin/Director. The requester may re-route a request still waiting
  -- (e.g. a signature routed back to themselves); the assigned person delegates instead.
  if new.to_email is distinct from old.to_email then
    if not (requester and old.status = 'pending') then
      raise exception 'Only an Admin or Director can re-assign this request.' using errcode = '42501';
    end if;
  end if;
  new.from_email := old.from_email;
  if assigned then return new; end if;

  -- Not the decider. The figures behind the request and who decided it are kept as they were.
  if old.payload is not null then
    foreach k in array protected loop
      if old.payload ? k then
        new.payload := coalesce(new.payload,'{}'::jsonb) || jsonb_build_object(k, old.payload -> k);
      end if;
    end loop;
  end if;
  new.counter_disc := old.counter_disc;
  new.actioned_by  := old.actioned_by;
  new.req_type     := old.req_type;

  if new.status is distinct from old.status then
    if requester and new.status = 'cancelled' and old.status in ('pending','countered') then
      null;
    elsif requester and new.status = 'accepted' and old.status = 'countered' then
      null;
    else
      raise exception 'Only the person this request is assigned to (or their delegate, or an Admin/Director) can decide it.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists approval_requests_guard on public.approval_requests;
create trigger approval_requests_guard before insert or update on public.approval_requests
  for each row execute function public.approval_requests_guard();

-- 4. Self-service delegation: a Manager/Director/Admin sets their own (the Users screen is Admin-only).
create or replace function public.mc_set_own_delegation(p_to text, p_on boolean, p_from date, p_until date)
returns void language plpgsql security definer set search_path = public as $$
declare me text := public.app_current_email(); r text;
begin
  if me = '' then raise exception 'not signed in'; end if;
  select role into r from public.users where lower(btrim(email)) = me and active = true limit 1;
  if r is null or r not in ('Manager','Director','Admin') then
    raise exception 'Only a Manager, Director or Admin can delegate approvals.';
  end if;
  if coalesce(p_on,false) then
    if coalesce(btrim(p_to),'') = '' then raise exception 'Pick who to delegate to.'; end if;
    if lower(btrim(p_to)) = me then raise exception 'You cannot delegate to yourself.'; end if;
    if not exists(select 1 from public.users where lower(btrim(email)) = lower(btrim(p_to)) and active = true) then
      raise exception 'That person is not an active user.';
    end if;
    if p_from is not null and p_until is not null and p_until < p_from then
      raise exception 'The end date is before the start date.';
    end if;
  end if;
  update public.users set
    delegate_to = case when coalesce(p_on,false) then lower(btrim(p_to)) else delegate_to end,
    delegate_active = coalesce(p_on,false),
    delegate_from = case when coalesce(p_on,false) then p_from else null end,
    delegate_until = case when coalesce(p_on,false) then p_until else null end,
    updated_at = now()
  where lower(btrim(email)) = me;
end $$;
revoke all on function public.mc_set_own_delegation(text,boolean,date,date) from public, anon;
grant execute on function public.mc_set_own_delegation(text,boolean,date,date) to authenticated;
revoke all on function public.app_is_delegate_of(text) from public, anon;
grant execute on function public.app_is_delegate_of(text) to authenticated;
