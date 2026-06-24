"use client";

import { useCallback, useRef, type MutableRefObject, type RefObject } from "react";
import { KITE_TARGET_SAMPLE_RATE } from "@/lib/kite-interval-math";

/** Studio playback context: prefer 48 kHz + low latency; fall back if options unsupported. */
export function createStudioAudioContext(): AudioContext {
  let ctx: AudioContext;
  try {
    ctx = new AudioContext({
      sampleRate: KITE_TARGET_SAMPLE_RATE,
      latencyHint: "interactive",
    });
  } catch {
    try {
      ctx = new AudioContext({ latencyHint: "interactive" });
    } catch {
      ctx = new AudioContext();
    }
  }
  if (Math.round(ctx.sampleRate) !== KITE_TARGET_SAMPLE_RATE) {
    console.warn(
      `[Studio] AudioContext.sampleRate is ${ctx.sampleRate} Hz (target ${KITE_TARGET_SAMPLE_RATE}). Kite paths require matching timing.sampleRate.`
    );
  }
  return ctx;
}

export type KillSwitchOpts = {
  micStream?: MediaStream | null;
  localStreamRef?: MutableRefObject<MediaStream | null>;
  localMicStreamRef?: MutableRefObject<MediaStream | null>;
  remoteStreamRef?: MutableRefObject<MediaStream | null>;
  voipOutgoingDestinationRef?: RefObject<MediaStreamAudioDestinationNode | null>;
  localMonitorAudioRef?: RefObject<HTMLAudioElement | null>;
  remoteAudioRef?: RefObject<HTMLAudioElement | null>;
};

export type UseKiteStudioHostConfig = {
  onAudioContextReadyChange: (ready: boolean) => void;
  loadWorkletRef: RefObject<(ctx: AudioContext) => Promise<void>>;
  resetWorkletRef: RefObject<() => void>;
  activeDeviceIdsRef: RefObject<string[]>;
  localMicStreamRef: RefObject<MediaStream | null>;
};

export type KiteStudioHostApi = {
  studioAudioContextRef: RefObject<AudioContext | null>;
  ensureContext: () => AudioContext;
  getContext: () => AudioContext | null;
  getSampleRate: () => number;
  closeContext: () => Promise<void>;
  audioBaseLatencySecRef: RefObject<number>;
  audioOutputLatencySecRef: RefObject<number>;
  ensureMasterDestination: () => MediaStreamAudioDestinationNode | null;
  teardownMasterDestination: () => void;
  mixerMasterDestinationRef: RefObject<MediaStreamAudioDestinationNode | null>;
  mixerMasterStreamRef: RefObject<MediaStream | null>;
  mixerKiteTapDestinationRef: RefObject<MediaStreamAudioDestinationNode | null>;
  mixerKiteTapStreamRef: RefObject<MediaStream | null>;
  activeStreamsMapRef: RefObject<Map<string, MediaStream>>;
  resolveSoloLooperInputStream: (
    destinationNode: MediaStreamAudioDestinationNode
  ) => { inputStream: MediaStream | null; masterStream: MediaStream };
  mutedVoipCloneTrackRef: RefObject<MediaStreamTrack | null>;
  originalVoipSenderTrackRef: RefObject<MediaStreamTrack | null>;
  voipSenderMutedForKiteRef: RefObject<boolean>;
  runSynchronousHardwareKillSwitch: (opts?: KillSwitchOpts) => void;
  hardwareKillSwitchActiveRef: RefObject<boolean>;
  ensureStudioAudioContextRef: RefObject<() => AudioContext>;
  ensureMasterDestinationNodeRef: RefObject<() => MediaStreamAudioDestinationNode | null>;
};

