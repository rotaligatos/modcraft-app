-- HATID pick-up: one client's tickets that are in the queue at the same time are timed together (Rommel 2026-11-25)
-- Several queue numbers for the same client, same day, site and company, whose stays overlap (a number checked in
-- before the earlier ones were released) form one group. Promptness = the group's whole stay (first arrival to last
-- release) ÷ all its SOs. per_so / within on each member hold the GROUP figure, so every report follows it.
-- own_per_so keeps the number's own figure. Late tickets and balances are not timed and never join a group.
alter table pk_visits add column if not exists grp_id uuid;
alter table pk_visits add column if not exists grp_so int;
alter table pk_visits add column if not exists own_per_so numeric;

create or replace function pk_grp_key(p_client text, p_id uuid) returns text language sql immutable as $$
  select coalesce(nullif(lower(regexp_replace(btrim(coalesce(p_client, '')), '\s+', ' ', 'g')), ''), p_id::text)
$$;

-- Groups for one client on one day/site. p_pretend / p_pretend_end: treat that visit as released at that time
-- (used to decide at release whether a reason is needed). Open members keep the group open.
create or replace function pk_groups(p_day date, p_site text, p_company text, p_key text, p_pretend uuid default null, p_pretend_end timestamptz default null)
returns table(visit_id uuid, grp uuid, g_start timestamptz, g_end timestamptz, g_so int, g_open boolean, g_n int)
language plpgsql stable set search_path to 'public' as $$
declare r record; ids uuid[] := '{}'; gs uuid[] := '{}'; cur uuid; c_start timestamptz; c_end timestamptz; c_open boolean; e timestamptz;
  starts jsonb := '{}'; ends jsonb := '{}'; sos jsonb := '{}'; opens jsonb := '{}'; ns jsonb := '{}'; i int;
begin
  for r in select v.id, v.arrived_at, v.status, coalesce(v.first_loaded_at, v.loaded_at) as fl, greatest(coalesce(v.so_count, 1), 1) as so
             from pk_visits v
            where v.queue_day = p_day and v.site = p_site and v.company = p_company and v.status <> 'cancelled'
              and v.counted and not coalesce(v.is_balance, false) and pk_grp_key(v.client_name, v.id) = p_key
            order by v.arrived_at, v.id loop
    e := case when r.id = p_pretend then p_pretend_end when r.status = 'done' then r.fl else null end;
    if cur is null or (not c_open and r.arrived_at > c_end) then
      cur := r.id; c_start := r.arrived_at; c_end := e; c_open := (e is null);
    else
      if e is null then c_open := true; elsif c_end is null or e > c_end then c_end := e; end if;
    end if;
    ids := ids || r.id; gs := gs || cur;
    starts := starts || jsonb_build_object(cur::text, c_start);
    ends := ends || jsonb_build_object(cur::text, c_end);
    opens := opens || jsonb_build_object(cur::text, c_open);
    sos := sos || jsonb_build_object(cur::text, coalesce((sos->>cur::text)::int, 0) + r.so);
    ns := ns || jsonb_build_object(cur::text, coalesce((ns->>cur::text)::int, 0) + 1);
  end loop;
  for i in 1 .. coalesce(array_length(ids, 1), 0) loop
    visit_id := ids[i]; grp := gs[i];
    g_start := (starts->>grp::text)::timestamptz; g_end := (ends->>grp::text)::timestamptz;
    g_so := (sos->>grp::text)::int; g_open := (opens->>grp::text)::boolean; g_n := (ns->>grp::text)::int;
    return next;
  end loop;
end $$;

