"use client";

import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import { checkAudioWorkletSupport } from "@/lib/studio-bridge-webrtc";
import {
  computeAutoTargetLeadFrames,
  parseConnectionStats,
  shouldUpdateAutoTarget,
} from "@/lib/p2p/stats-poller-math";

const REMOTE_PLAYBACK_VOLUME_MIN = 0.5;
const REMOTE_PLAYBACK_VOLUME_MAX = 4;
const REMOTE_COMPRESSOR_THRESHOLD = -12;
const REMOTE_COMPRESSOR_KNEE = 6;
const REMOTE_COMPRESSOR_RATIO = 3;
const REMOTE_COMPRESSOR_ATTACK = 0.003;
const REMOTE_COMPRESSOR_RELEASE = 0.1;

export type MeteredDelayGraphNodes = {
  remoteBufferNodeRef: MutableRefObject<AudioWorkletNode | ScriptProcessorNode | null>;
  remotePlaybackSourceRef: MutableRefObject<MediaStreamAudioSourceNode | null>;
  remotePlaybackDelayRef: MutableRefObject<DelayNode | null>;
  remotePlaybackGainRef: MutableRefObject<GainNode | null>;
  remotePlaybackCompressorRef: MutableRefObject<DynamicsCompressorNode | null>;
  remotePlaybackAnalyserRef: MutableRefObject<AnalyserNode | null>;
  remotePlaybackMeterSinkRef: MutableRefObject<GainNode | null>;
};

export type MeteredDelayAudioPort = {
  getContext: () => AudioContext | null;
  getSampleRate: () => number;
  getSpeakerMuted: () => boolean;
  getPlaybackVolume: () => number;
  graphNodes: MeteredDelayGraphNodes;
};

export type MeteredDelayCallbacks = {
  onBufferTelemetry: (t: {
    bufferDepthFrames: number;
    targetLeadFrames: number;
    isPrimed: boolean;
    lastCorrectionEvent: "drop" | "dupe" | "none";
  }) => void;
  onWorkletLoaded: (loaded: boolean) => void;
  onCalculatedDelayMs: (ms: number | null) => void;
  onInboundPacketLossPercent: (pct: number | null) => void;
  onTargetLeadFramesChange: (frames: number) => void;
  onMeterGraphChanged: () => void;
  onRemoteMeterTapActive: (active: boolean) => void;
  onConnectionStatsReset?: () => void;
  onApplyLowLatencyReceivers?: (
    pc: RTCPeerConnection,
    packetLossPercent: number | null
  ) => void;
  onPacketLossGuard?: (packetLossPercent: number | null) => void;
};

export type UseMeteredDelayPlaybackConfig = {
  audio: MeteredDelayAudioPort;
  callbacks: MeteredDelayCallbacks;
  isBufferingEnabled: boolean;
  isAutoBuffer: boolean;
  manualTargetLeadFrames: number;
  isConnected: boolean;
  kiteSyncEnabled: boolean;
  isInStudioPhase: boolean;
  isWorkletLoaded: boolean;
  peerConnectionRef: RefObject<RTCPeerConnection | null>;
  mountedRef: RefObject<boolean>;
  getRemoteStream: () => MediaStream | null;
  shouldSkipRemoteGraphRebuild: () => boolean;
  getIsSafariWebKit: () => boolean;
};

export type MeteredDelayPlaybackApi = {
  buildGraph: (stream: MediaStream) => void;
  teardownGraph: () => void;
  rebuildGraph: () => void;
  flushAndSetGridTarget: (targetTimeSec: number | null) => void;
  loadWorklet: (ctx: AudioContext) => Promise<boolean>;
  resetWorkletState: () => void;
  calculatedDelayMsRef: MutableRefObject<number | null>;
  targetLeadFramesRef: MutableRefObject<number>;
};

type TeardownGraphOptions = {
  keepMeterTap?: boolean;
};

type BuildGraphOptions = {
  keepMeterTap?: boolean;
};

