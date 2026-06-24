"use client";

import {
  useCallback,
  useMemo,
  useRef,
  type MutableRefObject,
  type RefObject,
} from "react";
import {
  computeCountInOneBarSec,
  computeGuestTargetSec,
  snapGuestTargetToGrid,
} from "@/lib/p2p/guest-sync-math";
import {
  buildKiteSyncPacket,
  shouldAcceptKiteSyncDisable,
  shouldAcceptKiteSyncSequence,
  type KiteSyncMessage,
} from "@/lib/p2p/kite-sync-packet";
import type { SetIntervalMessage } from "@/lib/p2p/data-channel-message-types";
import type { Role, TransportPort } from "@/lib/p2p/transport-port";
import {
  buildKiteIntervalGraph,
  type KiteIntervalGraph,
  type KiteIntervalReadyEvent,
} from "@/lib/kite-interval-graph";
import {
  calcInputNudgeFrames,
  KITE_DEFAULT_INPUT_LATENCY_MS,
  type KiteIntervalTiming,
} from "@/lib/kite-interval-math";

export type KiteMode = "live" | "solo" | "sync" | "broadcast";
import {
  createLoadIntervalChunks,
  decodeLoadIntervalChunk,
  encodeLoadIntervalChunk,
  KiteIntervalReassembler,
  type ReassembledLoadInterval,
} from "@/lib/kite-data-chunking";
import {
  createMetronomePump,
  type MetronomePumpHandle,
} from "@/lib/studio-metronome-pump";

export type P2PRemoteIntervalPayload = {
  intervalId: string;
  intervalFrames: number;
  channelCount: number;
  sampleRate: number;
  buffer: ArrayBuffer;
};

export type RetainedKiteLoopBuffer = {
  intervalId: string;
  sequenceNumber: number;
  sampleRate: number;
  intervalFrames: number;
  channelCount: number;
  buffer: ArrayBuffer;
};

export type KiteSyncBroadcastStatus = "idle" | "connecting" | "syncing" | "live";

/** Pause Kite metronome when inbound loss exceeds this; resume only after hysteresis. */
import {
  KITE_SYNC_LOSS_PAUSE_PCT,
  KITE_SYNC_LOSS_RESUME_PCT,
  KITE_SYNC_LOSS_STABLE_MS,
} from "@/lib/p2p/kite-sync-loss";
/** Max assembled live intervals queued before head drop (catch-up policy). */
const P2P_FIFO_MAX_DEPTH = 4;

export type KiteSyncEngineMeteredDelayPort = {
  flushAndSetGridTarget: (targetTimeSec: number | null) => void;
  calculatedDelayMsRef: MutableRefObject<number | null>;
  targetLeadFramesRef: MutableRefObject<number>;
};

export type KiteSyncEngineAudioPort = {
  getContext: () => AudioContext | null;
  ensureContextRunning: () => Promise<AudioContext>;
  getSampleRate: () => number;
  getMasterDestinationNode: () => MediaStreamAudioDestinationNode | null;
  /** Kite tap when available, else fallback mic; never the VoIP master mix. */
  resolveP2PInputStream: () => MediaStream | null;
};

/** VoIP sender mute during Kite broadcast (replaces inline clone/replace in page). */
export type KiteSyncEngineVoipPort = {
  muteLocalVoip: () => void;
  restoreLocalVoip: () => void;
  isVoipMuted: () => boolean;
};

/**
 * Inverted metronome IoC: page owns scheduler/pump/DOM blink; sync engine owns count-in completion.
 * Page calls `onMetronomePumpTick` from its metronome AudioWorklet pump each tick.
 */
export type KiteSyncEngineMetronomePort = {
  stop?: () => void;
  ensureGain?: (ctx: AudioContext) => GainNode | null;
  setGain?: (value: number) => void;
  /** Mutes metronome during count-in (`gain.value = 0`). */
  setGainValue?: (value: number) => void;
  getMetronomeVolume: () => number;
  /** Restores audibility after count-in (`gain.value = getMetronomeVolume()`). */
  restoreMetronomeGainAfterCountIn: () => void;
};

/** P2P interval graph + grid load path (mirrors `kiteP2PEngineRef` on page). */
export type KiteSyncEngineRemotePlaybackPort = {
  buildGraph?: (stream: MediaStream) => void;
  restoreLiveVoipTrack?: () => void;
  teardownRemotePlaybackGraph: () => void;
  resetPlaybackEngine?: () => void;
};

export type KiteSyncEngineTimingInputs = {
  getKiteSyncEnabled: () => boolean;
  getMetronomeBpm: () => number;
  getBeatsPerInterval: () => number;
  /** `kiteIntervalTimingRef` / `latestKiteIntervalTimingRef` bpi fallback chain. */
  getIntervalBpi: () => number | undefined;
  getSyncInitiatorId: () => string | null;
  /** `latestKiteIntervalTimingRef ?? kiteIntervalTimingRef`. */
  getKiteIntervalTiming: () => KiteIntervalTiming | null;
  getBroadcastStatus: () => KiteSyncBroadcastStatus;
  getKiteSetupTimeSignatureTop: () => number;
  getCanControlStop: () => boolean;
};

export type KiteSyncEngineCallbacks = {
  onKiteSyncEnabledChange: (enabled: boolean) => void;
  onBroadcastStatusChange: (status: KiteSyncBroadcastStatus) => void;
  onSyncInitiatorIdChange: (id: string | null) => void;
  onMetronomeBpmChange: (bpm: number) => void;
  onBeatsPerIntervalChange: (bpi: number) => void;
  onKiteSetupTempoChange: (tempo: number) => void;
  onKiteSetupTimeSignatureTopChange: (top: number) => void;
  onKiteSetupTimeSignatureBottomChange: (bottom: number) => void;
  onKiteSetupChordCountChange: (count: number) => void;
  onKiteSyncCountInActiveChange: (active: boolean) => void;
  onPartialCleanupKiteEngine: () => void;
  onRestoreLiveVoipAfterKite: () => void;
  onRebuildRemotePlaybackGraph: () => void;
  onStartP2PIntervalScheduler?: (timing: KiteIntervalTiming) => void;
  /** Optional UI telemetry when a remote interval is committed at a grid tick. */
  onAudioIntervalScheduled?: (detail: {
    intervalId: string;
    tickSeq: number;
    fifoRemaining: number;
  }) => void;
  /** Optional UI telemetry when a grid tick advances without a queued interval. */
  onPhaseChange?: (tickSeq: number) => void;
  onKiteModeChange: (mode: KiteMode) => void;
  onStudioUiPhaseChange: (phase: "lobby" | "studio") => void;
  onAudioContextReadyChange: (ready: boolean) => void;
  /** UX hint while metronome is paused due to inbound packet-loss hysteresis. */
  onPacketLossWarningChange: (paused: boolean) => void;
  /** Bumps metronome scheduler re-init after loss recovery (page: setKiteSyncMetronomeResumeNonce). */
  onKiteSyncMetronomeResumeNonceChange: () => void;
  onLoopChunkSendErrorChange?: (error: string | null) => void;
  onLoopChunkSendProgressChange?: (progress: KiteLoopChunkSendProgress) => void;
  /** Clears host retained loop + remote retained interval (full cleanup only). */
  onClearRetainedLoopBuffers?: () => void;
  onLog?: (message: string) => void;
};

