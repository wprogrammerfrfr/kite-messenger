"use client";

import React, { memo, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, Mic, Volume2 } from "lucide-react";

type CheckRowState = "pending" | "done" | "error";

export type StudioPreflightLobbyProps = {
  returnToLobby: () => void;
  micPermissionDenied: boolean;
  micPermissionHint: string | null;
  micSyncTimedOut: boolean;
  localMicStream: MediaStream | null;
  setRetryInitTick: (updater: (tick: number) => number) => void;
  micRowState: CheckRowState;
  audioRowState: CheckRowState;
  connRowState: CheckRowState;
  runAudioTest: () => void | Promise<void>;
  audioTestPlaying: boolean;
  pingMs: number | null;
  kiteErrorCopy: string;
  kitePendingCopy: string;
  copyRoomCode: () => void | Promise<void>;
  sessionId: string | null;
  roomCopyNote: string | null;
  canEnterStudio: boolean;
  handleEnterStudio: () => void;
  canPracticeAlone: boolean;
  handleEnterSoloStudio: () => void;
};

const BASELINE_LEVEL_BAR_HEIGHTS = [0.12, 0.12, 0.12, 0.12, 0.12] as const;

function meterBinsFromFrequencyData(buf: Uint8Array): number[] {
  const step = Math.max(1, Math.floor(buf.length / 5));
  return [0, 1, 2, 3, 4].map((i) => {
    let sum = 0;
    for (let j = 0; j < step; j++) sum += buf[i * step + j] ?? 0;
    return Math.min(1, (sum / step / 255) * 1.85);
  });
}

function ExternalLevelBars({ heights }: { heights: readonly number[] }) {
  return (
    <div
      className="flex h-11 items-end justify-center gap-1.5 rounded-xl border border-stone-800/80 bg-black/25 px-4 py-2"
      aria-hidden
    >
      {heights.map((h, i) => (
        <div
          key={i}
          className="w-1.5 origin-bottom rounded-full bg-gradient-to-t from-orange-600/90 to-emerald-400/90"
          style={{
            height: `${Math.max(10, 6 + h * 34)}px`,
            opacity: 0.4 + h * 0.6,
            transition: "height 80ms ease-out, opacity 80ms ease-out",
          }}
        />
      ))}
    </div>
  );
}

