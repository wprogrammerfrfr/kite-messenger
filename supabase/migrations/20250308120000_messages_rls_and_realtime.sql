-- Messages: participants can read all messages in their threads (including before DM accept).
-- This fixes recipients who could not SELECT incoming request messages under overly strict RLS.

alter table public.messages enable row level security;

drop policy if exists "messages_participants_select" on public.messages;
create policy "messages_participants_select"
  on public.messages for select
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

drop policy if exists "messages_insert_as_sender" on public.messages;
create policy "messages_insert_as_sender"
  on public.messages for insert
  with check (auth.uid() = sender_id);

drop policy if exists "messages_update_participants" on public.messages;
create policy "messages_update_participants"
  on public.messages for update
  using (auth.uid() = sender_id or auth.uid() = receiver_id)
  with check (auth.uid() = sender_id or auth.uid() = receiver_id);

drop policy if exists "messages_delete_participants" on public.messages;
create policy "messages_delete_participants"
  on public.messages for delete
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

-- Realtime: in Supabase Dashboard → Database → Replication, enable `dm_connections`
-- (or run once): alter publication supabase_realtime add table public.dm_connections;
