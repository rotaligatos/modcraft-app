-- ============================================================================
-- 2026-10-04 — Privacy consent on website orders (Data Privacy Act, RA 10173).
-- The portal now asks for consent to the Privacy Notice (privacy.html) on all three forms and sends
-- consent_at. This records it, and REFUSES a website order without it — so consent cannot be skipped
-- by an old cached page or a direct API call. Wufoo and anything that is not a website form are
-- never affected. Staff are NOT exempt: a test order must tick the box like a client.
-- Run this BEFORE the new portal.html goes live (the new page sends consent_at).
-- ============================================================================
alter table public.pending_orders add column if not exists consent_at timestamptz;

drop policy if exists "website orders need privacy consent" on public.pending_orders;
create policy "website orders need privacy consent" on public.pending_orders as restrictive for insert to anon, authenticated
  with check (coalesce(order_kind, '') not in ('Cutting List', 'Service Request', 'Site Visit') or consent_at is not null);

-- ROLLBACK (if ever needed):
--   drop policy "website orders need privacy consent" on public.pending_orders;   -- the column may stay
