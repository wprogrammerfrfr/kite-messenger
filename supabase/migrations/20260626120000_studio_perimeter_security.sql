-- Kite Studio perimeter security: profiles RLS + studio_sessions participant binding

-- ==========================================
-- profiles: owner-only SELECT / UPDATE / INSERT
-- ==========================================

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;

create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "profiles_insert_own"
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

-- Chat sidebar reads DM peer profiles (non-sensitive columns only via client select).
drop policy if exists "profiles_select_dm_peers" on public.profiles;
create policy "profiles_select_dm_peers"
  on public.profiles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.dm_connections dc
      where (dc.user_low = auth.uid() and dc.user_high = profiles.id)
         or (dc.user_high = auth.uid() and dc.user_low = profiles.id)
    )
  );

-- ==========================================
-- studio_sessions: bind participants via trigger
-- ==========================================

create or replace function public.studio_sessions_bind_participants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'authentication required';
  end if;

  if tg_op = 'INSERT' then
    if new.host_user_id is null then
      new.host_user_id := uid;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.guest_user_id is null
       and new.host_user_id is not null
       and new.host_user_id is distinct from uid then
      new.guest_user_id := uid;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists studio_sessions_bind_participants_trg on public.studio_sessions;
create trigger studio_sessions_bind_participants_trg
  before insert or update on public.studio_sessions
  for each row
  execute function public.studio_sessions_bind_participants();

-- ==========================================
-- studio_sessions: replace open policies
-- ==========================================

drop policy if exists "studio_sessions_select_public" on public.studio_sessions;
drop policy if exists "studio_sessions_insert_self" on public.studio_sessions;
drop policy if exists "studio_sessions_update_party" on public.studio_sessions;
drop policy if exists "studio_sessions_delete_host" on public.studio_sessions;

revoke all on public.studio_sessions from anon;
grant select, insert, update, delete on public.studio_sessions to authenticated, service_role;

create policy "studio_sessions_select_participant_or_joinable"
  on public.studio_sessions
  for select
  to authenticated
  using (
    auth.uid() = host_user_id
    or auth.uid() = guest_user_id
    or (guest_user_id is null and host_user_id is not null)
  );

create policy "studio_sessions_insert_authenticated"
  on public.studio_sessions
  for insert
  to authenticated
  with check (true);

create policy "studio_sessions_update_participant"
  on public.studio_sessions
  for update
  to authenticated
  using (
    auth.uid() = host_user_id
    or auth.uid() = guest_user_id
  )
  with check (
    auth.uid() = host_user_id
    or auth.uid() = guest_user_id
  );

create policy "studio_sessions_delete_host"
  on public.studio_sessions
  for delete
  to authenticated
  using (auth.uid() = host_user_id);
