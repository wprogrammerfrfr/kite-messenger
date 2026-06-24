"use client";

import { motion } from "framer-motion";
import type { MutableRefObject, ReactNode } from "react";
import type { KiteIntervalTiming } from "@/lib/kite-interval-math";
import type { RunwayDisplayLabel } from "@/lib/looper-runway-scheduler";
import { FourTrackLooperLanes, type SoloTrackLaneView } from "@/components/kite-loop-v2/FourTrackLooperLanes";
import { LooperCountdownConfig } from "@/components/kite-loop-v2/LooperCountdownConfig";
import { LooperCountdownRunway, type LooperRunwayPhase } from "@/components/kite-loop-v2/LooperCountdownRunway";

export type SoloLooperUiState = "idle" | "recording" | "captured" | "playing";
export type SoloLooperMode = "free" | "grid";

export type KiteLoopV2PanelProps = {
  soloLooperState: SoloLooperUiState;
  isRecordingArmed: boolean;
  isMasterPaused: boolean;
  sessionRecorderState: "idle" | "recording" | "paused" | "saving";
  recordingArmedCountdown: number | null;
  runwayDisplay: RunwayDisplayLabel | null;
  runwayPhase: LooperRunwayPhase;
  runwayVisualOnly: boolean;
  loopProgress: number;
  kiteIntervalTimingRef: MutableRefObject<KiteIntervalTiming | null>;
  kiteSetupTempo: number;
  kiteSetupTimeSignatureTop: number;
  kiteSetupTimeSignatureBottom: number;
  kiteSetupIsSwing: boolean;
  isTimingLocked: boolean;
  loopMode: SoloLooperMode;
  barCount: number;
  latencyMs: number;
  visualMetronomeControls: ReactNode;
  metronomeVolume: number;
  onMetronomeVolumeChange: (value: number) => void;
  onLoopModeChange: (value: SoloLooperMode) => void;
  onBarCountChange: (value: number) => void;
  onLatencyMsChange: (value: number) => void;
  onTempoSliderChange: (value: number) => void;
  onTempoPreset: (bpm: number) => void;
  onSelectTimeSignature: (option: {
    title: string;
    top: number;
    bottom: number;
    swing: boolean;
  }) => void;
  onRecordFirstLoop: () => void;
  onToggleMasterPause: () => void;
  onToggleSessionRecording: () => void;
  onStopAndResetSoloLooper: () => void;
  /** Per-lane mixer / arm controls (P5-07). */
  soloTrackLanes: SoloTrackLaneView[];
};

