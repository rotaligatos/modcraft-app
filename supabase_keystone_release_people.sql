-- KEYSTONE release approval: two people or one (2026-10-18). Rommel: "give me the flexibility … to
-- match current manpower availability. Right now there's only one person who will handle this."
-- Default stays TWO people (whoever opened the payment gate cannot also release it; an Admin/Director
-- may override with a reason). In ONE-person mode the same person may open the gate and release it,
-- with no override reason. Payment, final-approval and every other release check are unchanged.
-- Changing it: Admin/Director only, recorded in adm_audit_log.

create or replace function public.adm_release_people() returns text
language sql stable security definer set search_path = public as $$
  select case when (select value->>'people' from public.adm_settings where key = 'RELEASE') = 'one' then 'one' else 'two' end
$$;
grant execute on function public.adm_release_people() to authenticated;

create or replace function public.adm_set_release_people(p_people text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := public.app_current_email(); prev text := public.adm_release_people();
begin
  if me is null or me = '' then raise exception 'Not signed in.'; end if;
  if not coalesce(public.ks_is_admin_tier(), false) then raise exception 'Only an Admin or Director can change this.'; end if;
  if p_people not in ('one','two') then raise exception 'Choose one or two.'; end if;
  insert into public.adm_settings(key, value, updated_at)
    values ('RELEASE', jsonb_build_object('people', p_people, 'changed_by', me, 'changed_at', now()), now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into public.adm_audit_log(at, actor, action, entity, entity_id, detail)
    values (now(), me, 'release_people_set', 'adm_settings', 'RELEASE', jsonb_build_object('from', prev, 'to', p_people));
  return jsonb_build_object('ok', true, 'people', p_people, 'from', prev);
end $$;
revoke all on function public.adm_set_release_people(text) from public, anon;
grant execute on function public.adm_set_release_people(text) to authenticated;

-- adm_release_gate: the segregation-of-duties check applies only in two-person mode.
do $$ declare d text; n text;
begin
  d := pg_get_functiondef('public.adm_release_gate(uuid,boolean,text)'::regprocedure);
  n := replace(d, 'if lower(btrim(coalesce(g.created_by,''''))) = me then',
                  'if lower(btrim(coalesce(g.created_by,''''))) = me and public.adm_release_people() = ''two'' then');
  if n = d then raise exception 'adm_release_gate: segregation check not found — nothing changed'; end if;
  execute n;
end $$;
