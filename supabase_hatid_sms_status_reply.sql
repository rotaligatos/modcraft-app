-- HATID: automatic SMS status reply (2026-10-10). Applied to the HATID project (nssviuuagtlvxjvvvagt).
-- A client who texts a status question ("status", "nasaan na", "kailan darating"...) from the phone
-- number on their delivery gets an automatic reply built from the job: scheduled date, prepared,
-- on the truck (stop N), APPROXIMATE distance from the truck's last GPS reading, delivered.
-- Never sends the truck's exact position, plate, driver or other clients' details.
-- Off until an admin ticks it (job_notify_settings.sms_autoreply) — and SMS itself must be on.

alter table job_notify_settings add column if not exists sms_autoreply boolean not null default false;

-- Replies are stored as kind 'manual' (no new kind, so the kind check stays as it is), told apart by subject
-- 'Automatic status reply' and created_by_name 'HATID (automatic)'.

-- Is this text asking about a delivery? (English / Tagalog / Cebuano, loose spelling)
create or replace function job_sms_is_status_ask(p text) returns boolean language sql immutable as $$
  select coalesce(p, '') ~* '(status|stat\M|update|where|wer\M|nasaan|nasan|asan|saan|san na|kailan|kelan|kanus-a|asa na|when|eta\M|track|deliver|dating|darating|dumating|abot|order|truck|trak|sched|ship|nasa)'
      or btrim(coalesce(p, '')) ~ '^\?+$';
$$;

-- The reply for one phone number (digits; last 10 compared). Returns null when no delivery matches.
create or replace function job_status_reply_text(p_phone text) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  tail text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  j record; tr record; pos record; more int; ahead int; slat double precision; slon double precision;
  km numeric; road numeric; mins int; dist text := ''; eta text := ''; co text; msg text; d text; cv text;
