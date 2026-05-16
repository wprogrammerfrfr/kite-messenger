"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  AlertCircle,
  CheckCircle,
  Eye,
  EyeOff,
  Lock,
  Mail,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { SHOW_PROFESSIONAL_AND_ROLE_UI } from "@/lib/feature-flags";
import { useResilience } from "@/components/resilience-provider";
import { t, type Language } from "@/lib/translations";

type Mode = "login" | "signup";
type Role = "musician" | "therapist" | "responder";

const GoogleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

const inputClassName =
  "w-full rounded-xl border border-[rgba(230,237,243,0.08)] bg-[rgba(230,237,243,0.04)] py-3 text-sm text-[rgba(230,237,243,0.9)] caret-[#FF4500] outline-none transition-all duration-200 placeholder:text-[rgba(230,237,243,0.35)] focus:border-[#FF4500]/50 focus:bg-[rgba(230,237,243,0.06)] focus:ring-[3px] focus:ring-[#FF4500]/10";

export function Auth() {
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      if (mode === "login") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) {
          setError(signInError.message);
        } else {
          setMessage("Logged in successfully.");
        }
      } else {
        const redirectBase =
          (typeof process !== "undefined" &&
            process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "")) ||
          (typeof window !== "undefined" ? window.location.origin : "");
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: redirectBase ? `${redirectBase}/auth/callback` : undefined,
            data: {
              role,
            },
          },
        });

        if (signUpError) {
          setError(signUpError.message);
        } else {
          setMessage("Check your email to confirm your account.");
        }
      }
    } catch (err) {
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
        process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
        window.location.origin;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${redirectBase}/auth/callback`,
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

  const toggleMode = () => {
    setMode((m) => (m === "login" ? "signup" : "login"));
    setError(null);
    setMessage(null);
  };

  // Allow landing → chat handoff via `/chat?mode=signup` or `/chat?mode=login`.
  // This is intentionally best-effort and falls back to login if missing/invalid.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const params = new URLSearchParams(window.location.search);
      const m = params.get("mode");
      if (m === "signup") setMode("signup");
      if (m === "login") setMode("login");
      if (params.get("error") === "auth_callback") {
        setError("Sign-in failed. Please try again.");
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

  const isLogin = mode === "login";

  return (
    <div
      className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#000000]"
      style={{ fontFamily: "'DM Sans', 'Inter', sans-serif" }}
    >
      <div
        className="pointer-events-none absolute"
        style={{
          width: 600,
          height: 600,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(255,69,0,0.07) 0%, transparent 70%)",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          filter: "blur(40px)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <div
        className="relative z-10 mx-4 w-full max-w-[400px] rounded-2xl border"
        style={{
          background: "#0B0F14",
          borderColor: "rgba(230,237,243,0.08)",
          boxShadow:
            "0 0 0 1px rgba(230,237,243,0.04), 0 32px 64px -16px rgba(0,0,0,0.8), 0 8px 32px -8px rgba(255,69,0,0.06)",
        }}
      >
        <div className="p-8">
          <div className="mb-8 flex flex-col items-center overflow-visible">
            <div className="mb-6 flex items-center justify-center overflow-visible px-1 pt-3">
              {isLowBandwidthMode ? (
                <span
                  className="flex h-36 w-36 items-center justify-center rounded-xl bg-[#FF4500] text-2xl font-bold text-black"
                  aria-hidden
                >
                  K
                </span>
              ) : (
                <Image
                  src="/kite_studio_logo_preview.svg"
                  alt="Kite Studio"
                  width={144}
                  height={144}
                  className="h-36 w-36 object-contain"
                  priority
                />
              )}
            </div>
            <h1
              className="text-xl font-semibold tracking-tight text-white"
              style={{ letterSpacing: "-0.02em" }}
            >
              {isLogin ? "Welcome back" : "Create an account"}
            </h1>
            <p className="mt-1 text-sm text-[rgba(230,237,243,0.4)]">
              {isLogin ? "Sign in to continue" : "Get started for free"}
            </p>
          </div>

          {!isOnline && (
            <p
              className="mb-4 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-100"
              role="status"
            >
              {t(uiLang, "authOfflineHint")}
            </p>
          )}

          {error && (
            <div
              className="mb-5 flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/[0.08] px-4 py-3 text-sm text-red-300"
              role="alert"
            >
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}
          {!error && message && (
            <div
              className="mb-5 flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.08] px-4 py-3 text-sm text-emerald-300"
              role="status"
            >
              <CheckCircle size={16} className="mt-0.5 shrink-0 text-green-400" />
              <span>{message}</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => void handleGoogleLogin()}
            disabled={loading}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-[rgba(230,237,243,0.1)] bg-[rgba(230,237,243,0.06)] py-3 text-sm font-medium text-white transition-all duration-200 hover:border-[rgba(230,237,243,0.16)] hover:bg-[rgba(230,237,243,0.1)] disabled:cursor-not-allowed disabled:opacity-60"
            style={{ letterSpacing: "-0.01em" }}
          >
            <GoogleIcon />
            Continue with Google
          </button>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-[rgba(230,237,243,0.08)]" />
            <span className="text-xs text-[rgba(230,237,243,0.3)]">
              or continue with email
            </span>
            <div className="h-px flex-1 bg-[rgba(230,237,243,0.08)]" />
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="relative">
              <Mail
                size={15}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[rgba(230,237,243,0.3)]"
              />
              <input
                id="email"
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                className={`${inputClassName} pl-10 pr-4`}
              />
            </div>

            <div className="relative">
              <Lock
                size={15}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[rgba(230,237,243,0.3)]"
              />
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isLogin ? "current-password" : "new-password"}
                required
                className={`${inputClassName} pl-10 pr-11`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[rgba(230,237,243,0.3)] transition-colors duration-150 hover:text-[rgba(230,237,243,0.7)]"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>

            {!isLogin && SHOW_PROFESSIONAL_AND_ROLE_UI && (
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
            )}

            {isLogin ? (
              <div className="-mt-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleForgotPassword()}
                  disabled={loading || resetSending}
                  className="text-xs text-[rgba(230,237,243,0.4)] transition-colors duration-150 hover:text-[#FF4500] disabled:cursor-not-allowed disabled:text-[rgba(230,237,243,0.2)]"
                >
                  {resetSending ? "Sending link…" : "Forgot password?"}
                </button>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="mt-1 w-full rounded-xl py-3 text-sm font-semibold text-white transition-all duration-200 disabled:cursor-not-allowed"
              style={{
                background: loading
                  ? "rgba(255,69,0,0.5)"
                  : "linear-gradient(135deg, #FF4500 0%, #FF5722 100%)",
                boxShadow: loading
                  ? "none"
                  : "0 0 20px rgba(255,69,0,0.3), 0 4px 12px rgba(255,69,0,0.2)",
                letterSpacing: "-0.01em",
              }}
            >
              {loading
                ? isLogin
                  ? "Logging in…"
                  : "Creating account…"
                : isLogin
                  ? "Log In"
                  : "Create Account"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-[rgba(230,237,243,0.35)]">
            {isLogin ? (
              <>
                Don&apos;t have an account?{" "}
                <button
                  type="button"
                  onClick={toggleMode}
                  disabled={loading}
                  className="font-medium text-[rgba(230,237,243,0.7)] transition-colors duration-150 hover:text-[#FF4500] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Sign Up
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={toggleMode}
                  disabled={loading}
                  className="font-medium text-[rgba(230,237,243,0.7)] transition-colors duration-150 hover:text-[#FF4500] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Log In
                </button>
              </>
            )}
          </p>
        </div>
      </div>

      <p className="absolute bottom-6 w-full text-center text-xs text-[rgba(230,237,243,0.18)]">
        By continuing, you agree to our Terms & Privacy Policy.
      </p>
    </div>
  );
}
