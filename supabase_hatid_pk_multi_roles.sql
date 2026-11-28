-- HATID: one person can hold several pick-up jobs (Rommel 2026-11-28).
-- Why: WCLI Annex has no Logistics staff, so the Annex warehouse checker also loads and releases.
-- job_staff.pickup_roles = every pick-up job the person does. job_staff.pickup_role stays as the MAIN job
-- (first in the list): it picks the default Pick-up screen and the label, and old checks
-- ("pickup_role is not null" = is on the pick-up team) keep working unchanged.
-- Every check that asks "does this person do job X" now reads pickup_roles.
-- Applied to the HATID project (nssviuuagtlvxjvvvagt) 2026-11-28.

alter table public.job_staff add column if not exists pickup_roles text[];
alter table public.job_staff drop constraint if exists job_staff_pickup_roles_check;
alter table public.job_staff add constraint job_staff_pickup_roles_check
  check (pickup_roles is null or (cardinality(pickup_roles) >= 1 and pickup_roles <@ array['sales_support','warehouse','logistics','wh_manager']));

-- Keep the two in step. pickup_roles wins when it is written; a write of pickup_role alone (older sync) becomes a one-job list.
create or replace function public.job_staff_sync_pk_roles() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.pickup_roles is not distinct from old.pickup_roles and new.pickup_role is distinct from old.pickup_role
     and (new.pickup_role is null or not new.pickup_role = any(coalesce(new.pickup_roles, '{}'))) then
    new.pickup_roles := case when new.pickup_role is null then null else array[new.pickup_role] end;
  end if;
  if new.pickup_roles is not null then
    select nullif(array_agg(distinct r order by r), '{}') into new.pickup_roles from unnest(new.pickup_roles) r where r is not null;
  end if;
  if new.pickup_roles is null and new.pickup_role is not null and tg_op = 'INSERT' then new.pickup_roles := array[new.pickup_role]; end if;
  if new.pickup_roles is null then new.pickup_role := null;
  elsif new.pickup_role is null or not new.pickup_role = any(new.pickup_roles) then
    -- main job: the first one in the usual order
    new.pickup_role := (select r from unnest(array['sales_support','warehouse','wh_manager','logistics']) r where r = any(new.pickup_roles) limit 1);
  end if;
  return new;
end $$;
drop trigger if exists job_staff_sync_pk_roles on public.job_staff;
create trigger job_staff_sync_pk_roles before insert or update on public.job_staff for each row execute function public.job_staff_sync_pk_roles();

update public.job_staff set pickup_roles = array[pickup_role] where pickup_role is not null and pickup_roles is null;

-- Sales Support may upload delivery tickets
drop policy if exists jobs_sales_support_insert on public.jobs;
create policy jobs_sales_support_insert on public.jobs for insert to authenticated with check (
  status = 'proposed' and truck_id is null and exists (select 1 from job_staff s where s.id = auth.uid() and s.active
    and 'sales_support' = any(coalesce(s.pickup_roles, '{}')) and (s.companies is null or jobs.company = any(s.companies))));

-- Rewrite the job checks inside the functions (exact text replaced; stops if a pattern is not found)
do $$
declare f record; d text; n text;
  rep text[][] := array[
    array[$a$coalesce(me.pickup_role, '') <> 'sales_support'$a$, $a$not ('sales_support' = any(coalesce(me.pickup_roles, '{}')))$a$],
    array[$a$coalesce(me.pickup_role, '') = 'sales_support'$a$,  $a$'sales_support' = any(coalesce(me.pickup_roles, '{}'))$a$],
    array[$a$s.pickup_role in ('warehouse','wh_manager')$a$,     $a$s.pickup_roles && array['warehouse','wh_manager']$a$],
    array[$a$s.pickup_role = 'sales_support'$a$,                 $a$'sales_support' = any(coalesce(s.pickup_roles, '{}'))$a$],
    array[$a$s.pickup_role = any(p_roles)$a$,                    $a$s.pickup_roles && p_roles$a$],
    array[$a$(s.pickup_role = 'wh_manager' and 'warehouse' = any(p_roles))$a$, $a$('wh_manager' = any(coalesce(s.pickup_roles, '{}')) and 'warehouse' = any(p_roles))$a$]];
  i int;
begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public' and p.proname in ('job_address_change','pk_from_delivery','pk_to_delivery','job_load_problem','job_ss_notify','job_prep_can','job_ss_can','pk_can','pk_notify') loop
    d := pg_get_functiondef(f.oid); n := d;
    for i in 1 .. array_length(rep, 1) loop n := replace(n, rep[i][1], rep[i][2]); end loop;
    if n = d then raise exception 'No pick-up job check found in %', f.proname; end if;
    if n ~ 's\.pickup_role\s*(=|in)\s' or n ~ 'me\.pickup_role, ''''\)' then raise exception 'Unconverted check left in %', f.proname; end if;
    execute n;
  end loop;
end $$;
