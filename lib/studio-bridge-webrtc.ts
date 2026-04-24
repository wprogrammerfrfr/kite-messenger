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
  /** Inbound packet loss percentage (0-100), when available from stats sampling. */
  packetLossPercent?: number;
};

const SAFARI_JITTER_TARGET_MS = 40;
const DEFAULT_LOW_LATENCY_JITTER_TARGET_MS = 0;

function inboundAudioJitterBufferTargetMs(options?: LowLatencyReceiverOptions): number {
  const isSafariWebKit = Boolean(options?.isSafariWebKit);
  const packetLossPercent = options?.packetLossPercent;

  if (packetLossPercent !== undefined && packetLossPercent >= 2) {
    return isSafariWebKit ? 80 : 40;
  }

  return isSafariWebKit ? SAFARI_JITTER_TARGET_MS : DEFAULT_LOW_LATENCY_JITTER_TARGET_MS;
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

/**
 * Detect whether this `AudioContext` can use the high-performance AudioWorklet path.
 * Returns false when the API surface is absent or the context is not in a usable state.
 */
export async function checkAudioWorkletSupport(ctx: AudioContext): Promise<boolean> {
  if (typeof AudioWorkletNode === "undefined") return false;
  if (!ctx || ctx.state === "closed") return false;
  return typeof ctx.audioWorklet?.addModule === "function";
}

/** Parsed from `getStats()` for inbound remote audio (single-stream P2P). */
export type InboundAudioPacketLoss = {
  /** `packetsLost / (packetsLost + packetsReceived)`, range [0, 1]. */
  ratio: number;
  packetsLost: number;
  packetsReceived: number;
};

/** RTT in milliseconds from the currently selected/succeeded ICE candidate pair. */
export type CandidatePairRtt = {
  rttMs: number;
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

/**
 * Extract ICE RTT from `candidate-pair.currentRoundTripTime` (seconds -> milliseconds).
 * Prefers selected pairs and otherwise falls back to any succeeded/nominated pair.
 */
export function parseSelectedCandidatePairRttMs(
  stats: RTCStatsReport
): CandidatePairRtt | null {
  let preferred: number | null = null;
  let fallback: number | null = null;
  stats.forEach((r) => {
    if (r.type !== "candidate-pair") return;
    const pair = r as RTCIceCandidatePairStats & {
      selected?: boolean;
      currentRoundTripTime?: number;
      state?: RTCStatsIceCandidatePairState;
      nominated?: boolean;
    };
    const roundTripSeconds = Number(pair.currentRoundTripTime);
    if (!Number.isFinite(roundTripSeconds) || roundTripSeconds < 0) return;
    const roundTripMs = roundTripSeconds * 1000;
    if (pair.selected === true) {
      preferred = roundTripMs;
      return;
    }
    if (
      fallback === null &&
      (pair.state === "succeeded" || pair.nominated === true)
    ) {
      fallback = roundTripMs;
    }
  });
  const rttMs = preferred ?? fallback;
  return rttMs === null ? null : { rttMs };
}

/** Mic capture tuned for conversational low-latency (Pro Audio toggles can relax these later). */
// WARNING: Echo cancellation is disabled. Headphones are MANDATORY to prevent feedback loops.
export function getStudioAudioConstraints(
  echoSafetyMode = false
): boolean | MediaTrackConstraints {
  return {
    echoCancellation: echoSafetyMode,
    noiseSuppression: echoSafetyMode,
    autoGainControl: false,
    ...({ latency: { ideal: 0.05 } } as unknown as MediaTrackConstraints),
    channelCount: 2,
    sampleRate: { ideal: 48000 },
  };
}

// SDP munging (e.g. Opus reorder) was removed after it caused negotiation failures;
// reintroduce via simple-peer `sdpTransform` only with careful browser testing.

export async function acquireStudioMicStream(options?: {
  echoSafetyMode?: boolean;
  deviceId?: string;
}): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("getUserMedia is not available.");
  }
  const requestedDeviceId = options?.deviceId?.trim();
  const audioConstraints: MediaTrackConstraints = {
    ...(getStudioAudioConstraints(options?.echoSafetyMode) as MediaTrackConstraints),
    ...(requestedDeviceId ? { deviceId: { exact: requestedDeviceId } } : {}),
  };
  return navigator.mediaDevices.getUserMedia({
    audio: audioConstraints,
    video: false,
  });
}

export type MixerInputStream = {
  deviceId: string;
  stream: MediaStream;
};

export type StereoProbeResult = {
  channelCount: 1 | 2;
  confidence: "measured" | "fallback";
};

