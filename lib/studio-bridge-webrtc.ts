/**
* Studio bridge WebRTC helpers (browser-only callers must guard with typeof window).
*/

export const STUDIO_ICE_SERVERS_FALLBACK: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

/** Adaptive behavior for strict networks + VPN tunnel fallback paths. */
export const STUDIO_PEER_CONNECTION_CONFIG: RTCConfiguration = {
  iceTransportPolicy: "all",
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
  iceCandidatePoolSize: 10,
};

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