begin
  if length(tail) < 10 then return null; end if;
  -- the delivery to talk about: an open one (earliest date first, today before later), else the latest finished one in the last 7 days
  select jb.*, t.label truck_label into j from jobs jb left join trucks t on t.id = jb.truck_id
   where right(regexp_replace(coalesce(jb.client_phone, ''), '\D', '', 'g'), 10) = tail and jb.status <> 'rejected'
     and (jb.status in ('proposed','scheduled','dispatched','in_progress','issue')
          or (jb.status = 'completed' and coalesce(jb.scheduled_date, jb.updated_at::date) >= current_date - 7))
   order by (jb.status <> 'completed') desc, (jb.scheduled_date < (now() at time zone 'Asia/Manila')::date) asc nulls last,
            jb.scheduled_date asc nulls last, jb.updated_at desc
   limit 1;
  if j.id is null then return null; end if;
  select count(*) - 1 into more from jobs jb where right(regexp_replace(coalesce(jb.client_phone, ''), '\D', '', 'g'), 10) = tail
     and jb.status in ('proposed','scheduled','dispatched','in_progress','issue');
  co := case j.company when 'WCLI' then 'World Class Laminate' when 'CWLI' then 'Cebu World Laminate'
                       when 'MSSI' then 'Module System and Services' else j.company end;
  d := to_char(j.scheduled_date, 'Dy Mon FMDD');
  msg := 'Order ' || j.quotation_serial || ': ';

  if j.courier_ref is not null or j.courier_vehicle_id is not null then
    select coalesce(v.service || ' ' || v.name, v.name, 'courier') into cv from job_courier_vehicles v where v.id = j.courier_vehicle_id;
    if j.status = 'completed' then msg := msg || 'delivered by ' || coalesce(cv, 'courier') || '.';
    else msg := msg || 'going by ' || coalesce(cv, 'courier') || coalesce(' on ' || d, '') || '.'
             || coalesce(' Track it: ' || nullif(j.courier_track_url, ''), '');
    end if;

  elsif j.status = 'proposed' then
    msg := msg || 'received, now being scheduled. We will text you the delivery date.';

  elsif j.status = 'scheduled' then
    msg := msg || 'scheduled for delivery ' || case when j.scheduled_date = (now() at time zone 'Asia/Manila')::date then 'TODAY' else 'on ' || d end || '.'
        || case when j.prepared_at is not null then ' Your items are prepared.' else '' end
        || case when j.scheduled_date = (now() at time zone 'Asia/Manila')::date then ' The truck has not left yet.' else '' end;

  elsif j.status in ('dispatched','in_progress','issue') then
    select * into tr from job_trips where truck_id = j.truck_id and trip_date = j.scheduled_date and trip_no = coalesce(j.trip_no, 1);
    select count(*) into ahead from jobs o where o.truck_id = j.truck_id and o.scheduled_date = j.scheduled_date
       and coalesce(o.trip_no, 1) = coalesce(j.trip_no, 1) and o.id <> j.id
       and o.status in ('scheduled','dispatched','in_progress','issue') and coalesce(o.drop_seq, 0) < coalesce(j.drop_seq, 0);
    if j.status = 'in_progress' then
      msg := msg || 'the truck has arrived at your site.';
    elsif j.status = 'issue' then
      msg := msg || 'our team is attending to a concern on this delivery and will contact you.';
    else
      msg := msg || 'on the way' || coalesce(', left at ' || to_char(coalesce(tr.gps_left_at, tr.departed_at) at time zone 'Asia/Manila', 'FMHH12:MI AM'), '') || '. '
          || case when ahead = 0 then 'Yours is the next stop.' when ahead = 1 then '1 delivery before yours.' else ahead || ' deliveries before yours.' end;
      -- approximate distance, only from a recent GPS reading and a known site
      select * into pos from truck_last_position where truck_id = j.truck_id and at > now() - interval '15 minutes';
      slat := j.site_lat; slon := j.site_lon;
      if slat is null then select lat, lon into slat, slon from delivery_destinations where id = j.destination_id; end if;
      if pos.truck_id is not null and slat is not null then
        km := 2 * 6371 * asin(sqrt(power(sin(radians(slat - pos.lat) / 2), 2) + cos(radians(pos.lat)) * cos(radians(slat)) * power(sin(radians(slon - pos.lon) / 2), 2)));
        road := km * 1.35;
        if road < 1 then dist := ' The truck is less than 1 km from you.';
        elsif road < 10 then dist := ' The truck is about ' || round(road) || ' km from you.';
        else dist := ' The truck is about ' || (round(road / 5) * 5)::int || ' km from you.'; end if;
        if ahead = 0 then
          mins := ceil(road / case when road > 40 then 45 else 25 end * 60 / 15) * 15;
          eta := case when road < 1 then ' Arriving shortly.' when mins <= 90 then ' Roughly ' || mins || ' minutes away.'
                      else ' Roughly ' || round(mins / 60.0) || ' hours away.' end;
        end if;
        msg := msg || dist || eta;
      end if;
    end if;

  else -- completed
    msg := msg || case coalesce(j.delivery_outcome, 'full') when 'partial' then 'partly delivered' when 'returned' then 'not received — items brought back' else 'delivered' end
        || coalesce(' on ' || d, '') || coalesce(', received by ' || nullif(btrim(j.received_by_name), ''), '') || '.';
  end if;

  if more > 0 then msg := msg || ' (+' || more || ' more order' || case when more > 1 then 's' else '' end || ' on this number.)'; end if;
  msg := msg || ' Times are estimates. — ' || co || ' Logistics. Reply here to reach our team.';
  return jsonb_build_object('job_id', j.id, 'company', j.company, 'label', coalesce(nullif(btrim(j.client_contact_name), ''), j.client_name), 'text', left(msg, 459));
end $$;

-- Office preview (Settings › Messaging › "Try a client's number")
create or replace function job_status_reply_preview(p_phone text) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare r jsonb;
begin
  if not job_is_office() then raise exception 'Only office staff can do this' using errcode = '42501'; end if;
  r := job_status_reply_text(p_phone);
  if r is null then return jsonb_build_object('text', null); end if;
  if not job_my_company_ok(r->>'company') then return jsonb_build_object('text', null); end if;
  return r;
end $$;
revoke all on function job_status_reply_text(text) from public, anon, authenticated;
grant execute on function job_status_reply_preview(text) to authenticated;

