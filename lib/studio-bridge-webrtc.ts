/**
 * Studio bridge WebRTC helpers (browser-only callers must guard with typeof window).
 */

/** Mic capture tuned for conversational low-latency (Pro Audio toggles can relax these later). */
export function getStudioAudioConstraints(): boolean | MediaTrackConstraints {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
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
