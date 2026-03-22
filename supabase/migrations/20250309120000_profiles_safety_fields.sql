-- Safety profiles: emergency contact + optional locale badge (app enforces accepted-DM visibility).

alter table public.profiles
  add column if not exists emergency_contact text;

alter table public.profiles
  add column if not exists preferred_locale text;

comment on column public.profiles.emergency_contact is
  'Private; show in app only to users with accepted dm_connections.';
comment on column public.profiles.preferred_locale is
  'Optional en/fa/ar; synced from Settings for profile badge.';
