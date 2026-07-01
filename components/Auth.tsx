"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { KiteAuthView } from "@/components/kite-studio/KiteAuthView";
import { supabase } from "@/lib/supabase";
import {
  settingsProfileCacheKey,
  writeJsonCache,
} from "@/lib/kite-tab-cache";
import { SHOW_PROFESSIONAL_AND_ROLE_UI } from "@/lib/feature-flags";
import { useResilience } from "@/components/resilience-provider";
import { t, type Language } from "@/lib/translations";

type Mode = "login" | "signup";
type Role = "musician" | "therapist" | "responder";

function resolvePostLoginPath(): string {
  if (typeof window === "undefined") return "/studio";
  const next = new URLSearchParams(window.location.search).get("next");
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/studio";
}

function isStudioPostLoginPath(path: string): boolean {
  return path === "/studio" || path.startsWith("/studio/") || path.startsWith("/studio-bridge");
}

const LOBBY_HANDOFF_STORAGE_KEY = "kite-studio:lobby-handoff:v1";

type LobbyHandoffPayload = {
  userId: string;
  email: string;
  user_metadata: unknown;
  profilePrefetched: boolean;
};

function writeLobbyHandoff(payload: LobbyHandoffPayload): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(LOBBY_HANDOFF_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // private mode / quota
  }
}

async function warmProfileCacheForLobby(userId: string): Promise<boolean> {
  try {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("nickname, bio, emergency_contact, role, profile_picture_url")
      .eq("id", userId)
      .maybeSingle();
    if (error || !profile) return false;
    const p = profile as {
      nickname: string | null;
      bio: string | null;
      emergency_contact: string | null;
      role: string | null;
      profile_picture_url: string | null;
    };
    const role: Role =
      p.role === "therapist" || p.role === "musician" || p.role === "responder"
        ? p.role
        : "musician";
    writeJsonCache(settingsProfileCacheKey(userId), {
      nickname: p.nickname ?? "",
      bio: p.bio ?? "",
      emergencyContact: p.emergency_contact ?? "",
      profilePictureUrl: p.profile_picture_url ?? "",
      role,
    });
    return true;
  } catch {
    return false;
  }
}

type AuthProps = {
  onAuthRedirectStart?: () => void;
  onAuthRedirectEnd?: () => void;
};

