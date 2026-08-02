"use client";

/**
 * Sync-active footer helper: count-in / peer-audio arrive / loop progress.
 * Cold phase via React props; hot progress via ref + RAF/DOM (no per-tick setState).
 * Display only — never used for transport timing.
 * Teaches one-loop-behind model (NINJAM-style interval jam).
 */

import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import type {
  P2PJamSyncReadinessHotSnapshot,
  P2PJamSyncReadinessPhase,
} from "@/components/studio-bridge/P2PJamPresenter.types";

export type KiteSyncTaskbarHelperProps = {
  phase: P2PJamSyncReadinessPhase;
  isLocalLeader: boolean;
  kiteSyncCountInActive?: boolean;
  hotRef:
    | RefObject<P2PJamSyncReadinessHotSnapshot>
    | MutableRefObject<P2PJamSyncReadinessHotSnapshot>;
  delayMs: number | null;
  remoteParticipantName: string | null;
  /** Full loop length in seconds (from activeJam.loopSec). */
  loopSec: number;
};

function formatSecondsLeft(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return "--";
  const clamped = Math.max(0, sec);
  if (clamped >= 10) return `${Math.ceil(clamped)}s`;
  return `${clamped.toFixed(1)}s`;
}

export function KiteSyncTaskbarHelper({
  phase,
  isLocalLeader,
  kiteSyncCountInActive = false,
  hotRef,
  delayMs,
  remoteParticipantName,
  loopSec,
}: KiteSyncTaskbarHelperProps): React.JSX.Element {
  const titleElRef = useRef<HTMLSpanElement | null>(null);
  const detailElRef = useRef<HTMLSpanElement | null>(null);
  const secondsElRef = useRef<HTMLSpanElement | null>(null);
  const progressElRef = useRef<HTMLDivElement | null>(null);
  const lastTitleRef = useRef("");
  const lastDetailRef = useRef("");
  const lastSecondsRef = useRef("");
  const lastPctRef = useRef(-1);

  const effectivePhase: P2PJamSyncReadinessPhase =
    phase === "idle" && kiteSyncCountInActive ? "count-in" : phase;

  useEffect(() => {
    const partner = remoteParticipantName?.trim() || "your bandmate";
    const safeLoopSec = Number.isFinite(loopSec) && loopSec > 0 ? loopSec : 0;
    let rafId = 0;

    const tick = (): void => {
      const hot = hotRef.current;
      if (!hot) {
        rafId = requestAnimationFrame(tick);
        return;
      }

      let title = "Kite Sync";
      let detail = "One loop behind";
      let secondsLabel = "--";
      let progress01 = 0;

      const inCountIn =
        effectivePhase === "count-in" ||
        (kiteSyncCountInActive && effectivePhase !== "incoming" && effectivePhase !== "live");

      if (inCountIn) {
        const remaining = hot.countdownBeatRemaining;
        title = "Count-in";
        detail = isLocalLeader
          ? "Play on the next downbeat"
          : delayMs != null && Number.isFinite(delayMs) && delayMs >= 0
            ? `Locking to ${partner} · ~${Math.round(delayMs)}ms`
            : `Locking to ${partner}`;
        progress01 = hot.countInProgress01 ?? 0;
        if (remaining === 1) {
          secondsLabel = "GO";
        } else if (remaining != null && Number.isFinite(remaining)) {
          secondsLabel = `${remaining}`;
        } else if (hot.countInProgress01 != null && Number.isFinite(hot.countInProgress01)) {
          secondsLabel = formatSecondsLeft((1 - hot.countInProgress01) * 2);
        } else {
          secondsLabel = "…";
        }
      } else if (effectivePhase === "incoming") {
        title = "Incoming";
        const rem = hot.audioArriveRemainingSec;
        progress01 = hot.audioArriveProgress01 ?? 0;
        if (rem != null && Number.isFinite(rem) && rem > 0) {
          detail = `First peer loop audible soon · ${partner}`;
          secondsLabel = formatSecondsLeft(rem);
        } else if (progress01 < 0.99) {
          detail = `Priming buffer · ${partner}`;
          secondsLabel = "…";
        } else {
          detail = `First peer loop starting · ${partner}`;
          secondsLabel = "NOW";
        }
      } else if (effectivePhase === "live") {
        progress01 = hot.loopProgress01 ?? 0;
        const remainingSec =
          safeLoopSec > 0 && hot.loopProgress01 != null && Number.isFinite(hot.loopProgress01)
            ? Math.max(0, safeLoopSec * (1 - hot.loopProgress01))
            : null;
        secondsLabel = formatSecondsLeft(remainingSec);
        const bar =
          hot.loopBarIndex != null ? `Bar ${hot.loopBarIndex}` : null;
        if (isLocalLeader) {
          title = "Recording";
          detail = bar
            ? `${bar} · peer hears previous loop · next lands in`
            : "Peer hears previous loop · next lands in";
        } else {
          title = "Listening";
          detail = bar
            ? `${bar} · hearing previous loop · next refresh in`
            : "Hearing previous loop · next refresh in";
        }
      } else {
        title = "Kite Sync";
        detail = "One loop behind";
        progress01 = hot.loopProgress01 ?? 0;
        secondsLabel = "--";
      }

      const progressPct = Math.round(Math.max(0, Math.min(1, progress01)) * 100);

      if (titleElRef.current && lastTitleRef.current !== title) {
        titleElRef.current.textContent = title;
        lastTitleRef.current = title;
      }
      if (detailElRef.current && lastDetailRef.current !== detail) {
        detailElRef.current.textContent = detail;
        lastDetailRef.current = detail;
      }
      if (secondsElRef.current && lastSecondsRef.current !== secondsLabel) {
        secondsElRef.current.textContent = secondsLabel;
        lastSecondsRef.current = secondsLabel;
      }
      if (progressElRef.current && lastPctRef.current !== progressPct) {
        progressElRef.current.style.width = `${progressPct}%`;
        lastPctRef.current = progressPct;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [
    effectivePhase,
    hotRef,
    isLocalLeader,
    delayMs,
    remoteParticipantName,
    loopSec,
    kiteSyncCountInActive,
  ]);

  return (
    <div
      className="flex min-w-0 flex-1 flex-col justify-center gap-1 pr-2"
      role="status"
      aria-live="polite"
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <span
          ref={titleElRef}
          className="shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[#22c55e]"
        >
          …
        </span>
        <span
          ref={detailElRef}
          className="min-w-0 truncate text-[11px] font-medium text-white/65"
        >
          …
        </span>
        <span
          ref={secondsElRef}
          className="ml-auto shrink-0 font-mono text-[12px] font-semibold tabular-nums text-white/90"
        >
          --
        </span>
      </div>
      <div
        className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-white/[0.08]"
        aria-hidden
      >
        <div
          ref={progressElRef}
          className="h-full rounded-full bg-[#22c55e]"
          style={{
            width: "0%",
            boxShadow: "0 0 8px rgba(34,197,94,0.45)",
            willChange: "width",
          }}
        />
      </div>
      <p className="m-0 font-mono text-[8px] uppercase tracking-[0.14em] text-white/30">
        One loop behind — by design
      </p>
    </div>
  );
}
