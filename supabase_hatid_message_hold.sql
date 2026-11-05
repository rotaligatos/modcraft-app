-- HATID: hold outgoing messages while the team is practising (Rommel 2026-11-05)
-- Two switches in Settings › Messaging:
--   hold_external — nothing goes to clients or sales agents (SMS, email, their own Chat)
--   hold_all      — nothing goes out at all (company/department Chat spaces, daily summary, no-show report too)
-- Held messages are kept in the outbox as "skipped" with the reason, never sent later.
-- Google Drive photo copies and test messages are never held.

alter table job_notify_settings add column if not exists hold_external boolean not null default false;
alter table job_notify_settings add column if not exists hold_all boolean not null default false;
alter table job_notify_settings add column if not exists hold_by text;
alter table job_notify_settings add column if not exists hold_at timestamptz;

-- Is this outbox row for a client or a sales agent?
create or replace function job_outbox_is_external(o job_outbox) returns boolean language sql immutable as $$
  select o.to_role in ('client','agent')
      or o.kind ~ '_(client|agent)$'
      or (o.kind in ('delivered','partial','returned','issue','delay') and coalesce(o.recipient_label, '') not like '% Chat space')
$$;

create or replace function job_outbox_hold_check(o job_outbox, s job_notify_settings) returns text language sql immutable as $$
  select case
    when o.channel = 'drive' or o.to_role = 'other' then null
    when coalesce(s.hold_all, false) then 'Held — practice period: all HATID messages are switched off'
    when coalesce(s.hold_external, false) and job_outbox_is_external(o) then 'Held — practice period: messages to clients and sales agents are switched off'
  end
$$;

create or replace function job_outbox_hold() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare s job_notify_settings; why text;
begin
  select * into s from job_notify_settings where id;
  if s.id is null or not (coalesce(s.hold_external, false) or coalesce(s.hold_all, false)) then return new; end if;
  why := job_outbox_hold_check(new, s);
  if tg_op = 'UPDATE' and not (new.status = 'pending' and old.status is distinct from 'pending') then return new; end if;   -- a Retry is held too
  if why is not null and new.status in ('pending','sending') then new.status := 'skipped'; new.last_error := why; end if;
  return new;
end $$;

create trigger job_outbox_hold_trg before insert or update of status on job_outbox for each row execute function job_outbox_hold();

-- Switch from the app (admin / manager). Turning a hold on also stops what is already waiting to go.
create or replace function job_set_message_hold(p_external boolean, p_all boolean) returns jsonb
 language plpgsql security definer set search_path to 'public' as $$
declare me job_staff; s job_notify_settings; n int := 0;
begin
  if not job_settings_editor() then raise exception 'Only an admin or manager can change this.'; end if;
  select * into me from job_staff where id = auth.uid();
  update job_notify_settings set hold_external = coalesce(p_external, false) or coalesce(p_all, false), hold_all = coalesce(p_all, false),
         hold_by = coalesce(me.name, me.email, 'admin'), hold_at = now(), updated_at = now()
   where id returning * into s;
  if s.hold_external or s.hold_all then
    with h as (update job_outbox o set status = 'skipped', last_error = job_outbox_hold_check(o, s)
                where o.status = 'pending' and job_outbox_hold_check(o, s) is not null returning 1)
    select count(*) into n from h;
  end if;
  return jsonb_build_object('hold_external', s.hold_external, 'hold_all', s.hold_all, 'stopped', n);
end $$;
revoke all on function job_set_message_hold(boolean, boolean) from public, anon;
grant execute on function job_set_message_hold(boolean, boolean) to authenticated;
revoke all on function job_outbox_hold_check(job_outbox, job_notify_settings) from anon;
revoke all on function job_outbox_is_external(job_outbox) from anon;
