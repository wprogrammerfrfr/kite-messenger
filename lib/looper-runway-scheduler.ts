import { createMetronomePump, type MetronomePumpHandle } from "@/lib/studio-metronome-pump";

export const LOOPER_RUNWAY_BEAT_COUNT = 4;

const DEFAULT_LEAD_SEC = 0.002;

export type RunwayBeatIndex = 1 | 2 | 3 | 4;

/** Full-bleed runway labels: beat 1 → "3", …, beat 4 → "GO". */
export type RunwayDisplayLabel = "3" | "2" | "1" | "GO";

const RUNWAY_DISPLAY_BY_BEAT: RunwayDisplayLabel[] = ["3", "2", "1", "GO"];

export type RunwayBeatPayload = {
  beatIndex: RunwayBeatIndex;
  /** Scheduled AudioContext time for this beat. */
  contextTime: number;
  displayLabel: RunwayDisplayLabel;
  /** True on beat 4 — recording downbeat / "GO". */
  isGoBeat: boolean;
  /** True when this beat should sound the runway click (all 4 prep beats, including GO). */
  playClick: boolean;
};

export type StartLooperRunwayOptions = {
  audioContext: AudioContext;
  bpm: number;
  /** Defaults to 4. */
  beatCount?: number;
  /** Small lead after `audioContext.currentTime` before beat 1. */
  leadInSec?: number;
  pumpIntervalSec?: number;
  /** Return false if the runway was cancelled / unmounted. */
  isAlive: () => boolean;
  onBeat: (payload: RunwayBeatPayload) => void;
  /** Invoked once after the final beat fires; pump is still running — caller/teardown clears it. */
  onRunwayEnd: () => void;
};

/**
 * Drives a fixed-beat runway using `AudioContext.currentTime` sampled from the metronome pump
 * (audio-thread clock), not wall `setInterval`.
 */
export async function startLooperRunway(
  options: StartLooperRunwayOptions
): Promise<MetronomePumpHandle> {
  const {
    audioContext,
    bpm,
    beatCount = LOOPER_RUNWAY_BEAT_COUNT,
    leadInSec = DEFAULT_LEAD_SEC,
    pumpIntervalSec = 0.05,
    isAlive,
    onBeat,
    onRunwayEnd,
  } = options;

  if (!Number.isFinite(bpm) || bpm <= 0) {
    throw new Error("startLooperRunway requires a positive BPM.");
  }
  const safeBeatCount = Math.max(1, Math.min(32, Math.floor(beatCount)));
  const beatSec = 60 / bpm;
  const startAt = audioContext.currentTime + Math.max(0, leadInSec);

  let nextBeat = 1;
  let runwayFinished = false;

  const pump = await createMetronomePump(audioContext, { pumpIntervalSec });

  const onPump = (): void => {
    if (runwayFinished || !isAlive()) {
      return;
    }
    const t = audioContext.currentTime;
    const eps = audioContext.sampleRate > 0 ? 2 / audioContext.sampleRate : 0.001;

    while (nextBeat <= safeBeatCount) {
      const beatTime = startAt + (nextBeat - 1) * beatSec;
      if (t + eps < beatTime) {
        break;
      }
      const k = nextBeat as RunwayBeatIndex;
      const isGoBeat = k === safeBeatCount;
      const displayLabel: RunwayDisplayLabel =
        k === safeBeatCount ? "GO" : (RUNWAY_DISPLAY_BY_BEAT[k - 1] ?? "GO");
      onBeat({
        beatIndex: k,
        contextTime: beatTime,
        displayLabel,
        isGoBeat,
        playClick: true,
      });
      nextBeat += 1;
      if (isGoBeat) {
        runwayFinished = true;
        onRunwayEnd();
        return;
      }
    }
  };

  pump.start(onPump);
  return pump;
}
