import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Public routes (no server-side auth redirect): `/`, `/welcome`, `/chat`, static files.
 * Auth remains client-side; this matcher reserves space for future rules.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic =
    pathname === "/" ||
    pathname === "/welcome" ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/chat") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    /\.(ico|png|jpg|jpeg|gif|webp|svg|txt|xml|json)$/i.test(pathname);

  if (isPublic) {
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all pathnames except static assets (Next already excludes many).
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
