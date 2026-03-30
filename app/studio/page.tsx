"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/** Kite accent — matches GlobalNavShell active tab / support theme. */
const ORANGE = "#ff4500";
/** Tailwind `emerald-500` — pairs with studio-bridge emerald UI. */
const EMERALD = "#22c55e";

const MotionLink = motion(Link);

const MOCK_RECENT = [
  { id: "1", title: "Midnight Mix", meta: "2 days ago · Host" },
  { id: "2", title: "Acoustic Session", meta: "Last week · Guest" },
  { id: "3", title: "Studio A", meta: "Mar 12 · Host" },
] as const;

function SystemStatusDot() {
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
      <motion.span
        className="absolute inline-flex h-full w-full rounded-full"
        style={{ background: `linear-gradient(135deg, ${ORANGE}, ${EMERALD})` }}
        animate={{ scale: [1, 1.75, 1], opacity: [0.45, 0.1, 0.45] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.span
        className="relative inline-flex h-2.5 w-2.5 rounded-full"
        style={{
          background: `linear-gradient(135deg, ${ORANGE}, ${EMERALD})`,
        }}
        animate={{
          boxShadow: [
            `0 0 8px ${ORANGE}, 0 0 14px ${EMERALD}99`,
            `0 0 8px ${EMERALD}, 0 0 14px ${ORANGE}99`,
            `0 0 8px ${ORANGE}, 0 0 14px ${EMERALD}99`,
          ],
        }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      />
    </span>
  );
}

export default function StudioLobbyPage() {
  const router = useRouter();
  const [roomCode, setRoomCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinSuccess, setJoinSuccess] = useState(false);
  const [welcomeMode, setWelcomeMode] = useState<"loading" | "loggedOut" | "welcomeBack">("loading");
  const [welcomeName, setWelcomeName] = useState<string>("");

  useEffect(() => {
    let mounted = true;
    let callId = 0;

    const resolveFallbackName = (user: {
      id?: string;
      email?: string | null;
      user_metadata?: unknown;
    }) => {
      const meta = (user?.user_metadata ?? {}) as unknown as Record<string, unknown>;
      const nameFromMeta =
        (meta.display_name as string | undefined) ||
        (meta.full_name as string | undefined) ||
        (meta.name as string | undefined) ||
        (meta.username as string | undefined);

      const emailPrefix =
        typeof user.email === "string" && user.email.includes("@")
          ? user.email.split("@")[0]
          : undefined;

      const idPrefix =
        typeof user.id === "string" ? user.id.slice(0, 8) : undefined;

      return nameFromMeta || emailPrefix || idPrefix || "Kite Member";
    };

    const loadWelcome = async (session: unknown) => {
      const myCall = ++callId;
      if (!mounted) return;

      const s = session as
        | { user?: { id: string; email?: string | null; user_metadata?: unknown } }
        | null;

      if (!s?.user?.id) {
        if (!mounted || myCall !== callId) return;
        setWelcomeMode("loggedOut");
        setWelcomeName("");
        return;
      }

      const user = s.user;
      setWelcomeMode("loading");

      let nickname: string | null = null;
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("nickname")
          .eq("id", user.id)
          .maybeSingle();

        if (!mounted || myCall !== callId) return;

        if (!error && data?.nickname) {
          const n = String(data.nickname).trim();
          nickname = n.length > 0 ? n : null;
        }
      } catch {
        // Best-effort: if the profile row fails, we fall back to auth metadata/email.
      }

      if (!mounted || myCall !== callId) return;
      const fallback = resolveFallbackName(user);
      setWelcomeName(nickname ?? fallback);
      setWelcomeMode("welcomeBack");
    };

    void supabase.auth.getSession().then(({ data: { session } }) => {
      void loadWelcome(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      void loadWelcome(session);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const codeNormalized = roomCode
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 6)
    .toUpperCase();

  const joinSession = useCallback(() => {
    setJoinError(null);
    setJoinSuccess(false);

    if (joining) return;
    const code = codeNormalized;
    console.log("[Studio Lobby] Join Session — room code:", code || "(empty)");
    if (code.length !== 6) {
      setJoinError("Enter the 6-character signal code.");
      return;
    }

    setJoining(true);
    void (async () => {
      try {
        const { data, error } = await supabase
          .from("studio_sessions")
          .select("session_id")
          .eq("session_id", code)
          .maybeSingle();

        if (error || !data?.session_id) {
          setJoinError("Signal Not Found");
          setJoinSuccess(false);
          return;
        }

        setJoinSuccess(true);
        // Small beat so the user sees success before the bridge transition.
        window.setTimeout(() => {
          router.push(`/studio-bridge?room=${encodeURIComponent(code)}`);
        }, 450);
      } catch {
        setJoinError("Signal Not Found");
        setJoinSuccess(false);
      } finally {
        setJoining(false);
      }
    })();
  }, [codeNormalized, joining, router]);

  return (
    <div className="relative min-h-screen overflow-hidden text-white antialiased">
      <div className="fixed inset-0 bg-[#0c0a09]" aria-hidden />

      {/* Dual-tone aurora — orange + emerald */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        aria-hidden
        style={{
          background: `
            radial-gradient(ellipse 90% 70% at 0% -10%, rgba(255, 69, 0, 0.22), transparent 55%),
            radial-gradient(ellipse 80% 60% at 100% 0%, rgba(34, 197, 94, 0.16), transparent 50%),
            radial-gradient(ellipse 70% 50% at 100% 100%, rgba(255, 69, 0, 0.12), transparent 45%),
            radial-gradient(ellipse 75% 55% at 0% 100%, rgba(34, 197, 94, 0.14), transparent 48%),
            radial-gradient(ellipse 120% 80% at 50% 50%, rgba(255, 69, 0, 0.06), transparent 60%),
            radial-gradient(ellipse 100% 90% at 50% 80%, rgba(34, 197, 94, 0.05), transparent 55%)
          `,
        }}
      />
      <div className="pointer-events-none fixed inset-0 z-0 blur-3xl" aria-hidden>
        <div
          className="absolute -left-28 top-1/4 h-96 w-96 rounded-full opacity-50"
          style={{ background: `radial-gradient(circle, ${ORANGE}44 0%, transparent 70%)` }}
        />
        <div
          className="absolute -right-20 top-1/3 h-[26rem] w-[26rem] rounded-full opacity-45"
          style={{ background: `radial-gradient(circle, ${EMERALD}40 0%, transparent 70%)` }}
        />
        <div
          className="absolute bottom-28 left-1/3 h-72 w-72 -translate-x-1/2 rounded-full opacity-35"
          style={{
            background: `radial-gradient(circle, rgba(255,69,0,0.35) 0%, rgba(34,197,94,0.25) 45%, transparent 70%)`,
          }}
        />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1200px] flex-col px-5 pb-10 pt-8 sm:px-8 sm:pt-10">
        <div className="relative">
          <motion.button
            type="button"
            onClick={() => router.push("/chat")}
            whileTap={{ scale: 0.97 }}
            className="absolute right-0 top-0 rounded-lg border border-white/[0.12] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/55 transition hover:border-orange-500/25 hover:border-emerald-500/20 hover:bg-white/[0.05] hover:text-white/80"
            aria-label="Exit to chat"
          >
            Exit to Chat
          </motion.button>

          <motion.header
            className="mb-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-center gap-2">
              <SystemStatusDot />
              <span className="text-xs font-semibold uppercase tracking-widest text-stone-400">
                System: Ready
              </span>
            </div>

            <p className="mt-4 text-sm font-medium text-stone-300/90">
              {welcomeMode === "loggedOut" ? (
                "Welcome to Kite Studio"
              ) : (
                <>
                  Welcome back,{" "}
                  <span className="bg-gradient-to-r from-orange-400 via-stone-100 to-emerald-400 bg-clip-text text-transparent">
                    {welcomeMode === "loading" ? "Loading..." : welcomeName}
                  </span>
                </>
              )}
            </p>

            <h1 className="mt-3 bg-gradient-to-r from-orange-400 via-stone-100 to-emerald-400 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
              Kite Studio
            </h1>
          </motion.header>
        </div>

        <motion.div
          className="flex flex-1 flex-col items-center gap-5"
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Card A — Host (orange → green border) */}
          <section
            className="w-full max-w-lg rounded-2xl p-px shadow-2xl"
            style={{
              background: `linear-gradient(135deg, rgba(255,69,0,0.55) 0%, rgba(68,64,60,0.4) 42%, rgba(34,197,94,0.5) 100%)`,
              boxShadow: `
                0 0 0 1px rgba(255,255,255,0.04),
                0 24px 48px -20px rgba(0,0,0,0.75),
                0 0 60px -24px rgba(255,69,0,0.15),
                0 0 60px -24px rgba(34,197,94,0.12)
              `,
            }}
          >
            <div
              className="rounded-2xl p-6"
              style={{
                background:
                  "linear-gradient(165deg, rgba(12, 10, 9, 0.97) 0%, rgba(18, 16, 14, 0.96) 100%)",
              }}
            >
                <p className="text-[11px] font-semibold uppercase tracking-widest text-stone-500">
                  Host Session
                </p>
                <p className="mt-3 text-sm font-medium leading-relaxed text-stone-400">
                  Start a new jam and invite others to join your signal.
                </p>
              <MotionLink
                href="/studio-bridge"
                className="mt-6 flex w-full items-center justify-center rounded-xl border border-orange-500/35 bg-gradient-to-r from-orange-500/15 to-emerald-500/15 px-4 py-3 text-sm font-semibold text-stone-100 transition hover:from-orange-500/25 hover:to-emerald-500/25 hover:border-orange-500/45"
                whileTap={{ scale: 0.97 }}
              >
                Host Session
              </MotionLink>
            </div>
          </section>

          {/* Card B — Join */}
          <section
            className="w-full max-w-lg rounded-2xl border border-stone-700/90 bg-stone-950/35 p-6 backdrop-blur-sm"
            style={{
              boxShadow: `
                0 0 0 1px rgba(255,69,0,0.08),
                inset 0 1px 0 0 rgba(34,197,94,0.06)
              `,
            }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-widest text-stone-500">
              Join Session
            </p>
            <h2 className="mt-2 text-lg font-bold text-stone-200">Room code</h2>
            <p className="mt-1 text-sm font-medium text-stone-500">6-character signal code from your host.</p>
            <div className="mt-5 flex justify-center">
              <input
                type="text"
                inputMode="text"
                pattern="[A-Za-z0-9]*"
                autoComplete="off"
                spellCheck={false}
                maxLength={6}
                value={codeNormalized}
                onChange={(e) => setRoomCode(e.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") joinSession();
                }}
                placeholder="······"
                className="w-full max-w-[220px] rounded-xl border border-stone-600 bg-black/35 px-4 py-3 text-center font-mono text-lg font-semibold tracking-[0.4em] text-stone-100 placeholder:text-stone-600 outline-none transition focus:border-orange-500/40 focus:ring-1 focus:ring-emerald-500/35"
                aria-label="6-character signal code"
              />
            </div>
            <motion.button
              type="button"
              onClick={joinSession}
              className="mt-5 w-full rounded-xl border border-orange-500/25 bg-transparent px-4 py-3 text-sm font-semibold text-stone-200 transition hover:border-emerald-500/35 hover:bg-white/[0.04]"
              whileTap={{ scale: 0.97 }}
              disabled={joining}
            >
              Join Session
            </motion.button>
            <AnimatePresence>
              {joinError ? (
                <motion.div
                  key="join_error"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-center text-sm font-medium text-red-200"
                  role="status"
                >
                  {joinError}
                </motion.div>
              ) : null}
              {joinSuccess ? (
                <motion.div
                  key="join_success"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-center text-sm font-medium text-emerald-200"
                  role="status"
                >
                  Signal Found
                </motion.div>
              ) : null}
            </AnimatePresence>
          </section>

          <section className="mt-auto pt-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-stone-500">
              Recent Studio Sessions
            </h3>
            <ul className="mt-3 divide-y divide-stone-800/80 rounded-xl border border-stone-800/80 bg-stone-950/30">
              {MOCK_RECENT.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 first:rounded-t-xl last:rounded-b-xl"
                >
                  <span className="text-sm font-semibold text-stone-200">{row.title}</span>
                  <span className="shrink-0 text-xs font-medium text-stone-500">{row.meta}</span>
                </li>
              ))}
            </ul>
          </section>
        </motion.div>
      </div>
    </div>
  );
}
