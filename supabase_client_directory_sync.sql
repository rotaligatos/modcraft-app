-- ─────────────────────────────────────────────────────────────────────────────
-- Registered website client  →  ModCraft client directory
-- Applied to Supabase 2026-08-02 as migration `client_account_to_clients_directory`.
-- Kept here because it is a live database object that no other tracked file
-- describes; supabase_schema.sql covers tables, not this.
--
-- WHY THIS EXISTS
-- Not to "stop duplicates" — ModCraft's own matcher does that (index.html,
-- _findExistingClient, commit 3f72bd5). The prize is the EMAIL. 11 of the 20
-- client records carry none, so matching falls back to names, and a client who
-- registers as "Studio Tille Interiors" against a record reading
-- "STUDIO TILLE INC." cannot be tied together by anything. An account gives a
-- verified address to match on from then on.
--
-- THE TRAP THIS AVOIDS
-- A naive insert-per-account would be a duplicate factory: most people
-- registering are existing customers. So the trigger matches FIRST, on the same
-- three keys and in the same order as the JS, and only inserts when nothing is
-- found. If the SQL and the JS ever drift, this becomes the very thing it was
-- built to prevent — change them together.
-- ─────────────────────────────────────────────────────────────────────────────

-- Mirrors _clNorm / _clNormName in index.html.
create or replace function public.cl_norm(s text) returns text
language sql immutable as $$
  select regexp_replace(lower(btrim(coalesce(s,''))), '\s+', ' ', 'g')
$$;

create or replace function public.cl_norm_name(s text) returns text
language sql immutable as $$
  select regexp_replace(public.cl_norm(s), '[.,]+$', '')
$$;

create or replace function public.client_account_to_clients()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(new.email,'')));
  v_biz   text := public.cl_norm_name(new.company_name);
  v_name  text := public.cl_norm_name(new.full_name);
  v_id    text;
  v_next  int;
begin
  if v_email = '' then return new; end if;

  -- 1) email — strongest key
  select id into v_id from clients
   where lower(btrim(coalesce(email,''))) = v_email limit 1;

  -- 2) business name
  if v_id is null and v_biz <> '' then
    select id into v_id from clients where public.cl_norm_name(biz_name) = v_biz limit 1;
  end if;

  -- 3) contact name, only where the business names do not CONTRADICT, so two
  --    people of the same name at different firms stay separate records.
  if v_id is null and v_name <> '' then
    select id into v_id from clients
     where public.cl_norm_name(name) = v_name
       and (public.cl_norm_name(biz_name) = '' or v_biz = '' or public.cl_norm_name(biz_name) = v_biz)
     limit 1;
  end if;

  if v_id is not null then
    -- Backfill what is MISSING; never overwrite. Staff-entered detail wins —
    -- correcting a record is what ModCraft's Verify panel is for.
    update clients set
      email    = case when coalesce(btrim(email),'')   = '' then new.email        else email    end,
      name     = case when coalesce(btrim(name),'')    = '' then new.full_name    else name     end,
      biz_name = case when coalesce(btrim(biz_name),'')= '' then new.company_name else biz_name end,
      contact  = case when coalesce(btrim(contact),'') = '' then new.mobile       else contact  end,
      address  = case when coalesce(btrim(address),'') = '' then new.address      else address  end,
      segment  = case when coalesce(btrim(segment),'') = '' then new.segment      else segment  end,
      updated_at = now()
    where id = v_id;
  else
    -- ⚠ id MUST stay numeric. index.html picks the next one with
    --   Math.max(mx, c.id||0)  — a SINGLE non-numeric id makes that NaN, and
    -- every client created afterwards gets id NaN. Proven in node, not assumed.
    perform pg_advisory_xact_lock(hashtext('modcraft_clients_id'));
    select coalesce(max(id::int),0)+1 into v_next from clients where id ~ '^[0-9]+$';
    insert into clients(id,name,biz_name,email,contact,address,segment,client_type,company,notes)
    values (v_next::text, new.full_name, new.company_name, new.email, new.mobile,
            new.address, new.segment, 'Direct',
            'Module Systems and Services, Inc.',  -- what the website stamps on its own orders
            'Registered on the MSSI website'
              || case when coalesce(btrim(new.lead_source),'') <> ''
                      then ' — heard of us via: ' || new.lead_source else '' end);
  end if;
  return new;
exception when others then
  -- A directory row is a convenience; the ACCOUNT is the record. Never let this
  -- block a client from saving their profile. Nothing is lost — client_accounts
  -- still holds every field, and the next edit retries.
  raise warning 'client_account_to_clients failed for %: %', v_email, sqlerrm;
  return new;
end $$;

drop trigger if exists trg_client_account_to_clients on public.client_accounts;
create trigger trg_client_account_to_clients
  after insert or update of email, full_name, company_name, mobile, address, segment, lead_source
  on public.client_accounts
  for each row execute function public.client_account_to_clients();

-- ── Verified 2026-08-02 by driving it against real data, then restoring ──────
--  a) existing record with NO email, matched on business name
--     ("ZZ Testfirm Inc" → "ZZ TESTFIRM INC.")  → email backfilled,
--     staff-entered contact/name/company NOT overwritten        PASS
--  b) matched on email                          → blanks filled only          PASS
--  c) same contact name, DIFFERENT firm         → separate record, not merged PASS
--  d) genuinely new client                      → inserted, numeric id, MSSI  PASS
--  e) two further account edits                 → still ONE row; an already
--     filled field was not overwritten by the newer value                     PASS
--  Baseline restored afterwards: 20 clients, max id 36, 0 non-numeric ids.
--
--  NOTE from that run: a test address collided with a REAL client (35 already
--  held interiors@studiotille.com), so the trigger correctly matched and
--  backfilled two blank fields on a live record. Reverted. Use *.example
--  addresses when testing this against production.
--
-- ── Known gap ───────────────────────────────────────────────────────────────
-- A row created here exists in Supabase only, not the Sheets `Clients` tab.
-- gLoadClients reads Supabase first, so a connected session sees it; a session
-- on the Sheets fallback would not. Same exposure the Orders queue already has,
-- and everyone auto-connects since 2026-07-05. It heals the moment ModCraft
-- next saves that client, which writes both.
