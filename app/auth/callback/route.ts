import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

function resolveSafeNextPath(raw: string | null): string {
  const fallback = "/studio";
  if (raw == null || raw.trim() === "") return fallback;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return fallback;
  return trimmed;
}

/**
 * Email confirmation / OAuth: exchanges `code` for a session and sets auth cookies.
 * Redirects always use the request origin so localhost and production each stay on-host.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  const appUrl = url.origin;

  function errorRedirect(description?: string) {
    const target = new URL("/", appUrl);
    target.searchParams.set("mode", "login");
    target.searchParams.set("next", "/studio");
    target.searchParams.set("error", "auth_callback");
    if (description) {
      target.searchParams.set(
        "error_description",
        description.slice(0, 200)
      );
    }
    return NextResponse.redirect(target);
  }

  if (!code) {
    return errorRedirect();
  }

  const nextPath = resolveSafeNextPath(url.searchParams.get("next"));
  let response = NextResponse.redirect(new URL(nextPath, appUrl));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[]
        ) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return errorRedirect(error.message);
  }

  return response;
}