export type LaneGraphResult = {
  laneKeys: string[];
  laneInfo: StereoProbeResult;
  gainNodes: Map<string, GainNode>;
  analyserNodes: Map<string, AnalyserNode>;
  sourceNode: MediaStreamAudioSourceNode;
  splitterNode: ChannelSplitterNode;
  mergerNode: ChannelMergerNode;
};

function toPerceptualGain(volumePercent: number): number {
  const clamped = Math.min(100, Math.max(0, volumePercent));
  return Math.pow(clamped / 100, 2);
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export async function probeStereoLane(
  _ctx: AudioContext,
  analyserCh0: AnalyserNode,
  analyserCh1: AnalyserNode,
  options?: {
    sampleWindowMs?: number;
    hardTimeoutMs?: number;
    signal?: AbortSignal;
  }
): Promise<StereoProbeResult> {
  const sampleWindowMs = options?.sampleWindowMs ?? 500;
  const hardTimeoutMs = options?.hardTimeoutMs ?? 1500;
  const signal = options?.signal;

  const fallback = (): StereoProbeResult => ({
    channelCount: 1,
    confidence: "fallback",
  });

  if (signal?.aborted) return fallback();

  const runSampling = async (): Promise<StereoProbeResult> => {
    const size0 = Math.max(32, analyserCh0.fftSize);
    const size1 = Math.max(32, analyserCh1.fftSize);
    const buf0 = new Float32Array(size0);
    const buf1 = new Float32Array(size1);

    const startedAt = performance.now();
    let samples = 0;
    let energy0 = 0;
    let energy1 = 0;
    let peak0 = 0;
    let peak1 = 0;

    while (performance.now() - startedAt < sampleWindowMs) {
      if (signal?.aborted) return fallback();
      analyserCh0.getFloatTimeDomainData(buf0);
      analyserCh1.getFloatTimeDomainData(buf1);

      let sumSquares0 = 0;
      for (let i = 0; i < buf0.length; i += 1) {
        const v = buf0[i] ?? 0;
        const abs = Math.abs(v);
        if (abs > peak0) peak0 = abs;
        sumSquares0 += v * v;
      }

      let sumSquares1 = 0;
      for (let i = 0; i < buf1.length; i += 1) {
        const v = buf1[i] ?? 0;
        const abs = Math.abs(v);
        if (abs > peak1) peak1 = abs;
        sumSquares1 += v * v;
      }

      energy0 += Math.sqrt(sumSquares0 / buf0.length);
      energy1 += Math.sqrt(sumSquares1 / buf1.length);
      samples += 1;

      await sleepMs(20);
    }

    if (samples === 0) return fallback();
    const avg0 = energy0 / samples;
    const avg1 = energy1 / samples;
    const baseline = Math.max(avg0, 1e-5);
    const ratio = avg1 / baseline;

    const isStereo =
      (avg1 > 0.003 && ratio > 0.15) ||
      (peak1 > 0.02 && peak0 > 0.02 && ratio > 0.1);

    return {
      channelCount: isStereo ? 2 : 1,
      confidence: "measured",
    };
  };

  const timeoutPromise = new Promise<StereoProbeResult>((resolve) => {
    window.setTimeout(() => resolve(fallback()), hardTimeoutMs);
  });

  try {
    return await Promise.race([runSampling(), timeoutPromise]);
  } catch {
    return fallback();
  }
}

export async function createLaneGraph(args: {
  deviceId: string;
  stream: MediaStream;
  audioCtx: AudioContext;
  destinationNode: MediaStreamAudioDestinationNode;
  deviceVolumes?: Record<string, number>;
  probeOptions?: {
    sampleWindowMs?: number;
    hardTimeoutMs?: number;
    signal?: AbortSignal;
  };
}): Promise<LaneGraphResult> {
  const deviceId = args.deviceId?.trim();
  if (!deviceId) {
    throw new Error("createLaneGraph requires a non-empty deviceId.");
  }

  if (!(args.stream instanceof MediaStream) || args.stream.getAudioTracks().length === 0) {
    throw new Error("createLaneGraph requires a MediaStream with at least one audio track.");
  }

  const audioCtx = args.audioCtx;
  const destinationNode = args.destinationNode;
  const gainNodes = new Map<string, GainNode>();
  const analyserNodes = new Map<string, AnalyserNode>();
  const sourceNode = audioCtx.createMediaStreamSource(args.stream);
  const authoritativeChannelCount = sourceNode.channelCount >= 2 ? 2 : 1;
  const splitterNode = audioCtx.createChannelSplitter(2);
  const mergerNode = audioCtx.createChannelMerger(2);
  const laneKeys: string[] = [];

  sourceNode.connect(splitterNode);
  for (let channelIdx = 0; channelIdx < 2; channelIdx += 1) {
    const laneKey = `${deviceId}:ch${channelIdx}`;
    const gainNode = audioCtx.createGain();
    const analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 256;
    analyserNode.smoothingTimeConstant = 0.5;

    const splitterOutput = authoritativeChannelCount === 2 ? channelIdx : 0;
    splitterNode.connect(gainNode, splitterOutput, 0);
    gainNode.connect(analyserNode);
    analyserNode.connect(mergerNode, 0, channelIdx);

    const volumePercent = args.deviceVolumes?.[deviceId] ?? 100;
    gainNode.gain.value = toPerceptualGain(volumePercent);

    gainNodes.set(laneKey, gainNode);
    analyserNodes.set(laneKey, analyserNode);
    laneKeys.push(laneKey);
  }

  mergerNode.connect(destinationNode);

  const laneInfo = await probeStereoLane(
    audioCtx,
    analyserNodes.get(`${deviceId}:ch0`)!,
    analyserNodes.get(`${deviceId}:ch1`)!,
    args.probeOptions
  );

  return {
    laneKeys,
    laneInfo,
    gainNodes,
    analyserNodes,
    sourceNode,
    splitterNode,
    mergerNode,
  };
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

/** Lower number = earlier in the candidate URL list (TURN over 443 / TLS first, then TCP relay). */
function studioIceUrlSortPriority(url: string): number {
  const lower = url.toLowerCase();
  const base = lower.split("?")[0].split("#")[0];
  if (lower.startsWith("turns:") && /:443$/.test(base)) return 0;
  if (lower.startsWith("turns:")) return 1;
  if (lower.startsWith("turn:") && lower.includes("transport=tcp")) return 2;
  return 3;
}

function sortAndDedupeIceUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const u of urls) {
    if (typeof u !== "string" || u.length === 0) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    unique.push(u);
  }
  unique.sort((a, b) => {
    const pa = studioIceUrlSortPriority(a);
    const pb = studioIceUrlSortPriority(b);
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b);
  });
  return unique;
}

