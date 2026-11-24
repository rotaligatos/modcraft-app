-- 2026-11-24: start-up reads of quotation_states timed out (8 s limit, HTTP 500).
-- quotation_stage_flags / quotation_option_lines / quotation_state_lite each unpacked the whole saved
-- record of every quotation (34 MB), once per column read: 2-3 s on average, and together at login
-- they were cancelled. The few values they need are now worked out once, when a quotation is saved
-- (stored generated columns on the same table, so the same access rules apply unchanged).
-- Every function returns NULL rather than raise, so a strange record can never block a save; the
-- views fall back to the record itself for a NULL.

create or replace function public.qs_flags(p jsonb) returns jsonb language plpgsql immutable parallel safe
set search_path to 'pg_catalog' as $$
declare s jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object' then return null; end if;
  s := p - array['areas','fqAreas','optionsList','log'];       -- one unpack, then small
  return (select jsonb_object_agg(k, s->k) from unnest(array['qCancelled','fqClientApproved','clientApproved','approved',
    'locked','fqLocked','fqStarted','sentStatus','fqSentStatus','initLockedAt','finalLockedAt','voided','savedAt',
    'qClientApproved','fqClientApprovedAt','serial']) k where s ? k);
exception when others then return null;
end $$;

-- [] = read fine, not a quotation with several options; NULL = could not be worked out.
create or replace function public.qs_option_lines(p jsonb) returns jsonb language plpgsql immutable parallel safe
set search_path to 'pg_catalog' as $$
declare ol jsonb; pc jsonb; o jsonb;
begin
  ol := p->'optionsList';
  if jsonb_typeof(ol) is distinct from 'array' or jsonb_array_length(ol) < 2 then return '[]'::jsonb; end if;
  select jsonb_agg(jsonb_build_object('id',e->'id','label',e->>'label','grand',e->'grand',
      'locked',coalesce((e->>'locked')::boolean,false),'status',coalesce(e->>'status','active')) order by (e->>'id')::integer)
    into o from jsonb_array_elements(ol) e;
  pc := p->'pCalc';
  return jsonb_build_object('a',coalesce((p->>'activeOptionId')::integer,0),'g',pc->'grand','o',o);
exception when others then return null;
end $$;

create or replace function public.qs_lite(p jsonb) returns jsonb language plpgsql immutable parallel safe
set search_path to 'pg_catalog' as $$
declare s jsonb; sig jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object' then return null; end if;
  s := p - array['optionsList','log','costReport','lockedRates','fqLockedRates','areas','fqAreas','mobCalc','mobTransport',
                 'mobAccom','drawingAnalysis','boardLayout','clientSupplyMatList'];
  select jsonb_object_agg(e.k, case when jsonb_typeof(e.v)='object' then e.v - 'img' else e.v end) into sig
    from jsonb_each(case when jsonb_typeof(s->'signatures')='object' then s->'signatures' else '{}'::jsonb end) e(k,v);
  return s || jsonb_build_object('signatures', coalesce(sig,'{}'::jsonb));
exception when others then return null;
end $$;

grant execute on function public.qs_flags(jsonb), public.qs_option_lines(jsonb), public.qs_lite(jsonb) to authenticated, service_role;

alter table public.quotation_states
  add column if not exists flags jsonb generated always as (public.qs_flags(state)) stored,
  add column if not exists option_lines jsonb generated always as (public.qs_option_lines(state)) stored,
  add column if not exists lite jsonb generated always as (public.qs_lite(state)) stored;

create or replace view public.quotation_stage_flags with (security_invoker=true) as
select serial,
  (f->>'qCancelled')::boolean as q_cancelled, (f->>'fqClientApproved')::boolean as fq_client_approved,
  (f->>'clientApproved')::boolean as client_approved, (f->>'approved')::boolean as approved,
  (f->>'locked')::boolean as locked, (f->>'fqLocked')::boolean as fq_locked, (f->>'fqStarted')::boolean as fq_started,
  coalesce(f->>'sentStatus','') as sent_status, coalesce(f->>'fqSentStatus','') as fq_sent_status,
  coalesce(f->>'initLockedAt','') as init_locked_at, coalesce(f->>'finalLockedAt','') as final_locked_at,
  coalesce((f->>'voided')::boolean,false) as voided, coalesce(f->>'savedAt','') as saved_at
from (select serial, coalesce(flags,state) f from public.quotation_states) x;

create or replace view public.quotation_option_lines with (security_invoker=true) as
select serial, (l->>'a')::integer as active_id, (l->>'g')::numeric as active_grand, l->'o' as opts
from (select serial, coalesce(option_lines, public.qs_option_lines(state)) l from public.quotation_states) x
where jsonb_typeof(l)='object';

create or replace view public.quotation_state_lite with (security_invoker=true) as
select serial, coalesce(lite, public.qs_lite(state)) as state from public.quotation_states;

-- Price list: "newest row" was a scan of all 153k rows at every login.
create index if not exists price_materials_updated_at on public.price_materials (updated_at);

-- Everything the app asks about the price list's fast copy, in one read instead of five.
create or replace function public.price_materials_stamp() returns jsonb language sql stable security invoker
set search_path to 'public','pg_catalog' as $$
  select jsonb_build_object('n',(select count(*) from price_materials),'max_id',(select max(id) from price_materials),
    'updated_at',(select updated_at from price_materials order by updated_at desc nulls last limit 1),
    'expected',(select (value->>'count')::bigint from settings where key='PRICEDB_MATERIALS_COUNT' and jsonb_typeof(value->'count')='number'))
$$;
revoke execute on function public.price_materials_stamp() from public, anon;
grant execute on function public.price_materials_stamp() to authenticated, service_role;
