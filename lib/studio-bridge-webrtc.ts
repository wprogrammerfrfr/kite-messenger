/**
* Studio bridge WebRTC helpers (browser-only callers must guard with typeof window).
*/

export const STUDIO_ICE_SERVERS_FALLBACK: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

/**
 * `iceTransportPolicy: "all"` keeps host and server-reflexive candidates eligible alongside relay.
 * Restrictive networks or AP client isolation can still force relay-only paths; this does not override that.
 */
export const STUDIO_PEER_CONNECTION_CONFIG: RTCConfiguration = {
  iceTransportPolicy: "all",
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
  iceCandidatePoolSize: 10,
};

type RtpReceiverWithJitter = RTCRtpReceiver & { jitterBufferTarget?: number };

export type LowLatencyReceiverOptions = {
  /** Desktop Safari / WebKit where UA includes Safari but not Chromium-based browsers. */
  isSafariWebKit?: boolean;
};

const SAFARI_JITTER_TARGET_MS = 40;
const DEFAULT_LOW_LATENCY_JITTER_TARGET_MS = 0;

function inboundAudioJitterBufferTargetMs(options?: LowLatencyReceiverOptions): number {
  return options?.isSafariWebKit ? SAFARI_JITTER_TARGET_MS : DEFAULT_LOW_LATENCY_JITTER_TARGET_MS;
}

/**
 * Tune inbound audio playout buffering where `jitterBufferTarget` is supported (no-op otherwise).
 * Safari/WebKit uses a slightly higher target to reduce playout instability; others minimize buffering.
 */
export function applyLowLatencyInboundAudioReceivers(
  pc: RTCPeerConnection,
  options?: LowLatencyReceiverOptions
): void {
  const targetMs = inboundAudioJitterBufferTargetMs(options);
  for (const receiver of pc.getReceivers()) {
    if (receiver.track?.kind !== "audio") continue;
    if (!("jitterBufferTarget" in receiver)) continue;
    try {
      (receiver as RtpReceiverWithJitter).jitterBufferTarget = targetMs;
    } catch {
      // Setting may throw on some builds; ignore.
    }
  }
}

/** Parsed from `getStats()` for inbound remote audio (single-stream P2P). */
export type InboundAudioPacketLoss = {
  /** `packetsLost / (packetsLost + packetsReceived)`, range [0, 1]. */
  ratio: number;
  packetsLost: number;
  packetsReceived: number;
};

/**
 * Extract packet loss for the inbound audio RTP stream, if present.
 * Ignores video; first matching `inbound-rtp` wins (typical for one audio m-line).
 */
export function parseInboundAudioPacketLoss(
  stats: RTCStatsReport
): InboundAudioPacketLoss | null {
  let result: InboundAudioPacketLoss | null = null;
  stats.forEach((r) => {
    if (result !== null) return;
    if (r.type !== "inbound-rtp") return;
    const inbound = r as RTCInboundRtpStreamStats;
    if (inbound.kind !== "audio") return;
    const lost = Number(inbound.packetsLost ?? 0);
    const recv = Number(inbound.packetsReceived ?? 0);
    const total = lost + recv;
    const ratio = total > 0 ? lost / total : 0;
    result = { ratio, packetsLost: lost, packetsReceived: recv };
  });
  return result;
}

/** Mic capture tuned for conversational low-latency (Pro Audio toggles can relax these later). */
// WARNING: Echo cancellation is disabled. Headphones are MANDATORY to prevent feedback loops.
export function getStudioAudioConstraints(): boolean | MediaTrackConstraints {
  return {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    ...({ latency: { ideal: 0.05 } } as unknown as MediaTrackConstraints),
    channelCount: 2,
    sampleRate: { ideal: 48000 },
  };
}

// SDP munging (e.g. Opus reorder) was removed after it caused negotiation failures;
// reintroduce via simple-peer `sdpTransform` only with careful browser testing.

export async function acquireStudioMicStream(): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("getUserMedia is not available.");
  }
  return navigator.mediaDevices.getUserMedia({
    audio: getStudioAudioConstraints(),
    video: false,
  });
}

export function decodePeerDataChunk(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (chunk instanceof ArrayBuffer) return new TextDecoder().decode(chunk);
  if (chunk instanceof Uint8Array) return new TextDecoder().decode(chunk);
  if (ArrayBuffer.isView(chunk)) {
    const v = chunk as ArrayBufferView;
    return new TextDecoder().decode(
      v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)
    );
  }
  return String(chunk);
}

export async function fetchTurnCredentials(): Promise<RTCIceServer[]> {
  try {
    const res = await fetch("/api/turn-credentials");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    console.log("[Kite] TURN credentials loaded:", {
      serverCount: data.iceServers?.length,
      hasTurn: data.iceServers?.some((s: RTCIceServer) =>
        (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u: string) =>
          u.startsWith("turn:")
        )
      ),
    });
    return data.iceServers;
  } catch (err) {
    console.error("[Kite] TURN fetch failed, using STUN only:", err);
    return STUDIO_ICE_SERVERS_FALLBACK;
  }
}
