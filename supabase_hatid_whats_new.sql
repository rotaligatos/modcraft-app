-- HATID What's new: remember which releases each person closed (2026-11-25). Applied.
alter table job_staff add column if not exists whats_new_seen text[] not null default '{}';
create or replace function public.hatid_wn_seen(p_ids text[]) returns text[] language sql security definer set search_path to 'public' as $$
  update job_staff set whats_new_seen = (select array(select distinct x from unnest(whats_new_seen || coalesce(p_ids, '{}')) x where x <> '' order by x))
   where id = auth.uid() and active returning whats_new_seen;
$$;
revoke all on function public.hatid_wn_seen(text[]) from public, anon;
grant execute on function public.hatid_wn_seen(text[]) to authenticated;
