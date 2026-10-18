-- Admin TEST orders (2026-10-18) — APPLIED as migration admin_test_orders.
-- An order is a test when it comes from a website test account (Command Center › Website), or when
-- an Admin/Director makes one in Modcraft ("New test order"). The client's is_test is ignored for
-- anyone else, so nobody can hide a real order by marking it a test.
-- Verified by impersonation (rolled back): Admin insert keeps is_test=true; Staff and anon -> false.
create or replace function public.pending_orders_mark_test() returns trigger language plpgsql security definer set search_path to 'public' as $f$
begin
  new.is_test := public.website_is_test(new.customer_email)
              or (coalesce(new.is_test,false) and coalesce(public.app_is_admin_tier(),false));
  return new;
end $f$;
