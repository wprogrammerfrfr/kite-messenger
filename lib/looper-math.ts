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
