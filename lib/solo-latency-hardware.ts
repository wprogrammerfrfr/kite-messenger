import type { SoloLatencyHwFingerprint } from "@/lib/solo-latency-persistence";

export type BuildSoloLatencyHwFingerprintOptions = {
  primaryInputDeviceId: string;
  activeInputDeviceIds: readonly string[];
  audioOutputDeviceIds: readonly string[];
  sampleRate: number;
  calibratedAt?: number;
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
  return {
    v: 1,
    primaryInputDeviceId: options.primaryInputDeviceId.trim() || "default",
    activeInputDeviceIds: sortedUniqueIds(options.activeInputDeviceIds),
    audioOutputDeviceIds: sortedUniqueIds(options.audioOutputDeviceIds),
    sampleRate: Math.round(options.sampleRate),
    calibratedAt: options.calibratedAt ?? Date.now(),
  };
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
  if (!deviceIdSetsEqual(saved.audioOutputDeviceIds, current.audioOutputDeviceIds)) {
    return true;
  }
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
