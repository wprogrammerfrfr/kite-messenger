"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AlertCircle, CheckCircle, Eye, EyeOff, ArrowRight, Radio, Lock, Mail, type LucideIcon } from "lucide-react";

const ORANGE = "#FF4500";
const ORANGE_SOFT = "#FF7A45";
const TEAL = "#1A9E8F";
const TEAL_SOFT = "#2FCBB8";
const INK = "#050506";
const PAPER = "#F5F1E8";
const MUTE = "#9A9AA2";

const displayFont = "'Sora', system-ui, sans-serif";
const monoFont = "'DM Mono', 'IBM Plex Mono', monospace";

export type KiteAuthViewProps = {
  mode: "login" | "signup";
  onModeChange: (mode: "login" | "signup") => void;
  email: string;
  onEmailChange: (value: string) => void;
  password: string;
  onPasswordChange: (value: string) => void;
  showPassword: boolean;
  onTogglePassword: () => void;
  loading: boolean;
  resetSending: boolean;
  error: string | null;
  message: string | null;
  onSubmit: (e: FormEvent) => void;
  onGoogleLogin: () => void;
  onForgotPassword: () => void;
  isOnline?: boolean;
  offlineHint?: string;
  logoFallback?: ReactNode;
  roleSlot?: ReactNode;
};

function AmbientSignal() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    let t = 0;
    const draw = () => {
      t += 0.006;
      ctx.clearRect(0, 0, w, h);
      for (let line = 0; line < 3; line++) {
        ctx.beginPath();
        const yBase = h * (0.25 + line * 0.28);
        for (let x = 0; x <= w; x += 6) {
          const p = x / w;
          const y = yBase + Math.sin(p * 10 + t * (1 + line * 0.4) + line * 2) * (10 + line * 4);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = line % 2 === 0 ? ORANGE : TEAL;
        ctx.globalAlpha = 0.06;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      aria-hidden
    />
  );
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4c-7.5 0-14 4.2-17.7 10.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.5 0 10.4-1.9 14.3-5.1l-6.6-5.6C29.6 35 26.9 36 24 36c-5.3 0-9.7-3.1-11.3-7.9l-6.6 5C9.9 39.8 16.4 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.2 5.6l6.6 5.6C41.4 36 44 30.6 44 24c0-1.3-.1-2.7-.4-3.5z"
      />
    </svg>
  );
}

function Field({
  icon: Icon,
  type = "text",
  placeholder,
  value,
  onChange,
  endAdornment,
  disabled,
  autoComplete,
  required,
}: {
  icon: LucideIcon;
  type?: string;
  placeholder: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  endAdornment?: ReactNode;
  disabled?: boolean;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <div className="relative">
      <span
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
        aria-hidden
      >
        <Icon size={16} color={MUTE} />
      </span>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        disabled={disabled}
        autoComplete={autoComplete}
        required={required}
        className="w-full outline-none"
        style={{
          fontFamily: displayFont,
          fontSize: 14,
          color: PAPER,
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 12,
          padding: "13px 16px 13px 44px",
          transition: "border-color 0.2s ease, background 0.2s ease",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = `${TEAL}88`;
          e.currentTarget.style.background = "rgba(255,255,255,0.05)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
          e.currentTarget.style.background = "rgba(255,255,255,0.03)";
        }}
      />
      {endAdornment && (
        <div style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)" }}>
          {endAdornment}
        </div>
      )}
    </div>
  );
}

