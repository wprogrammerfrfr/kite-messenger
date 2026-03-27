-- Unified Profile Hub: optional public bio text.
alter table public.profiles
  add column if not exists bio text;

comment on column public.profiles.bio is
  'Optional short user bio shown on the Profile Hub screen.';

