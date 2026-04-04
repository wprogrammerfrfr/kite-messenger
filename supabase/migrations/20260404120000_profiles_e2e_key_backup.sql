-- Client-encrypted E2EE private key backup (PIN vault). Server stores only salt + ciphertext.
alter table public.profiles
  add column if not exists encrypted_private_key_backup text;
alter table public.profiles
  add column if not exists key_backup_salt text;

comment on column public.profiles.encrypted_private_key_backup is
  'Opaque client-encrypted blob (e.g. AES-GCM IV + ciphertext). Server never sees the raw private key.';
comment on column public.profiles.key_backup_salt is
  'Random salt (e.g. base64) for client-side PIN key derivation (PBKDF2). Server never sees the PIN.';