-- Write the group figures onto the members. Only multi-number groups change per_so/within; a number that was in
-- a group but no longer is gets its own figure back.
create or replace function pk_regroup(p_visit uuid) returns void language plpgsql security definer set search_path to 'public' as $$
declare v pk_visits; g record; ps numeric;
begin
  select * into v from pk_visits where id = p_visit;
  if v.id is null then return; end if;
  for g in select * from pk_groups(v.queue_day, v.site, v.company, pk_grp_key(v.client_name, v.id)) loop
    if g.g_n > 1 then
      ps := case when g.g_end is not null then round(extract(epoch from g.g_end - g.g_start) / 60.0 / g.g_so, 1) end;
      update pk_visits x set grp_id = g.grp, grp_so = g.g_so,
             own_per_so = coalesce(x.own_per_so, x.per_so),
             per_so = case when x.status = 'done' and ps is not null then ps else x.per_so end,
             within = case when x.status = 'done' and ps is not null then ps <= coalesce(x.target_min, 15) else x.within end
       where x.id = g.visit_id;
    else
      update pk_visits x set grp_id = null, grp_so = null, own_per_so = null,
             per_so = coalesce(x.own_per_so, x.per_so),
             within = case when x.status = 'done' then coalesce(x.own_per_so, x.per_so) <= coalesce(x.target_min, 15) else x.within end
       where x.id = g.visit_id and x.grp_id is not null;
    end if;
  end loop;
end $$;
revoke all on function pk_regroup(uuid) from public, anon, authenticated;
revoke all on function pk_groups(date, text, text, text, uuid, timestamptz) from public, anon;
grant execute on function pk_groups(date, text, text, text, uuid, timestamptz) to authenticated;

-- Projected per-SO minutes for a visit released at p_end (its group's figure)
create or replace function pk_grp_per_so(p_visit uuid, p_end timestamptz) returns numeric language plpgsql stable set search_path to 'public' as $$
declare v pk_visits; g record;
begin
  select * into v from pk_visits where id = p_visit;
  select * into g from pk_groups(v.queue_day, v.site, v.company, pk_grp_key(v.client_name, v.id), v.id, p_end) where visit_id = v.id;
  if g.visit_id is null or g.g_n <= 1 then return round(round(extract(epoch from p_end - v.arrived_at) / 60.0, 1) / greatest(coalesce(v.so_count, 1), 1), 1); end if;
  return round(extract(epoch from coalesce(g.g_end, p_end) - g.g_start) / 60.0 / g.g_so, 1);
end $$;

-- pk_step: the reason is needed when the GROUP goes over; after release, regroup the client's numbers
do $do$
declare d text := pg_get_functiondef('public.pk_step(uuid,text,text[],jsonb)'::regprocedure);
  a1 text := 'if v.counted and not coalesce(v.is_balance, false) and round(v_min / greatest(v.so_count, 1), 1) > v_tgt then';
  b1 text := 'if v.counted and not coalesce(v.is_balance, false) and pk_grp_per_so(v.id, coalesce(v.first_loaded_at, now())) > v_tgt then';
  a2 text := E'    if v_or is not null then perform pk_log(null, v.id, ''over_reason''';
  b2 text := E'    perform pk_regroup(v.id); select * into v from pk_visits where id = v.id;\n    if v_or is not null then perform pk_log(null, v.id, ''over_reason''';
begin
  if position(a1 in d) = 0 or position(a2 in d) = 0 then raise exception 'pk_step has changed — patch not applied'; end if;
  d := replace(replace(d, a1, b1), a2, b2);
  execute d;
end $do$;

-- Re-time past records (Rommel 2026-11-25). Keep the old figures first.
create table if not exists pk_visits_pre_group_bak as select id, per_so, within, now() as saved_at from pk_visits where false;
insert into pk_visits_pre_group_bak select id, per_so, within, now() from pk_visits where status = 'done' and id not in (select id from pk_visits_pre_group_bak);
alter table pk_visits_pre_group_bak enable row level security;
do $b$ declare r record; begin
  for r in select distinct on (queue_day, site, company, pk_grp_key(client_name, id)) id from pk_visits
            where counted and not coalesce(is_balance, false) and status <> 'cancelled' and coalesce(btrim(client_name), '') <> ''
            order by queue_day, site, company, pk_grp_key(client_name, id), arrived_at loop
    perform pk_regroup(r.id);
  end loop;
end $b$;