function normalizeFetchedIceServers(raw: unknown[]): RTCIceServer[] {
  const out: RTCIceServer[] = [];
  const seenServerKeys = new Set<string>();

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const server = entry as RTCIceServer;
    const rawUrls = server.urls;
    let urlList: string[];
    if (Array.isArray(rawUrls)) {
      urlList = rawUrls.filter((u): u is string => typeof u === "string");
    } else if (typeof rawUrls === "string") {
      urlList = [rawUrls];
    } else {
      continue;
    }
    const sortedUrls = sortAndDedupeIceUrls(urlList);
    if (sortedUrls.length === 0) continue;

    const normalized: RTCIceServer = {
      ...server,
      urls: sortedUrls.length === 1 ? sortedUrls[0]! : sortedUrls,
    };

    const urlsKey = JSON.stringify(
      Array.isArray(normalized.urls) ? normalized.urls : [normalized.urls]
    );
    const serverKey = `${urlsKey}|${normalized.username ?? ""}|${normalized.credential ?? ""}`;
    if (seenServerKeys.has(serverKey)) continue;
    seenServerKeys.add(serverKey);

    out.push(normalized);
  }
  return out;
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
    if (
      !data.iceServers ||
      !Array.isArray(data.iceServers) ||
      data.iceServers.length === 0
    ) {
      console.error(
        "[Kite] TURN response missing or empty iceServers, using fallback:",
        data
      );
      return STUDIO_ICE_SERVERS_FALLBACK;
    }
    return normalizeFetchedIceServers(data.iceServers);
  } catch (err) {
    console.error("[Kite] TURN fetch failed, using STUN only:", err);
    return STUDIO_ICE_SERVERS_FALLBACK;
  }
}

export function buildPeerConfig(
  iceServers: RTCIceServer[],
  forceRelay: boolean
): RTCConfiguration {
  if (forceRelay) {
    const tlsOnly = iceServers
      .map((server) => {
        const urls = (
          Array.isArray(server.urls) ? server.urls : [server.urls]
        ).filter((url) => typeof url === 'string' && url.startsWith("turns:"));
        return urls.length > 0 ? ({ ...server, urls } as RTCIceServer) : null;
      })
      .filter((s): s is RTCIceServer => s !== null);

    if (tlsOnly.length === 0) {
      console.error(
        "[buildPeerConfig] forceRelay=true but no turns: URLs found. Connection will fail."
      );
    }

    return {
      iceServers: tlsOnly,
      iceTransportPolicy: "relay",
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      iceCandidatePoolSize: 2,
    };
  }

  return {
    iceServers,
    iceTransportPolicy: "all",
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
    iceCandidatePoolSize: 10,
  };
}
