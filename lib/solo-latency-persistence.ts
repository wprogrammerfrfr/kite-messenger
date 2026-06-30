export const SOLO_LATENCY_MS_KEY = "kite_solo_latency_ms";
export const SOLO_LATENCY_HW_KEY = "kite_solo_latency_hw_v1";

export const SOLO_LATENCY_APPLIED_MIN_MS = 0;
export const SOLO_LATENCY_APPLIED_MAX_MS = 200;
export const SOLO_LATENCY_ENTRY_MIN_MS = 15;
export const SOLO_LATENCY_ENTRY_MAX_MS = 200;

export type SoloLatencyQualityTone = "error" | "good" | "fair";

export type SoloLatencyQualityFeedback = {
  message: string;
  tone: SoloLatencyQualityTone;
};

export type SoloLatencyHwFingerprint = {
  v: 1;
  primaryInputDeviceId: string;
  activeInputDeviceIds: string[];
  audioOutputDeviceIds: string[];
  sampleRate: number;
  calibratedAt: number;
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

export function isSoloLatencyCalibrated(ms: number): boolean {
  return ms > 0;
}

export function isSoloLatencyEntryAllowed(ms: number): boolean {
  if (!Number.isFinite(ms)) {
    return false;
  }
  const rounded = Math.round(ms);
  return rounded >= SOLO_LATENCY_ENTRY_MIN_MS && rounded <= SOLO_LATENCY_ENTRY_MAX_MS;
}

export function getSoloLatencyQualityFeedback(ms: number): SoloLatencyQualityFeedback {
  if (!Number.isFinite(ms)) {
    return {
      tone: "error",
      message: "Warning: Result too low. Please turn up volume and try again.",
    };
  }
  const rounded = Math.round(ms);
  if (rounded < SOLO_LATENCY_ENTRY_MIN_MS) {
    return {
      tone: "error",
      message: "Warning: Result too low. Please turn up volume and try again.",
    };
  }
  if (rounded <= 65) {
    return {
      tone: "good",
      message: "Excellent (Typical for Mac setups)",
    };
  }
  if (rounded <= 150) {
    return {
      tone: "good",
      message: "Good (Typical for Windows setups)",
    };
  }
  if (rounded <= SOLO_LATENCY_ENTRY_MAX_MS) {
    return {
      tone: "fair",
      message: "Fair (Noticeable delay, wired headphones recommended)",
    };
  }
  return {
    tone: "error",
    message: "Poor: High latency detected. Please switch to wired headphones.",
  };
}

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
  return (
    fp.v === 1 &&
    typeof fp.primaryInputDeviceId === "string" &&
    Array.isArray(fp.activeInputDeviceIds) &&
    fp.activeInputDeviceIds.every((id) => typeof id === "string") &&
    Array.isArray(fp.audioOutputDeviceIds) &&
    fp.audioOutputDeviceIds.every((id) => typeof id === "string") &&
    Number.isFinite(fp.sampleRate) &&
    Number.isFinite(fp.calibratedAt)
  );
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