export function useKiteStudioHost(config: UseKiteStudioHostConfig): KiteStudioHostApi {
  const configRef = useRef(config);
  configRef.current = config;

  const studioAudioContextRef = useRef<AudioContext | null>(null);
  const audioBaseLatencySecRef = useRef(0);
  const audioOutputLatencySecRef = useRef(0);
  const hardwareKillSwitchActiveRef = useRef(false);
  const contextLatencyStateHandlerRef = useRef<(() => void) | null>(null);

  const mixerMasterDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mixerMasterStreamRef = useRef<MediaStream | null>(null);
  const mixerKiteTapDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mixerKiteTapStreamRef = useRef<MediaStream | null>(null);

  const activeStreamsMapRef = useRef<Map<string, MediaStream>>(new Map());
  const originalVoipSenderTrackRef = useRef<MediaStreamTrack | null>(null);
  const mutedVoipCloneTrackRef = useRef<MediaStreamTrack | null>(null);
  const voipSenderMutedForKiteRef = useRef(false);

  const ensureStudioAudioContextRef = useRef<() => AudioContext>(() => {
    throw new Error("ensureStudioAudioContext not wired");
  });
  const ensureMasterDestinationNodeRef = useRef<() => MediaStreamAudioDestinationNode | null>(
    () => null
  );

  const getContext = useCallback((): AudioContext | null => {
    const ctx = studioAudioContextRef.current;
    if (ctx?.state === "closed") return null;
    return ctx;
  }, []);

  const getSampleRate = useCallback((): number => {
    const ctx = studioAudioContextRef.current;
    if (ctx && ctx.state !== "closed") {
      return Math.round(ctx.sampleRate);
    }
    return KITE_TARGET_SAMPLE_RATE;
  }, []);

  const ensureContext = useCallback((): AudioContext => {
    if (hardwareKillSwitchActiveRef.current) {
      const existing = studioAudioContextRef.current;
      if (existing && existing.state !== "closed") {
        return existing;
      }
      console.warn("[StudioHost] ensureContext blocked: hardware kill-switch active");
      throw new Error("AudioContext unavailable during teardown");
    }

    const cfg = configRef.current;
    let ctx = studioAudioContextRef.current;
    if (ctx?.state === "closed") {
      studioAudioContextRef.current = null;
      cfg.resetWorkletRef.current?.();
      ctx = null;
      cfg.onAudioContextReadyChange(false);
    }
    if (!ctx) {
      ctx = createStudioAudioContext();
      studioAudioContextRef.current = ctx;
      audioBaseLatencySecRef.current = Number.isFinite(ctx.baseLatency) ? ctx.baseLatency : 0;
      audioOutputLatencySecRef.current = Number.isFinite(ctx.outputLatency)
        ? ctx.outputLatency
        : 0;
      console.log(
        `[HAL] base=${audioBaseLatencySecRef.current} output=${audioOutputLatencySecRef.current}`
      );

      const onContextStateChange = (): void => {
        if (hardwareKillSwitchActiveRef.current) {
          return;
        }
        const activeCtx = studioAudioContextRef.current;
        if (!activeCtx || activeCtx.state === "closed") {
          if (activeCtx && contextLatencyStateHandlerRef.current) {
            activeCtx.removeEventListener("statechange", onContextStateChange);
          }
          contextLatencyStateHandlerRef.current = null;
          return;
        }
        if (activeCtx.state !== "running") {
          return;
        }
        audioBaseLatencySecRef.current = Number.isFinite(activeCtx.baseLatency)
          ? activeCtx.baseLatency
          : 0;
        audioOutputLatencySecRef.current = Number.isFinite(activeCtx.outputLatency)
          ? activeCtx.outputLatency
          : 0;
        console.log(
          `[HAL] base=${audioBaseLatencySecRef.current} output=${audioOutputLatencySecRef.current} (post-resume)`
        );
        activeCtx.removeEventListener("statechange", onContextStateChange);
        contextLatencyStateHandlerRef.current = null;
      };

      contextLatencyStateHandlerRef.current = onContextStateChange;
      ctx.addEventListener("statechange", onContextStateChange);
      if (ctx.state === "running") {
        onContextStateChange();
      }

      cfg.resetWorkletRef.current?.();
      void cfg.loadWorkletRef.current?.(ctx);
      return ctx;
    }
    void cfg.loadWorkletRef.current?.(ctx);
    return ctx;
  }, []);

  const closeContext = useCallback(async (): Promise<void> => {
    const ctx = studioAudioContextRef.current;
    const latencyHandler = contextLatencyStateHandlerRef.current;
    if (ctx && latencyHandler) {
      try {
        ctx.removeEventListener("statechange", latencyHandler);
      } catch {
        /* ignore */
      }
      contextLatencyStateHandlerRef.current = null;
    }
    if (ctx && ctx.state !== "closed") {
      await ctx.close().catch(() => {});
    }
    studioAudioContextRef.current = null;
    configRef.current.onAudioContextReadyChange(false);
  }, []);

  const teardownMasterDestination = useCallback((): void => {
    try {
      mixerMasterDestinationRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      mixerKiteTapDestinationRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    mixerMasterDestinationRef.current = null;
    mixerMasterStreamRef.current = null;
    mixerKiteTapDestinationRef.current = null;
    mixerKiteTapStreamRef.current = null;
  }, []);

  const ensureMasterDestination = useCallback((): MediaStreamAudioDestinationNode | null => {
    const ctx = studioAudioContextRef.current;
    if (!ctx || ctx.state === "closed") return null;

    let destinationNode = mixerMasterDestinationRef.current;
    if (!destinationNode) {
      destinationNode = ctx.createMediaStreamDestination();
      mixerMasterDestinationRef.current = destinationNode;
      mixerMasterStreamRef.current = destinationNode.stream;
    } else if (!mixerMasterStreamRef.current) {
      mixerMasterStreamRef.current = destinationNode.stream;
    }

    let kiteTapNode = mixerKiteTapDestinationRef.current;
    if (!kiteTapNode) {
      kiteTapNode = ctx.createMediaStreamDestination();
      mixerKiteTapDestinationRef.current = kiteTapNode;
      mixerKiteTapStreamRef.current = kiteTapNode.stream;
    } else if (!mixerKiteTapStreamRef.current) {
      mixerKiteTapStreamRef.current = kiteTapNode.stream;
    }

    return destinationNode;
  }, []);

  const resolveSoloLooperInputStream = useCallback(
    (
      destinationNode: MediaStreamAudioDestinationNode
    ): { inputStream: MediaStream | null; masterStream: MediaStream } => {
      const cfg = configRef.current;
      const masterStream = mixerMasterDestinationRef.current?.stream ?? destinationNode.stream;
      let inputStream: MediaStream | null = null;
      for (const deviceId of cfg.activeDeviceIdsRef.current ?? []) {
        const stream = activeStreamsMapRef.current.get(deviceId) ?? null;
        const hasLiveAudioTrack = stream
          ? stream.getAudioTracks().some((track) => track.readyState === "live")
          : false;
        if (hasLiveAudioTrack) {
          inputStream = stream;
          break;
        }
      }
      if (!inputStream) {
        const fallbackMic = cfg.localMicStreamRef.current;
        const fallbackOk =
          fallbackMic &&
          fallbackMic !== masterStream &&
          fallbackMic !== destinationNode.stream &&
          fallbackMic.getAudioTracks().some((track) => track.readyState === "live");
        inputStream = fallbackOk ? fallbackMic : null;
      }
      return { inputStream, masterStream };
    },
    []
  );

  const runSynchronousHardwareKillSwitch = useCallback((opts: KillSwitchOpts = {}): void => {
    hardwareKillSwitchActiveRef.current = true;

    const stopTrackSafe = (track: MediaStreamTrack | null | undefined) => {
      if (!track || track.readyState === "ended") return;
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    };
    const stopStreamTracksSafe = (stream: MediaStream | null | undefined) => {
      stream?.getTracks().forEach(stopTrackSafe);
    };

    try {
      stopTrackSafe(mutedVoipCloneTrackRef.current);
      mutedVoipCloneTrackRef.current = null;
      stopTrackSafe(originalVoipSenderTrackRef.current);
      originalVoipSenderTrackRef.current = null;
      voipSenderMutedForKiteRef.current = false;

      for (const [, stream] of Array.from(activeStreamsMapRef.current.entries())) {
        stopStreamTracksSafe(stream);
      }
      activeStreamsMapRef.current.clear();

      if (opts.localMicStreamRef?.current !== undefined) {
        stopStreamTracksSafe(opts.localMicStreamRef.current);
        opts.localMicStreamRef.current = null;
      }
      if (opts.localStreamRef?.current !== undefined) {
        stopStreamTracksSafe(opts.localStreamRef.current);
        opts.localStreamRef.current = null;
      }
      stopStreamTracksSafe(opts.micStream ?? null);

      stopStreamTracksSafe(opts.voipOutgoingDestinationRef?.current?.stream ?? null);
      stopStreamTracksSafe(mixerMasterStreamRef.current);
      stopStreamTracksSafe(mixerKiteTapStreamRef.current);
      stopStreamTracksSafe(opts.remoteStreamRef?.current ?? null);
      if (opts.remoteStreamRef) {
        opts.remoteStreamRef.current = null;
      }

      if (opts.localMonitorAudioRef?.current) {
        opts.localMonitorAudioRef.current.srcObject = null;
      }
      if (opts.remoteAudioRef?.current) {
        opts.remoteAudioRef.current.srcObject = null;
      }
    } catch {
      /* Unmount must never throw */
    }
  }, []);

  ensureStudioAudioContextRef.current = ensureContext;
  ensureMasterDestinationNodeRef.current = ensureMasterDestination;

  return {
    studioAudioContextRef,
    ensureContext,
    getContext,
    getSampleRate,
    closeContext,
    audioBaseLatencySecRef,
    audioOutputLatencySecRef,
    ensureMasterDestination,
    teardownMasterDestination,
    mixerMasterDestinationRef,
    mixerMasterStreamRef,
    mixerKiteTapDestinationRef,
    mixerKiteTapStreamRef,
    activeStreamsMapRef,
    resolveSoloLooperInputStream,
    mutedVoipCloneTrackRef,
    originalVoipSenderTrackRef,
    voipSenderMutedForKiteRef,
    runSynchronousHardwareKillSwitch,
    hardwareKillSwitchActiveRef,
    ensureStudioAudioContextRef,
    ensureMasterDestinationNodeRef,
  };
}
