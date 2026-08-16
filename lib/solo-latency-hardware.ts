import type { SoloLatencyHwFingerprint } from "@/lib/solo-latency-persistence";

export type BuildSoloLatencyHwFingerprintOptions = {
  primaryInputDeviceId: string;
  activeInputDeviceIds: readonly string[];
  audioOutputDeviceIds: readonly string[];
  sampleRate: number;
  calibratedAt?: number;
  /** Rounded AudioContext.baseLatency in ms. */
  baseLatencyMs?: number;
  /** Rounded AudioContext.outputLatency in ms. */
  outputLatencyMs?: number;
};

function sortedUniqueIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.filter((id) => typeof id === "string"))).sort();
}

function deviceIdSetsEqual(a: readonly string[], b: readonly string[]): boolean {
  const left = sortedUniqueIds(a);
  const right = sortedUniqueIds(b);
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

export function fingerprintAudioOutputs(devices: readonly MediaDeviceInfo[]): string[] {
  return sortedUniqueIds(
    devices.filter((device) => device.kind === "audiooutput").map((device) => device.deviceId)
  );
}

export function resolvePrimaryInputDeviceId(
  activeDeviceIds: readonly string[],
  localMicStream: MediaStream | null
): string {
  for (const deviceId of activeDeviceIds) {
    if (deviceId && deviceId.trim()) {
      return deviceId.trim();
    }
  }
  const track = localMicStream?.getAudioTracks()[0] ?? null;
  const fromTrack = track?.getSettings().deviceId?.trim();
  if (fromTrack) {
    return fromTrack;
  }
  return "default";
}

export function buildSoloLatencyHwFingerprint(
  options: BuildSoloLatencyHwFingerprintOptions
): SoloLatencyHwFingerprint {
  const fingerprint: SoloLatencyHwFingerprint = {
    v: 1,
    primaryInputDeviceId: options.primaryInputDeviceId.trim() || "default",
    activeInputDeviceIds: sortedUniqueIds(options.activeInputDeviceIds),
    audioOutputDeviceIds: sortedUniqueIds(options.audioOutputDeviceIds),
    sampleRate: Math.round(options.sampleRate),
    calibratedAt: options.calibratedAt ?? Date.now(),
  };
  if (
    options.baseLatencyMs !== undefined &&
    Number.isFinite(options.baseLatencyMs)
  ) {
    fingerprint.baseLatencyMs = Math.round(options.baseLatencyMs);
  }
  if (
    options.outputLatencyMs !== undefined &&
    Number.isFinite(options.outputLatencyMs)
  ) {
    fingerprint.outputLatencyMs = Math.round(options.outputLatencyMs);
  }
  return fingerprint;
}

export function isSoloLatencyHwStale(
  saved: SoloLatencyHwFingerprint | null,
  current: SoloLatencyHwFingerprint | null
): boolean {
  if (!saved || !current) {
    return false;
  }
  if (saved.v !== current.v) {
    return true;
  }
  if (saved.primaryInputDeviceId !== current.primaryInputDeviceId) {
    return true;
  }
  if (!deviceIdSetsEqual(saved.activeInputDeviceIds, current.activeInputDeviceIds)) {
    return true;
  }
  // Output id set churn and HAL (baseLatency / outputLatency) are ignored — plugging
  // wired headphones often changes those without a meaningful RTL change on the same mic.
  // Input device ids + sample rate still gate stale (headset mic switch, etc.).
  if (Math.round(saved.sampleRate) !== Math.round(current.sampleRate)) {
    return true;
  }
  return false;
}

export async function enumerateAudioOutputDeviceIds(): Promise<string[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return [];
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return fingerprintAudioOutputs(devices);
  } catch {
    return [];
  }
}
