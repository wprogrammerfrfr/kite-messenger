# Login Regression — Pre-Flight Edge Case Audit

Companion to [login_and_hydration_fix plan](login_and_hydration_fix_ffe26d19.plan.md). Read-only audit before implementation.

## Summary

| # | Edge case | Verdict | Plan action |
|---|-----------|---------|-------------|
| 1 | Cookie domain hardcoded to production | **Not found** | None — cookies are host-scoped via Supabase SSR defaults |
| 2 | `?next=` stripped by middleware/config | **Not found** | None — middleware preserves `pathname + search` |
| 3 | `auth.users` triggers causing 400 | **Not in repo** | Step 1 logging; check Supabase Dashboard if 400 persists |
| 4 | Chat shell mounts before `?next=` redirect | **Already guarded** | Step 4 must preserve `pendingResumeRedirect` block |

## Current login state (verified)

Two layers — **do not conflate:**

- **Layer A (Supabase API):** Your reported 400 means `signInWithPassword` is rejected **before** redirect. Login does **not** complete for that attempt. Params in code are correct; Step 1 logging finds the real Supabase error message (credentials, email confirmation, env, etc.).
- **Layer B (post-auth routing):** **Already in uncommitted working tree** — on success, `Auth.tsx` L174 does `window.location.assign("/studio")`. Last committed HEAD only showed "Logged in successfully." and left users on old chat UI.

**Hydration fixes (Steps 2–4) do not fix the 400.** They clean up `/studio` after Layer A passes.

## Post-fix UX

| Layer A | After plan |
|---------|------------|
| Still 400 | Login form + clearer console error; lobby never loads |
| Passes | `/studio` → brief skeleton → **new Studio Lobby UI** (redirect already wired in working tree) |

## Env checklist (manual, not code)

- Local dev: `NEXT_PUBLIC_APP_URL` unset or `http://localhost:3000` (OAuth callback origin)
- `.env.local`: `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` match the project where the user account exists
- Supabase Dashboard: Email provider enabled; confirm-email policy understood
