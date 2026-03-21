import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Email confirmation / OAuth: exchanges `code` for a session and sets auth cookies.
 * Configure Supabase Auth redirect URL to: {SITE_URL}/auth/callback
 * Set NEXT_PUBLIC_SITE_URL=https://kite-messenger-omega.vercel.app (or your prod URL).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextPath = url.searchParams.get("next") ?? "/chat";

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    url.origin;

  const errorRedirect = NextResponse.redirect(
    new URL(`/chat?error=auth_callback`, siteUrl)
  );

  if (!code) {
    return errorRedirect;
  }

  const cookieStore = cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            /* ignore when called outside mutable context */
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            /* ignore */
          }
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return errorRedirect;
  }

  const safeNext = nextPath.startsWith("/") ? nextPath : `/${nextPath}`;
  return NextResponse.redirect(new URL(safeNext, siteUrl));
}
