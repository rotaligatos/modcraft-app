-- HATID: remove / replace a wrong photo on a released pick-up (2026-11-27)
-- Logistics (and admin/manager) can change the loading photos of a released queue number.
-- Still 3 to 5 photos, a reason is required, new photos must be in that number's own folder,
-- and the photos taken out are kept (files stay in storage, paths kept on the history line).

alter table public.pk_events add column if not exists photos_removed text[];

create or replace function public.pk_photos_set(p_visit uuid, p_photos text[], p_reason text)
returns pk_visits
language plpgsql security definer set search_path to 'public'
as $function$
declare me job_staff := pk_me(); v pk_visits; p text; v_old text[]; v_rm text[]; v_add int; v_r text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v from pk_visits where id = p_visit for update;
  if v.id is null or not pk_sees(v.company) then raise exception 'Queue number not found.'; end if;
  if not pk_can(array['logistics']) then raise exception 'Only Logistics can change the loading photos.'; end if;
  if v.status <> 'done' then raise exception 'Photos can be changed once % is released.', v.label; end if;
  if v_r is null then raise exception 'Say why the photos are being changed.'; end if;
  if coalesce(array_length(p_photos, 1), 0) not between 3 and 5 then raise exception 'Keep 3 to 5 photos of the loaded items.'; end if;
  v_old := coalesce(v.photo_urls, '{}');
  foreach p in array p_photos loop
    if not (p = any(v_old) or p like 'pickups/' || v.id::text || '/%') then raise exception 'A photo is not from this queue number.'; end if;
  end loop;
  if (select count(distinct x) from unnest(p_photos) x) <> array_length(p_photos, 1) then raise exception 'The same photo is in the list twice.'; end if;
  select coalesce(array_agg(x), '{}') into v_rm from unnest(v_old) x where not x = any(p_photos);
  select count(*) into v_add from unnest(p_photos) x where not x = any(v_old);
  if v_add = 0 and coalesce(array_length(v_rm, 1), 0) = 0 then raise exception 'Nothing was changed.'; end if;
  update pk_visits set photo_urls = p_photos where id = v.id returning * into v;
  insert into pk_events (visit_id, kind, notes, actor, actor_name, photos_removed)
  values (v.id, 'photos_changed',
    concat_ws(' · ', case when coalesce(array_length(v_rm, 1), 0) > 0 then array_length(v_rm, 1) || ' removed' end,
                     case when v_add > 0 then v_add || ' added' end) || '. Reason: ' || v_r,
    me.id, coalesce(me.name, me.email), nullif(v_rm, '{}'));
  return v;
end;
$function$;

revoke all on function public.pk_photos_set(uuid, text[], text) from public, anon;
grant execute on function public.pk_photos_set(uuid, text[], text) to authenticated;
