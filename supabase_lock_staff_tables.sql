-- ============================================================================
-- 2026-10-03 — Signed-in CLIENTS are not staff.
--
-- Why: Google sign-in was opened to outside clients for the MSSI portal. Before
-- that, "authenticated" only ever meant staff, so several tables were written as
-- "any signed-in user may do anything". Proven by impersonation (rolled back):
-- an outsider who signs in with any Google account could UPDATE all 67
-- price_services rows, read/write price_materials (153k) and price_hardware,
-- settings, cabinet_templates, mapping_audit, read adm_settings, tickets,
-- quotation_states/board_layouts, draft job openings, and 22 pending_orders
-- saved with a blank company.
--
-- And the reverse fault: a signed-in client (not staff) could NOT file an order,
-- cutting list or attachment — only anon and staff had insert paths. It looked
-- fine whenever staff tested, because staff pass every policy.
--
-- Fix (additive, reversible — see ROLLBACK at the bottom):
--   1. app_is_internal(): the signed-in email is on ANY active staff list.
--   2. RESTRICTIVE "staff only" policy on the staff tables — ANDed with the
--      existing policies, so staff access is unchanged; clients get nothing.
--   3. pending_orders: clients see only their own / their company's orders and
--      cannot change or delete any.
--   4. job_openings: signed-in non-staff see published openings only.
--   5. Signed-in clients may INSERT orders, cutting lists and attachments, with
--      exactly the same checks anon already has.
-- ============================================================================

create or replace function public.app_is_internal()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    with me as (select public.app_current_email() e)
    select 1 from me where me.e <> '' and (
         exists (select 1 from public.users           where lower(btrim(email)) = me.e and active)
      or exists (select 1 from public.keystone_users  where lower(btrim(email)) = me.e and active)
      or exists (select 1 from public.pmes_users      where lower(btrim(email)) = me.e and active)
      or exists (select 1 from public.cc_access       where lower(btrim(email)) = me.e and active)
      or exists (select 1 from public.shelfsync_users where lower(btrim(email)) = me.e and active)
      or exists (select 1 from public.jobboard_users  where lower(btrim(email)) = me.e and active)))
$$;
revoke all on function public.app_is_internal() from public;
grant execute on function public.app_is_internal() to authenticated;

-- 2. Staff-only tables
do $$
declare t text;
begin
  foreach t in array array['price_materials','price_hardware','price_services','settings',
                           'cabinet_templates','mapping_audit','adm_settings','tickets',
                           'quotation_states','board_layouts']
  loop
    execute format('drop policy if exists "staff only" on public.%I', t);
    execute format('create policy "staff only" on public.%I as restrictive for all to authenticated
                      using ((select public.app_is_internal())) with check ((select public.app_is_internal()))', t);
  end loop;
end $$;

-- 3. pending_orders: clients read only their own; only staff change or delete
drop policy if exists "clients see only their own orders" on public.pending_orders;
create policy "clients see only their own orders" on public.pending_orders
  as restrictive for select to authenticated
  using ((select public.app_is_internal())
         or (coalesce(btrim(customer_email),'') <> ''
             and (lower(btrim(customer_email)) = lower(btrim(coalesce((select public.app_current_email()),'')))
                  or lower(btrim(customer_email)) = any ((select public.client_company_emails())::text[]))));
drop policy if exists "only staff change orders" on public.pending_orders;
create policy "only staff change orders" on public.pending_orders
  as restrictive for update to authenticated
  using ((select public.app_is_internal())) with check ((select public.app_is_internal()));
drop policy if exists "only staff delete orders" on public.pending_orders;
create policy "only staff delete orders" on public.pending_orders
  as restrictive for delete to authenticated
  using ((select public.app_is_internal()));

-- 4. job_openings: drafts are staff-only
drop policy if exists "drafts are staff only" on public.job_openings;
create policy "drafts are staff only" on public.job_openings
  as restrictive for select to authenticated
  using (is_published or (select public.app_is_internal()));

-- 5. Signed-in clients can file — same checks as anon
drop policy if exists "signed-in clients can file orders" on public.pending_orders;
create policy "signed-in clients can file orders" on public.pending_orders for insert to authenticated
  with check (((coalesce(btrim(client_name),'') <> '') or (coalesce(btrim(company_name),'') <> '')
               or (coalesce(btrim(customer_email),'') <> '')) and app_rate_limit_ok('order', 6, 600));
drop policy if exists "signed-in clients can file cutting lists" on public.order_cutting_lists;
create policy "signed-in clients can file cutting lists" on public.order_cutting_lists for insert to authenticated
  with check ((jsonb_typeof(panels) = 'array') and jsonb_array_length(panels) between 1 and 3000
              and app_rate_limit_ok('cutlist', 12, 600));
drop policy if exists "signed-in clients can upload order attachments" on storage.objects;
create policy "signed-in clients can upload order attachments" on storage.objects for insert to authenticated
  with check (bucket_id = 'order-attachments');

-- ROLLBACK (if ever needed):
--   drop policy "staff only" on public.<each table above>;
--   drop policy "clients see only their own orders" on public.pending_orders;
--   drop policy "only staff change orders" on public.pending_orders;
--   drop policy "only staff delete orders" on public.pending_orders;
--   drop policy "drafts are staff only" on public.job_openings;
--   drop policy "signed-in clients can file orders" on public.pending_orders;
--   drop policy "signed-in clients can file cutting lists" on public.order_cutting_lists;
--   drop policy "signed-in clients can upload order attachments" on storage.objects;
--   drop function public.app_is_internal();
