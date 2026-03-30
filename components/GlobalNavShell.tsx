"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleUser, MessageSquareText, Route, Film } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import {
  prefetchDashboardAliases,
  prefetchDiscoverSidebar,
  prefetchSettingsProfile,
} from "@/lib/kite-prefetch";
import {
  NEXUS_LANG_CHANGE_EVENT,
  readStoredLanguage,
  t,
  type Language,
} from "@/lib/translations";

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
};

const bottomHeightPx = 76;
const desktopSidebarWidthPx = 288; // 18rem

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function getStoredLangForPrefetch(): Language {
  return readStoredLanguage();
}

export default function GlobalNavShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isStudioMode = typeof pathname === "string" && pathname.startsWith("/studio");
  const [navMounted, setNavMounted] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [language, setLanguage] = useState<Language>(() => readStoredLanguage());

  useEffect(() => {
    setNavMounted(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setLanguage(readStoredLanguage());
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(NEXUS_LANG_CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(NEXUS_LANG_CHANGE_EVENT, sync);
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const isRTL = language === "fa" || language === "ar";
    document.documentElement.dir = isRTL ? "rtl" : "ltr";
    document.documentElement.lang =
      language === "kr" ? "ko" : language === "tr" ? "tr" : language;
  }, [language]);

  useEffect(() => {
    let mounted = true;

    void (async () => {
      await new Promise<void>((resolve) => {
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(() => resolve());
        } else {
          resolve();
        }
      });
      if (!mounted) return;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!mounted) return;
      setHasSession(Boolean(session));
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setHasSession(Boolean(session));
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const prefetchTab = useCallback((href: string) => {
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.id) return;
      const uid = session.user.id;
      const lang = getStoredLangForPrefetch();
      if (href === "/chat" || href === "/dashboard") {
        prefetchDiscoverSidebar(uid, lang);
      }
      if (href === "/dashboard") {
        prefetchDashboardAliases(uid);
      }
      if (href === "/settings") {
        prefetchSettingsProfile(uid);
      }
    })();
  }, []);

  const items: NavItem[] = useMemo(
    () => [
      {
        href: "/chat",
        label: t(language, "navTabChats"),
        icon: <MessageSquareText className="h-5 w-5" aria-hidden />,
      },
      {
        href: "/dashboard",
        label: t(language, "navTabDiscover"),
        icon: <Route className="h-5 w-5" aria-hidden />,
      },
      {
        href: "/studio",
        label: t(language, "navTabStudio"),
        icon: <Film className="h-5 w-5" aria-hidden />,
      },
      {
        href: "/settings",
        label: t(language, "navTabProfile"),
        icon: <CircleUser className="h-5 w-5" aria-hidden />,
      },
    ],
    [language]
  );

  return (
    <div
      style={
        {
          "--bottom-nav-height": `${bottomHeightPx}px`,
          "--desktop-sidebar-width": `${desktopSidebarWidthPx}px`,
        } as React.CSSProperties
      }
      className="min-h-screen"
    >
      {navMounted && hasSession && !isStudioMode ? (
        <>
          {/* Desktop nav sidebar */}
          <aside
            className="hidden lg:flex fixed top-0 left-0 bottom-0 w-[var(--desktop-sidebar-width)] flex-col gap-2 p-3 backdrop-blur-md"
            style={{
              background: "rgba(0,0,0,0.85)",
              borderRight: "1px solid rgba(255,69,0,0.18)",
              backdropFilter: "blur(10px)",
              zIndex: 40,
            }}
          >
            <div className="px-2 py-2">
              <div className="text-xs uppercase tracking-widest font-semibold text-stone-500">
                {t(language, "navAppBrand")}
              </div>
            </div>
            <div className="flex flex-col gap-1 px-1">
              {items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onMouseEnter={() => prefetchTab(item.href)}
                    onTouchStart={() => prefetchTab(item.href)}
                    className="rounded-xl p-3 flex items-center gap-3 transition hover:bg-white/5"
                    style={{
                      color: active ? "#FF4500" : "rgba(255,255,255,0.85)",
                      background: active ? "rgba(255,69,0,0.16)" : "transparent",
                      border: active
                        ? "1px solid rgba(255,69,0,0.35)"
                        : "1px solid transparent",
                      boxShadow: active ? "0 0 0 1px rgba(255,69,0,0.2)" : "none",
                    }}
                  >
                    {item.icon}
                    <span className={`text-sm ${active ? "font-bold" : "font-semibold"}`}>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </aside>

          {/* Mobile bottom nav */}
          <nav
            className="lg:hidden fixed left-0 right-0 bottom-0 z-50 backdrop-blur-md"
            style={{
              height: `var(--bottom-nav-height)`,
              background: "rgba(0,0,0,0.78)",
              borderTop: "1px solid rgba(255,69,0,0.18)",
              backdropFilter: "blur(10px)",
            }}
          >
            <div className="h-full px-3 flex items-center justify-between gap-2">
              {items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onMouseEnter={() => prefetchTab(item.href)}
                    onTouchStart={() => prefetchTab(item.href)}
                    aria-label={item.label}
                    className="flex flex-1 flex-col items-center justify-center gap-1 rounded-xl transition"
                    style={{
                      color: active ? "#FF4500" : "rgba(255,255,255,0.82)",
                    }}
                  >
                    <div
                      className="rounded-lg p-2"
                      style={{
                        background: active ? "rgba(255,69,0,0.2)" : "transparent",
                        border: active
                          ? "1px solid rgba(255,69,0,0.35)"
                          : "1px solid transparent",
                      }}
                    >
                      {item.icon}
                    </div>
                    <span className="text-[11px] font-semibold">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>
        </>
      ) : null}

      {/* Main content with fade-in (client-only motion to avoid SSR / hydration drift) */}
      <main
        className={
          isStudioMode
            ? "min-h-screen w-full"
            : `min-h-screen ${
                hasSession ? "lg:pl-[var(--desktop-sidebar-width)] pb-[var(--bottom-nav-height)]" : ""
              }`
        }
      >
        {children}
      </main>
    </div>
  );
}

