/**
 * Studio bridge WebRTC helpers (browser-only callers must guard with typeof window).
 */

/** Shared ICE server config (TURN relay first for strict networks). */
export const STUDIO_ICE_SERVERS: RTCIceServer[] = [
  // Prioritize TCP/443 relay first for strict networks (campus/corporate firewalls).
  {
    urls: "turn:open.metered.ca:443?transport=tcp",
    username: "7cbd6d02cf78e3bc5683bb2a",
    credential: "CPfbkDJuKleKcmkv",
  },
  {
    urls: "turn:open.metered.ca:443",
    username: "7cbd6d02cf78e3bc5683bb2a",
    credential: "CPfbkDJuKleKcmkv",
  },
  {
    urls: "turn:open.metered.ca:80",
    username: "7cbd6d02cf78e3bc5683bb2a",
    credential: "CPfbkDJuKleKcmkv",
  },
  { urls: "stun:stun.l.google.com:19302" },
];

/** Force TURN relay behavior that survives highly restricted networks (meturoam-like). */
export const STUDIO_PEER_CONNECTION_CONFIG: RTCConfiguration = {
  iceServers: STUDIO_ICE_SERVERS,
  iceTransportPolicy: "relay",
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
};

/** Mic capture tuned for conversational low-latency (Pro Audio toggles can relax these later). */
export function getStudioAudioConstraints(): boolean | MediaTrackConstraints {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    // Reduce processing delay for music-oriented sessions.
    autoGainControl: false,
    // Best-effort low-latency target (~50ms).
    ...({ latency: { ideal: 0.05 } } as unknown as MediaTrackConstraints),
    channelCount: 1,
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
