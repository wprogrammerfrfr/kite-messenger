-- Baseline migration for public.profiles

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    nickname text,
    emergency_contact text,
    role text,
    updated_at timestamp with time zone,
    public_key text,
    profile_picture_url text,
    last_seen timestamp with time zone default now(),
    preferred_locale text default 'en'::text,
    bio text,
    encrypted_private_key_backup text,
    key_backup_salt text
);