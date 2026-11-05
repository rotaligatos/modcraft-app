-- Client-supplied items count toward "materials complete" (2026-11-05).
-- pmes_job_material_state read the MRF only, so a job showed "Materials complete" while client items
-- were unchecked, and a supervisor could give a single approval on a job that needed a manager.
-- Complete now means: every MRF line received and passed by QA, AND every client item received OK
-- and passed by QA. Same test pmes_jo_check already used for client items.

create or replace function public.pmes_job_material_state(p_job uuid)
returns jsonb
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
  with m as (
    select count(l.id) as lines,
           count(*) filter (where l.qty_received - l.qa_damaged_qty >= l.qty and l.qa_result is not null) as lines_complete,
           count(*) filter (where l.qty_received > 0 and l.qa_result is null) as to_inspect,
           count(*) filter (where l.qa_result = 'damaged') as damaged,
           coalesce(sum(l.qty),0) as requested,
           coalesce(sum(l.qty_received),0) as received
    from public.adm_material_requests r join public.adm_mr_lines l on l.mr_id = r.id
    where r.pmes_job_id = p_job and r.status not in ('draft','cancelled')
  ), c as (
    select count(*) as lines,
           count(*) filter (where x.condition = 'ok' and x.qa_result is not null and coalesce(x.qa_damaged_qty,0) = 0) as complete,
           count(*) filter (where x.condition is null) as to_check,
           count(*) filter (where x.condition is not null and x.condition <> 'ok') as problem,
           count(*) filter (where coalesce(x.qty_received,0) > 0 and x.qa_result is null) as to_inspect,
           coalesce(sum(x.qty_received),0) as received
    from public.pmes_client_materials x where x.job_id = p_job
  )
  select case when m.lines = 0 and c.lines = 0 then jsonb_build_object('state','no_mrf','lines',0)
    else jsonb_build_object(
      'state', case when m.lines_complete = m.lines and c.complete = c.lines then 'complete'
                    when m.received > 0 or c.received > 0 then 'partial' else 'none' end,
      'lines', m.lines, 'lines_complete', m.lines_complete, 'to_inspect', m.to_inspect, 'damaged', m.damaged,
      'requested', m.requested, 'received', m.received,
      'client_lines', c.lines, 'client_complete', c.complete, 'client_to_check', c.to_check,
      'client_problem', c.problem, 'client_to_inspect', c.to_inspect) end
  from m, c
$function$;

-- A row with only a size or thickness is still something the client is bringing; only a truly blank
-- row (the app starts the list with one) is skipped.
create or replace function public.pmes_client_materials_seed(p_job uuid)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare s jsonb; n int := 0; r jsonb; i int := 0;
begin
  if exists(select 1 from public.pmes_client_materials where job_id=p_job and source='quotation') then return 0; end if;
  select qs.state into s from public.pmes_production_jobs j join public.quotation_states qs on qs.serial=j.quotation_serial where j.id=p_job;
  if s is null or not coalesce((s->>'clientSupplyMat')::boolean,false) then return 0; end if;
  for r in select * from jsonb_array_elements(coalesce(s->'clientSupplyMatList','[]'::jsonb)) loop
    i := i + 1;
    if btrim(concat_ws('',r->>'brand',r->>'type',r->>'color',r->>'size',r->>'thickness',r->>'texture')) = '' then continue; end if;
    insert into public.pmes_client_materials(job_id,line_no,item,qty_expected,unit,source)
    values (p_job, i, btrim(concat_ws(' · ', nullif(btrim(r->>'type'),''), nullif(btrim(r->>'brand'),''), nullif(btrim(r->>'color'),''), nullif(btrim(r->>'size'),''),
              nullif(btrim(r->>'thickness'),''), nullif(btrim(r->>'texture'),''))), nullif(r->>'qty','')::numeric, 'pcs', 'quotation');
    n := n + 1;
  end loop;
  return n;
end $function$;

-- Materials can stop being complete after staff checked the Job Order (an unlisted client item arrives,
-- QA finds damage). The approval must not go through on the old check. Patched in place so the rest of
-- pmes_jo_approve is untouched.
do $$
declare def text; anchor text; out_ text;
begin
  def := pg_get_functiondef('public.pmes_jo_approve(uuid,text)'::regprocedure);
  anchor := $a$  if j.jo_proceed_incomplete and ms->>'state' = 'complete' then j.jo_proceed_incomplete := false; end if;$a$;
  if position(anchor in def) = 0 then raise exception 'pmes_jo_approve anchor not found'; end if;
  if position('Materials changed after' in def) > 0 then return; end if;
  out_ := replace(def, anchor, anchor || E'\n' ||
    $b$  if not j.jo_proceed_incomplete and ms->>'state' not in ('complete','no_mrf') then
    raise exception 'Materials changed after staff checked this Job Order, and are no longer complete. Staff must check it again.';
  end if;$b$);
  execute out_;
end $$;
