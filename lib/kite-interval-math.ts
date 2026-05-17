export type KiteIntervalTimingInput = {
  bpm: number;
  chords: number;
  beatsPerBar?: number;
  timeSignatureTop?: number;
  timeSignatureBottom?: number;
  hostSampleRate?: number;
  localSampleRate?: number;
};

export type KiteIntervalTiming = {
  bpm: number;
  chords: number;
  beatsPerBar: number;
  timeSignatureTop: number;
  timeSignatureBottom: number;
  bpi: number;
  loopDurationSeconds: number;
  intervalMs: number;
  hostSampleRate: number;
  hostIntervalFrames: number;
  localSampleRate: number;
  localIntervalFrames: number;
};

export const KITE_TARGET_SAMPLE_RATE = 48000;

/**
 * Stopwatch-measured one-way hardware capture delay (typ. 50–80 ms).
 * Not `AudioContext.baseLatency` (output HAL).
 */
export const KITE_DEFAULT_INPUT_LATENCY_MS = 65;

/** Log when D/N exceeds this fraction — seam skew may be audible on short loops. */
export const KITE_INPUT_NUDGE_BOUNDARY_WARN_RATIO = 0.01;

/**
 * Convert measured input latency (ms) to record write nudge in samples.
 * Guards: floor, 0 <= D < intervalFrames.
 */
export function calcInputNudgeFrames(
  inputLatencyMs: number,
  sampleRate: number,
  intervalFrames: number
): number {
  const safeMs = sanitizeNumber(inputLatencyMs, KITE_DEFAULT_INPUT_LATENCY_MS);
  const safeSr = sanitizeSampleRate(sampleRate, "sampleRate");
  const safeN = Math.max(1, Math.floor(intervalFrames));
  const requested = Math.max(0, Math.floor((safeMs / 1000) * safeSr));
  if (safeN <= 1) return 0;
  return Math.min(requested, safeN - 1);
}

/** Record write index: place late-arriving input at acoustic grid time (c - D) mod N. */
export function calcRecordWriteFrameIndex(
  frameCursor: number,
  inputNudgeFrames: number,
  intervalFrames: number
): number {
  const N = Math.max(1, Math.floor(intervalFrames));
  const c = Math.floor(frameCursor) % N;
  const D = Math.max(0, Math.min(Math.floor(inputNudgeFrames), N - 1));
  if (D === 0) return c;
  return (c - D + N) % N;
}

export function inputNudgeBoundaryRatio(inputNudgeFrames: number, intervalFrames: number): number {
  const N = Math.max(1, Math.floor(intervalFrames));
  if (N <= 0) return 0;
  return Math.max(0, Math.floor(inputNudgeFrames)) / N;
}

export function shouldWarnInputNudgeBoundary(
  inputNudgeFrames: number,
  intervalFrames: number,
  warnRatio = KITE_INPUT_NUDGE_BOUNDARY_WARN_RATIO
): boolean {
  return inputNudgeBoundaryRatio(inputNudgeFrames, intervalFrames) > warnRatio;
}

const MIN_BPM = 20;
const MAX_BPM = 320;
const MIN_CHORDS = 1;
const MAX_CHORDS = 64;
const MIN_BEATS_PER_BAR = 1;
const MAX_BEATS_PER_BAR = 16;
const MIN_TIME_SIGNATURE_BOTTOM = 1;
const MAX_TIME_SIGNATURE_BOTTOM = 32;
const MIN_SAMPLE_RATE = 8000;
const MAX_SAMPLE_RATE = 384000;
const DEFAULT_TIME_SIGNATURE_BOTTOM = 4;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizeNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function sanitizeInteger(value: number, min: number, max: number, fallback: number): number {
  return Math.round(clampNumber(sanitizeNumber(value, fallback), min, max));
}

function sanitizeSampleRate(value: number | undefined, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} is required for Kite interval timing.`);
  }
  return Math.round(clampNumber(value as number, MIN_SAMPLE_RATE, MAX_SAMPLE_RATE));
}

export function calcBpi(chords: number, beatsPerBar: number): number {
  const safeChords = sanitizeInteger(chords, MIN_CHORDS, MAX_CHORDS, MIN_CHORDS);
  const safeBeatsPerBar = sanitizeInteger(
    beatsPerBar,
    MIN_BEATS_PER_BAR,
    MAX_BEATS_PER_BAR,
    DEFAULT_TIME_SIGNATURE_BOTTOM
  );
  return safeChords * safeBeatsPerBar;
}

export function calcLoopDurationSeconds(bpm: number, bpi: number): number {
  const safeBpm = clampNumber(sanitizeNumber(bpm, MIN_BPM), MIN_BPM, MAX_BPM);
  const safeBpi = sanitizeInteger(bpi, MIN_CHORDS, MAX_CHORDS * MAX_BEATS_PER_BAR, MIN_CHORDS);
  return (60 / safeBpm) * safeBpi;
}

export function calcIntervalFrames(loopDurationSeconds: number, sampleRate: number): number {
  const safeDuration = sanitizeNumber(loopDurationSeconds, 0);
  const safeSampleRate = sanitizeSampleRate(sampleRate, "sampleRate");
  return Math.max(1, Math.round(Math.max(0, safeDuration) * safeSampleRate));
}

export function createKiteIntervalTiming(input: KiteIntervalTimingInput): KiteIntervalTiming {
  const timeSignatureTop = sanitizeInteger(
    input.timeSignatureTop ?? input.beatsPerBar ?? DEFAULT_TIME_SIGNATURE_BOTTOM,
    MIN_BEATS_PER_BAR,
    MAX_BEATS_PER_BAR,
    DEFAULT_TIME_SIGNATURE_BOTTOM
  );
  const beatsPerBar = sanitizeInteger(
    input.beatsPerBar ?? timeSignatureTop,
    MIN_BEATS_PER_BAR,
    MAX_BEATS_PER_BAR,
    timeSignatureTop
  );
  const timeSignatureBottom = sanitizeInteger(
    input.timeSignatureBottom ?? DEFAULT_TIME_SIGNATURE_BOTTOM,
    MIN_TIME_SIGNATURE_BOTTOM,
    MAX_TIME_SIGNATURE_BOTTOM,
    DEFAULT_TIME_SIGNATURE_BOTTOM
  );
  const bpm = clampNumber(sanitizeNumber(input.bpm, MIN_BPM), MIN_BPM, MAX_BPM);
  const chords = sanitizeInteger(input.chords, MIN_CHORDS, MAX_CHORDS, MIN_CHORDS);
  const bpi = calcBpi(chords, beatsPerBar);
  const loopDurationSeconds = calcLoopDurationSeconds(bpm, bpi);
  const hostSampleRate = sanitizeSampleRate(
    input.hostSampleRate ?? input.localSampleRate,
    "hostSampleRate"
  );
  const localSampleRate = sanitizeSampleRate(
    input.localSampleRate ?? hostSampleRate,
    "localSampleRate"
  );

  return {
    bpm,
    chords,
    beatsPerBar,
    timeSignatureTop,
    timeSignatureBottom,
    bpi,
    loopDurationSeconds,
    intervalMs: loopDurationSeconds * 1000,
    hostSampleRate,
    hostIntervalFrames: calcIntervalFrames(loopDurationSeconds, hostSampleRate),
    localSampleRate,
    localIntervalFrames: calcIntervalFrames(loopDurationSeconds, localSampleRate),
  };
}
