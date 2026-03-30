create extension if not exists pgcrypto;

create table if not exists public.studio_history (
  id uuid primary key default gen_random_uuid(),
  host_nickname text not null,
  guest_nickname text not null,
  duration_seconds integer not null check (duration_seconds >= 0),
  created_at timestamptz not null default now()
);

alter table public.studio_history enable row level security;

drop policy if exists "studio_history_select_public" on public.studio_history;
create policy "studio_history_select_public"
  on public.studio_history
  for select
  to anon, authenticated
  using (true);

drop policy if exists "studio_history_insert_public" on public.studio_history;
create policy "studio_history_insert_public"
  on public.studio_history
  for insert
  to anon, authenticated
  with check (true);
