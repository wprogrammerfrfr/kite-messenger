/**
 * Pure helpers for multitrack looper frame alignment (P5-05+).
 * No I/O, secrets, or audio graph coupling.
 *
 * V4.1 parity: `snapToMasterMultiple` below is the canonical TypeScript source.
 * The AudioWorklet copies this logic inline in
 * `public/worklets/solo-looper-processor.js` (cannot import TS modules).
 * If you change either copy, update both and keep them algorithm-identical.
 * Pedal-up overdub finalize runs only in the worklet; this module is for tests/docs.
 */

/**
 * Snaps `targetFrames` to the nearest integer multiple of `masterFrames`
 * (Track 1 loop length), with N = round(target/master) clamped so N ≥ 1.
 *
 * @returns `N * masterFrames`, or `targetFrames` unchanged when inputs are unsafe.
 * @see public/worklets/solo-looper-processor.js — inline `snapToMasterMultiple` (must match)
 */
export function snapToMasterMultiple(targetFrames: number, masterFrames: number): number {
  if (!Number.isFinite(targetFrames) || !Number.isFinite(masterFrames) || targetFrames < 0) {
    return targetFrames;
  }
  if (masterFrames <= 0) {
    return targetFrames;
  }
  const ratio = targetFrames / masterFrames;
  if (!Number.isFinite(ratio)) {
    return targetFrames;
  }
  const n = Math.round(ratio);
  const clampedN = Math.max(1, n);
  return clampedN * masterFrames;
}

/** Bar-count presets for simple meters (3/4, 4/4). */
const BAR_COUNT_OPTIONS_SIMPLE = [1, 2, 4, 8] as const;

/** Bar-count presets for compound 6/8 (includes 3- and 6-bar phrases). */
const BAR_COUNT_OPTIONS_COMPOUND_6_8 = [1, 2, 3, 4, 6, 8] as const;

/**
 * Beat-quantized loop length in frames for a track (grid / handsfree targets).
 * Matches worklet framesPerBeat × totalBeats quantization.
 */
export function computeTrackTargetLengthFrames(
  sampleRate: number,
  bpm: number,
  beatsPerBar: number,
  barCount: number
): number {
  const effectiveBpm = Math.max(1, Math.round(bpm));
  const sr = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
  const framesPerBeat = Math.round(sr * (60 / effectiveBpm));
  const totalBeats = Math.max(1, Math.round(beatsPerBar * barCount));
  return Math.max(1, framesPerBeat * totalBeats);
}

/**
 * Allowed bar-count choices per global time signature.
 * 4/4 and 3/4 → 1, 2, 4, 8; 6/8 → 1, 2, 3, 4, 6, 8.
 */
export function getBarCountOptionsForTimeSignature(
  top: number,
  bottom: number
): readonly number[] {
  const safeTop = Math.max(1, Math.round(top));
  const safeBottom = Math.max(1, Math.round(bottom));
  if (safeTop === 6 && safeBottom === 8) {
    return BAR_COUNT_OPTIONS_COMPOUND_6_8;
  }
  if ((safeTop === 4 && safeBottom === 4) || (safeTop === 3 && safeBottom === 4)) {
    return BAR_COUNT_OPTIONS_SIMPLE;
  }
  return BAR_COUNT_OPTIONS_SIMPLE;
}

/** True when `barCount` is a valid option for the given time signature. */
export function isAllowedBarCount(barCount: number, top: number, bottom: number): boolean {
  const n = Math.round(Number(barCount));
  if (!Number.isFinite(n) || n < 1) return false;
  return getBarCountOptionsForTimeSignature(top, bottom).includes(n);
}

/**
 * Dev advisory: true when track loop length is an integer multiple of master length.
 * Not used for runtime grid/handsfree auto-stop snapping.
 */
export function isCommensurateWithMaster(trackFrames: number, masterFrames: number): boolean {
  const track = Math.floor(Number(trackFrames));
  const master = Math.floor(Number(masterFrames));
  if (!Number.isFinite(track) || !Number.isFinite(master) || track <= 0 || master <= 0) {
    return false;
  }
  const ratio = track / master;
  return Number.isFinite(ratio) && Math.abs(ratio - Math.round(ratio)) < 1e-9;
}
