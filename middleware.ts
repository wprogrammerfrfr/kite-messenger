import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/studio", "/studio-bridge", "/settings"] as const;

function isProtectedStudioRoute(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/**
 * Public routes (no server-side auth redirect): `/`, `/welcome`, `/chat`, static files.
 * Studio routes require a valid Supabase session before page assets are served.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const isPublic =
    pathname === "/" ||
    pathname === "/welcome" ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/chat") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    /\.(ico|png|jpg|jpeg|gif|webp|svg|txt|xml|json)$/i.test(pathname);

  if (isPublic || !isProtectedStudioRoute(pathname)) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });

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
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  await supabase.auth.getSession();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL("/chat", request.url);
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
