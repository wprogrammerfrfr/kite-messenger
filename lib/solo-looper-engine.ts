import type { KiteIntervalTiming } from "@/lib/kite-interval-math";

const MIN_SOLO_TRACK_INDEX = 1;
const MAX_SOLO_TRACK_INDEX = 4;

export type SoloLooperReadyEvent = {
  type: "LOOP_READY";
  loopId: string | null;
  sampleRate: number;
  intervalFrames: number;
  channelCount: number;
  buffer: ArrayBuffer;
  /** Present when emitted by multitrack worklet (P5+). */
  trackIndex?: number;
};

export type SoloLooperStateEvent = {
  type: "LOOP_STATE";
  state: string;
  loopId: string | null;
  intervalFrames: number;
  channelCount: number;
  sampleRate: number;
  trackIndex?: number;
  maxRecordingFrames?: number;
};

export type SoloLooperConfigureClampedEvent = {
  type: "CONFIGURE_CLAMPED";
  trackIndex: number;
  requestedIntervalFrames: number;
  appliedIntervalFrames: number;
  maxRecordingFrames: number;
  sampleRate: number;
};

export type SoloLooperPlaybackUiStateEvent = {
  type: "PLAYBACK_UI_STATE";
  slots: readonly {
    trackIndex: number;
    mode: string;
    playbackCursor: number;
    intervalFrames: number;
    recordCursor: number;
    gain: number;
  }[];
};

export type SoloLooperOverdubArmedEvent = {
  type: "OVERDUB_ARMED";
  trackIndex: number;
  intervalFrames: number;
  channelCount: number;
  sampleRate: number;
};

export type SoloLooperOverdubArmRejectedEvent = {
  type: "OVERDUB_ARM_REJECTED";
  reason: string;
  trackIndex: number;
};

export type SoloLooperOverdubStartedEvent = {
  type: "OVERDUB_STARTED";
  trackIndex: number;
  sampleRate: number;
  currentTime: number;
  masterPlaybackCursor: number;
  framesRemaining: number;
};

export type SoloLooperOverdubDisarmedEvent = {
  type: "OVERDUB_DISARMED";
  trackIndex: number;
};

export type SoloLooperConfigureRejectedEvent = {
  type: "CONFIGURE_REJECTED";
  reason: string;
  trackIndex?: number;
  sampleRate?: number;
};

export type SoloLooperAutoStopCompletedEvent = {
  type: "AUTO_STOP_COMPLETED";
  trackIndex: number;
  loopId: string | null;
};

export type SoloLooperCalibrationResultEvent = {
  type: "CALIBRATION_RESULT";
  latencyFrames: number | null;
};

export type SoloLooperEngineEvent =
  | SoloLooperReadyEvent
  | SoloLooperStateEvent
  | SoloLooperConfigureClampedEvent
  | SoloLooperConfigureRejectedEvent
  | SoloLooperAutoStopCompletedEvent
  | SoloLooperCalibrationResultEvent
  | SoloLooperPlaybackUiStateEvent
  | SoloLooperOverdubArmedEvent
  | SoloLooperOverdubArmRejectedEvent
  | SoloLooperOverdubStartedEvent
  | SoloLooperOverdubDisarmedEvent;

export type BuildSoloLooperEngineOptions = {
  audioContext: AudioContext;
  inputStream: MediaStream;
  destinationNode: MediaStreamAudioDestinationNode;
  timing: Pick<KiteIntervalTiming, "localIntervalFrames" | "localSampleRate">;
  loopId?: string;
  channelCount?: 1 | 2;
  /** Target track 1–4 for initial `CONFIGURE_LOOP` (optional; worklet defaults active track). */
  trackIndex?: number;
  outputGain?: number;
  inputGain?: number;
  monitorDestination?: AudioNode;
  monitorGain?: number;
  /** Shared master metronome gain (headphone-only; never routes to recordingDestination). */
  metronomeGainNode?: GainNode | null;
  onEvent?: (event: SoloLooperEngineEvent) => void;
};

export type SoloLooperConfigureLoopParams = {
  intervalFrames: number;
  sampleRate?: number;
  channelCount?: 1 | 2;
  loopId?: string | null;
  /** 1–4; omit to let worklet use current active track. */
  trackIndex?: number;
};

