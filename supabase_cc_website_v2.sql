-- ============================================================================
-- 2026-10-04 (v2) — Suspension applies to EVERYONE, staff included.
-- In v1 staff (app_is_internal) were exempt from both the switches and suspension. Rommel suspended
-- his own Yahoo account (a Command Center Manager) and nothing changed. The staff exemption is right
-- for the SWITCHES (test while closed to the public) but wrong for a deliberate suspension.
-- Only the portal side is affected: a suspended staff account can still use every staff app.
-- ============================================================================
drop policy if exists "website switches and suspension (signed in)" on public.pending_orders;
create policy "website switches and suspension (signed in)" on public.pending_orders as restrictive for insert to authenticated
  with check (not public.website_client_suspended((select public.app_current_email()))
              and ((select public.app_is_internal()) or public.website_accepts(order_kind)));

drop policy if exists "suspended clients cannot edit" on public.client_accounts;
create policy "suspended clients cannot edit" on public.client_accounts as restrictive for update to authenticated
  using (not public.website_client_suspended(email))
  with check (not public.website_client_suspended(email));
