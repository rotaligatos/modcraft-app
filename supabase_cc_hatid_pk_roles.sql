-- Command Center (Modcraft project nkpekroogqsmfilypowd): HATID users can have several pick-up jobs (Rommel 2026-11-28).
-- pickup_roles = every ticked job; pickup_role stays = the main one (first ticked). Synced to HATID by job-staff-sync.
alter table public.jobboard_users add column if not exists pickup_roles text[];
alter table public.jobboard_users add constraint jobboard_users_pickup_roles_check
  check (pickup_roles is null or (cardinality(pickup_roles) >= 1 and pickup_roles <@ array['sales_support','warehouse','logistics','wh_manager']));
update public.jobboard_users set pickup_roles = array[pickup_role] where pickup_role is not null and pickup_roles is null;