export function KiteLoopV2Panel({
  soloLooperState,
  isRecordingArmed,
  isMasterPaused,
  sessionRecorderState,
  recordingArmedCountdown,
  runwayDisplay,
  runwayPhase,
  runwayVisualOnly,
  loopProgress,
  kiteIntervalTimingRef,
  kiteSetupTempo,
  kiteSetupTimeSignatureTop,
  kiteSetupTimeSignatureBottom,
  kiteSetupIsSwing,
  isTimingLocked,
  loopMode,
  barCount,
  latencyMs,
  visualMetronomeControls,
  metronomeVolume,
  onMetronomeVolumeChange,
  onLoopModeChange,
  onBarCountChange,
  onLatencyMsChange,
  onTempoSliderChange,
  onTempoPreset,
  onSelectTimeSignature,
  onRecordFirstLoop,
  onToggleMasterPause,
  onToggleSessionRecording,
  onStopAndResetSoloLooper,
  soloTrackLanes,
}: KiteLoopV2PanelProps) {
  const timing = kiteIntervalTimingRef.current;

  return (
    <div className="select-none space-y-4">
      <LooperCountdownRunway
        display={runwayDisplay}
        phase={runwayPhase}
        visualOnly={runwayVisualOnly}
      />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="select-none rounded-2xl border border-stone-800/90 bg-stone-950/55 p-6 shadow-2xl"
      >
        <p className="select-none text-[10px] font-semibold uppercase tracking-widest text-emerald-300">
          Solo Practice Suite
        </p>
        <h2 className="select-none mt-2 text-2xl font-bold tracking-tight text-stone-50">
          Build your first Kite loop
        </h2>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="select-none mt-5 flex flex-wrap items-center gap-3"
        >
          <span
            className={`select-none rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-widest ${
              soloLooperState === "recording"
                ? "animate-pulse border-red-500/45 bg-red-500/15 text-red-200"
                : soloLooperState === "captured"
                  ? "border-emerald-500/45 bg-emerald-500/15 text-emerald-200"
                  : "border-stone-700 bg-stone-900/70 text-stone-400"
            }`}
          >
            {soloLooperState === "recording"
              ? "Recording..."
              : isRecordingArmed
                ? runwayDisplay === "GO"
                  ? "GO!"
                  : recordingArmedCountdown !== null
                    ? "Count-in..."
                    : "Armed"
                : soloLooperState === "captured"
                  ? "Loop Captured"
                  : "Idle"}
          </span>
          {timing ? (
            <span className="select-none text-xs font-semibold text-stone-400">
              {timing.chords} chords · {timing.bpm} BPM · {timing.timeSignatureTop}/
              {timing.timeSignatureBottom}
            </span>
          ) : null}
        </motion.div>
        <div className="mt-6 h-3 overflow-hidden rounded-full border border-stone-800 bg-stone-900">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-orange-500 to-emerald-400"
            style={{ width: `${loopProgress}%` }}
          />
        </div>
        <p className="select-none mt-2 text-xs font-medium text-stone-500">
          Loop progress: {Math.round(loopProgress)}%
        </p>
        <div className="mt-5 rounded-xl border border-stone-800 bg-stone-950/70 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">
            Loop Mode
          </p>
          <p className="mt-1 text-xs text-stone-400">
            Free preserves your played length; Grid will quantize once grid math is enabled.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(["free", "grid"] as const).map((mode) => {
              const active = loopMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onLoopModeChange(mode)}
                  className={`rounded-lg border px-3 py-2 text-xs font-bold uppercase tracking-widest transition ${
                    active
                      ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-100"
                      : "border-stone-700 bg-stone-900/70 text-stone-400 hover:bg-stone-800"
                  }`}
                >
                  {mode}
                </button>
              );
            })}
          </div>
          {loopMode === "grid" ? (
            <div className="mt-4 border-t border-stone-800 pt-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">
                Bar Count
              </p>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {[1, 2, 4, 8].map((count) => {
                  const active = barCount === count;
                  return (
                    <button
                      key={count}
                      type="button"
                      onClick={() => onBarCountChange(count)}
                      className={`rounded-lg border px-3 py-2 text-xs font-bold uppercase tracking-widest transition ${
                        active
                          ? "border-orange-400/60 bg-orange-500/15 text-orange-100"
                          : "border-stone-700 bg-stone-900/70 text-stone-400 hover:bg-stone-800"
                      }`}
                    >
                      {count}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
        <div className="mt-5 rounded-xl border border-stone-800 bg-stone-950/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">
                Clap Test Latency
              </p>
              <p className="mt-1 text-xs text-stone-400">
                Temporary RTL offset for loop extraction.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold text-stone-300">
              <input
                type="number"
                min={0}
                max={120}
                step={1}
                value={latencyMs}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  onLatencyMsChange(Number.isFinite(next) ? Math.max(0, Math.min(120, next)) : 0);
                }}
                className="w-20 rounded-lg border border-stone-700 bg-stone-950 px-2 py-1 text-right font-mono text-stone-100 outline-none focus:border-emerald-400"
              />
              ms
            </label>
          </div>
          <input
            type="range"
            min={0}
            max={120}
            step={1}
            value={latencyMs}
            onChange={(event) => {
              const next = Number(event.target.value);
              onLatencyMsChange(Number.isFinite(next) ? Math.max(0, Math.min(120, next)) : 0);
            }}
            className="mt-4 w-full accent-emerald-400"
          />
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={soloLooperState === "idle" && !isRecordingArmed}
            onClick={onToggleMasterPause}
            className={`select-none rounded-xl border px-4 py-3 text-sm font-bold uppercase tracking-wide transition ${
              isMasterPaused
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/22"
                : soloLooperState === "idle" && !isRecordingArmed
                  ? "cursor-not-allowed border-stone-800 bg-stone-950/40 text-stone-600"
                  : "border-yellow-500/35 bg-yellow-500/12 text-yellow-100 hover:bg-yellow-500/18"
            }`}
          >
            {isMasterPaused ? "Resume Master" : "Pause Master"}
          </button>
          <button
            type="button"
            disabled={sessionRecorderState === "saving"}
            onClick={onToggleSessionRecording}
            className={`select-none rounded-xl border px-4 py-3 text-sm font-bold uppercase tracking-wide transition ${
              sessionRecorderState === "recording"
                ? "border-red-500/45 bg-red-500/15 text-red-100 hover:bg-red-500/22"
                : sessionRecorderState === "paused"
                  ? "border-yellow-500/45 bg-yellow-500/15 text-yellow-100 hover:bg-yellow-500/22"
                  : sessionRecorderState === "saving"
                    ? "cursor-wait border-stone-700 bg-stone-900/70 text-stone-400"
                    : "border-emerald-500/35 bg-emerald-500/12 text-emerald-100 hover:bg-emerald-500/18"
            }`}
          >
            {sessionRecorderState === "recording"
              ? "Stop Session Tape"
              : sessionRecorderState === "paused"
                ? "Stop Paused Tape"
                : sessionRecorderState === "saving"
                  ? "Saving Tape..."
                  : "Record Session Tape"}
          </button>
        </div>
        <p className="mt-2 text-center text-[10px] font-semibold uppercase tracking-widest text-stone-500">
          Tape: {sessionRecorderState}
          {isMasterPaused ? " · Master paused" : ""}
        </p>
        <motion.div className="select-none mt-6">
          <LooperCountdownConfig
            tempo={kiteSetupTempo}
            onTempoSliderChange={onTempoSliderChange}
            onTempoPreset={onTempoPreset}
            timeSignatureTop={kiteSetupTimeSignatureTop}
            timeSignatureBottom={kiteSetupTimeSignatureBottom}
            isSwing={kiteSetupIsSwing}
            timingLocked={isTimingLocked}
            visualMetronomeControls={visualMetronomeControls}
            metronomeVolume={metronomeVolume}
            onMetronomeVolumeChange={onMetronomeVolumeChange}
            onSelectTimeSignature={onSelectTimeSignature}
          />
        </motion.div>
        <motion.button
          type="button"
          disabled={isRecordingArmed || soloLooperState === "recording"}
          onClick={onRecordFirstLoop}
          whileTap={isRecordingArmed || soloLooperState === "recording" ? undefined : { scale: 0.98 }}
          className={`select-none mt-8 w-full rounded-2xl border px-5 py-5 text-lg font-bold shadow-lg transition ${
            isRecordingArmed
              ? runwayDisplay === "GO"
                ? "cursor-wait border-emerald-500/45 bg-emerald-500/15 text-emerald-100"
                : "cursor-wait border-orange-500/45 bg-orange-500/15 text-orange-100"
              : soloLooperState === "recording"
                ? "cursor-not-allowed border-red-500/45 bg-red-500/15 text-red-100"
                : "border-red-500/45 bg-red-500/15 text-red-100 hover:bg-red-500/22"
          }`}
        >
          {isRecordingArmed
            ? runwayDisplay === "GO"
              ? "GO!"
              : recordingArmedCountdown !== null
                ? `${recordingArmedCountdown}…`
                : "Count-in..."
            : soloLooperState === "recording"
              ? "Recording..."
              : "🔴 Record First Loop"}
        </motion.button>
        {soloLooperState === "recording" || soloLooperState === "captured" ? (
          <button
            type="button"
            onClick={onStopAndResetSoloLooper}
            className="select-none mt-3 w-full rounded-xl border border-stone-700 bg-stone-900/70 px-4 py-3 text-sm font-semibold text-stone-200 transition hover:bg-stone-800"
          >
            Stop & Reset
          </button>
        ) : null}
        <FourTrackLooperLanes className="select-none mt-8 border-t border-stone-800/80 pt-6" lanes={soloTrackLanes} />
      </motion.div>
    </div>
  );
}
