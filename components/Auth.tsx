"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { SHOW_PROFESSIONAL_AND_ROLE_UI } from "@/lib/feature-flags";

type Mode = "login" | "signup";
type Role = "musician" | "therapist" | "responder";

export function Auth() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("musician");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  // Allow landing → chat handoff via `/chat?mode=signup` or `/chat?mode=login`.
  // This is intentionally best-effort and falls back to login if missing/invalid.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const params = new URLSearchParams(window.location.search);
      const m = params.get("mode");
      if (m === "signup") setMode("signup");
      if (m === "login") setMode("login");
    } catch {
      // ignore
    }
  }, []);

  const isLogin = mode === "login";

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-white px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-neutral-900/70 shadow-2xl shadow-black/50 backdrop-blur-xl p-8">
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-3">
            <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border-2 border-white/20">
              <Image
                src="/kite-mobile-icon.png"
                alt=""
                width={40}
                height={40}
                className="h-full w-full object-cover"
                priority
              />
            </div>
            <div>
            <h1 className="text-2xl font-semibold tracking-tight">Kite</h1>
            <p className="text-sm text-neutral-400 mt-1">
              {isLogin ? "Welcome back to Kite." : "Create your Kite account."}
            </p>
            </div>
          </div>

          <div className="inline-flex items-center rounded-full bg-neutral-800 p-1 text-xs font-medium">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`px-3 py-1 rounded-full transition ${
                isLogin
                  ? "bg-white text-black shadow-sm"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={`px-3 py-1 rounded-full transition ${
                !isLogin
                  ? "bg-white text-black shadow-sm"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              Sign Up
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label
              htmlFor="email"
              className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-neutral-900/80 px-3 py-2.5 text-sm text-white placeholder:text-neutral-500 outline-none ring-0 transition focus:border-white/40 focus:ring-2 focus:ring-white/10"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="password"
              className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete={isLogin ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-neutral-900/80 px-3 py-2.5 text-sm text-white placeholder:text-neutral-500 outline-none ring-0 transition focus:border-white/40 focus:ring-2 focus:ring-white/10"
              placeholder="••••••••"
            />
          </div>

          {!isLogin && SHOW_PROFESSIONAL_AND_ROLE_UI && (
            <div className="space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
                Role
              </span>
              <div className="grid grid-cols-3 gap-2 rounded-xl bg-neutral-900/80 p-1 border border-white/10">
                <button
                  type="button"
                  onClick={() => setRole("musician")}
                  className={`flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium transition ${
                    role === "musician"
                      ? "bg-white text-black shadow-sm"
                      : "text-neutral-400 hover:text-white hover:bg-neutral-800"
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
                      : "text-neutral-400 hover:text-white hover:bg-neutral-800"
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
                      : "text-neutral-400 hover:text-white hover:bg-neutral-800"
                  }`}
                >
                  Responder
                </button>
              </div>
              <p className="text-xs text-neutral-500">
                We use this to personalize your experience in Kite.
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {error}
            </div>
          )}

          {message && !error && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black shadow-lg shadow-black/40 transition hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading
              ? isLogin
                ? "Logging in..."
                : "Creating account..."
              : isLogin
              ? "Login"
              : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-xs text-neutral-500 text-center">
          By continuing, you agree to our Terms and Privacy Policy.
        </p>
      </div>
    </div>
  );
}

