---
name: ""
overview: ""
todos: []
isProject: false
---

**Task:** Generate an execution blueprint (`.plan.md`) to fix the PKCE OAuth mismatch, environment variable naming, and existing account checks.

**Context:** The user's Google OAuth is successfully creating users in Supabase, but failing at the `/auth/callback` exchange because the browser client uses `localStorage` while the server route expects cookies. Furthermore, the codebase looks for `NEXT_PUBLIC_SITE_URL` but the environment uses `NEXT_PUBLIC_APP_URL`.

**Architectural Objectives to Map in the Plan:**

1. **Fix the PKCE Cookie Mismatch:** We must align the browser client to use `@supabase/ssr` with cookies. Plan to update `lib/supabase.ts` (or wherever the browser client is initialized) to use `createBrowserClient` from `@supabase/ssr` instead of `createClient` from `@supabase/supabase-js`.
2. **Fix the Environment Variable Typo:** Plan to update `components/Auth.tsx` (and any other files routing auth) to check for `process.env.NEXT_PUBLIC_APP_URL` instead of `NEXT_PUBLIC_SITE_URL`.
3. **Implement Existing Account UI Check:** In `components/Auth.tsx`, inside the standard email `signUp` function, plan to check if `data.user?.identities?.length === 0`. If true, display a specific error: "An account with this email already exists. Please sign in." instead of the success message.

**Strict Constraints (Mandatory):**

- **DO NOT EXECUTE CODE OR AUTO-COMMIT.** This step is purely to write the `.plan.md` file.
- **Rule of One:** One step = one file = one logical change. Never mix the browser client update with the `Auth.tsx` UI changes in the same step.
- Keep error boundaries robust. Do not alter working Kite Sync or Kite Studio logic.

Please output the structured `.plan.md` now so I can review the file step boundaries before execution.