export function useMeteredDelayPlayback(
  config: UseMeteredDelayPlaybackConfig
): MeteredDelayPlaybackApi {
  const configRef = useRef(config);
  configRef.current = config;

  const callbacksRef = useRef(config.callbacks);
  callbacksRef.current = config.callbacks;

  const isBufferingEnabledRef = useRef(config.isBufferingEnabled);
  const isAutoBufferRef = useRef(config.isAutoBuffer);
  const isWorkletLoadedRef = useRef(config.isWorkletLoaded);
  const workletLoadPromiseRef = useRef<Promise<boolean> | null>(null);
  const workletLoadedContextRef = useRef<AudioContext | null>(null);
  const lastWorkletTelemetryAtMsRef = useRef(0);
  const targetLeadFramesDebounceRef = useRef<number | null>(null);
  const calculatedDelayMsRef = useRef<number | null>(null);
  const targetLeadFramesRef = useRef(config.manualTargetLeadFrames);
  const rebuildTimeoutRef = useRef<number | null>(null);
  const lastBuiltRemoteTrackIdRef = useRef<string | null>(null);
  const rebuildGraphRef = useRef<() => void>(() => {});

  const {
    isBufferingEnabled,
    isAutoBuffer,
    manualTargetLeadFrames,
    isConnected,
    kiteSyncEnabled,
    isInStudioPhase,
    isWorkletLoaded,
  } = config;

  const {
    remoteBufferNodeRef,
    remotePlaybackSourceRef,
    remotePlaybackDelayRef,
    remotePlaybackGainRef,
    remotePlaybackCompressorRef,
    remotePlaybackAnalyserRef,
    remotePlaybackMeterSinkRef,
  } = config.audio.graphNodes;

  useEffect(() => {
    isBufferingEnabledRef.current = isBufferingEnabled;
  }, [isBufferingEnabled]);

  useEffect(() => {
    isAutoBufferRef.current = isAutoBuffer;
  }, [isAutoBuffer]);

  useEffect(() => {
    isWorkletLoadedRef.current = isWorkletLoaded;
  }, [isWorkletLoaded]);

  useEffect(() => {
    targetLeadFramesRef.current = manualTargetLeadFrames;
  }, [manualTargetLeadFrames]);

  const resetTelemetryState = useCallback(() => {
    callbacksRef.current.onBufferTelemetry({
      bufferDepthFrames: 0,
      targetLeadFrames: targetLeadFramesRef.current,
      isPrimed: false,
      lastCorrectionEvent: "none",
    });
  }, []);

  const teardownGraph = useCallback(
    (options?: TeardownGraphOptions) => {
      const keepMeterTap = options?.keepMeterTap ?? false;
      if (!keepMeterTap) {
        callbacksRef.current.onRemoteMeterTapActive(false);
        lastBuiltRemoteTrackIdRef.current = null;
      }
      try {
        remotePlaybackMeterSinkRef.current?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        remotePlaybackAnalyserRef.current?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        remotePlaybackDelayRef.current?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        remotePlaybackCompressorRef.current?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        remotePlaybackSourceRef.current?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        remoteBufferNodeRef.current?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        remotePlaybackGainRef.current?.disconnect();
      } catch {
        /* ignore */
      }
      remotePlaybackMeterSinkRef.current = null;
      remotePlaybackAnalyserRef.current = null;
      remotePlaybackCompressorRef.current = null;
      remotePlaybackSourceRef.current = null;
      remoteBufferNodeRef.current = null;
      remotePlaybackDelayRef.current = null;
      remotePlaybackGainRef.current = null;
      resetTelemetryState();
      callbacksRef.current.onMeterGraphChanged();
    },
    [
      remoteBufferNodeRef,
      remotePlaybackAnalyserRef,
      remotePlaybackCompressorRef,
      remotePlaybackDelayRef,
      remotePlaybackGainRef,
      remotePlaybackMeterSinkRef,
      remotePlaybackSourceRef,
      resetTelemetryState,
    ]
  );

  const resetWorkletState = useCallback(() => {
    workletLoadedContextRef.current = null;
    workletLoadPromiseRef.current = null;
    callbacksRef.current.onWorkletLoaded(false);
  }, []);

  const loadWorklet = useCallback(async (ctx: AudioContext): Promise<boolean> => {
    if (!isBufferingEnabledRef.current) return false;
    if (workletLoadedContextRef.current === ctx && isWorkletLoadedRef.current) {
      return true;
    }
    if (workletLoadPromiseRef.current) {
      return workletLoadPromiseRef.current;
    }
    const loadPromise = (async () => {
      const supported = await checkAudioWorkletSupport(ctx).catch(() => false);
      if (!supported) {
        if (configRef.current.mountedRef.current) {
          callbacksRef.current.onWorkletLoaded(false);
        }
        return false;
      }
      try {
        await ctx.audioWorklet.addModule("/worklets/kite-buffer-processor.js");
        workletLoadedContextRef.current = ctx;
        if (configRef.current.mountedRef.current) {
          callbacksRef.current.onWorkletLoaded(true);
        }
        return true;
      } catch {
        if (configRef.current.mountedRef.current) {
          callbacksRef.current.onWorkletLoaded(false);
        }
        return false;
      } finally {
        workletLoadPromiseRef.current = null;
      }
    })();
    workletLoadPromiseRef.current = loadPromise;
    return loadPromise;
  }, []);

  const buildGraph = useCallback(
    (stream: MediaStream, options?: BuildGraphOptions) => {
      const cfg = configRef.current;
      const ctx = cfg.audio.getContext();
      if (!ctx) return;
      const keepMeterTap = options?.keepMeterTap ?? false;
      teardownGraph({ keepMeterTap });
      const source = ctx.createMediaStreamSource(stream);
      const delayNode = ctx.createDelay(5);
      delayNode.delayTime.value = 0; // MUST remain 0 for real-time jamming
      const gain = ctx.createGain();
      gain.gain.value = cfg.audio.getSpeakerMuted()
        ? 0
        : Math.min(
            Math.max(cfg.audio.getPlaybackVolume(), REMOTE_PLAYBACK_VOLUME_MIN),
            REMOTE_PLAYBACK_VOLUME_MAX
          );
      remoteBufferNodeRef.current = null;
      if (isBufferingEnabledRef.current) {
        if (workletLoadedContextRef.current === ctx && isWorkletLoadedRef.current) {
          const bufferNode = new AudioWorkletNode(ctx, "kite-buffer-processor");
          bufferNode.port.onmessage = (event: MessageEvent) => {
            const data = event?.data as
              | {
                  type?: string;
                  bufferDepthFrames?: number;
                  targetLeadFrames?: number;
                  isPrimed?: boolean;
                  driftCorrectionEvent?: "drop" | "dupe" | "none";
                }
              | undefined;
            if (!data || data.type !== "BUFFER_DEPTH") return;
            const nowMs = performance.now();
            if (nowMs - lastWorkletTelemetryAtMsRef.current < 250) return;
            lastWorkletTelemetryAtMsRef.current = nowMs;
            let bufferDepthFrames = 0;
            let targetLeadFrames = targetLeadFramesRef.current;
            let isPrimed = false;
            let lastCorrectionEvent: "drop" | "dupe" | "none" = "none";
            if (typeof data.bufferDepthFrames === "number") {
              bufferDepthFrames = Math.max(0, Math.round(data.bufferDepthFrames));
            }
            if (typeof data.targetLeadFrames === "number") {
              targetLeadFrames = Math.max(0, Math.round(data.targetLeadFrames));
              targetLeadFramesRef.current = targetLeadFrames;
            }
            isPrimed = Boolean(data.isPrimed);
            if (
              data.driftCorrectionEvent === "drop" ||
              data.driftCorrectionEvent === "dupe" ||
              data.driftCorrectionEvent === "none"
            ) {
              lastCorrectionEvent = data.driftCorrectionEvent;
            }
            callbacksRef.current.onBufferTelemetry({
              bufferDepthFrames,
              targetLeadFrames,
              isPrimed,
              lastCorrectionEvent,
            });
            if (typeof data.targetLeadFrames === "number") {
              callbacksRef.current.onTargetLeadFramesChange(targetLeadFrames);
            }
          };
          bufferNode.port.postMessage({
            type: "SET_TARGET_LEAD_FRAMES",
            value: targetLeadFramesRef.current,
          });
          source.connect(bufferNode);
          bufferNode.connect(delayNode);
          remoteBufferNodeRef.current = bufferNode;
        } else {
          source.connect(delayNode);
        }
      } else {
        source.connect(delayNode);
      }
      delayNode.connect(gain);
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = REMOTE_COMPRESSOR_THRESHOLD;
      compressor.knee.value = REMOTE_COMPRESSOR_KNEE;
      compressor.ratio.value = REMOTE_COMPRESSOR_RATIO;
      compressor.attack.value = REMOTE_COMPRESSOR_ATTACK;
      compressor.release.value = REMOTE_COMPRESSOR_RELEASE;
      gain.connect(compressor);
      compressor.connect(ctx.destination);
      remotePlaybackCompressorRef.current = compressor;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.62;
      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;
      gain.connect(analyser);
      analyser.connect(silentGain);
      silentGain.connect(ctx.destination);
      remotePlaybackSourceRef.current = source;
      remotePlaybackDelayRef.current = delayNode;
      remotePlaybackGainRef.current = gain;
      remotePlaybackAnalyserRef.current = analyser;
      remotePlaybackMeterSinkRef.current = silentGain;
      lastBuiltRemoteTrackIdRef.current = stream.getAudioTracks()[0]?.id ?? null;
      callbacksRef.current.onRemoteMeterTapActive(true);
      callbacksRef.current.onMeterGraphChanged();
    },
    [
      remoteBufferNodeRef,
      remotePlaybackAnalyserRef,
      remotePlaybackCompressorRef,
      remotePlaybackDelayRef,
      remotePlaybackGainRef,
      remotePlaybackMeterSinkRef,
      remotePlaybackSourceRef,
      teardownGraph,
    ]
  );

  const rebuildGraph = useCallback(() => {
    const cfg = configRef.current;
    if (cfg.shouldSkipRemoteGraphRebuild()) return;
    const ctx = cfg.audio.getContext();
    const stream = cfg.getRemoteStream();
    if (!ctx || !stream) return;

    const trackId = stream.getAudioTracks()[0]?.id ?? null;
    const wantsWorklet = isBufferingEnabledRef.current && isWorkletLoadedRef.current;
    if (
      trackId &&
      trackId === lastBuiltRemoteTrackIdRef.current &&
      remotePlaybackGainRef.current &&
      wantsWorklet === Boolean(remoteBufferNodeRef.current)
    ) {
      return;
    }

    if (rebuildTimeoutRef.current !== null) {
      clearTimeout(rebuildTimeoutRef.current);
      rebuildTimeoutRef.current = null;
    }

    const currentGain = remotePlaybackGainRef.current;
    if (currentGain) {
      try {
        currentGain.gain.cancelScheduledValues(ctx.currentTime);
        currentGain.gain.setValueAtTime(currentGain.gain.value, ctx.currentTime);
        currentGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.05);
      } catch {
        /* ignore */
      }
    }

    rebuildTimeoutRef.current = window.setTimeout(() => {
      rebuildTimeoutRef.current = null;
      const latestCfg = configRef.current;
      if (!latestCfg.mountedRef.current) return;
      if (latestCfg.shouldSkipRemoteGraphRebuild()) {
        const skippedGain = remotePlaybackGainRef.current;
        const skippedCtx = latestCfg.audio.getContext();
        if (skippedGain && skippedCtx && skippedCtx.state !== "closed") {
          const targetGain = latestCfg.audio.getSpeakerMuted()
            ? 0
            : Math.min(
                Math.max(latestCfg.audio.getPlaybackVolume(), REMOTE_PLAYBACK_VOLUME_MIN),
                REMOTE_PLAYBACK_VOLUME_MAX
              );
          try {
            skippedGain.gain.cancelScheduledValues(skippedCtx.currentTime);
            skippedGain.gain.setTargetAtTime(targetGain, skippedCtx.currentTime, 0.01);
          } catch {
            /* ignore */
          }
        }
        return;
      }
      const latestStream = latestCfg.getRemoteStream();
      if (!latestStream) return;
      buildGraph(latestStream, { keepMeterTap: true });
      const rebuiltGain = remotePlaybackGainRef.current;
      const rebuiltCtx = latestCfg.audio.getContext();
      if (!rebuiltGain || !rebuiltCtx) return;
      const targetGain = latestCfg.audio.getSpeakerMuted()
        ? 0
        : Math.min(
            Math.max(latestCfg.audio.getPlaybackVolume(), REMOTE_PLAYBACK_VOLUME_MIN),
            REMOTE_PLAYBACK_VOLUME_MAX
          );
      try {
        rebuiltGain.gain.cancelScheduledValues(rebuiltCtx.currentTime);
        rebuiltGain.gain.setValueAtTime(0, rebuiltCtx.currentTime);
        rebuiltGain.gain.linearRampToValueAtTime(targetGain, rebuiltCtx.currentTime + 0.05);
      } catch {
        /* ignore */
      }
    }, 60);
  }, [buildGraph, remoteBufferNodeRef, remotePlaybackGainRef]);

  rebuildGraphRef.current = rebuildGraph;

  const flushAndSetGridTarget = useCallback(
    (targetTimeSec: number | null) => {
      const bufferNode = remoteBufferNodeRef.current;
      if (!bufferNode || !("port" in bufferNode)) return;
      bufferNode.port.postMessage({ type: "FLUSH_BUFFER" });
      if (typeof targetTimeSec === "number" && Number.isFinite(targetTimeSec)) {
        bufferNode.port.postMessage({
          type: "SET_GRID_TARGET",
          targetTimeSec,
        });
      }
    },
    [remoteBufferNodeRef]
  );

  useEffect(() => {
    if (!isConnected) {
      callbacksRef.current.onInboundPacketLossPercent(null);
      callbacksRef.current.onCalculatedDelayMs(null);
      calculatedDelayMsRef.current = null;
      callbacksRef.current.onConnectionStatsReset?.();
      return;
    }
    const tick = () => {
      const cfg = configRef.current;
      const pc = cfg.peerConnectionRef.current;
      if (!pc || !cfg.mountedRef.current) return;
      void pc
        .getStats()
        .then((stats) => {
          if (!configRef.current.mountedRef.current) return;
          const parsed = parseConnectionStats(stats);
          if (parsed.oneWayDelayMs === null) {
            callbacksRef.current.onCalculatedDelayMs(null);
            calculatedDelayMsRef.current = null;
          } else {
            callbacksRef.current.onCalculatedDelayMs(parsed.oneWayDelayMs);
            calculatedDelayMsRef.current = parsed.oneWayDelayMs;
          }
          if (isAutoBufferRef.current && parsed.rtt !== null) {
            const sampleRate = configRef.current.audio.getSampleRate();
            const autoTarget = computeAutoTargetLeadFrames({
              rttMs: parsed.rtt.rttMs,
              jitterSec: parsed.jitterSec,
              sampleRate,
            });
            const currentTarget = targetLeadFramesRef.current;
            if (shouldUpdateAutoTarget(currentTarget, autoTarget)) {
              const bufferNode = remoteBufferNodeRef.current;
              if (bufferNode && "port" in bufferNode) {
                bufferNode.port.postMessage({
                  type: "SET_TARGET_LEAD_FRAMES",
                  value: autoTarget,
                });
              }
              targetLeadFramesRef.current = autoTarget;
              callbacksRef.current.onTargetLeadFramesChange(autoTarget);
            }
          }
          if (parsed.inboundLoss === null) {
            callbacksRef.current.onInboundPacketLossPercent(null);
            callbacksRef.current.onPacketLossGuard?.(null);
            return;
          }
          callbacksRef.current.onApplyLowLatencyReceivers?.(pc, parsed.packetLossPercent);
          callbacksRef.current.onInboundPacketLossPercent(parsed.packetLossPercent);
          callbacksRef.current.onPacketLossGuard?.(parsed.packetLossPercent);
        })
        .catch(() => {});
    };
    tick();
    const id = window.setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [isConnected, remoteBufferNodeRef]);

  useEffect(() => {
    if (!isInStudioPhase) return;
    if (configRef.current.shouldSkipRemoteGraphRebuild()) return;
    if (!configRef.current.getRemoteStream()) return;
    if (isBufferingEnabled && !isWorkletLoaded) return;
    rebuildGraphRef.current();
    return () => {
      if (rebuildTimeoutRef.current !== null) {
        clearTimeout(rebuildTimeoutRef.current);
        rebuildTimeoutRef.current = null;
      }
    };
  }, [isInStudioPhase, isBufferingEnabled, isWorkletLoaded]);

  useEffect(() => {
    if (kiteSyncEnabled) return;
    const bufferNode = remoteBufferNodeRef.current;
    if (!bufferNode || !("port" in bufferNode)) return;
    bufferNode.port.postMessage({ type: "FLUSH_BUFFER" });
  }, [kiteSyncEnabled, remoteBufferNodeRef]);

  useEffect(() => {
    if (isAutoBufferRef.current) return;
    if (targetLeadFramesDebounceRef.current !== null) {
      clearTimeout(targetLeadFramesDebounceRef.current);
    }
    targetLeadFramesDebounceRef.current = window.setTimeout(() => {
      const bufferNode = remoteBufferNodeRef.current;
      if (!bufferNode || !("port" in bufferNode)) return;
      bufferNode.port.postMessage({
        type: "SET_TARGET_LEAD_FRAMES",
        value: targetLeadFramesRef.current,
      });
      targetLeadFramesDebounceRef.current = null;
    }, 150);
    return () => {
      if (targetLeadFramesDebounceRef.current !== null) {
        clearTimeout(targetLeadFramesDebounceRef.current);
        targetLeadFramesDebounceRef.current = null;
      }
    };
  }, [manualTargetLeadFrames, isAutoBuffer, remoteBufferNodeRef]);

  useEffect(() => {
    return () => {
      if (rebuildTimeoutRef.current !== null) {
        clearTimeout(rebuildTimeoutRef.current);
        rebuildTimeoutRef.current = null;
      }
    };
  }, []);

  return {
    buildGraph,
    teardownGraph,
    rebuildGraph,
    flushAndSetGridTarget,
    loadWorklet,
    resetWorkletState,
    calculatedDelayMsRef,
    targetLeadFramesRef,
  };
}
