-- Baseline migration for public.messages

create table if not exists public.messages (
    id uuid primary key default gen_random_uuid(),
    created_at timestamp with time zone not null default timezone('utc'::text, now()),
    sender_id uuid not null,
    receiver_id uuid not null,
    encrypted_content text not null,
    is_session_mode boolean default false,
    content_for_sender text,
    is_read boolean default false
);