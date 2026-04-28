import type { KiteIntervalTiming } from "@/lib/kite-interval-math";

export type SoloLooperReadyEvent = {
  type: "LOOP_READY";
  loopId: string | null;
  sampleRate: number;
  intervalFrames: number;
  channelCount: number;
  buffer: ArrayBuffer;
};

export type SoloLooperStateEvent = {
  type: "LOOP_STATE";
  state: string;
  loopId: string | null;
  intervalFrames: number;
  channelCount: number;
  sampleRate: number;
};

export type SoloLooperEngineEvent = SoloLooperReadyEvent | SoloLooperStateEvent;

export type BuildSoloLooperEngineOptions = {
  audioContext: AudioContext;
  inputStream: MediaStream;
  destinationNode: MediaStreamAudioDestinationNode;
  timing: Pick<KiteIntervalTiming, "localIntervalFrames" | "localSampleRate">;
  loopId?: string;
  channelCount?: 1 | 2;
  outputGain?: number;
  monitorDestination?: AudioNode;
  monitorGain?: number;
  onEvent?: (event: SoloLooperEngineEvent) => void;
};

export type SoloLooperEngine = {
  workletNode: AudioWorkletNode;
  sourceNode: MediaStreamAudioSourceNode;
  inputGain: GainNode;
  outputGain: GainNode;
  monitorGainNode: GainNode | null;
  startRecording(): void;
  stop(): void;
  reset(): void;
  teardown(): void;
};

const WORKLET_URL = "/worklets/solo-looper-processor.js";
const WORKLET_NAME = "solo-looper-processor";
const workletLoadPromises = new WeakMap<AudioContext, Promise<void>>();

function assertUsableAudioContext(ctx: AudioContext): void {
  if (!ctx || ctx.state === "closed") {
    throw new Error("Solo looper engine requires an open AudioContext.");
  }
  if (!ctx.audioWorklet || typeof ctx.audioWorklet.addModule !== "function") {
    throw new Error("AudioWorklet is not available in this browser.");
  }
}

function assertRawMicInput(inputStream: MediaStream, destinationNode: MediaStreamAudioDestinationNode): void {
  if (!inputStream || inputStream.getAudioTracks().length === 0) {
    throw new Error("Solo looper engine requires a raw mic stream with an audio track.");
  }
  if (inputStream === destinationNode.stream) {
    throw new Error("Solo looper input must be raw mic audio, not the master mix.");
  }
}

function clampGain(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(4, Math.max(0, value as number));
}

export async function ensureSoloLooperWorkletLoaded(ctx: AudioContext): Promise<void> {
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

export async function buildSoloLooperEngine(
  options: BuildSoloLooperEngineOptions
): Promise<SoloLooperEngine> {
  const ctx = options.audioContext;
  assertUsableAudioContext(ctx);
  assertRawMicInput(options.inputStream, options.destinationNode);
  await ensureSoloLooperWorkletLoaded(ctx);

  const channelCount = options.channelCount ?? 2;
  const sourceNode = ctx.createMediaStreamSource(options.inputStream);
  const inputGain = ctx.createGain();
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

  inputGain.gain.value = 1;
  outputGain.gain.value = clampGain(options.outputGain);
  if (monitorGainNode) {
    monitorGainNode.gain.value = clampGain(options.monitorGain);
  }

  workletNode.port.onmessage = (event: MessageEvent<SoloLooperEngineEvent>) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "LOOP_READY" || data.type === "LOOP_STATE") {
      options.onEvent?.(data);
    }
  };

  sourceNode.connect(inputGain);
  inputGain.connect(workletNode);
  workletNode.connect(outputGain);
  outputGain.connect(options.destinationNode);
  if (monitorGainNode && options.monitorDestination) {
    outputGain.connect(monitorGainNode);
    monitorGainNode.connect(options.monitorDestination);
  }

  workletNode.port.postMessage({
    type: "CONFIGURE_LOOP",
    loopId: options.loopId ?? null,
    intervalFrames: options.timing.localIntervalFrames,
    sampleRate: options.timing.localSampleRate,
    channelCount,
  });

  const engine: SoloLooperEngine = {
    workletNode,
    sourceNode,
    inputGain,
    outputGain,
    monitorGainNode,
    startRecording(): void {
      if (tornDown) return;
      workletNode.port.postMessage({ type: "START_RECORDING" });
    },
    stop(): void {
      if (tornDown) return;
      workletNode.port.postMessage({ type: "STOP_LOOP" });
    },
    reset(): void {
      if (tornDown) return;
      workletNode.port.postMessage({ type: "RESET_LOOP" });
    },
    teardown(): void {
      if (tornDown) return;
      tornDown = true;
      teardownSoloLooperEngine(engine);
    },
  };

  return engine;
}

export function teardownSoloLooperEngine(engine: SoloLooperEngine | null): void {
  if (!engine) return;

  engine.workletNode.port.onmessage = null;
  try {
    engine.workletNode.port.postMessage({ type: "RESET_LOOP" });
  } catch {
    /* ignore closed or detached ports */
  }
  try {
    engine.workletNode.port.close?.();
  } catch {
    /* ignore browsers with non-closeable or already-closed ports */
  }

  try {
    engine.sourceNode.disconnect();
  } catch {
    /* ignore */
  }
  try {
    engine.inputGain.disconnect();
  } catch {
    /* ignore */
  }
  try {
    engine.workletNode.disconnect();
  } catch {
    /* ignore */
  }
  try {
    engine.outputGain.disconnect();
  } catch {
    /* ignore */
  }
  try {
    engine.monitorGainNode?.disconnect();
  } catch {
    /* ignore */
  }
}
