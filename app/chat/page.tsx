"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { readStoredLanguage, t } from "@/lib/translations";

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
  return (
    path != null && path !== "/chat" && !path.startsWith("/chat?")
  );
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

const ChatAuthenticatedShell = dynamic(
  () =>
    import("@/components/chat/ChatAuthenticatedShell").then(
      (m) => m.ChatAuthenticatedShell
    ),
  {
    ssr: false,
    loading: () => <AuthLazyLoadingFallback />,
  }
);

export default function ChatPage() {
  const searchParams = useSearchParams();
  const [redirectActive, setRedirectActive] = useState(false);
  const [session, setSession] = useState<Session | null | undefined>(undefined);

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
    if (!session) return;

    setAuthRedirectingStorage(false);
    setRedirectActive(false);

    const nextPath = resolvePostLoginPathFromSearchParams(searchParams);
    if (!isResumeRedirectTarget(nextPath)) return;

    window.location.assign(nextPath);
  }, [session, searchParams]);

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
    return <AuthLazyLoadingFallback />;
  }

  if (!session) {
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

  return <ChatAuthenticatedShell session={session} />;
}
