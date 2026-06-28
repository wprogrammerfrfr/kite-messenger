# Preferences Tab Cleanup Plan

**Scope:** [`components/studio/ProfileDrawer.tsx`](../components/studio/ProfileDrawer.tsx), [`lib/profile-avatar-upload.ts`](../lib/profile-avatar-upload.ts), [`app/studio/page.tsx`](../app/studio/page.tsx)  
**Out of scope:** Audio/WebRTC engine, storage bucket purge

**Status:** Implemented

---

## Phase 1 — Audit Summary

### Theme toggle (removed)

The Preferences tab previously exposed a Light/Dark segmented control wired to `getStoredAppearance` / `setAppearanceMode`. Kite Studio is strictly dark mode; the toggle was the only Studio-surface consumer of those helpers.

**Removed from `ProfileDrawer.tsx`:**
- Imports: `Moon`, `Sun`, `getStoredAppearance`, `setAppearanceMode`
- State: `theme`
- Effect syncing theme on drawer open
- Handler: `handleThemeChange`
- JSX: entire Appearance block (FieldLabel + Light/Dark buttons)

### Profile picture state

- Local: `profilePictureUrl` / `setProfilePictureUrl` (empty string = initials fallback)
- Upload: `handleAvatarUpload` → `uploadProfileAvatar` → `onProfilePictureUpdated(publicUrl)`
- Remove (new): `handleRemoveAvatar` → `removeProfileAvatar` → `onProfilePictureUpdated(null)`

### Database / cache

New helper `removeProfileAvatar(userId)` in `profile-avatar-upload.ts`:
- Sets `profiles.profile_picture_url` to `null`
- Updates `settingsProfileCacheKey` cache with `profilePictureUrl: null`
- Does not delete storage bucket objects (intentional v1 scope)

---

## Phase 2 — Implementation

### 1. `removeProfileAvatar` (`lib/profile-avatar-upload.ts`)

Exported function mirrors upload cache pattern; throws `ProfileAvatarUploadError` on DB failure.

### 2. `ProfileDrawer.tsx`

- `onProfilePictureUpdated?: (url: string | null) => void`
- `avatarRemoving` state + `handleRemoveAvatar`
- Preferences tab: "Remove profile picture" button (red destructive styling), visible only when `profilePictureUrl` is set
- Camera button disabled during upload or remove
- Theme toggle fully removed; Language select unchanged

### 3. `app/studio/page.tsx`

- `handleProfilePictureUpdated` accepts `string | null` so lobby header avatar clears on remove

### Remove button styling

```
border-red-500/30 bg-red-500/5 text-red-400
hover:border-red-500/50 hover:bg-red-500/10
```

---

## Safety Check

| Area | Changed? |
|------|----------|
| `uploadProfileAvatar` | No |
| ThemeProvider (layout root) | No |
| Audio / WebRTC / engine | No |
| Language select | No (UI-only, unchanged) |
| Profile save / password | No |
| `profiles.profile_picture_url` | Yes — null via `removeProfileAvatar` only |

---

## Manual test checklist

1. Studio lobby → Preferences: no theme toggle; Language still visible
2. With custom avatar: "Remove profile picture" visible; click → initials in drawer + lobby; success flash
3. Refresh page → avatar stays removed (DB + cache)
4. Upload still works after remove
5. No custom avatar → Remove section hidden

---

## What was NOT touched

- `hooks/useKiteStudioEngine.ts`, worklets, P2P/signaling
- `components/ProfileHub.tsx`
- Supabase storage bucket deletion
- `components/theme-provider.tsx`
