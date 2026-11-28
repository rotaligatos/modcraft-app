-- Company price lists (Rommel, 2026-11-28): CWLI's own prices, pricing settings and costs, kept as a
-- layer ON TOP of the shared price list — never a copy. Anything a company has not set falls back to
-- the shared figure. Phase 1 = stored only; no quotation reads it until the per-company switch is on.
--
-- Who:
--   read prices + pricing settings : any staff (whoever prepares a C quotation needs them)
--   edit prices + pricing settings : Admin/Director, or users.can_edit_company_prices
--   read/edit costs (overhead, item costs, margins) : Admin/Director, or users.can_see_company_costs
-- Database only, never the Google Sheet (the Sheet is open to every user).

alter table public.users add column if not exists can_edit_company_prices boolean not null default false;
alter table public.users add column if not exists can_see_company_costs   boolean not null default false;

create or replace function public.app_can_edit_company_prices() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(app_is_admin_tier(),false) or exists(
    select 1 from users u where lower(btrim(u.email)) = app_current_email() and u.active and u.can_edit_company_prices)
$$;
create or replace function public.app_can_see_company_costs() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(app_is_admin_tier(),false) or exists(
    select 1 from users u where lower(btrim(u.email)) = app_current_email() and u.active and u.can_see_company_costs)
$$;
revoke all on function public.app_can_edit_company_prices() from public, anon;
revoke all on function public.app_can_see_company_costs()   from public, anon;
grant execute on function public.app_can_edit_company_prices() to authenticated;
grant execute on function public.app_can_see_company_costs()   to authenticated;

-- One selling price per item per company. company_only = the company's own product (not in the shared list).
create table if not exists public.company_prices (
  id            bigserial primary key,
  company_key   text not null check (company_key in ('W','M','C')),
  kind          text not null check (kind in ('material','hardware','service')),
  name          text not null check (btrim(name) <> ''),
  unit          text not null default '',
  price         numeric not null check (price >= 0),
  company_only  boolean not null default false,
  active        boolean not null default true,
  notes         text,
  updated_by    text,
  updated_at    timestamptz not null default now()
);
create unique index if not exists company_prices_item_uq
  on public.company_prices (company_key, kind, lower(btrim(name)), lower(btrim(unit)));

-- Pricing settings that change the SELLING price (cost factors, carcass prices, installation rates).
-- enabled/enabled_at = the switch: only quotations created after enabled_at use this company's layer.
create table if not exists public.company_pricing (
  company_key   text primary key check (company_key in ('W','M','C')),
  enabled       boolean not null default false,
  enabled_at    timestamptz,
  cost_factors  jsonb not null default '{}'::jsonb,   -- overrides of CF keys; absent key = shared value
  carcass_prices jsonb not null default '{}'::jsonb,  -- {type: price}
  inst_cost     jsonb not null default '{}'::jsonb,   -- overrides of INST_COST
  notes         text,
  updated_by    text,
  updated_at    timestamptz not null default now()
);

-- What the company pays / spends — profitability only. Never needed to price a quotation.
create table if not exists public.company_costs (
  company_key   text primary key check (company_key in ('W','M','C')),
  overhead      jsonb not null default '{}'::jsonb,   -- monthly admin, utilities, other, packing, workdays
  item_costs    jsonb not null default '{}'::jsonb,   -- {"kind|name|unit": cost}
  material_margin_pct numeric,
  notes         text,
  updated_by    text,
  updated_at    timestamptz not null default now()
);

alter table public.company_prices  enable row level security;
alter table public.company_pricing enable row level security;
alter table public.company_costs   enable row level security;

drop policy if exists "staff read"   on public.company_prices;
drop policy if exists "editors write" on public.company_prices;
create policy "staff read"    on public.company_prices for select to authenticated using ((select app_is_internal()));
create policy "editors write" on public.company_prices for all    to authenticated
  using ((select app_can_edit_company_prices())) with check ((select app_can_edit_company_prices()));

drop policy if exists "staff read"   on public.company_pricing;
drop policy if exists "editors write" on public.company_pricing;
create policy "staff read"    on public.company_pricing for select to authenticated using ((select app_is_internal()));
create policy "editors write" on public.company_pricing for all    to authenticated
  using ((select app_can_edit_company_prices())) with check ((select app_can_edit_company_prices()));

drop policy if exists "cost viewers" on public.company_costs;
create policy "cost viewers"  on public.company_costs for all to authenticated
  using ((select app_can_see_company_costs())) with check ((select app_can_see_company_costs()));

revoke all on public.company_prices, public.company_pricing, public.company_costs from anon;
grant select, insert, update, delete on public.company_prices, public.company_pricing, public.company_costs to authenticated;
grant usage, select on sequence public.company_prices_id_seq to authenticated;

-- updated_at
create or replace function public.company_pb_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); new.updated_by := coalesce(app_current_email(), new.updated_by); return new; end $$;
drop trigger if exists company_prices_touch  on public.company_prices;
drop trigger if exists company_pricing_touch on public.company_pricing;
drop trigger if exists company_costs_touch   on public.company_costs;
create trigger company_prices_touch  before insert or update on public.company_prices  for each row execute function public.company_pb_touch();
create trigger company_pricing_touch before insert or update on public.company_pricing for each row execute function public.company_pb_touch();
create trigger company_costs_touch   before insert or update on public.company_costs   for each row execute function public.company_pb_touch();

-- CWLI starts with the switch OFF and nothing set: behaves exactly like today.
insert into public.company_pricing (company_key) values ('C') on conflict do nothing;
insert into public.company_costs   (company_key) values ('C') on conflict do nothing;
