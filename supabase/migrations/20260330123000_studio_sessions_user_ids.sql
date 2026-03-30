alter table public.studio_sessions
  add column if not exists host_user_id uuid,
  add column if not exists guest_user_id uuid;
