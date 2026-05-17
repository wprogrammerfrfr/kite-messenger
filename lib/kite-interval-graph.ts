import {
  calcInputNudgeFrames,
  KITE_DEFAULT_INPUT_LATENCY_MS,
  shouldWarnInputNudgeBoundary,
  KITE_TARGET_SAMPLE_RATE,
  type KiteIntervalTiming,
} from "@/lib/kite-interval-math";

export type KiteIntervalInputStream = {
  id: string;
  stream: MediaStream;
  gain?: number;
};

export type KiteIntervalReadyEvent = {
  type: "INTERVAL_READY";
  intervalId: string | null;
  sequenceNumber: number;
  sampleRate: number;
  intervalFrames: number;
  channelCount: number;
  buffer: ArrayBuffer;
};

export type KiteIntervalStateEvent = {
  type: "INTERVAL_STATE";
  state: string;
  intervalId: string | null;
  intervalFrames: number;
  channelCount: number;
  sampleRate: number;
};

export type KiteIntervalGraphEvent = KiteIntervalReadyEvent | KiteIntervalStateEvent;

export type BuildKiteIntervalGraphOptions = {
  audioContext: AudioContext;
  inputStreams: KiteIntervalInputStream[];
  destinationNode: MediaStreamAudioDestinationNode;
  timing: Pick<KiteIntervalTiming, "localIntervalFrames" | "localSampleRate">;
  intervalId: string;
  sequenceNumber?: number;
  channelCount?: 1 | 2;
  monitorDestination?: AudioNode;
  monitorGain?: number;
  /** One-way capture delay (ms); stopwatch-calibrated, not baseLatency. */
  inputLatencyMs?: number;
  onEvent?: (event: KiteIntervalGraphEvent) => void;
};

export type LoadKiteIntervalOptions = {
  intervalId?: string;
  intervalFrames: number;
  channelCount: number;
  sampleRate: number;
  buffer: Float32Array | ArrayBuffer;
};

export type KiteIntervalGraph = {
  workletNode: AudioWorkletNode;
  sourceNodes: MediaStreamAudioSourceNode[];
  gainNodes: GainNode[];
  inputBus: GainNode;
  outputGain: GainNode;
  monitorGainNode: GainNode | null;
  loadInterval(options: LoadKiteIntervalOptions): void;
  alignPhase(anchorContextSec: number): void;
  setInputNudge(inputNudgeFrames: number): void;
  reset(): void;
  teardown(): void;
};

const WORKLET_URL = "/worklets/kite-interval-processor.js";
const WORKLET_NAME = "kite-interval-processor";
const workletLoadPromises = new WeakMap<AudioContext, Promise<void>>();

function assertUsableAudioContext(ctx: AudioContext): void {
  if (!ctx || ctx.state === "closed") {
    throw new Error("Kite interval graph requires an open AudioContext.");
  }
  if (!ctx.audioWorklet || typeof ctx.audioWorklet.addModule !== "function") {
    throw new Error("AudioWorklet is not available in this browser.");
  }
}

function assertPreMasterInputs(
  inputStreams: KiteIntervalInputStream[],
  destinationNode: MediaStreamAudioDestinationNode
): void {
  if (!Array.isArray(inputStreams) || inputStreams.length === 0) {
    throw new Error("Kite interval graph requires at least one input stream.");
  }

  for (const input of inputStreams) {
    if (!input?.stream || input.stream.getAudioTracks().length === 0) {
      throw new Error("Kite interval graph input streams must contain audio tracks.");
    }
    if (input.stream === destinationNode.stream) {
      throw new Error("Kite interval graph input must be pre-master audio, not the master mix.");
    }
  }
}

function clampGain(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(4, Math.max(0, value as number));
}

function transferListForBuffer(buffer: Float32Array | ArrayBuffer): Transferable[] {
  if (buffer instanceof ArrayBuffer) return [buffer];
  if (buffer.buffer instanceof ArrayBuffer) return [buffer.buffer];
  return [];
}

export async function ensureKiteIntervalWorkletLoaded(ctx: AudioContext): Promise<void> {
  assertUsableAudioContext(ctx);
  const existing = workletLoadPromises.get(ctx);
  if (existing) return existing;

  const loadPromise = ctx.audioWorklet.addModule(WORKLET_URL);
  workletLoadPromises.set(ctx, loadPromise);
  try {
    await loadPromise;
  } catch (error) {
    workletLoadPromises.delete(ctx);
    throw error;
  }
}