-- Incoming SMS: store as before, then auto-reply when switched on and the text asks about a delivery.
create or replace function public.job_sms_event(p jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare ev text := p->>'event'; pl jsonb := coalesce(p->'payload', '{}'); d text; tail text; iid uuid; txt text;
  j_id uuid; j_co text; j_who text; a_id uuid; a_name text; a_co text; ns record; rep jsonb;
begin
  if ev = 'sms:received' then
    d := regexp_replace(coalesce(pl->>'sender', pl->>'phoneNumber', ''), '\D', '', 'g');
    txt := left(coalesce(pl->>'message', ''), 2000);
    if d = '' or txt = '' then return jsonb_build_object('ignored', true); end if;
    tail := right(d, 10);
    select jb.id, jb.company, coalesce(nullif(btrim(jb.client_contact_name), ''), jb.client_name) into j_id, j_co, j_who
      from jobs jb where jb.status <> 'rejected' and right(regexp_replace(coalesce(jb.client_phone, ''), '\D', '', 'g'), 10) = tail
      order by (jb.scheduled_date >= current_date - 7) desc nulls last, jb.scheduled_date desc nulls last, jb.created_at desc limit 1;
    if j_id is null then
      select ag.id, ag.name, ag.company into a_id, a_name, a_co from job_agents ag
       where right(regexp_replace(coalesce(ag.phone, ''), '\D', '', 'g'), 10) = tail limit 1;
    end if;
    insert into job_inbox (job_id, company, channel, sender, sender_label, from_role, body, received_at, external_id)
    values (j_id, coalesce(j_co, a_co), 'sms', d, coalesce(j_who, a_name), case when j_id is not null then 'client' when a_id is not null then 'agent' else 'other' end,
      txt, now(), nullif(coalesce(pl->>'messageId', p->>'id'), ''))
    on conflict (external_id) do nothing returning id into iid;
    if iid is not null then
      insert into job_notifications (user_id, kind, title, body, ref_type, ref_id)
      select s.id, 'inbox_sms', 'SMS reply — ' || coalesce(j_who, a_name, d), left(txt, 200), case when j_id is not null then 'job' else 'inbox' end, j_id
      from job_staff s where s.active and s.role in ('admin','manager','dispatcher')
        and (s.companies is null or coalesce(j_co, a_co) is null or coalesce(j_co, a_co) = any(s.companies));

      -- automatic status reply
      select * into ns from job_notify_settings where id;
      if coalesce(ns.sms_enabled, false) and coalesce(ns.sms_autoreply, false) and a_id is null and job_sms_is_status_ask(txt) then
        if j_id is not null then
          -- one automatic reply per number every 10 minutes
          if not exists (select 1 from job_outbox where kind = 'manual' and subject = 'Automatic status reply' and channel = 'sms' and right(recipient, 10) = tail and created_at > now() - interval '10 minutes') then
            rep := job_status_reply_text(d);
            if rep is not null then
              insert into job_outbox (job_id, company, ref_date, kind, channel, recipient, recipient_label, subject, body, to_role, created_by_name)
              values ((rep->>'job_id')::uuid, rep->>'company', current_date, 'manual', 'sms', d, rep->>'label', 'Automatic status reply', rep->>'text', 'client', 'HATID (automatic)');
              perform job_outbox_kick();
            end if;
          end if;
        elsif not exists (select 1 from job_outbox where kind = 'manual' and subject = 'Automatic status reply' and channel = 'sms' and right(recipient, 10) = tail and created_at > now() - interval '24 hours') then
          -- number not on any delivery: one polite reply per day, no details
          insert into job_outbox (company, ref_date, kind, channel, recipient, recipient_label, subject, body, to_role, created_by_name)
          values (null, current_date, 'manual', 'sms', d, 'Unknown number', 'Automatic status reply',
            'We could not find a delivery for this number. Please text from the mobile number on your order, or contact your sales agent. Your message has been passed to our team.',
            'other', 'HATID (automatic)');
          perform job_outbox_kick();
        end if;
      end if;
    end if;
    return jsonb_build_object('stored', iid is not null, 'job', j_id);
  elsif ev = 'sms:delivered' then
    update job_outbox set delivered_at = coalesce(delivered_at, now()) where external_id = pl->>'messageId';
    return jsonb_build_object('ok', true);
  elsif ev = 'sms:failed' then
    update job_outbox set status = 'failed', last_error = left('The phone could not send it: ' || coalesce(pl->>'reason', pl->>'error', 'unknown reason'), 500)
     where external_id = pl->>'messageId' and status = 'sent';
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ignored', true);
end $function$;