export type KiteSyncEngineRetainedLoopPort = {
  getRetainedKiteLoopBuffer: () => RetainedKiteLoopBuffer | null;
};

export type KiteSyncEngineConfig = {
  getTransportPort: () => TransportPort | null;
  meteredDelay: KiteSyncEngineMeteredDelayPort;
  audio: KiteSyncEngineAudioPort;
  voip: KiteSyncEngineVoipPort;
  metronome: KiteSyncEngineMetronomePort;
  remotePlayback: KiteSyncEngineRemotePlaybackPort;
  callbacks: KiteSyncEngineCallbacks;
  retainedLoop: KiteSyncEngineRetainedLoopPort;
  sessionId: string | null;
  role: Role | null;
  localOwnerId: string;
  timingInputs: KiteSyncEngineTimingInputs;
  mountedRef: RefObject<boolean>;
};

export type KiteSyncBroadcastOverrides = {
  kiteSyncEnabled?: boolean;
  bpm?: number;
  bpi?: number;
};

export type KiteLoopChunkSendProgress = {
  status: "idle" | "sending" | "sent" | "error";
  sentChunks: number;
  totalChunks: number;
};

export type CleanupKiteOpts = {
  isFull?: boolean;
  /** When true, reset sync UI state (enabled, broadcast status, kite mode). */
  disableUI?: boolean;
};

export type KiteSyncEngineApi = {
  broadcastKiteSync: (overrides?: KiteSyncBroadcastOverrides) => void;
  startCountIn: () => Promise<void>;
  startSyncFromToggle: (enabled: boolean) => void;
  /** Count-in completion + grid anchor; invoke from page metronome pump. */
  onMetronomePumpTick: (ctx: AudioContext, nowSec: number) => void;
  /** Risk 8: stable read for page metronome effect deps (not `metronomeGainRef`). */
  getKiteSyncMetronomeResumeNonce: () => number;
  /** Guest grid anchor from last accepted `KITE_SYNC` (replaces page-local timing ref). */
  getLastAppliedGuestStartSec: () => number | null;
  getLastSyncApplyAtMs: () => number | null;
  /** Active interval timing owned by the sync engine. */
  getActiveKiteIntervalTiming: () => KiteIntervalTiming | null;
  /** Partial exit: Stop Kite Sync path (VoIP restore, live P2P). */
  dropKiteSyncToLiveP2P: (opts?: { notifyPeer?: boolean }) => void;
  /** Send coalesced `KITE_SYNC` once the data channel is ready (e.g. on `peer.connect`). */
  flushPendingKiteSyncPacket: () => void;
  handleKiteSyncMessage: (msg: KiteSyncMessage) => void;
  handleSetIntervalMessage: (msg: SetIntervalMessage) => void;
  handleLoadIntervalChunk: (raw: unknown) => void;
  sendSetInterval: (
    timing: KiteIntervalTiming,
    hasRetainedLoop: boolean,
    options?: {
      igniteP2PEngine?: boolean;
      abortIgnition?: boolean;
      enterBroadcastMode?: boolean;
      initiatorId?: string;
    }
  ) => void;
  sendRetainedLoopChunks: () => Promise<void>;
  startP2PIntervalScheduler: (timing: KiteIntervalTiming) => void;
  stopSync: () => void;
  startP2PEngine: (timing: KiteIntervalTiming) => Promise<void>;
  /** Restart capture engine + grid scheduler after reconnect when engine is null. */
  reigniteP2PEngine: (timing: KiteIntervalTiming) => Promise<void>;
  isEngineRunning: () => boolean;
  /** True after first successful FIFO pop + loadInterval (VoIP may be torn down). */
  isP2PPlaybackActive: () => boolean;
  cleanup: (opts?: CleanupKiteOpts) => void;
  onPeerDisconnected: () => void;
  applyPacketLoss: (packetLossPercent: number | null) => void;
};

const noopAsync = async (): Promise<void> => {};
const noop = (): void => {};