export async function buildKiteIntervalGraph(
  options: BuildKiteIntervalGraphOptions
): Promise<KiteIntervalGraph> {
  const ctx = options.audioContext;
  assertUsableAudioContext(ctx);
  const contextSr = Math.round(ctx.sampleRate);
  const timingSr = Math.round(options.timing.localSampleRate);
  if (timingSr !== contextSr) {
    throw new Error(
      `Kite interval timing localSampleRate (${timingSr}) must match AudioContext.sampleRate (${contextSr}). Studio Kite nominal is ${KITE_TARGET_SAMPLE_RATE} Hz when the context supports it.`
    );
  }
  assertPreMasterInputs(options.inputStreams, options.destinationNode);
  await ensureKiteIntervalWorkletLoaded(ctx);

  const channelCount = options.channelCount ?? 2;
  const sourceNodes: MediaStreamAudioSourceNode[] = [];
  const gainNodes: GainNode[] = [];
  const inputBus = ctx.createGain();
  const outputGain = ctx.createGain();
  const monitorGainNode = options.monitorDestination ? ctx.createGain() : null;
  const workletNode = new AudioWorkletNode(ctx, WORKLET_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [channelCount],
    processorOptions: {
      sampleRate: options.timing.localSampleRate,
    },
  });

  let tornDown = false;

  workletNode.port.onmessage = (event: MessageEvent<KiteIntervalGraphEvent>) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "INTERVAL_READY" || data.type === "INTERVAL_STATE") {
      options.onEvent?.(data);
    }
  };

  for (const input of options.inputStreams) {
    const sourceNode = ctx.createMediaStreamSource(input.stream);
    const gainNode = ctx.createGain();
    gainNode.gain.value = clampGain(input.gain);
    sourceNode.connect(gainNode);
    gainNode.connect(inputBus);
    sourceNodes.push(sourceNode);
    gainNodes.push(gainNode);
  }

  inputBus.connect(workletNode);
  workletNode.connect(outputGain);
  outputGain.connect(options.destinationNode);

  if (monitorGainNode && options.monitorDestination) {
    monitorGainNode.gain.value = clampGain(options.monitorGain);
    outputGain.connect(monitorGainNode);
    monitorGainNode.connect(options.monitorDestination);
  }

  const inputLatencyMs = options.inputLatencyMs ?? KITE_DEFAULT_INPUT_LATENCY_MS;
  const inputNudgeFrames = calcInputNudgeFrames(
    inputLatencyMs,
    timingSr,
    options.timing.localIntervalFrames
  );
  if (
    shouldWarnInputNudgeBoundary(inputNudgeFrames, options.timing.localIntervalFrames)
  ) {
    console.warn(
      "[Kite interval] input nudge is large relative to loop length; P2P seam skew may be audible.",
      {
        inputNudgeFrames,
        intervalFrames: options.timing.localIntervalFrames,
        inputLatencyMs,
      }
    );
  }

  workletNode.port.postMessage({
    type: "SET_INTERVAL",
    intervalId: options.intervalId,
    intervalFrames: options.timing.localIntervalFrames,
    sampleRate: options.timing.localSampleRate,
    channelCount,
    sequenceNumber: options.sequenceNumber ?? 0,
    inputNudgeFrames,
  });

  const graph: KiteIntervalGraph = {
    workletNode,
    sourceNodes,
    gainNodes,
    inputBus,
    outputGain,
    monitorGainNode,
    loadInterval(loadOptions: LoadKiteIntervalOptions): void {
      if (tornDown) return;
      workletNode.port.postMessage(
        {
          type: "LOAD_INTERVAL",
          intervalId: loadOptions.intervalId,
          intervalFrames: loadOptions.intervalFrames,
          sampleRate: loadOptions.sampleRate,
          channelCount: loadOptions.channelCount,
          buffer: loadOptions.buffer,
        },
        transferListForBuffer(loadOptions.buffer)
      );
    },
    alignPhase(anchorContextSec: number): void {
      if (tornDown) return;
      if (!Number.isFinite(anchorContextSec)) return;
      workletNode.port.postMessage({
        type: "ALIGN_PHASE",
        anchorContextSec,
      });
    },
    setInputNudge(nudgeFrames: number): void {
      if (tornDown) return;
      workletNode.port.postMessage({
        type: "SET_INPUT_NUDGE",
        inputNudgeFrames: nudgeFrames,
      });
    },
    reset(): void {
      if (tornDown) return;
      workletNode.port.postMessage({ type: "RESET_INTERVAL" });
    },
    teardown(): void {
      if (tornDown) return;
      tornDown = true;
      teardownKiteIntervalGraph(graph);
    },
  };

  return graph;
}

export function teardownKiteIntervalGraph(graph: KiteIntervalGraph | null): void {
  if (!graph) return;

  graph.workletNode.port.onmessage = null;
  try {
    graph.workletNode.port.postMessage({ type: "RESET_INTERVAL" });
  } catch {
    /* ignore closed or detached ports */
  }
  try {
    graph.workletNode.port.close?.();
  } catch {
    /* ignore browsers with non-closeable or already-closed ports */
  }

  for (const sourceNode of graph.sourceNodes) {
    try {
      sourceNode.disconnect();
    } catch {
      /* ignore */
    }
  }

  for (const gainNode of graph.gainNodes) {
    try {
      gainNode.disconnect();
    } catch {
      /* ignore */
    }
  }

  try {
    graph.inputBus.disconnect();
  } catch {
    /* ignore */
  }
  try {
    graph.workletNode.disconnect();
  } catch {
    /* ignore */
  }
  try {
    graph.outputGain.disconnect();
  } catch {
    /* ignore */
  }
  try {
    graph.monitorGainNode?.disconnect();
  } catch {
    /* ignore */
  }
}