export type SoloLooperArmOverdubParams = {
  trackIndex: 2 | 3 | 4;
  intervalFrames?: number;
  channelCount?: 1 | 2;
  loopId?: string | null;
  latencyOffsetFrames?: number;
};

export type SoloLooperStartRecordingParams = {
  loopMode?: "free" | "grid";
  targetLengthFrames?: number;
  latencyOffsetFrames?: number;
  /** AudioContext.currentTime at which the worklet should declare the recording downbeat. */
  recordStartContextSec?: number;
};

export type SoloLooperStopRecordingParams = {
  trackIndex?: number;
  bpm?: number;
  channelCount?: 1 | 2;
  loopId?: string | null;
  latencyOffsetFrames?: number;
  loopMode?: "free" | "grid";
};

export type SoloLooperEngine = {
  workletNode: AudioWorkletNode;
  sourceNode: MediaStreamAudioSourceNode;
  inputGain: GainNode;
  inputAnalyserNode: AnalyserNode;
  outputGain: GainNode;
  recordingDestination: MediaStreamAudioDestinationNode;
  /** Loop-station playback only (no raw mic tap) for session export. */
  stationMixDestination: MediaStreamAudioDestinationNode;
  recordingMicGainNode: GainNode;
  monitorGainNode: GainNode | null;
  getSessionRecordingStream(): MediaStream;
  getSessionStationMixStream(): MediaStream;
  /** Select active track (1–4) in the worklet; validates bounds. */
  selectTrack(trackIndex: number): void;
  /**
   * Post an updated `CONFIGURE_LOOP` with optional per-track targeting.
   *
   * @deprecated Do not use for pedal-up finalize. Use `stopRecording()` instead.
   * This is now for provision/init only.
   */
  configureLoop(params: SoloLooperConfigureLoopParams): void;
  /** V4.1: sample-accurate finalize while recording (worklet computes intervalFrames). */
  stopRecording(params: SoloLooperStopRecordingParams): void;
  /** Per-track wet gain (0–4) applied in the worklet summing bus. */
  setTrackGain(trackIndex: number, gain: number): void;
  /** Ask the worklet to post a `PLAYBACK_UI_STATE` snapshot (poll from rAF). */
  requestPlaybackUiState(): void;
  /** Freeze or resume all worklet transport without tearing down the node. */
  setPaused(paused: boolean): void;
  /** Reset one track; Track 1 reset cascades in the processor to avoid orphan overdubs. */
  resetTrack(trackIndex: number): void;
  /** Headphone-only click track for Track 1 recording; never routes to recordingDestination. */
  startAudibleMetronome(bpm: number, anchorSec?: number): void;
  stopAudibleMetronome(): void;
  /** Wire shared metronome volume GainNode for audible clicks during recording. */
  setMetronomeGainNode(node: GainNode | null): void;
  /** Arm overdub on track 2–4; downbeat start is worklet-owned. */
  armOverdub(params: SoloLooperArmOverdubParams): void;
  /** Disarm overdub; optional trackIndex must match armed track (worklet A4). */
  disarmOverdub(trackIndex?: 2 | 3 | 4): void;
  /** Trigger worklet latency auto-calibration (IR click + threshold detect). */
  startCalibration(): void;
  startRecording(params?: SoloLooperStartRecordingParams): void;
  stop(): void;
  reset(): void;
  teardown(): void;
};

const WORKLET_URL = "/worklets/solo-looper-processor.js";
const WORKLET_NAME = "solo-looper-processor";
const workletLoadPromises = new WeakMap<AudioContext, Promise<void>>();

function assertValidTrackIndex(trackIndex: number): void {
  if (
    !Number.isInteger(trackIndex) ||
    trackIndex < MIN_SOLO_TRACK_INDEX ||
    trackIndex > MAX_SOLO_TRACK_INDEX
  ) {
    throw new Error(
      `Solo looper track index must be an integer between ${MIN_SOLO_TRACK_INDEX} and ${MAX_SOLO_TRACK_INDEX}, got ${String(trackIndex)}.`
    );
  }
}

function assertOverdubTrackIndex(trackIndex: number): asserts trackIndex is 2 | 3 | 4 {
  assertValidTrackIndex(trackIndex);
  if (trackIndex < 2) {
    throw new Error(
      `Solo looper overdub track index must be 2, 3, or 4, got ${String(trackIndex)}.`
    );
  }
}

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