export function useKiteSyncEngine(config: KiteSyncEngineConfig): KiteSyncEngineApi {
  const configRef = useRef(config);
  configRef.current = config;

  const callbacksRef = useRef(config.callbacks);
  callbacksRef.current = config.callbacks;

  const syncSequenceRef = useRef(0);
  const studioRevisionRef = useRef(0);
  const pendingKiteSyncPacketRef = useRef<KiteSyncMessage | null>(null);

  const lastAcceptedKiteSyncSeqRef = useRef(0);
  const lastAcceptedStudioRevisionRef = useRef(0);
  const lastAppliedGuestStartSecRef = useRef<number | null>(null);
  const lastSyncApplyAtMsRef = useRef<number | null>(null);
  const kiteSyncCountInEndAtContextSecRef = useRef(0);
  const kiteSyncCountInActiveRef = useRef(false);
  const kiteSyncCountInCompletionHandledRef = useRef(false);
  const kiteGridAnchorContextSecRef = useRef<number | null>(null);
  const kiteSyncMetronomeResumeNonceRef = useRef(0);
  /** Guest KITE_SYNC sequences deferred while loss pause is active (replayed on resume). */
  const kiteSyncGuestSequenceQueueRef = useRef<number[]>([]);
  /** Last accepted sequence at loss-pause entry; cleared on stable resume. */
  const kiteSyncLossWaitSequenceRef = useRef<number | null>(null);
  const kiteSyncLossRecoverySinceMsRef = useRef<number | null>(null);
  const kiteSyncLossPauseActiveRef = useRef(false);

  const queuedRemoteKiteIntervalRef = useRef<ReassembledLoadInterval[]>([]);
  const queuedRemoteKiteIntervalTimeoutRef = useRef<number | null>(null);
  const retainedRemoteKiteLoopRef = useRef<ReassembledLoadInterval | null>(null);
  const kiteLoopReassemblerRef = useRef<KiteIntervalReassembler | null>(null);
  const kiteLoopChunksRef = useRef<ReturnType<typeof createLoadIntervalChunks> | null>(
    null
  );
  const kiteLoopSendAbortControllerRef = useRef<AbortController | null>(null);
  const retryRetainedLoopSyncRef = useRef<(() => void) | null>(null);

  const p2pGridPumpGenerationRef = useRef(0);
  const kiteP2PGridPumpRef = useRef<MetronomePumpHandle | null>(null);
  const p2pGridNextBoundaryContextSecRef = useRef<number | null>(null);
  const p2pGridIntervalIndexRef = useRef(0);
  const startP2PIntervalSchedulerRef = useRef<(timing: KiteIntervalTiming) => void>(
    () => {}
  );
  const startP2PEngineRef = useRef<(timing: KiteIntervalTiming) => Promise<void>>(
    async () => {}
  );
  const sendSetIntervalRef = useRef<
    (
      timing: KiteIntervalTiming,
      hasRetainedLoop: boolean,
      options?: {
        igniteP2PEngine?: boolean;
        abortIgnition?: boolean;
        enterBroadcastMode?: boolean;
        initiatorId?: string;
      }
    ) => void
  >(() => {});
  const cleanupRef = useRef<(opts?: CleanupKiteOpts) => void>(() => {});
  const teardownKiteSyncSessionRef = useRef<
    (opts?: { notifyPeer?: boolean }) => void
  >(() => {});
  const abortStartCountInRef = useRef<(opts?: { notifyPeer?: boolean }) => void>(
    () => {}
  );
  const isStartingCountInRef = useRef(false);
  const countInSessionArmedRef = useRef(false);
  const ignitePacketSentRef = useRef(false);
  const reigniteP2PEngineRef = useRef<(timing: KiteIntervalTiming) => Promise<void>>(
    async () => {}
  );
  const p2pPlaybackActiveRef = useRef(false);
  const broadcastKiteSyncRef = useRef<(overrides?: KiteSyncBroadcastOverrides) => void>(
    () => {}
  );

  const kiteModeRef = useRef<KiteMode>("live");
  const kiteP2PEngineRef = useRef<KiteIntervalGraph | null>(null);
  const kiteP2PSequenceRef = useRef(0);
  const latestKiteIntervalTimingRef = useRef<KiteIntervalTiming | null>(null);

  const getActiveKiteIntervalTiming = useCallback((): KiteIntervalTiming | null => {
    return (
      latestKiteIntervalTimingRef.current ??
      configRef.current.timingInputs.getKiteIntervalTiming()
    );
  }, []);

  const restoreLiveVoipAfterKite = useCallback((): void => {
    if (configRef.current.voip.isVoipMuted()) {
      configRef.current.voip.restoreLocalVoip();
    }
  }, []);

  const bumpKiteSyncMetronomeResumeNonce = useCallback((): void => {
    kiteSyncMetronomeResumeNonceRef.current += 1;
    callbacksRef.current.onKiteSyncMetronomeResumeNonceChange();
  }, []);

  const armCountInAtContext = useCallback(
    (ctx: AudioContext, countInOneBarSec: number): void => {
      if (!Number.isFinite(countInOneBarSec) || countInOneBarSec <= 0) {
        return;
      }
      const cfg = configRef.current;
      const cb = callbacksRef.current;
      kiteSyncCountInEndAtContextSecRef.current = ctx.currentTime + countInOneBarSec;
      cfg.metronome.setGainValue?.(0);
      cb.onKiteSyncCountInActiveChange(true);
      kiteSyncCountInActiveRef.current = true;
      kiteSyncCountInCompletionHandledRef.current = false;
    },
    []
  );

  const onMetronomePumpTick = useCallback((ctx: AudioContext, _nowSec: number): void => {
    if (
      !kiteSyncCountInActiveRef.current ||
      kiteSyncCountInCompletionHandledRef.current
    ) {
      return;
    }
    const endAt = kiteSyncCountInEndAtContextSecRef.current;
    if (!Number.isFinite(endAt) || endAt <= 0 || ctx.currentTime < endAt) {
      return;
    }

    const cb = callbacksRef.current;
    const cfg = configRef.current;

    kiteSyncCountInCompletionHandledRef.current = true;
    kiteSyncCountInActiveRef.current = false;
    cb.onKiteSyncCountInActiveChange(false);

    if (cfg.timingInputs.getKiteSyncEnabled()) {
      cb.onBroadcastStatusChange("live");
    }

    cfg.metronome.restoreMetronomeGainAfterCountIn();

    const anchorSec = ctx.currentTime;
    kiteGridAnchorContextSecRef.current = anchorSec;
    if (anchorSec != null && Number.isFinite(anchorSec)) {
      kiteP2PEngineRef.current?.alignPhase(anchorSec);
    }
  }, []);

  const startCountIn = useCallback(async (): Promise<void> => {
    if (isStartingCountInRef.current) {
      return;
    }

    const cfg = configRef.current;
    const cb = callbacksRef.current;

    const timing = getActiveKiteIntervalTiming();
    if (!timing) {
      console.warn("[Kite] startCountIn skipped — no timing ref");
      return;
    }

    const rollback = (reason: string, err?: unknown): void => {
      if (err) {
        console.error(`[Kite] startCountIn abort: ${reason}`, err);
      } else {
        console.warn(`[Kite] startCountIn abort: ${reason}`);
      }

      if (countInSessionArmedRef.current) {
        teardownKiteSyncSessionRef.current({ notifyPeer: ignitePacketSentRef.current });
      } else if (
        cfg.voip.isVoipMuted() ||
        ignitePacketSentRef.current ||
        kiteP2PEngineRef.current
      ) {
        abortStartCountInRef.current({ notifyPeer: ignitePacketSentRef.current });
      }
    };

    isStartingCountInRef.current = true;
    ignitePacketSentRef.current = false;
    countInSessionArmedRef.current = false;

    try {
      await startP2PEngineRef.current(timing);

      const hasRetainedLoop = cfg.retainedLoop.getRetainedKiteLoopBuffer() !== null;
      sendSetIntervalRef.current(timing, hasRetainedLoop, { igniteP2PEngine: true });
      ignitePacketSentRef.current = true;

      const ctx = await cfg.audio.ensureContextRunning();
      if (ctx.state !== "running") {
        cb.onAudioContextReadyChange(false);
        rollback("AudioContext not running");
        return;
      }
      cb.onAudioContextReadyChange(true);

      cfg.meteredDelay.flushAndSetGridTarget(ctx.currentTime + 0.01);

      const countInOneBarSec = computeCountInOneBarSec(
        cfg.timingInputs.getMetronomeBpm(),
        Math.max(1, Math.round(cfg.timingInputs.getKiteSetupTimeSignatureTop()))
      );
      if (!Number.isFinite(countInOneBarSec) || countInOneBarSec <= 0) {
        rollback("invalid count-in duration");
        return;
      }

      armCountInAtContext(ctx, countInOneBarSec);

      cb.onKiteSyncEnabledChange(true);
      cb.onBroadcastStatusChange("syncing");
      cb.onSyncInitiatorIdChange(cfg.localOwnerId);
      broadcastKiteSyncRef.current({ kiteSyncEnabled: true });

      startP2PIntervalSchedulerRef.current(timing);
      cb.onStartP2PIntervalScheduler?.(timing);

      countInSessionArmedRef.current = true;
    } catch (err) {
      rollback("thrown error", err);
    } finally {
      isStartingCountInRef.current = false;
      if (!countInSessionArmedRef.current) {
        ignitePacketSentRef.current = false;
      }
    }
  }, [armCountInAtContext, getActiveKiteIntervalTiming]);

  const startSyncFromToggle = useCallback((enabled: boolean): void => {
    const cfg = configRef.current;
    const cb = callbacksRef.current;

    console.log("Kite Sync Toggle Clicked. New State:", enabled);

    if (enabled) {
      const ctx = cfg.audio.getContext();
      if (ctx) {
        cfg.meteredDelay.flushAndSetGridTarget(ctx.currentTime + 0.01);
        const countInOneBarSec =
          (60 / cfg.timingInputs.getMetronomeBpm()) *
          Math.max(1, Math.round(cfg.timingInputs.getKiteSetupTimeSignatureTop()));
        armCountInAtContext(ctx, countInOneBarSec);
      }
      cb.onSyncInitiatorIdChange(cfg.localOwnerId);
    } else {
      if (!cfg.timingInputs.getCanControlStop()) {
        return;
      }
      teardownKiteSyncSessionRef.current({ notifyPeer: true });
      return;
    }

    cb.onKiteSyncEnabledChange(enabled);
    cb.onBroadcastStatusChange(enabled ? "syncing" : "idle");
    broadcastKiteSyncRef.current({ kiteSyncEnabled: enabled });
  }, [armCountInAtContext, restoreLiveVoipAfterKite]);

  const allocateKiteSyncSequence = useCallback((): {
    sequenceNumber: number;
    studioRevision: number;
  } => {
    syncSequenceRef.current += 1;
    studioRevisionRef.current += 1;
    return {
      sequenceNumber: syncSequenceRef.current,
      studioRevision: studioRevisionRef.current,
    };
  }, []);

  const sendOrQueueKiteSyncPacket = useCallback((packet: KiteSyncMessage): void => {
    const port = configRef.current.getTransportPort();
    if (port?.isReady()) {
      try {
        port.sendJson(packet);
        pendingKiteSyncPacketRef.current = null;
      } catch {
        // Coalesce to latest sync packet while channel is recovering.
        pendingKiteSyncPacketRef.current = packet;
      }
      return;
    }
    pendingKiteSyncPacketRef.current = packet;
  }, []);

  const flushPendingKiteSyncPacket = useCallback((): void => {
    const packet = pendingKiteSyncPacketRef.current;
    if (!packet) return;
    const port = configRef.current.getTransportPort();
    if (!port?.isReady()) return;
    try {
      port.sendJson(packet);
      pendingKiteSyncPacketRef.current = null;
    } catch {
      /* keep latest packet for a later flush */
    }
  }, []);

  const getLastAppliedGuestStartSec = useCallback(
    (): number | null => lastAppliedGuestStartSecRef.current,
    []
  );

  const getLastSyncApplyAtMs = useCallback(
    (): number | null => lastSyncApplyAtMsRef.current,
    []
  );

  const broadcastKiteSync = useCallback((overrides?: KiteSyncBroadcastOverrides): void => {
    const ctx = configRef.current.audio.getContext();
    if (!ctx) return;

    const timing = configRef.current.timingInputs;
    const nextEnabled = overrides?.kiteSyncEnabled ?? timing.getKiteSyncEnabled();
    const nextBpm = overrides?.bpm ?? timing.getMetronomeBpm();
    const nextBpi =
      overrides?.bpi ?? timing.getIntervalBpi() ?? timing.getBeatsPerInterval();

    const { sequenceNumber, studioRevision } = allocateKiteSyncSequence();

    console.log("Broadcasting KITE_SYNC packet...", {
      bpm: nextBpm,
      bpi: nextBpi,
    });

    const packet = buildKiteSyncPacket({
      ctxCurrentTimeSec: ctx.currentTime,
      enabled: nextEnabled,
      bpm: nextBpm,
      bpi: nextBpi,
      sequenceNumber,
      initiatorId: timing.getSyncInitiatorId() ?? configRef.current.localOwnerId,
      studioRevision,
    });
    sendOrQueueKiteSyncPacket(packet);
    flushPendingKiteSyncPacket();
  }, [allocateKiteSyncSequence, flushPendingKiteSyncPacket, sendOrQueueKiteSyncPacket]);

  broadcastKiteSyncRef.current = broadcastKiteSync;

  const handleKiteSyncMessage = useCallback((parsed: KiteSyncMessage): void => {
    if (
      !shouldAcceptKiteSyncSequence(
        parsed.sequenceNumber,
        lastAcceptedKiteSyncSeqRef.current
      )
    ) {
      return;
    }

    const cb = callbacksRef.current;
    const cfg = configRef.current;
    const timing = cfg.timingInputs;

    if (!parsed.enabled) {
      if (
        !shouldAcceptKiteSyncDisable(parsed, timing.getSyncInitiatorId())
      ) {
        return;
      }
      lastAcceptedKiteSyncSeqRef.current = parsed.sequenceNumber;
      teardownKiteSyncSessionRef.current({ notifyPeer: false });
      return;
    }

    lastAcceptedKiteSyncSeqRef.current = parsed.sequenceNumber;
    cb.onKiteSyncEnabledChange(true);
    cb.onBroadcastStatusChange("syncing");

    if (typeof parsed.initiatorId === "string") {
      cb.onSyncInitiatorIdChange(parsed.initiatorId);
    }

    const incomingRev =
      typeof parsed.studioRevision === "number" ? parsed.studioRevision : null;
    let applyBpmBpi = true;
    if (incomingRev !== null) {
      if (incomingRev < lastAcceptedStudioRevisionRef.current) {
        applyBpmBpi = false;
      } else {
        lastAcceptedStudioRevisionRef.current = incomingRev;
      }
    }

    const receivedAtMs = Date.now();
    const { calculatedDelayMsRef, targetLeadFramesRef, flushAndSetGridTarget } =
      cfg.meteredDelay;
    const guestTargetSec = computeGuestTargetSec({
      hostTimeSec: parsed.hostTime,
      serverTimestampMs: parsed.serverTimestamp,
      receivedAtMs,
      calculatedDelayMs: calculatedDelayMsRef.current,
      targetLeadFrames: targetLeadFramesRef.current,
      sampleRate: cfg.audio.getSampleRate(),
    });

    lastAppliedGuestStartSecRef.current = guestTargetSec;
    lastSyncApplyAtMsRef.current = receivedAtMs;
    if (applyBpmBpi) {
      cb.onMetronomeBpmChange(parsed.bpm);
      cb.onBeatsPerIntervalChange(parsed.bpi);
    }

    const ctx = cfg.audio.getContext();
    if (ctx) {
      const nextGridSec = snapGuestTargetToGrid({
        guestTargetSec,
        ctxCurrentTimeSec: ctx.currentTime,
        bpm: parsed.bpm,
      });
      flushAndSetGridTarget(nextGridSec);

      const intervalTiming = getActiveKiteIntervalTiming();
      const beatsPerBar = Math.max(
        1,
        Math.round(
          intervalTiming?.beatsPerBar ?? intervalTiming?.timeSignatureTop ?? 4
        )
      );
      const countInOneBarSec = (60 / parsed.bpm) * beatsPerBar;
      if (Number.isFinite(countInOneBarSec) && countInOneBarSec > 0) {
        kiteSyncCountInEndAtContextSecRef.current =
          ctx.currentTime + countInOneBarSec;
        cfg.metronome.setGainValue?.(0);
        cb.onKiteSyncCountInActiveChange(true);
        kiteSyncCountInActiveRef.current = true;
        kiteSyncCountInCompletionHandledRef.current = false;
        void queueMicrotask(() => {
          const timingNow = getActiveKiteIntervalTiming();
          if (timingNow) {
            startP2PIntervalSchedulerRef.current(timingNow);
            cb.onStartP2PIntervalScheduler?.(timingNow);
          }
        });
      }
    }
  }, [getActiveKiteIntervalTiming, restoreLiveVoipAfterKite]);

  const advanceP2PGridBoundaries = useCallback((periodSec: number): void => {
    const ctxNow = configRef.current.audio.getContext();
    if (!ctxNow || ctxNow.state === "closed") return;
    if (!Number.isFinite(periodSec) || periodSec <= 0) return;

    const cb = callbacksRef.current;

    let nextBoundary = p2pGridNextBoundaryContextSecRef.current;
    if (nextBoundary == null || !Number.isFinite(nextBoundary)) {
      p2pGridNextBoundaryContextSecRef.current = ctxNow.currentTime + periodSec;
      return;
    }

    const eps = ctxNow.sampleRate > 0 ? 2 / ctxNow.sampleRate : 0.00005;

    while (ctxNow.currentTime + eps >= nextBoundary) {
      p2pGridIntervalIndexRef.current += 1;
      const tickSeq = p2pGridIntervalIndexRef.current;

      const fifo = queuedRemoteKiteIntervalRef.current;
      while (fifo.length > P2P_FIFO_MAX_DEPTH) {
        const dropped = fifo.shift();
        console.warn(
          "[P2P FIFO] dropped stale interval (catch-up)",
          dropped?.intervalId,
          "fifoDepth was",
          fifo.length + 1
        );
      }
      const peeked = fifo.length > 0 ? fifo[0] : null;
      if (peeked && kiteP2PEngineRef.current) {
        fifo.shift();
        kiteP2PEngineRef.current.loadInterval({
          intervalId: peeked.intervalId,
          intervalFrames: peeked.intervalFrames,
          channelCount: peeked.channelCount,
          sampleRate: peeked.sampleRate,
          buffer: peeked.payload,
        });
        if (!p2pPlaybackActiveRef.current) {
          p2pPlaybackActiveRef.current = true;
          configRef.current.remotePlayback.teardownRemotePlaybackGraph();
          console.log(
            "[P2P HANDOFF] VoIP playback torn down after first loadInterval",
            peeked.intervalId
          );
        }
        console.log(
          "[P2P TICK] loaded remote interval",
          peeked.intervalId,
          "tickSeq",
          tickSeq,
          "fifoRemaining",
          fifo.length
        );
        cb.onAudioIntervalScheduled?.({
          intervalId: peeked.intervalId,
          tickSeq,
          fifoRemaining: fifo.length,
        });
      } else if (tickSeq > 1) {
        console.warn(
          "[P2P TICK] no remote interval queued at tickSeq",
          tickSeq,
          "\u2014 remote audio may be late or dropped"
        );
        cb.onPhaseChange?.(tickSeq);
      }

      if (queuedRemoteKiteIntervalTimeoutRef.current !== null) {
        clearTimeout(queuedRemoteKiteIntervalTimeoutRef.current);
        queuedRemoteKiteIntervalTimeoutRef.current = null;
      }
      const intervalDurationMs = periodSec * 1000;
      queuedRemoteKiteIntervalTimeoutRef.current = window.setTimeout(() => {
        queuedRemoteKiteIntervalTimeoutRef.current = null;
        if (queuedRemoteKiteIntervalRef.current.length === 0) {
          console.warn(
            "[P2P TIMEOUT] remote interval deadline missed after tickSeq",
            tickSeq,
            "\u2014 packet may be lost or network is slow"
          );
        }
      }, intervalDurationMs) as unknown as number;

      nextBoundary += periodSec;
    }
    p2pGridNextBoundaryContextSecRef.current = nextBoundary;
  }, []);

  const startP2PIntervalScheduler = useCallback((timing: KiteIntervalTiming): void => {
    p2pGridPumpGenerationRef.current += 1;
    const gen = p2pGridPumpGenerationRef.current;
    kiteP2PGridPumpRef.current?.teardown();
    kiteP2PGridPumpRef.current = null;

    const periodSec = timing.localIntervalFrames / timing.localSampleRate;
    const ctxInit = configRef.current.audio.getContext();
    if (
      ctxInit &&
      ctxInit.state !== "closed" &&
      Number.isFinite(periodSec) &&
      periodSec > 0
    ) {
      p2pGridNextBoundaryContextSecRef.current = ctxInit.currentTime + periodSec;
    } else {
      p2pGridNextBoundaryContextSecRef.current = null;
      console.warn(
        "[P2P SCHEDULER] AudioContext missing/closed or invalid loop period; grid will arm on first pulse when context is ready."
      );
    }
    p2pGridIntervalIndexRef.current = 0;

    const ctx = configRef.current.audio.getContext();
    if (!ctx || ctx.state === "closed" || ctx.state !== "running") {
      console.warn(
        "[P2P GRID PUMP] AudioContext is not running; grid pump not started. Resume audio first."
      );
      return;
    }

    void (async () => {
      try {
        const pump = await createMetronomePump(ctx, { pumpIntervalSec: 0.01 });
        if (
          gen !== p2pGridPumpGenerationRef.current ||
          configRef.current.audio.getContext()?.state !== "running"
        ) {
          pump.teardown();
          return;
        }
        kiteP2PGridPumpRef.current = pump;
        pump.start(() => {
          advanceP2PGridBoundaries(periodSec);
        });
      } catch (err) {
        console.error("[P2P GRID PUMP] AudioWorklet pump failed:", err);
      }
    })();
  }, [advanceP2PGridBoundaries]);

  startP2PIntervalSchedulerRef.current = startP2PIntervalScheduler;

  const startP2PEngine = useCallback(async (timing: KiteIntervalTiming): Promise<void> => {
    const cfg = configRef.current;
    const cb = callbacksRef.current;

    const ctx = await cfg.audio.ensureContextRunning();
    if (ctx.state !== "running") {
      cb.onAudioContextReadyChange(false);
      throw new Error("AudioContext could not be started for P2P engine.");
    }
    cb.onAudioContextReadyChange(true);

    const destinationNode = cfg.audio.getMasterDestinationNode();
    if (!destinationNode) {
      throw new Error("P2P engine output destination is unavailable.");
    }

    const masterStream = destinationNode.stream;
    const inputStream = cfg.audio.resolveP2PInputStream();
    if (!inputStream || inputStream.getAudioTracks().length === 0) {
      throw new Error("P2P engine input is unavailable (no Kite tap or fallback mic).");
    }
    if (inputStream === destinationNode.stream || inputStream === masterStream) {
      throw new Error("P2P engine input must not be the VoIP master mix.");
    }

    kiteP2PEngineRef.current?.teardown();
    kiteP2PEngineRef.current = null;
    p2pGridPumpGenerationRef.current += 1;
    kiteP2PGridPumpRef.current?.teardown();
    kiteP2PGridPumpRef.current = null;
    kiteP2PSequenceRef.current = 0;
    p2pGridNextBoundaryContextSecRef.current = null;
    p2pGridIntervalIndexRef.current = 0;
    if (queuedRemoteKiteIntervalTimeoutRef.current !== null) {
      clearTimeout(queuedRemoteKiteIntervalTimeoutRef.current);
      queuedRemoteKiteIntervalTimeoutRef.current = null;
    }
    queuedRemoteKiteIntervalRef.current.length = 0;

    const { sessionId, role } = cfg;
    const intervalId = `${sessionId ?? "p2p"}-p2p-${Date.now()}`;

    const inputLatencyMs = KITE_DEFAULT_INPUT_LATENCY_MS;
    const inputNudgeFrames = calcInputNudgeFrames(
      inputLatencyMs,
      timing.localSampleRate,
      timing.localIntervalFrames
    );

    const graph = await buildKiteIntervalGraph({
      audioContext: ctx,
      inputStreams: [{ id: "p2p-mic", stream: inputStream }],
      destinationNode,
      timing,
      intervalId,
      channelCount: 2,
      inputLatencyMs,
      monitorDestination: ctx.destination,
      monitorGain: 1,
      onEvent: (event) => {
        if (event.type !== "INTERVAL_READY") return;
        if (
          kiteModeRef.current !== "broadcast" ||
          cfg.timingInputs.getBroadcastStatus() !== "live"
        ) {
          console.log(
            "[P2P INTERVAL_READY] skipped \u2014 need broadcast mode and live status (kiteMode:",
            kiteModeRef.current,
            "broadcastStatus:",
            cfg.timingInputs.getBroadcastStatus(),
            ")"
          );
          return;
        }
        kiteP2PSequenceRef.current += 1;
        const outboundSeq = kiteP2PSequenceRef.current;
        const liveIntervalId = `p2p-live-${outboundSeq}`;
        const ready = event as KiteIntervalReadyEvent;
        console.log(
          "[P2P INTERVAL_READY] seq",
          outboundSeq,
          "frames:",
          ready.intervalFrames
        );

        const port = cfg.getTransportPort();
        if (!port?.isReady()) {
          console.warn(
            "[P2P INTERVAL_READY] data channel not ready, dropping interval seq",
            outboundSeq
          );
          return;
        }

        void (async () => {
          try {
            const chunks = createLoadIntervalChunks({
              sessionId: sessionId ?? "p2p",
              intervalId: liveIntervalId,
              origin: role ?? "host",
              channelCount: ready.channelCount,
              sampleRate: ready.sampleRate,
              intervalFrames: ready.intervalFrames,
              buffer: ready.buffer,
            });
            for (const chunk of chunks) {
              if (!port.isReady()) {
                console.warn(
                  "[P2P INTERVAL_READY] data channel not ready, dropping interval seq",
                  outboundSeq
                );
                return;
              }
              port.sendBinary(encodeLoadIntervalChunk(chunk));
            }
            console.log(
              "[P2P INTERVAL_READY] sent",
              chunks.length,
              "chunks for",
              liveIntervalId
            );
          } catch (err) {
            console.error(
              "[P2P INTERVAL_READY] send failed for seq",
              outboundSeq,
              err
            );
          }
        })();
      },
    });

    kiteP2PEngineRef.current = graph;
    latestKiteIntervalTimingRef.current = timing;
    kiteModeRef.current = "broadcast";

    console.log("[P2P Engine] record input nudge", {
      inputLatencyMs,
      inputNudgeFrames,
      sampleRate: timing.localSampleRate,
      intervalFrames: timing.localIntervalFrames,
    });

    if (!cfg.voip.isVoipMuted()) {
      cfg.voip.muteLocalVoip();
    }

    cb.onKiteModeChange("broadcast");
    console.log("[P2P Engine] prepared (scheduler not started)", {
      bpm: timing.bpm,
      bpi: timing.bpi,
      intervalId,
    });
  }, []);

  startP2PEngineRef.current = startP2PEngine;

  const reigniteP2PEngine = useCallback(async (timing: KiteIntervalTiming): Promise<void> => {
    const cb = callbacksRef.current;
    latestKiteIntervalTimingRef.current = timing;
    if (!kiteP2PEngineRef.current) {
      await startP2PEngine(timing);
    }
    const timingForScheduler = latestKiteIntervalTimingRef.current ?? timing;
    startP2PIntervalScheduler(timingForScheduler);
    cb.onStartP2PIntervalScheduler?.(timingForScheduler);
  }, [startP2PEngine, startP2PIntervalScheduler]);

  reigniteP2PEngineRef.current = reigniteP2PEngine;

  const applySetIntervalLocally = useCallback(
    (
      timing: KiteIntervalTiming,
      clockAnchorSec: number,
      hasRetainedLoop: boolean
    ): void => {
      const cb = callbacksRef.current;
      cb.onKiteSetupTempoChange(Math.max(20, Math.min(320, Math.round(timing.bpm))));
      cb.onKiteSetupTimeSignatureTopChange(
        Math.max(1, Math.min(16, Math.round(timing.timeSignatureTop)))
      );
      cb.onKiteSetupTimeSignatureBottomChange(
        Math.max(1, Math.min(32, Math.round(timing.timeSignatureBottom)))
      );
      cb.onKiteSetupChordCountChange(
        Math.max(1, Math.min(64, Math.round(timing.chords)))
      );
      cb.onBeatsPerIntervalChange(Math.round(timing.bpi));
      cb.onMetronomeBpmChange(timing.bpm);
      console.log("[SET_INTERVAL] local timing synced from host", {
        bpm: timing.bpm,
        chords: timing.chords,
        timeSignatureTop: timing.timeSignatureTop,
        timeSignatureBottom: timing.timeSignatureBottom,
        clockAnchorSec,
        hasRetainedLoop,
      });
    },
    []
  );

  const sendSetInterval = useCallback(
    (
      timing: KiteIntervalTiming,
      hasRetainedLoop: boolean,
      options?: {
        igniteP2PEngine?: boolean;
        abortIgnition?: boolean;
        enterBroadcastMode?: boolean;
        initiatorId?: string;
      }
    ): void => {
      const port = configRef.current.getTransportPort();
      if (!port?.isReady()) return;

      const clockAnchorSec =
        configRef.current.audio.getContext()?.currentTime ?? 0;
      const payload: SetIntervalMessage = {
        type: "SET_INTERVAL",
        timing,
        clockAnchorSec,
        hasRetainedLoop,
      };
      if (options?.abortIgnition === true) {
        payload.abortIgnition = true;
      } else if (options?.igniteP2PEngine === true) {
        payload.igniteP2PEngine = true;
      }
      if (options?.enterBroadcastMode === true) {
        payload.enterBroadcastMode = true;
      }
      if (typeof options?.initiatorId === "string") {
        payload.initiatorId = options.initiatorId;
      }
      try {
        port.sendJson(payload);
        console.log("[SET_INTERVAL] sent", {
          bpm: timing.bpm,
          bpi: timing.bpi,
          clockAnchorSec,
          hasRetainedLoop,
          igniteP2PEngine: payload.igniteP2PEngine ?? false,
          abortIgnition: payload.abortIgnition ?? false,
          enterBroadcastMode: payload.enterBroadcastMode ?? false,
          initiatorId: payload.initiatorId ?? null,
        });
      } catch {
        console.warn(
          "[SET_INTERVAL] send failed \u2014 peer channel not ready"
        );
      }
    },
    []
  );

  sendSetIntervalRef.current = sendSetInterval;

  const sendRetainedLoopChunks = useCallback(async (): Promise<void> => {
    const retained = configRef.current.retainedLoop.getRetainedKiteLoopBuffer();
    if (!retained) return;

    const port = configRef.current.getTransportPort();
    if (!port?.isReady()) {
      console.warn(
        "[sendRetainedLoopChunks] peer not ready \u2014 retained loop preserved for retry"
      );
      return;
    }

    kiteLoopSendAbortControllerRef.current?.abort("Replacing with new send attempt");
    const abortController = new AbortController();
    kiteLoopSendAbortControllerRef.current = abortController;

    const { sessionId, role } = configRef.current;
    let chunks: ReturnType<typeof createLoadIntervalChunks>;
    try {
      chunks = createLoadIntervalChunks({
        sessionId: sessionId ?? "kite",
        intervalId: retained.intervalId,
        origin: role ?? "host",
        channelCount: retained.channelCount,
        sampleRate: retained.sampleRate,
        intervalFrames: retained.intervalFrames,
        buffer: retained.buffer,
      });
    } catch (err) {
      console.error(
        "[sendRetainedLoopChunks] failed to slice retained loop into chunks:",
        err
      );
      return;
    }
    kiteLoopChunksRef.current = chunks;

    retryRetainedLoopSyncRef.current = () => {
      void sendRetainedLoopChunks();
    };

    try {
      for (const chunk of chunks) {
        if (abortController.signal.aborted) {
          return;
        }
        if (!port.isReady()) {
          console.warn(
            "[sendRetainedLoopChunks] data channel not open \u2014 retained loop preserved for retry"
          );
          return;
        }
        port.sendBinary(encodeLoadIntervalChunk(chunk));
      }
      retryRetainedLoopSyncRef.current = null;
      console.log(
        "[sendRetainedLoopChunks] sent",
        chunks.length,
        "chunks for intervalId",
        retained.intervalId
      );
    } catch (err) {
      if (abortController.signal.aborted) {
        return;
      }
      console.error(
        "[sendRetainedLoopChunks] send failed \u2014 retained loop preserved for retry:",
        err
      );
    }
  }, []);

  const handleLoadIntervalChunk = useCallback((raw: unknown): void => {
    const loadChunk = decodeLoadIntervalChunk(raw);
    if (!loadChunk) {
      return;
    }

    if (!kiteLoopReassemblerRef.current) {
      kiteLoopReassemblerRef.current = new KiteIntervalReassembler();
    }
    const result = kiteLoopReassemblerRef.current.acceptChunk(loadChunk);
    if (result.status === "pending") {
      console.log(
        "[P2P RX] chunk pending",
        result.receivedChunks,
        "/",
        result.totalChunks,
        "key:",
        result.key
      );
    } else if (result.status === "discarded") {
      console.warn("[P2P RX] chunk discarded:", result.reason, "key:", result.key);
    } else if (result.status === "complete") {
      const interval = result.interval;
      const isLive = interval.intervalId.startsWith("p2p-live-");
      if (isLive) {
        if (kiteModeRef.current === "broadcast" && !kiteP2PEngineRef.current) {
          const timing = latestKiteIntervalTimingRef.current;
          if (timing) {
            void reigniteP2PEngineRef.current(timing);
          }
        }
        queuedRemoteKiteIntervalRef.current.push(interval);
      } else {
        retainedRemoteKiteLoopRef.current = interval;
      }
    }
  }, []);

  const handleSetIntervalMessage = useCallback((parsed: SetIntervalMessage): void => {
    if (parsed.abortIgnition === true) {
      const initiator = configRef.current.timingInputs.getSyncInitiatorId();
      if (initiator) {
        teardownKiteSyncSessionRef.current({ notifyPeer: false });
      } else {
        abortStartCountInRef.current({ notifyPeer: false });
      }
      return;
    }

    const timing = parsed.timing;
    const clockAnchorSec =
      typeof parsed.clockAnchorSec === "number" ? parsed.clockAnchorSec : 0;
    const hasRetainedLoop =
      typeof parsed.hasRetainedLoop === "boolean" ? parsed.hasRetainedLoop : false;
    applySetIntervalLocally(timing, clockAnchorSec, hasRetainedLoop);
    latestKiteIntervalTimingRef.current = timing;

    const cb = callbacksRef.current;
    if (parsed.enterBroadcastMode === true) {
      kiteModeRef.current = "broadcast";
      cb.onKiteModeChange("broadcast");
      cb.onStudioUiPhaseChange("studio");
      if (typeof parsed.initiatorId === "string") {
        cb.onSyncInitiatorIdChange(parsed.initiatorId);
      }
    }

    if (parsed.igniteP2PEngine === true) {
      void startP2PEngineRef.current(timing);
    }
  }, [applySetIntervalLocally]);

  const applyPacketLoss = useCallback((packetLossPercent: number | null): void => {
    const cfg = configRef.current;
    const cb = callbacksRef.current;
    const kiteSyncEnabled = cfg.timingInputs.getKiteSyncEnabled();

    if (!kiteSyncEnabled) {
      kiteSyncLossRecoverySinceMsRef.current = null;
      if (kiteSyncLossPauseActiveRef.current) {
        kiteSyncLossPauseActiveRef.current = false;
        kiteSyncLossWaitSequenceRef.current = null;
        kiteSyncGuestSequenceQueueRef.current.length = 0;
        cb.onPacketLossWarningChange(false);
      }
      return;
    }

    if (packetLossPercent === null) {
      kiteSyncLossRecoverySinceMsRef.current = null;
      return;
    }

    if (packetLossPercent > KITE_SYNC_LOSS_PAUSE_PCT) {
      kiteSyncLossRecoverySinceMsRef.current = null;
      if (!kiteSyncLossPauseActiveRef.current) {
        kiteSyncLossPauseActiveRef.current = true;
        kiteSyncLossWaitSequenceRef.current = lastAcceptedKiteSyncSeqRef.current;
        kiteSyncGuestSequenceQueueRef.current.length = 0;
        cfg.metronome.stop?.();
        cb.onPacketLossWarningChange(true);
      }
      return;
    }

    if (!kiteSyncLossPauseActiveRef.current) {
      kiteSyncLossRecoverySinceMsRef.current = null;
      return;
    }

    if (packetLossPercent >= KITE_SYNC_LOSS_RESUME_PCT) {
      kiteSyncLossRecoverySinceMsRef.current = null;
      return;
    }

    const now = performance.now();
    if (kiteSyncLossRecoverySinceMsRef.current === null) {
      kiteSyncLossRecoverySinceMsRef.current = now;
      return;
    }

    if (now - kiteSyncLossRecoverySinceMsRef.current >= KITE_SYNC_LOSS_STABLE_MS) {
      kiteSyncLossPauseActiveRef.current = false;
      kiteSyncLossRecoverySinceMsRef.current = null;
      kiteSyncLossWaitSequenceRef.current = null;
      kiteSyncGuestSequenceQueueRef.current.length = 0;
      cb.onPacketLossWarningChange(false);
      bumpKiteSyncMetronomeResumeNonce();
    }
  }, [bumpKiteSyncMetronomeResumeNonce]);

  const getKiteSyncMetronomeResumeNonce = useCallback(
    (): number => kiteSyncMetronomeResumeNonceRef.current,
    []
  );

  const resetKiteSyncSessionRefs = useCallback((): void => {
    const cb = callbacksRef.current;
    pendingKiteSyncPacketRef.current = null;
    lastAcceptedKiteSyncSeqRef.current = 0;
    syncSequenceRef.current = 0;
    studioRevisionRef.current = 0;
    lastAcceptedStudioRevisionRef.current = 0;
    lastAppliedGuestStartSecRef.current = null;
    lastSyncApplyAtMsRef.current = null;
    kiteGridAnchorContextSecRef.current = null;
    cb.onSyncInitiatorIdChange(null);
  }, []);

  const cleanup = useCallback((opts?: CleanupKiteOpts): void => {
    const isFull = opts?.isFull === true;
    const disableUI = opts?.disableUI === true;
    const cfg = configRef.current;
    const cb = callbacksRef.current;

    p2pPlaybackActiveRef.current = false;
    kiteP2PEngineRef.current?.teardown();
    kiteP2PEngineRef.current = null;
    p2pGridPumpGenerationRef.current += 1;
    kiteP2PGridPumpRef.current?.teardown();
    kiteP2PGridPumpRef.current = null;
    kiteP2PSequenceRef.current = 0;
    if (queuedRemoteKiteIntervalTimeoutRef.current !== null) {
      clearTimeout(queuedRemoteKiteIntervalTimeoutRef.current);
      queuedRemoteKiteIntervalTimeoutRef.current = null;
    }
    queuedRemoteKiteIntervalRef.current.length = 0;
    p2pGridNextBoundaryContextSecRef.current = null;
    p2pGridIntervalIndexRef.current = 0;

    kiteLoopSendAbortControllerRef.current?.abort();
    kiteLoopSendAbortControllerRef.current = null;
    kiteLoopChunksRef.current = null;
    kiteLoopReassemblerRef.current = null;
    retryRetainedLoopSyncRef.current = null;
    cb.onLoopChunkSendErrorChange?.(null);
    cb.onLoopChunkSendProgressChange?.({
      status: "idle",
      sentChunks: 0,
      totalChunks: 0,
    });

    kiteSyncGuestSequenceQueueRef.current.length = 0;
    kiteSyncLossWaitSequenceRef.current = null;
    kiteSyncLossRecoverySinceMsRef.current = null;
    if (kiteSyncLossPauseActiveRef.current) {
      kiteSyncLossPauseActiveRef.current = false;
      cb.onPacketLossWarningChange(false);
    }

    if (isFull) {
      cb.onClearRetainedLoopBuffers?.();
      retainedRemoteKiteLoopRef.current = null;
      if (cfg.voip.isVoipMuted()) {
        restoreLiveVoipAfterKite();
      }
      kiteModeRef.current = "live";
      latestKiteIntervalTimingRef.current = null;
      cb.onKiteModeChange("live");
    }

    if (disableUI) {
      cb.onKiteSyncEnabledChange(false);
      cb.onBroadcastStatusChange("idle");
      cb.onKiteSyncCountInActiveChange(false);
      kiteSyncCountInActiveRef.current = false;
      kiteSyncCountInCompletionHandledRef.current = false;
      kiteSyncCountInEndAtContextSecRef.current = 0;
    }
  }, [restoreLiveVoipAfterKite]);

  cleanupRef.current = cleanup;

  const teardownKiteSyncSession = useCallback(
    (opts?: { notifyPeer?: boolean }): void => {
      const cfg = configRef.current;
      const cb = callbacksRef.current;

      cfg.metronome.stop?.();
      cb.onPartialCleanupKiteEngine();
      cleanupRef.current({ isFull: false, disableUI: true });
      kiteModeRef.current = "live";
      cb.onKiteModeChange("live");
      restoreLiveVoipAfterKite();
      cb.onRestoreLiveVoipAfterKite();
      cb.onRebuildRemotePlaybackGraph();
      cb.onSyncInitiatorIdChange(null);
      cb.onKiteSyncEnabledChange(false);
      cb.onBroadcastStatusChange("idle");
      if (opts?.notifyPeer !== false) {
        const timing =
          latestKiteIntervalTimingRef.current ?? getActiveKiteIntervalTiming();
        if (timing) {
          sendSetIntervalRef.current(timing, false, { abortIgnition: true });
        }
        broadcastKiteSyncRef.current({ kiteSyncEnabled: false });
      }
    },
    [getActiveKiteIntervalTiming, restoreLiveVoipAfterKite]
  );

  teardownKiteSyncSessionRef.current = teardownKiteSyncSession;

  const abortStartCountIn = useCallback(
    (opts?: { notifyPeer?: boolean }): void => {
      const cfg = configRef.current;
      const cb = callbacksRef.current;

      cfg.metronome.stop?.();
      cleanupRef.current({ isFull: false, disableUI: true });
      restoreLiveVoipAfterKite();
      cb.onRestoreLiveVoipAfterKite();
      cb.onRebuildRemotePlaybackGraph();
      cb.onKiteSyncEnabledChange(false);
      cb.onBroadcastStatusChange("idle");

      if (opts?.notifyPeer) {
        const timing =
          latestKiteIntervalTimingRef.current ?? getActiveKiteIntervalTiming();
        if (timing) {
          const hasRetainedLoop = cfg.retainedLoop.getRetainedKiteLoopBuffer() !== null;
          sendSetIntervalRef.current(timing, hasRetainedLoop, { abortIgnition: true });
        }
      }
    },
    [getActiveKiteIntervalTiming, restoreLiveVoipAfterKite]
  );

  abortStartCountInRef.current = abortStartCountIn;

  const stopSync = useCallback((): void => {
    const cfg = configRef.current;
    const cb = callbacksRef.current;

    cfg.metronome.stop?.();
    cb.onBroadcastStatusChange("idle");
    kiteSyncCountInCompletionHandledRef.current = false;
    kiteSyncCountInActiveRef.current = false;
    kiteSyncCountInEndAtContextSecRef.current = 0;
    kiteSyncLossPauseActiveRef.current = false;
    kiteSyncLossRecoverySinceMsRef.current = null;
    kiteSyncLossWaitSequenceRef.current = null;
    kiteSyncGuestSequenceQueueRef.current.length = 0;
    cb.onKiteSyncCountInActiveChange(false);
    cb.onPacketLossWarningChange(false);
    p2pPlaybackActiveRef.current = false;
    resetKiteSyncSessionRefs();
  }, [resetKiteSyncSessionRefs]);

  return useMemo(
    (): KiteSyncEngineApi => ({
      broadcastKiteSync,
      startCountIn,
      startSyncFromToggle,
      onMetronomePumpTick,
      getKiteSyncMetronomeResumeNonce,
      getLastAppliedGuestStartSec,
      getLastSyncApplyAtMs,
      getActiveKiteIntervalTiming,
      dropKiteSyncToLiveP2P: teardownKiteSyncSession,
      flushPendingKiteSyncPacket,
      handleKiteSyncMessage,
      handleSetIntervalMessage,
      handleLoadIntervalChunk,
      sendSetInterval,
      sendRetainedLoopChunks,
      startP2PIntervalScheduler,
      stopSync,
      startP2PEngine,
      reigniteP2PEngine,
      isEngineRunning: () => Boolean(kiteP2PEngineRef.current),
      isP2PPlaybackActive: () => p2pPlaybackActiveRef.current,
      cleanup,
      onPeerDisconnected: noop,
      applyPacketLoss,
    }),
    [
      broadcastKiteSync,
      handleKiteSyncMessage,
      handleSetIntervalMessage,
      handleLoadIntervalChunk,
      sendSetInterval,
      sendRetainedLoopChunks,
      startP2PIntervalScheduler,
      startP2PEngine,
      reigniteP2PEngine,
      applyPacketLoss,
      startCountIn,
      startSyncFromToggle,
      onMetronomePumpTick,
      getKiteSyncMetronomeResumeNonce,
      getLastAppliedGuestStartSec,
      getLastSyncApplyAtMs,
      getActiveKiteIntervalTiming,
      teardownKiteSyncSession,
      flushPendingKiteSyncPacket,
      cleanup,
      stopSync,
    ]
  );
}
