-- Order file queue (2026-10-18).
-- One row per attachment a person has touched. A file with no row is "waiting".
-- Claims and status changes go through two functions so the rules are in the database:
--   * a file held by someone else can be taken over by Supervisor/Manager/Director/Admin any time,
--     by anyone else only after the claim is 2 hours old; every takeover is kept in history;
--   * a finished file (imported / reflected / done) is only reopened on purpose (p_force), logged.
-- Staff only, and only for orders the person can already see (pending_orders RLS applies inside).

create table if not exists public.order_files (
  order_id          text not null,
  file_key          text not null,
  file_name         text,
  label             text not null default 'unknown'
                    check (label in ('unknown','cutting_list','drawing','other')),
  status            text not null default 'waiting'
                    check (status in ('waiting','taken','imported','reflected','needs_person','done')),
  reason            text,
  claimed_by        text,
  claimed_by_email  text,
  claimed_at        timestamptz,
  imported_by       text,
  imported_at       timestamptz,
  reflected_serial  text,
  reflected_at      timestamptz,
  history           jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (order_id, file_key)
);

alter table public.order_files enable row level security;
revoke all on public.order_files from anon;
grant select, insert, update on public.order_files to authenticated;

drop policy if exists "staff read order files" on public.order_files;
create policy "staff read order files" on public.order_files for select to authenticated
  using ((select app_is_internal()) and exists (select 1 from public.pending_orders p where p.id = order_id));
drop policy if exists "staff add order files" on public.order_files;
create policy "staff add order files" on public.order_files for insert to authenticated
  with check ((select app_is_internal()) and exists (select 1 from public.pending_orders p where p.id = order_id));
drop policy if exists "staff change order files" on public.order_files;
create policy "staff change order files" on public.order_files for update to authenticated
  using ((select app_is_internal()) and exists (select 1 from public.pending_orders p where p.id = order_id))
  with check ((select app_is_internal()) and exists (select 1 from public.pending_orders p where p.id = order_id));

create or replace function public.order_file_can_override() returns boolean
language sql stable as $$
  select coalesce(app_current_role(), '') in ('Supervisor','Manager','Director','Admin')
$$;

-- Claim a file. Returns {ok, ...}. ok=false says why: held (by someone else) or finished.
create or replace function public.order_file_claim(p_order text, p_key text, p_name text, p_who text, p_force boolean default false)
returns jsonb language plpgsql security invoker as $$
declare
  me text := lower(btrim(coalesce(app_current_email(), '')));
  r public.order_files;
  held boolean; finished boolean; can_take boolean; age interval;
begin
  if not coalesce(app_is_internal(), false) then raise exception 'staff only'; end if;
  insert into public.order_files(order_id, file_key, file_name) values (p_order, p_key, p_name)
    on conflict (order_id, file_key) do nothing;
  select * into r from public.order_files where order_id = p_order and file_key = p_key for update;
  if not found then raise exception 'order % not visible', p_order; end if;

  held := r.status in ('taken','needs_person') and coalesce(r.claimed_by_email,'') <> '' and r.claimed_by_email <> me;
  finished := r.status in ('imported','reflected','done');
  age := now() - coalesce(r.claimed_at, now());
  can_take := order_file_can_override() or age >= interval '2 hours';

  if held and (not p_force or not can_take) then
    return jsonb_build_object('ok', false, 'held', true, 'by', r.claimed_by, 'since', r.claimed_at,
                              'can_take', can_take, 'status', r.status);
  end if;
  if finished and not p_force then
    return jsonb_build_object('ok', false, 'finished', true, 'status', r.status,
                              'by', coalesce(r.imported_by, r.claimed_by), 'at', coalesce(r.reflected_at, r.imported_at, r.claimed_at),
                              'serial', r.reflected_serial);
  end if;

  update public.order_files set
    file_name = coalesce(p_name, file_name),
    status = 'taken', reason = null,
    claimed_by = p_who, claimed_by_email = me, claimed_at = now(), updated_at = now(),
    history = history || jsonb_build_array(jsonb_build_object(
      'event', case when held then 'takeover' when finished then 'reopen'
                    when r.claimed_by_email = me then 'reclaim' else 'claim' end,
      'by', p_who, 'email', me, 'at', now(),
      'from', case when held or finished then r.claimed_by end,
      'prev_status', r.status))
  where order_id = p_order and file_key = p_key;
  return jsonb_build_object('ok', true, 'takeover', held, 'reopened', finished, 'from', r.claimed_by, 'prev_status', r.status);
end $$;

-- Change status/label. Only the holder, or Supervisor and up.
create or replace function public.order_file_set(p_order text, p_key text, p_status text, p_label text,
                                                 p_reason text, p_serial text, p_who text)
returns jsonb language plpgsql security invoker as $$
declare
  me text := lower(btrim(coalesce(app_current_email(), '')));
  r public.order_files;
begin
  if not coalesce(app_is_internal(), false) then raise exception 'staff only'; end if;
  select * into r from public.order_files where order_id = p_order and file_key = p_key for update;
  if not found then return jsonb_build_object('ok', false, 'why', 'not claimed'); end if;
  if coalesce(r.claimed_by_email,'') <> me and not order_file_can_override() then
    return jsonb_build_object('ok', false, 'why', 'held by '||coalesce(r.claimed_by,'someone else'));
  end if;
  update public.order_files set
    status = coalesce(p_status, status),
    label  = coalesce(p_label, label),
    reason = case when p_status is null then reason else p_reason end,
    imported_by = case when p_status = 'imported' then p_who else imported_by end,
    imported_at = case when p_status = 'imported' then now() else imported_at end,
    reflected_serial = case when p_status = 'reflected' then p_serial else reflected_serial end,
    reflected_at = case when p_status = 'reflected' then now() else reflected_at end,
    updated_at = now(),
    history = history || jsonb_build_array(jsonb_build_object(
      'event', coalesce(p_status, 'label'), 'by', p_who, 'email', me, 'at', now(),
      'label', p_label, 'reason', p_reason, 'serial', p_serial))
  where order_id = p_order and file_key = p_key;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.order_file_claim(text,text,text,text,boolean) from anon, public;
revoke all on function public.order_file_set(text,text,text,text,text,text,text) from anon, public;
grant execute on function public.order_file_claim(text,text,text,text,boolean) to authenticated;
grant execute on function public.order_file_set(text,text,text,text,text,text,text) to authenticated;
grant execute on function public.order_file_can_override() to authenticated;
