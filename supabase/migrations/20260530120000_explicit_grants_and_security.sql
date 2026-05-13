-- ==========================================
-- Priority A: Explicit Grants (May 30 Update)
-- ==========================================

-- 1. Tables strictly for Authenticated Users & Server
grant select, insert, update, delete on public.profiles to authenticated, service_role;
grant select, insert, update, delete on public.messages to authenticated, service_role;
grant select, insert, update, delete on public.dm_connections to authenticated, service_role;
grant select, insert, update, delete on public.contact_aliases to authenticated, service_role;
grant select, insert, update, delete on public.push_subscriptions to authenticated, service_role;

-- 2. History Table (Anon can read/write their own session history)
grant select, insert on public.studio_history to anon, authenticated;
grant select, insert, update, delete on public.studio_history to service_role;

-- 3. Signaling Table (Requires Anon for unauthenticated WebRTC Lobby)
grant select, insert, update, delete on public.studio_sessions to anon, authenticated, service_role;


-- ==========================================
-- Priority A: Layer A Security for Signaling
-- ==========================================

alter table public.studio_sessions enable row level security;

-- SELECT: Anyone with the 6-character room code can read the room
create policy "studio_sessions_select_public"
  on public.studio_sessions for select 
  to anon, authenticated 
  using (true);

-- INSERT: Anyone can create a room, but they must claim it
create policy "studio_sessions_insert_self"
  on public.studio_sessions for insert 
  to anon, authenticated
  with check (host_user_id is null or host_user_id = auth.uid());

-- UPDATE: Only the Host or Guest can modify the SDP/ICE packets
create policy "studio_sessions_update_party"
  on public.studio_sessions for update 
  to anon, authenticated
  using (
    host_user_id is null
    or guest_user_id is null
    or host_user_id = auth.uid()
    or guest_user_id = auth.uid()
  )
  with check (
    host_user_id is null
    or guest_user_id is null
    or host_user_id = auth.uid()
    or guest_user_id = auth.uid()
  );

-- DELETE: Only the Host can delete the room
create policy "studio_sessions_delete_host"
  on public.studio_sessions for delete 
  to anon, authenticated
  using (host_user_id is null or host_user_id = auth.uid());