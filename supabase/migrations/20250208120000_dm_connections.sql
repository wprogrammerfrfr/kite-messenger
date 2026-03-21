-- DM privacy: one row per user pair (user_low < user_high UUID string order).
-- status: pending | accepted | declined
-- initiated_by: first user who sent a DM in this pair (recipient sees a "request" until accepted).

create table if not exists public.dm_connections (
  user_low uuid not null references auth.users (id) on delete cascade,
  user_high uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined')),
  initiated_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_low, user_high),
  constraint dm_connections_users_distinct check (user_low <> user_high)
);

create index if not exists dm_connections_initiated_by_idx on public.dm_connections (initiated_by);
create index if not exists dm_connections_status_idx on public.dm_connections (status);

alter table public.dm_connections enable row level security;

create policy "dm_connections_select_own"
  on public.dm_connections for select
  using (auth.uid() = user_low or auth.uid() = user_high);

create policy "dm_connections_insert_as_participant"
  on public.dm_connections for insert
  with check (
    auth.uid() = initiated_by
    and (auth.uid() = user_low or auth.uid() = user_high)
  );

create policy "dm_connections_update_own"
  on public.dm_connections for update
  using (auth.uid() = user_low or auth.uid() = user_high)
  with check (auth.uid() = user_low or auth.uid() = user_high);
