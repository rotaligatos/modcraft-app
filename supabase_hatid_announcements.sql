-- HATID: announcements every user must read and acknowledge, with an email blast (Rommel 2026-11-24)
-- Why: a reminder about partial pick-ups had to reach everyone and be confirmed read; a chat post can be skimmed.
-- An admin or manager posts an announcement to everyone (or some companies / teams). Each user in the audience gets
-- a banner they cannot close until they tap "I have read and understood"; optionally an email too (job_outbox →
-- job-notify-send, the same mail script as every other HATID email). The poster sees who has and hasn't read it and
-- can email a reminder to only those who haven't.
-- Tables are reached only through the functions below (security definer); no direct grants.

create table if not exists hatid_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  companies text[],          -- null = all companies
  groups text[],             -- null = everyone; else any of 'office', 'drivers', 'pickup'
  emailed boolean not null default false,
  created_by uuid,
  created_name text,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_name text,
  check (char_length(btrim(title)) between 1 and 120),
  check (char_length(btrim(body)) between 1 and 4000),
  check (groups is null or groups <@ array['office','drivers','pickup'])
);
create index if not exists hatid_ann_active_idx on hatid_announcements (created_at desc) where ended_at is null;

create table if not exists hatid_announcement_reads (
  announcement_id uuid not null references hatid_announcements(id) on delete cascade,
  user_id uuid not null,
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

alter table hatid_announcements enable row level security;
alter table hatid_announcement_reads enable row level security;
revoke all on hatid_announcements, hatid_announcement_reads from anon, authenticated;

-- Email kind for the outbox (kept in one list with the existing kinds)
alter table job_outbox drop constraint if exists job_outbox_kind_check;
alter table job_outbox add constraint job_outbox_kind_check check (kind = any (array['delivered','partial','returned','issue','delay','daily','daily_auto',
  'daily_followup','sched_client','sched_agent','manual','truck_check','load_concern','quality','trip_done','trip_notice','photo','pickup_noshow',
  'pickup_concern','pickup_photo','prep_client','prep_agent','onway_client','onway_agent','prep_request','pkready_client','pkready_agent','pkdone_client',
  'pkdone_agent','pkmissed_client','pkmissed_agent','address_client','address_agent','announce']));

-- Is this user in the announcement's audience?
create or replace function hatid_ann_for(a hatid_announcements, s job_staff) returns boolean
language sql immutable as $$
  select coalesce(s.active, false)
    and (a.companies is null or s.companies is null or s.companies && a.companies)
    and (a.groups is null
      or ('office' = any(a.groups) and s.role in ('admin','manager','dispatcher','viewer'))
      or ('drivers' = any(a.groups) and s.role = 'field')
      or ('pickup' = any(a.groups) and (s.role = 'pickup' or s.pickup_role is not null)));
$$;

create or replace function hatid_ann_can_post() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from job_staff s where s.id = auth.uid() and s.active and s.role in ('admin','manager'));
$$;

