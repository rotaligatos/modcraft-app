-- KEYSTONE acts only on quotations whose Final Quotation the client approved (2026-10-18).
-- Rommel: "Keystone should be able to do anything once the QT is in final quotation and approved by
-- the client status." The app's canvassing section is gone; the database refuses the same things so no
-- other route can do them: a payment gate on a quotation that is not final-approved, and a purchase
-- request from one. (Release already required it — adm_release_gate checks adm_fq_approved.)

create or replace function public.adm_gate_requires_fq() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.adm_fq_approved(new.quotation_serial) then
    raise exception 'Quotation % is not final-approved by the client yet — a payment gate opens only after the client approves the Final Quotation in Modcraft.', new.quotation_serial;
  end if;
  return new;
end $$;
drop trigger if exists adm_gate_requires_fq on public.adm_release_gates;
create trigger adm_gate_requires_fq before insert on public.adm_release_gates
  for each row execute function public.adm_gate_requires_fq();

do $$ declare d text; n text; begin
  d := pg_get_functiondef('public.adm_generate_pr_from_quotation(text,boolean)'::regprocedure);
  n := replace(d, 'v_stage := case when public.adm_fq_approved(p_serial) then ''FQ'' else ''IQ'' end;',
    'if not public.adm_fq_approved(p_serial) then raise exception ''Quotation % is not final-approved by the client yet — purchase requests start after the client approves the Final Quotation.'', p_serial; end if;
  v_stage := ''FQ'';');
  if n = d then raise exception 'adm_generate_pr_from_quotation: stage line not found'; end if;
  execute n;
end $$;

-- Advance canvassing, view only (applied as adm_canvass_list): quotations not yet final-approved that
-- carry outsource items. Runs as the caller, so the release-queue view's company visibility applies.
create or replace function public.adm_canvass_list()
returns table(serial text, client_name text, company text, total numeric, project_name text, prepared_by text, lines bigint, est_total numeric)
language sql stable security invoker set search_path = public as $$
  select q.serial, q.client_name, q.company, q.total, q.project_name, q.prepared_by,
         count(*) as lines, round(coalesce(sum(s.est_amount),0),2) as est_total
    from public.adm_v_release_queue q
    cross join lateral public.adm_material_summary(q.serial) s
   where q.iq_client_approved and not q.fq_client_approved and s.kind like 'outsource%'
   group by q.serial, q.client_name, q.company, q.total, q.project_name, q.prepared_by
   order by q.total desc nulls last
$$;

-- Revised same day (applied as adm_canvass_list_fq_awaiting): the list is now the Final Quotations
-- waiting for the client (status FQ Locked / FQ Awaiting Client Approval), all of them, with their
-- outsource item count (0 allowed). Initial Quotation stage quotations never appear in KEYSTONE.

-- Applied as release_queue_vouched_cols: adm_v_release_queue gains g.vouched_by, g.vouched_at (appended
-- after jo_number), so KEYSTONE can split released jobs into fully paid / with balance / vouched.
