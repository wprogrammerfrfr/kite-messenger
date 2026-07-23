/**
 * Pure helpers for auto-selecting a studio mic that prefers built-in / USB
 * inputs over Bluetooth headset mics (which force A2DP → HFP/HSP).
 * No getUserMedia — callers decide when to enumerate / probe.
 */

const BLUETOOTH_LABEL_MARKERS = [
  "bluetooth",
  "hands-free",
  "hands free",
  "airpods",
  "headset",
  "hfp",
  "hsp",
  "buds",
] as const;

const PREFERRED_LABEL_MARKERS = [
  "built-in",
  "builtin",
  "internal",
  "microphone array",
  "macbook",
  "realtek",
  "usb",
  "analog",
  "laptop",
] as const;

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

/** True when a media-device label looks like a Bluetooth / Hands-Free headset mic. */
export function isLikelyBluetoothAudioInputLabel(label: string): boolean {
  const normalized = normalizeLabel(label);
  if (!normalized) return false;
  return BLUETOOTH_LABEL_MARKERS.some((marker) => normalized.includes(marker));
}

function isPreferredNonBluetoothLabel(label: string): boolean {
  const normalized = normalizeLabel(label);
  if (!normalized || isLikelyBluetoothAudioInputLabel(normalized)) return false;
  return PREFERRED_LABEL_MARKERS.some((marker) => normalized.includes(marker));
}

function audioInputsOnly(devices: readonly MediaDeviceInfo[]): MediaDeviceInfo[] {
  return devices.filter((d) => d.kind === "audioinput" && Boolean(d.deviceId));
}

/**
 * Pick an auto-select mic deviceId.
 * Order: preferred built-in/USB → non-BT "default" → first non-BT → first available (BT last resort).
 * Returns null when the list has no usable audioinput entries.
 */
export function pickPreferredAudioInputDeviceId(
  devices: readonly MediaDeviceInfo[]
): string | null {
  const inputs = audioInputsOnly(devices);
  if (inputs.length === 0) return null;

  const nonBt = inputs.filter((d) => !isLikelyBluetoothAudioInputLabel(d.label));

  const preferred = nonBt.find((d) => isPreferredNonBluetoothLabel(d.label));
  if (preferred) return preferred.deviceId;

  const defaultNonBt = nonBt.find((d) => d.deviceId === "default");
  if (defaultNonBt) return defaultNonBt.deviceId;

  if (nonBt.length > 0) return nonBt[0]!.deviceId;

  // Only Bluetooth (or unlabeled-as-BT) inputs remain — last resort so studio still boots.
  return inputs[0]!.deviceId;
}
