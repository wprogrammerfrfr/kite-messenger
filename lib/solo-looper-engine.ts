import type { KiteIntervalTiming } from "@/lib/kite-interval-math";
import {
  createMetronomePump,
  type MetronomePumpHandle,
} from "@/lib/studio-metronome-pump";

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

export type SoloLooperGuidedCalStateEvent = {
  type: "GUIDED_CAL_STATE";
  phase: "idle" | "armed" | "counting" | "capturing" | "previewing" | "error";
  active: boolean;
  captureCursor: number;
  captureTargetFrames: number;
  intervalFrames: number;
  previewOffsetFrames: number;
  countInFrames?: number;
  countInCursor?: number;
  beatFrames?: number;
  /** 4…1 during count-in; null otherwise. */
  countdownBeatRemaining?: number | null;
  /** 0…1 while capturing. */
  captureProgress01?: number;
  /** 1…4 while capturing. */
  captureBeatIndex?: number | null;
  error?: string;
};

export type SoloLooperGuidedCalCaptureCompleteEvent = {
  type: "GUIDED_CAL_CAPTURE_COMPLETE";
  intervalFrames: number;
  sampleRate: number;
};

export type SoloLooperHandsfreeTrackAdvancedEvent = {
  type: "HANDSFREE_TRACK_ADVANCED";
  fromTrack: number;
  toTrack: number;
  sampleRate: number;
};

export type SoloLooperHandsfreeAdvanceArmedEvent = {
  type: "HANDSFREE_ADVANCE_ARMED";
  fromTrack: number;
  toTrack: number;
  sampleRate: number;
};

export type SoloLooperHandsfreeCountdownReadyEvent = {
  type: "HANDSFREE_COUNTDOWN_READY";
  fromTrack: number;
  toTrack: number;
  sampleRate: number;
};

export type SoloLooperHandsfreeSequenceCompleteEvent = {
  type: "HANDSFREE_SEQUENCE_COMPLETE";
  trackIndex: 4;
  loopId: string | null;
};

export type SoloLooperEngineEvent =
  | SoloLooperReadyEvent
  | SoloLooperStateEvent
  | SoloLooperConfigureClampedEvent
  | SoloLooperConfigureRejectedEvent
  | SoloLooperAutoStopCompletedEvent
  | SoloLooperGuidedCalStateEvent
  | SoloLooperGuidedCalCaptureCompleteEvent
  | SoloLooperHandsfreeTrackAdvancedEvent
  | SoloLooperHandsfreeAdvanceArmedEvent
  | SoloLooperHandsfreeCountdownReadyEvent
  | SoloLooperHandsfreeSequenceCompleteEvent
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
  loopMode?: "free" | "grid" | "handsfree";
  targetLengthFrames?: number;
  latencyOffsetFrames?: number;
  /** AudioContext.currentTime at which the worklet should declare the recording downbeat. */
  recordStartContextSec?: number;
  /** Handsfree: per-track frame targets [T1, T2, T3, T4] set before sequence starts. */
  handsfreeTrackTargets?: readonly [number, number, number, number];
  /** Handsfree: true = one-loop gap between takes; false = immediate handoff. */
  handsfreeAssist?: boolean;
  /** Handsfree: true = 3-2-1-GO before each next-track handoff when Handsfree Assist is on. */
  timingAssist?: boolean;
};

export type SoloLooperSetTrackTargetLengthParams = {
  trackIndex: number;
  targetLengthFrames: number;
};

export type SoloLooperStopRecordingParams = {
  trackIndex?: number;
  bpm?: number;
  channelCount?: 1 | 2;
  loopId?: string | null;
  latencyOffsetFrames?: number;
  loopMode?: "free" | "grid" | "handsfree";
  /** AudioContext.currentTime stamped at pedal-up; worklet finalizes at this audio frame (Free Mode). */
  stopAtContextSec?: number;
};

