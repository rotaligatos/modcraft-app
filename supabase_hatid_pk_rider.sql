-- HATID pick-up: who collects for the client (Rommel 2026-11-05).
-- Instead of only "Grab / Lalamove rider", Sales Support picks the service (Grab, Lalamove, Transportify, ...) and
-- records the rider's name, vehicle type and plate. Editable until the number is done or cancelled (e.g. the Grab
-- cancelled because the item would not fit) — a change needs a reason and the earlier rider is kept in rider_history.

alter table public.pk_visits
  add column if not exists rider_service text,
  add column if not exists rider_service_other text,
  add column if not exists rider_name text,
  add column if not exists rider_vehicle text,
  add column if not exists rider_plate text,
  add column if not exists rider_history jsonb not null default '[]'::jsonb;

create or replace function public.pk_rider_text(p_service text, p_other text, p_name text, p_vehicle text, p_plate text)
 returns text language sql immutable as $$
  select concat_ws(' · ',
    case p_service when 'grab' then 'Grab' when 'lalamove' then 'Lalamove' when 'transportify' then 'Transportify'
      when 'borzo' then 'Borzo' when 'moveit' then 'Move It' when 'joyride' then 'JoyRide' when 'toktok' then 'Toktok'
      when 'other' then coalesce(nullif(btrim(p_other), ''), 'Other courier') else null end,
    nullif(btrim(p_name), ''), nullif(btrim(p_vehicle), ''), nullif(btrim(p_plate), ''))
$$;

create or replace function public.pk_set_rider(p_visit uuid, p_rider jsonb, p_reason text default null)
 returns pk_visits language plpgsql security definer set search_path to 'public' as $function$
declare v pk_visits; me job_staff := pk_me();
  s text := lower(nullif(btrim(p_rider->>'service'), ''));
  so text := nullif(btrim(p_rider->>'other'), '');
  n text := nullif(btrim(p_rider->>'name'), '');
  vh text := nullif(btrim(p_rider->>'vehicle'), '');
  pl text := nullif(upper(regexp_replace(btrim(coalesce(p_rider->>'plate', '')), '\s+', ' ', 'g')), '');
  v_old text; v_new text;
begin
  if not pk_can(array['sales_support','logistics']) then raise exception 'Only Sales Support or Logistics can change the rider.'; end if;
  select * into v from pk_visits where id = p_visit for update;
  if v.id is null or not pk_sees(v.company) then raise exception 'Queue number not found.'; end if;
  if not v.courier then raise exception 'This number is not for a courier rider.'; end if;
  if v.status in ('done','cancelled') then raise exception 'This number is closed — the rider can no longer be changed.'; end if;
  if s is null or s not in ('grab','lalamove','transportify','borzo','moveit','joyride','toktok','other') then raise exception 'Pick who is picking up (Grab, Lalamove, ...).'; end if;
  if s = 'other' and so is null then raise exception 'Type the name of the courier service.'; end if;
  if s <> 'other' then so := null; end if;
  v_old := pk_rider_text(v.rider_service, v.rider_service_other, v.rider_name, v.rider_vehicle, v.rider_plate);
  v_new := pk_rider_text(s, so, n, vh, pl);
  if v_old is not distinct from v_new then return v; end if;
  if v.rider_service is not null and nullif(btrim(p_reason), '') is null then
    raise exception 'Say why the rider changed (e.g. the item did not fit the vehicle).'; end if;
  update pk_visits set
    rider_history = case when v.rider_service is null then rider_history else rider_history || jsonb_build_array(jsonb_build_object(
        'service', v.rider_service, 'other', v.rider_service_other, 'name', v.rider_name, 'vehicle', v.rider_vehicle, 'plate', v.rider_plate,
        'replaced_at', now(), 'replaced_by', coalesce(me.name, me.email), 'reason', btrim(p_reason))) end,
    rider_service = s, rider_service_other = so, rider_name = n, rider_vehicle = vh, rider_plate = pl
   where id = p_visit returning * into v;
  perform pk_log(null, v.id, case when v_old is null then 'rider' else 'rider_changed' end,
    case when v_old is null then v_new else v_old || ' → ' || v_new || '. Reason: ' || btrim(p_reason) end);
  return v;
end $function$;

revoke all on function public.pk_set_rider(uuid, jsonb, text) from public, anon;
grant execute on function public.pk_set_rider(uuid, jsonb, text) to authenticated;
