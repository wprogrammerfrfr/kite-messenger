export const SOLO_LATENCY_MS_KEY = "kite_solo_latency_ms";
export const SOLO_LATENCY_HW_KEY = "kite_solo_latency_hw_v1";

export const SOLO_LATENCY_APPLIED_MIN_MS = 0;
/** Canonical applied/preview RTL cap for guided wizard + persistence. */
export const SOLO_LATENCY_APPLIED_MAX_MS = 400;
export const SOLO_LATENCY_ENTRY_MIN_MS = 15;
export const SOLO_LATENCY_ENTRY_MAX_MS = 400;

export type SoloLatencyHwFingerprint = {
  v: 1;
  primaryInputDeviceId: string;
  activeInputDeviceIds: string[];
  audioOutputDeviceIds: string[];
  sampleRate: number;
  calibratedAt: number;
  /** Rounded AudioContext.baseLatency in ms at calibration (optional for legacy stored fp). */
  baseLatencyMs?: number;
  /** Rounded AudioContext.outputLatency in ms at calibration (optional for legacy stored fp). */
  outputLatencyMs?: number;
};

export function clampSoloLatencyMs(value: number): number {
  if (!Number.isFinite(value)) {
    return SOLO_LATENCY_APPLIED_MIN_MS;
  }
  return Math.max(
    SOLO_LATENCY_APPLIED_MIN_MS,
    Math.min(SOLO_LATENCY_APPLIED_MAX_MS, Math.round(value))
  );
}

/**
 * Uncalibrated = null, non-finite, or non-positive.
 * Calibrated = any finite applied ms > 0 (within 0–400 clamp after write).
 */
export function isSoloLatencyCalibrated(ms: number | null | undefined): boolean {
  return ms != null && Number.isFinite(ms) && ms > 0;
}

export function isSoloLatencyEntryAllowed(ms: number): boolean {
  if (!Number.isFinite(ms)) {
    return false;
  }
  const rounded = Math.round(ms);
  return rounded >= SOLO_LATENCY_ENTRY_MIN_MS && rounded <= SOLO_LATENCY_ENTRY_MAX_MS;
}

/**
 * Returns clamped ms, or null when missing/invalid (uncalibrated).
 * Callers must treat null as uncalibrated — do not coerce to 0 for "has calibrated" checks.
 */
export function readSoloLatencyMs(): number | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(SOLO_LATENCY_MS_KEY);
    if (raw === null) {
      return null;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return clampSoloLatencyMs(parsed);
  } catch {
    return null;
  }
}

/**
 * Persist a confirmed RTL value (0–400). Guided wizard writes only on Confirm;
 * cancel must not call this with a draft.
 */
export function writeSoloLatencyMs(ms: number): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(SOLO_LATENCY_MS_KEY, String(clampSoloLatencyMs(ms)));
  } catch {
    /* ignore storage write errors */
  }
}

function isValidHwFingerprint(value: unknown): value is SoloLatencyHwFingerprint {
  if (!value || typeof value !== "object") {
    return false;
  }
  const fp = value as SoloLatencyHwFingerprint;
  if (
    fp.v !== 1 ||
    typeof fp.primaryInputDeviceId !== "string" ||
    !Array.isArray(fp.activeInputDeviceIds) ||
    !fp.activeInputDeviceIds.every((id) => typeof id === "string") ||
    !Array.isArray(fp.audioOutputDeviceIds) ||
    !fp.audioOutputDeviceIds.every((id) => typeof id === "string") ||
    !Number.isFinite(fp.sampleRate) ||
    !Number.isFinite(fp.calibratedAt)
  ) {
    return false;
  }
  if (fp.baseLatencyMs !== undefined && !Number.isFinite(fp.baseLatencyMs)) {
    return false;
  }
  if (fp.outputLatencyMs !== undefined && !Number.isFinite(fp.outputLatencyMs)) {
    return false;
  }
  return true;
}

export function readSoloLatencyHwFingerprint(): SoloLatencyHwFingerprint | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(SOLO_LATENCY_HW_KEY);
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isValidHwFingerprint(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeSoloLatencyHwFingerprint(fingerprint: SoloLatencyHwFingerprint): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(SOLO_LATENCY_HW_KEY, JSON.stringify(fingerprint));
  } catch {
    /* ignore storage write errors */
  }
}