export type SoloLooperEngine = {
  workletNode: AudioWorkletNode;
  sourceNode: MediaStreamAudioSourceNode;
  inputGain: GainNode;
  inputAnalyserNode: AnalyserNode;
  /** Post-worklet master loop bus; does not affect raw mic tap. */
  outputGain: GainNode;
  recordingPlaybackDelayNode: DelayNode;
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
  /** Master loop playback volume (0–1) on the post-worklet output bus. */
  setMasterLoopVolume(linearGain: number): void;
  /** Store per-track grid/handsfree target frames (no buffer allocation). */
  setTrackTargetLength(trackIndex: number, targetLengthFrames: number): void;
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
  /** Handsfree timing assist: begin next track after main-thread 3-2-1-GO completes. */
  confirmHandsfreeCountdown(): void;
  /**
   * Guided wizard: allocate a transport-neutral clap buffer for `targetFrames`.
   * Optional `countInFrames` arms a 4-beat countdown before capture writes begin.
   * Does not touch track slots, transport, or P2P graphs.
   */
  beginGuidedCalibration(targetFrames: number, countInFrames?: number): void;
  /** Guided wizard: start capturing mic into the clap buffer. */
  startGuidedCalCapture(): void;
  /** Guided wizard: finish capture early and enter preview loop (or auto-finishes at target). */
  finishGuidedCalCapture(): void;
  /**
   * Guided wizard: live preview RTL offset in ms (0–400).
   * Posts frame offset to worklet dual-head crossfade — no node teardown.
   */
  setGuidedCalPreviewOffsetMs(latencyMs: number): void;
  /** Guided wizard: discard clap buffer and reset guided state. */
  cancelGuidedCalibration(): void;
  startRecording(params?: SoloLooperStartRecordingParams): void;
  stop(): void;
  reset(): void;
  /** Current MediaStream feeding the capture source node. */
  getCaptureStream(): MediaStream;
  /**
   * Hot-swap the capture MediaStream without tearing down worklet/loop state.
   * Rejects while a recording or armed overdub is in progress.
   * Returns true if the source was replaced.
   */
  replaceCaptureStream(nextStream: MediaStream): boolean;
  /** Delay loop playback on the session recording bus only (aligns with finalize-shifted buffers). */
  setRecordingLatencyCompensation(latencyMs: number): void;
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

const RECORDING_PLAYBACK_DELAY_MAX_SEC = 2.0;
const RECORDING_LATENCY_COMPENSATION_MAX_SEC = 1.5;
/** Matches solo-latency-persistence applied max; guided preview never exceeds this. */
const GUIDED_CAL_PREVIEW_MAX_MS = 400;

function clampRecordingLatencyDelaySec(latencyMs: number): number {
  if (!Number.isFinite(latencyMs)) return 0;
  const sec = Math.max(0, latencyMs) / 1000;
  return Math.min(RECORDING_LATENCY_COMPENSATION_MAX_SEC, sec);
}

function clampGuidedCalPreviewMs(latencyMs: number): number {
  if (!Number.isFinite(latencyMs)) return 0;
  return Math.max(0, Math.min(GUIDED_CAL_PREVIEW_MAX_MS, Math.round(latencyMs)));
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

  let sourceNode = ctx.createMediaStreamSource(options.inputStream);
  preserveDiscreteInputChannels(sourceNode);
  let currentCaptureStream = options.inputStream;
  let captureReplaceBlocked = false;

  const inputGain = ctx.createGain();
  preserveDiscreteInputChannels(inputGain);

  const inputAnalyserNode = ctx.createAnalyser();
  inputAnalyserNode.fftSize = 256;

  const outputGain = ctx.createGain();
  const recordingPlaybackDelayNode = ctx.createDelay(RECORDING_PLAYBACK_DELAY_MAX_SEC);
  recordingPlaybackDelayNode.delayTime.value = 0;
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
  let metronomePump: MetronomePumpHandle | null = null;
  let metronomePumpGeneration = 0;
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
      "GUIDED_CAL_STATE",
      "GUIDED_CAL_CAPTURE_COMPLETE",
      "HANDSFREE_TRACK_ADVANCED",
      "HANDSFREE_ADVANCE_ARMED",
      "HANDSFREE_COUNTDOWN_READY",
      "HANDSFREE_SEQUENCE_COMPLETE",
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
  outputGain.connect(recordingPlaybackDelayNode);
  recordingPlaybackDelayNode.connect(recordingDestination);
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
    metronomePumpGeneration += 1;
    if (metronomePump !== null) {
      metronomePump.teardown();
      metronomePump = null;
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
    const anchor =
      anchorSec !== undefined && Number.isFinite(anchorSec) && anchorSec >= ctx.currentTime
        ? anchorSec
        : null;
    metronomeNextTickSec = anchor !== null ? anchor : Math.max(ctx.currentTime + 0.01, ctx.currentTime);
    metronomeBeatIndex = 0;

    const gen = metronomePumpGeneration;
    void (async () => {
      try {
        const pump = await createMetronomePump(ctx, { pumpIntervalSec: 0.025 });
        if (tornDown || ctx.state === "closed" || gen !== metronomePumpGeneration) {
          pump.teardown();
          return;
        }
        metronomePump = pump;
        pump.start(() => {
          if (tornDown || ctx.state === "closed" || gen !== metronomePumpGeneration) {
            stopAudibleMetronome();
            return;
          }
          const horizon = ctx.currentTime + lookaheadSec;
          while (metronomeNextTickSec <= horizon) {
            scheduleMetronomeTick(metronomeNextTickSec, metronomeBeatIndex % 4 === 0);
            metronomeNextTickSec += beatSec;
            metronomeBeatIndex += 1;
          }
        });
      } catch {
        /* pump creation failed — metronome stays silent */
      }
    })();
  };

  const engine: SoloLooperEngine = {
    workletNode,
    sourceNode,
    inputGain,
    inputAnalyserNode,
    outputGain,
    recordingPlaybackDelayNode,
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
      captureReplaceBlocked = false;
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
        ...(params.stopAtContextSec !== undefined
          ? { stopAtContextSec: params.stopAtContextSec }
          : {}),
      });
    },
    setTrackGain(trackIndex: number, linearGain: number): void {
      if (tornDown) return;
      assertValidTrackIndex(trackIndex);
      const g = Number.isFinite(linearGain) ? Math.max(0, Math.min(4, linearGain)) : 1;
      workletNode.port.postMessage({ type: "SET_TRACK_GAIN", trackIndex, gain: g });
    },
    setMasterLoopVolume(linearGain: number): void {
      if (tornDown || ctx.state === "closed") return;
      const clamped = Number.isFinite(linearGain) ? Math.max(0, Math.min(1, linearGain)) : 1;
      try {
        outputGain.gain.cancelScheduledValues(ctx.currentTime);
        outputGain.gain.setTargetAtTime(clamped, ctx.currentTime, 0.01);
      } catch {
        /* ignore */
      }
    },
    setTrackTargetLength(trackIndex: number, targetLengthFrames: number): void {
      if (tornDown) return;
      assertValidTrackIndex(trackIndex);
      const frames = Math.floor(Number(targetLengthFrames));
      if (!Number.isFinite(frames) || frames <= 0) return;
      workletNode.port.postMessage({
        type: "SET_TRACK_TARGET_LENGTH",
        trackIndex,
        targetLengthFrames: frames,
      });
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
      captureReplaceBlocked = true;
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
      captureReplaceBlocked = false;
      workletNode.port.postMessage({
        type: "DISARM_OVERDUB",
        ...(trackIndex !== undefined ? { trackIndex } : {}),
      });
    },
    confirmHandsfreeCountdown(): void {
      if (tornDown) return;
      workletNode.port.postMessage({ type: "CONFIRM_HANDSFREE_COUNTDOWN" });
    },
    beginGuidedCalibration(targetFrames: number, countInFrames?: number): void {
      if (tornDown) return;
      const frames = Math.floor(Number(targetFrames));
      if (!Number.isFinite(frames) || frames < 1) return;
      const countIn = Math.floor(Number(countInFrames));
      workletNode.port.postMessage({
        type: "BEGIN_GUIDED_CALIBRATION",
        targetFrames: frames,
        ...(Number.isFinite(countIn) && countIn > 0 ? { countInFrames: countIn } : {}),
      });
    },
    startGuidedCalCapture(): void {
      if (tornDown) return;
      workletNode.port.postMessage({ type: "START_GUIDED_CAL_CAPTURE" });
    },
    finishGuidedCalCapture(): void {
      if (tornDown) return;
      workletNode.port.postMessage({ type: "FINISH_GUIDED_CAL_CAPTURE" });
    },
    setGuidedCalPreviewOffsetMs(latencyMs: number): void {
      if (tornDown || ctx.state === "closed") return;
      const clampedMs = clampGuidedCalPreviewMs(latencyMs);
      const sampleRate = Number.isFinite(ctx.sampleRate) && ctx.sampleRate > 0 ? ctx.sampleRate : 48000;
      const latencyOffsetFrames = Math.max(
        0,
        Math.round((clampedMs / 1000) * sampleRate)
      );
      workletNode.port.postMessage({
        type: "SET_GUIDED_CAL_PREVIEW_OFFSET",
        latencyOffsetFrames,
      });
    },
    cancelGuidedCalibration(): void {
      if (tornDown) return;
      workletNode.port.postMessage({ type: "CANCEL_GUIDED_CALIBRATION" });
    },
    startRecording(params?: SoloLooperStartRecordingParams): void {
      if (tornDown) return;
      captureReplaceBlocked = true;
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
        ...(params?.handsfreeTrackTargets !== undefined
          ? { handsfreeTrackTargets: params.handsfreeTrackTargets }
          : {}),
        ...(params?.handsfreeAssist !== undefined
          ? { handsfreeAssist: params.handsfreeAssist }
          : {}),
        ...(params?.timingAssist !== undefined
          ? { timingAssist: params.timingAssist }
          : {}),
      });
    },
    stop(): void {
      if (tornDown) return;
      captureReplaceBlocked = false;
      workletNode.port.postMessage({ type: "STOP_LOOP" });
    },
    reset(): void {
      if (tornDown) return;
      captureReplaceBlocked = false;
      workletNode.port.postMessage({ type: "RESET_LOOP" });
    },
    getCaptureStream(): MediaStream {
      return currentCaptureStream;
    },
    replaceCaptureStream(nextStream: MediaStream): boolean {
      if (tornDown || ctx.state === "closed") return false;
      if (captureReplaceBlocked) {
        console.warn("[SoloLooper] replaceCaptureStream rejected while recording/armed.");
        return false;
      }
      assertRawMicInput(nextStream, options.destinationNode);
      if (nextStream === currentCaptureStream) return false;

      const nextSource = ctx.createMediaStreamSource(nextStream);
      preserveDiscreteInputChannels(nextSource);

      try {
        sourceNode.disconnect();
      } catch {
        /* ignore */
      }

      sourceNode = nextSource;
      currentCaptureStream = nextStream;
      engine.sourceNode = nextSource;

      nextSource.connect(inputGain);
      nextSource.connect(recordingMicGainNode);
      return true;
    },
    setRecordingLatencyCompensation(latencyMs: number): void {
      if (tornDown || ctx.state === "closed") return;
      const nextSec = clampRecordingLatencyDelaySec(latencyMs);
      try {
        recordingPlaybackDelayNode.delayTime.cancelScheduledValues(ctx.currentTime);
        recordingPlaybackDelayNode.delayTime.setTargetAtTime(nextSec, ctx.currentTime, 0.01);
      } catch {
        recordingPlaybackDelayNode.delayTime.value = nextSec;
      }
    },
    teardown(): void {
      if (tornDown) return;
      tornDown = true;
      captureReplaceBlocked = false;
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
    engine.recordingPlaybackDelayNode.disconnect();
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
