-- Test quotations (QT-X) in PMES: hide the job's CHILD rows too (2026-10-18).
-- supabase_test_quotations.sql hid pmes_production_jobs rows for QT-X from everyone but admins, but a
-- dry-run release showed PMES staff could still read the test job's 86 parts and its processes.
-- Same rule on every pmes_* table that hangs off a job. The helper is SECURITY DEFINER on purpose:
-- checked through RLS, a hidden test job would look like "no job" and its children would show.
create or replace function public.pmes_job_is_test(p_job uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.pmes_production_jobs j where j.id = p_job and coalesce(j.quotation_serial,'') like 'QT-X%')
$$;
create or replace function public.pmes_component_is_test(p_comp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.pmes_components c join public.pmes_production_jobs j on j.id = c.job_id
                where c.id = p_comp and coalesce(j.quotation_serial,'') like 'QT-X%')
$$;
revoke all on function public.pmes_job_is_test(uuid) from public;
revoke all on function public.pmes_component_is_test(uuid) from public;
grant execute on function public.pmes_job_is_test(uuid) to authenticated;
grant execute on function public.pmes_component_is_test(uuid) to authenticated;

do $$ declare t text; begin
  foreach t in array array['pmes_boards','pmes_component_done','pmes_components','pmes_cut_plans','pmes_jo_reviews',
    'pmes_job_materials','pmes_job_stages','pmes_material_withdrawals','pmes_packing_lists','pmes_process_jos',
    'pmes_production_runs','pmes_schedule_decisions','pmes_stage_outputs'] loop
    execute format('drop policy if exists "hide test quotations" on public.%I', t);
    execute format('create policy "hide test quotations" on public.%I as restrictive for select to authenticated
      using (job_id is null or not public.pmes_job_is_test(job_id) or public.app_sees_test())', t);
  end loop;
end $$;
drop policy if exists "hide test quotations" on public.pmes_component_stage_events;
create policy "hide test quotations" on public.pmes_component_stage_events as restrictive for select to authenticated
  using (component_id is null or not public.pmes_component_is_test(component_id) or public.app_sees_test());