export function Auth({ onAuthRedirectStart, onAuthRedirectEnd }: AuthProps = {}) {
  const router = useRouter();
  const { isOnline, isLowBandwidthMode } = useResilience();
  const [uiLang, setUiLang] = useState<Language>("en");
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("musician");
  const [loading, setLoading] = useState(false);
  const [resetSending, setResetSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      if (mode === "login") {
        const trimmedEmail = email.trim();
        if (!trimmedEmail || !password) {
          setError("Please enter your email and password.");
          setLoading(false);
          return;
        }

        setIsRedirecting(true);
        onAuthRedirectStart?.();

        const { data: signInData, error: signInError } =
          await supabase.auth.signInWithPassword({
            email: trimmedEmail,
            password,
          });

        if (signInError) {
          console.error("[Auth] signInWithPassword failed", {
            message: signInError.message,
            status: signInError.status,
            name: signInError.name,
            code: (signInError as { code?: string }).code,
            emailLength: trimmedEmail.length,
            supabaseHost: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host,
          });
          setIsRedirecting(false);
          onAuthRedirectEnd?.();
          setError(signInError.message);
        } else {
          const user = signInData.user;
          const userId = user?.id;
          if (userId && user) {
            writeLobbyHandoff({
              userId,
              email: user.email ?? "",
              user_metadata: user.user_metadata ?? {},
              profilePrefetched: false,
            });
            const profilePrefetched = await warmProfileCacheForLobby(userId);
            writeLobbyHandoff({
              userId,
              email: user.email ?? "",
              user_metadata: user.user_metadata ?? {},
              profilePrefetched,
            });
          }
          await supabase.auth.getSession();
          onAuthRedirectEnd?.();
          if (typeof window !== "undefined") {
            window.location.assign(resolvePostLoginPath());
          }
        }
      } else {
        const redirectBase =
          (typeof process !== "undefined" &&
            process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "")) ||
          (typeof window !== "undefined" ? window.location.origin : "");
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: redirectBase
              ? `${redirectBase}/auth/callback?next=${encodeURIComponent("/studio")}`
              : undefined,
            data: {
              role,
            },
          },
        });

        if (signUpError) {
          setError(signUpError.message);
        } else if (
          data?.user &&
          (!data.user.identities || data.user.identities.length === 0)
        ) {
          setError(
            "An account with this email already exists. Please sign in."
          );
        } else {
          setMessage("Check your email to confirm your account.");
        }
      }
    } catch (err) {
      if (mode === "login") {
        setIsRedirecting(false);
        onAuthRedirectEnd?.();
      }
      setError(
        err instanceof Error ? err.message : "Something went wrong. Try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setError(null);
    setMessage(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Please enter your email address.");
      return;
    }
    if (typeof window === "undefined") return;
    setResetSending(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });
      if (resetError) {
        setError(resetError.message);
      } else {
        setMessage("Check your email for a link to reset your password.");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong. Try again."
      );
    } finally {
      setResetSending(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const redirectBase =
        typeof window !== "undefined"
          ? window.location.origin
          : process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
      const oauthNext = encodeURIComponent(resolvePostLoginPath());
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${redirectBase}/auth/callback?next=${oauthNext}`,
        },
      });
      if (oauthError) setError(oauthError.message);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong. Try again."
      );
    } finally {
      setLoading(false);
    }
  };


  // Allow landing → chat handoff via `/chat?mode=signup` or `/chat?mode=login`.
  // This is intentionally best-effort and falls back to login if missing/invalid.
  useEffect(() => {
    if (mode !== "login") return;
    router.prefetch("/studio");
    const postLoginPath = resolvePostLoginPath();
    if (isStudioPostLoginPath(postLoginPath)) {
      router.prefetch("/studio-bridge");
    }
  }, [mode, router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const params = new URLSearchParams(window.location.search);
      const m = params.get("mode");
      if (m === "signup") setMode("signup");
      if (m === "login") setMode("login");
      if (params.get("error") === "auth_callback") {
        const description = params.get("error_description");
        setError(
          description
            ? description.slice(0, 200)
            : "Sign-in failed. Please try again."
        );
        try {
          const clean = new URL(window.location.href);
          clean.searchParams.delete("error");
          clean.searchParams.delete("error_description");
          window.history.replaceState({}, "", clean.pathname + clean.search);
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const lng = localStorage.getItem("nexus-lang");
      if (
        lng === "en" ||
        lng === "fa" ||
        lng === "ar" ||
        lng === "kr" ||
        lng === "tr"
      ) {
        setUiLang(lng);
      }
    } catch {
      // ignore
    }
  }, []);

  if (isRedirecting) {
    return (
      <div
        className="flex min-h-screen w-full items-center justify-center bg-[#000000]"
        role="status"
        aria-label="Redirecting"
      >
        <Loader2 className="h-8 w-8 animate-spin text-[#FF4500]" />
      </div>
    );
  }

  const logoFallback = isLowBandwidthMode ? (
    <span
      className="flex h-36 w-36 items-center justify-center rounded-xl bg-[#FF4500] text-2xl font-bold text-black"
      aria-hidden
    >
      K
    </span>
  ) : undefined;

  const roleSlot =
    mode === "signup" && SHOW_PROFESSIONAL_AND_ROLE_UI ? (
      <div className="space-y-1.5">
        <span className="text-xs font-medium uppercase tracking-[0.18em] text-[rgba(230,237,243,0.4)]">
          Role
        </span>
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-[rgba(230,237,243,0.08)] bg-[rgba(230,237,243,0.04)] p-1">
          <button
            type="button"
            onClick={() => setRole("musician")}
            className={`flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium transition ${
              role === "musician"
                ? "bg-white text-black shadow-sm"
                : "text-[rgba(230,237,243,0.4)] hover:bg-[rgba(230,237,243,0.08)] hover:text-white"
            }`}
          >
            Musician
          </button>
          <button
            type="button"
            onClick={() => setRole("therapist")}
            className={`flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium transition ${
              role === "therapist"
                ? "bg-white text-black shadow-sm"
                : "text-[rgba(230,237,243,0.4)] hover:bg-[rgba(230,237,243,0.08)] hover:text-white"
            }`}
          >
            Therapist
          </button>
          <button
            type="button"
            onClick={() => setRole("responder")}
            className={`flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium transition ${
              role === "responder"
                ? "bg-white text-black shadow-sm"
                : "text-[rgba(230,237,243,0.4)] hover:bg-[rgba(230,237,243,0.08)] hover:text-white"
            }`}
          >
            Responder
          </button>
        </div>
        <p className="text-xs text-[rgba(230,237,243,0.35)]">
          We use this to personalize your experience in Kite.
        </p>
      </div>
    ) : undefined;

  return (
    <KiteAuthView
      mode={mode}
      onModeChange={(nextMode) => {
        setMode(nextMode);
        setError(null);
        setMessage(null);
      }}
      email={email}
      onEmailChange={setEmail}
      password={password}
      onPasswordChange={setPassword}
      showPassword={showPassword}
      onTogglePassword={() => setShowPassword((v) => !v)}
      loading={loading}
      resetSending={resetSending}
      error={error}
      message={message}
      onSubmit={(e) => void handleSubmit(e)}
      onGoogleLogin={() => void handleGoogleLogin()}
      onForgotPassword={() => void handleForgotPassword()}
      isOnline={isOnline}
      offlineHint={t(uiLang, "authOfflineHint")}
      logoFallback={logoFallback}
      roleSlot={roleSlot}
    />
  );
}
