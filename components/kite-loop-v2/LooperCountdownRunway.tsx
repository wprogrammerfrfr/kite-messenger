"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import type { RunwayDisplayLabel } from "@/lib/looper-runway-scheduler";

export type LooperRunwayPhase = "idle" | "counting" | "armed";

export type LooperCountdownRunwayProps = {
  /** Runway label: 3 → 2 → 1 → GO (4-beat count-in before record). */
  display: RunwayDisplayLabel | null;
  phase: LooperRunwayPhase;
  /** Border accent during 3-2-1 when visual-only mode is on (clicks still play during count-in). */
  visualOnly: boolean;
  children?: ReactNode;
};

/** Sharp count-in: no spring overshoot, GPU-friendly opacity + scale only. */
const RUNWAY_EASE_OUT = [0.33, 1, 0.68, 1] as const;
const RUNWAY_MS = 0.175;

/**
 * Full-bleed beat flash synced to runway scheduler emissions (Phase 4).
 */
export function LooperCountdownRunway({
  display,
  phase,
  visualOnly,
}: LooperCountdownRunwayProps) {
  /** Visible whenever the scheduler has a label (3/2/1/GO), including GO after armed clears. */
  const show = display != null;
  const isGo = display === "GO";

  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          key={display}
          className={`pointer-events-none fixed inset-0 z-[100] flex items-center justify-center ${
            isGo
              ? "border-[12px] border-emerald-400/50"
              : visualOnly
                ? "border-[12px] border-violet-500/35"
                : "border-[12px] border-orange-500/25"
          }`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            duration: RUNWAY_MS,
            ease: RUNWAY_EASE_OUT,
          }}
        >
          <motion.div
            className={`flex h-28 w-28 shrink-0 transform-gpu items-center justify-center rounded-2xl font-black tabular-nums ${
              isGo
                ? "bg-emerald-500/35 text-emerald-50 ring-2 ring-emerald-400/70"
                : visualOnly
                  ? "bg-violet-600/25 text-5xl leading-none text-violet-100 ring-2 ring-violet-400/40"
                  : "bg-orange-500/20 text-5xl leading-none text-orange-100 ring-2 ring-orange-400/40"
            }`}
            style={{ willChange: "transform, opacity" }}
            initial={{ scale: 0.3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.92, opacity: 0 }}
            transition={{
              duration: RUNWAY_MS,
              ease: RUNWAY_EASE_OUT,
            }}
          >
            <span className="block text-center text-5xl leading-none tracking-tight">
              {isGo ? "GO!" : display}
            </span>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
