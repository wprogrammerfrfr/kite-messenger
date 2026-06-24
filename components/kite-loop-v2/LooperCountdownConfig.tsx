"use client";

import type { ReactNode } from "react";

export type LooperCountdownConfigProps = {
  tempo: number;
  onTempoSliderChange: (value: number) => void;
  onTempoPreset: (bpm: number) => void;
  timeSignatureTop: number;
  timeSignatureBottom: number;
  isSwing: boolean;
  onSelectTimeSignature: (option: {
    title: string;
    top: number;
    bottom: number;
    swing: boolean;
  }) => void;
  timingLocked: boolean;
  visualMetronomeControls: ReactNode;
  metronomeVolume: number;
  onMetronomeVolumeChange: (value: number) => void;
};

export function LooperCountdownConfig({
  tempo,
  onTempoSliderChange,
  onTempoPreset,
  timeSignatureTop,
  timeSignatureBottom,
  isSwing,
  timingLocked,
  onSelectTimeSignature,
  visualMetronomeControls,
  metronomeVolume,
  onMetronomeVolumeChange,
}: LooperCountdownConfigProps) {
  return (
    <div className="space-y-4 rounded-xl border border-stone-800 bg-stone-900/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">
          Solo Timing
        </p>
        <span className="text-sm font-bold text-stone-100">{tempo} BPM</span>
      </div>
      <input
        type="range"
        min={40}
        max={240}
        step={1}
        value={tempo}
        onChange={(event) => {
          onTempoSliderChange(Number(event.target.value));
        }}
        disabled={timingLocked}
        className={`h-2 w-full accent-stone-300 ${
          timingLocked ? "cursor-not-allowed opacity-50" : ""
        }`}
        aria-label="Solo loop tempo"
      />
      <div className="grid gap-2 sm:grid-cols-3">
        {[
          { label: "Slow", bpm: 75 },
          { label: "Medium", bpm: 120 },
          { label: "Upbeat", bpm: 155 },
        ].map((option) => (
          <button
            key={option.label}
            type="button"
            disabled={timingLocked}
            onClick={() => {
              onTempoPreset(option.bpm);
            }}
            className={`rounded-full border border-stone-600 bg-stone-800/60 px-3 py-1.5 text-xs font-semibold text-stone-300 transition ${
              timingLocked ? "cursor-not-allowed opacity-50" : "hover:bg-stone-700"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">
          Metronome Mode
        </p>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9px] uppercase tracking-wider text-stone-400">
              Metronome Volume
            </span>
            <button
              type="button"
              onClick={() => onMetronomeVolumeChange(1)}
              className="cursor-pointer border-none bg-transparent px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-orange-500"
            >
              Reset
            </button>
          </div>
          <input
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={metronomeVolume}
            onChange={(e) => onMetronomeVolumeChange(Number(e.target.value))}
            className="h-2 w-full accent-emerald-400"
            style={{
              background: `linear-gradient(to right, #22c55e ${(metronomeVolume / 2) * 100}%, #374151 ${(metronomeVolume / 2) * 100}%)`,
              borderRadius: 9999,
              appearance: "none",
              WebkitAppearance: "none",
            }}
            aria-label="Metronome volume"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">{visualMetronomeControls}</div>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">
          Time Signature
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            { title: "Straight 4/4", top: 4, bottom: 4, swing: false },
            { title: "Waltz 3/4", top: 3, bottom: 4, swing: false },
            { title: "Shuffle 6/8", top: 6, bottom: 8, swing: true },
          ].map((option) => {
            const selected =
              timeSignatureTop === option.top &&
              timeSignatureBottom === option.bottom &&
              isSwing === option.swing;
            return (
              <button
                key={option.title}
                type="button"
                disabled={timingLocked}
                onClick={() => {
                  onSelectTimeSignature(option);
                }}
                className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                  timingLocked
                    ? "cursor-not-allowed opacity-50"
                    : selected
                      ? "border-blue-500/45 bg-blue-500/15 text-blue-100"
                      : "border-stone-700 bg-stone-900/60 text-stone-300 hover:bg-stone-800"
                }`}
              >
                {option.title}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
