import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/studio", "/studio-bridge"] as const;

const LEGACY_BLOCKED_PREFIXES = [
  "/chat",
  "/messages",
  "/dashboard",
  "/discover",
  "/explore",
  "/settings",
  "/profile",
] as const;

function isLegacyBlockedRoute(pathname: string): boolean {
  return LEGACY_BLOCKED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function isProtectedStudioRoute(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function createSupabaseMiddlewareClient(
  request: NextRequest,
  response: NextResponse
) {
  return createServerClient(
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
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );
}

/**
 * Public routes (no server-side auth redirect): `/`, `/welcome`, static files.
 * Legacy chat/discovery/profile routes redirect to `/` or `/studio-bridge`.
 * Unauthenticated studio access redirects to `/signin?mode=login`.
 * Studio routes require a valid Supabase session before page assets are served.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isLegacyBlockedRoute(pathname)) {
    let legacyResponse = NextResponse.next({ request });
    const supabase = createSupabaseMiddlewareClient(request, legacyResponse);

    await supabase.auth.getSession();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const redirectPath = user ? "/studio-bridge" : "/";
    const redirectResponse = NextResponse.redirect(
      new URL(redirectPath, request.url),
      307
    );
    legacyResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie.name, cookie.value);
    });
    return redirectResponse;
  }

  const isPublic =
    pathname === "/" ||
    pathname === "/welcome" ||
    pathname === "/signin" ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    /\.(ico|png|jpg|jpeg|gif|webp|svg|txt|xml|json)$/i.test(pathname);

  if (isPublic || !isProtectedStudioRoute(pathname)) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });
  const supabase = createSupabaseMiddlewareClient(request, supabaseResponse);

  await supabase.auth.getSession();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL("/signin", request.url);
    loginUrl.searchParams.set("mode", "login");
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl, 307);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all pathnames except static assets (Next already excludes many).
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
