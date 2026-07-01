"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";
import KiteStudioLandingView from "@/components/kite-studio/KiteStudioLandingView";

function isAuthMode(mode: string | null): boolean {
  return mode === "login" || mode === "signup";
}

function hasLegacyAuthParams(searchParams: URLSearchParams): boolean {
  if (isAuthMode(searchParams.get("mode"))) return true;
  if (searchParams.get("error") === "auth_callback") return true;
  return false;
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

export default function WelcomePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [welcomeReady, setWelcomeReady] = useState(false);
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!hasLegacyAuthParams(searchParams)) return;
    router.replace(`/signin?${searchParams.toString()}`);
  }, [searchParams, router]);

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

    router.replace("/studio");
  }, [session, router]);

  if (hasLegacyAuthParams(searchParams)) {
    return <AuthRedirectOverlay />;
  }

  if (session === undefined) {
    return (
      <div className="min-h-screen bg-black" aria-busy="true" aria-label="Loading" />
    );
  }

  if (session) {
    return <AuthRedirectOverlay />;
  }

  if (!welcomeReady) {
    return (
      <div className="min-h-screen bg-black" aria-busy="true" aria-label="Loading" />
    );
  }

  return <KiteStudioLandingView />;
}
