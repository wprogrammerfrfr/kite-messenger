const WORKLET_URL = "/worklets/metronome-pump-processor.js";
const WORKLET_NAME = "metronome-pump-processor";

const moduleLoadPromises = new WeakMap<AudioContext, Promise<void>>();

export type MetronomePumpMessage = {
  type: "METRONOME_PUMP";
  currentTime: number;
  currentFrame: number;
};

export type MetronomePumpOptions = {
  pumpIntervalSec?: number;
};

export type MetronomePumpHandle = {
  start(onPump: (message: MetronomePumpMessage) => void): void;
  stop(): void;
  teardown(): void;
};

function assertUsableContext(ctx: AudioContext): void {
  if (!ctx || ctx.state === "closed") {
    throw new Error("Metronome pump requires an open AudioContext.");
  }
  if (!ctx.audioWorklet || typeof ctx.audioWorklet.addModule !== "function") {
    throw new Error("AudioWorklet is not available.");
  }
}

export async function ensureMetronomePumpWorkletLoaded(ctx: AudioContext): Promise<void> {
  assertUsableContext(ctx);
  const existing = moduleLoadPromises.get(ctx);
  if (existing) return existing;

  const loadPromise = ctx.audioWorklet.addModule(WORKLET_URL);
  moduleLoadPromises.set(ctx, loadPromise);
  try {
    await loadPromise;
  } catch (error) {
    moduleLoadPromises.delete(ctx);
    throw error;
  }
}

/**
 * Builds a zero-gain path to `destination` so the pump worklet is pulled by the audio engine.
 */
export async function createMetronomePump(
  audioContext: AudioContext,
  options?: MetronomePumpOptions
): Promise<MetronomePumpHandle> {
  await ensureMetronomePumpWorkletLoaded(audioContext);

  const pumpIntervalSec =
    typeof options?.pumpIntervalSec === "number" &&
    Number.isFinite(options.pumpIntervalSec) &&
    options.pumpIntervalSec > 0
      ? options.pumpIntervalSec
      : undefined;

  const workletNode = new AudioWorkletNode(audioContext, WORKLET_NAME, {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions:
      pumpIntervalSec !== undefined ? { pumpIntervalSec } : {},
  });

  const silentGain = audioContext.createGain();
  silentGain.gain.value = 0;
  workletNode.connect(silentGain);
  silentGain.connect(audioContext.destination);

  let tornDown = false;

  const handle: MetronomePumpHandle = {
    start(onPump) {
      if (tornDown) return;
      workletNode.port.onmessage = (event: MessageEvent<unknown>) => {
        const data = event.data;
        if (!data || typeof data !== "object") return;
        const msg = data as MetronomePumpMessage;
        if (msg.type === "METRONOME_PUMP") {
          onPump(msg);
        }
      };
      workletNode.port.postMessage({ type: "START" });
    },
    stop() {
      if (tornDown) return;
      try {
        workletNode.port.postMessage({ type: "STOP" });
      } catch {
        /* port may be closed */
      }
    },
    teardown() {
      if (tornDown) return;
      tornDown = true;
      try {
        workletNode.port.postMessage({ type: "STOP" });
      } catch {
        /* ignore */
      }
      workletNode.port.onmessage = null;
      try {
        workletNode.port.close?.();
      } catch {
        /* ignore */
      }
      try {
        workletNode.disconnect();
      } catch {
        /* ignore */
      }
      try {
        silentGain.disconnect();
      } catch {
        /* ignore */
      }
    },
  };

  return handle;
}
