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
