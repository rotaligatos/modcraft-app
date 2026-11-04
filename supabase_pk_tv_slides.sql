-- HATID TV slideshow (Settings › Pick-up › TV slideshow). Run once in the HATID Supabase project
-- (nssviuuagtlvxjvvvagt) → SQL editor. Safe to run again.
-- Pictures are PUBLIC (the TV has no sign-in) — put only promo/product pictures there, never client data.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tv-slides', 'tv-slides', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do nothing;

create table if not exists public.pk_tv_slides (
  id uuid primary key default gen_random_uuid(),
  site text not null default 'all' check (site in ('all','plant1','annex')),
  path text not null,
  caption text,
  sort_order int not null default 0,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now()
);
alter table public.pk_tv_slides enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'pk_tv_slides' and policyname = 'pk tv slides read staff') then
    create policy "pk tv slides read staff" on public.pk_tv_slides for select to authenticated using (true); end if;
  if not exists (select 1 from pg_policies where tablename = 'pk_tv_slides' and policyname = 'pk tv slides insert editors') then
    create policy "pk tv slides insert editors" on public.pk_tv_slides for insert to authenticated with check (public.job_settings_editor()); end if;
  if not exists (select 1 from pg_policies where tablename = 'pk_tv_slides' and policyname = 'pk tv slides update editors') then
    create policy "pk tv slides update editors" on public.pk_tv_slides for update to authenticated using (public.job_settings_editor()) with check (public.job_settings_editor()); end if;
  if not exists (select 1 from pg_policies where tablename = 'pk_tv_slides' and policyname = 'pk tv slides delete editors') then
    create policy "pk tv slides delete editors" on public.pk_tv_slides for delete to authenticated using (public.job_settings_editor()); end if;
  if not exists (select 1 from pg_policies where tablename = 'objects' and policyname = 'tv slides upload editors') then
    create policy "tv slides upload editors" on storage.objects for insert to authenticated with check (bucket_id = 'tv-slides' and public.job_settings_editor()); end if;
  if not exists (select 1 from pg_policies where tablename = 'objects' and policyname = 'tv slides delete editors') then
    create policy "tv slides delete editors" on storage.objects for delete to authenticated using (bucket_id = 'tv-slides' and public.job_settings_editor()); end if;
end $$;

-- The TV (no sign-in) reads the active list through this, never the table itself.
create or replace function public.pk_tv_slides_for(p_site text)
returns table(path text, caption text)
language sql stable security definer set search_path = public as $$
  select s.path, s.caption from pk_tv_slides s
  where s.active and (s.site = 'all' or s.site = p_site)
  order by s.sort_order, s.created_at
$$;
grant execute on function public.pk_tv_slides_for(text) to anon, authenticated;