function MicLevelBars({
  stream,
  onLevel,
}: {
  stream: MediaStream | null;
  onLevel?: (level: number) => void;
}) {
  const [heights, setHeights] = useState<number[]>(() => [...BASELINE_LEVEL_BAR_HEIGHTS]);

  useEffect(() => {
    if (!stream) return;
    let ctx: AudioContext | undefined;
    let raf = 0;
    let stopped = false;
    let lastT = 0;

    const run = async () => {
      try {
        ctx = new AudioContext();
        await ctx.resume().catch(() => {});
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 128;
        an.smoothingTimeConstant = 0.62;
        src.connect(an);
        const buf = new Uint8Array(an.frequencyBinCount);
        const tick = (now: number) => {
          if (stopped) return;
          an.getByteFrequencyData(buf);
          if (now - lastT > 72) {
            lastT = now;
            const next = meterBinsFromFrequencyData(buf);
            setHeights(next);
            const avg = next.reduce((a, b) => a + b, 0) / next.length;
            onLevel?.(avg);
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        /* visualizer best-effort */
      }
    };
    void run();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [stream, onLevel]);

  return <ExternalLevelBars heights={heights} />;
}

function StudioPreflightLobbyInner({
  returnToLobby,
  micPermissionDenied,
  micPermissionHint,
  micSyncTimedOut,
  localMicStream,
  setRetryInitTick,
  micRowState,
  audioRowState,
  connRowState,
  runAudioTest,
  audioTestPlaying,
  pingMs,
  kiteErrorCopy,
  kitePendingCopy,
  copyRoomCode,
  sessionId,
  roomCopyNote,
  canEnterStudio,
  handleEnterStudio,
  canPracticeAlone,
  handleEnterSoloStudio,
}: StudioPreflightLobbyProps) {
  return (
    <div
      className="relative flex min-h-screen w-full flex-col overflow-hidden bg-stone-950 font-sans antialiased caret-transparent outline-none select-none"
      style={{ fontFamily: "'Sora', 'DM Sans', system-ui, sans-serif" }}
    >
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-24 left-0 h-[34rem] w-[34rem] rounded-full bg-orange-500/[0.1] blur-3xl" />
        <div className="absolute top-1/3 right-0 h-[30rem] w-[30rem] rounded-full bg-emerald-500/[0.09] blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-[26rem] w-[26rem] rounded-full bg-orange-500/[0.06] blur-3xl" />
        <div className="absolute top-1/2 left-1/2 h-[22rem] w-[22rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/[0.05] blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
      </div>

      <header className="relative shrink-0 px-4 py-5 md:px-8 md:py-6">
        <div className="flex w-full items-center gap-4 md:gap-8">
          <motion.button
            type="button"
            onClick={returnToLobby}
            className="shrink-0 rounded-xl border border-white/[0.14] bg-stone-900/70 px-4 py-2.5 text-sm font-semibold text-stone-300 shadow-sm transition-all hover:border-orange-500/35 hover:bg-orange-500/8 hover:text-white focus:outline-none focus:ring-2 focus:ring-orange-500/30"
            whileTap={{ scale: 0.97 }}
            aria-label="Return to lobby"
          >
            <ChevronLeft className="mr-1 inline h-4 w-4 align-[-3px] opacity-70" strokeWidth={2} aria-hidden />
            return to lobby
          </motion.button>

          <div className="flex flex-1 items-center justify-center gap-3 md:gap-4">
            <h1 className="bg-gradient-to-r from-orange-400 via-orange-300 to-emerald-400 bg-clip-text text-2xl font-black tracking-tight text-transparent md:text-4xl">
              Kite Studio
            </h1>
            <span className="rounded-lg border border-emerald-500/40 bg-emerald-500/12 px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-emerald-400 md:px-3 md:py-1.5 md:text-xs">
              Preflight
            </span>
          </div>

          <div className="hidden w-[168px] shrink-0 md:block" aria-hidden />
        </div>
      </header>

      <main className="relative flex min-h-0 w-full flex-1 flex-col px-4 py-4 md:px-6 md:py-5">
        {micPermissionDenied ? (
          <div role="alert" className="mb-6 flex items-start gap-3 rounded-xl border border-orange-500/25 bg-orange-500/8 px-4 py-3.5">
            <div>
              <p className="text-sm font-semibold text-orange-300">Microphone Access Denied</p>
              <p className="mt-0.5 text-xs leading-relaxed text-stone-400">
                {micPermissionHint ||
                  "Please allow microphone access in your browser or system settings, then reload this page."}
              </p>
            </div>
          </div>
        ) : null}

        {micSyncTimedOut && !localMicStream ? (
          <div role="alert" className="mb-6 flex items-start justify-between gap-3 rounded-xl border border-white/[0.08] bg-stone-800/60 px-4 py-3.5">
            <div>
              <p className="text-sm font-semibold text-stone-300">Microphone Sync Timeout</p>
              <p className="mt-0.5 text-xs text-stone-500">Could not detect your mic within the expected time.</p>
            </div>
            <motion.button
              type="button"
              onClick={() => setRetryInitTick((n) => n + 1)}
              whileTap={{ scale: 0.97 }}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-orange-500/30 px-3 py-1.5 text-xs font-semibold text-orange-400 transition-all hover:bg-orange-500/10 focus:outline-none focus:ring-2 focus:ring-orange-500/30"
            >
              Retry
            </motion.button>
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[45fr_55fr] lg:items-stretch">
          <section
            aria-labelledby="preflight-heading"
            className="flex h-full min-h-[360px] flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-stone-900/50 backdrop-blur-sm lg:min-h-0"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-white/[0.05] px-5 py-4">
              <div>
                <h2 id="preflight-heading" className="text-sm font-bold tracking-tight text-white">
                  System Readiness
                </h2>
                <p className="mt-px text-[11px] text-stone-500">All checks must pass before entering</p>
              </div>
              <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                micRowState === "done" && audioRowState === "done" && connRowState === "done"
                  ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
                  : micRowState === "error" || audioRowState === "error" || connRowState === "error"
                    ? "border-orange-500/25 bg-orange-500/10 text-orange-400"
                    : "border-white/[0.06] bg-stone-800/60 text-stone-400"
              }`}>
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    micRowState === "done" && audioRowState === "done" && connRowState === "done"
                      ? "animate-pulse bg-emerald-400"
                      : "bg-stone-600"
                  }`}
                  aria-hidden="true"
                />
                {micRowState === "done" && audioRowState === "done" && connRowState === "done"
                  ? "All Ready"
                  : micRowState === "error" || audioRowState === "error" || connRowState === "error"
                    ? "Action Required"
                    : "Checking..."}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
              <div className={`flex min-h-0 flex-1 flex-col rounded-xl border p-4 ${
                micRowState === "done"
                  ? "border-emerald-500/25 bg-emerald-500/[0.06]"
                  : micRowState === "error"
                    ? "border-orange-500/25 bg-orange-500/[0.06]"
                    : "border-white/[0.08] bg-white/[0.02]"
              }`}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className={`flex items-center gap-2 ${
                    micRowState === "done" ? "text-emerald-400" : micRowState === "error" ? "text-orange-400" : "text-stone-500"
                  }`}>
                    <Mic className="h-4 w-4" aria-hidden />
                    <span className="text-sm font-semibold text-white/90">Microphone</span>
                  </div>
                  <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${
                    micRowState === "done"
                      ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                      : micRowState === "error"
                        ? "border-orange-500/30 bg-orange-500/15 text-orange-400"
                        : "border-stone-600/40 bg-stone-700/60 text-stone-400"
                  }`}>
                    {micRowState === "done" ? "Ready" : micRowState === "error" ? "Error" : "Checking"}
                  </span>
                </div>
                <div className="flex min-h-0 w-full flex-1 items-center justify-center rounded-xl border border-emerald-500/10 bg-black/20 p-2">
                  <div className="mx-auto w-1/2 max-w-[200px] min-w-[140px]">
                    <MicLevelBars stream={localMicStream} />
                  </div>
                </div>
              </div>

              <div className={`flex min-h-0 flex-1 flex-col rounded-xl border p-4 ${
                audioRowState === "done"
                  ? "border-emerald-500/25 bg-emerald-500/[0.06]"
                  : audioRowState === "error"
                    ? "border-orange-500/25 bg-orange-500/[0.06]"
                    : "border-white/[0.08] bg-white/[0.02]"
              }`}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className={`flex items-center gap-2 ${
                    audioRowState === "done" ? "text-emerald-400" : audioRowState === "error" ? "text-orange-400" : "text-stone-500"
                  }`}>
                    <Volume2 className="h-4 w-4" aria-hidden />
                    <span className="text-sm font-semibold text-white/90">Speaker</span>
                  </div>
                  <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${
                    audioRowState === "done"
                      ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                      : audioRowState === "error"
                        ? "border-orange-500/30 bg-orange-500/15 text-orange-400"
                        : "border-stone-600/40 bg-stone-700/60 text-stone-400"
                  }`}>
                    {audioRowState === "done" ? "Ready" : audioRowState === "error" ? "Error" : "Checking"}
                  </span>
                </div>
                <div className="flex min-h-0 flex-1 items-stretch">
                  {audioRowState === "done" ? (
                    <div className="flex h-full min-h-[3rem] w-full flex-1 items-center justify-center rounded-xl border border-emerald-500/20 bg-black/20 px-4 py-2 text-sm font-semibold text-emerald-300 shadow-inner shadow-emerald-950/20">
                      Audio output confirmed
                    </div>
                  ) : (
                    <motion.button
                      type="button"
                      onClick={() => void runAudioTest()}
                      disabled={audioTestPlaying}
                      whileTap={audioTestPlaying ? undefined : { scale: 0.97 }}
                      className={`flex h-full min-h-[3rem] w-full flex-1 items-center justify-center gap-1.5 rounded-xl border bg-black/20 px-4 py-2 text-sm font-semibold shadow-inner shadow-orange-950/20 transition-all focus:outline-none focus:ring-2 focus:ring-orange-500/30 ${
                        audioTestPlaying
                          ? "cursor-not-allowed border-white/[0.08] text-stone-500"
                          : "border-orange-500/25 text-orange-400 hover:border-orange-500/40 hover:bg-orange-500/8"
                      }`}
                    >
                      {audioTestPlaying ? "Playing..." : "tap to test audio"}
                    </motion.button>
                  )}
                </div>
              </div>

              <div className={`flex min-h-0 flex-1 flex-col rounded-xl border p-4 ${
                connRowState === "done"
                  ? "border-emerald-500/25 bg-emerald-500/[0.06]"
                  : connRowState === "error"
                    ? "border-orange-500/25 bg-orange-500/[0.06]"
                    : "border-white/[0.08] bg-white/[0.02]"
              }`}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className={`flex items-center gap-2 ${
                    connRowState === "done" ? "text-emerald-400" : connRowState === "error" ? "text-orange-400" : "text-stone-500"
                  }`}>
                    <span className="text-sm font-semibold text-white/90">Kite Signal</span>
                  </div>
                  <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${
                    connRowState === "done"
                      ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                      : connRowState === "error"
                        ? "border-orange-500/30 bg-orange-500/15 text-orange-400"
                        : "border-stone-600/40 bg-stone-700/60 text-stone-400"
                  }`}>
                    {connRowState === "done" ? "Ready" : connRowState === "error" ? "Error" : "Checking"}
                  </span>
                </div>
                <div className="flex h-full min-h-[3rem] w-full flex-1 items-center justify-center rounded-lg border border-dashed border-white/[0.08] bg-white/[0.01] px-3">
                  <span className={`text-xs ${
                    connRowState === "done" ? "text-emerald-400/80" : connRowState === "error" ? "text-orange-400/80" : "text-stone-600"
                  }`}>
                    {connRowState === "done"
                      ? pingMs === null
                        ? "Relay connected"
                        : `Relay connected · ${pingMs} ms`
                      : connRowState === "error"
                        ? kiteErrorCopy
                        : kitePendingCopy}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className="grid h-full min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-2xl border border-white/[0.07] bg-stone-900/50 backdrop-blur-sm max-lg:min-h-[360px] md:grid-cols-2">
            <div className="flex min-h-0 flex-col gap-5 border-b border-white/[0.05] p-6 md:border-b-0 md:border-r">
              <div>
                <h2 className="text-sm font-bold tracking-tight text-white">Session</h2>
                <p className="mt-1 text-[11px] leading-relaxed text-stone-500">
                  Share the room code with your collaborator.
                </p>
              </div>

              <motion.button
                type="button"
                onClick={() => void copyRoomCode()}
                className="w-full rounded-xl border border-white/[0.08] bg-stone-950/50 px-4 py-5 text-center transition-all hover:border-emerald-500/30 hover:bg-stone-950/70 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                whileTap={{ scale: 0.98 }}
              >
                <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">Room code</p>
                <p className="mt-1 font-mono text-xl font-bold tracking-wider text-white">{sessionId?.toUpperCase() ?? "------"}</p>
                {roomCopyNote ? (
                  <p className="mt-1 text-xs font-semibold text-emerald-300/90" role="status">
                    {roomCopyNote}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-stone-500">tap to copy</p>
                )}
              </motion.button>

              <div className="px-1 py-2">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-stone-600">Before you enter</p>
                <ul className="space-y-2 text-sm leading-relaxed text-stone-400">
                  <li className="flex items-center gap-2">
                    <span className="h-2 w-2 rotate-45 rounded-[1px] bg-emerald-400 shadow-[0_0_12px_rgba(34,197,94,0.65)]" aria-hidden />
                    <span>use wired headphones</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="h-2 w-2 rotate-45 rounded-[1px] bg-emerald-400 shadow-[0_0_12px_rgba(34,197,94,0.65)]" aria-hidden />
                    <span>calibrate before looping</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="h-2 w-2 rotate-45 rounded-[1px] bg-emerald-400 shadow-[0_0_12px_rgba(34,197,94,0.65)]" aria-hidden />
                    <span>Ethernet for best performance</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="flex min-h-0 flex-col gap-4 p-6">
              <div>
                <h2 className="text-sm font-bold tracking-tight text-white">Session Actions</h2>
                <p className="mt-1 text-[11px] leading-relaxed text-stone-500">
                  {canEnterStudio
                    ? "All checks passed. You're ready to enter."
                    : "Complete preflight checks to enable session entry."}
                </p>
              </div>

              <motion.button
                type="button"
                onClick={handleEnterStudio}
                disabled={!canEnterStudio}
                aria-label="Jam with a friend"
                whileTap={canEnterStudio ? { scale: 0.97 } : undefined}
                className={`flex flex-1 items-center justify-center gap-3 rounded-2xl px-6 py-8 text-base font-bold tracking-tight transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-orange-500/40 ${
                  canEnterStudio
                    ? "bg-gradient-to-r from-orange-500 to-emerald-500 text-white shadow-lg shadow-orange-500/25 hover:scale-[1.01] hover:shadow-orange-500/40 active:scale-[0.99]"
                    : "cursor-not-allowed border border-white/[0.05] bg-stone-800/60 text-stone-600"
                }`}
              >
                {canEnterStudio ? "Jam with a friend" : "Waiting for Preflight..."}
              </motion.button>

              <motion.button
                type="button"
                onClick={handleEnterSoloStudio}
                disabled={!canPracticeAlone}
                aria-label="Kite loopstation"
                whileTap={canPracticeAlone ? { scale: 0.97 } : undefined}
                className={`flex flex-[1.35] items-center justify-center gap-2.5 rounded-2xl border px-6 py-10 text-lg font-semibold tracking-tight transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 ${
                  canPracticeAlone
                    ? "border-emerald-500/30 text-emerald-400 hover:border-emerald-500/50 hover:bg-emerald-500/8 active:scale-[0.99]"
                    : "cursor-not-allowed border-white/[0.06] text-stone-600"
                }`}
              >
                Kite loopstation
              </motion.button>
            </div>
          </section>
        </div>
      </main>

      <footer className="relative flex shrink-0 items-center justify-between border-t border-white/[0.04] px-4 py-3 md:px-6">
        <span className="text-[10px] text-stone-700">Kite Studio © 2025</span>
        <span className="text-[10px] text-stone-700">Preflight v2 · Stable</span>
      </footer>
    </div>
  );
}

export const StudioPreflightLobby = memo(StudioPreflightLobbyInner);