-- Queue the email to everyone in the audience (or, for a reminder, only those who haven't read it)
create or replace function hatid_ann_queue_email(a hatid_announcements, p_only_unread boolean) returns integer
language plpgsql security definer set search_path = public as $$
declare me job_staff; n integer; subj text; txt text;
begin
  select * into me from job_staff where id = auth.uid();
  subj := left((case when p_only_unread then 'Reminder — ' else '' end) || 'HATID announcement: ' || a.title, 200);
  txt := (case when p_only_unread then 'You have not yet confirmed reading this HATID announcement.' || E'\n\n' else '' end)
    || a.title || E'\n\n' || a.body || E'\n\n'
    || 'Please open HATID and tap “I have read and understood”:' || E'\n' || 'https://rotaligatos.github.io/modcraft-app/hatid.html'
    || E'\n\n— ' || coalesce(a.created_name, 'HATID');
  insert into job_outbox (company, ref_date, kind, channel, recipient, recipient_label, subject, body, created_by, created_by_name, to_role)
  select case when array_length(a.companies, 1) = 1 then a.companies[1] end, (now() at time zone 'Asia/Manila')::date, 'announce', 'email',
         lower(btrim(s.email)), coalesce(nullif(btrim(s.name), ''), s.email), subj, txt, me.id, coalesce(me.name, me.email), 'other'
  from job_staff s
  where hatid_ann_for(a, s) and s.id <> coalesce(me.id, '00000000-0000-0000-0000-000000000000'::uuid)
    and coalesce(btrim(s.email), '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    and (not p_only_unread or not exists (select 1 from hatid_announcement_reads r where r.announcement_id = a.id and r.user_id = s.id));
  get diagnostics n = row_count;
  if n > 0 then perform job_outbox_kick(); end if;
  return n;
end $$;

-- Post an announcement (admin / manager)
create or replace function hatid_ann_post(p_title text, p_body text, p_companies text[] default null, p_groups text[] default null, p_email boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me job_staff; a hatid_announcements; n_aud integer; n_mail integer := 0; ns job_notify_settings;
begin
  select * into me from job_staff where id = auth.uid() and active;
  if me.id is null or me.role not in ('admin','manager') then raise exception 'Only an admin or a manager can post announcements' using errcode = '42501'; end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then raise exception 'Write a title' using errcode = 'P0001'; end if;
  if nullif(btrim(coalesce(p_body, '')), '') is null then raise exception 'Write the announcement' using errcode = 'P0001'; end if;
  if char_length(btrim(p_title)) > 120 then raise exception 'Title is too long (120 characters max)' using errcode = 'P0001'; end if;
  if char_length(btrim(p_body)) > 4000 then raise exception 'Announcement is too long (4,000 characters max)' using errcode = 'P0001'; end if;
  if p_companies is not null and cardinality(p_companies) = 0 then p_companies := null; end if;
  if p_groups is not null and cardinality(p_groups) = 0 then p_groups := null; end if;
  -- a manager covering some companies posts only to those
  if me.companies is not null then
    if p_companies is null then p_companies := me.companies;
    elsif not (p_companies <@ me.companies) then raise exception 'You can only post to your own companies' using errcode = '42501'; end if;
  end if;
  if p_email then
    select * into ns from job_notify_settings where id;
    if not coalesce(ns.email_enabled, false) then raise exception 'Email sending is not switched on (Settings › Messaging) — untick “Also email” or switch it on' using errcode = 'P0001'; end if;
  end if;
  insert into hatid_announcements (title, body, companies, groups, emailed, created_by, created_name)
  values (btrim(p_title), btrim(p_body), p_companies, p_groups, p_email, me.id, coalesce(nullif(btrim(me.name), ''), me.email))
  returning * into a;
  insert into hatid_announcement_reads (announcement_id, user_id) values (a.id, me.id) on conflict do nothing;   -- the poster has read it
  select count(*) into n_aud from job_staff s where hatid_ann_for(a, s) and s.id <> me.id;
  if p_email then n_mail := hatid_ann_queue_email(a, false); end if;
  return jsonb_build_object('id', a.id, 'audience', n_aud, 'emailed', n_mail);
end $$;

-- My announcements: unread ones first (these block the screen), then the last 60 days
create or replace function hatid_ann_mine() returns table (id uuid, title text, body text, created_name text, created_at timestamptz, read_at timestamptz, ended boolean)
language sql stable security definer set search_path = public as $$
  select a.id, a.title, a.body, a.created_name, a.created_at, r.read_at, a.ended_at is not null
  from hatid_announcements a join job_staff s on s.id = auth.uid()
  left join hatid_announcement_reads r on r.announcement_id = a.id and r.user_id = s.id
  where hatid_ann_for(a, s) and ((r.read_at is null and a.ended_at is null) or a.created_at > now() - interval '60 days')
  order by (r.read_at is null and a.ended_at is null) desc, a.created_at desc
  limit 50;
$$;

create or replace function hatid_ann_ack(p_id uuid) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare s job_staff; a hatid_announcements; t timestamptz;
begin
  select * into s from job_staff where id = auth.uid() and active;
  select * into a from hatid_announcements where id = p_id;
  if s.id is null or a.id is null or not hatid_ann_for(a, s) then raise exception 'Announcement not found' using errcode = 'P0001'; end if;
  insert into hatid_announcement_reads (announcement_id, user_id) values (p_id, s.id) on conflict (announcement_id, user_id) do nothing;
  select read_at into t from hatid_announcement_reads where announcement_id = p_id and user_id = s.id;
  return t;
end $$;

-- For posters: every announcement with read counts
create or replace function hatid_ann_list() returns table (id uuid, title text, body text, companies text[], groups text[], emailed boolean,
  created_name text, created_at timestamptz, ended_at timestamptz, audience integer, read_count integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not hatid_ann_can_post() then raise exception 'Only an admin or a manager can see this' using errcode = '42501'; end if;
  return query
  select a.id, a.title, a.body, a.companies, a.groups, a.emailed, a.created_name, a.created_at, a.ended_at,
    (select count(*)::int from job_staff s where hatid_ann_for(a, s) and s.id is distinct from a.created_by),
    (select count(*)::int from job_staff s join hatid_announcement_reads r on r.user_id = s.id and r.announcement_id = a.id
       where hatid_ann_for(a, s) and s.id is distinct from a.created_by)
  from hatid_announcements a order by a.created_at desc limit 100;
end $$;

-- Who has / hasn't read one
create or replace function hatid_ann_reads(p_id uuid) returns table (user_id uuid, name text, email text, role text, pickup_role text, companies text[], read_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare a hatid_announcements;
begin
  if not hatid_ann_can_post() then raise exception 'Only an admin or a manager can see this' using errcode = '42501'; end if;
  select * into a from hatid_announcements x where x.id = p_id;
  return query
  select s.id, coalesce(nullif(btrim(s.name), ''), s.email), s.email, s.role, s.pickup_role, s.companies, r.read_at
  from job_staff s left join hatid_announcement_reads r on r.announcement_id = a.id and r.user_id = s.id
  where a.id is not null and hatid_ann_for(a, s) and s.id is distinct from a.created_by
  order by r.read_at is not null, coalesce(nullif(btrim(s.name), ''), s.email);
end $$;

-- Email a reminder to those who haven't read it yet
create or replace function hatid_ann_remind(p_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare a hatid_announcements; ns job_notify_settings;
begin
  if not hatid_ann_can_post() then raise exception 'Only an admin or a manager can send reminders' using errcode = '42501'; end if;
  select * into a from hatid_announcements where id = p_id;
  if a.id is null then raise exception 'Announcement not found' using errcode = 'P0001'; end if;
  if a.ended_at is not null then raise exception 'This announcement was ended' using errcode = 'P0001'; end if;
  select * into ns from job_notify_settings where id;
  if not coalesce(ns.email_enabled, false) then raise exception 'Email sending is not switched on (Settings › Messaging)' using errcode = 'P0001'; end if;
  return hatid_ann_queue_email(a, true);
end $$;

-- End an announcement: nobody else is asked to read it (it stays in everyone's list)
create or replace function hatid_ann_end(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me job_staff;
begin
  select * into me from job_staff where id = auth.uid() and active;
  if not hatid_ann_can_post() then raise exception 'Only an admin or a manager can end announcements' using errcode = '42501'; end if;
  update hatid_announcements set ended_at = now(), ended_name = coalesce(nullif(btrim(me.name), ''), me.email) where id = p_id and ended_at is null;
end $$;

revoke all on function hatid_ann_for(hatid_announcements, job_staff), hatid_ann_queue_email(hatid_announcements, boolean) from public, anon, authenticated;
revoke all on function hatid_ann_post(text, text, text[], text[], boolean), hatid_ann_mine(), hatid_ann_ack(uuid), hatid_ann_list(),
  hatid_ann_reads(uuid), hatid_ann_remind(uuid), hatid_ann_end(uuid), hatid_ann_can_post() from public, anon;
grant execute on function hatid_ann_post(text, text, text[], text[], boolean), hatid_ann_mine(), hatid_ann_ack(uuid), hatid_ann_list(),
  hatid_ann_reads(uuid), hatid_ann_remind(uuid), hatid_ann_end(uuid), hatid_ann_can_post() to authenticated;

-- The tables stay unreadable, so there is no realtime feed: HATID checks hatid_ann_mine on open, every 3 minutes,
-- and whenever the tab or phone screen comes back.
