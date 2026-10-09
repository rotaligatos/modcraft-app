-- Test quotations (QT-X…, 2026-10-10) — APPLIED as migration hide_test_quotations_from_non_admins.
-- A test quotation runs the whole live chain (gate, MRF, Job Order, PMES) so it can be tested end
-- to end, but its records must never appear to anyone except an Admin/Director. A RESTRICTIVE select
-- policy on every downstream table that carries the quotation number; writes are untouched.
-- Verified by impersonation (rolled back): PMES staff and supervisor see 0 test jobs and still see
-- real jobs; a Modcraft/PMES admin sees the test job.
create or replace function public.app_sees_test() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_is_admin_tier(),false)
      or coalesce(public.ks_is_admin_tier(),false)
      or coalesce(public.pmes_rank(),0) >= 40
$$;
revoke all on function public.app_sees_test() from public;
grant execute on function public.app_sees_test() to authenticated;

create policy "hide test quotations" on public.adm_material_requests as restrictive for select to authenticated
  using (coalesce(quotation_serial,'') not like 'QT-X%' or public.app_sees_test());
create policy "hide test quotations" on public.adm_purchase_requests as restrictive for select to authenticated
  using (coalesce(quotation_serial,'') not like 'QT-X%' or public.app_sees_test());
create policy "hide test quotations" on public.adm_release_gates as restrictive for select to authenticated
  using (coalesce(quotation_serial,'') not like 'QT-X%' or public.app_sees_test());
create policy "hide test quotations" on public.adm_deliveries as restrictive for select to authenticated
  using (coalesce(quotation_serial,'') not like 'QT-X%' or public.app_sees_test());
create policy "hide test quotations" on public.pmes_production_jobs as restrictive for select to authenticated
  using (coalesce(quotation_serial,'') not like 'QT-X%' or public.app_sees_test());
create policy "hide test quotations" on public.pmes_board_requests as restrictive for select to authenticated
  using (coalesce(quotation_serial,'') not like 'QT-X%' or public.app_sees_test());
create policy "hide test quotations" on public.job_orders as restrictive for select to authenticated
  using (coalesce(serial,'') not like 'QT-X%' or public.app_sees_test());