export function KiteAuthView({
  mode,
  onModeChange,
  email,
  onEmailChange,
  password,
  onPasswordChange,
  showPassword,
  onTogglePassword,
  loading,
  resetSending,
  error,
  message,
  onSubmit,
  onGoogleLogin,
  onForgotPassword,
  isOnline = true,
  offlineHint,
  logoFallback,
  roleSlot,
}: KiteAuthViewProps) {
  const [mounted, setMounted] = useState(false);
  const isSignup = mode === "signup";

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      className="kite-studio-auth min-h-screen w-full flex items-center justify-center px-5 py-12 relative overflow-hidden"
      style={{
        background: `radial-gradient(60% 50% at 20% 10%, ${ORANGE}18 0%, transparent 60%), radial-gradient(55% 45% at 85% 90%, ${TEAL}18 0%, transparent 55%), ${INK}`,
      }}
    >
      <AmbientSignal />

      <div
        className="relative z-10 w-full"
        style={{
          maxWidth: 400,
          opacity: mounted ? 1 : 0,
          transform: mounted ? "translateY(0px) scale(1)" : "translateY(18px) scale(0.98)",
          transition: "opacity 0.6s cubic-bezier(.2,.7,.2,1), transform 0.6s cubic-bezier(.2,.7,.2,1)",
        }}
      >
        <div
          className="relative rounded-3xl px-8 py-9"
          style={{
            background: "rgba(12,12,14,0.72)",
            border: "1px solid rgba(255,255,255,0.09)",
            backdropFilter: "blur(18px)",
            boxShadow: "0 30px 80px -20px rgba(0,0,0,0.6)",
          }}
        >
          {[
            { top: 12, left: 12 },
            { top: 12, right: 12 },
            { bottom: 12, left: 12 },
            { bottom: 12, right: 12 },
          ].map((pos, i) => (
            <span
              key={i}
              style={{
                position: "absolute",
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "rgba(255,255,255,0.14)",
                ...pos,
              }}
            />
          ))}

          <div className="flex flex-col items-center mb-7">
            <div style={{ filter: `drop-shadow(0 0 22px ${ORANGE}55)` }}>
              {logoFallback ?? (
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
          </div>

          <div
            className="relative flex mb-7 rounded-full p-1"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <div
              className="absolute top-1 bottom-1 rounded-full"
              style={{
                width: "calc(50% - 4px)",
                left: isSignup ? 4 : "calc(50% + 0px)",
                background: `linear-gradient(100deg, ${ORANGE}, ${TEAL})`,
                transition: "left 0.32s cubic-bezier(.2,.7,.2,1)",
              }}
            />
            {(["signup", "login"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onModeChange(m)}
                disabled={loading}
                className="relative z-10 flex-1 py-2 text-sm font-semibold rounded-full"
                style={{
                  fontFamily: displayFont,
                  color: mode === m ? INK : MUTE,
                  transition: "color 0.25s ease",
                }}
              >
                {m === "signup" ? "Sign Up" : "Log In"}
              </button>
            ))}
          </div>

          <div className="text-center mb-7">
            <h1 style={{ fontFamily: displayFont, fontWeight: 700, fontSize: 24, color: PAPER }}>
              {isSignup ? "Create an account" : "Welcome back"}
            </h1>
            <p style={{ fontFamily: displayFont, fontSize: 13.5, color: MUTE, marginTop: 6 }}>
              {isSignup ? "Get started for free" : "Log in to jump back into the lobby"}
            </p>
          </div>

          {!isOnline && offlineHint && (
            <p
              className="mb-4 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-100"
              role="status"
            >
              {offlineHint}
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
            onClick={() => void onGoogleLogin()}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 py-3 rounded-xl mb-6 disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              fontFamily: displayFont,
              fontSize: 14,
              fontWeight: 500,
              color: PAPER,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.1)",
              transition: "border-color 0.2s ease, background 0.2s ease",
            }}
          >
            <GoogleGlyph />
            Continue with Google
          </button>

          <div className="flex items-center gap-3 mb-6">
            <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
            <span style={{ fontFamily: monoFont, fontSize: 10.5, color: "#6b6b72", letterSpacing: 0.5 }}>
              OR CONTINUE WITH EMAIL
            </span>
            <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
          </div>

          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <Field
              icon={Mail}
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              disabled={loading}
              autoComplete="email"
              required
            />
            <Field
              icon={Lock}
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              disabled={loading}
              autoComplete={isSignup ? "new-password" : "current-password"}
              required
              endAdornment={
                <button type="button" onClick={onTogglePassword} style={{ display: "flex" }} aria-label={showPassword ? "Hide password" : "Show password"}>
                  {showPassword ? <EyeOff size={16} color={MUTE} /> : <Eye size={16} color={MUTE} />}
                </button>
              }
            />

            {roleSlot}

            {!isSignup && (
              <div className="flex justify-end -mt-1">
                <button
                  type="button"
                  onClick={() => void onForgotPassword()}
                  disabled={loading || resetSending}
                  style={{
                    fontFamily: displayFont,
                    fontSize: 12.5,
                    color: TEAL_SOFT,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  {resetSending ? "Sending link…" : "Forgot password?"}
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="group mt-2 relative inline-flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold text-sm w-full disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                fontFamily: displayFont,
                color: INK,
                background: `linear-gradient(100deg, ${ORANGE} 0%, ${ORANGE_SOFT} 45%, ${TEAL} 100%)`,
                boxShadow: `0 10px 30px -10px ${ORANGE}88`,
                transition: "transform 0.25s ease, box-shadow 0.25s ease",
              }}
            >
              {loading
                ? isSignup
                  ? "Creating account…"
                  : "Logging in…"
                : isSignup
                  ? "Create Account"
                  : "Log In"}
              <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
            </button>
          </form>

          <div className="text-center mt-6">
            <span style={{ fontFamily: displayFont, fontSize: 13.5, color: MUTE }}>
              {isSignup ? "Already have an account? " : "New to Kite Studio? "}
            </span>
            <button
              type="button"
              onClick={() => onModeChange(isSignup ? "login" : "signup")}
              disabled={loading}
              style={{
                fontFamily: displayFont,
                fontSize: 13.5,
                fontWeight: 700,
                color: PAPER,
                background: "none",
                border: "none",
                cursor: "pointer",
              }}
            >
              {isSignup ? "Log In" : "Sign Up"}
            </button>
          </div>
        </div>

        <div className="flex justify-center mt-6">
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full"
            style={{ background: `${TEAL}12`, border: `1px solid ${TEAL}33` }}
          >
            <Radio size={11} color={TEAL_SOFT} />
            <span style={{ fontFamily: monoFont, fontSize: 10.5, color: TEAL_SOFT }}>
              SESSION MEDIA NEVER STORED ON OUR SERVERS
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
