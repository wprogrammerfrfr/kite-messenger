"use client";

export type LooperTrackLaneProps = {
  trackIndex: number;
  /** Linear fader 0–1 (dry/off → unity). */
  volume: number;
  onVolumeChange: (linear: number) => void;
  /** 0–100 sweep based on this track’s own loop (record or playback cursor). */
  progress: number;
  workletMode: string;
  onArmRecord: () => void;
  armDisabled: boolean;
  armLabel: string;
  onResetTrack: () => void;
  resetDisabled: boolean;
  /** Spacebar / pedal is routed to this lane when true. */
  isFocused: boolean;
  /** Set this lane as the pedal target (does not start transport). */
  onRequestFocus: () => void;
  /** When true, show armed / waiting-for-downbeat state (overdub lanes). */
  isOverdubArmedWaiting?: boolean;
};

export function LooperTrackLane({
  trackIndex,
  volume,
  onVolumeChange,
  progress,
  workletMode,
  onArmRecord,
  armDisabled,
  armLabel,
  onResetTrack,
  resetDisabled,
  isFocused,
  onRequestFocus,
  isOverdubArmedWaiting = false,
}: LooperTrackLaneProps) {
  const pct = Math.min(100, Math.max(0, progress));
  const modeLabel =
    workletMode === "recording"
      ? "REC"
      : workletMode === "playing"
        ? "PLAY"
        : workletMode === "idle" && trackIndex === 1
          ? "MASTER"
          : "—";

  const handleLaneMouseDown = (): void => {
    onRequestFocus();
  };

  return (
    <div
      role="presentation"
      onMouseDown={handleLaneMouseDown}
      className={`rounded-lg border px-3 py-2.5 transition-[box-shadow,border-color,background-color] duration-150 ${
        isFocused
          ? "border-emerald-500/55 bg-stone-900/65 shadow-[0_0_16px_-4px_rgba(52,211,153,0.35)] ring-1 ring-emerald-400/40"
          : "border-stone-800/80 bg-stone-900/50"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-[3.25rem] text-[11px] font-bold uppercase tracking-wider text-stone-400">
          T{trackIndex}
        </span>
        {isFocused ? (
          <span className="rounded border border-emerald-500/50 bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-200/95">
            Spacebar
          </span>
        ) : null}
        {isOverdubArmedWaiting ? (
          <span className="rounded border border-amber-500/55 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-200/95 animate-pulse">
            Waiting…
          </span>
        ) : null}
        <span className="rounded border border-stone-700/90 bg-stone-950/60 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-stone-500">
          {modeLabel}
        </span>
        <button
          type="button"
          disabled={armDisabled}
          onClick={onArmRecord}
          className={`ml-auto rounded-md border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition ${
            armDisabled
              ? "cursor-not-allowed border-stone-800 bg-stone-950/40 text-stone-600"
              : "border-orange-500/40 bg-orange-500/12 text-orange-100 hover:bg-orange-500/18"
          }`}
        >
          {armLabel}
        </button>
        <button
          type="button"
          disabled={resetDisabled}
          onClick={(event) => {
            event.stopPropagation();
            onResetTrack();
          }}
          aria-label={`Reset Track ${trackIndex}`}
          className={`rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition ${
            resetDisabled
              ? "cursor-not-allowed border-stone-800 bg-stone-950/40 text-stone-600"
              : "border-red-500/35 bg-red-500/10 text-red-200 hover:bg-red-500/18"
          }`}
        >
          Trash
        </button>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-950/80">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-600/90 to-orange-400/90 transition-[width] duration-75 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <span className="w-7 shrink-0 text-[9px] font-semibold uppercase text-stone-500">Lvl</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(volume * 100)}
          onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
          className="h-1.5 flex-1 cursor-pointer accent-emerald-500"
          aria-label={`Track ${trackIndex} level`}
        />
      </div>
    </div>
  );
}
