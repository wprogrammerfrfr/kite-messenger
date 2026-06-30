"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams, type ReadonlyURLSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";
import {
  NEXUS_LANG_CHANGE_EVENT,
  readStoredLanguage,
  t,
  type Language,
} from "@/lib/translations";
import KiteStudioWelcomeView from "@/components/kite-studio/KiteStudioWelcomeView";

const AUTH_REDIRECT_STORAGE_KEY = "is_auth_redirecting";

function resolveSafeNextPath(raw: string | null): string | null {
  if (raw == null || raw.trim() === "") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  return trimmed;
}

/** Matches Auth.tsx resolvePostLoginPath — default /studio on login/signup handoff. */
function resolvePostLoginPathFromSearchParams(
  searchParams: ReadonlyURLSearchParams
): string | null {
  const fromNext = resolveSafeNextPath(searchParams.get("next"));
  if (fromNext) return fromNext;
  const mode = searchParams.get("mode");
  if (mode === "login" || mode === "signup") return "/studio";
  return null;
}

function isResumeRedirectTarget(path: string | null): path is string {
  return path != null && path !== "/" && !path.startsWith("/?");
}

function readAuthRedirectingFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(AUTH_REDIRECT_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function setAuthRedirectingStorage(active: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (active) {
      sessionStorage.setItem(AUTH_REDIRECT_STORAGE_KEY, "true");
    } else {
      sessionStorage.removeItem(AUTH_REDIRECT_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

function isAuthMode(mode: string | null): boolean {
  return mode === "login" || mode === "signup";
}

function AuthLazyLoadingFallback() {
  const lang = readStoredLanguage();
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-sm text-stone-400">
      {t(lang, "chatLoadingShort")}
    </div>
  );
}

function AuthRedirectOverlay() {
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#000000]"
      role="status"
      aria-label="Redirecting"
    >
      <Loader2 className="h-8 w-8 animate-spin text-[#FF4500]" />
    </div>
  );
}

const AuthLazy = dynamic(
  () => import("@/components/Auth").then((m) => m.Auth),
  {
    ssr: false,
    loading: () => <AuthLazyLoadingFallback />,
  }
);

export default function WelcomePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [language, setLanguage] = useState<Language>("en");
  const [welcomeReady, setWelcomeReady] = useState(false);
  const [redirectActive, setRedirectActive] = useState(false);
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  const authMode = searchParams.get("mode");
  const showAuth = isAuthMode(authMode);

  useEffect(() => {
    setRedirectActive(readAuthRedirectingFromStorage());
  }, []);

  useEffect(() => {
    let mounted = true;

    void supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (!mounted) return;
      setSession(initialSession);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (!mounted) return;
      setSession(currentSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (session === undefined) return;

    if (!session) {
      setWelcomeReady(true);
      return;
    }

    setAuthRedirectingStorage(false);
    setRedirectActive(false);

    const nextPath = resolvePostLoginPathFromSearchParams(searchParams);
    if (isResumeRedirectTarget(nextPath)) {
      window.location.assign(nextPath);
      return;
    }

    router.replace("/studio");
  }, [session, searchParams, router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const storedLang = localStorage.getItem("nexus-lang");
      if (
        storedLang === "fa" ||
        storedLang === "ar" ||
        storedLang === "en" ||
        storedLang === "kr" ||
        storedLang === "tr"
      ) {
        setLanguage(storedLang);
      }
    } catch {
      // Ignore localStorage failures
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isRtl = language === "fa" || language === "ar";
    document.documentElement.dir = isRtl ? "rtl" : "ltr";
    document.documentElement.lang =
      language === "kr" ? "ko" : language === "tr" ? "tr" : language;
    document.cookie = `nexus-lang=${language}; path=/; max-age=${60 * 60 * 24 * 365}`;
  }, [language]);

  useEffect(() => {
    document.documentElement.classList.add("kite-studio-welcome-active");
    return () => {
      document.documentElement.classList.remove("kite-studio-welcome-active");
    };
  }, []);

  const handleLanguageChange = (lang: Language) => {
    setLanguage(lang);
    try {
      localStorage.setItem("nexus-lang", lang);
      window.dispatchEvent(new Event(NEXUS_LANG_CHANGE_EVENT));
    } catch {
      // Ignore localStorage failures
    }
  };

  const resumeNextPath = session
    ? resolvePostLoginPathFromSearchParams(searchParams)
    : null;
  const pendingResumeRedirect = isResumeRedirectTarget(resumeNextPath);

  if (redirectActive && !session) {
    return <AuthRedirectOverlay />;
  }

  if (pendingResumeRedirect) {
    return <AuthRedirectOverlay />;
  }

  if (session === undefined) {
    return (
      <div
        className="min-h-screen bg-black"
        aria-busy="true"
        aria-label="Loading"
      />
    );
  }

  if (session) {
    return <AuthRedirectOverlay />;
  }

  if (showAuth) {
    return (
      <AuthLazy
        onAuthRedirectStart={() => {
          setAuthRedirectingStorage(true);
          setRedirectActive(true);
        }}
        onAuthRedirectEnd={() => {
          setAuthRedirectingStorage(false);
          setRedirectActive(false);
        }}
      />
    );
  }

  const isRtl = language === "fa" || language === "ar";

  if (!welcomeReady) {
    return (
      <div
        className="min-h-screen bg-black"
        aria-busy="true"
        aria-label="Loading"
      />
    );
  }

  return (
    <div
      className="kite-studio-welcome caret-transparent select-none"
      dir={isRtl ? "rtl" : "ltr"}
    >
      <KiteStudioWelcomeView
        language={language}
        onLanguageChange={handleLanguageChange}
      />
    </div>
  );
}
