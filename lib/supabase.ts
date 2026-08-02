import { createBrowserClient } from "@supabase/ssr";
import { processLock } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase env: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local"
  );
}

/**
 * Browser Supabase client (cookie-based auth for PKCE/OAuth).
 * Server code exchange runs in app/auth/callback/route.ts.
 *
 * `lock: processLock` — auth-js defaults to the cross-tab Navigator LockManager,
 * which crashes multi-tab sessions (P2P host+guest testing) with
 * "Lock broken by another request with the 'steal' option" when one tab holds
 * the auth lock too long. The in-process lock still serializes auth calls
 * within each tab; cross-tab refresh races are absorbed by Supabase's
 * refresh-token reuse grace window.
 */
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    detectSessionInUrl: false,
    lock: processLock,
  },
});
