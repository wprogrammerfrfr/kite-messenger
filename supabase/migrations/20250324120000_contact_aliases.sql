-- Per-user private display names for contacts (local aliases). Not shared with the contact.

create table if not exists public.contact_aliases (
  user_id uuid not null references auth.users (id) on delete cascade,
  contact_id uuid not null references auth.users (id) on delete cascade,
  alias text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, contact_id),
  constraint contact_aliases_no_self check (user_id <> contact_id)
);

create index if not exists contact_aliases_user_id_idx on public.contact_aliases (user_id);

comment on table public.contact_aliases is
  'Optional nickname shown only to user_id when viewing contact_id; does not change public profile.';

alter table public.contact_aliases enable row level security;

create policy "contact_aliases_select_own"
  on public.contact_aliases for select
  using (auth.uid() = user_id);

create policy "contact_aliases_insert_own"
  on public.contact_aliases for insert
  with check (auth.uid() = user_id);

create policy "contact_aliases_update_own"
  on public.contact_aliases for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "contact_aliases_delete_own"
  on public.contact_aliases for delete
  using (auth.uid() = user_id);