/** Prefer "discrete" so multi-channel interface inputs are not mixed down by speaker layouts before the worklet. */
function preserveDiscreteInputChannels(node: AudioNode): void {
  try {
    node.channelInterpretation = "discrete";
  } catch {
    /* older engines may omit channelInterpretation */
  }
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
  if (options.trackIndex !== undefined) {
    assertValidTrackIndex(options.trackIndex);
  }

  const sourceNode = ctx.createMediaStreamSource(options.inputStream);
  preserveDiscreteInputChannels(sourceNode);

  const inputGain = ctx.createGain();
  preserveDiscreteInputChannels(inputGain);

  const inputAnalyserNode = ctx.createAnalyser();
  inputAnalyserNode.fftSize = 256;

  const outputGain = ctx.createGain();
  const recordingDestination = ctx.createMediaStreamDestination();
  const stationMixDestination = ctx.createMediaStreamDestination();
  const recordingMicGainNode = ctx.createGain();
  preserveDiscreteInputChannels(recordingMicGainNode);
  const monitorGainNode = options.monitorDestination ? ctx.createGain() : null;
  const workletNode = new AudioWorkletNode(ctx, WORKLET_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [channelCount],
    processorOptions: {
      sampleRate: options.timing.localSampleRate,
    },
  });
  preserveDiscreteInputChannels(workletNode);

  let tornDown = false;
  let metronomeGainNodeRef: GainNode | null = options.metronomeGainNode ?? null;
  let metronomeTimer: ReturnType<typeof setTimeout> | null = null;
  let metronomeNextTickSec = 0;
  let metronomeBeatIndex = 0;
  const scheduledMetronomeNodes = new Set<AudioScheduledSourceNode>();

  inputGain.gain.value = clampGain(options.inputGain ?? 1);
  outputGain.gain.value = clampGain(options.outputGain);
  recordingMicGainNode.gain.value = 1;
  if (monitorGainNode) {
    monitorGainNode.gain.value = clampGain(options.monitorGain);
  }

  workletNode.port.onmessage = (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (!data || typeof data !== "object" || !("type" in data)) return;
    const msgType = (data as { type: string }).type;
    const allowlist = [
      "LOOP_READY",
      "LOOP_STATE",
      "CONFIGURE_CLAMPED",
      "CONFIGURE_REJECTED",
      "PLAYBACK_UI_STATE",
      "OVERDUB_ARMED",
      "OVERDUB_ARM_REJECTED",
      "OVERDUB_STARTED",
      "OVERDUB_DISARMED",
      "AUTO_STOP_COMPLETED",
      "CALIBRATION_RESULT",
    ] as const;
    if (allowlist.includes(msgType as (typeof allowlist)[number])) {
      options.onEvent?.(data as SoloLooperEngineEvent);
    }
  };

  sourceNode.connect(inputGain);
  inputGain.connect(inputAnalyserNode);
  inputAnalyserNode.connect(workletNode);
  workletNode.connect(outputGain);
  outputGain.connect(options.destinationNode);
  outputGain.connect(recordingDestination);
  outputGain.connect(stationMixDestination);
  // Split-Mix: raw mic is captured to tape only. Headphones receive loop/worklet output
  // through monitorDestination; direct hardware monitoring handles zero-latency live foldback.
  sourceNode.connect(recordingMicGainNode);
  recordingMicGainNode.connect(recordingDestination);
  if (monitorGainNode && options.monitorDestination) {
    outputGain.connect(monitorGainNode);
    monitorGainNode.connect(options.monitorDestination);
  }

  const postConfigureLoop = (params: {
    intervalFrames: number;
    sampleRate: number;
    ch: 1 | 2;
    loopId: string | null;
    trackIndex?: number;
  }): void => {
    workletNode.port.postMessage({
      type: "CONFIGURE_LOOP",
      loopId: params.loopId,
      intervalFrames: params.intervalFrames,
      sampleRate: params.sampleRate,
      channelCount: params.ch,
      ...(params.trackIndex !== undefined ? { trackIndex: params.trackIndex } : {}),
    });
  };

  postConfigureLoop({
    intervalFrames: options.timing.localIntervalFrames,
    sampleRate: options.timing.localSampleRate,
    ch: channelCount,
    loopId: options.loopId ?? null,
    ...(options.trackIndex !== undefined ? { trackIndex: options.trackIndex } : {}),
  });

  const stopAudibleMetronome = (): void => {
    if (metronomeTimer !== null) {
      clearTimeout(metronomeTimer);
      metronomeTimer = null;
    }
    for (const node of Array.from(scheduledMetronomeNodes)) {
      try {
        node.stop();
      } catch {
        /* already stopped */
      }
      try {
        node.disconnect();
      } catch {
        /* ignore */
      }
    }
    scheduledMetronomeNodes.clear();
    metronomeBeatIndex = 0;
  };

  const scheduleMetronomeTick = (atSec: number, isDownbeat: boolean): void => {
    if (ctx.state === "closed") return;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    scheduledMetronomeNodes.add(oscillator);

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(isDownbeat ? 1600 : 1050, atSec);
    gain.gain.setValueAtTime(0.0001, atSec);
    gain.gain.exponentialRampToValueAtTime(isDownbeat ? 0.11 : 0.07, atSec + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, atSec + 0.045);

    oscillator.connect(gain);
    // Headphone-only metronome: never connect this click branch to recordingDestination.
    gain.connect(metronomeGainNodeRef ?? ctx.destination);
    oscillator.start(atSec);
    oscillator.stop(atSec + 0.05);
    oscillator.onended = () => {
      scheduledMetronomeNodes.delete(oscillator);
      try {
        oscillator.disconnect();
        gain.disconnect();
      } catch {
        /* ignore */
      }
    };
  };

  const startAudibleMetronome = (bpm: number, anchorSec?: number): void => {
    stopAudibleMetronome();
    const normalizedBpm = Number.isFinite(bpm) ? Math.max(30, Math.min(300, bpm)) : 120;
    const beatSec = 60 / normalizedBpm;
    const lookaheadSec = 0.12;
    const scheduleEveryMs = 25;
    const anchor =
      anchorSec !== undefined && Number.isFinite(anchorSec) && anchorSec >= ctx.currentTime
        ? anchorSec
        : null;
    metronomeNextTickSec = anchor !== null ? anchor : Math.max(ctx.currentTime + 0.01, ctx.currentTime);
    metronomeBeatIndex = 0;

    const pump = (): void => {
      if (tornDown || ctx.state === "closed") {
        stopAudibleMetronome();
        return;
      }
      const horizon = ctx.currentTime + lookaheadSec;
      while (metronomeNextTickSec <= horizon) {
        scheduleMetronomeTick(metronomeNextTickSec, metronomeBeatIndex % 4 === 0);
        metronomeNextTickSec += beatSec;
        metronomeBeatIndex += 1;
      }
      metronomeTimer = setTimeout(pump, scheduleEveryMs);
    };

    pump();
  };

  const engine: SoloLooperEngine = {
    workletNode,
    sourceNode,
    inputGain,
    inputAnalyserNode,
    outputGain,
    recordingDestination,
    stationMixDestination,
    recordingMicGainNode,
    monitorGainNode,
    getSessionRecordingStream(): MediaStream {
      return recordingDestination.stream;
    },
    getSessionStationMixStream(): MediaStream {
      return stationMixDestination.stream;
    },
    selectTrack(trackIndex: number): void {
      if (tornDown) return;
      assertValidTrackIndex(trackIndex);
      workletNode.port.postMessage({ type: "SELECT_TRACK", trackIndex });
    },
    /**
     * @deprecated Do not use for pedal-up finalize. Use `stopRecording()` instead.
     * This is now for provision/init only.
     */
    configureLoop(params: SoloLooperConfigureLoopParams): void {
      if (tornDown) return;
      if (params.trackIndex !== undefined) {
        assertValidTrackIndex(params.trackIndex);
      }
      const ch = params.channelCount ?? channelCount;
      postConfigureLoop({
        intervalFrames: params.intervalFrames,
        sampleRate: params.sampleRate ?? ctx.sampleRate,
        ch,
        loopId: params.loopId !== undefined ? params.loopId : null,
        ...(params.trackIndex !== undefined ? { trackIndex: params.trackIndex } : {}),
      });
    },
    stopRecording(params: SoloLooperStopRecordingParams): void {
      if (tornDown) return;
      if (params.trackIndex !== undefined) {
        assertValidTrackIndex(params.trackIndex);
      }
      workletNode.port.postMessage({
        type: "STOP_RECORDING",
        ...(params.trackIndex !== undefined ? { trackIndex: params.trackIndex } : {}),
        ...(params.bpm !== undefined ? { bpm: params.bpm } : {}),
        ...(params.channelCount !== undefined ? { channelCount: params.channelCount } : {}),
        ...(params.loopId !== undefined ? { loopId: params.loopId } : {}),
        ...(params.latencyOffsetFrames !== undefined
          ? { latencyOffsetFrames: params.latencyOffsetFrames }
          : {}),
        ...(params.loopMode !== undefined ? { loopMode: params.loopMode } : {}),
      });
    },
    setTrackGain(trackIndex: number, linearGain: number): void {
      if (tornDown) return;
      assertValidTrackIndex(trackIndex);
      const g = Number.isFinite(linearGain) ? Math.max(0, Math.min(4, linearGain)) : 1;
      workletNode.port.postMessage({ type: "SET_TRACK_GAIN", trackIndex, gain: g });
    },
    requestPlaybackUiState(): void {
      if (tornDown) return;
      workletNode.port.postMessage({ type: "REQUEST_PLAYBACK_UI_STATE" });
    },
    setPaused(paused: boolean): void {
      if (tornDown) return;
      workletNode.port.postMessage({ type: "SET_PAUSED", paused });
    },
    resetTrack(trackIndex: number): void {
      if (tornDown) return;
      assertValidTrackIndex(trackIndex);
      workletNode.port.postMessage({ type: "RESET_TRACK", trackIndex });
    },
    startAudibleMetronome(bpm: number, anchorSec?: number): void {
      if (tornDown) return;
      startAudibleMetronome(bpm, anchorSec);
    },
    stopAudibleMetronome(): void {
      stopAudibleMetronome();
    },
    setMetronomeGainNode(node: GainNode | null): void {
      metronomeGainNodeRef = node;
    },
    armOverdub(params: SoloLooperArmOverdubParams): void {
      if (tornDown) return;
      assertOverdubTrackIndex(params.trackIndex);
      workletNode.port.postMessage({
        type: "ARM_OVERDUB",
        trackIndex: params.trackIndex,
        ...(params.intervalFrames !== undefined
          ? { intervalFrames: params.intervalFrames }
          : {}),
        ...(params.channelCount !== undefined ? { channelCount: params.channelCount } : {}),
        ...(params.loopId !== undefined ? { loopId: params.loopId } : {}),
        ...(params.latencyOffsetFrames !== undefined
          ? { latencyOffsetFrames: params.latencyOffsetFrames }
          : {}),
      });
    },
    disarmOverdub(trackIndex?: 2 | 3 | 4): void {
      if (tornDown) return;
      if (trackIndex !== undefined) {
        assertOverdubTrackIndex(trackIndex);
      }
      workletNode.port.postMessage({
        type: "DISARM_OVERDUB",
        ...(trackIndex !== undefined ? { trackIndex } : {}),
      });
    },
    startCalibration(): void {
      if (tornDown) return;
      workletNode.port.postMessage({ type: "START_CALIBRATION" });
    },
    startRecording(params?: SoloLooperStartRecordingParams): void {
      if (tornDown) return;
      workletNode.port.postMessage({
        type: "START_RECORDING",
        ...(params?.loopMode !== undefined ? { loopMode: params.loopMode } : {}),
        ...(params?.targetLengthFrames !== undefined
          ? { targetLengthFrames: params.targetLengthFrames }
          : {}),
        ...(params?.latencyOffsetFrames !== undefined
          ? { latencyOffsetFrames: params.latencyOffsetFrames }
          : {}),
        ...(params?.recordStartContextSec !== undefined
          ? { recordStartContextSec: params.recordStartContextSec }
          : {}),
      });
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
      stopAudibleMetronome();
      teardownSoloLooperEngine(engine);
    },
  };

  return engine;
}

export function teardownSoloLooperEngine(engine: SoloLooperEngine | null): void {
  if (!engine) return;

  engine.stopAudibleMetronome();
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
    engine.recordingMicGainNode.disconnect();
  } catch {
    /* ignore */
  }
  try {
    engine.recordingDestination.disconnect();
  } catch {
    /* ignore */
  }
  try {
    engine.stationMixDestination.disconnect();
  } catch {
    /* ignore */
  }
  try {
    engine.monitorGainNode?.disconnect();
  } catch {
    /* ignore */
  }
}
