# Profile Photo Upload — Diagnostic Report

## Executive Summary

The regression is **not** a Supabase bucket misconfiguration or a broken storage API. Upload still works on `/settings` via `ProfileHub.tsx`. The Studio Lobby redesign introduced `ProfileDrawer.tsx` with a **placeholder** camera button that never opens a file picker and never calls upload logic. The lobby also never loaded or rendered `profile_picture_url`, so even existing avatars would not appear in the new UI.

**Status:** Fixed — shared upload helper, ProfileDrawer wiring, and Studio Lobby hydration implemented per the plan below.

---

## Root Cause (Exact)

The Studio Lobby profile UI (`ProfileDrawer`) was shipped as a UI shell during redesign without porting the avatar upload pipeline from `ProfileHub`. The camera button was a stub (`flashSaved("Choose an image to upload")`). There was no file input, no Supabase Storage call, no `profiles.profile_picture_url` update, and no cache/state propagation back to `app/studio/page.tsx`.

Supabase Storage and the `chat-images` bucket were **not** implicated — they remain in use and working on `/settings`.

---

## Pipeline Comparison

### Working path (ProfileHub at `/settings`)

1. User clicks Upload Photo → hidden input click
2. `onChange` → `handleAvatarUpload`
3. `storage.from("chat-images").upload`
4. `getPublicUrl` → local state
5. Form submit upserts `profiles.profile_picture_url`
6. `writeJsonCache(settingsProfileCacheKey)`

### Broken path (Studio Lobby ProfileDrawer — pre-fix)

1. User clicks Camera button → placeholder toast only
2. No file input, no storage upload, no DB update
3. Initials-only avatar rendered

---

## Files Modified (Fix Implementation)

| File | Change |
|------|--------|
| `lib/profile-avatar-upload.ts` | New shared upload + DB persist + cache write |
| `components/studio/ProfileDrawer.tsx` | File input, upload handler, avatar display, parent callback |
| `app/studio/page.tsx` | Fetch/display/hydrate `profile_picture_url` |
| `components/ProfileHub.tsx` | Refactored to use shared upload helper |

**Not touched:** audio/WebRTC engine paths (forbidden zone).

---

## Testing Sequence

1. Localhost, Chrome: Upload photo in Studio drawer → image in drawer + lobby header; refresh persists.
2. Verify `/settings` still works after ProfileHub refactor.
3. Same WiFi, two devices: avatar visible in chat via `profile_picture_url`.
4. Regression: Host/join jam flows unchanged.
