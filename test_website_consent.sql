-- TEST for supabase_website_consent.sql — CHANGES NOTHING. Run it, then send the red TEST RESULT line.
begin;
alter table public.pending_orders add column if not exists consent_at timestamptz;
drop policy if exists "website orders need privacy consent" on public.pending_orders;
create policy "website orders need privacy consent" on public.pending_orders as restrictive for insert to anon, authenticated
  with check (coalesce(order_kind, '') not in ('Cutting List', 'Service Request', 'Site Visit') or consent_at is not null);
create or replace function pg_temp.try(p_kind text, p_consent boolean) returns text language plpgsql as $f$
begin
  execute 'set local role anon';
  begin
    insert into public.pending_orders(id,received_at,order_kind,status,source_company,request_type,client_name,consent_at)
    values ('QA-C-'||md5(random()::text),now(),p_kind,'Pending','Module Systems and Services, Inc.','New','QA',case when p_consent then now() end);
    execute 'reset role'; return 'ok';
  exception when others then execute 'reset role'; return 'REFUSED';
  end;
end $f$;
do $$
declare r text;
begin
  r := '1 website order WITHOUT consent: '||pg_temp.try('Service Request',false)||' (want REFUSED) | '
    || '2 website order WITH consent: '||pg_temp.try('Cutting List',true)||' (want ok) | '
    || '3 Wufoo without consent: '||pg_temp.try('Wufoo',false)||' (want ok) | '
    || '4 site visit without consent: '||pg_temp.try('Site Visit',false)||' (want REFUSED)';
  raise exception 'TEST RESULT (nothing was saved): %', r;
end $$;
