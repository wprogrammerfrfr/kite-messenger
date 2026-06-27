"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
  type MutableRefObject,
} from "react";
import Peer, { type SignalData } from "simple-peer";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { TrackRecorder } from "@/lib/track-recorder";
import {
  calcInputNudgeFrames,
  calcIntervalFrames,
  calcLoopDurationSeconds,
  KITE_DEFAULT_INPUT_LATENCY_MS,
  KITE_TARGET_SAMPLE_RATE,
  type KiteIntervalTiming,
} from "@/lib/kite-interval-math";
import { buildKiteIntervalGraph, type KiteIntervalGraph } from "@/lib/kite-interval-graph";
import {
  buildSoloLooperEngine,
  type SoloLooperEngine,
  type SoloLooperEngineEvent,
  type SoloLooperPlaybackUiStateEvent,
} from "@/lib/solo-looper-engine";
import { useLooperFootPedal } from "@/hooks/useLooperFootPedal";
import {
  createLoadIntervalChunks,
  decodeLoadIntervalChunk,
  KiteDataChannelChunkSender,
  KiteIntervalReassembler,
  type ReassembledLoadInterval,
} from "@/lib/kite-data-chunking";
import { resampleInterleavedFloat32 } from "@/lib/kite-resampler";
import {
  acquireStudioMicStream,
  applyLowLatencyInboundAudioReceivers,
  checkAudioWorkletSupport,
  createLaneGraph,
  decodePeerDataChunk,
  parseSelectedCandidatePairRttMs,
  parseInboundAudioPacketLoss,
  buildPeerConfig,
  fetchTurnCredentialsWithMeta,
  type StereoProbeResult,
} from "@/lib/studio-bridge-webrtc";
import {
  createMetronomePump,
  type MetronomePumpHandle,
} from "@/lib/studio-metronome-pump";
import { useKiteStudioHost } from "@/hooks/useKiteStudioHost";
import { useKiteSyncMetronome } from "@/hooks/useKiteSyncMetronome";
import {
  useKiteP2PEngine,
  type KiteP2PEngineApi,
} from "@/hooks/useKiteP2PEngine";
import {
  startLooperRunway,
  type RunwayDisplayLabel,
} from "@/lib/looper-runway-scheduler";
import { forceMusicModeOpus } from "@/lib/sdp-utils";
import type { BridgeStatus, Role } from "@/lib/p2p/transport-port";
import type { KiteMode } from "@/hooks/useKiteSyncEngine";
import type {
  KiteEngineActions,
  KiteEngineConfig,
  KiteEngineRefs,
  KiteEngineState,
  UseKiteStudioEngineResult,
  KitePresenterState,
  KitePresenterActions,
  KiteEngineLegacyApi,
  StudioUiPhase,
  KiteSetupStep,
  BroadcastStatus,
  SoloLooperState,
  SoloSessionRecorderState,
  JamSetupLock,
  KiteSetupOrigin,
  DeviceFlagMap,
  KiteLoopChunkSendProgress,
  SoloLooperMode,
} from "@/hooks/useKiteStudioEngine.types";











type JamSetupLockAction = "acquire" | "release";


type RetainedKiteLoopBuffer = {
  intervalId: string;
  sequenceNumber: number;
  sampleRate: number;
  intervalFrames: number;
  channelCount: number;
  buffer: ArrayBuffer;
};
type JamSetupLockMessage = {
  type: "JAM_SETUP_LOCK";
  action: JamSetupLockAction;
  ownerId: string;
  ownerName: string;
  expiresAt?: number;
};
type SessionLeaveMessage = {
  type: "LEAVE";
  from: Role;
  room: string;
  at: string;
};
type KiteSyncMessage = {
  type: "KITE_SYNC";
  hostTime: number;
  bpm: number;
  bpi: number;
  enabled: boolean;
  serverTimestamp: number;
  sequenceNumber: number;
  initiatorId: string;
  studioRevision: number;
};
type StudioParamMessage = {
  type: "STUDIO_PARAM";
  originatorId: string;
  studioRevision: number;
  patch: {
    bpm?: number;
    bpi?: number;
    kiteSetupTempo?: number;
    kiteSetupTimeSignatureTop?: number;
    kiteSetupTimeSignatureBottom?: number;
    kiteSetupChordCount?: number;
  };
};
type SessionControlMessage = SessionLeaveMessage | KiteSyncMessage;

type IceCandidateRow = {
  id: string;
  from: Role;
  candidate: SignalData;
};

type StudioSessionRow = {
  session_id: string;
  offer: SignalData | null;
  answer: SignalData | null;
  ice_candidates: IceCandidateRow[] | null;
  host_user_id: string | null;
  guest_user_id: string | null;
};

type SessionHistoryInsert = {
  host_nickname: string;
  guest_nickname: string;
  duration_seconds: number;
};

const ORANGE = "#ff4500";
const EMERALD = "#22c55e";
const OBSIDIAN = "#0c0a09";

/** Shown when `init()` throws; cleared as soon as P2P is actually connected. */
const BRIDGE_INIT_FAIL_NOTE = "Could not initialize studio signaling bridge.";
const P2P_CONNECTED_NOTE = "P2P Connected.";

/** Data-channel ping interval is 2s; three highs ≈ sustained poor latency. */
const HIGH_PING_WARN_MS = 150;
const HIGH_PING_WARN_SAMPLES = 3;

/** Pause Kite metronome when inbound loss exceeds this; resume only after hysteresis (see below). */
const KITE_SYNC_LOSS_PAUSE_PCT = 5;
const KITE_SYNC_LOSS_RESUME_PCT = 3;
/** With 2s `getStats` cadence, 4s ≈ two consecutive samples below resume threshold. */
const KITE_SYNC_LOSS_STABLE_MS = 4000;

/** Remote listen path: Web Audio boost to `AudioContext.destination` (muted `<audio>` keep-alive + gain-based mute). */
const REMOTE_PLAYBACK_VOLUME_MIN = 0.5;
const REMOTE_PLAYBACK_VOLUME_MAX = 4;
const DEFAULT_REMOTE_PLAYBACK_VOLUME = 1;
const REMOTE_COMPRESSOR_THRESHOLD = -12;
const REMOTE_COMPRESSOR_KNEE      = 6;
const REMOTE_COMPRESSOR_RATIO     = 3;
const REMOTE_COMPRESSOR_ATTACK    = 0.003;
const REMOTE_COMPRESSOR_RELEASE   = 0.1;
const SOLO_LATENCY_STORAGE_KEY = "kite_solo_latency_ms";

function clampSoloLatencyMs(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(200, Math.round(value)));
}

const SESSION_VIDEO_MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
] as const;

function selectSessionVideoMediaRecorderOptions(): MediaRecorderOptions {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("MediaRecorder is not available in this environment.");
  }
  for (const mime of SESSION_VIDEO_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return {
        mimeType: mime,
        videoBitsPerSecond: 2_500_000,
        audioBitsPerSecond: 320_000,
      };
    }
  }
  return {
    videoBitsPerSecond: 2_500_000,
    audioBitsPerSecond: 320_000,
  };
}

function stopSoloSessionDisplayTracks(displayStreamRef: { current: MediaStream | null }): void {
  const stream = displayStreamRef.current;
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* ignore */
    }
  }
  displayStreamRef.current = null;
}

/** Linear fade for interface live-monitor duck / restore around Kite broadcast (avoid clicks). */
const BROADCAST_INTERFACE_MONITOR_RAMP_SEC = 0.05;

function rampLinearAudioGain(
  gainParam: AudioParam,
  ctx: AudioContext,
  targetValue: number,
  durationSec: number
): void {
  const t0 = ctx.currentTime;
  const end = t0 + Math.max(0, durationSec);
  gainParam.cancelScheduledValues(t0);
  gainParam.setValueAtTime(gainParam.value, t0);
  gainParam.linearRampToValueAtTime(targetValue, end);
}

/** Single source of truth for session_id casing and shape (6-char A–Z / 0–9). */
function normalizeStudioSessionId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase();
}

function randomSessionId(): string {
  return normalizeStudioSessionId(Math.random().toString(36).slice(2, 8));
}

/** True for Safari/WebKit UAs, false for Chromium-based browsers that also advertise "Safari". */
function isStudioSafariWebKitEngine(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (!/Safari/i.test(ua)) return false;
  if (/Chrome|Chromium|Edg|OPR|Brave/i.test(ua)) return false;
  return true;
}

const MIC_ACCESS_DENIED_COPY =
  "Microphone access denied. Please allow microphone permissions to use the studio.";

function isMicPermissionDeniedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "NotAllowedError" || name === "PermissionDeniedError";
}

function isDeviceBusyError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "NotReadableError" || name === "TrackStartError" || name === "NotFoundError";
}

function addLog(msg: string) {
  console.log(msg);
}

/** ~1s clean sine tone for speaker check (Web Audio API). */
function playTestTone(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const ctx = new AudioContext();
      void ctx.resume().catch(() => {});
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 1);
      window.setTimeout(() => {
        void ctx.close().catch(() => {});
        resolve();
      }, 1050);
    } catch (e) {
      reject(e);
    }
  });
}

type KiteSignalState = "checking" | "secure" | "offline" | "error";

const BASELINE_LEVEL_BAR_HEIGHTS = [0.12, 0.12, 0.12, 0.12, 0.12] as const;

function meterBinsFromFrequencyData(buf: Uint8Array): number[] {
  const step = Math.max(1, Math.floor(buf.length / 5));
  return [0, 1, 2, 3, 4].map((i) => {
    let sum = 0;
    for (let j = 0; j < step; j++) sum += buf[i * step + j] ?? 0;
    return Math.min(1, (sum / step / 255) * 1.85);
  });
}

/**
 * Headless Kite Studio engine hook (Phase 8).
 * Orchestrates audio DSP, WebRTC, looper, and Kite Sync — UI shell wires props only.
 */
export function useKiteStudioEngine(config: KiteEngineConfig): UseKiteStudioEngineResult {
  const { router, ui, onAuthUserChange, onAuthReadyChange } = config;
  const [status, setStatus] = useState<BridgeStatus>("connecting");
  const [statusNote, setStatusNote] = useState("Initializing session...");
  /** Initialization failure copy; cleared on successful P2P `connect` so it never competes with success UI. */
  const [bridgeInitError, setError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  /** Single UI/DB identifier: always the 6-char `session_id` in Supabase (uppercase). */
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [pingMs, setPingMs] = useState<number | null>(null);
  /** Inbound audio loss ratio as 0–100 for display (`getStats` while connected). */
  const [inboundPacketLossPercent, setInboundPacketLossPercent] = useState<number | null>(null);
  /** One-way network latency estimate from ICE RTT (`currentRoundTripTime / 2`). */
  const [calculatedDelayMs, setCalculatedDelayMs] = useState<number | null>(null);
  const [kiteSyncEnabled, setKiteSyncEnabled] = useState(false);
  const kiteSyncEnabledRef = useRef(kiteSyncEnabled);
  const [metronomeBpm, setMetronomeBpm] = useState(120);
  const metronomeBpmRef = useRef(metronomeBpm);
  const [beatsPerInterval, setBeatsPerInterval] = useState(4);
  const [highPingTipOpen, setHighPingTipOpen] = useState(false);
  const [isVisualMetronomeOnly, setIsVisualMetronomeOnly] = useState(false);
  const isVisualMetronomeOnlyRef = useRef(false);
  const [visualActiveBeatInBar, setVisualActiveBeatInBar] = useState<0 | 1 | 2 | 3 | null>(null);
  const [localMicStream, setLocalMicStream] = useState<MediaStream | null>(null);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);
  const [micPermissionHint, setMicPermissionHint] = useState<string | null>(null);
  const [micSyncTimedOut, setMicSyncTimedOut] = useState(false);
  const [audioTestDone, setAudioTestDone] = useState(false);
  const [audioTestPlaying, setAudioTestPlaying] = useState(false);
  const [audioTestFailed, setAudioTestFailed] = useState(false);
  const [echoSafetyMode, setEchoSafetyMode] = useState(false);
  const [kiteSignal, setKiteSignal] = useState<KiteSignalState>("checking");
  const [studioUiPhase, setStudioUiPhase] = useState<StudioUiPhase>("lobby");
  const studioUiPhaseRef = useRef<StudioUiPhase>("lobby");
  const [isBufferingEnabled, setIsBufferingEnabled] = useState(false);
  const [isWorkletLoaded, setIsWorkletLoaded] = useState(false);
  const [bufferDepthFrames, setBufferDepthFrames] = useState(0);
  const [targetLeadFrames, setTargetLeadFrames] = useState(4800);
  const [isAutoBuffer, setIsAutoBuffer] = useState(true);
  const [isBufferPrimed, setIsBufferPrimed] = useState(false);
  const [lastCorrectionEvent, setLastCorrectionEvent] = useState<"drop" | "dupe" | "none">(
    "none"
  );
  const [roomCopyNote, setRoomCopyNote] = useState<string | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [remoteLevel, setRemoteLevel] = useState(0);
  /** Remote level bars driven by tap on studio playback graph (no third MediaStreamAudioSource). */
  const [remoteMeterHeights, setRemoteMeterHeights] = useState<number[]>(() => [
    ...BASELINE_LEVEL_BAR_HEIGHTS,
  ]);
  const [remoteMeterTapActive, setRemoteMeterTapActive] = useState(false);
  /** Bumps on graph teardown/build so the meter rAF effect restarts even if `remoteMeterTapActive` stays true. */
  const [remoteMeterRafKey, setRemoteMeterRafKey] = useState(0);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [remotePlaybackVolume, setRemotePlaybackVolume] = useState(
    DEFAULT_REMOTE_PLAYBACK_VOLUME
  );
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTimeMs, setRecordingTimeMs] = useState(0);
  const [recordedBlobUrl, setRecordedBlobUrl] = useState<string | null>(null);
  const [recordedDownloadExt, setRecordedDownloadExt] = useState<"webm" | "m4a" | "aac" | "bin">("webm");
  const [confirmExitOpen, setConfirmExitOpen] = useState(false);
  const [collaboratorLeft, setCollaboratorLeft] = useState(false);
  const [remoteParticipantName, setRemoteParticipantName] = useState<string | null>(null);
  const [lastDepartedParticipantName, setLastDepartedParticipantName] = useState<string | null>(null);
  const [connectionLostCountdown, setConnectionLostCountdown] = useState<number | null>(null);
  const [retryInitTick, setRetryInitTick] = useState(0);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [audioContextReady, setAudioContextReady] = useState(false);
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeDeviceIds, setActiveDeviceIds] = useState<string[]>([]);
  const [deviceVolumes, setDeviceVolumes] = useState<Record<string, number>>({});
  /** Per physical input: 1 = mono UI (`:ch0` only); 2 = dual lane faders. Populated from mixer probe in Phase 3. */
  const [deviceInputChannelCount, setDeviceInputChannelCount] = useState<Record<string, 1 | 2>>({});
  const [interfaceInputDeviceFlags, setInterfaceInputDeviceFlags] = useState<DeviceFlagMap>({});
  const [interfaceLiveMonitorEnabledFlags, setInterfaceLiveMonitorEnabledFlags] = useState<DeviceFlagMap>({});
  const [devicePanelOpen, setDevicePanelOpen] = useState(false);
  const [kiteSetupStep, setKiteSetupStep] = useState<KiteSetupStep>(1);
  const [kiteSetupTimeSignatureTop, setKiteSetupTimeSignatureTop] = useState(4);
  const [kiteSetupTimeSignatureBottom, setKiteSetupTimeSignatureBottom] = useState(4);
  const [kiteSetupIsSwing, setKiteSetupIsSwing] = useState(false);
  const [kiteSetupChordCount, setKiteSetupChordCount] = useState(4);
  const [kiteSetupUsesCustomChords, setKiteSetupUsesCustomChords] = useState(false);
  const [kiteSetupTempo, setKiteSetupTempo] = useState(120);
  const [kiteSetupOrigin, setKiteSetupOrigin] = useState<KiteSetupOrigin>("lobby");
  const [kiteSetupMode, setKiteSetupMode] = useState<KiteMode>("solo");
  const [kiteSetupError, setKiteSetupError] = useState<string | null>(null);
  const [kiteMode, setKiteMode] = useState<KiteMode>("live");
  const [broadcastStatus, setBroadcastStatus] = useState<BroadcastStatus>("idle");
  const [jamSetupLock, setJamSetupLock] = useState<JamSetupLock>(null);
  const [soloLooperState, setSoloLooperState] = useState<SoloLooperState>("idle");
  const [loopProgress, setLoopProgress] = useState(0);
  const [isRecordingArmed, setIsRecordingArmed] = useState(false);
  const [recordingArmedCountdown, setRecordingArmedCountdown] = useState<number | null>(null);
  /** Solo 4-beat runway: 3 → 2 → 1 → GO, driven by `startLooperRunway`. */
  const [soloRunwayDisplay, setSoloRunwayDisplay] = useState<RunwayDisplayLabel | null>(null);
  /** Latest per-slot snapshot from solo worklet (playback/recording cursors). */
  const [soloTrackSlotUi, setSoloTrackSlotUi] = useState<SoloLooperPlaybackUiStateEvent["slots"] | null>(
    null
  );
  /** Linear 0–1 fader values per track (UI + engine). */
  const [soloTrackVolumes, setSoloTrackVolumes] = useState<[number, number, number, number]>([
    1, 1, 1, 1,
  ]);
  /** Track 1 closed loop length in frames (drives overdub arm + snapping UI). */
  const [soloMasterLoopFrames, setSoloMasterLoopFrames] = useState<number | null>(null);
  /** Temporary RTL calibration control for hardware Clap Test. */
  const [soloLooperLatencyMs, setSoloLooperLatencyMs] = useState(0);
  /** UI 0–10 recording input gain for solo looper only (5 = unity; maps to DSP 0.0–2.0). */
  const [soloInputGain, setSoloInputGain] = useState(5);
  const soloLooperLatencyMsRef = useRef(soloLooperLatencyMs);
  const soloLatencyPersistenceReadyRef = useRef(false);
  const [soloLatencyCalibrationStatus, setSoloLatencyCalibrationStatus] = useState<
    "idle" | "warning" | "listening" | "success" | "error"
  >("idle");
  const [soloLatencyCalibrationMessage, setSoloLatencyCalibrationMessage] = useState<string | null>(
    null
  );
  const [soloLooperMode, setSoloLooperMode] = useState<SoloLooperMode>("free");
  const soloLooperModeRef = useRef(soloLooperMode);
  const [handsfreeSequenceActive, setHandsfreeSequenceActive] = useState(false);
  const handsfreeSequenceActiveRef = useRef(false);
  const [soloLooperBarCount, setSoloLooperBarCount] = useState<number>(1);
  const soloLooperBarCountRef = useRef(soloLooperBarCount);
  const kiteSetupTempoRef = useRef(kiteSetupTempo);
  const kiteSetupTimeSignatureTopRef = useRef(kiteSetupTimeSignatureTop);
  /** Lane the spacebar / foot pedal arms (1–4); kept in sync with `soloPedalTargetTrackIndexRef`. */
  const [focusedTrackIndex, setFocusedTrackIndex] = useState<1 | 2 | 3 | 4>(1);
  /** Secondary track index (2–4) armed for quantized overdub; recording starts on Track 1 loop wrap. */
  const [soloOverdubArmedTrackIndex, setSoloOverdubArmedTrackIndex] = useState<number | null>(null);
  const [soloActiveRecordTrackIndex, setSoloActiveRecordTrackIndex] = useState<number | null>(null);
  const [isMasterPaused, setIsMasterPaused] = useState(false);
  const [soloSessionRecorderState, setSoloSessionRecorderState] =
    useState<SoloSessionRecorderState>("idle");
  const [loopChunkSendError, setLoopChunkSendError] = useState<string | null>(null);
  const [loopChunkSendProgress, setLoopChunkSendProgress] = useState<KiteLoopChunkSendProgress>({
    status: "idle",
    sentChunks: 0,
    totalChunks: 0,
  });
  /** One-bar count-in after Kite Sync enables; blocks unmute and playback level changes until the grid stabilizes. */
  const [kiteSyncCountInActive, setKiteSyncCountInActive] = useState(false);
  /** User id (or stable fallback) of the peer that started the current Kite Sync session. */
  const [syncInitiatorId, setSyncInitiatorId] = useState<string | null>(null);
  /** Bumps when resuming metronome after network-loss pause (forces scheduler re-init). */
  const [kiteSyncMetronomeResumeNonce, setKiteSyncMetronomeResumeNonce] = useState(0);
  /** True while metronome is stopped due to inbound loss hysteresis (UX hint). */
  const [kiteSyncNetworkMetronomePaused, setKiteSyncNetworkMetronomePaused] = useState(false);
  const [metronomeVolume, setMetronomeVolume] = useState(0.85);
  const isInStudioPhase = studioUiPhase === "studio";

  const micDeniedThisInitRef = useRef(false);

  const peerRef = useRef<Peer.Instance | null>(null);
  /** Underlying PC for `getStats` polling; cleared with peer teardown. */
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  /** Wall-clock expiry (ms) for current TURN bundle when `/api/turn-credentials` provides it. */
  const turnCredentialExpiresAtMsRef = useRef<number | null>(null);
  /** When the active TURN bundle was fetched (ms since epoch). */
  const turnCredentialFetchedAtMsRef = useRef<number | null>(null);
  const turnCredentialRefreshTimerRef = useRef<number | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const speakerMutedRef = useRef(false);
  const remotePlaybackVolumeRef = useRef(DEFAULT_REMOTE_PLAYBACK_VOLUME);
  const localMonitorAudioRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const mixerGainNodesRef = useRef<Map<string, GainNode>>(new Map());
  const mixerAnalyserNodesRef = useRef<Map<string, AnalyserNode>>(new Map());
  const mixerSourceNodesRef = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());
  const mixerSplitterNodesRef = useRef<Map<string, ChannelSplitterNode>>(new Map());
  const mixerMergerNodesRef = useRef<Map<string, ChannelMergerNode>>(new Map());
  const mixerLaneProbeRef = useRef<Map<string, StereoProbeResult>>(new Map());
  const mixerTeardownOriginRef = useRef<"none" | "performTeardown">("none");
  /** Raw primary mic → gain → destination; WebRTC sender uses this stream only (never the multi-input master mix). */
  const voipOutgoingDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const voipOutgoingGainRef = useRef<GainNode | null>(null);
  const voipOutgoingSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const activeDeviceIdsRef = useRef<string[]>([]);
  const interfaceInputDeviceFlagsRef = useRef<DeviceFlagMap>({});
  const interfaceLiveMonitorEnabledFlagsRef = useRef<DeviceFlagMap>({});
  const interfaceLiveMonitorSourceNodesRef = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());
  const interfaceLiveMonitorGainNodesRef = useRef<Map<string, GainNode>>(new Map());
  const perChannelMeterRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const masterLiveMeterElementRef = useRef<HTMLDivElement | null>(null);
  const soloMeterElementRef = useRef<HTMLDivElement | null>(null);
  const localRecorderRef = useRef<TrackRecorder | null>(null);
  const recordingIntervalRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<number | null>(null);
  const handshakeFallbackIntervalRef = useRef<number | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const mountedRef = useRef(true);
  const statusRef = useRef<BridgeStatus>("connecting");
  /** Set synchronously in `peer.on('connect')` so init's `catch` cannot run after P2P success but before `statusRef` updates. */
  const p2pConnectSucceededRef = useRef(false);
  const appliedRemoteSignalRef = useRef(false);
  const seenIceRef = useRef<Set<string>>(new Set());
  const cleanupSessionRef = useRef<(() => Promise<void>) | null>(null);
  const iceAppendQueueRef = useRef<Promise<void>>(Promise.resolve());
  const existingRowRef = useRef<StudioSessionRow | null>(null);
  /** Idempotent mic / peer / Realtime teardown (explicit leave + unmount). */
  const bridgeTeardownRef = useRef<(() => void) | null>(null);
  /** Shared guard: prevents duplicate full teardown across confirmEndSession, disconnect, and unmount. */
  const sessionTeardownRanRef = useRef(false);
  const leaveSignalSentRef = useRef(false);
  const leaveSignalReceivedRef = useRef(false);
  /** Mirrors `activeRole` from bridge init so `performTeardown` can send `{ type, from }` over the data channel. */
  const bridgeActiveRoleRef = useRef<Role | null>(null);
  /** Host: latest teardown when the P2P peer drops during Kite (avoids stale `buildTransport` closures). */
  const hostExitKiteBroadcastOnPeerDisconnectRef = useRef<() => void>(() => {});
  const lostCountdownIntervalRef = useRef<number | null>(null);
  const sessionStartedAtRef = useRef<number | null>(null);
  const historySavedRef = useRef(false);
  /** Prevents overlapping inits; cleared on effect cleanup so remount can proceed. */
  const bridgeInitInFlightRef = useRef(false);
  const mixerRebuildInFlightRef = useRef(false);
  const buildTransportRef = useRef<((localStream: MediaStream, ctx: AudioContext) => Promise<void>) | null>(
    null
  );
  const initNetworkSessionRef = useRef<(() => Promise<void>) | null>(null);
  /** Set after `initNetworkSession` completes Phase 2+3 reservation (transportSessionId + row). */
  const studioSessionReservedRef = useRef(false);
  /** Mic-init early bootstrap; Enter Studio awaits this before calling `initNetworkSession` again. */
  const sessionBootstrapPromiseRef = useRef<Promise<void> | null>(null);
  const startP2PEngineRef = useRef<((timing: KiteIntervalTiming) => Promise<void>) | null>(null);
  const kiteIntervalTimingRef = useRef<KiteIntervalTiming | null>(null);
  /** Timing last used to build the P2P interval graph; consumed when igniting the scheduler after count-in. */
  const latestKiteIntervalTimingRef = useRef<KiteIntervalTiming | null>(null);
  const startP2PIntervalSchedulerRef = useRef<((timing: KiteIntervalTiming) => void) | null>(null);
  const soloLooperEngineRef = useRef<SoloLooperEngine | null>(null);
  const kiteP2PEngineRef = useRef<KiteIntervalGraph | null>(null);
  const kiteP2PGridPumpRef = useRef<MetronomePumpHandle | null>(null);
  /** Bumps when P2P grid pump is superseded or torn down so stale async loads cannot attach. */
  const p2pGridPumpGenerationRef = useRef(0);
  const kiteP2PSequenceRef = useRef(0);
  /** Next P2P grid boundary in `AudioContext` seconds; advanced from the grid AudioWorklet pump using audio clock. */
  const p2pGridNextBoundaryContextSecRef = useRef<number | null>(null);
  /** Monotonic count of audio-grid boundaries processed for this scheduler run (logging / warnings). */
  const p2pGridIntervalIndexRef = useRef(0);
  const queuedRemoteKiteIntervalRef = useRef<ReassembledLoadInterval[]>([]);
  const queuedRemoteKiteIntervalTimeoutRef = useRef<number | null>(null);
  const retryRetainedLoopSyncRef = useRef<(() => void) | null>(null);
  const kiteModeRef = useRef<KiteMode>("live");
  /** Tracks prior `kiteMode` so we can ramp interface live monitors back after leaving broadcast. */
  const prevKiteModeForBroadcastMonitorRef = useRef<KiteMode | null>(null);
  const broadcastStatusRef = useRef<BroadcastStatus>("idle");
  const isBroadcastConnectPendingRef = useRef(false);
  const retainedKiteLoopBufferRef = useRef<RetainedKiteLoopBuffer | null>(null);
  const retainedRemoteKiteLoopRef = useRef<ReassembledLoadInterval | null>(null);
  const lastRetainedKiteIntervalIdRef = useRef<string | null>(null);
  const lastRetainedKiteSequenceRef = useRef<number | null>(null);
  const hasCapturedFirstKiteLoopRef = useRef(false);
  const soloLooperStateRef = useRef<SoloLooperState>("idle");
  /** Snapshot of BPM at recording start; used by commitActiveRecording to avoid desync in grid mode. */
  const recordingStartBpmRef = useRef<number>(120);
  /** Frame length of Track 1 after first close; Tracks 2–4 sync to this (P5-05+). */
  const masterLoopIntervalFramesRef = useRef<number | null>(null);
  /** Solo worklet track index (1–4) while `startRecording` is active; null when idle (spacebar tap-to-toggle). */
  const soloLooperActiveRecordTrackIndexRef = useRef<number | null>(null);
  /** True between tap-stop `stopRecording` and worklet `LOOP_READY` (blocks double-finalize). */
  const soloLooperLoopFinalizePendingRef = useRef(false);
  /** Stop tapped before solo engine finished booting; flushed after `startRecording`. */
  const soloLooperPendingCommitRef = useRef(false);
  const commitActiveRecordingRef = useRef<() => void>(() => {});
  const soloLooperLiveLoopIdRef = useRef<string | null>(null);
  const soloLooperEventIntervalIdRef = useRef<string | null>(null);
  const soloLooperEventSequenceNumberRef = useRef<number>(0);
  const isMasterPausedRef = useRef(false);
  const soloSessionMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const soloSessionChunksRef = useRef<BlobPart[]>([]);
  const soloSessionDisplayStreamRef = useRef<MediaStream | null>(null);
  const soloMetronomeLastBeatRef = useRef<number | null>(null);
  const soloMetronomeAnchorContextSecRef = useRef<number | null>(null);
  /** Spacebar routes to this track (1–4) on pedal down; lane arms sync this ref. */
  const soloPedalTargetTrackIndexRef = useRef(1);
  /** Overdub track (2–4) armed in worklet, waiting for Track 1 downbeat. */
  const soloOverdubArmedTrackIndexRef = useRef<number | null>(null);
  /** Latest worklet slot snapshot (mirrors `PLAYBACK_UI_STATE`). */
  const soloTrackSlotUiLatestRef = useRef<SoloLooperPlaybackUiStateEvent["slots"] | null>(null);

  const applyPedalFocus = useCallback((trackIndex: 1 | 2 | 3 | 4) => {
    soloPedalTargetTrackIndexRef.current = trackIndex;
    setFocusedTrackIndex(trackIndex);
  }, []);

  const syncActiveRecordTrackIndex = useCallback((trackIndex: number | null) => {
    soloLooperActiveRecordTrackIndexRef.current = trackIndex;
    setSoloActiveRecordTrackIndex(trackIndex);
  }, []);

  const syncHandsfreeSequenceActive = useCallback((active: boolean) => {
    handsfreeSequenceActiveRef.current = active;
    setHandsfreeSequenceActive(active);
  }, []);

  const loopProgressRafRef = useRef<number | null>(null);
  const soloTrackVolumesRef = useRef<[number, number, number, number]>([1, 1, 1, 1]);
  const isRecordingArmedRef = useRef(false);
  /** Solo looper 4-beat runway: metronome pump tick; transport arms after beat 4 via `startLooperRunway`. */
  const soloCountInPumpRef = useRef<MetronomePumpHandle | null>(null);
  const soloCountInPumpGenerationRef = useRef(0);
  const soloCountInEndAtContextSecRef = useRef(0);
  const soloCountInBeatSecRef = useRef(0);
  const soloCountInDownbeatRafRef = useRef<number | null>(null);
  const soloRunwayGoClearTimerRef = useRef<number | null>(null);
  const scheduledMetronomeOscillatorsRef = useRef<Set<OscillatorNode>>(new Set());
  const kiteLoopChunksRef = useRef<ReturnType<typeof createLoadIntervalChunks> | null>(null);
  const kiteLoopChunkSenderRef = useRef<KiteDataChannelChunkSender | null>(null);
  const kiteLoopReassemblerRef = useRef<KiteIntervalReassembler | null>(null);
  const kiteLoopSendAbortControllerRef = useRef<AbortController | null>(null);
  const jamSetupLockTokenRef = useRef<string | null>(null);
  const jamSetupLockExpiresAtRef = useRef<number | null>(null);
  const jamSetupLockTimerRef = useRef<number | null>(null);
  const workletLoadPromiseRef = useRef<Promise<boolean> | null>(null);
  const workletLoadedContextRef = useRef<AudioContext | null>(null);
  const lastWorkletTelemetryAtMsRef = useRef(0);
  const targetLeadFramesDebounceRef = useRef<number | null>(null);
  const remotePlaybackSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const remoteBufferNodeRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null);
  const remotePlaybackDelayRef = useRef<DelayNode | null>(null);
  const remotePlaybackGainRef = useRef<GainNode | null>(null);
  const remotePlaybackAnalyserRef = useRef<AnalyserNode | null>(null);
  /** Zero-gain sink so the analyser branch is pulled by the audio engine without audible bleed. */
  const remotePlaybackMeterSinkRef = useRef<GainNode | null>(null);
  const remotePlaybackCompressorRef = useRef<DynamicsCompressorNode | null>(null);
  const metronomeVolumeRef = useRef(0.85);
  const metronomeBlinkElementRef = useRef<HTMLDivElement | null>(null);
  const highPingStreakRef = useRef(0);
  const highPingTipDismissedRef = useRef(false);
  const calculatedDelayMsRef = useRef<number | null>(null);
  const kiteSyncSequenceRef = useRef(0);
  const pendingKiteSyncRef = useRef<KiteSyncMessage | null>(null);
  const lastAcceptedKiteSyncSeqRef = useRef(0);
  const syncInitiatorIdRef = useRef<string | null>(null);
  const studioRevisionRef = useRef(0);
  const lastAcceptedStudioRevisionRef = useRef(0);
  const studioParamPendingPatchRef = useRef<StudioParamMessage["patch"]>({});
  const studioParamDebounceTimerRef = useRef<number | null>(null);
  const lastAppliedGuestStartSecRef = useRef<number | null>(null);
  const lastSyncApplyAtMsRef = useRef<number | null>(null);
  const kiteSyncCountInEndAtContextSecRef = useRef(0);
  /** Permanent downbeat anchor in `AudioContext` seconds; set once at count-in → live. */
  const kiteGridAnchorContextSecRef = useRef<number | null>(null);
  /** Mirrors `kiteSyncCountInActive` for metronome pump callbacks (avoids stale closures). */
  const kiteSyncCountInActiveRef = useRef(false);
  /** Prevents duplicate count-in completion when `pumpScheduler` runs multiple times past `endAt`. */
  const kiteSyncCountInCompletionHandledRef = useRef(false);
  const kiteSyncLossPauseActiveRef = useRef(false);
  const kiteSyncLossRecoverySinceMsRef = useRef<number | null>(null);
  const applyKiteSyncLossGuardRef = useRef<(packetLossPercent: number | null) => void>(
    () => {}
  );
  const tapBeatTimestampsRef = useRef<number[]>([]);
  const echoModeApplyingRef = useRef(false);
  const previousEchoSafetyModeRef = useRef(echoSafetyMode);
  const isMicMutedRef = useRef(isMicMuted);
  const isBufferingEnabledRef = useRef(isBufferingEnabled);
  const isWorkletLoadedRef = useRef(isWorkletLoaded);
  const targetLeadFramesRef = useRef(targetLeadFrames);
  const isAutoBufferRef = useRef(true);
  const deviceVolumesRef = useRef(deviceVolumes);
  const deviceInputChannelCountRef = useRef(deviceInputChannelCount);
  const localMicStreamRef = useRef<MediaStream | null>(null);
  const loadWorkletRef = useRef<(ctx: AudioContext) => Promise<void>>(async () => {});
  const resetWorkletRef = useRef<() => void>(() => {});
  const p2pEngineRef = useRef<KiteP2PEngineApi | null>(null);
  const stopKiteMetronomeRef = useRef<() => void>(() => {});

  const kiteStudioHost = useKiteStudioHost({
    onAudioContextReadyChange: setAudioContextReady,
    loadWorkletRef,
    resetWorkletRef,
    activeDeviceIdsRef,
    localMicStreamRef,
  });
  const studioAudioContextRef =
    kiteStudioHost.studioAudioContextRef as MutableRefObject<AudioContext | null>;
  const ensureStudioAudioContext = kiteStudioHost.ensureContext;
  const getStudioAudioContext = kiteStudioHost.getContext;
  const getStudioKiteSampleRate = kiteStudioHost.getSampleRate;
  const closeStudioAudioContext = kiteStudioHost.closeContext;
  const ensureMasterDestinationNode = kiteStudioHost.ensureMasterDestination;
  const teardownHostMasterDestination = kiteStudioHost.teardownMasterDestination;
  const mixerMasterDestinationRef =
    kiteStudioHost.mixerMasterDestinationRef as MutableRefObject<MediaStreamAudioDestinationNode | null>;
  const mixerMasterStreamRef =
    kiteStudioHost.mixerMasterStreamRef as MutableRefObject<MediaStream | null>;
  const mixerKiteTapDestinationRef =
    kiteStudioHost.mixerKiteTapDestinationRef as MutableRefObject<MediaStreamAudioDestinationNode | null>;
  const mixerKiteTapStreamRef =
    kiteStudioHost.mixerKiteTapStreamRef as MutableRefObject<MediaStream | null>;
  const activeStreamsMapRef =
    kiteStudioHost.activeStreamsMapRef as MutableRefObject<Map<string, MediaStream>>;
  const resolveSoloLooperInputStream = kiteStudioHost.resolveSoloLooperInputStream;
  const mutedVoipCloneTrackRef =
    kiteStudioHost.mutedVoipCloneTrackRef as MutableRefObject<MediaStreamTrack | null>;
  const originalVoipSenderTrackRef =
    kiteStudioHost.originalVoipSenderTrackRef as MutableRefObject<MediaStreamTrack | null>;
  const voipSenderMutedForKiteRef =
    kiteStudioHost.voipSenderMutedForKiteRef as MutableRefObject<boolean>;
  const runSynchronousHardwareKillSwitch = kiteStudioHost.runSynchronousHardwareKillSwitch;
  const hardwareKillSwitchActiveRef =
    kiteStudioHost.hardwareKillSwitchActiveRef as MutableRefObject<boolean>;
  const ensureStudioAudioContextRef = kiteStudioHost.ensureStudioAudioContextRef;
  const ensureMasterDestinationNodeRef = kiteStudioHost.ensureMasterDestinationNodeRef;
  const audioBaseLatencySecRef =
    kiteStudioHost.audioBaseLatencySecRef as MutableRefObject<number>;
  const audioOutputLatencySecRef =
    kiteStudioHost.audioOutputLatencySecRef as MutableRefObject<number>;

  useEffect(() => {
    isMicMutedRef.current = isMicMuted;
  }, [isMicMuted]);

  useEffect(() => {
    soloLooperStateRef.current = soloLooperState;
  }, [soloLooperState]);

  useEffect(() => {
    isMasterPausedRef.current = isMasterPaused;
  }, [isMasterPaused]);

  useEffect(() => {
    soloTrackVolumesRef.current = soloTrackVolumes;
  }, [soloTrackVolumes]);

  useEffect(() => {
    soloLooperLatencyMsRef.current = soloLooperLatencyMs;
  }, [soloLooperLatencyMs]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(SOLO_LATENCY_STORAGE_KEY);
      if (raw !== null) {
        const parsed = Number(raw);
        const clamped = clampSoloLatencyMs(parsed);
        setSoloLooperLatencyMs(clamped);
      }
    } catch {
      /* ignore storage read errors */
    } finally {
      soloLatencyPersistenceReadyRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!soloLatencyPersistenceReadyRef.current || typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(SOLO_LATENCY_STORAGE_KEY, String(clampSoloLatencyMs(soloLooperLatencyMs)));
    } catch {
      /* ignore storage write errors */
    }
  }, [soloLooperLatencyMs]);

  useEffect(() => {
    soloLooperModeRef.current = soloLooperMode;
  }, [soloLooperMode]);

  useEffect(() => {
    soloLooperBarCountRef.current = soloLooperBarCount;
  }, [soloLooperBarCount]);

  useEffect(() => {
    kiteSetupTempoRef.current = kiteSetupTempo;
  }, [kiteSetupTempo]);

  useEffect(() => {
    kiteSetupTimeSignatureTopRef.current = kiteSetupTimeSignatureTop;
  }, [kiteSetupTimeSignatureTop]);

  useEffect(() => {
    kiteModeRef.current = kiteMode;
  }, [kiteMode]);

  useEffect(() => {
    studioUiPhaseRef.current = studioUiPhase;
  }, [studioUiPhase]);

  useEffect(() => {
    broadcastStatusRef.current = broadcastStatus;
  }, [broadcastStatus]);

  useEffect(() => {
    kiteSyncEnabledRef.current = kiteSyncEnabled;
  }, [kiteSyncEnabled]);

  useEffect(() => {
    metronomeBpmRef.current = metronomeBpm;
  }, [metronomeBpm]);

  useEffect(() => {
    kiteSyncCountInActiveRef.current = kiteSyncCountInActive;
  }, [kiteSyncCountInActive]);

  useEffect(() => {
    if (kiteSyncCountInActive) {
      kiteSyncCountInCompletionHandledRef.current = false;
    }
  }, [kiteSyncCountInActive]);

  useEffect(() => {
    isRecordingArmedRef.current = isRecordingArmed;
  }, [isRecordingArmed]);

  useEffect(() => {
    isBufferingEnabledRef.current = isBufferingEnabled;
  }, [isBufferingEnabled]);

  useEffect(() => {
    isWorkletLoadedRef.current = isWorkletLoaded;
  }, [isWorkletLoaded]);

  useEffect(() => {
    isVisualMetronomeOnlyRef.current = isVisualMetronomeOnly;
    const engine = soloLooperEngineRef.current;
    const bpm = kiteIntervalTimingRef.current?.bpm || 120;

    // Check if Track 1 is the track currently being recorded
    const isTrack1Recording =
      soloLooperState === "recording" && soloLooperActiveRecordTrackIndexRef.current === 1;

    if (engine && !isMasterPaused) {
      if (isTrack1Recording && !isVisualMetronomeOnly) {
        engine.startAudibleMetronome(bpm);
      } else {
        // Explicitly stop the metronome for overdubs, visual-only mode, or idle state
        engine.stopAudibleMetronome();
      }
    }
  }, [isVisualMetronomeOnly, soloLooperState, isMasterPaused]);

  useEffect(() => {
    const engine = soloLooperEngineRef.current;
    if (!engine) return;
    const ctx = engine.inputGain.context as AudioContext;
    engine.inputGain.gain.setTargetAtTime((soloInputGain / 10) * 2, ctx.currentTime, 0.01);
  }, [soloInputGain]);

  useEffect(() => {
    if (kiteMode !== "solo" || studioUiPhase !== "studio") {
      return;
    }
    let rafId = 0;
    const tick = (): void => {
      const analyser = soloLooperEngineRef.current?.inputAnalyserNode;
      const meterEl = soloMeterElementRef.current;
      if (analyser && meterEl) {
        const buf = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i += 1) {
          const sample = buf[i] ?? 0;
          if (sample > peak) peak = sample;
        }
        meterEl.style.height = `${Math.min(100, (peak / 255) * 100)}%`;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [kiteMode, studioUiPhase]);

  useEffect(() => {
    targetLeadFramesRef.current = targetLeadFrames;
  }, [targetLeadFrames]);

  useEffect(() => {
    isAutoBufferRef.current = isAutoBuffer;
  }, [isAutoBuffer]);

  useEffect(() => {
    deviceVolumesRef.current = deviceVolumes;
  }, [deviceVolumes]);

  useEffect(() => {
    deviceInputChannelCountRef.current = deviceInputChannelCount;
  }, [deviceInputChannelCount]);

  useEffect(() => {
    interfaceInputDeviceFlagsRef.current = interfaceInputDeviceFlags;
  }, [interfaceInputDeviceFlags]);

  useEffect(() => {
    interfaceLiveMonitorEnabledFlagsRef.current = interfaceLiveMonitorEnabledFlags;
  }, [interfaceLiveMonitorEnabledFlags]);

  useEffect(() => {
    localMicStreamRef.current = localMicStream;
  }, [localMicStream]);

  const stopMediaStreamTracks = useCallback(
    (stream: MediaStream | null | undefined, seenTrackIds: Set<string>) => {
      if (!stream) return;
      for (const track of stream.getTracks()) {
        if (seenTrackIds.has(track.id)) continue;
        seenTrackIds.add(track.id);
        track.onended = null;
        track.stop();
      }
    },
    []
  );

  useEffect(() => {
    activeDeviceIdsRef.current = activeDeviceIds;
  }, [activeDeviceIds]);

  useEffect(() => {
    let rafId = 0;

    const tick = () => {
      const activeLaneKeys = new Set(mixerAnalyserNodesRef.current.keys());
      let maxPeakPct = 0;

      for (const [laneKey, el] of Array.from(perChannelMeterRefs.current.entries())) {
        if (!activeLaneKeys.has(laneKey)) {
          el.style.width = "0%";
        }
      }

      for (const laneKey of Array.from(activeLaneKeys)) {
        const analyser = mixerAnalyserNodesRef.current.get(laneKey);
        const meterEl = perChannelMeterRefs.current.get(laneKey);
        if (!analyser) continue;

        const buf = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i += 1) {
          const sample = buf[i] ?? 0;
          if (sample > peak) peak = sample;
        }

        const levelPct = Math.min(100, Math.max(0, (peak / 255) * 100));
        if (levelPct > maxPeakPct) maxPeakPct = levelPct;
        if (meterEl) {
          meterEl.style.width = `${levelPct}%`;
        }
      }
      const masterMeterEl = masterLiveMeterElementRef.current;
      if (masterMeterEl) {
        masterMeterEl.style.width = `${maxPeakPct}%`;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, []);

  const refreshAudioInputDevices = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!mountedRef.current) return;
      const inputs = devices.filter((device) => device.kind === "audioinput");
      setAudioInputDevices(inputs);
    } catch {
      if (!mountedRef.current) return;
      setAudioInputDevices([]);
    }
  }, []);

  const teardownRemotePlaybackGraph = useCallback(() => {
    setRemoteMeterTapActive(false);
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
    setBufferDepthFrames(0);
    setIsBufferPrimed(false);
    setLastCorrectionEvent("none");
    setRemoteMeterRafKey((k) => k + 1);
  }, []);

  const applyRemotePlaybackSpeakerGain = useCallback((muted: boolean) => {
    const ctx = studioAudioContextRef.current;
    const gainNode = remotePlaybackGainRef.current;
    if (!ctx || !gainNode || ctx.state === "closed") return;
    const target = muted
      ? 0
      : Math.min(
          Math.max(remotePlaybackVolumeRef.current, REMOTE_PLAYBACK_VOLUME_MIN),
          REMOTE_PLAYBACK_VOLUME_MAX
        );
    try {
      gainNode.gain.cancelScheduledValues(ctx.currentTime);
      gainNode.gain.setTargetAtTime(target, ctx.currentTime, 0.01);
    } catch {
      /* ignore */
    }
  }, []);

  const replacePeerAudioTrack = useCallback(
    (
      oldTrack: MediaStreamTrack | null,
      newTrack: MediaStreamTrack,
      oldStream: MediaStream | null,
      newStream: MediaStream
    ) => {
      const peer = peerRef.current as (Peer.Instance & {
        replaceTrack?: (
          oldTrack: MediaStreamTrack,
          newTrack: MediaStreamTrack,
          stream: MediaStream
        ) => void;
      }) | null;
      if (!peer || peer.destroyed || peer.connected !== true || typeof peer.replaceTrack !== "function") return;
      if (!oldTrack) return;
      try {
        peer.replaceTrack(oldTrack, newTrack, oldStream ?? newStream);
      } catch (err) {
        console.error("Failed to replace local audio track:", err);
      }
    },
    []
  );

  const getEstablishedAudioReplacementPeer = useCallback(() => {
    const peer =
      peerRef.current ??
      p2pEngineRef.current?.transport.peerRef.current ??
      null;
    if (!peer || peer.destroyed || peer.connected !== true) return null;
    return peer as Peer.Instance & {
      replaceTrack?: (
        oldTrack: MediaStreamTrack,
        newTrack: MediaStreamTrack,
        stream: MediaStream
      ) => void;
    };
  }, []);

  const teardownInterfaceLiveMonitorGraph = useCallback((deviceId: string) => {
    const sourceNode = interfaceLiveMonitorSourceNodesRef.current.get(deviceId);
    const gainNode = interfaceLiveMonitorGainNodesRef.current.get(deviceId);
    try {
      sourceNode?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      gainNode?.disconnect();
    } catch {
      /* ignore */
    }
    interfaceLiveMonitorSourceNodesRef.current.delete(deviceId);
    interfaceLiveMonitorGainNodesRef.current.delete(deviceId);
  }, []);

  const teardownAllInterfaceLiveMonitorGraphs = useCallback(() => {
    for (const deviceId of Array.from(interfaceLiveMonitorSourceNodesRef.current.keys())) {
      teardownInterfaceLiveMonitorGraph(deviceId);
    }
    for (const deviceId of Array.from(interfaceLiveMonitorGainNodesRef.current.keys())) {
      teardownInterfaceLiveMonitorGraph(deviceId);
    }
  }, [teardownInterfaceLiveMonitorGraph]);

  const duckInterfaceLiveMonitorNodesForBroadcast = useCallback(() => {
    const ctx = studioAudioContextRef.current;
    if (!ctx || ctx.state === "closed") return;
    for (const gainNode of Array.from(interfaceLiveMonitorGainNodesRef.current.values())) {
      try {
        gainNode.gain.cancelScheduledValues(ctx.currentTime);
        gainNode.gain.setValueAtTime(0, ctx.currentTime);
        gainNode.disconnect();
      } catch {
        /* ignore — node may already be disconnected */
      }
    }
  }, []);

  const restoreInterfaceLiveMonitorNodesFromSliders = useCallback(() => {
    const ctx = studioAudioContextRef.current;
    if (!ctx || ctx.state === "closed") return;
    for (const deviceId of Array.from(interfaceLiveMonitorGainNodesRef.current.keys())) {
      const gainNode = interfaceLiveMonitorGainNodesRef.current.get(deviceId);
      const sourceNode = interfaceLiveMonitorSourceNodesRef.current.get(deviceId);
      if (!gainNode) continue;
      const vols = deviceVolumesRef.current;
      const chCount = deviceInputChannelCountRef.current[deviceId] ?? 1;
      const v0 = vols[`${deviceId}:ch0`] ?? 100;
      const v1 = vols[`${deviceId}:ch1`] ?? 100;
      const blended = chCount >= 2 ? (v0 + v1) / 2 : v0;
      const targetLinear = Math.pow(Math.min(100, Math.max(0, blended)) / 100, 2);
      try {
        if (sourceNode) {
          try {
            sourceNode.connect(gainNode);
          } catch {
            /* already connected */
          }
        }
        try {
          gainNode.connect(ctx.destination);
        } catch {
          /* ignore */
        }
        rampLinearAudioGain(gainNode.gain, ctx, targetLinear, BROADCAST_INTERFACE_MONITOR_RAMP_SEC);
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    const prev = prevKiteModeForBroadcastMonitorRef.current;
    prevKiteModeForBroadcastMonitorRef.current = kiteMode;
    if (prev === "broadcast" && kiteMode !== "broadcast") {
      restoreInterfaceLiveMonitorNodesFromSliders();
    } else if (prev !== "broadcast" && kiteMode === "broadcast") {
      duckInterfaceLiveMonitorNodesForBroadcast();
    }
  }, [duckInterfaceLiveMonitorNodesForBroadcast, kiteMode, restoreInterfaceLiveMonitorNodesFromSliders]);

  useEffect(() => {
    if (kiteMode === "broadcast") {
      setDevicePanelOpen(false);
    }
  }, [kiteMode]);

  const clearInterfaceMonitorStateForDevice = useCallback((deviceId: string) => {
    interfaceInputDeviceFlagsRef.current = {
      ...interfaceInputDeviceFlagsRef.current,
      [deviceId]: false,
    };
    interfaceLiveMonitorEnabledFlagsRef.current = {
      ...interfaceLiveMonitorEnabledFlagsRef.current,
      [deviceId]: false,
    };
    setInterfaceInputDeviceFlags((prev) => {
      if (prev[deviceId] === undefined) return prev;
      const next = { ...prev };
      delete next[deviceId];
      return next;
    });
    setInterfaceLiveMonitorEnabledFlags((prev) => {
      if (prev[deviceId] === undefined) return prev;
      const next = { ...prev };
      delete next[deviceId];
      return next;
    });
  }, []);

  const clearMixerDeviceVolumeState = useCallback((deviceId: string) => {
    const lane0 = `${deviceId}:ch0`;
    const lane1 = `${deviceId}:ch1`;
    setDeviceVolumes((prev) => {
      if (
        prev[lane0] === undefined &&
        prev[lane1] === undefined &&
        prev[deviceId] === undefined
      ) {
        return prev;
      }
      const next = { ...prev };
      delete next[lane0];
      delete next[lane1];
      delete next[deviceId];
      return next;
    });
    setDeviceInputChannelCount((prev) => {
      if (prev[deviceId] === undefined) return prev;
      const next = { ...prev };
      delete next[deviceId];
      return next;
    });
  }, []);

  const removeAndCleanupDevice = useCallback((deviceId: string) => {
    const stream = activeStreamsMapRef.current.get(deviceId);
    const mergerNode = mixerMergerNodesRef.current.get(deviceId);
    const splitterNode = mixerSplitterNodesRef.current.get(deviceId);
    const sourceNode = mixerSourceNodesRef.current.get(deviceId);
    const laneKeys = [`${deviceId}:ch0`, `${deviceId}:ch1`] as const;

    for (const laneKey of laneKeys) {
      const gainNode = mixerGainNodesRef.current.get(laneKey);
      const analyserNode = mixerAnalyserNodesRef.current.get(laneKey);
      try {
        gainNode?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        analyserNode?.disconnect();
      } catch {
        /* ignore */
      }
      mixerGainNodesRef.current.delete(laneKey);
      mixerAnalyserNodesRef.current.delete(laneKey);
      mixerLaneProbeRef.current.delete(laneKey);
      const meterEl = perChannelMeterRefs.current.get(laneKey);
      if (meterEl) meterEl.style.width = "0%";
      perChannelMeterRefs.current.delete(laneKey);
    }
    if (masterLiveMeterElementRef.current) {
      masterLiveMeterElementRef.current.style.width = "0%";
    }

    try {
      mergerNode?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      splitterNode?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      sourceNode?.disconnect();
    } catch {
      /* ignore */
    }

    teardownInterfaceLiveMonitorGraph(deviceId);
    clearInterfaceMonitorStateForDevice(deviceId);
    stream?.getTracks().forEach((track) => track.stop());
    activeStreamsMapRef.current.delete(deviceId);
    mixerMergerNodesRef.current.delete(deviceId);
    mixerSplitterNodesRef.current.delete(deviceId);
    mixerSourceNodesRef.current.delete(deviceId);

    if (process.env.NODE_ENV !== "production") {
      const laneKeyPattern = /^.+:(ch0|ch1)$/;
      for (const laneKey of Array.from(mixerGainNodesRef.current.keys())) {
        console.assert(
          laneKeyPattern.test(laneKey),
          "[Kite][Invariant] mixerGainNodesRef key must match /^.+:(ch0|ch1)$/",
          laneKey
        );
      }
      for (const laneKey of Array.from(mixerAnalyserNodesRef.current.keys())) {
        console.assert(
          laneKeyPattern.test(laneKey),
          "[Kite][Invariant] mixerAnalyserNodesRef key must match /^.+:(ch0|ch1)$/",
          laneKey
        );
      }
      for (const laneKey of Array.from(perChannelMeterRefs.current.keys())) {
        console.assert(
          laneKeyPattern.test(laneKey),
          "[Kite][Invariant] perChannelMeterRefs key must match /^.+:(ch0|ch1)$/",
          laneKey
        );
      }
    }
  }, [clearInterfaceMonitorStateForDevice, teardownInterfaceLiveMonitorGraph]);

  const disconnectMixerLaneNodes = useCallback(() => {
    for (const laneKey of Array.from(mixerGainNodesRef.current.keys())) {
      const gainNode = mixerGainNodesRef.current.get(laneKey);
      const analyserNode = mixerAnalyserNodesRef.current.get(laneKey);
      try {
        gainNode?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        analyserNode?.disconnect();
      } catch {
        /* ignore */
      }
    }

    for (const deviceId of Array.from(mixerMergerNodesRef.current.keys())) {
      const mergerNode = mixerMergerNodesRef.current.get(deviceId);
      const splitterNode = mixerSplitterNodesRef.current.get(deviceId);
      const sourceNode = mixerSourceNodesRef.current.get(deviceId);
      try {
        mergerNode?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        splitterNode?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        sourceNode?.disconnect();
      } catch {
        /* ignore */
      }
    }
    mixerGainNodesRef.current.clear();
    mixerAnalyserNodesRef.current.clear();
    mixerMergerNodesRef.current.clear();
    mixerSplitterNodesRef.current.clear();
    mixerSourceNodesRef.current.clear();
    mixerLaneProbeRef.current.clear();
  }, []);

  const teardownMixerGraphNodes = useCallback(() => {
    if (process.env.NODE_ENV !== "production") {
      console.assert(
        mixerTeardownOriginRef.current === "performTeardown",
        "[Kite][Invariant] teardownMixerGraphNodes should be called only from performTeardown"
      );
    }
    disconnectMixerLaneNodes();
  }, [disconnectMixerLaneNodes]);

  const teardownVoipOutgoingNode = useCallback(() => {
    try {
      voipOutgoingSourceRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    voipOutgoingSourceRef.current = null;
    try {
      voipOutgoingGainRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    voipOutgoingGainRef.current = null;
    try {
      voipOutgoingDestinationRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    voipOutgoingDestinationRef.current = null;
  }, []);

  const teardownMasterDestinationNode = useCallback(() => {
    teardownVoipOutgoingNode();
    teardownHostMasterDestination();
  }, [teardownVoipOutgoingNode, teardownHostMasterDestination]);

  const ensureVoipOutgoingDestination = useCallback((audioCtx: AudioContext): MediaStreamAudioDestinationNode | null => {
    if (!audioCtx || audioCtx.state === "closed") return null;
    let dest = voipOutgoingDestinationRef.current;
    if (!dest) {
      dest = audioCtx.createMediaStreamDestination();
      voipOutgoingDestinationRef.current = dest;
    }
    if (!voipOutgoingGainRef.current) {
      const gain = audioCtx.createGain();
      gain.gain.value = 1;
      gain.connect(dest);
      voipOutgoingGainRef.current = gain;
    }
    return dest;
  }, []);

  const rebuildMixerAndReplaceTrack = useCallback(async () => {
    if (mixerRebuildInFlightRef.current) return;
    mixerRebuildInFlightRef.current = true;
    const ctx = studioAudioContextRef.current;
    if (!ctx || ctx.state === "closed") {
      mixerRebuildInFlightRef.current = false;
      return;
    }

    try {
      if (
        voipOutgoingDestinationRef.current &&
        voipOutgoingDestinationRef.current.context !== ctx
      ) {
        try {
          voipOutgoingSourceRef.current?.disconnect();
        } catch {
          /* ignore */
        }
        voipOutgoingSourceRef.current = null;
        try {
          voipOutgoingGainRef.current?.disconnect();
        } catch {
          /* ignore */
        }
        voipOutgoingGainRef.current = null;
        try {
          voipOutgoingDestinationRef.current?.disconnect();
        } catch {
          /* ignore */
        }
        voipOutgoingDestinationRef.current = null;
      }

      const inputs = Array.from(activeStreamsMapRef.current.entries()).map(([deviceId, stream]) => ({
        deviceId,
        stream,
      }));

      disconnectMixerLaneNodes();
      const destinationNode = ensureMasterDestinationNode();
      if (!destinationNode || inputs.length === 0) {
        try {
          voipOutgoingSourceRef.current?.disconnect();
        } catch {
          /* ignore */
        }
        voipOutgoingSourceRef.current = null;
        setDeviceInputChannelCount({});
        return;
      }

      const kiteTapNode = mixerKiteTapDestinationRef.current;
      if (!kiteTapNode) {
        if (process.env.NODE_ENV !== "production") {
          console.assert(false, "[Kite][Invariant] kite tap destination must exist with master");
        }
        try {
          voipOutgoingSourceRef.current?.disconnect();
        } catch {
          /* ignore */
        }
        voipOutgoingSourceRef.current = null;
        setDeviceInputChannelCount({});
        return;
      }

      const nextChannelCounts: Record<string, 1 | 2> = {};

      for (const input of inputs) {
        const laneGraph = await createLaneGraph({
          deviceId: input.deviceId,
          stream: input.stream,
          audioCtx: ctx,
          destinationNode,
          kiteTapDestinationNode: kiteTapNode,
          deviceVolumes: deviceVolumesRef.current,
        });
        nextChannelCounts[input.deviceId] = laneGraph.laneInfo.channelCount;
        for (const [laneKey, gainNode] of Array.from(laneGraph.gainNodes.entries())) {
          mixerGainNodesRef.current.set(laneKey, gainNode);
        }
        for (const [laneKey, analyserNode] of Array.from(laneGraph.analyserNodes.entries())) {
          mixerAnalyserNodesRef.current.set(laneKey, analyserNode);
        }
        for (const laneKey of laneGraph.laneKeys) {
          mixerLaneProbeRef.current.set(laneKey, laneGraph.laneInfo);
        }
        mixerSourceNodesRef.current.set(input.deviceId, laneGraph.sourceNode);
        mixerSplitterNodesRef.current.set(input.deviceId, laneGraph.splitterNode);
        mixerMergerNodesRef.current.set(input.deviceId, laneGraph.mergerNode);
      }

      setDeviceInputChannelCount(nextChannelCounts);
      mixerKiteTapStreamRef.current = kiteTapNode.stream;

      mixerMasterDestinationRef.current = destinationNode;
      mixerMasterStreamRef.current = destinationNode.stream;
      if (process.env.NODE_ENV !== "production") {
        console.assert(
          mixerMasterDestinationRef.current !== null,
          "[Kite][Invariant] masterDestinationRef must exist after lane build"
        );
      }
      const masterTrack = destinationNode.stream.getAudioTracks()[0] ?? null;
      if (!masterTrack) return;

      setLocalMicStream(destinationNode.stream);
      const localEl = localMonitorAudioRef.current;
      if (localEl) {
        localEl.srcObject = destinationNode.stream;
        localEl.muted = true;
        void localEl.play().catch(() => {});
      }

      const voipDest = ensureVoipOutgoingDestination(ctx);
      const voipGain = voipOutgoingGainRef.current;
      const primaryDeviceId = activeDeviceIdsRef.current[0] ?? "";
      const rawStream = primaryDeviceId
        ? activeStreamsMapRef.current.get(primaryDeviceId) ?? null
        : null;
      const hasLivePrimary =
        rawStream !== null &&
        rawStream.getAudioTracks().some((t) => t.readyState === "live");

      try {
        voipOutgoingSourceRef.current?.disconnect();
      } catch {
        /* ignore */
      }
      voipOutgoingSourceRef.current = null;

      if (rawStream && voipDest && voipGain && hasLivePrimary) {
        try {
          const voipSource = ctx.createMediaStreamSource(rawStream);
          voipSource.connect(voipGain);
          voipOutgoingSourceRef.current = voipSource;
        } catch (err) {
          console.warn("[Studio] VoIP outgoing MediaStreamSource failed:", err);
        }
      }

      const voipTrack = voipDest?.stream.getAudioTracks()[0] ?? null;
      const prevStream = localStreamRef.current;
      const prevTrack = prevStream?.getAudioTracks()[0] ?? null;
      if (voipTrack && voipOutgoingSourceRef.current && voipDest) {
        const replacementPeer = getEstablishedAudioReplacementPeer();
        const canReplacePeerAudioTrack =
          replacementPeer !== null &&
          typeof replacementPeer.replaceTrack === "function" &&
          prevStream !== null &&
          prevTrack !== null &&
          prevTrack.readyState === "live" &&
          voipTrack.readyState === "live" &&
          prevStream.getAudioTracks().includes(prevTrack);
        if (canReplacePeerAudioTrack) {
          replacePeerAudioTrack(prevTrack, voipTrack, prevStream ?? null, voipDest.stream);
          localStreamRef.current = voipDest.stream;
        }
        voipTrack.enabled = !isMicMutedRef.current;
      }

      if (process.env.NODE_ENV !== "production") {
        const laneKeyPattern = /^.+:(ch0|ch1)$/;
        for (const laneKey of Array.from(mixerGainNodesRef.current.keys())) {
          console.assert(
            laneKeyPattern.test(laneKey),
            "[Kite][Invariant] mixerGainNodesRef key must match /^.+:(ch0|ch1)$/",
            laneKey
          );
        }
        for (const laneKey of Array.from(mixerAnalyserNodesRef.current.keys())) {
          console.assert(
            laneKeyPattern.test(laneKey),
            "[Kite][Invariant] mixerAnalyserNodesRef key must match /^.+:(ch0|ch1)$/",
            laneKey
          );
        }
        for (const laneKey of Array.from(perChannelMeterRefs.current.keys())) {
          console.assert(
            laneKeyPattern.test(laneKey),
            "[Kite][Invariant] perChannelMeterRefs key must match /^.+:(ch0|ch1)$/",
            laneKey
          );
        }
      }
    } finally {
      mixerRebuildInFlightRef.current = false;
    }
  }, [
    disconnectMixerLaneNodes,
    ensureMasterDestinationNode,
    ensureVoipOutgoingDestination,
    getEstablishedAudioReplacementPeer,
    replacePeerAudioTrack,
    setDeviceInputChannelCount,
  ]);

  const toggleAudioDevice = useCallback(
    async (deviceId: string) => {
      if (mixerRebuildInFlightRef.current) return;
      let ctx = studioAudioContextRef.current;
      if (ctx?.state === "closed") {
        studioAudioContextRef.current = null;
        ctx = null;
      }
      if (!ctx) {
        ctx = ensureStudioAudioContext();
      }
      const requestedDeviceId = deviceId.trim();
      if (!requestedDeviceId) return;

      const isActive = activeDeviceIdsRef.current.includes(requestedDeviceId);
      if (isActive) {
        setActiveDeviceIds((prev) => prev.filter((id) => id !== requestedDeviceId));
        clearMixerDeviceVolumeState(requestedDeviceId);
        removeAndCleanupDevice(requestedDeviceId);
        void rebuildMixerAndReplaceTrack();
        return;
      }

      if (activeDeviceIdsRef.current.length >= 3) {
        console.warn("Maximum 3 active input devices supported.");
        return;
      }

      setActiveDeviceIds((prev) => {
        if (prev.includes(requestedDeviceId)) return prev;
        return [...prev, requestedDeviceId];
      });

      try {
        const nextStream = await acquireStudioMicStream({
          deviceId: requestedDeviceId,
          echoSafetyMode,
        });
        if (!mountedRef.current) {
          nextStream.getTracks().forEach((track) => track.stop());
          return;
        }
        const stillIntended = activeDeviceIdsRef.current.includes(requestedDeviceId);
        if (!stillIntended) {
          nextStream.getTracks().forEach((track) => track.stop());
          return;
        }
        if ((nextStream.getAudioTracks()[0] ?? null) === null) {
          nextStream.getTracks().forEach((track) => track.stop());
          setActiveDeviceIds((prev) => prev.filter((id) => id !== requestedDeviceId));
          return;
        }
        activeStreamsMapRef.current.set(requestedDeviceId, nextStream);
        nextStream.getTracks().forEach((track) => {
          track.onended = () => {
            if (!activeDeviceIdsRef.current.includes(requestedDeviceId)) return;
            setActiveDeviceIds((prev) => prev.filter((id) => id !== requestedDeviceId));
            removeAndCleanupDevice(requestedDeviceId);
            clearMixerDeviceVolumeState(requestedDeviceId);
          };
        });
        setDeviceVolumes((prev) => {
          const lane0 = `${requestedDeviceId}:ch0`;
          const lane1 = `${requestedDeviceId}:ch1`;
          if (prev[lane0] !== undefined || prev[lane1] !== undefined) return prev;
          const legacy = prev[requestedDeviceId];
          if (legacy !== undefined) {
            const next = { ...prev };
            delete next[requestedDeviceId];
            return { ...next, [lane0]: legacy, [lane1]: legacy };
          }
          return { ...prev, [lane0]: 100, [lane1]: 100 };
        });
        await rebuildMixerAndReplaceTrack();
        if (process.env.NODE_ENV !== "production") {
          console.assert(
            mixerMasterDestinationRef.current !== null,
            "[Kite][Invariant] masterDestinationRef must exist after first device add"
          );
        }
      } catch (err) {
        setActiveDeviceIds((prev) => prev.filter((id) => id !== requestedDeviceId));
        const errorName = err && typeof err === "object" ? (err as { name?: string }).name : undefined;
        if (errorName === "NotFoundError") {
          setStatusNote("Device disconnected or not found.");
        } else if (isDeviceBusyError(err)) {
          setStatusNote("Device is busy. Please close Zoom, Discord, or your DAW and retry.");
        }
        console.error("Failed to toggle audio input device:", err);
      } finally {
        void refreshAudioInputDevices();
      }
    },
    [
      echoSafetyMode,
      ensureStudioAudioContext,
      rebuildMixerAndReplaceTrack,
      refreshAudioInputDevices,
      removeAndCleanupDevice,
      clearMixerDeviceVolumeState,
    ]
  );

  const handleVolumeChange = useCallback((laneKey: string, newVolume: number) => {
    const clampedVolume = Math.min(100, Math.max(0, newVolume));
    setDeviceVolumes((prev) => ({ ...prev, [laneKey]: clampedVolume }));

    const deviceId =
      laneKey.endsWith(":ch0") || laneKey.endsWith(":ch1") ? laneKey.slice(0, -4) : null;
    if (!deviceId || !activeStreamsMapRef.current.has(deviceId)) return;

    const ctx = studioAudioContextRef.current;
    if (!ctx || ctx.state === "closed") return;
    try {
      const perceptualGain = Math.pow(clampedVolume / 100, 2);
      const gainNode = mixerGainNodesRef.current.get(laneKey);
      if (gainNode) {
        gainNode.gain.cancelScheduledValues(ctx.currentTime);
        gainNode.gain.setTargetAtTime(perceptualGain, ctx.currentTime, 0.01);
      }

      const monitorGain = interfaceLiveMonitorGainNodesRef.current.get(deviceId);
      if (monitorGain) {
        if (kiteModeRef.current === "broadcast") {
          rampLinearAudioGain(monitorGain.gain, ctx, 0, BROADCAST_INTERFACE_MONITOR_RAMP_SEC);
        } else {
          const vols = deviceVolumesRef.current;
          const chCount = deviceInputChannelCountRef.current[deviceId] ?? 1;
          const v0 =
            laneKey === `${deviceId}:ch0` ? clampedVolume : vols[`${deviceId}:ch0`] ?? 100;
          const v1 =
            laneKey === `${deviceId}:ch1` ? clampedVolume : vols[`${deviceId}:ch1`] ?? 100;
          const blended = chCount >= 2 ? (v0 + v1) / 2 : v0;
          const monitorPerceptual = Math.pow(Math.min(100, Math.max(0, blended)) / 100, 2);
          rampLinearAudioGain(
            monitorGain.gain,
            ctx,
            monitorPerceptual,
            BROADCAST_INTERFACE_MONITOR_RAMP_SEC
          );
        }
      }
    } catch {
      /* ignore slider updates during active teardown */
    }
  }, []);

  const buildInterfaceLiveMonitorGraph = useCallback((deviceId: string) => {
    const ctx = studioAudioContextRef.current;
    if (!ctx || ctx.state === "closed") return;
    if (interfaceLiveMonitorSourceNodesRef.current.has(deviceId)) return;
    if (interfaceInputDeviceFlagsRef.current[deviceId] !== true) return;
    if (interfaceLiveMonitorEnabledFlagsRef.current[deviceId] !== true) return;

    const stream = activeStreamsMapRef.current.get(deviceId);
    if (!stream || stream.getAudioTracks().length === 0) return;

    try {
      const sourceNode = ctx.createMediaStreamSource(stream);
      const gainNode = ctx.createGain();
      const vols = deviceVolumesRef.current;
      const chCount = deviceInputChannelCountRef.current[deviceId] ?? 1;
      const v0 = vols[`${deviceId}:ch0`] ?? 100;
      const v1 = vols[`${deviceId}:ch1`] ?? 100;
      const volume = chCount >= 2 ? (v0 + v1) / 2 : v0;
      const targetLinear = Math.pow(Math.min(100, Math.max(0, volume)) / 100, 2);
      const t0 = ctx.currentTime;
      if (kiteModeRef.current === "broadcast") {
        gainNode.gain.setValueAtTime(0, t0);
      } else {
        gainNode.gain.setValueAtTime(0, t0);
        gainNode.gain.linearRampToValueAtTime(targetLinear, t0 + BROADCAST_INTERFACE_MONITOR_RAMP_SEC);
      }
      sourceNode.connect(gainNode);
      if (kiteModeRef.current !== "broadcast") {
        gainNode.connect(ctx.destination);
      }
      interfaceLiveMonitorSourceNodesRef.current.set(deviceId, sourceNode);
      interfaceLiveMonitorGainNodesRef.current.set(deviceId, gainNode);
    } catch (error) {
      console.warn("[Kite] Could not start interface live monitor:", error);
    }
  }, []);

  useEffect(() => {
    for (const deviceId of activeDeviceIds) {
      buildInterfaceLiveMonitorGraph(deviceId);
    }
  }, [activeDeviceIds, buildInterfaceLiveMonitorGraph, interfaceInputDeviceFlags, interfaceLiveMonitorEnabledFlags]);

  const setInterfaceInputDeviceFlag = useCallback((deviceId: string, isInterfaceInput: boolean) => {
    setInterfaceInputDeviceFlags((prev) => {
      const next = { ...prev };
      if (isInterfaceInput) {
        next[deviceId] = true;
      } else {
        delete next[deviceId];
      }
      interfaceInputDeviceFlagsRef.current = next;
      return next;
    });

    if (!isInterfaceInput) {
      teardownInterfaceLiveMonitorGraph(deviceId);
      setInterfaceLiveMonitorEnabledFlags((prev) => {
        if (prev[deviceId] === undefined) return prev;
        const next = { ...prev };
        delete next[deviceId];
        interfaceLiveMonitorEnabledFlagsRef.current = next;
        return next;
      });
    }
  }, [teardownInterfaceLiveMonitorGraph]);

  const setInterfaceLiveMonitorEnabledFlag = useCallback((deviceId: string, isMonitorEnabled: boolean) => {
    if (!isMonitorEnabled) {
      teardownInterfaceLiveMonitorGraph(deviceId);
    }
    setInterfaceLiveMonitorEnabledFlags((prev) => {
      const next = { ...prev };
      if (isMonitorEnabled) {
        next[deviceId] = true;
      } else {
        delete next[deviceId];
      }
      interfaceLiveMonitorEnabledFlagsRef.current = next;
      return next;
    });
  }, [teardownInterfaceLiveMonitorGraph]);

  const flushAndSetRemoteGridTarget = useCallback((targetTimeSec: number | null) => {
    const bufferNode = remoteBufferNodeRef.current;
    if (!bufferNode || !("port" in bufferNode)) return;
    bufferNode.port.postMessage({ type: "FLUSH_BUFFER" });
    if (typeof targetTimeSec === "number" && Number.isFinite(targetTimeSec)) {
      bufferNode.port.postMessage({
        type: "SET_GRID_TARGET",
        targetTimeSec,
      });
    }
  }, []);

  const ensureKiteBufferWorkletLoaded = useCallback(
    async (ctx: AudioContext): Promise<boolean> => {
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
          if (mountedRef.current) setIsWorkletLoaded(false);
          return false;
        }
        try {
          await ctx.audioWorklet.addModule("/worklets/kite-buffer-processor.js");
          workletLoadedContextRef.current = ctx;
          if (mountedRef.current) setIsWorkletLoaded(true);
          return true;
        } catch {
          if (mountedRef.current) setIsWorkletLoaded(false);
          return false;
        } finally {
          workletLoadPromiseRef.current = null;
        }
      })();
      workletLoadPromiseRef.current = loadPromise;
      return loadPromise;
    },
    [],
  );

  const resetMeteredDelayWorkletState = useCallback(() => {
    workletLoadedContextRef.current = null;
    workletLoadPromiseRef.current = null;
    setIsWorkletLoaded(false);
  }, []);

  loadWorkletRef.current = async (ctx: AudioContext) => {
    await ensureKiteBufferWorkletLoaded(ctx);
  };
  resetWorkletRef.current = resetMeteredDelayWorkletState;

  const kiteSyncMetronome = useKiteSyncMetronome({
      kiteSyncEnabled,
      broadcastStatus,
      audioContextReady,
      kiteSyncNetworkMetronomePaused,
      kiteSyncMetronomeResumeNonce,
      metronomeBpm,
      beatsPerInterval,
      role,
      kiteSetupTimeSignatureTop,
      getContext: getStudioAudioContext,
      hardwareKillSwitchActiveRef,
      audioBaseLatencySecRef,
      audioOutputLatencySecRef,
      metronomeVolumeRef,
      broadcastStatusRef,
      kiteSyncCountInActiveRef,
      isVisualMetronomeOnlyRef,
      kiteIntervalTimingRef,
      p2pEngineRef,
      metronomeBlinkElementRef,
    });
  const stopKiteMetronome = kiteSyncMetronome.stop;
  const ensureMetronomeGainNodeFromSync = kiteSyncMetronome.ensureGainNode;
  const metronomeGainRef =
    kiteSyncMetronome.metronomeGainRef as MutableRefObject<GainNode | null>;
  const ensureMetronomeGainNode = useCallback((ctx: AudioContext): GainNode => {
    const gain = ensureMetronomeGainNodeFromSync(ctx);
    soloLooperEngineRef.current?.setMetronomeGainNode(gain);
    return gain;
  }, [ensureMetronomeGainNodeFromSync]);

  useEffect(() => {
    stopKiteMetronomeRef.current = stopKiteMetronome;
  }, [stopKiteMetronome]);

  const buildRemotePlaybackGraph = useCallback((stream: MediaStream) => {
    const ctx = studioAudioContextRef.current;
    if (!ctx) return;
    teardownRemotePlaybackGraph();
    const source = ctx.createMediaStreamSource(stream);
    const delayNode = ctx.createDelay(5);
    delayNode.delayTime.value = 0; // MUST remain 0 for real-time jamming
    const gain = ctx.createGain();
    gain.gain.value = speakerMutedRef.current
      ? 0
      : Math.min(
          Math.max(remotePlaybackVolumeRef.current, REMOTE_PLAYBACK_VOLUME_MIN),
          REMOTE_PLAYBACK_VOLUME_MAX
        );
    remoteBufferNodeRef.current = null;
    if (isBufferingEnabledRef.current) {
      if (
        workletLoadedContextRef.current === ctx &&
        isWorkletLoadedRef.current
      ) {
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
          if (typeof data.bufferDepthFrames === "number") {
            setBufferDepthFrames(Math.max(0, Math.round(data.bufferDepthFrames)));
          }
          if (typeof data.targetLeadFrames === "number") {
            setTargetLeadFrames(Math.max(0, Math.round(data.targetLeadFrames)));
          }
          setIsBufferPrimed(Boolean(data.isPrimed));
          if (
            data.driftCorrectionEvent === "drop" ||
            data.driftCorrectionEvent === "dupe" ||
            data.driftCorrectionEvent === "none"
          ) {
            setLastCorrectionEvent(data.driftCorrectionEvent);
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
    compressor.knee.value      = REMOTE_COMPRESSOR_KNEE;
    compressor.ratio.value     = REMOTE_COMPRESSOR_RATIO;
    compressor.attack.value    = REMOTE_COMPRESSOR_ATTACK;
    compressor.release.value   = REMOTE_COMPRESSOR_RELEASE;
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
    setRemoteMeterTapActive(true);
    setRemoteMeterRafKey((k) => k + 1);
  }, []);

  const rebuildRemoteGraphWithoutTeardown = useCallback(() => {
    if (isBroadcastConnectPendingRef.current || kiteModeRef.current === "broadcast") return;
    const ctx = studioAudioContextRef.current;
    const stream = remoteStreamRef.current;
    if (!ctx || !stream) return;
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
    window.setTimeout(() => {
      if (!mountedRef.current) return;
      if (isBroadcastConnectPendingRef.current || kiteModeRef.current === "broadcast") return;
      buildRemotePlaybackGraph(stream);
      const rebuiltGain = remotePlaybackGainRef.current;
      const rebuiltCtx = studioAudioContextRef.current;
      if (!rebuiltGain || !rebuiltCtx) return;
      const targetGain = speakerMutedRef.current
        ? 0
        : Math.min(
            Math.max(remotePlaybackVolumeRef.current, REMOTE_PLAYBACK_VOLUME_MIN),
            REMOTE_PLAYBACK_VOLUME_MAX
          );
      try {
        rebuiltGain.gain.cancelScheduledValues(rebuiltCtx.currentTime);
        rebuiltGain.gain.setValueAtTime(0, rebuiltCtx.currentTime);
        rebuiltGain.gain.linearRampToValueAtTime(
          targetGain,
          rebuiltCtx.currentTime + 0.05
        );
      } catch {
        /* ignore */
      }
    }, 60);
  }, [buildRemotePlaybackGraph]);

  const localJamSetupOwnerId = ui.getUser()?.id ?? user?.id ?? `${role ?? "unknown"}:${sessionId ?? "local"}`;
  const localJamSetupOwnerName = role === "host" ? "Host" : "Bandmate";
  const canControlStop = !syncInitiatorId || syncInitiatorId === localJamSetupOwnerId;
  const canStartSync = broadcastStatus === "idle" && Boolean(remoteStream);
  useEffect(() => {
    if (!kiteSyncEnabled) {
      kiteSyncCountInCompletionHandledRef.current = false;
      setKiteSyncCountInActive(false);
    }
  }, [kiteSyncEnabled]);

  useEffect(() => {
    speakerMutedRef.current = isSpeakerMuted;
    applyRemotePlaybackSpeakerGain(isSpeakerMuted);
  }, [isSpeakerMuted, applyRemotePlaybackSpeakerGain]);

  useEffect(() => {
    remotePlaybackVolumeRef.current = remotePlaybackVolume;
  }, [remotePlaybackVolume]);

  useEffect(() => {
    if (!remoteStream) {
      setRemoteLevel(0);
      setRemoteMeterHeights([...BASELINE_LEVEL_BAR_HEIGHTS]);
    }
  }, [remoteStream]);

  useEffect(() => {
    if (!remoteMeterTapActive) {
      setRemoteMeterHeights([...BASELINE_LEVEL_BAR_HEIGHTS]);
      setRemoteLevel(0);
      return;
    }
    const an = remotePlaybackAnalyserRef.current;
    if (!an) return;
    let raf = 0;
    let stopped = false;
    let lastT = 0;
    const buf = new Uint8Array(an.frequencyBinCount);
    const METER_READ_MS = 100;
    const tick = (now: number) => {
      if (stopped || !mountedRef.current) return;
      if (now - lastT >= METER_READ_MS) {
        lastT = now;
        an.getByteFrequencyData(buf);
        const next = meterBinsFromFrequencyData(buf);
        setRemoteMeterHeights(next);
        const avg = next.reduce((a, b) => a + b, 0) / next.length;
        setRemoteLevel(avg);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [remoteMeterTapActive, remoteMeterRafKey]);

  useEffect(() => {
    if (status !== "connected") {
      setInboundPacketLossPercent(null);
      setCalculatedDelayMs(null);
      calculatedDelayMsRef.current = null;
      kiteSyncLossRecoverySinceMsRef.current = null;
      kiteSyncLossPauseActiveRef.current = false;
      setKiteSyncNetworkMetronomePaused(false);
      return;
    }
    const isSafariWebKit = isStudioSafariWebKitEngine();
    const tick = () => {
      const pc = peerConnectionRef.current;
      if (!pc || !mountedRef.current) return;
      void pc
        .getStats()
        .then((stats) => {
          if (!mountedRef.current) return;
          const parsedRtt = parseSelectedCandidatePairRttMs(stats);
          if (parsedRtt === null) {
            setCalculatedDelayMs(null);
            calculatedDelayMsRef.current = null;
          } else {
            // One-way transport delay estimate for alignment/compensation engines.
            const oneWayDelayMs = Math.max(
              0,
              Math.min(2000, Math.round((parsedRtt.rttMs / 2) * 10) / 10)
            );
            setCalculatedDelayMs(oneWayDelayMs);
            calculatedDelayMsRef.current = oneWayDelayMs;
          }
          let jitterSec = 0;
          stats.forEach((stat) => {
            if (
              stat.type === "inbound-rtp" &&
              stat.kind === "audio" &&
              typeof (stat as RTCInboundRtpStreamStats).jitter === "number"
            ) {
              const j = (stat as RTCInboundRtpStreamStats).jitter;
              if (typeof j === "number") jitterSec = j;
            }
          });
          const parsed = parseInboundAudioPacketLoss(stats);
          if (isAutoBufferRef.current && parsedRtt !== null) {
            const sampleRate = getStudioKiteSampleRate();
            const rttSec = (parsedRtt.rttMs / 2) / 1000;
            let autoTarget = Math.round((rttSec + jitterSec + 0.02) * sampleRate);
            autoTarget = Math.max(480, Math.min(19200, autoTarget));
            const currentTarget = targetLeadFramesRef.current;
            if (Math.abs(autoTarget - currentTarget) >= 480) {
              const bufferNode = remoteBufferNodeRef.current;
              if (bufferNode && "port" in bufferNode) {
                bufferNode.port.postMessage({
                  type: "SET_TARGET_LEAD_FRAMES",
                  value: autoTarget,
                });
              }
              targetLeadFramesRef.current = autoTarget;
              setTargetLeadFrames(autoTarget);
            }
          }
          if (parsed === null) {
            setInboundPacketLossPercent(null);
            applyKiteSyncLossGuardRef.current(null);
            return;
          }
          const packetLossPercent = Math.round(parsed.ratio * 1000) / 10;
          applyLowLatencyInboundAudioReceivers(pc, {
            isSafariWebKit,
            packetLossPercent,
          });
          setInboundPacketLossPercent(packetLossPercent);
          applyKiteSyncLossGuardRef.current(packetLossPercent);
        })
        .catch(() => {});
    };
    tick();
    const id = window.setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [getStudioKiteSampleRate, status]);

  useEffect(() => {
    if (status !== "connected") {
      highPingStreakRef.current = 0;
      highPingTipDismissedRef.current = false;
      setHighPingTipOpen(false);
      return;
    }
    if (pingMs === null) return;

    if (pingMs <= HIGH_PING_WARN_MS) {
      highPingStreakRef.current = 0;
      highPingTipDismissedRef.current = false;
      setHighPingTipOpen(false);
      return;
    }

    highPingStreakRef.current += 1;
    if (
      highPingStreakRef.current >= HIGH_PING_WARN_SAMPLES &&
      !highPingTipDismissedRef.current
    ) {
      setHighPingTipOpen(true);
    }
  }, [pingMs, status]);

  const dismissHighPingTip = useCallback(() => {
    highPingTipDismissedRef.current = true;
    setHighPingTipOpen(false);
  }, []);

  const runAudioTest = useCallback(async () => {
    if (audioTestDone || audioTestPlaying || micPermissionDenied) return;
    setAudioTestPlaying(true);
    setAudioTestFailed(false);
    try {
      await playTestTone();
      if (mountedRef.current) setAudioTestDone(true);
    } catch {
      if (mountedRef.current) setAudioTestFailed(true);
    } finally {
      if (mountedRef.current) setAudioTestPlaying(false);
    }
  }, [audioTestDone, audioTestPlaying, micPermissionDenied]);

  const clearLostCountdown = useCallback(() => {
    if (lostCountdownIntervalRef.current !== null) {
      clearInterval(lostCountdownIntervalRef.current);
      lostCountdownIntervalRef.current = null;
    }
    setConnectionLostCountdown(null);
  }, []);

  const beginLostCountdown = useCallback(() => {
    clearLostCountdown();
    setConnectionLostCountdown(30);
    lostCountdownIntervalRef.current = window.setInterval(() => {
      setConnectionLostCountdown((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          if (lostCountdownIntervalRef.current !== null) {
            clearInterval(lostCountdownIntervalRef.current);
            lostCountdownIntervalRef.current = null;
          }
          setStatus("failed");
          setStatusNote("Signal timed out.");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [clearLostCountdown]);

  const toggleMic = useCallback(() => {
    if (kiteSyncCountInActive && kiteSyncEnabled) {
      setIsMicMuted((prev) => {
        if (!prev) {
          localStreamRef.current?.getAudioTracks().forEach((track) => {
            track.enabled = false;
          });
          return true;
        }
        return prev;
      });
      return;
    }
    setIsMicMuted((prev) => {
      const nextMuted = !prev;
      const enabled = !nextMuted;
      localStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
      });
      return nextMuted;
    });
  }, [kiteSyncCountInActive, kiteSyncEnabled]);

  const toggleSpeaker = useCallback(() => {
    if (kiteSyncCountInActive && kiteSyncEnabled) {
      setIsSpeakerMuted((prev) => {
        if (!prev) {
          speakerMutedRef.current = true;
          applyRemotePlaybackSpeakerGain(true);
          return true;
        }
        return prev;
      });
      return;
    }
    setIsSpeakerMuted((prev) => {
      const nextMuted = !prev;
      speakerMutedRef.current = nextMuted;
      applyRemotePlaybackSpeakerGain(nextMuted);
      return nextMuted;
    });
  }, [applyRemotePlaybackSpeakerGain, kiteSyncCountInActive, kiteSyncEnabled]);

  const clearRecordingInterval = useCallback(() => {
    if (recordingIntervalRef.current !== null) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isInStudioPhase) return;
    if (isBroadcastConnectPendingRef.current || kiteModeRef.current === "broadcast") return;
    if (!remoteStreamRef.current) return;
    rebuildRemoteGraphWithoutTeardown();
  }, [isInStudioPhase, isBufferingEnabled, rebuildRemoteGraphWithoutTeardown]);

  useEffect(() => {
    if (!isInStudioPhase || !isBufferingEnabled || !isWorkletLoaded) return;
    if (isBroadcastConnectPendingRef.current || kiteModeRef.current === "broadcast") return;
    if (!remoteStreamRef.current) return;
    rebuildRemoteGraphWithoutTeardown();
  }, [isInStudioPhase, isBufferingEnabled, isWorkletLoaded, rebuildRemoteGraphWithoutTeardown]);

  useEffect(() => {
    if (kiteSyncEnabled) return;
    const bufferNode = remoteBufferNodeRef.current;
    if (!bufferNode || !("port" in bufferNode)) return;
    bufferNode.port.postMessage({ type: "FLUSH_BUFFER" });
  }, [kiteSyncEnabled]);

  useEffect(() => {
    if (!isInStudioPhase) return;
    if (soloLooperStateRef.current === "recording") return;
    if (previousEchoSafetyModeRef.current === echoSafetyMode) return;
    if (echoModeApplyingRef.current) return;
    if (activeStreamsMapRef.current.size === 0 && !localStreamRef.current) return;

    echoModeApplyingRef.current = true;

    void (async () => {
      try {
        previousEchoSafetyModeRef.current = echoSafetyMode;

        const entries = Array.from(activeStreamsMapRef.current.entries());

        if (entries.length > 0) {
          for (const [deviceId, oldStream] of entries) {
            if (!activeDeviceIdsRef.current.includes(deviceId)) {
              removeAndCleanupDevice(deviceId);
              continue;
            }
            oldStream.getTracks().forEach((track) => track.stop());
            const nextStream = await acquireStudioMicStream({ deviceId, echoSafetyMode });
            if (!mountedRef.current) {
              nextStream.getTracks().forEach((track) => track.stop());
              return;
            }
            const stillIntended = activeDeviceIdsRef.current.includes(deviceId);
            if (!stillIntended) {
              nextStream.getTracks().forEach((track) => track.stop());
              removeAndCleanupDevice(deviceId);
              continue;
            }
            if ((nextStream.getAudioTracks()[0] ?? null) === null) {
              nextStream.getTracks().forEach((track) => track.stop());
              continue;
            }
            activeStreamsMapRef.current.set(deviceId, nextStream);
            nextStream.getTracks().forEach((track) => {
              track.onended = () => {
                if (!activeDeviceIdsRef.current.includes(deviceId)) return;
                setActiveDeviceIds((prev) => prev.filter((id) => id !== deviceId));
                removeAndCleanupDevice(deviceId);
                clearMixerDeviceVolumeState(deviceId);
              };
            });
          }
        } else if (localStreamRef.current) {
          const prevStream = localStreamRef.current;
          const prevTrack = prevStream.getAudioTracks()[0] ?? null;
          const deviceId =
            prevTrack?.getSettings().deviceId?.trim() ||
            activeDeviceIdsRef.current[0] ||
            "default";
          prevStream.getTracks().forEach((track) => track.stop());
          const nextStream = await acquireStudioMicStream({ deviceId, echoSafetyMode });
          if (!mountedRef.current) {
            nextStream.getTracks().forEach((track) => track.stop());
            return;
          }
          if ((nextStream.getAudioTracks()[0] ?? null) === null) {
            nextStream.getTracks().forEach((track) => track.stop());
            return;
          }
          activeStreamsMapRef.current.set(deviceId, nextStream);
          nextStream.getTracks().forEach((track) => {
            track.onended = () => {
              if (!activeDeviceIdsRef.current.includes(deviceId)) return;
              setActiveDeviceIds((prev) => prev.filter((id) => id !== deviceId));
              removeAndCleanupDevice(deviceId);
              clearMixerDeviceVolumeState(deviceId);
            };
          });
          setActiveDeviceIds((prev) => (prev.includes(deviceId) ? prev : [...prev, deviceId]));
        }

        await rebuildMixerAndReplaceTrack();
      } catch (err) {
        console.error("Failed to re-acquire microphone for echo safety mode:", err);
      } finally {
        echoModeApplyingRef.current = false;
      }
    })();
  }, [echoSafetyMode, rebuildMixerAndReplaceTrack, replacePeerAudioTrack]);

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
  }, [targetLeadFrames, isAutoBuffer]);

  const buildKiteSyncPacket = useCallback((overrides?: {
    kiteSyncEnabled?: boolean;
    bpm?: number;
    bpi?: number;
  }): KiteSyncMessage | null => {
    const ctx = studioAudioContextRef.current;
    if (!ctx) return null;
    const nextEnabled = overrides?.kiteSyncEnabled ?? kiteSyncEnabled;
    const nextBpm = overrides?.bpm ?? metronomeBpm;
    const nextBpi =
      overrides?.bpi ??
      kiteIntervalTimingRef.current?.bpi ??
      latestKiteIntervalTimingRef.current?.bpi ??
      beatsPerInterval;
    kiteSyncSequenceRef.current += 1;
    studioRevisionRef.current += 1;
    console.log("Broadcasting KITE_SYNC packet...", {
      bpm: nextBpm,
      bpi: nextBpi,
    });
    return {
      type: "KITE_SYNC",
      hostTime: ctx.currentTime,
      bpm: nextBpm,
      bpi: nextBpi,
      enabled: nextEnabled,
      serverTimestamp: Date.now(),
      sequenceNumber: kiteSyncSequenceRef.current,
      initiatorId: syncInitiatorIdRef.current ?? localJamSetupOwnerId,
      studioRevision: studioRevisionRef.current,
    };
  }, [beatsPerInterval, kiteSyncEnabled, localJamSetupOwnerId, metronomeBpm]);

  const sendOrQueueKiteSyncPacket = useCallback((packet: KiteSyncMessage): void => {
    const peer = peerRef.current;
    if (!peer || peer.destroyed || peer.connected !== true) {
      pendingKiteSyncRef.current = packet;
      return;
    }
    try {
      peer.send(JSON.stringify(packet));
      pendingKiteSyncRef.current = null;
    } catch {
      // Coalesce to latest sync packet while channel is recovering.
      pendingKiteSyncRef.current = packet;
    }
  }, []);

  const broadcastKiteSync = useCallback((overrides?: {
    kiteSyncEnabled?: boolean;
    bpm?: number;
    bpi?: number;
  }): void => {
    const packet = buildKiteSyncPacket({
      kiteSyncEnabled: overrides?.kiteSyncEnabled,
      bpm: overrides?.bpm,
      bpi: overrides?.bpi,
    });
    if (!packet) return;
    sendOrQueueKiteSyncPacket(packet);
  }, [buildKiteSyncPacket, sendOrQueueKiteSyncPacket]);

  const flushStudioParamBroadcast = useCallback(() => {
    studioParamDebounceTimerRef.current = null;
    const peer = peerRef.current;
    const patch = { ...studioParamPendingPatchRef.current };
    studioParamPendingPatchRef.current = {};
    if (Object.keys(patch).length === 0) return;
    if (!peer || peer.destroyed || peer.connected !== true) return;
    studioRevisionRef.current += 1;
    const payload: StudioParamMessage = {
      type: "STUDIO_PARAM",
      originatorId: localJamSetupOwnerId,
      studioRevision: studioRevisionRef.current,
      patch,
    };
    try {
      peer.send(JSON.stringify(payload));
    } catch {
      /* coalesce — next edit will re-send merged patch */
    }
  }, [localJamSetupOwnerId]);

  const broadcastStudioParam = useCallback((partial: StudioParamMessage["patch"]) => {
    studioParamPendingPatchRef.current = {
      ...studioParamPendingPatchRef.current,
      ...partial,
    };
    if (studioParamDebounceTimerRef.current !== null) {
      window.clearTimeout(studioParamDebounceTimerRef.current);
    }
    studioParamDebounceTimerRef.current = window.setTimeout(() => {
      flushStudioParamBroadcast();
    }, 24);
  }, [flushStudioParamBroadcast]);

  const broadcastWizardStudioParam = useCallback(
    (partial: StudioParamMessage["patch"]) => {
      if (kiteSetupOrigin !== "connected") return;
      broadcastStudioParam(partial);
    },
    [broadcastStudioParam, kiteSetupOrigin]
  );

  /**
   * Send P2P timing metadata to the connected peer so both sides can agree on the
   * interval clock before the P2P engine starts. Does NOT trigger chunk transfer.
   */
  const sendSetInterval = useCallback((
    timing: KiteIntervalTiming,
    hasRetainedLoop: boolean,
    options?: { igniteP2PEngine?: boolean }
  ): void => {
    const peer = peerRef.current;
    if (!peer || peer.destroyed || peer.connected !== true) return;
    const clockAnchorSec = studioAudioContextRef.current?.currentTime ?? 0;
    const payload: {
      type: "SET_INTERVAL";
      timing: KiteIntervalTiming;
      clockAnchorSec: number;
      hasRetainedLoop: boolean;
      igniteP2PEngine?: boolean;
    } = {
      type: "SET_INTERVAL",
      timing,
      clockAnchorSec,
      hasRetainedLoop,
    };
    if (options?.igniteP2PEngine === true) {
      payload.igniteP2PEngine = true;
    }
    try {
      peer.send(JSON.stringify(payload));
      console.log("[SET_INTERVAL] sent", { bpm: timing.bpm, bpi: timing.bpi, clockAnchorSec, hasRetainedLoop });
    } catch {
      console.warn("[SET_INTERVAL] send failed — peer channel not ready");
    }
  }, []);

  /**
   * Apply incoming SET_INTERVAL timing to local setup state so the guest's UI
   * and math mirror the host's configuration. Does not send anything over the network.
   */
  const applySetIntervalLocally = useCallback((
    timing: KiteIntervalTiming,
    clockAnchorSec: number,
    hasRetainedLoop: boolean,
  ): void => {
    setKiteSetupTempo(Math.max(20, Math.min(320, Math.round(timing.bpm))));
    setKiteSetupTimeSignatureTop(Math.max(1, Math.min(16, Math.round(timing.timeSignatureTop))));
    setKiteSetupTimeSignatureBottom(Math.max(1, Math.min(32, Math.round(timing.timeSignatureBottom))));
    setKiteSetupChordCount(Math.max(1, Math.min(64, Math.round(timing.chords))));
    setBeatsPerInterval(Math.round(timing.bpi));
    setMetronomeBpm(timing.bpm);
    console.log("[SET_INTERVAL] local timing synced from host", {
      bpm: timing.bpm,
      chords: timing.chords,
      timeSignatureTop: timing.timeSignatureTop,
      timeSignatureBottom: timing.timeSignatureBottom,
      clockAnchorSec,
      hasRetainedLoop,
    });
  }, []);

  /**
   * Send the retained loop buffer to the peer as binary LOAD_INTERVAL chunks.
   * The retained loop is intentionally preserved on any failure so the caller
   * can trigger a fresh attempt via `retryRetainedLoopSyncRef`.
   */
  const sendRetainedLoopChunks = useCallback(async (): Promise<void> => {
    const retained = retainedKiteLoopBufferRef.current;
    if (!retained) return;

    const peer = peerRef.current;
    if (!peer || peer.destroyed || peer.connected !== true) {
      console.warn("[sendRetainedLoopChunks] peer not ready — retained loop preserved for retry");
      return;
    }

    const dataChannel = (peer as unknown as { _channel?: RTCDataChannel })._channel;
    if (!dataChannel || dataChannel.readyState !== "open") {
      console.warn("[sendRetainedLoopChunks] data channel not open — retained loop preserved for retry");
      return;
    }

    // Abort any in-progress send before starting a new one.
    kiteLoopSendAbortControllerRef.current?.abort("Replacing with new send attempt");
    const abortController = new AbortController();
    kiteLoopSendAbortControllerRef.current = abortController;

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
      console.error("[sendRetainedLoopChunks] failed to slice retained loop into chunks:", err);
      return; // Retained loop is preserved; caller can retry.
    }
    kiteLoopChunksRef.current = chunks;

    // Create a fresh sender bound to the current data channel.
    kiteLoopChunkSenderRef.current = new KiteDataChannelChunkSender(dataChannel);

    // Register a retry closure before attempting the send so callers can trigger
    // a fresh attempt if this one fails or the peer reconnects.
    retryRetainedLoopSyncRef.current = () => { void sendRetainedLoopChunks(); };

    try {
      await kiteLoopChunkSenderRef.current.sendChunks(chunks, { signal: abortController.signal });
      retryRetainedLoopSyncRef.current = null;
      console.log(
        "[sendRetainedLoopChunks] sent",
        chunks.length,
        "chunks for intervalId",
        retained.intervalId,
      );
    } catch (err) {
      if (abortController.signal.aborted) return; // Aborted intentionally — retained loop is preserved.
      console.error("[sendRetainedLoopChunks] send failed — retained loop preserved for retry:", err);
      // Intentionally do NOT clear retainedKiteLoopBufferRef.current here.
    }
  }, [sessionId, role]);

  const resetKiteSyncSessionRefs = useCallback(() => {
    if (studioParamDebounceTimerRef.current !== null) {
      window.clearTimeout(studioParamDebounceTimerRef.current);
      studioParamDebounceTimerRef.current = null;
    }
    studioParamPendingPatchRef.current = {};
    pendingKiteSyncRef.current = null;
    lastAcceptedKiteSyncSeqRef.current = 0;
    kiteSyncSequenceRef.current = 0;
    syncInitiatorIdRef.current = null;
    if (mountedRef.current) {
      setSyncInitiatorId(null);
    }
    studioRevisionRef.current = 0;
    lastAcceptedStudioRevisionRef.current = 0;
    lastAppliedGuestStartSecRef.current = null;
    lastSyncApplyAtMsRef.current = null;
    audioBaseLatencySecRef.current = 0;
    audioOutputLatencySecRef.current = 0;
    kiteGridAnchorContextSecRef.current = null;
  }, []);

  const applyKiteSyncPacketLossGuard = useCallback(
    (packetLossPercent: number | null) => {
      if (!kiteSyncEnabled) {
        kiteSyncLossRecoverySinceMsRef.current = null;
        if (kiteSyncLossPauseActiveRef.current) {
          kiteSyncLossPauseActiveRef.current = false;
          setKiteSyncNetworkMetronomePaused(false);
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
          stopKiteMetronome();
          setKiteSyncNetworkMetronomePaused(true);
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
        setKiteSyncNetworkMetronomePaused(false);
        setKiteSyncMetronomeResumeNonce((n) => n + 1);
      }
    },
    [kiteSyncEnabled, stopKiteMetronome]
  );

  applyKiteSyncLossGuardRef.current = applyKiteSyncPacketLossGuard;

  const teardownKiteSyncTransport = useCallback(() => {
    stopKiteMetronome();
    setBroadcastStatus("idle");
    kiteSyncCountInCompletionHandledRef.current = false;
    kiteSyncCountInActiveRef.current = false;
    kiteSyncCountInEndAtContextSecRef.current = 0;
    kiteSyncLossPauseActiveRef.current = false;
    kiteSyncLossRecoverySinceMsRef.current = null;
    if (mountedRef.current) {
      setKiteSyncCountInActive(false);
      setKiteSyncNetworkMetronomePaused(false);
    }
    resetKiteSyncSessionRefs();
  }, [stopKiteMetronome, resetKiteSyncSessionRefs]);

  useEffect(() => {
    const gainNode = metronomeGainRef.current;
    if (!gainNode) return;
    if (kiteSyncCountInActive) return;
    gainNode.gain.value = metronomeVolumeRef.current;
  }, [kiteSyncCountInActive]);

  useEffect(() => {
    if (kiteSyncEnabled) return;
    kiteSyncLossPauseActiveRef.current = false;
    kiteSyncLossRecoverySinceMsRef.current = null;
    setKiteSyncNetworkMetronomePaused(false);
    resetKiteSyncSessionRefs();
  }, [kiteSyncEnabled, resetKiteSyncSessionRefs]);

  const clearRecordedBlobUrl = useCallback(() => {
    setRecordedBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setRecordedDownloadExt("webm");
  }, []);

  const startRecordingTimer = useCallback((recorder: TrackRecorder) => {
    clearRecordingInterval();
    setRecordingTimeMs(0);
    recordingIntervalRef.current = window.setInterval(() => {
      setRecordingTimeMs(Math.max(0, Math.floor(performance.now() - recorder.getTimestamp())));
    }, 1000);
  }, [clearRecordingInterval]);

  const startLocalRecording = useCallback(() => {
    if (isRecording) return;
    const localStream = localStreamRef.current ?? localMicStream;
    if (!localStream) return;

    try {
      const recorder = new TrackRecorder();
      recorder.start(localStream);
      localRecorderRef.current = recorder;
      clearRecordedBlobUrl();
      startRecordingTimer(recorder);
      setIsRecording(true);
    } catch (err) {
      console.error("Failed to start local recording:", err);
      clearRecordingInterval();
      setIsRecording(false);
    }
  }, [
    clearRecordedBlobUrl,
    clearRecordingInterval,
    isRecording,
    localMicStream,
    startRecordingTimer,
  ]);

  const stopLocalRecording = useCallback(async () => {
    const recorder = localRecorderRef.current;
    if (!recorder) return;
    clearRecordingInterval();
    localRecorderRef.current = null;
    try {
      const ext = recorder.getDownloadExtension();
      const blob = await recorder.stop();
      setRecordedBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
      setRecordedDownloadExt(ext);
    } catch (err) {
      console.error("Failed to stop local recording:", err);
    } finally {
      setIsRecording(false);
    }
  }, [clearRecordedBlobUrl, clearRecordingInterval]);

  const downloadSoloSessionBlob = useCallback((blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kite-loop-session-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }, []);

  const stopSoloSessionRecording = useCallback(async () => {
    const recorder = soloSessionMediaRecorderRef.current;
    if (!recorder) return;
    soloSessionMediaRecorderRef.current = null;
    setSoloSessionRecorderState("saving");
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        const chunks = soloSessionChunksRef.current;
        const handleStop = (): void => {
          recorder.removeEventListener("stop", handleStop);
          recorder.removeEventListener("error", handleError as EventListener);
          const mime = recorder.mimeType?.trim() || "video/webm";
          resolve(new Blob(chunks, { type: mime }));
        };
        const handleError = (event: Event): void => {
          recorder.removeEventListener("stop", handleStop);
          recorder.removeEventListener("error", handleError as EventListener);
          const target = event as Event & { error?: DOMException };
          reject(target.error ?? new Error("MediaRecorder failed."));
        };
        recorder.addEventListener("stop", handleStop);
        recorder.addEventListener("error", handleError as EventListener);
        if (recorder.state === "inactive") {
          handleStop();
          return;
        }
        recorder.stop();
      });
      if (blob.size > 0) {
        downloadSoloSessionBlob(blob, "webm");
      }
    } catch (err) {
      console.error("[Solo session recorder] Failed to stop:", err);
    } finally {
      stopSoloSessionDisplayTracks(soloSessionDisplayStreamRef);
      soloSessionChunksRef.current = [];
      setSoloSessionRecorderState("idle");
    }
  }, [downloadSoloSessionBlob]);

  const clearJamSetupLockTimer = useCallback(() => {
    if (jamSetupLockTimerRef.current !== null) {
      window.clearTimeout(jamSetupLockTimerRef.current);
      jamSetupLockTimerRef.current = null;
    }
  }, []);

  const scheduleJamSetupLockExpiry = useCallback(
    (expiresAt: number) => {
      clearJamSetupLockTimer();
      const delayMs = expiresAt - Date.now();
      if (!Number.isFinite(delayMs) || delayMs <= 0) {
        jamSetupLockExpiresAtRef.current = null;
        setJamSetupLock(null);
        return;
      }
      jamSetupLockExpiresAtRef.current = expiresAt;
      jamSetupLockTimerRef.current = window.setTimeout(() => {
        jamSetupLockTimerRef.current = null;
        jamSetupLockExpiresAtRef.current = null;
        jamSetupLockTokenRef.current = null;
        setJamSetupLock(null);
      }, delayMs);
    },
    [clearJamSetupLockTimer]
  );

  const sendJamSetupLock = useCallback(
    (action: JamSetupLockAction): boolean => {
      const peer = peerRef.current;
      if (!peer || !peer.connected) return false;

      const ownerId = localJamSetupOwnerId;
      const ownerName = localJamSetupOwnerName;
      const expiresAt = action === "acquire" ? Date.now() + 60000 : undefined;
      const payload: JamSetupLockMessage = {
        type: "JAM_SETUP_LOCK",
        action,
        ownerId,
        ownerName,
        expiresAt,
      };

      try {
        peer.send(JSON.stringify(payload));
      } catch {
        return false;
      }

      if (action === "acquire" && expiresAt) {
        jamSetupLockTokenRef.current = ownerId;
        setJamSetupLock({ ownerId, ownerName, expiresAt });
        scheduleJamSetupLockExpiry(expiresAt);
      } else {
        clearJamSetupLockTimer();
        jamSetupLockTokenRef.current = null;
        jamSetupLockExpiresAtRef.current = null;
        setJamSetupLock(null);
      }

      return true;
    },
    [clearJamSetupLockTimer, localJamSetupOwnerId, localJamSetupOwnerName, scheduleJamSetupLockExpiry]
  );

  const clearSoloRunwayDisplay = useCallback(() => {
    if (soloRunwayGoClearTimerRef.current !== null) {
      clearTimeout(soloRunwayGoClearTimerRef.current);
      soloRunwayGoClearTimerRef.current = null;
    }
    setSoloRunwayDisplay(null);
    setVisualActiveBeatInBar(null);
  }, []);

  const cancelSoloCountInDownbeatWait = useCallback(() => {
    if (soloCountInDownbeatRafRef.current !== null) {
      cancelAnimationFrame(soloCountInDownbeatRafRef.current);
      soloCountInDownbeatRafRef.current = null;
    }
  }, []);

  const scheduleSoloCountInDownbeat = useCallback(
    (params: {
      ctx: AudioContext;
      downbeatContextSec: number;
      gen: number;
      onDownbeat: () => void | Promise<void>;
    }) => {
      cancelSoloCountInDownbeatWait();
      const eps = params.ctx.sampleRate > 0 ? 2 / params.ctx.sampleRate : 0.001;
      const tick = (): void => {
        if (!mountedRef.current || params.gen !== soloCountInPumpGenerationRef.current) {
          soloCountInDownbeatRafRef.current = null;
          return;
        }
        if (params.ctx.currentTime + eps < params.downbeatContextSec) {
          soloCountInDownbeatRafRef.current = requestAnimationFrame(tick);
          return;
        }
        soloCountInDownbeatRafRef.current = null;
        void Promise.resolve(params.onDownbeat()).catch((err) => {
          soloLooperStateRef.current = "idle";
          setSoloLooperState("idle");
          hasCapturedFirstKiteLoopRef.current = false;
          console.error("Solo looper failed to start:", err);
          setKiteSetupError(
            err instanceof Error ? err.message : "Failed to start looper engine."
          );
        });
      };
      soloCountInDownbeatRafRef.current = requestAnimationFrame(tick);
    },
    [cancelSoloCountInDownbeatWait]
  );

  const teardownSoloCountInPump = useCallback(() => {
    soloCountInPumpGenerationRef.current += 1;
    cancelSoloCountInDownbeatWait();
    soloCountInPumpRef.current?.teardown();
    soloCountInPumpRef.current = null;
    soloCountInEndAtContextSecRef.current = 0;
    soloCountInBeatSecRef.current = 0;
    clearSoloRunwayDisplay();
  }, [cancelSoloCountInDownbeatWait, clearSoloRunwayDisplay]);

  const cleanupKiteEngine = useCallback(
    ({
      stopLocalTracks = false,
      isFull = false,
      preserveTiming = false,
      preserveSoloSessionRecording = false,
    }: {
      stopLocalTracks?: boolean;
      isFull?: boolean;
      preserveTiming?: boolean;
      preserveSoloSessionRecording?: boolean;
    } = {}) => {
      // ── Solo engine ──────────────────────────────────────────────────────────
      hasCapturedFirstKiteLoopRef.current = false;
      soloLooperStateRef.current = "idle";
      if (loopProgressRafRef.current !== null) {
        cancelAnimationFrame(loopProgressRafRef.current);
        loopProgressRafRef.current = null;
      }
      if (!preserveSoloSessionRecording) {
        void stopSoloSessionRecording();
      }
      teardownSoloCountInPump();
      if (!preserveTiming) {
        kiteIntervalTimingRef.current = null;
      }
      isMasterPausedRef.current = false;
      setSoloLooperState("idle");
      setIsMasterPaused(false);
      setLoopProgress(0);
      isRecordingArmedRef.current = false;
      setIsRecordingArmed(false);
      setRecordingArmedCountdown(null);
      if (!preserveSoloSessionRecording) {
        setKiteMode("live");
      }

      // ── P2P engine ───────────────────────────────────────────────────────────
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

      // ── Chunk transfer ───────────────────────────────────────────────────────
      kiteLoopSendAbortControllerRef.current?.abort();
      kiteLoopSendAbortControllerRef.current = null;
      kiteLoopChunksRef.current = null;
      kiteLoopChunkSenderRef.current = null;
      kiteLoopReassemblerRef.current = null;
      setLoopChunkSendError(null);
      setLoopChunkSendProgress({ status: "idle", sentChunks: 0, totalChunks: 0 });

      // ── Full cleanup only ────────────────────────────────────────────────────
      if (isFull) {
        retainedKiteLoopBufferRef.current = null;
        retainedRemoteKiteLoopRef.current = null;
        lastRetainedKiteIntervalIdRef.current = null;
        lastRetainedKiteSequenceRef.current = null;
        retryRetainedLoopSyncRef.current = null;

        // Restore the outbound WebRTC audio sender from the muted Kite clone back
        // to the original live mic track. Only do this on full cleanup — partial
        // Solo-to-P2P transition cleanup must never accidentally restore VoIP.
        if (voipSenderMutedForKiteRef.current) {
          const peer = peerRef.current as (Peer.Instance & { replaceTrack?: (o: MediaStreamTrack, n: MediaStreamTrack, s: MediaStream) => void }) | null;
          const original = originalVoipSenderTrackRef.current;
          const clone = mutedVoipCloneTrackRef.current;
          const stream = localStreamRef.current;
          if (peer && typeof peer.replaceTrack === "function" && original && clone && stream) {
            try {
              peer.replaceTrack(clone, original, stream);
            } catch {
              // Peer may already be destroyed; restoration is best-effort.
            }
          }
          voipSenderMutedForKiteRef.current = false;
          originalVoipSenderTrackRef.current = null;
          mutedVoipCloneTrackRef.current = null;
        }

        // Disconnect all interface live monitor graphs. Partial Solo-to-P2P
        // transition cleanup must leave these running so the user continues to
        // hear hardware interface inputs during the mode switch.
        teardownAllInterfaceLiveMonitorGraphs();
      }

      if (stopLocalTracks) {
        const stoppedTrackIds = new Set<string>();
        stopMediaStreamTracks(localStreamRef.current, stoppedTrackIds);
        stopMediaStreamTracks(localMicStreamRef.current, stoppedTrackIds);
        localStreamRef.current = null;
        localMicStreamRef.current = null;
        setLocalMicStream(null);
      }
    },
    [
      stopMediaStreamTracks,
      stopSoloSessionRecording,
      teardownAllInterfaceLiveMonitorGraphs,
      teardownSoloCountInPump,
    ]
  );

  const handleStartKiteSetup = useCallback(
    (origin: KiteSetupOrigin) => {
      setKiteSetupStep(1);
      setKiteSetupTimeSignatureTop(4);
      setKiteSetupTimeSignatureBottom(4);
      setKiteSetupIsSwing(false);
      setKiteSetupChordCount(4);
      setKiteSetupUsesCustomChords(false);
      setKiteSetupTempo(metronomeBpm);
      setKiteSetupOrigin(origin);
      setKiteSetupMode(origin === "lobby" ? "solo" : "sync");
      setKiteSetupError(null);
      setStudioUiPhase("kite-setup");
    },
    [metronomeBpm]
  );

  const handleCancelKiteSetup = useCallback(() => {
    if (kiteSetupOrigin === "connected") {
      sendJamSetupLock("release");
      setStudioUiPhase("studio");
      return;
    }
    setStudioUiPhase("lobby");
    cleanupKiteEngine({ stopLocalTracks: true, isFull: true });
  }, [cleanupKiteEngine, kiteSetupOrigin, sendJamSetupLock]);

  const goToNextKiteSetupStep = useCallback(() => {
    setKiteSetupStep((step) => (step < 5 ? ((step + 1) as KiteSetupStep) : step));
  }, []);

  const goToPreviousKiteSetupStep = useCallback(() => {
    setKiteSetupStep((step) => (step > 1 ? ((step - 1) as KiteSetupStep) : step));
  }, []);

  const handleTapBeat = useCallback(() => {
    const now = performance.now();
    const taps = tapBeatTimestampsRef.current;
    const lastTap = taps[taps.length - 1] ?? 0;

    if (now - lastTap > 2000) {
      tapBeatTimestampsRef.current = [now];
      return;
    }

    const recentTaps = [...taps, now].slice(-8);
    tapBeatTimestampsRef.current = recentTaps;
    if (recentTaps.length < 4) return;

    const intervals = recentTaps.slice(1).map((tap, index) => tap - recentTaps[index]);
    const avgMs = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    if (!Number.isFinite(avgMs) || avgMs <= 0) return;

    const nextBpm = Math.round(60000 / avgMs);
    const clamped = Math.max(40, Math.min(240, nextBpm));
    setKiteSetupTempo(clamped);
    broadcastWizardStudioParam({ kiteSetupTempo: clamped, bpm: clamped });
  }, [broadcastWizardStudioParam]);

  const deriveKiteTimingMetadata = useCallback(
    (opts?: { overrideBpm?: number }): KiteIntervalTiming => {
      const localSampleRate = getStudioKiteSampleRate();
      const bpm = Math.max(
        20,
        Math.min(320, Math.round(opts?.overrideBpm ?? kiteSetupTempo))
      );
      const chords = Math.max(1, Math.min(64, Math.round(kiteSetupChordCount)));
      const beatsPerBar = Math.max(1, Math.min(16, Math.round(kiteSetupTimeSignatureTop)));
      const bpi = chords * beatsPerBar;
      const loopDurationSeconds = calcLoopDurationSeconds(bpm, bpi);
      const localIntervalFrames = calcIntervalFrames(loopDurationSeconds, localSampleRate);

      const timing: KiteIntervalTiming = {
        bpm,
        chords,
        beatsPerBar,
        timeSignatureTop: beatsPerBar,
        timeSignatureBottom: Math.max(1, Math.min(32, Math.round(kiteSetupTimeSignatureBottom))),
        bpi,
        loopDurationSeconds,
        intervalMs: loopDurationSeconds * 1000,
        hostSampleRate: localSampleRate,
        hostIntervalFrames: localIntervalFrames,
        localSampleRate,
        localIntervalFrames,
      };
      kiteIntervalTimingRef.current = timing;
      setBeatsPerInterval(bpi);
      setMetronomeBpm(bpm);
      return timing;
    },
  [
    getStudioKiteSampleRate,
    kiteSetupChordCount,
    kiteSetupTempo,
    kiteSetupTimeSignatureBottom,
    kiteSetupTimeSignatureTop,
  ]);

  const playSoloMetronomeClick = useCallback(
    (isDownbeat: boolean, startAtContextSec?: number, forceAudio?: boolean) => {
      const ctx = studioAudioContextRef.current;
      if (!ctx || ctx.state === "closed") return;

      const startAt = Math.max(ctx.currentTime, startAtContextSec ?? ctx.currentTime);

      const shouldPlayAudio =
        ctx.state === "running" && (forceAudio || !isVisualMetronomeOnlyRef.current);
      if (shouldPlayAudio) {
        const metronomeParent = ensureMetronomeGainNode(ctx);
        const countInLocksBroadcastSilence = kiteSyncCountInActiveRef.current;
        const bypassMetronomeGain =
          Boolean(forceAudio) && countInLocksBroadcastSilence;
        const metronomeVol = metronomeVolumeRef.current;

        const oscillator = ctx.createOscillator();
        scheduledMetronomeOscillatorsRef.current.add(oscillator);
        const gain = ctx.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(isDownbeat ? 1600 : 1050, startAt);
        const peakBase = isDownbeat ? 0.11 : 0.07;
        const peakEnv = bypassMetronomeGain ? peakBase * metronomeVol : peakBase;
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(peakEnv, startAt + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.045);
        oscillator.connect(gain);
        if (bypassMetronomeGain) {
          gain.connect(ctx.destination);
        } else {
          gain.connect(metronomeParent);
        }
        oscillator.start(startAt);
        oscillator.stop(startAt + 0.05);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
          scheduledMetronomeOscillatorsRef.current.delete(oscillator);
        };
      }
    },
    [ensureMetronomeGainNode]
  );

  const cancelScheduledMetronomeClicks = useCallback(() => {
    scheduledMetronomeOscillatorsRef.current.forEach(oscillator => {
      try {
        oscillator.stop();
        oscillator.disconnect();
      } catch (e) {
        // Oscillator may have already stopped/disconnected
      }
    });
    scheduledMetronomeOscillatorsRef.current.clear();

    setVisualActiveBeatInBar(null);
  }, []);

  const handleSoloLooperEvent = useCallback(
    (event: SoloLooperEngineEvent, ctx: AudioContext) => {
      const intervalId = soloLooperEventIntervalIdRef.current ?? `${sessionId ?? "solo"}-bootstrap`;
      const sequenceNumber = soloLooperEventSequenceNumberRef.current;
      if (event.type === "PLAYBACK_UI_STATE") {
        if (!mountedRef.current) return;
        const sanitizedSlots = event.slots.map((slot) => {
          if (
            handsfreeSequenceActiveRef.current &&
            slot.mode === "recording"
          ) {
            return slot;
          }
          if (
            slot.mode === "recording" &&
            soloLooperActiveRecordTrackIndexRef.current !== slot.trackIndex
          ) {
            return {
              ...slot,
              mode: slot.trackIndex === 1 ? "captured" : "playing",
            };
          }
          return slot;
        });
        soloTrackSlotUiLatestRef.current = sanitizedSlots;
        setSoloTrackSlotUi(sanitizedSlots);
        return;
      }
      if (event.type === "LOOP_STATE") {
        if (!mountedRef.current) return;
        if (event.state === "PAUSED") {
          isMasterPausedRef.current = true;
          setIsMasterPaused(true);
          return;
        }
        if (event.state === "RESUMED") {
          isMasterPausedRef.current = false;
          setIsMasterPaused(false);
          return;
        }
        if (event.state === "TRACK_RESET") {
          if (event.trackIndex === 1) {
            hasCapturedFirstKiteLoopRef.current = false;
            masterLoopIntervalFramesRef.current = null;
            setSoloMasterLoopFrames(null);
            setLoopProgress(0);
            soloLooperStateRef.current = "idle";
            setSoloLooperState("idle");
          }
          if (soloOverdubArmedTrackIndexRef.current === event.trackIndex || event.trackIndex === 1) {
            soloOverdubArmedTrackIndexRef.current = null;
            setSoloOverdubArmedTrackIndex(null);
          }
          syncActiveRecordTrackIndex(null);
          soloLooperLoopFinalizePendingRef.current = false;
          return;
        }
        return;
      }
      if (event.type === "OVERDUB_ARMED") {
        if (!mountedRef.current) return;
        soloOverdubArmedTrackIndexRef.current = event.trackIndex;
        setSoloOverdubArmedTrackIndex(event.trackIndex);
        return;
      }
      if (event.type === "OVERDUB_ARM_REJECTED") {
        if (!mountedRef.current) return;
        if (event.reason === "master_not_playing_at_finalize") {
          console.warn(
            "[Solo looper] Overdub finalize rejected: master not playing at phase lock."
          );
          soloLooperLoopFinalizePendingRef.current = false;
          soloOverdubArmedTrackIndexRef.current = null;
          setSoloOverdubArmedTrackIndex(null);
        }
        return;
      }
      if (event.type === "CONFIGURE_REJECTED") {
        if (!mountedRef.current) return;
        console.warn(
          "[Solo looper] Configure rejected:",
          event.reason,
          event.trackIndex ?? "(no track)"
        );
        soloLooperLoopFinalizePendingRef.current = false;
        soloOverdubArmedTrackIndexRef.current = null;
        setSoloOverdubArmedTrackIndex(null);
        return;
      }
      if (event.type === "OVERDUB_STARTED") {
        if (!mountedRef.current) return;
        soloLooperEngineRef.current?.stopAudibleMetronome();
        soloOverdubArmedTrackIndexRef.current = null;
        setSoloOverdubArmedTrackIndex(null);
        syncActiveRecordTrackIndex(event.trackIndex);
        soloLooperStateRef.current = "recording";
        setSoloLooperState("recording");
        return;
      }
      if (event.type === "OVERDUB_DISARMED") {
        if (!mountedRef.current) return;
        if (soloOverdubArmedTrackIndexRef.current === event.trackIndex) {
          soloOverdubArmedTrackIndexRef.current = null;
          setSoloOverdubArmedTrackIndex(null);
        }
        return;
      }
      if (event.type === "HANDSFREE_TRACK_ADVANCED") {
        if (!mountedRef.current) return;
        syncActiveRecordTrackIndex(event.toTrack);
        soloLooperStateRef.current = "recording";
        setSoloLooperState("recording");
        if (loopProgressRafRef.current !== null) {
          cancelAnimationFrame(loopProgressRafRef.current);
        }
        const masterFrames = masterLoopIntervalFramesRef.current;
        const progressSampleRate =
          Number.isFinite(ctx.sampleRate) && ctx.sampleRate > 0 ? ctx.sampleRate : 44100;
        const intervalMs = masterFrames
          ? (masterFrames / progressSampleRate) * 1000
          : (kiteIntervalTimingRef.current?.localIntervalFrames ?? 0) /
              (kiteIntervalTimingRef.current?.localSampleRate ?? progressSampleRate) *
              1000;
        const startedAt = performance.now();
        const animateProgress = (): void => {
          if (soloLooperStateRef.current !== "recording") {
            loopProgressRafRef.current = null;
            return;
          }
          const elapsedMs = performance.now() - startedAt;
          const currentTick = Math.min(intervalMs, Math.max(0, elapsedMs));
          setLoopProgress(Math.min(100, Math.max(0, (currentTick / intervalMs) * 100)));
          if (elapsedMs < intervalMs) {
            loopProgressRafRef.current = requestAnimationFrame(animateProgress);
          } else {
            loopProgressRafRef.current = null;
          }
        };
        animateProgress();
        return;
      }
      if (event.type === "HANDSFREE_SEQUENCE_COMPLETE") {
        if (!mountedRef.current) return;
        syncHandsfreeSequenceActive(false);
        syncActiveRecordTrackIndex(null);
        if (loopProgressRafRef.current !== null) {
          cancelAnimationFrame(loopProgressRafRef.current);
          loopProgressRafRef.current = null;
        }
        setLoopProgress(100);
        soloLooperEngineRef.current?.stopAudibleMetronome();
        cancelScheduledMetronomeClicks();
        soloLooperStateRef.current = "captured";
        setSoloLooperState("captured");
        setSoloTrackSlotUi((prev) => {
          const next = prev
            ? prev.map((slot) => ({
                ...slot,
                mode: slot.mode === "recording" ? "playing" : slot.mode,
              }))
            : prev;
          soloTrackSlotUiLatestRef.current = next;
          return next;
        });
        return;
      }
      if (event.type === "AUTO_STOP_COMPLETED") {
        if (!mountedRef.current) return;
        if (handsfreeSequenceActiveRef.current && event.trackIndex < 4) {
          return;
        }
        syncActiveRecordTrackIndex(null);
        soloLooperEngineRef.current?.stopAudibleMetronome();
        cancelScheduledMetronomeClicks();
        if (event.trackIndex === 1) {
          setLoopProgress(100);
          soloLooperStateRef.current = "captured";
          setSoloLooperState("captured");
        }
        setSoloTrackSlotUi((prev) => {
          const next = prev
            ? prev.map((slot) =>
                slot.trackIndex === event.trackIndex
                  ? {
                      ...slot,
                      mode: event.trackIndex === 1 ? "captured" : "playing",
                    }
                  : slot
              )
            : prev;
          soloTrackSlotUiLatestRef.current = next;
          return next;
        });
        return;
      }
      if (event.type === "CALIBRATION_RESULT") {
        if (!mountedRef.current) return;
        if (event.latencyFrames === null) {
          setSoloLatencyCalibrationStatus("error");
          setSoloLatencyCalibrationMessage("No input response detected. Increase speaker level and try again.");
          return;
        }
        const resultSampleRate =
          Number.isFinite(ctx.sampleRate) && ctx.sampleRate > 0 ? ctx.sampleRate : 44100;
        const measuredMs = Math.round((event.latencyFrames / resultSampleRate) * 1000);
        const trueOverdubMs = measuredMs;
        const clampedMs = clampSoloLatencyMs(trueOverdubMs);
        console.log(
          `Latency Calibrated | RTL: ${measuredMs}ms | Applied Overdub Latency: ${clampedMs}ms`
        );
        soloLooperLatencyMsRef.current = clampedMs;
        setSoloLooperLatencyMs(clampedMs);
        setSoloLatencyCalibrationStatus("success");
        setSoloLatencyCalibrationMessage(`RTL ${measuredMs} ms, applied overdub latency ${clampedMs} ms.`);
        return;
      }
      if (event.type !== "LOOP_READY") return;
      soloLooperLoopFinalizePendingRef.current = false;
      syncActiveRecordTrackIndex(null);
      if (soloLooperStateRef.current !== "recording") return;
      const ti = event.trackIndex ?? 1;

      if (ti === 1) {
        if (hasCapturedFirstKiteLoopRef.current) return;
        hasCapturedFirstKiteLoopRef.current = true;
        masterLoopIntervalFramesRef.current = event.intervalFrames;
        setSoloMasterLoopFrames(event.intervalFrames);
        const retainedIntervalId = event.loopId ?? intervalId;
        const retainedSequenceNumber = sequenceNumber;
        const retainedBuffer = event.buffer.slice(0);
        retainedKiteLoopBufferRef.current = {
          intervalId: retainedIntervalId,
          sequenceNumber: retainedSequenceNumber,
          sampleRate: event.sampleRate,
          intervalFrames: event.intervalFrames,
          channelCount: event.channelCount,
          buffer: retainedBuffer,
        };
        lastRetainedKiteIntervalIdRef.current = retainedIntervalId;
        lastRetainedKiteSequenceRef.current = retainedSequenceNumber;
      }

      if (handsfreeSequenceActiveRef.current) {
        return;
      }

      if (loopProgressRafRef.current !== null) {
        cancelAnimationFrame(loopProgressRafRef.current);
        loopProgressRafRef.current = null;
      }
      setLoopProgress(100);
      soloLooperEngineRef.current?.stopAudibleMetronome();
      cancelScheduledMetronomeClicks();
      soloLooperStateRef.current = "captured";
      setSoloLooperState("captured");
    },
    [cancelScheduledMetronomeClicks, sessionId, syncActiveRecordTrackIndex, syncHandsfreeSequenceActive]
  );

  const ensureSoloLooperEngineBootstrapped = useCallback(async (): Promise<SoloLooperEngine> => {
    const ctx = ensureStudioAudioContext();
    await ctx.resume();
    if (ctx.state !== "running") {
      setAudioContextReady(false);
      throw new Error("AudioContext is not running. Use Resume Audio or Enter Studio first.");
    }
    setAudioContextReady(true);

    const destinationNode = ensureMasterDestinationNode();
    if (!destinationNode) {
      throw new Error("Kite Sync output destination is unavailable.");
    }

    const { inputStream, masterStream } = resolveSoloLooperInputStream(destinationNode);
    if (!inputStream || inputStream.getAudioTracks().length === 0) {
      throw new Error("Raw microphone stream is unavailable for session recording.");
    }
    if (inputStream === destinationNode.stream || inputStream === masterStream) {
      throw new Error("Session recording input must be raw mic audio, not the master mix.");
    }

    const existing = soloLooperEngineRef.current;
    if (existing) {
      return existing;
    }

    const localSr = Math.round(ctx.sampleRate);
    const maxProvisionFrames = Math.max(1, Math.floor(localSr * 60));
    const bootstrapIntervalId = `${sessionId ?? "solo"}-bootstrap-${Date.now()}`;
    const bootstrapSequenceNumber = (lastRetainedKiteSequenceRef.current ?? 0) + 1;
    const engine = await buildSoloLooperEngine({
      audioContext: ctx,
      inputStream,
      destinationNode,
      timing: {
        localSampleRate: localSr,
        localIntervalFrames: maxProvisionFrames,
      },
      loopId: bootstrapIntervalId,
      trackIndex: 1,
      channelCount: 2,
      monitorDestination: ctx.destination,
      monitorGain: 1,
      inputGain: (soloInputGain / 10) * 2,
      onEvent: (event) => handleSoloLooperEvent(event, ctx),
    });
    soloLooperEngineRef.current = engine;
    engine.setMetronomeGainNode(metronomeGainRef.current);
    soloLooperEventIntervalIdRef.current = bootstrapIntervalId;
    soloLooperEventSequenceNumberRef.current = bootstrapSequenceNumber;
    return engine;
  }, [
    ensureMasterDestinationNode,
    ensureStudioAudioContext,
    handleSoloLooperEvent,
    resolveSoloLooperInputStream,
    sessionId,
  ]);

  const startSoloSessionRecording = useCallback(async () => {
    if (soloSessionMediaRecorderRef.current) return;

    let displayStream: MediaStream;
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 30 } },
        audio: false,
      });
    } catch (err) {
      console.warn("[Solo session recorder] Display capture cancelled or denied:", err);
      return;
    }

    soloSessionDisplayStreamRef.current = displayStream;

    try {
      const engine = await ensureSoloLooperEngineBootstrapped();
      const recordingStream = engine.getSessionRecordingStream();
      if (recordingStream.getAudioTracks().length === 0) {
        throw new Error("Session recording audio stream is unavailable.");
      }

      const combinedStream = new MediaStream([
        ...displayStream.getVideoTracks(),
        ...recordingStream.getAudioTracks(),
      ]);

      soloSessionChunksRef.current = [];
      const recorderOptions = selectSessionVideoMediaRecorderOptions();
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(combinedStream, recorderOptions);
      } catch (primaryErr) {
        try {
          const { mimeType } = recorderOptions;
          recorder = new MediaRecorder(
            combinedStream,
            mimeType ? { mimeType } : {}
          );
        } catch {
          try {
            recorder = new MediaRecorder(combinedStream);
          } catch (fallbackErr) {
            throw primaryErr instanceof Error ? primaryErr : fallbackErr;
          }
        }
      }

      recorder.ondataavailable = (event: BlobEvent): void => {
        if (event.data.size > 0) {
          soloSessionChunksRef.current.push(event.data);
        }
      };

      soloSessionMediaRecorderRef.current = recorder;
      recorder.start(1000);

      if (isMasterPausedRef.current) {
        recorder.pause();
        setSoloSessionRecorderState("paused");
      } else {
        setSoloSessionRecorderState("recording");
      }
    } catch (err) {
      console.error("[Solo session recorder] Failed to start:", err);
      stopSoloSessionDisplayTracks(soloSessionDisplayStreamRef);
      soloSessionMediaRecorderRef.current = null;
      soloSessionChunksRef.current = [];
      setSoloSessionRecorderState("idle");
    }
  }, [ensureSoloLooperEngineBootstrapped]);

  const handleToggleSoloSessionRecording = useCallback(() => {
    if (soloSessionMediaRecorderRef.current) {
      void stopSoloSessionRecording();
      return;
    }
    void startSoloSessionRecording();
  }, [startSoloSessionRecording, stopSoloSessionRecording]);

  const startSoloLooper = useCallback(
    async (
      timing: KiteIntervalTiming,
      options?: { recordStartContextSec?: number }
    ): Promise<void> => {
      const ctx = ensureStudioAudioContext();
      await ctx.resume();
      if (ctx.state !== "running") {
        setAudioContextReady(false);
        throw new Error("AudioContext could not be started for Kite Sync.");
      }
      setAudioContextReady(true);

      const destinationNode = ensureMasterDestinationNode();
      if (!destinationNode) {
        throw new Error("Kite Sync output destination is unavailable.");
      }

      const { inputStream, masterStream } = resolveSoloLooperInputStream(destinationNode);
      if (!inputStream || inputStream.getAudioTracks().length === 0) {
        throw new Error("Raw microphone stream is unavailable for Kite Sync.");
      }
      if (inputStream === destinationNode.stream || inputStream === masterStream) {
        throw new Error("Kite Sync input must be raw mic audio, not the master mix.");
      }

      const MAX_SOLO_TRACK_RAM_SECONDS = 60;
      const localSr = Math.round(ctx.sampleRate);
      const maxProvisionFrames = Math.max(1, Math.floor(localSr * MAX_SOLO_TRACK_RAM_SECONDS));
      const provisionalLoopDurationSec = maxProvisionFrames / localSr;
      const engineTiming: KiteIntervalTiming = {
        ...timing,
        localSampleRate: localSr,
        hostSampleRate: localSr,
        loopDurationSeconds: provisionalLoopDurationSec,
        intervalMs: provisionalLoopDurationSec * 1000,
        localIntervalFrames: maxProvisionFrames,
        hostIntervalFrames: maxProvisionFrames,
      };

      const intervalId = `${sessionId ?? "solo"}-${Date.now()}`;
      soloLooperLiveLoopIdRef.current = intervalId;
      const sequenceNumber = (lastRetainedKiteSequenceRef.current ?? 0) + 1;
      let engine = soloLooperEngineRef.current;
      if (!engine) {
        engine = await buildSoloLooperEngine({
          audioContext: ctx,
          inputStream,
          destinationNode,
          timing: engineTiming,
          loopId: intervalId,
          trackIndex: 1,
          channelCount: 2,
          monitorDestination: ctx.destination,
          monitorGain: 1,
          inputGain: (soloInputGain / 10) * 2,
          onEvent: (event) => handleSoloLooperEvent(event, ctx),
        });
        soloLooperEngineRef.current = engine;
        engine.setMetronomeGainNode(metronomeGainRef.current);
      }
      soloLooperEventIntervalIdRef.current = intervalId;
      soloLooperEventSequenceNumberRef.current = sequenceNumber;

      /** Re-provision Track 1 after RESET_TRACK wipes slots (`intervalFrames` must be > 0 before START_RECORDING). */
      engine.selectTrack(1);
      engine.configureLoop({
        intervalFrames: maxProvisionFrames,
        sampleRate: localSr,
        channelCount: 2,
        loopId: intervalId,
        trackIndex: 1,
      });

      isMasterPausedRef.current = false;
      setIsMasterPaused(false);
      soloMetronomeAnchorContextSecRef.current =
        options?.recordStartContextSec !== undefined && Number.isFinite(options.recordStartContextSec)
          ? options.recordStartContextSec
          : ctx.currentTime;
      for (let t = 1; t <= 4; t += 1) {
        engine.setTrackGain(t, soloTrackVolumesRef.current[t - 1]);
      }

      const buildStartRecordingParams = () => {
        const startSampleRate = Number.isFinite(ctx.sampleRate) && ctx.sampleRate > 0
          ? ctx.sampleRate
          : 44100;
        const latencyOffsetFrames = Math.max(
          0,
          Math.round((soloLooperLatencyMsRef.current / 1000) * startSampleRate)
        );
        let targetLengthFrames: number | undefined;
        if (soloLooperModeRef.current === "grid" || soloLooperModeRef.current === "handsfree") {
          const timingSnapshot = kiteIntervalTimingRef.current;
          const bpm = Math.max(
            1,
            Math.round(timingSnapshot?.bpm ?? kiteSetupTempoRef.current ?? 120)
          );
          const beatsPerBar = Math.max(
            1,
            Math.round(
              timingSnapshot?.beatsPerBar ??
                timingSnapshot?.timeSignatureTop ??
                kiteSetupTimeSignatureTopRef.current ??
                4
            )
          );
          const barCount = Math.max(1, Math.round(soloLooperBarCountRef.current || 1));
          const secondsPerBeat = 60 / bpm;
          const totalSeconds = secondsPerBeat * beatsPerBar * barCount;
          targetLengthFrames = Math.max(1, Math.round(totalSeconds * startSampleRate));
        }

        return {
          loopMode: soloLooperModeRef.current,
          latencyOffsetFrames,
          ...(targetLengthFrames !== undefined ? { targetLengthFrames } : {}),
        };
      };

      const recordStartAt = options?.recordStartContextSec;
      const hasRecordAnchor =
        recordStartAt !== undefined && Number.isFinite(recordStartAt);
      syncActiveRecordTrackIndex(1);
      if (soloLooperModeRef.current === "handsfree") {
        syncHandsfreeSequenceActive(true);
      } else {
        syncHandsfreeSequenceActive(false);
      }
      if (!isVisualMetronomeOnlyRef.current) {
        engine.startAudibleMetronome(
          timing.bpm,
          hasRecordAnchor ? recordStartAt : undefined
        );
      }
      engine.startRecording({
        ...buildStartRecordingParams(),
        ...(hasRecordAnchor ? { recordStartContextSec: recordStartAt } : {}),
      });

      if (soloLooperPendingCommitRef.current) {
        soloLooperPendingCommitRef.current = false;
        commitActiveRecordingRef.current();
      }

      if (loopProgressRafRef.current !== null) {
        cancelAnimationFrame(loopProgressRafRef.current);
      }
      const intervalMs = (engineTiming.localIntervalFrames / engineTiming.localSampleRate) * 1000;
      const startedAt = performance.now();
      const animateProgress = () => {
        if (soloLooperStateRef.current !== "recording") {
          loopProgressRafRef.current = null;
          return;
        }
        const elapsedMs = performance.now() - startedAt;
        const currentTick = Math.min(intervalMs, Math.max(0, elapsedMs));
        setLoopProgress(Math.min(100, Math.max(0, (currentTick / intervalMs) * 100)));
        if (elapsedMs < intervalMs) {
          loopProgressRafRef.current = requestAnimationFrame(animateProgress);
        } else {
          loopProgressRafRef.current = null;
        }
      };
      animateProgress();
      setKiteMode(kiteSetupMode === "sync" ? "sync" : "solo");
    },
    [
      ensureMasterDestinationNode,
      ensureStudioAudioContext,
      handleSoloLooperEvent,
      kiteSetupMode,
      resolveSoloLooperInputStream,
      sessionId,
      syncHandsfreeSequenceActive,
    ]
  );

  const restoreLiveVoipTrackAfterKite = useCallback(() => {
    if (voipSenderMutedForKiteRef.current) {
      const original = originalVoipSenderTrackRef.current;
      const clone = mutedVoipCloneTrackRef.current;
      const stream = localStreamRef.current;
      if (original && clone && stream) {
        replacePeerAudioTrack(clone, original, stream, stream);
        try {
          clone.stop();
        } catch {
          /* ignore */
        }
      }
      voipSenderMutedForKiteRef.current = false;
      originalVoipSenderTrackRef.current = null;
      mutedVoipCloneTrackRef.current = null;
    }
  }, [replacePeerAudioTrack]);

  useEffect(() => {
    hostExitKiteBroadcastOnPeerDisconnectRef.current = () => {
      if (!mountedRef.current) return;
      restoreLiveVoipTrackAfterKite();
      cleanupKiteEngine({ stopLocalTracks: false, isFull: false });
      const rs = remoteStreamRef.current;
      if (rs) buildRemotePlaybackGraph(rs);
      setKiteSyncEnabled(false);
      setBroadcastStatus("idle");
      setKiteSyncCountInActive(false);
    };
  }, [buildRemotePlaybackGraph, cleanupKiteEngine, restoreLiveVoipTrackAfterKite]);

  const advanceP2PGridBoundaries = useCallback((periodSec: number) => {
    const ctxNow = studioAudioContextRef.current;
    if (!ctxNow || ctxNow.state === "closed") return;
    if (!Number.isFinite(periodSec) || periodSec <= 0) return;

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
        console.log(
          "[P2P TICK] loaded remote interval",
          peeked.intervalId,
          "tickSeq",
          tickSeq,
          "fifoRemaining",
          fifo.length
        );
      } else if (tickSeq > 1) {
        console.warn(
          "[P2P TICK] no remote interval queued at tickSeq",
          tickSeq,
          "— remote audio may be late or dropped"
        );
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
            "— packet may be lost or network is slow"
          );
        }
      }, intervalDurationMs) as unknown as number;

      nextBoundary += periodSec;
    }
    p2pGridNextBoundaryContextSecRef.current = nextBoundary;
  }, []);

  const startP2PIntervalScheduler = useCallback(
    (timing: KiteIntervalTiming) => {
      p2pGridPumpGenerationRef.current += 1;
      const gen = p2pGridPumpGenerationRef.current;
      kiteP2PGridPumpRef.current?.teardown();
      kiteP2PGridPumpRef.current = null;

      const periodSec = timing.localIntervalFrames / timing.localSampleRate;
      const ctxInit = studioAudioContextRef.current;
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

      const ctx = studioAudioContextRef.current;
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
            studioAudioContextRef.current?.state !== "running"
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
    },
    [advanceP2PGridBoundaries]
  );

  useEffect(() => {
    startP2PIntervalSchedulerRef.current = startP2PIntervalScheduler;
  }, [startP2PIntervalScheduler]);

  const handleStartBroadcastCountIn = useCallback(() => {
    void (async () => {
      const ctx = studioAudioContextRef.current ?? ensureStudioAudioContext();
      await ctx.resume();
      if (ctx.state !== "running") {
        setAudioContextReady(false);
        return;
      }
      setAudioContextReady(true);

      flushAndSetRemoteGridTarget(ctx.currentTime + 0.01);

      const countInOneBarSec =
        (60 / metronomeBpm) * Math.max(1, Math.round(kiteSetupTimeSignatureTop));
      if (!Number.isFinite(countInOneBarSec) || countInOneBarSec <= 0) {
        return;
      }

      kiteSyncCountInEndAtContextSecRef.current = ctx.currentTime + countInOneBarSec;
      if (metronomeGainRef.current) {
        metronomeGainRef.current.gain.value = 0;
      }
      setKiteSyncCountInActive(true);
      kiteSyncCountInActiveRef.current = true;
      kiteSyncCountInCompletionHandledRef.current = false;

      setKiteSyncEnabled(true);
      setBroadcastStatus("syncing");
      syncInitiatorIdRef.current = localJamSetupOwnerId;
      if (mountedRef.current) {
        setSyncInitiatorId(localJamSetupOwnerId);
      }
      broadcastKiteSync({ kiteSyncEnabled: true });

      const timing =
        latestKiteIntervalTimingRef.current ?? kiteIntervalTimingRef.current;
      if (timing) {
        startP2PIntervalSchedulerRef.current?.(timing);
      } else {
        console.warn("[Kite] Host scheduler ignite skipped — no timing ref");
      }
    })();
  }, [
    broadcastKiteSync,
    ensureStudioAudioContext,
    flushAndSetRemoteGridTarget,
    kiteSetupTimeSignatureTop,
    localJamSetupOwnerId,
    metronomeBpm,
    setAudioContextReady,
    setBroadcastStatus,
    setKiteSyncCountInActive,
    setKiteSyncEnabled,
  ]);

  const startP2PEngine = useCallback(
    async (timing: KiteIntervalTiming): Promise<void> => {
      const ctx = ensureStudioAudioContext();
      await ctx.resume();
      if (ctx.state !== "running") {
        setAudioContextReady(false);
        throw new Error("AudioContext could not be started for P2P engine.");
      }
      setAudioContextReady(true);

      const destinationNode = ensureMasterDestinationNode();
      if (!destinationNode) {
        throw new Error("P2P engine output destination is unavailable.");
      }

      const masterStream = mixerMasterDestinationRef.current?.stream ?? destinationNode.stream;
      const tapStream = mixerKiteTapStreamRef.current;
      const tapOk =
        tapStream &&
        tapStream.getAudioTracks().length > 0 &&
        tapStream !== masterStream &&
        tapStream !== destinationNode.stream;
      const fallbackMic = localMicStreamRef.current;
      const fallbackOk =
        fallbackMic &&
        fallbackMic.getAudioTracks().length > 0 &&
        fallbackMic !== masterStream &&
        fallbackMic !== destinationNode.stream;

      // Prefer the Kite tap (parallel bus to the master mix). Fall back only when the tap
      // stream is missing (e.g. pre-mixer single-device path). Never use the master stream
      // as capture input — it would close a feedback loop through the interval graph.
      const inputStream = (tapOk ? tapStream : null) ?? (fallbackOk ? fallbackMic : null);
      if (!inputStream || inputStream.getAudioTracks().length === 0) {
        throw new Error("P2P engine input is unavailable (no Kite tap or fallback mic).");
      }
      if (inputStream === destinationNode.stream || inputStream === masterStream) {
        throw new Error("P2P engine input must not be the VoIP master mix.");
      }

      // Tear down any existing P2P graph and worker before rebuilding.
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

      const intervalId = `${sessionId ?? "p2p"}-p2p-${Date.now()}`;

      // Partner-only local monitor: worklet output is playback (remote intervals), not dry mic.
      // Interface live monitor is ducked separately while kiteModeRef === "broadcast".
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
            broadcastStatusRef.current !== "live"
          ) {
            console.log(
              "[P2P INTERVAL_READY] skipped — need broadcast mode and live status (kiteMode:",
              kiteModeRef.current,
              "broadcastStatus:",
              broadcastStatusRef.current,
              ")"
            );
            return;
          }
          kiteP2PSequenceRef.current += 1;
          const outboundSeq = kiteP2PSequenceRef.current;
          const liveIntervalId = `p2p-live-${outboundSeq}`;
          console.log("[P2P INTERVAL_READY] seq", outboundSeq, "frames:", event.intervalFrames);

          const peer = peerRef.current;
          const dataChannel = (peer as unknown as { _channel?: RTCDataChannel })._channel;
          if (!peer || peer.destroyed || peer.connected !== true || !dataChannel || dataChannel.readyState !== "open") {
            console.warn("[P2P INTERVAL_READY] data channel not ready, dropping interval seq", outboundSeq);
            return;
          }

          void (async () => {
            try {
              const chunks = createLoadIntervalChunks({
                sessionId: sessionId ?? "p2p",
                intervalId: liveIntervalId,
                origin: role ?? "host",
                channelCount: event.channelCount,
                sampleRate: event.sampleRate,
                intervalFrames: event.intervalFrames,
                buffer: event.buffer,
              });
              const sender = new KiteDataChannelChunkSender(dataChannel);
              await sender.sendChunks(chunks);
              console.log("[P2P INTERVAL_READY] sent", chunks.length, "chunks for", liveIntervalId);
            } catch (err) {
              console.error("[P2P INTERVAL_READY] send failed for seq", outboundSeq, err);
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

      const voipStream = localStreamRef.current;
      const liveVoipTrack = voipStream?.getAudioTracks()[0] ?? null;
      if (liveVoipTrack && voipStream && !voipSenderMutedForKiteRef.current) {
        const mutedClone = liveVoipTrack.clone();
        mutedClone.enabled = false;
        const mutedStream = new MediaStream([mutedClone]);
        replacePeerAudioTrack(liveVoipTrack, mutedClone, voipStream, mutedStream);
        originalVoipSenderTrackRef.current = liveVoipTrack;
        mutedVoipCloneTrackRef.current = mutedClone;
        voipSenderMutedForKiteRef.current = true;
      }

      teardownRemotePlaybackGraph();

      setKiteMode("broadcast");
      console.log("[P2P Engine] prepared (scheduler not started)", { bpm: timing.bpm, bpi: timing.bpi, intervalId });
    },
    [
      ensureStudioAudioContext,
      ensureMasterDestinationNode,
      replacePeerAudioTrack,
      teardownRemotePlaybackGraph,
      sessionId,
      role,
    ]
  );

  useEffect(() => {
    startP2PEngineRef.current = startP2PEngine;
  }, [startP2PEngine]);

  const handlePageCountInPumpTick = useCallback(
    (ctx: AudioContext, nowSec: number): void => {
      if (
        !kiteSyncCountInActiveRef.current ||
        kiteSyncCountInCompletionHandledRef.current
      ) {
        return;
      }
      const endAt = kiteSyncCountInEndAtContextSecRef.current;
      if (!Number.isFinite(endAt) || endAt <= 0 || nowSec < endAt) {
        return;
      }

      kiteSyncCountInCompletionHandledRef.current = true;
      kiteSyncCountInActiveRef.current = false;
      setKiteSyncCountInActive(false);

      if (kiteSyncEnabledRef.current) {
        setBroadcastStatus("live");
      }

      const gain = metronomeGainRef.current;
      if (gain && ctx.state !== "closed") {
        try {
          gain.gain.cancelScheduledValues(ctx.currentTime);
          gain.gain.value = metronomeVolumeRef.current;
        } catch {
          /* ignore */
        }
      }

      const anchorSec = ctx.currentTime;
      kiteGridAnchorContextSecRef.current = anchorSec;
      if (Number.isFinite(anchorSec)) {
        kiteP2PEngineRef.current?.alignPhase(anchorSec);
      }
    },
    [setBroadcastStatus, setKiteSyncCountInActive]
  );

  const p2pEngine = useKiteP2PEngine({
    meteredConfig: {
      audio: {
        getContext: getStudioAudioContext,
        getSampleRate: getStudioKiteSampleRate,
        getSpeakerMuted: () => speakerMutedRef.current,
        getPlaybackVolume: () => remotePlaybackVolumeRef.current,
        graphNodes: {
          remoteBufferNodeRef,
          remotePlaybackSourceRef,
          remotePlaybackDelayRef,
          remotePlaybackGainRef,
          remotePlaybackCompressorRef,
          remotePlaybackAnalyserRef,
          remotePlaybackMeterSinkRef,
        },
      },
      callbacks: {
        onBufferTelemetry: (telemetry) => {
          setBufferDepthFrames(telemetry.bufferDepthFrames);
          setTargetLeadFrames(telemetry.targetLeadFrames);
          setIsBufferPrimed(telemetry.isPrimed);
          setLastCorrectionEvent(telemetry.lastCorrectionEvent);
        },
        onWorkletLoaded: setIsWorkletLoaded,
        onCalculatedDelayMs: (ms) => {
          calculatedDelayMsRef.current = ms;
          setCalculatedDelayMs(ms);
        },
        onInboundPacketLossPercent: setInboundPacketLossPercent,
        onTargetLeadFramesChange: setTargetLeadFrames,
        onMeterGraphChanged: () => setRemoteMeterRafKey((key) => key + 1),
        onRemoteMeterTapActive: setRemoteMeterTapActive,
        onConnectionStatsReset: () => {
          setPingMs(null);
          setInboundPacketLossPercent(null);
          setCalculatedDelayMs(null);
          calculatedDelayMsRef.current = null;
        },
        onApplyLowLatencyReceivers: (pc, packetLossPercent) => {
          applyLowLatencyInboundAudioReceivers(pc, {
            isSafariWebKit: isStudioSafariWebKitEngine(),
            ...(packetLossPercent !== null ? { packetLossPercent } : {}),
          });
        },
        onPacketLossGuard: (packetLossPercent) => {
          applyKiteSyncLossGuardRef.current(packetLossPercent);
        },
      },
      isBufferingEnabled,
      isAutoBuffer,
      manualTargetLeadFrames: targetLeadFrames,
      isConnected: status === "connected",
      kiteSyncEnabled,
      isInStudioPhase,
      isWorkletLoaded,
      mountedRef,
      getRemoteStream: () => remoteStreamRef.current,
      shouldSkipRemoteGraphRebuild: () =>
        isBroadcastConnectPendingRef.current || kiteModeRef.current === "broadcast",
      getIsSafariWebKit: isStudioSafariWebKitEngine,
    },
    syncConfig: {
      audio: {
        getContext: getStudioAudioContext,
        ensureContextRunning: async () => {
          const ctx = studioAudioContextRef.current ?? ensureStudioAudioContext();
          await ctx.resume();
          return ctx;
        },
        getSampleRate: getStudioKiteSampleRate,
        getMasterDestinationNode: () =>
          mixerMasterDestinationRef.current ?? ensureMasterDestinationNode(),
        resolveP2PInputStream: () => {
          const destinationNode =
            mixerMasterDestinationRef.current ?? ensureMasterDestinationNode();
          const masterStream = mixerMasterDestinationRef.current?.stream ?? destinationNode?.stream ?? null;
          const tapStream = mixerKiteTapStreamRef.current;
          const tapOk =
            tapStream !== null &&
            tapStream.getAudioTracks().length > 0 &&
            tapStream !== masterStream &&
            tapStream !== destinationNode?.stream;
          const fallbackMic = localMicStreamRef.current;
          const fallbackOk =
            fallbackMic !== null &&
            fallbackMic.getAudioTracks().length > 0 &&
            fallbackMic !== masterStream &&
            fallbackMic !== destinationNode?.stream;
          return (tapOk ? tapStream : null) ?? (fallbackOk ? fallbackMic : null);
        },
      },
      voip: {
        muteLocalVoip: () => {
          const voipStream = localStreamRef.current;
          const liveVoipTrack = voipStream?.getAudioTracks()[0] ?? null;
          if (!liveVoipTrack || !voipStream || voipSenderMutedForKiteRef.current) return;
          const mutedClone = liveVoipTrack.clone();
          mutedClone.enabled = false;
          const mutedStream = new MediaStream([mutedClone]);
          replacePeerAudioTrack(liveVoipTrack, mutedClone, voipStream, mutedStream);
          originalVoipSenderTrackRef.current = liveVoipTrack;
          mutedVoipCloneTrackRef.current = mutedClone;
          voipSenderMutedForKiteRef.current = true;
        },
        restoreLocalVoip: restoreLiveVoipTrackAfterKite,
        isVoipMuted: () => voipSenderMutedForKiteRef.current,
      },
      metronome: {
        stop: stopKiteMetronome,
        ensureGain: ensureMetronomeGainNode,
        setGain: (value) => {
          metronomeVolumeRef.current = value;
          setMetronomeVolume(value);
        },
        setGainValue: (value) => {
          const gain = metronomeGainRef.current;
          const ctx = studioAudioContextRef.current;
          if (!gain || !ctx || ctx.state === "closed") return;
          gain.gain.value = value;
        },
        getMetronomeVolume: () => metronomeVolumeRef.current,
        restoreMetronomeGainAfterCountIn: () => {
          const gain = metronomeGainRef.current;
          const ctx = studioAudioContextRef.current;
          if (!gain || !ctx || ctx.state === "closed") return;
          gain.gain.value = metronomeVolumeRef.current;
        },
      },
      remotePlayback: {
        buildGraph: buildRemotePlaybackGraph,
        restoreLiveVoipTrack: restoreLiveVoipTrackAfterKite,
        teardownRemotePlaybackGraph,
        resetPlaybackEngine: () => {
          remotePlaybackSourceRef.current = null;
          remoteBufferNodeRef.current = null;
          remotePlaybackDelayRef.current = null;
          remotePlaybackGainRef.current = null;
          remotePlaybackAnalyserRef.current = null;
          remotePlaybackMeterSinkRef.current = null;
        },
      },
      callbacks: {
        onKiteSyncEnabledChange: setKiteSyncEnabled,
        onBroadcastStatusChange: setBroadcastStatus,
        onSyncInitiatorIdChange: (id) => {
          syncInitiatorIdRef.current = id;
          setSyncInitiatorId(id);
        },
        onMetronomeBpmChange: setMetronomeBpm,
        onBeatsPerIntervalChange: setBeatsPerInterval,
        onKiteSetupTempoChange: setKiteSetupTempo,
        onKiteSetupTimeSignatureTopChange: setKiteSetupTimeSignatureTop,
        onKiteSetupTimeSignatureBottomChange: setKiteSetupTimeSignatureBottom,
        onKiteSetupChordCountChange: setKiteSetupChordCount,
        onKiteSyncCountInActiveChange: (active) => {
          kiteSyncCountInActiveRef.current = active;
          setKiteSyncCountInActive(active);
        },
        onPartialCleanupKiteEngine: () => cleanupKiteEngine({ stopLocalTracks: false, isFull: false }),
        onRestoreLiveVoipAfterKite: restoreLiveVoipTrackAfterKite,
        onRebuildRemotePlaybackGraph: () => {
          const stream = remoteStreamRef.current;
          if (stream) buildRemotePlaybackGraph(stream);
        },
        onStartP2PIntervalScheduler: startP2PIntervalScheduler,
        onKiteModeChange: (mode) => {
          kiteModeRef.current = mode;
          setKiteMode(mode);
        },
        onStudioUiPhaseChange: setStudioUiPhase,
        onAudioContextReadyChange: setAudioContextReady,
        onPacketLossWarningChange: setKiteSyncNetworkMetronomePaused,
        onKiteSyncMetronomeResumeNonceChange: () =>
          setKiteSyncMetronomeResumeNonce((nonce) => nonce + 1),
        onLoopChunkSendErrorChange: setLoopChunkSendError,
        onLoopChunkSendProgressChange: setLoopChunkSendProgress,
        onClearRetainedLoopBuffers: () => {
          retainedKiteLoopBufferRef.current = null;
          retainedRemoteKiteLoopRef.current = null;
          lastRetainedKiteIntervalIdRef.current = null;
          lastRetainedKiteSequenceRef.current = null;
        },
        onLog: addLog,
      },
      retainedLoop: {
        getRetainedKiteLoopBuffer: () => retainedKiteLoopBufferRef.current,
      },
      sessionId,
      role,
      localOwnerId: localJamSetupOwnerId,
      timingInputs: {
        getKiteSyncEnabled: () => kiteSyncEnabledRef.current,
        getMetronomeBpm: () => metronomeBpm,
        getBeatsPerInterval: () => beatsPerInterval,
        getIntervalBpi: () =>
          kiteIntervalTimingRef.current?.bpi ?? latestKiteIntervalTimingRef.current?.bpi,
        getSyncInitiatorId: () => syncInitiatorIdRef.current,
        getKiteIntervalTiming: () =>
          latestKiteIntervalTimingRef.current ?? kiteIntervalTimingRef.current,
        getBroadcastStatus: () => broadcastStatusRef.current,
        getKiteSetupTimeSignatureTop: () => kiteSetupTimeSignatureTop,
        getCanControlStop: () => canControlStop,
      },
      mountedRef,
    },
    transportConfig: {
      callbacks: {
        onStatusChange: setStatus,
        onStatusNote: setStatusNote,
        onError: setError,
        onSessionId: setSessionId,
        onRole: setRole,
        onInviteLink: setInviteLink,
        onPingMs: setPingMs,
        onRemoteStreamReset: () => {
          remoteStreamRef.current = null;
          setRemoteStream(null);
        },
        onRemoteParticipantName: setRemoteParticipantName,
        onLastDepartedParticipantName: setLastDepartedParticipantName,
        onConnectionLostCountdown: setConnectionLostCountdown,
        onLog: addLog,
      },
      mountedRef,
      supabase,
      fetchTurnCredentials: fetchTurnCredentialsWithMeta,
      forceRelay:
        typeof window !== "undefined" &&
        new URL(window.location.href).searchParams.get("relay") === "true",
      onRemoteStreamReady: (stream) => {
        remoteStreamRef.current = stream;
        setRemoteStream(stream);
        const remoteEl = remoteAudioRef.current;
        if (remoteEl) {
          remoteEl.srcObject = stream;
          remoteEl.muted = true;
          void remoteEl.play().catch(() => {});
        }
        if (!isBroadcastConnectPendingRef.current && kiteModeRef.current !== "broadcast") {
          buildRemotePlaybackGraph(stream);
        }
      },
      getLocalStream: () => localStreamRef.current,
      getAudioContext: getStudioAudioContext,
      getConnectStream: () => {
        const masterTrack = mixerMasterDestinationRef.current?.stream.getAudioTracks()[0] ?? null;
        if (masterTrack?.readyState === "live") {
          return mixerMasterDestinationRef.current?.stream ?? null;
        }
        return localStreamRef.current;
      },
      onRegisterSessionCleanup: (cleanup) => {
        cleanupSessionRef.current = cleanup;
      },
      onPeerConnect: () => {
        const packet = pendingKiteSyncRef.current;
        const peer = peerRef.current;
        if (!packet || !peer || peer.destroyed || peer.connected !== true) return;
        try {
          peer.send(JSON.stringify(packet));
          pendingKiteSyncRef.current = null;
        } catch {
          /* keep pending */
        }
      },
      onTransportPortReady: () => {},
      onHostPeerDisconnected: () => hostExitKiteBroadcastOnPeerDisconnectRef.current(),
      onRecoverablePeerClose: beginLostCountdown,
      onReconnectPrepare: () => {
        restoreLiveVoipTrackAfterKite();
        cleanupKiteEngine({ stopLocalTracks: false, isFull: false });
      },
    },
    collabHandlers: {
      onJamSetupLock: (msg) => {
        if (msg.action === "acquire") {
          const expiresAt = msg.expiresAt;
          if (typeof expiresAt !== "number" || expiresAt <= Date.now()) return;
          setJamSetupLock({
            ownerId: msg.ownerId,
            ownerName: msg.ownerName,
            expiresAt,
          });
          scheduleJamSetupLockExpiry(expiresAt);
          return;
        }
        clearJamSetupLockTimer();
        jamSetupLockExpiresAtRef.current = null;
        jamSetupLockTokenRef.current = null;
        setJamSetupLock(null);
      },
      onStudioParam: (msg) => {
        if (msg.studioRevision <= lastAcceptedStudioRevisionRef.current) return;
        lastAcceptedStudioRevisionRef.current = msg.studioRevision;
        const patch = msg.patch;
        if (typeof patch.kiteSetupTempo === "number") {
          setKiteSetupTempo(Math.max(20, Math.min(320, Math.round(patch.kiteSetupTempo))));
        }
        if (typeof patch.kiteSetupTimeSignatureTop === "number") {
          setKiteSetupTimeSignatureTop(Math.max(1, Math.min(16, Math.round(patch.kiteSetupTimeSignatureTop))));
        }
        if (typeof patch.kiteSetupTimeSignatureBottom === "number") {
          setKiteSetupTimeSignatureBottom(Math.max(1, Math.min(32, Math.round(patch.kiteSetupTimeSignatureBottom))));
        }
        if (typeof patch.kiteSetupChordCount === "number") {
          setKiteSetupChordCount(Math.max(1, Math.min(64, Math.round(patch.kiteSetupChordCount))));
        }
        if (typeof patch.bpm === "number") {
          setMetronomeBpm(Math.max(40, Math.min(240, Math.round(patch.bpm))));
        }
        if (typeof patch.bpi === "number") {
          setBeatsPerInterval(Math.max(1, Math.round(patch.bpi)));
        }
      },
      onPresence: (name) => setRemoteParticipantName(name),
    },
    bridgeStatus: status,
    getKiteSyncActive: () =>
      kiteSyncEnabledRef.current ||
      broadcastStatusRef.current !== "idle" ||
      kiteModeRef.current === "broadcast",
    onPageFullTeardown: async () => {
      if (sessionTeardownRanRef.current) return;
      cleanupKiteEngine({ stopLocalTracks: true, isFull: true });
    },
    shouldSkipOrderedTeardown: () => sessionTeardownRanRef.current,
    onCollaboratorLeave: ({ departedName }) => {
      leaveSignalReceivedRef.current = true;
      setKiteSyncEnabled(false);
      setBroadcastStatus("idle");
      stopKiteMetronome();
      clearLostCountdown();
      setCollaboratorLeft(true);
      setLastDepartedParticipantName(departedName);
      setRemoteParticipantName(null);
      setStatus("failed");
      setStatusNote(`${departedName} left the session.`);
      router.push("/studio");
    },
  });

  const bridgedP2PEngine = useMemo(
    (): KiteP2PEngineApi => ({
      ...p2pEngine,
      sync: {
        ...p2pEngine.sync,
        onMetronomePumpTick: (ctx, nowSec) => {
          p2pEngine.sync.onMetronomePumpTick(ctx, nowSec);
          handlePageCountInPumpTick(ctx, nowSec);
        },
      },
    }),
    [handlePageCountInPumpTick, p2pEngine]
  );
  p2pEngineRef.current = bridgedP2PEngine;

  const handleConfirmKiteSetup = useCallback(() => {
    void (async () => {
      try {
        setKiteSetupError(null);
        hasCapturedFirstKiteLoopRef.current = false;
        if (kiteModeRef.current !== "broadcast" && broadcastStatusRef.current !== "live") {
          retainedKiteLoopBufferRef.current = null;
          lastRetainedKiteIntervalIdRef.current = null;
        }
        soloLooperStateRef.current = "idle";
        isRecordingArmedRef.current = false;
        setIsRecordingArmed(false);
        setRecordingArmedCountdown(null);
        setSoloLooperState("idle");
        setKiteMode(kiteSetupMode === "sync" ? "broadcast" : "solo");
        setStudioUiPhase("studio");
        if (kiteSetupOrigin === "connected") {
          sendJamSetupLock("release");
        }
        if (kiteSetupMode === "sync") {
          const timing = deriveKiteTimingMetadata();
          void startP2PEngine(timing);
          try {
            sendSetInterval(timing, retainedKiteLoopBufferRef.current !== null, {
              igniteP2PEngine: true,
            });
          } catch {
            /* SET_INTERVAL notify peer is best-effort */
          }
          syncInitiatorIdRef.current = localJamSetupOwnerId;
          if (mountedRef.current) {
            setSyncInitiatorId(localJamSetupOwnerId);
          }
        } else if (kiteSetupMode === "solo") {
          deriveKiteTimingMetadata();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not start Kite Sync.";
        setKiteSetupError(message);
        soloLooperStateRef.current = "idle";
        isRecordingArmedRef.current = false;
        setIsRecordingArmed(false);
        setRecordingArmedCountdown(null);
        setSoloLooperState("idle");
      }
    })();
  }, [
    deriveKiteTimingMetadata,
    kiteSetupMode,
    kiteSetupOrigin,
    localJamSetupOwnerId,
    sendJamSetupLock,
    sendSetInterval,
    startP2PEngine,
  ]);

  const handleRecordFirstLoop = useCallback(() => {
    if (isRecordingArmedRef.current || soloLooperStateRef.current === "recording") {
      return;
    }
    applyPedalFocus(1);
    isRecordingArmedRef.current = true;
    setIsRecordingArmed(true);

    void (async () => {
      try {
        const timing = deriveKiteTimingMetadata();
        const ctx = studioAudioContextRef.current ?? ensureStudioAudioContext();
        await ctx.resume();
        if (ctx.state !== "running") {
          setAudioContextReady(false);
          throw new Error("AudioContext is not running. Use Resume Audio or Enter Studio first.");
        }
        setAudioContextReady(true);

        cleanupKiteEngine({
          stopLocalTracks: false,
          preserveTiming: true,
          preserveSoloSessionRecording: true,
        });
        setKiteMode("solo");
        isRecordingArmedRef.current = true;
        setIsRecordingArmed(true);

        hasCapturedFirstKiteLoopRef.current = false;
        retainedKiteLoopBufferRef.current = null;
        lastRetainedKiteIntervalIdRef.current = null;
        masterLoopIntervalFramesRef.current = null;
        isMasterPausedRef.current = false;
        setIsMasterPaused(false);
        soloLooperEngineRef.current?.setPaused(false);
        soloMetronomeAnchorContextSecRef.current = null;
        syncActiveRecordTrackIndex(null);
        soloLooperPendingCommitRef.current = false;
        soloLooperLiveLoopIdRef.current = null;
        setSoloTrackSlotUi(null);
        soloTrackSlotUiLatestRef.current = null;
        isMasterPausedRef.current = false;
        setIsMasterPaused(false);
        soloLooperEngineRef.current?.setPaused(false);
        soloMetronomeAnchorContextSecRef.current = null;
        setSoloTrackVolumes([1, 1, 1, 1]);
        setSoloMasterLoopFrames(null);
        applyPedalFocus(1);
        soloOverdubArmedTrackIndexRef.current = null;
        setSoloOverdubArmedTrackIndex(null);
        soloLooperStateRef.current = "idle";
        setSoloLooperState("idle");
        setLoopProgress(0);

        clearSoloRunwayDisplay();
        setRecordingArmedCountdown(3);

        soloCountInPumpGenerationRef.current += 1;
        const gen = soloCountInPumpGenerationRef.current;

        try {
          const pump = await startLooperRunway({
            audioContext: ctx,
            bpm: timing.bpm,
            beatCount: timing.beatsPerBar,
            isAlive: () => mountedRef.current && gen === soloCountInPumpGenerationRef.current,
            onBeat: (payload) => {
              if (!mountedRef.current || gen !== soloCountInPumpGenerationRef.current) return;

              if (soloRunwayGoClearTimerRef.current !== null) {
                clearTimeout(soloRunwayGoClearTimerRef.current);
                soloRunwayGoClearTimerRef.current = null;
              }

              setSoloRunwayDisplay(payload.displayLabel);
              if (payload.displayLabel === "3") {
                setVisualActiveBeatInBar(0);
              } else if (payload.displayLabel === "2") {
                setVisualActiveBeatInBar(1);
              } else if (payload.displayLabel === "1") {
                setVisualActiveBeatInBar(2);
              } else if (payload.displayLabel === "GO") {
                setVisualActiveBeatInBar(3);
              }

              if (payload.playClick) {
                playSoloMetronomeClick(payload.isGoBeat, payload.contextTime, true);
              }

              if (!payload.isGoBeat) {
                const count =
                  payload.displayLabel === "3"
                    ? 3
                    : payload.displayLabel === "2"
                      ? 2
                      : payload.displayLabel === "1"
                        ? 1
                        : null;
                if (count !== null) {
                  setRecordingArmedCountdown(count);
                }
                return;
              }

              soloRunwayGoClearTimerRef.current = window.setTimeout(() => {
                soloRunwayGoClearTimerRef.current = null;
                if (!mountedRef.current || gen !== soloCountInPumpGenerationRef.current) return;
                setSoloRunwayDisplay(null);
              }, 400);

              const beatDurationSeconds = 60 / Math.max(1, timing.bpm);
              const recordAnchorContextSec = payload.contextTime + beatDurationSeconds;
              soloCountInBeatSecRef.current = beatDurationSeconds;
              soloCountInEndAtContextSecRef.current = recordAnchorContextSec;

              scheduleSoloCountInDownbeat({
                ctx,
                downbeatContextSec: recordAnchorContextSec,
                gen,
                onDownbeat: async () => {
                  // Safari guard: resume before capture anchor — Safari may suspend during count-in.
                  await ctx.resume();
                  isRecordingArmedRef.current = false;
                  setIsRecordingArmed(false);
                  setRecordingArmedCountdown(null);
                  soloLooperStateRef.current = "recording";
                  setSoloLooperState("recording");
                  syncActiveRecordTrackIndex(1);
                  hasCapturedFirstKiteLoopRef.current = false;
                  recordingStartBpmRef.current = timing.bpm;
                  setVisualActiveBeatInBar(0);
                  await startSoloLooper(timing, { recordStartContextSec: recordAnchorContextSec });
                },
              });
            },
            onRunwayEnd: () => {
              if (!mountedRef.current || gen !== soloCountInPumpGenerationRef.current) return;
              soloCountInPumpRef.current?.teardown();
              soloCountInPumpRef.current = null;
            },
          });

          if (gen !== soloCountInPumpGenerationRef.current) {
            pump.teardown();
            isRecordingArmedRef.current = false;
            setIsRecordingArmed(false);
            setRecordingArmedCountdown(null);
            clearSoloRunwayDisplay();
            return;
          }
          if (studioAudioContextRef.current?.state !== "running") {
            pump.teardown();
            isRecordingArmedRef.current = false;
            setIsRecordingArmed(false);
            setRecordingArmedCountdown(null);
            clearSoloRunwayDisplay();
            return;
          }
          soloCountInPumpRef.current = pump;
        } catch (pumpErr) {
          console.error("[Solo runway] AudioWorklet pump failed:", pumpErr);
          teardownSoloCountInPump();
          isRecordingArmedRef.current = false;
          setIsRecordingArmed(false);
          setRecordingArmedCountdown(null);
          throw pumpErr;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not start recording.";
        setKiteSetupError(message);
        teardownSoloCountInPump();
        isRecordingArmedRef.current = false;
        setIsRecordingArmed(false);
        setRecordingArmedCountdown(null);
      }
    })();
  }, [
    cleanupKiteEngine,
    clearSoloRunwayDisplay,
    deriveKiteTimingMetadata,
    ensureStudioAudioContext,
    playSoloMetronomeClick,
    scheduleSoloCountInDownbeat,
    startSoloLooper,
    syncActiveRecordTrackIndex,
    teardownSoloCountInPump,
    applyPedalFocus,
  ]);

  const handleAutoCalibrateSoloLatency = useCallback(async (_mode: "acoustic" | "interface") => {
    if (echoSafetyMode) {
      setSoloLatencyCalibrationStatus("warning");
      setSoloLatencyCalibrationMessage("Disable Echo Safety before auto-calibration.");
      return;
    }
    if (isRecordingArmedRef.current || soloLooperStateRef.current === "recording") {
      setSoloLatencyCalibrationStatus("error");
      setSoloLatencyCalibrationMessage("Stop recording/count-in before auto-calibration.");
      return;
    }

    try {
      if (!soloLooperEngineRef.current) {
        const ctx = ensureStudioAudioContext();
        await ctx.resume();
        if (ctx.state !== "running") {
          setAudioContextReady(false);
          setSoloLatencyCalibrationStatus("error");
          setSoloLatencyCalibrationMessage("Audio engine could not start.");
          return;
        }
        setAudioContextReady(true);
        const destinationNode = ensureMasterDestinationNode();
        if (!destinationNode) {
          setSoloLatencyCalibrationStatus("error");
          setSoloLatencyCalibrationMessage("Kite Sync output destination is unavailable.");
          return;
        }
        const { inputStream, masterStream } = resolveSoloLooperInputStream(destinationNode);
        if (!inputStream || inputStream.getAudioTracks().length === 0) {
          setSoloLatencyCalibrationStatus("error");
          setSoloLatencyCalibrationMessage("Microphone not connected.");
          return;
        }
        if (inputStream === destinationNode.stream || inputStream === masterStream) {
          setSoloLatencyCalibrationStatus("error");
          setSoloLatencyCalibrationMessage("Kite Sync input must be raw mic audio, not the master mix.");
          return;
        }
        const localSr = Math.round(ctx.sampleRate);
        const maxProvisionFrames = Math.max(1, Math.floor(localSr * 60));
        const bootstrapIntervalId = `${sessionId ?? "solo"}-bootstrap-${Date.now()}`;
        const bootstrapSequenceNumber = (lastRetainedKiteSequenceRef.current ?? 0) + 1;
        const engine = await buildSoloLooperEngine({
          audioContext: ctx,
          inputStream,
          destinationNode,
          timing: {
            localSampleRate: localSr,
            localIntervalFrames: maxProvisionFrames,
          },
          loopId: bootstrapIntervalId,
          trackIndex: 1,
          channelCount: 2,
          monitorDestination: ctx.destination,
          monitorGain: 1,
          inputGain: (soloInputGain / 10) * 2,
          onEvent: (event) => handleSoloLooperEvent(event, ctx),
        });
        soloLooperEngineRef.current = engine;
        engine.setMetronomeGainNode(metronomeGainRef.current);
        soloLooperEventIntervalIdRef.current = bootstrapIntervalId;
        soloLooperEventSequenceNumberRef.current = bootstrapSequenceNumber;
      }
      setSoloLatencyCalibrationStatus("listening");
      setSoloLatencyCalibrationMessage("Listening for ping...");
      soloLooperEngineRef.current?.startCalibration();
    } catch (error) {
      setSoloLatencyCalibrationStatus("error");
      setSoloLatencyCalibrationMessage(
        error instanceof Error ? error.message : "Auto-calibration could not start."
      );
    }
  }, [
    echoSafetyMode,
    ensureMasterDestinationNode,
    ensureStudioAudioContext,
    handleSoloLooperEvent,
    resolveSoloLooperInputStream,
    sessionId,
  ]);

  const handleSoloLatencyMsChange = useCallback((value: number) => {
    setSoloLooperLatencyMs(clampSoloLatencyMs(value));
  }, []);

  const handleStopAndResetSoloLooper = useCallback(() => {
    cancelScheduledMetronomeClicks();
    soloLooperEngineRef.current?.stopAudibleMetronome();
    soloLooperEngineRef.current?.teardown();
    soloLooperEngineRef.current = null;
    cleanupKiteEngine({ stopLocalTracks: false });
    isRecordingArmedRef.current = false;
    setIsRecordingArmed(false);
    setRecordingArmedCountdown(null);
    clearSoloRunwayDisplay();
    masterLoopIntervalFramesRef.current = null;
    isMasterPausedRef.current = false;
    soloMetronomeAnchorContextSecRef.current = null;
    syncActiveRecordTrackIndex(null);
    soloLooperLoopFinalizePendingRef.current = false;
    soloLooperPendingCommitRef.current = false;
    soloLooperLiveLoopIdRef.current = null;
    setSoloTrackSlotUi(null);
    soloTrackSlotUiLatestRef.current = null;
    setSoloTrackVolumes([1, 1, 1, 1]);
    setSoloMasterLoopFrames(null);
    applyPedalFocus(1);
    soloOverdubArmedTrackIndexRef.current = null;
    setSoloOverdubArmedTrackIndex(null);
    soloLooperStateRef.current = "idle";
    setSoloLooperState("idle");
    setIsMasterPaused(false);
    setLoopProgress(0);
    hasCapturedFirstKiteLoopRef.current = false;
    syncHandsfreeSequenceActive(false);
    setKiteMode("solo");
  }, [applyPedalFocus, cancelScheduledMetronomeClicks, cleanupKiteEngine, clearSoloRunwayDisplay, syncHandsfreeSequenceActive]);

  const handleSoloTrackVolumeChange = useCallback((trackIndex: 1 | 2 | 3 | 4, linear: number) => {
    const g = Math.max(0, Math.min(1, linear));
    setSoloTrackVolumes((prev) => {
      const next: [number, number, number, number] = [...prev] as [number, number, number, number];
      next[trackIndex - 1] = g;
      return next;
    });
    soloLooperEngineRef.current?.setTrackGain(trackIndex, g);
  }, []);

  const handleToggleMasterPause = useCallback(() => {
    const engine = soloLooperEngineRef.current;
    if (!engine) return;
    const nextPaused = !isMasterPausedRef.current;
    engine.setPaused(nextPaused);
    isMasterPausedRef.current = nextPaused;
    setIsMasterPaused(nextPaused);
    if (nextPaused) {
      engine.stopAudibleMetronome();
    } else if (
      !isVisualMetronomeOnlyRef.current &&
      soloLooperActiveRecordTrackIndexRef.current === 1 &&
      soloLooperStateRef.current === "recording"
    ) {
      engine.startAudibleMetronome(kiteIntervalTimingRef.current?.bpm || 120);
    }

    const recorder = soloSessionMediaRecorderRef.current;
    if (!recorder) return;
    if (nextPaused) {
      if (recorder.state === "recording") {
        recorder.pause();
      }
      setSoloSessionRecorderState("paused");
    } else {
      if (recorder.state === "paused") {
        recorder.resume();
      }
      setSoloSessionRecorderState("recording");
    }
  }, []);

  const handleResetSoloTrack = useCallback((trackIndex: 1 | 2 | 3 | 4) => {
    const engine = soloLooperEngineRef.current;
    if (!engine) return;
    const slot = soloTrackSlotUiLatestRef.current?.find((s) => s.trackIndex === trackIndex);
    if (slot?.mode === "recording") {
      const confirmed = ui.confirmResetTrack(trackIndex);
      if (!confirmed) return;
    }

    engine.resetTrack(trackIndex);
    if (trackIndex === 1) {
      engine.stopAudibleMetronome();
      hasCapturedFirstKiteLoopRef.current = false;
      masterLoopIntervalFramesRef.current = null;
      setSoloMasterLoopFrames(null);
      setLoopProgress(0);
      soloLooperStateRef.current = "idle";
      setSoloLooperState("idle");
      isMasterPausedRef.current = false;
      setIsMasterPaused(false);
      engine.setPaused(false);
      soloOverdubArmedTrackIndexRef.current = null;
      setSoloOverdubArmedTrackIndex(null);
      setSoloTrackSlotUi((prev) =>
        prev?.map((s) => ({
          ...s,
          mode: "idle",
          playbackCursor: 0,
          intervalFrames: 0,
          recordCursor: 0,
        })) ?? prev
      );
    } else {
      if (soloOverdubArmedTrackIndexRef.current === trackIndex) {
        soloOverdubArmedTrackIndexRef.current = null;
        setSoloOverdubArmedTrackIndex(null);
      }
      setSoloTrackSlotUi((prev) =>
        prev?.map((s) =>
          s.trackIndex === trackIndex
            ? { ...s, mode: "idle", playbackCursor: 0, intervalFrames: 0, recordCursor: 0 }
            : s
        ) ?? prev
      );
    }
  }, [ui]);

  const handleArmSoloOverdubTrack = useCallback(
    (trackIndex: 2 | 3 | 4) => {
      if (handsfreeSequenceActiveRef.current) {
        return;
      }
      void (async () => {
        const ctx = studioAudioContextRef.current ?? ensureStudioAudioContext();
        await ctx.resume();
        if (!mountedRef.current) return;
        const engine = soloLooperEngineRef.current;
        const master = masterLoopIntervalFramesRef.current;
        if (
          !engine ||
          ctx.state === "closed" ||
          ctx.state !== "running" ||
          master == null ||
          master <= 0
        ) {
          return;
        }
        if (
          isRecordingArmedRef.current ||
          soloLooperStateRef.current === "recording" ||
          isMasterPausedRef.current
        ) {
          return;
        }
        applyPedalFocus(trackIndex);
        const MAX_SOLO_TRACK_RAM_SECONDS = 60;
        const localSr = Number.isFinite(ctx.sampleRate) && ctx.sampleRate > 0
          ? ctx.sampleRate
          : 44100;
        const maxProvisionFrames = Math.max(1, Math.floor(localSr * MAX_SOLO_TRACK_RAM_SECONDS));
        const latencyOffsetFrames = Math.max(
          0,
          Math.round((soloLooperLatencyMsRef.current / 1000) * localSr)
        );
        engine.armOverdub({
          trackIndex,
          intervalFrames: maxProvisionFrames,
          channelCount: 2,
          latencyOffsetFrames,
          ...(soloLooperLiveLoopIdRef.current !== null
            ? { loopId: soloLooperLiveLoopIdRef.current }
            : {}),
        });
      })();
    },
    [applyPedalFocus, ensureStudioAudioContext]
  );

  const looperFootPedalArmed = kiteMode === "solo" && studioUiPhase === "studio";

  const commitActiveRecording = useCallback(() => {
    if (handsfreeSequenceActiveRef.current) {
      return;
    }
    if (soloLooperStateRef.current !== "recording") {
      return;
    }
    if (soloLooperLoopFinalizePendingRef.current) {
      return;
    }
    if (isMasterPausedRef.current) {
      return;
    }
    const ctx = studioAudioContextRef.current;
    const engine = soloLooperEngineRef.current;
    if (!ctx || ctx.state === "closed" || !engine) {
      if (soloLooperStateRef.current === "recording") {
        soloLooperPendingCommitRef.current = true;
        return;
      }
      handleStopAndResetSoloLooper();
      return;
    }
    const rawActive = soloLooperActiveRecordTrackIndexRef.current;
    let activeTrackIndex: number;
    if (
      rawActive == null ||
      !Number.isFinite(rawActive) ||
      rawActive < 1 ||
      rawActive > 4
    ) {
      if (soloLooperStateRef.current !== "recording") {
        handleStopAndResetSoloLooper();
        return;
      }
      const pedalTarget = soloPedalTargetTrackIndexRef.current;
      activeTrackIndex =
        Number.isFinite(pedalTarget) && pedalTarget >= 1 && pedalTarget <= 4
          ? Math.floor(pedalTarget)
          : 1;
    } else {
      activeTrackIndex = Math.floor(rawActive);
    }
    const currentBpm = recordingStartBpmRef.current || 120;

    syncActiveRecordTrackIndex(null);

    if (loopProgressRafRef.current !== null) {
      cancelAnimationFrame(loopProgressRafRef.current);
      loopProgressRafRef.current = null;
    }
    const loopId = soloLooperLiveLoopIdRef.current;
    soloLooperLoopFinalizePendingRef.current = true;
    if (activeTrackIndex === 1) {
      engine.stopAudibleMetronome();
    }
    const sampleRate = Number.isFinite(ctx.sampleRate) && ctx.sampleRate > 0
      ? ctx.sampleRate
      : 44100;
    const latencyOffsetFrames = Math.max(
      0,
      Math.round((soloLooperLatencyMsRef.current / 1000) * sampleRate)
    );
    engine.stopRecording({
      trackIndex: activeTrackIndex,
      bpm: currentBpm,
      channelCount: 2,
      latencyOffsetFrames,
      loopMode: soloLooperModeRef.current,
      ...(soloLooperModeRef.current === "free" && activeTrackIndex === 1
        ? { stopAtContextSec: ctx.currentTime }
        : {}),
      ...(loopId !== null ? { loopId } : {}),
    });
  }, [handleStopAndResetSoloLooper]);
  commitActiveRecordingRef.current = commitActiveRecording;

  const onLooperPedalDown = useCallback(
    (targetTrackIndex: number) => {
      if (handsfreeSequenceActiveRef.current && soloLooperStateRef.current === "recording") {
        return;
      }
      if (
        soloLooperActiveRecordTrackIndexRef.current != null ||
        soloLooperStateRef.current === "recording"
      ) {
        commitActiveRecording();
        return;
      }
      if (soloOverdubArmedTrackIndexRef.current != null) {
        const armed = soloOverdubArmedTrackIndexRef.current;
        if (armed >= 2 && armed <= 4) {
          soloLooperEngineRef.current?.disarmOverdub(armed as 2 | 3 | 4);
        }
        return;
      }
      if (isRecordingArmedRef.current) {
        return;
      }
      if (isMasterPausedRef.current) {
        return;
      }
      const t =
        Number.isFinite(targetTrackIndex) && targetTrackIndex >= 1 && targetTrackIndex <= 4
          ? Math.floor(targetTrackIndex)
          : 1;
      if (t === 1) {
        handleRecordFirstLoop();
        return;
      }
      handleArmSoloOverdubTrack(t as 2 | 3 | 4);
    },
    [commitActiveRecording, handleArmSoloOverdubTrack, handleRecordFirstLoop]
  );

  const handleTrackTransportTap = useCallback(
    (trackIndex: 1 | 2 | 3 | 4) => {
      applyPedalFocus(trackIndex);
      onLooperPedalDown(trackIndex);
    },
    [applyPedalFocus, onLooperPedalDown]
  );

  useEffect(() => {
    if (kiteMode !== "solo" || studioUiPhase !== "studio") {
      return;
    }
    let rafId = 0;
    const tick = (): void => {
      soloLooperEngineRef.current?.requestPlaybackUiState();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [kiteMode, studioUiPhase]);

  useEffect(() => {
    if (studioUiPhase === "lobby") {
      return;
    }
    let rafId = 0;
    const tick = (): void => {
      const mode = kiteModeRef.current;
      const phase = studioUiPhaseRef.current;
      const paused = isMasterPausedRef.current;
      const looperState = soloLooperStateRef.current;
      const runwayActive = isRecordingArmedRef.current;

      const shouldPulse =
        mode === "solo" && phase === "studio" && !paused && looperState === "recording";

      if (!shouldPulse && !runwayActive && mode === "solo") {
        if (soloMetronomeLastBeatRef.current !== null) {
          soloMetronomeLastBeatRef.current = null;
          setVisualActiveBeatInBar(null);
        }
      } else if (shouldPulse && !runwayActive) {
        const ctx = studioAudioContextRef.current;
        if (ctx && ctx.state === "running") {
          const timing = kiteIntervalTimingRef.current;
          const bpm = Math.max(1, timing?.bpm ?? kiteSetupTempoRef.current);
          const beatSec = 60 / bpm;
          const anchor = soloMetronomeAnchorContextSecRef.current ?? ctx.currentTime;
          soloMetronomeAnchorContextSecRef.current = anchor;
          const elapsedBeats = Math.floor(Math.max(0, ctx.currentTime - anchor) / beatSec);
          if (soloMetronomeLastBeatRef.current !== elapsedBeats) {
            soloMetronomeLastBeatRef.current = elapsedBeats;
            setVisualActiveBeatInBar(
              (Math.floor(elapsedBeats) % (timing?.beatsPerBar || 4)) as 0 | 1 | 2 | 3
            );
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [studioUiPhase]);

  useLooperFootPedal({
    armContext: {
      enabled: looperFootPedalArmed,
      pedalTargetTrackIndexRef: soloPedalTargetTrackIndexRef,
    },
    onPedalDown: onLooperPedalDown,
  });

  const handleEnterStudio = useCallback(() => {
    void (async () => {
      try {
        if (!studioAudioContextRef.current) {
          ensureStudioAudioContext();
        }
        const resumePromise = studioAudioContextRef.current!.resume();
        await resumePromise;
        const ctx = studioAudioContextRef.current;
        if (!ctx || ctx.state !== "running") {
          setAudioContextReady(false);
          console.warn("[EnterStudio] Aborted: audio context missing or not running.");
          return;
        }
        setAudioContextReady(true);
        void rebuildMixerAndReplaceTrack();

        const masterDestination = mixerMasterDestinationRef.current;
        const masterTrack = masterDestination?.stream.getAudioTracks()[0] ?? null;
        const fallbackLocalStream = localStreamRef.current;
        const localStream =
          masterDestination && masterTrack && masterTrack.readyState === "live"
            ? masterDestination.stream
            : fallbackLocalStream;
        if (!localStream) {
          console.warn("[EnterStudio] Aborted: local stream unavailable.");
          return;
        }
        if (!masterDestination || !masterTrack || masterTrack.readyState !== "live") {
          console.warn(
            "Enter Studio: mixer master destination unavailable, falling back to localStreamRef.current."
          );
        }
        const buildTransport = buildTransportRef.current;
        if (!buildTransport) {
          console.warn("[EnterStudio] Aborted: buildTransport not ready.");
          return;
        }

        setStudioUiPhase("connecting");
        await (sessionBootstrapPromiseRef.current ?? Promise.resolve()).catch(() => {});
        if (!studioSessionReservedRef.current) {
          const initNetworkSession = initNetworkSessionRef.current;
          if (!initNetworkSession) {
            console.warn("[EnterStudio] Aborted: network session initializer not ready.");
            setStudioUiPhase("lobby");
            return;
          }
          await initNetworkSession();
        }
        await buildTransport(localStream, ctx);
        ensureMetronomeGainNode(ctx);
        const stream = remoteStreamRef.current;
        if (
          stream &&
          !isBroadcastConnectPendingRef.current &&
          kiteModeRef.current !== "broadcast"
        ) {
          buildRemotePlaybackGraph(stream);
        }
      } catch (err) {
        console.error("[EnterStudio] Failed to enter studio:", err);
      }
      setStudioUiPhase("studio");
    })();
  }, [buildRemotePlaybackGraph, ensureMetronomeGainNode, ensureStudioAudioContext]);

  const handleEnterSoloStudio = useCallback(() => {
    void (async () => {
      try {
        if (!studioAudioContextRef.current) {
          ensureStudioAudioContext();
        }
        const resumePromise = studioAudioContextRef.current!.resume();
        await resumePromise;
        const ctx = studioAudioContextRef.current;
        if (!ctx || ctx.state !== "running") {
          setAudioContextReady(false);
          console.warn("[EnterSoloStudio] Aborted: audio context missing or not running.");
          return;
        }
        setAudioContextReady(true);
        await rebuildMixerAndReplaceTrack();

        const masterDestination = mixerMasterDestinationRef.current;
        const masterTrack = masterDestination?.stream.getAudioTracks()[0] ?? null;
        const fallbackLocalStream = localStreamRef.current;
        const localStream =
          masterDestination && masterTrack && masterTrack.readyState === "live"
            ? masterDestination.stream
            : fallbackLocalStream;
        if (!localStream) {
          console.warn("[EnterSoloStudio] Aborted: local stream unavailable.");
          return;
        }
        ensureMetronomeGainNode(ctx);
        setKiteSetupError(null);
        hasCapturedFirstKiteLoopRef.current = false;
        retainedKiteLoopBufferRef.current = null;
        lastRetainedKiteIntervalIdRef.current = null;
        soloLooperStateRef.current = "idle";
        isRecordingArmedRef.current = false;
        setIsRecordingArmed(false);
        setRecordingArmedCountdown(null);
        setSoloLooperState("idle");
        setLoopProgress(0);
        setSoloTrackSlotUi(null);
        soloTrackSlotUiLatestRef.current = null;
        setSoloTrackVolumes([1, 1, 1, 1]);
        setSoloMasterLoopFrames(null);
        applyPedalFocus(1);
        soloOverdubArmedTrackIndexRef.current = null;
        setSoloOverdubArmedTrackIndex(null);
        syncActiveRecordTrackIndex(null);
        const bpm = Math.max(40, Math.min(240, Math.round(metronomeBpm)));
        setKiteSetupTempo(bpm);
        deriveKiteTimingMetadata({ overrideBpm: bpm });
        setKiteMode("solo");
        setStudioUiPhase("studio");
        await ensureSoloLooperEngineBootstrapped();
      } catch (err) {
        console.error("[EnterSoloStudio] Failed to enter solo studio:", err);
      }
    })();
  }, [
    deriveKiteTimingMetadata,
    ensureMetronomeGainNode,
    ensureSoloLooperEngineBootstrapped,
    ensureStudioAudioContext,
    metronomeBpm,
    rebuildMixerAndReplaceTrack,
    applyPedalFocus,
  ]);

  const returnToLobby = useCallback(() => {
    setConfirmExitOpen(true);
  }, []);

  const confirmEndSession = useCallback(() => {
    runSynchronousHardwareKillSwitch({
      localStreamRef,
      localMicStreamRef,
      remoteStreamRef,
      voipOutgoingDestinationRef,
      localMonitorAudioRef,
      remoteAudioRef,
    });
    setStudioUiPhase("lobby");
    router.push("/studio");
    const transport = p2pEngineRef.current?.transport;
    void transport?.sendLeave();
    bridgeTeardownRef.current?.();
    void transport?.disconnect();
  }, [router, runSynchronousHardwareKillSwitch]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data: { user: next } }) => {
      if (cancelled) return;
      setUser(next ?? null);
      onAuthUserChange?.(next ?? null);
      setAuthReady(true);
      onAuthReadyChange?.(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setUser(session?.user ?? null);
      onAuthUserChange?.(session?.user ?? null);
      setAuthReady(true);
      onAuthReadyChange?.(true);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isRecording && soloSessionRecorderState === "idle") return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isRecording, soloSessionRecorderState]);

  useEffect(() => {
    return () => {
      clearRecordingInterval();
      if (recordingIntervalRef.current !== null) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
      if (localRecorderRef.current) {
        void localRecorderRef.current.stop().catch(() => {});
        localRecorderRef.current = null;
      }
      void stopSoloSessionRecording();
      if (recordedBlobUrl) {
        URL.revokeObjectURL(recordedBlobUrl);
      }
    };
  }, [clearRecordingInterval, recordedBlobUrl, stopSoloSessionRecording]);

  useEffect(() => {
    if (status !== "connected") return;
    setError(null);
  }, [status]);

  /** Stale init failures can leave the failure copy up if `status` flips to connected elsewhere — clear it here. */
  useEffect(() => {
    if (status !== "connected") return;
    setError(null);
    setStatusNote((prev) =>
      prev === BRIDGE_INIT_FAIL_NOTE ? P2P_CONNECTED_NOTE : prev
    );
  }, [status]);

  /** Stop local monitor path once P2P is live (muted alone is not always enough on WebKit). */
  useEffect(() => {
    if (status !== "connected") return;
    const el = localMonitorAudioRef.current;
    if (!el) return;
    el.muted = true;
    el.volume = 0;
    void el.pause();
    el.srcObject = null;
  }, [status]);

  /** Online + Supabase reachable (does not wait for WebRTC peer). */
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    const verifyKiteSignal = async () => {
      if (!navigator.onLine) {
        if (!cancelled) setKiteSignal("offline");
        return;
      }
      if (!cancelled) setKiteSignal("checking");
      try {
        const { error } = await supabase.from("studio_sessions").select("session_id").limit(1);
        if (cancelled) return;
        if (error) setKiteSignal("error");
        else setKiteSignal("secure");
      } catch {
        if (!cancelled) setKiteSignal("error");
      }
    };

    void verifyKiteSignal();

    const onOnline = () => {
      void verifyKiteSignal();
    };
    const onOffline = () => setKiteSignal("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.addEventListener ||
      !navigator.mediaDevices?.enumerateDevices
    ) {
      return;
    }
    const onDeviceChange = async () => {
      await refreshAudioInputDevices();
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      const connectedIds = new Set(
        devices.filter((d) => d.kind === "audioinput").map((d) => d.deviceId)
      );
      const missingActiveIds = activeDeviceIdsRef.current.filter((id) => !connectedIds.has(id));
      if (missingActiveIds.length === 0) return;
      setActiveDeviceIds((prev) => prev.filter((id) => connectedIds.has(id)));
      for (const missingId of missingActiveIds) {
        clearMixerDeviceVolumeState(missingId);
        removeAndCleanupDevice(missingId);
      }
      await rebuildMixerAndReplaceTrack();
    };
    navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", onDeviceChange);
    };
  }, [rebuildMixerAndReplaceTrack, refreshAudioInputDevices, removeAndCleanupDevice, clearMixerDeviceVolumeState]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // --- BATCH 6.FIX.1 ---
    // Reset the teardown guard for this new mount cycle.
    // Safe: React guarantees the previous unmount cleanup finished before this runs.
    hardwareKillSwitchActiveRef.current = false;
    sessionTeardownRanRef.current = false;
    // ---------------------

    let cancelled = false;
    let micStream: MediaStream | null = null;
    let micSyncTimeout: number | null = null;
    micDeniedThisInitRef.current = false;
    let teardownRan = false;
    let connectTimeout: number | null = null;
    let localIceCandidateSeen = false;
    let timeoutExtendedForIce = false;
    let transportSessionId = "";
    let transportActiveRole: Role = "host";
    let transportIsHost = true;
    let transportForceRelay = false;
    let sessionUserId: string | null = null;
    leaveSignalSentRef.current = false;
    leaveSignalReceivedRef.current = false;
    bridgeActiveRoleRef.current = null;
    historySavedRef.current = false;
    sessionStartedAtRef.current = Date.now();
    startTransition(() => {
      setCollaboratorLeft(false);
      setRemoteParticipantName(null);
      setLastDepartedParticipantName(null);
      clearLostCountdown();
      setMicSyncTimedOut(false);
      setMicPermissionHint(null);
      setLocalMicStream(null);
    });

    appliedRemoteSignalRef.current = false;
    seenIceRef.current.clear();
    existingRowRef.current = null;
    peerConnectionRef.current = null;

    // Defensive cleanup: stop any lingering local tracks from previous failed sync attempts.
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    const performTeardown = () => {
      if (teardownRan || sessionTeardownRanRef.current) return;
      teardownRan = true;
      sessionTeardownRanRef.current = true;
      studioSessionReservedRef.current = false;
      sessionBootstrapPromiseRef.current = null;
      cancelled = true;
      teardownKiteSyncTransport();
      peerConnectionRef.current = null;
      highPingStreakRef.current = 0;
      highPingTipDismissedRef.current = false;
      try {
        if (peerRef.current && p2pConnectSucceededRef.current) {
          const activeRole = bridgeActiveRoleRef.current;
          if (activeRole) {
            peerRef.current.send(
              JSON.stringify({ type: "LEAVE", from: activeRole })
            );
          }
        }
      } catch {
        /* ignore */
      }
      void (async () => {
        try {
          const stoppedTrackIds = new Set<string>();
          setPingMs(null);
          setInboundPacketLossPercent(null);
          setCalculatedDelayMs(null);
          calculatedDelayMsRef.current = null;
          setHighPingTipOpen(false);
          clearLostCountdown();
          if (connectTimeout !== null) {
            clearTimeout(connectTimeout);
            connectTimeout = null;
          }
          if (micSyncTimeout !== null) {
            clearTimeout(micSyncTimeout);
            micSyncTimeout = null;
          }
          if (pingIntervalRef.current) {
            clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = null;
          }
          if (handshakeFallbackIntervalRef.current) {
            window.clearInterval(handshakeFallbackIntervalRef.current);
            handshakeFallbackIntervalRef.current = null;
          }
          if (turnCredentialRefreshTimerRef.current !== null) {
            clearTimeout(turnCredentialRefreshTimerRef.current);
            turnCredentialRefreshTimerRef.current = null;
          }
          turnCredentialExpiresAtMsRef.current = null;
          turnCredentialFetchedAtMsRef.current = null;
          teardownRemotePlaybackGraph();
          cleanupKiteEngine({ stopLocalTracks: true, isFull: true });
          soloLooperEngineRef.current?.teardown();
          soloLooperEngineRef.current = null;
          // Mixer teardown: stop every active hardware stream and clear mixer graph/state.
          for (const [deviceId, stream] of Array.from(activeStreamsMapRef.current.entries())) {
            stopMediaStreamTracks(stream, stoppedTrackIds);
            activeStreamsMapRef.current.delete(deviceId);
          }

          // Ensure all mixer audio nodes are disconnected and references cleared.
          mixerTeardownOriginRef.current = "performTeardown";
          teardownMixerGraphNodes();
          mixerTeardownOriginRef.current = "none";
          teardownMasterDestinationNode();

          // Reset mixer UI/state so lobby re-entry starts clean.
          setActiveDeviceIds([]);
          setDeviceVolumes({});
          setDeviceInputChannelCount({});
          interfaceInputDeviceFlagsRef.current = {};
          interfaceLiveMonitorEnabledFlagsRef.current = {};
          setInterfaceInputDeviceFlags({});
          setInterfaceLiveMonitorEnabledFlags({});
          for (const meterEl of Array.from(perChannelMeterRefs.current.values())) {
            meterEl.style.width = "0%";
          }
          perChannelMeterRefs.current.clear();
          if (masterLiveMeterElementRef.current) {
            masterLiveMeterElementRef.current.style.width = "0%";
            masterLiveMeterElementRef.current = null;
          }
          setStudioUiPhase("lobby");

          const runDeferredHeavyCleanup = (): void => {
            void (async () => {
              try {
                await closeStudioAudioContext();
                metronomeGainRef.current = null;
                workletLoadedContextRef.current = null;
                workletLoadPromiseRef.current = null;
                if (mountedRef.current) {
                  setIsWorkletLoaded(false);
                  setAudioContextReady(false);
                }
                if (cleanupSessionRef.current) {
                  await cleanupSessionRef.current();
                  cleanupSessionRef.current = null;
                }
              } catch {
                // Ignore cleanup errors in dev teardown.
              }
            })();
          };

          if (typeof requestIdleCallback === "function") {
            requestIdleCallback(runDeferredHeavyCleanup, { timeout: 2000 });
          } else {
            window.setTimeout(runDeferredHeavyCleanup, 0);
          }

          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = null;
          }
          stopMediaStreamTracks(remoteStreamRef.current, stoppedTrackIds);
          if (remoteStreamRef.current) {
            remoteStreamRef.current = null;
          }
          if (localMonitorAudioRef.current) {
            localMonitorAudioRef.current.srcObject = null;
          }
          channelRef.current?.unsubscribe();
          channelRef.current = null;

          peerRef.current?.destroy();
          peerRef.current = null;

          const localStreamToStop = localStreamRef.current;
          try {
            stopMediaStreamTracks(localStreamToStop, stoppedTrackIds);
            stopMediaStreamTracks(localMicStreamRef.current, stoppedTrackIds);
          } finally {
            micStream = null;
            localStreamRef.current = null;
          }

          if (mountedRef.current) {
            setLocalMicStream(null);
            setRemoteStream(null);
            setAudioTestDone(false);
            setAudioTestFailed(false);
            setRemoteLevel(0);
            setIsMicMuted(false);
            setIsSpeakerMuted(false);
            speakerMutedRef.current = false;
            setRemotePlaybackVolume(DEFAULT_REMOTE_PLAYBACK_VOLUME);
            remotePlaybackVolumeRef.current = DEFAULT_REMOTE_PLAYBACK_VOLUME;
            setConnectionLostCountdown(null);
            setRemoteParticipantName(null);
            setIsRecording(false);
            setRecordingTimeMs(0);
            setKiteSyncEnabled(false);
            setBroadcastStatus("idle");
            setRecordedBlobUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return null;
            });
          }

          clearRecordingInterval();
          if (localRecorderRef.current) {
            void localRecorderRef.current.stop().catch(() => {});
            localRecorderRef.current = null;
          }
        } catch {
          // Ignore cleanup errors in dev teardown.
        }
      })();
    };

    bridgeTeardownRef.current = performTeardown;

    const appendIceCandidate = async (
      sessionId: string,
      nextCandidate: IceCandidateRow
    ) => {
      const { data: current, error: currentErr } = await supabase
        .from("studio_sessions")
        .select("ice_candidates")
        .eq("session_id", sessionId.toUpperCase())
        .single<{ ice_candidates: IceCandidateRow[] | null }>();

      if (currentErr) throw currentErr;
      const existing = Array.isArray(current?.ice_candidates) ? current.ice_candidates : [];
      const updated = [...existing, nextCandidate];

      const { error: updateErr } = await supabase
        .from("studio_sessions")
        .update({ ice_candidates: updated })
        .eq("session_id", sessionId.toUpperCase());
      if (updateErr) throw updateErr;
    };

    const applyRemoteIce = (
      incoming: IceCandidateRow[] | null | undefined,
      myRole: Role
    ) => {
      if (!Array.isArray(incoming) || !peerRef.current) return;
      for (const item of incoming) {
        if (!item || typeof item !== "object") continue;
        if (item.from === myRole) continue;
        if (!item.id || seenIceRef.current.has(item.id)) continue;
        if (!item.candidate || typeof item.candidate !== "object") continue;
        seenIceRef.current.add(item.id);
        peerRef.current.signal(item.candidate);
      }
    };

    let reconnectTransport: () => Promise<void> = async () => {};

    const clearTurnCredentialRefreshTimer = () => {
      if (turnCredentialRefreshTimerRef.current !== null) {
        clearTimeout(turnCredentialRefreshTimerRef.current);
        turnCredentialRefreshTimerRef.current = null;
      }
    };

    const scheduleTurnCredentialRefresh = (expiresAtEpochMs: number | null) => {
      clearTurnCredentialRefreshTimer();
      if (typeof expiresAtEpochMs !== "number" || !Number.isFinite(expiresAtEpochMs)) {
        return;
      }
      const refreshSkewMs = 60_000;
      const delayMs = Math.max(10_000, expiresAtEpochMs - Date.now() - refreshSkewMs);
      turnCredentialRefreshTimerRef.current = window.setTimeout(() => {
        turnCredentialRefreshTimerRef.current = null;
        void (async () => {
          if (cancelled || !mountedRef.current) return;
          try {
            const refreshBundle = await fetchTurnCredentialsWithMeta();
            const pc = peerConnectionRef.current;
            if (!pc || cancelled || !mountedRef.current) return;
            try {
              pc.setConfiguration(buildPeerConfig(refreshBundle.iceServers, transportForceRelay));
            } catch (cfgErr) {
              console.error("[Kite] setConfiguration after TURN refresh failed:", cfgErr);
            }
            if (typeof pc.restartIce === "function") {
              pc.restartIce();
            }
            turnCredentialExpiresAtMsRef.current = refreshBundle.expiresAtEpochMs;
            turnCredentialFetchedAtMsRef.current = Date.now();
            scheduleTurnCredentialRefresh(refreshBundle.expiresAtEpochMs);
          } catch (err) {
            console.error("[Kite] TURN credential refresh failed:", err);
            turnCredentialRefreshTimerRef.current = window.setTimeout(() => {
              scheduleTurnCredentialRefresh(
                turnCredentialExpiresAtMsRef.current ?? Date.now() + 150_000
              );
            }, 120_000);
          }
        })();
      }, delayMs);
    };

    const buildTransport = async (localStream: MediaStream, ctx: AudioContext) => {
      const localTrack = localStream.getAudioTracks()[0] ?? null;
      if (process.env.NODE_ENV !== "production") {
        console.assert(
          ctx.state === "running",
          "[Kite][Invariant] buildTransport requires running AudioContext",
          ctx.state
        );
        console.assert(
          localTrack?.readyState === "live",
          "[Kite][Invariant] buildTransport requires live local track",
          localTrack?.readyState
        );
      }
      p2pConnectSucceededRef.current = false;
      appliedRemoteSignalRef.current = false;
      seenIceRef.current = new Set();
      clearTurnCredentialRefreshTimer();
      turnCredentialExpiresAtMsRef.current = null;
      turnCredentialFetchedAtMsRef.current = null;
      setStatus("connecting");
      addLog("Phase 3: Realtime subscribe + peer");
      setStatusNote("Starting peer connection...");

      const roomId = `session_id:${transportSessionId.toUpperCase()}`;
      const channel = supabase
        .channel(
          roomId,
          { config: { realtime: { heartbeatIntervalMs: 3000 } } } as any
        )
        .on("broadcast", { event: "session-control" }, (payload) => {
          const msg = payload.payload as SessionControlMessage | undefined;
          if (!msg || msg.type !== "LEAVE") return;
          if (msg.room !== transportSessionId.toUpperCase()) return;
          if (msg.from === transportActiveRole) return;
          const departedName = remoteParticipantName || "A participant";
          leaveSignalReceivedRef.current = true;
          setKiteSyncEnabled(false);
          setBroadcastStatus("idle");
          stopKiteMetronome();
          addLog("Collaborator LEAVE received");
          clearLostCountdown();
          setCollaboratorLeft(true);
          setLastDepartedParticipantName(departedName);
          setRemoteParticipantName(null);
          setStatus("failed");
          setStatusNote(`${departedName} left the session.`);
          window.location.href = "https://kite-support.vercel.app/studio";
        })
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "studio_sessions",
            filter: `session_id=eq.${transportSessionId.toUpperCase()}`,
          },
          (payload) => {
            console.log('[SUPABASE-POSTGRES-CHANGE] Payload received:', payload);
            const nextRow = payload.new as StudioSessionRow;
            if (!nextRow || typeof nextRow !== "object") return;
            const peer = peerRef.current;

            if (transportActiveRole === "host") {
              if (
                peer &&
                !appliedRemoteSignalRef.current &&
                nextRow.answer &&
                typeof nextRow.answer === "object"
              ) {
                appliedRemoteSignalRef.current = true;
                addLog("Answer received");
                peer.signal(nextRow.answer);
                scheduleConnectTimeout(60000);
                setStatusNote("Answer received. Negotiating...");
              }
            } else if (
              peer &&
              !appliedRemoteSignalRef.current &&
              nextRow.offer &&
              typeof nextRow.offer === "object"
            ) {
              appliedRemoteSignalRef.current = true;
              addLog("Offer received");
              peer.signal(nextRow.offer);
              scheduleConnectTimeout(60000);
              setStatusNote("Offer received. Creating answer...");
            }

            applyRemoteIce(nextRow.ice_candidates, transportActiveRole);
          }
        )
        .subscribe((status, err) => {
          console.log('[SUPABASE-CHANNEL-STATUS]', status, err);
          if (status === 'SUBSCRIBED') {
            console.log('[Kite] Signaling Bridge Restored');
          }
        });
      channelRef.current = channel;

      addLog(
        `Negotiation: ${transportIsHost ? "host initiates (offer first)" : "guest answers"}`
      );

      const isSafariWebKit = isStudioSafariWebKitEngine();
      const lowLatencyReceiverOpts = { isSafariWebKit };

      const bundle = await fetchTurnCredentialsWithMeta();
      const iceServers = bundle.iceServers;
      turnCredentialExpiresAtMsRef.current = bundle.expiresAtEpochMs;
      turnCredentialFetchedAtMsRef.current = Date.now();
      if (transportForceRelay && iceServers.length === 0) {
        setStatusNote("Secure relay servers unavailable. Restrictive network detected.");
      }
      const peerConfig = buildPeerConfig(iceServers, transportForceRelay);
      const peer = new Peer({
        initiator: transportIsHost,
        trickle: true,
        stream: localStream,
        config: peerConfig,
        sdpTransform: (sdp) => {
          console.log("[SDP-IN]", sdp);
          try {
            const result = forceMusicModeOpus(sdp, { isSafariWebKit });
            console.log("[SDP-OUT]", result);
            if (!result || typeof result !== "string") {
              console.error("[SDP-TRANSFORM] returned invalid value:", result);
            }
            return result;
          } catch (err) {
            console.error("[SDP-TRANSFORM] threw:", err);
            return sdp;
          }
        },
      });
      peerRef.current = peer;
      peer.on("error", (err) => {
        console.error("[PEER-ERROR]", err);
      });
      // Attach raw RTCPeerConnection diagnostic listeners
      if ((peer as any)._pc) {
        const pc = (peer as any)._pc;
        pc.addEventListener("icegatheringstatechange", () =>
          console.log("[ICE-GATHER]", pc.iceGatheringState)
        );
        pc.addEventListener("iceconnectionstatechange", () =>
          console.log("[ICE-CONN]", pc.iceConnectionState)
        );
        pc.addEventListener("signalingstatechange", () =>
          console.log("[SIG-STATE]", pc.signalingState)
        );
      }
      let presenceNotified = false;

      const scheduleConnectTimeout = (delayMs: number) => {
        if (connectTimeout !== null) {
          clearTimeout(connectTimeout);
        }
        connectTimeout = window.setTimeout(() => {
          if (!mountedRef.current || cancelled || statusRef.current !== "connecting") return;

          // On strict networks, ICE gathering can be slower; allow one grace extension.
          if (!localIceCandidateSeen && !timeoutExtendedForIce) {
            timeoutExtendedForIce = true;
            addLog("No local ICE yet after 15s; extending timeout window.");
            setStatusNote("Gathering network routes...");
            scheduleConnectTimeout(10000);
            return;
          }

          console.error("WebRTC timeout before connect", {
            iceServers: "Fetched dynamically",
            localIceCandidateSeen,
          });
          setStatus("failed");
          setStatusNote(
            "Network Restricted. This can happen on some restricted Wi-Fi networks. Try switching to Mobile Data."
          );
        }, delayMs);
      };

      // Start timeout window (with one automatic extension if ICE is still gathering).
      scheduleConnectTimeout(60000);

      // Phase 4.1.1: backup poll if Realtime misses postgres_changes during handshake.
      handshakeFallbackIntervalRef.current = window.setInterval(async () => {
        if (p2pConnectSucceededRef.current || statusRef.current !== "connecting" || !mountedRef.current) {
          if (handshakeFallbackIntervalRef.current) {
            window.clearInterval(handshakeFallbackIntervalRef.current);
            handshakeFallbackIntervalRef.current = null;
          }
          return;
        }

        try {
          const { data } = await supabase
            .from("studio_sessions")
            .select("offer, answer, ice_candidates")
            .eq("session_id", transportSessionId.toUpperCase())
            .single<StudioSessionRow>();

          if (!data) return;
          const currentPeer = peerRef.current;
          if (!currentPeer) return;

          if (transportActiveRole === "host") {
            if (!appliedRemoteSignalRef.current && data.answer && typeof data.answer === "object") {
              appliedRemoteSignalRef.current = true;
              addLog("Answer received (via Poller)");
              currentPeer.signal(data.answer);
              scheduleConnectTimeout(60000);
              setStatusNote("Answer received. Negotiating...");
            }
          } else {
            if (!appliedRemoteSignalRef.current && data.offer && typeof data.offer === "object") {
              appliedRemoteSignalRef.current = true;
              addLog("Offer received (via Poller)");
              currentPeer.signal(data.offer);
              scheduleConnectTimeout(60000);
              setStatusNote("Offer received. Creating answer...");
            }
          }
          applyRemoteIce(data.ice_candidates, transportActiveRole);
        } catch {
          /* ignore network errors during polling */
        }
      }, 4000);

      const rawPc = (peer as unknown as { _pc?: RTCPeerConnection })._pc;
      if (rawPc) {
        peerConnectionRef.current = rawPc;
        rawPc.addEventListener("track", () => {
          applyLowLatencyInboundAudioReceivers(rawPc, lowLatencyReceiverOpts);
        });

        rawPc.addEventListener("icegatheringstatechange", () => {
          // no-op
        });

        rawPc.addEventListener("icecandidate", (_event) => {
          // no-op
        });

        rawPc.addEventListener(
          "icecandidateerror",
          (event: RTCPeerConnectionIceErrorEvent) => {
            console.error("ICE candidate error detail:", {
              errorCode: event.errorCode,
              errorText: event.errorText,
              url: event.url,
            });
          }
        );

        rawPc.addEventListener("iceconnectionstatechange", () => {
          const iceState = rawPc.iceConnectionState;
          addLog(`iceConnectionState=${iceState}`);

          if (leaveSignalReceivedRef.current) return;
          if (iceState === "connected" || iceState === "completed") {
            p2pConnectSucceededRef.current = true;
            setError(null);
            setStatus("connected");
            clearLostCountdown();
            applyLowLatencyInboundAudioReceivers(rawPc, lowLatencyReceiverOpts);
            rawPc
              .getStats()
              .then((stats) => {
                stats.forEach((report) => {
                  if (report.type === "candidate-pair" && report.state === "succeeded") {
                    addLog(
                      `SELECTED PAIR — local: ${report.localCandidateId} remote: ${report.remoteCandidateId}`
                    );
                  }
                  if (report.type === "local-candidate") {
                    addLog(
                      `LOCAL candidate type: ${report.candidateType} protocol: ${report.protocol}`
                    );
                  }
                  if (report.type === "remote-candidate") {
                    addLog(
                      `REMOTE candidate type: ${report.candidateType} protocol: ${report.protocol}`
                    );
                  }
                });
              })
              .catch(() => {
                // Stats may not be available in all environments; ignore errors.
              });
            return;
          }
          if (iceState === "disconnected") {
            void reconnectTransport();
            return;
          }
          if (iceState === "failed") {
            void reconnectTransport();
          }
        });
        scheduleTurnCredentialRefresh(turnCredentialExpiresAtMsRef.current);
      }

      peer.on("stream", (remoteStream: MediaStream) => {
        if (!mountedRef.current) return;
        addLog("Remote audio stream received");
        remoteStreamRef.current = remoteStream;
        setRemoteStream(remoteStream);
        setRemoteLevel(0);
        const remoteEl = remoteAudioRef.current;
        if (remoteEl) {
          remoteEl.srcObject = remoteStream;
          remoteEl.muted = true;
          void remoteEl.play().catch(() => {
            addLog("Remote audio play() blocked (tap page if silent)");
          });
        }
        if (
          studioAudioContextRef.current &&
          !isBroadcastConnectPendingRef.current &&
          kiteModeRef.current !== "broadcast"
        ) {
          buildRemotePlaybackGraph(remoteStream);
        }
      });

      peer.on("data", (chunk: unknown) => {
        // Binary path: KITE interval chunk — must be checked before text/JSON path.
        const loadChunk = decodeLoadIntervalChunk(chunk);
        if (loadChunk) {
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
              queuedRemoteKiteIntervalRef.current.push(interval);
              console.log(
                "[P2P RX] live interval complete:",
                interval.intervalId,
                "frames:",
                interval.intervalFrames
              );
            } else {
              retainedRemoteKiteLoopRef.current = interval;
              console.log(
                "[P2P RX] retained loop complete:",
                interval.intervalId,
                "frames:",
                interval.intervalFrames
              );
            }
          }
          return;
        }

        // Text/JSON path: all signalling and control messages.
        try {
          const text = decodePeerDataChunk(chunk);
          const msg = JSON.parse(text) as {
            t?: string;
            ts?: number;
            type?: string;
            name?: string;
            bpm?: number;
            bpi?: number;
            hostTime?: number;
            enabled?: boolean;
            serverTimestamp?: number;
            sequenceNumber?: number;
            initiatorId?: string;
            studioRevision?: number;
            originatorId?: string;
            patch?: unknown;
            from?: Role;
            action?: JamSetupLockAction;
            ownerId?: string;
            ownerName?: string;
            expiresAt?: number;
            timing?: unknown;
            clockAnchorSec?: number;
            hasRetainedLoop?: boolean;
            igniteP2PEngine?: boolean;
          };
          if (msg.type === "LEAVE") {
            if (msg.from === transportActiveRole) return;
            const departedName = remoteParticipantName || "A participant";
            leaveSignalReceivedRef.current = true;
            setKiteSyncEnabled(false);
            setBroadcastStatus("idle");
            syncInitiatorIdRef.current = null;
            if (mountedRef.current) {
              setSyncInitiatorId(null);
            }
            stopKiteMetronome();
            clearLostCountdown();
            setCollaboratorLeft(true);
            setLastDepartedParticipantName(departedName);
            setRemoteParticipantName(null);
            setStatus("failed");
            setStatusNote(`${departedName} left the session.`);
            router.push("/studio");
            return;
          }
          if (msg.type === "JAM_SETUP_LOCK") {
            if (msg.action === "acquire") {
              if (
                typeof msg.ownerId !== "string" ||
                typeof msg.ownerName !== "string" ||
                typeof msg.expiresAt !== "number" ||
                msg.expiresAt <= Date.now()
              ) {
                return;
              }
              setJamSetupLock({
                ownerId: msg.ownerId,
                ownerName: msg.ownerName,
                expiresAt: msg.expiresAt,
              });
              scheduleJamSetupLockExpiry(msg.expiresAt);
              return;
            }
            if (msg.action === "release") {
              clearJamSetupLockTimer();
              jamSetupLockExpiresAtRef.current = null;
              jamSetupLockTokenRef.current = null;
              setJamSetupLock(null);
              return;
            }
          }
          if (
            msg.type === "SET_INTERVAL" &&
            msg.timing !== null &&
            typeof msg.timing === "object" &&
            typeof (msg.timing as KiteIntervalTiming).bpm === "number" &&
            typeof (msg.timing as KiteIntervalTiming).chords === "number" &&
            typeof (msg.timing as KiteIntervalTiming).timeSignatureTop === "number" &&
            typeof (msg.timing as KiteIntervalTiming).timeSignatureBottom === "number"
          ) {
            const timing = msg.timing as KiteIntervalTiming;
            const clockAnchorSec = typeof msg.clockAnchorSec === "number" ? msg.clockAnchorSec : 0;
            const hasRetainedLoop = typeof msg.hasRetainedLoop === "boolean" ? msg.hasRetainedLoop : false;
            applySetIntervalLocally(timing, clockAnchorSec, hasRetainedLoop);
            if (msg.igniteP2PEngine === true) {
              const run = startP2PEngineRef.current;
              if (!run) {
                console.error("[Kite] igniteP2PEngine dropped: ref is null");
                queueMicrotask(() => {
                  const retry = startP2PEngineRef.current;
                  if (retry) void retry(timing);
                });
                return;
              }
              void run(timing);
            }
            return;
          }
          if (msg.type === "STUDIO_PARAM") {
            if (
              typeof msg.originatorId !== "string" ||
              typeof msg.studioRevision !== "number" ||
              msg.patch === null ||
              typeof msg.patch !== "object"
            ) {
              return;
            }
            if (msg.studioRevision <= lastAcceptedStudioRevisionRef.current) return;
            lastAcceptedStudioRevisionRef.current = msg.studioRevision;
            const p = msg.patch as StudioParamMessage["patch"];
            if (typeof p.kiteSetupTempo === "number") {
              setKiteSetupTempo(Math.max(20, Math.min(320, Math.round(p.kiteSetupTempo))));
            }
            if (typeof p.kiteSetupTimeSignatureTop === "number") {
              setKiteSetupTimeSignatureTop(
                Math.max(1, Math.min(16, Math.round(p.kiteSetupTimeSignatureTop)))
              );
            }
            if (typeof p.kiteSetupTimeSignatureBottom === "number") {
              setKiteSetupTimeSignatureBottom(
                Math.max(1, Math.min(32, Math.round(p.kiteSetupTimeSignatureBottom)))
              );
            }
            if (typeof p.kiteSetupChordCount === "number") {
              setKiteSetupChordCount(Math.max(1, Math.min(64, Math.round(p.kiteSetupChordCount))));
            }
            if (typeof p.bpm === "number") {
              setMetronomeBpm(Math.max(40, Math.min(240, Math.round(p.bpm))));
            }
            if (typeof p.bpi === "number") {
              setBeatsPerInterval(Math.max(1, Math.round(p.bpi)));
            }
            return;
          }
          if (msg.type === "presence" && typeof msg.name === "string" && msg.name.trim().length > 0) {
            if (mountedRef.current) {
              const incomingName = msg.name.trim();
              setRemoteParticipantName(incomingName);
              if (!presenceNotified) {
                setStatusNote(`${incomingName} entered the session.`);
                presenceNotified = true;
              }
            }
          } else if (msg.t === "ping" && typeof msg.ts === "number") {
            peer.send(JSON.stringify({ t: "pong", ts: msg.ts }));
          } else if (msg.t === "pong" && typeof msg.ts === "number" && mountedRef.current) {
            const latency = Math.round(performance.now() - msg.ts);
            setPingMs(latency);
          } else if (
            msg.type === "KITE_SYNC" &&
            typeof msg.sequenceNumber === "number" &&
            typeof msg.hostTime === "number" &&
            typeof msg.serverTimestamp === "number" &&
            typeof msg.bpm === "number" &&
            typeof msg.bpi === "number" &&
            typeof msg.enabled === "boolean"
          ) {
            if (msg.sequenceNumber <= lastAcceptedKiteSyncSeqRef.current) return;

            if (!msg.enabled) {
              const packetInitiator = typeof msg.initiatorId === "string" ? msg.initiatorId : null;
              if (packetInitiator !== null) {
                if (packetInitiator !== syncInitiatorIdRef.current) return;
              } else if (syncInitiatorIdRef.current !== null) {
                return;
              }
              lastAcceptedKiteSyncSeqRef.current = msg.sequenceNumber;
              setKiteSyncEnabled(false);
              setBroadcastStatus("idle");
              syncInitiatorIdRef.current = null;
              if (mountedRef.current) {
                setSyncInitiatorId(null);
              }
              cleanupKiteEngine({ stopLocalTracks: false, isFull: false });

              restoreLiveVoipTrackAfterKite();

              const remoteStream = remoteStreamRef.current;
              if (remoteStream) {
                buildRemotePlaybackGraph(remoteStream);
              }
              return;
            }

            lastAcceptedKiteSyncSeqRef.current = msg.sequenceNumber;

            setKiteSyncEnabled(true);
            setBroadcastStatus("syncing");

            if (typeof msg.initiatorId === "string") {
              syncInitiatorIdRef.current = msg.initiatorId;
              if (mountedRef.current) {
                setSyncInitiatorId(msg.initiatorId);
              }
            }

            const incomingRev = typeof msg.studioRevision === "number" ? msg.studioRevision : null;
            let applyBpmBpi = true;
            if (incomingRev !== null) {
              if (incomingRev < lastAcceptedStudioRevisionRef.current) {
                applyBpmBpi = false;
              } else {
                lastAcceptedStudioRevisionRef.current = incomingRev;
              }
            }

            const receivedAtMs = Date.now();
            const rttDelaySec = (calculatedDelayMsRef.current || 0) / 1000;
            const offsetSec = (receivedAtMs - msg.serverTimestamp) / 1000;
            const sampleRate = getStudioKiteSampleRate();
            const bufferDelaySec = targetLeadFramesRef.current / sampleRate;
            const guestTargetSec =
              msg.hostTime + offsetSec + rttDelaySec + bufferDelaySec;

            lastAppliedGuestStartSecRef.current = guestTargetSec;
            lastSyncApplyAtMsRef.current = receivedAtMs;
            if (applyBpmBpi) {
              setMetronomeBpm(msg.bpm);
              setBeatsPerInterval(msg.bpi);
            }
            const ctx = studioAudioContextRef.current;
            if (ctx) {
              const sixteenthSec = 60 / msg.bpm / 4;
              let nextGridSec = guestTargetSec;
              if (
                Number.isFinite(sixteenthSec) &&
                sixteenthSec > 0 &&
                guestTargetSec < ctx.currentTime
              ) {
                nextGridSec =
                  guestTargetSec +
                  Math.ceil((ctx.currentTime - guestTargetSec) / sixteenthSec) * sixteenthSec;
              }
              flushAndSetRemoteGridTarget(nextGridSec);
              const timing =
                latestKiteIntervalTimingRef.current ?? kiteIntervalTimingRef.current;
              const beatsPerBar = Math.max(
                1,
                Math.round(timing?.beatsPerBar ?? timing?.timeSignatureTop ?? 4)
              );
              const countInOneBarSec = (60 / msg.bpm) * beatsPerBar;
              if (Number.isFinite(countInOneBarSec) && countInOneBarSec > 0) {
                kiteSyncCountInEndAtContextSecRef.current =
                  ctx.currentTime + countInOneBarSec;
                if (metronomeGainRef.current) metronomeGainRef.current.gain.value = 0;
                setKiteSyncCountInActive(true);
                kiteSyncCountInActiveRef.current = true;
                kiteSyncCountInCompletionHandledRef.current = false;

                void queueMicrotask(() => {
                  const timing =
                    latestKiteIntervalTimingRef.current ?? kiteIntervalTimingRef.current;
                  if (timing) {
                    startP2PIntervalSchedulerRef.current?.(timing);
                  } else {
                    console.warn("[Kite] Guest scheduler ignite skipped — no timing ref");
                  }
                });
              }
            }
            console.log("KITE_SYNC received! Guest Target Start:", guestTargetSec);
          }
        } catch {
          // Ignore non-JSON or malformed ping payloads.
        }
      });

      const enqueueIceAppend = (nextCandidate: IceCandidateRow) => {
        iceAppendQueueRef.current = iceAppendQueueRef.current
          .then(async () => {
            await appendIceCandidate(transportSessionId, nextCandidate);
            addLog("ICE candidate sent");
          })
          .catch((err) => {
            console.error("ICE append failed", err);
            addLog("ICE send failed");
          });
        void iceAppendQueueRef.current;
      };

      peer.on("signal", (signalData: SignalData) => {
        try {
          const candidateLike = (signalData as { candidate?: unknown }).candidate;
          const typeLike = (signalData as { type?: unknown }).type;

          if (candidateLike) {
            localIceCandidateSeen = true;
            const candidateRecord: IceCandidateRow = {
              id: `${transportActiveRole}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              from: transportActiveRole,
              candidate: signalData,
            };
            enqueueIceAppend(candidateRecord);
            return;
          }

          if (typeLike === "offer") {
            addLog("Offer sent");
            void (async () => {
              const { error } = await supabase
                .from("studio_sessions")
                .update({ offer: signalData })
                .eq("session_id", transportSessionId.toUpperCase());
              if (error) throw error;
              setStatusNote("Offer published. Waiting for peer answer...");
            })().catch((err) => {
              console.error("Offer publish failed", err);
              setStatus("failed");
              setStatusNote("Offer publish failed.");
            });
            return;
          }

          if (typeLike === "answer") {
            addLog("Answer sent");
            void (async () => {
              const { error } = await supabase
                .from("studio_sessions")
                .update({ answer: signalData })
                .eq("session_id", transportSessionId.toUpperCase());
              if (error) throw error;
              setStatusNote("Answer sent. Finalizing connection...");
            })().catch((err) => {
              console.error("Answer publish failed", err);
              setStatus("failed");
              setStatusNote("Answer publish failed.");
            });
            return;
          }
        } catch {
          setStatus("failed");
          setStatusNote("Signaling update failed.");
        }
      });

      peer.on("connect", () => {
        p2pConnectSucceededRef.current = true;
        setError(null);
        setStatus("connected");
        setStatusNote(P2P_CONNECTED_NOTE);
        void channel.unsubscribe();
        if (channelRef.current === channel) {
          channelRef.current = null;
        }
        console.log('[Kite] Handshake complete. Signaling bridge closed to reduce jitter.');
        try {
          peer.send(
            JSON.stringify({
              type: "presence",
              name: transportIsHost ? "Host" : "Guest",
            })
          );
        } catch {
          // Presence payload is best-effort; keep connect flow unchanged on send failures.
        }
        if (kiteSyncEnabled && pendingKiteSyncRef.current) {
          try {
            peer.send(JSON.stringify(pendingKiteSyncRef.current));
            pendingKiteSyncRef.current = null;
          } catch {
            // Keep queued packet for next successful send checkpoint.
          }
        }
        try {
          const timing = deriveKiteTimingMetadata();
          const hasRetainedLoop = retainedKiteLoopBufferRef.current !== null;
          sendSetInterval(timing, hasRetainedLoop);
        } catch {
          // SET_INTERVAL is best-effort on connect; retained loop is preserved.
        }
        if (connectTimeout !== null) {
          clearTimeout(connectTimeout);
          connectTimeout = null;
        }
        if (pingIntervalRef.current !== null) {
          clearInterval(pingIntervalRef.current);
        }
        pingIntervalRef.current = window.setInterval(() => {
          if (!mountedRef.current) return;
          try {
            peer.send(JSON.stringify({ t: "ping", ts: performance.now() }));
          } catch {
            console.warn("[Kite] Ping failed, peer likely closed");
          }
        }, 2000);
      });

      peer.on("error", (err: unknown) => {
        if (!mountedRef.current) return;
        if (pingIntervalRef.current !== null) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
        const msg =
          err instanceof Error
            ? err.message
            : typeof err === "object" && err !== null && "message" in err
              ? String((err as { message: unknown }).message)
              : String(err);
        const code =
          typeof err === "object" && err !== null && "code" in err
            ? String((err as { code: unknown }).code)
            : "";
        addLog(`Peer error: ${msg}${code ? ` code=${code}` : ""}`);
        console.error("WebRTC peer error detail", {
          message: msg,
          code,
          iceServers: peerConfig?.iceServers ?? "fetched-at-runtime",
        });
      });

      peer.on("close", () => {
        if (!mountedRef.current) return;
        setRemoteParticipantName(null);
        if (pingIntervalRef.current !== null) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
        if (connectTimeout !== null) {
          clearTimeout(connectTimeout);
          connectTimeout = null;
        }
        if (transportIsHost) {
          const inActiveKiteSession =
            kiteModeRef.current === "broadcast" || kiteSyncEnabledRef.current;
          if (inActiveKiteSession) {
            addLog("Host: peer disconnected — exiting Kite Sync");
            try {
              hostExitKiteBroadcastOnPeerDisconnectRef.current();
            } catch {
              /* ignore teardown errors while peer is torn down */
            }
          }
        }
        if (!leaveSignalReceivedRef.current && statusRef.current !== "connected") {
          addLog("Peer closed");
          beginLostCountdown();
          setStatusNote("Connection lost, attempting to recover...");
        }
      });

      if (!transportIsHost) {
        const initial = existingRowRef.current;
        if (initial?.offer && typeof initial.offer === "object") {
          appliedRemoteSignalRef.current = true;
          addLog("Initial offer applied");
          peer.signal(initial.offer);
          setStatusNote("Creating answer...");
        }
        if (initial?.ice_candidates) {
          applyRemoteIce(initial.ice_candidates, transportActiveRole);
        }
      } else {
        const { data: current } = await supabase
          .from("studio_sessions")
          .select("answer, ice_candidates")
          .eq("session_id", transportSessionId.toUpperCase())
          .single<Pick<StudioSessionRow, "answer" | "ice_candidates">>();
        if (current?.answer && typeof current.answer === "object") {
          appliedRemoteSignalRef.current = true;
          addLog("Initial answer applied");
          peer.signal(current.answer);
        }
        if (current?.ice_candidates) {
          applyRemoteIce(current.ice_candidates, transportActiveRole);
        }
      }
    };
    buildTransportRef.current = buildTransport;

    reconnectTransport = async () => {
      if (!localStreamRef.current || !studioAudioContextRef.current) return;
      clearTurnCredentialRefreshTimer();
      restoreLiveVoipTrackAfterKite();
      cleanupKiteEngine({ stopLocalTracks: false, isFull: false });
      addLog("Initiating ICE Soft Reboot...");
      setStatus("connecting");
      setStatusNote("Connection dropped. Reconnecting...");

      if (handshakeFallbackIntervalRef.current) {
        window.clearInterval(handshakeFallbackIntervalRef.current);
        handshakeFallbackIntervalRef.current = null;
      }
      if (connectTimeout !== null) {
        clearTimeout(connectTimeout);
        connectTimeout = null;
      }
      if (pingIntervalRef.current !== null) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      channelRef.current?.unsubscribe();
      channelRef.current = null;
      peerRef.current?.destroy();
      peerRef.current = null;
      peerConnectionRef.current = null;
      teardownRemotePlaybackGraph();

      if (transportIsHost) {
        await supabase
          .from("studio_sessions")
          .update({ offer: null, answer: null, ice_candidates: [] })
          .eq("session_id", transportSessionId.toUpperCase());
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }

      await buildTransport(
        localStreamRef.current,
        studioAudioContextRef.current as AudioContext
      );
    };

    const initNetworkSession = async () => {
      if (studioSessionReservedRef.current) return;
      if (bridgeInitInFlightRef.current) return;
      bridgeInitInFlightRef.current = true;
      try {
        const url = new URL(window.location.href);
        const forceRelay = url.searchParams.get("relay") === "true";
        // Host only when `room` query is absent. `?room=` (empty) is a guest URL with invalid code.
        const roomParamRaw = url.searchParams.get("room");
        const isHost = roomParamRaw === null;
        const sessionIdCandidate = isHost
          ? randomSessionId()
          : normalizeStudioSessionId(roomParamRaw ?? "").toUpperCase();
        if (!isHost && sessionIdCandidate.length !== 6) {
          throw new Error("Invalid room code. Expected 6 characters.");
        }
        const sessionId = sessionIdCandidate.toUpperCase();

        if (!isHost) {
          if (!cancelled && mountedRef.current) {
            setSessionId(sessionId);
          }
        } else {
          cleanupSessionRef.current = async () => {
            addLog("Cleaning up studio_sessions row...");
            await supabase
              .from("studio_sessions")
              .delete()
              .eq("session_id", sessionId.toUpperCase());
          };

          console.log(
            "DEBUG: Attempting Supabase Upsert for session (reservation):",
            sessionId.toUpperCase()
          );
          const { error: reserveErr } = await supabase.from("studio_sessions").upsert(
            { session_id: sessionId.toUpperCase() },
            { onConflict: "session_id" }
          );
          if (reserveErr) {
            console.error("DEBUG: Upsert Failed (reservation):", reserveErr);
            throw reserveErr;
          }

          if (!cancelled && mountedRef.current) {
            const hostUrlSynced = new URL(window.location.href);
            hostUrlSynced.searchParams.set("room", sessionId.toUpperCase());
            setInviteLink(hostUrlSynced.toString());
            window.history.replaceState(null, "", hostUrlSynced.toString());
            setSessionId(sessionId);
          }
        }

        const activeRole: Role = isHost ? "host" : "peer";
        bridgeActiveRoleRef.current = activeRole;
        setRole(activeRole);
        const { data: authData } = await supabase.auth.getUser();
        sessionUserId = authData.user?.id ?? null;

        if (isHost) {
          addLog("Phase 2: host full upsert studio_sessions");
          setStatusNote("Room Created. Waiting in Lobby...");

          console.log(
            "DEBUG: Attempting Supabase Upsert for session (full row):",
            sessionId.toUpperCase()
          );
          const { error: insertErr } = await supabase.from("studio_sessions").upsert(
            {
              session_id: sessionId.toUpperCase(),
              offer: null,
              answer: null,
              ice_candidates: [],
            },
            { onConflict: "session_id" }
          );
          if (insertErr) {
            console.error("DEBUG: Upsert Failed (full row):", insertErr);
            throw insertErr;
          }
        } else {
          addLog("Phase 2: guest fetch studio_sessions");
          setStatusNote("Room Joined. Waiting in Lobby...");

          let { data: fetched, error: fetchErr } = await supabase
            .from("studio_sessions")
            .select("session_id, offer, answer, ice_candidates, host_user_id")
            .eq("session_id", sessionId.toUpperCase())
            .single<StudioSessionRow>();

          if (fetchErr || !fetched) throw new Error("Room not found.");

          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (user?.id && fetched.host_user_id && user.id === fetched.host_user_id) {
            localMicStreamRef.current?.getTracks().forEach((t) => t.stop());
            localStreamRef.current = null;
            if (localMonitorAudioRef.current) {
              localMonitorAudioRef.current.srcObject = null;
            }
            if (mountedRef.current) {
              setLocalMicStream(null);
              setStatus("failed");
              setStatusNote("You cannot join your own session as a guest.");
              ui.onJoinOwnSessionError("You cannot join your own session as a guest.");
            }
            return;
          }

          existingRowRef.current = fetched;
        }

        if (cancelled || !mountedRef.current) {
          localMicStreamRef.current?.getTracks().forEach((track) => track.stop());
          localStreamRef.current = null;
          if (mountedRef.current) setLocalMicStream(null);
          return;
        }

        // —— Phase 3: Realtime + WebRTC ——
        transportSessionId = sessionId;
        transportActiveRole = activeRole;
        transportIsHost = isHost;
        transportForceRelay = forceRelay;
        studioSessionReservedRef.current = true;
      } finally {
        bridgeInitInFlightRef.current = false;
      }
    };
    initNetworkSessionRef.current = initNetworkSession;

    const init = async () => {
      if (bridgeInitInFlightRef.current) return;
      bridgeInitInFlightRef.current = true;
      let mediaStream: MediaStream | null = null;

      try {
        addLog("Bridge init started (linear)");
        p2pConnectSucceededRef.current = false;
        setError(null);
        setStatusNote("Initializing session...");
        setMicPermissionDenied(false);
        if (cancelled || !mountedRef.current) return;

        // —— Phase 1: mic only. Phase 1b (after success below) reserves room + sessionId for Pre-Flight UI. ——
        setStatusNote("Syncing microphone...");
        micSyncTimeout = window.setTimeout(() => {
          if (!mountedRef.current || cancelled || localStreamRef.current) return;
          setMicSyncTimedOut(true);
          setStatusNote("Microphone sync timed out.");
        }, 5000);

        addLog("Phase 1: getUserMedia (audio only)");
        try {
          if (!mixerMasterDestinationRef.current) {
            mediaStream = await acquireStudioMicStream({ echoSafetyMode });
          } else {
            mediaStream = localStreamRef.current;
          }
        } catch (micErr) {
          console.error(micErr);
          addLog("Microphone blocked or unavailable");
          micDeniedThisInitRef.current = true;
          if (mountedRef.current) {
            setMicPermissionDenied(true);
            if (isMicPermissionDeniedError(micErr)) {
              setStatus("failed");
              setMicSyncTimedOut(false);
              setStatusNote(MIC_ACCESS_DENIED_COPY);
              setMicPermissionHint(MIC_ACCESS_DENIED_COPY);
            } else {
              setMicPermissionHint(
                "Microphone Access Denied. Please click the camera icon in your browser address bar to reset."
              );
              setStatusNote("Microphone Required.");
            }
          }
          if (isMicPermissionDeniedError(micErr)) {
            return;
          }
          throw new Error("Microphone permission is required for the studio bridge.");
        } finally {
          if (micSyncTimeout !== null) {
            clearTimeout(micSyncTimeout);
            micSyncTimeout = null;
          }
        }

        if (cancelled || !mountedRef.current) {
          mediaStream?.getTracks().forEach((track) => track.stop());
          return;
        }

        if (!mediaStream) {
          throw new Error("Microphone stream is unavailable.");
        }
        const audioTracks = mediaStream.getAudioTracks();
        if (audioTracks.length === 0) {
          mediaStream.getTracks().forEach((track) => track.stop());
          throw new Error("Microphone stream has no audio tracks.");
        }
        const deviceId = audioTracks[0]?.getSettings().deviceId || "default";
        activeStreamsMapRef.current.set(deviceId, mediaStream);
        setActiveDeviceIds((prev) => (prev.includes(deviceId) ? prev : [...prev, deviceId]));
        void rebuildMixerAndReplaceTrack();

        micStream = mediaStream;
        if (!mixerMasterDestinationRef.current) {
          localStreamRef.current = mediaStream;
        }
        if (mountedRef.current) {
          setMicSyncTimedOut(false);
          setLocalMicStream(mediaStream);
          void refreshAudioInputDevices();
        }

        const localEl = localMonitorAudioRef.current;
        if (localEl) {
          localEl.srcObject = mediaStream;
          localEl.muted = true;
          await localEl.play().catch(() => {});
        }

        if (cancelled || !mountedRef.current) {
          micStream.getTracks().forEach((track) => track.stop());
          micStream = null;
          localStreamRef.current = null;
          if (mountedRef.current) setLocalMicStream(null);
          return;
        }

        bridgeInitInFlightRef.current = false;
        sessionBootstrapPromiseRef.current = (async () => {
          const boot = initNetworkSessionRef.current;
          if (boot) await boot();
        })();
        try {
          await sessionBootstrapPromiseRef.current;
        } catch (netErr) {
          console.error("Early studio session bootstrap failed:", netErr);
          if (mountedRef.current && !cancelled) {
            setStatusNote(
              "Could not reserve the jam room yet. Check your connection; you can retry when you enter the studio."
            );
          }
        } finally {
          sessionBootstrapPromiseRef.current = null;
        }

      } catch (error) {
        if (cancelled || !mountedRef.current) return;
        console.error("CRITICAL BRIDGE ERROR:", error);
        window.setTimeout(() => {
          if (!mountedRef.current || cancelled) return;
          if (statusRef.current === "connected" || p2pConnectSucceededRef.current) return;
          setStatus((prev) => prev === "connected" ? prev : "failed");
          setError((prev) => prev ?? "Could not initialize studio signaling bridge.");
        }, 1500);
      } finally {
        bridgeInitInFlightRef.current = false;
      }
    };

    const initFrame = requestAnimationFrame(() => {
      void init();
    });

    return () => {
      cancelAnimationFrame(initFrame);
      bridgeInitInFlightRef.current = false;
      bridgeTeardownRef.current = null;
      buildTransportRef.current = null;
      initNetworkSessionRef.current = null;
      startP2PEngineRef.current = null;
      if (!sessionTeardownRanRef.current) {
        runSynchronousHardwareKillSwitch({
          micStream,
          localStreamRef,
          localMicStreamRef,
          remoteStreamRef,
          voipOutgoingDestinationRef,
          localMonitorAudioRef,
          remoteAudioRef,
        });
        void p2pEngineRef.current?.transport.disconnect();
        performTeardown();
      }
    };
  }, [
    beginLostCountdown,
    clearLostCountdown,
    cleanupKiteEngine,
    restoreLiveVoipTrackAfterKite,
    retryInitTick,
    stopKiteMetronome,
    teardownKiteSyncTransport,
  ]);
  const registerMixerMeterElement = useCallback((laneKey: string, el: HTMLDivElement | null) => {
    if (el) {
      perChannelMeterRefs.current.set(laneKey, el);
    } else {
      perChannelMeterRefs.current.delete(laneKey);
    }
  }, []);

  const registerMasterLiveMeterElement = useCallback((el: HTMLDivElement | null) => {
    masterLiveMeterElementRef.current = el;
  }, []);
  const startSoloLooperRunner = startSoloLooper;


  const broadcastKiteSyncStop = useCallback(() => {
    broadcastKiteSync({ kiteSyncEnabled: false });
    setKiteSyncEnabled(false);
    cleanupKiteEngine({ stopLocalTracks: false, isFull: false });
    restoreLiveVoipTrackAfterKite();
    if (remoteStreamRef.current) {
      buildRemotePlaybackGraph(remoteStreamRef.current);
    }
    setBroadcastStatus("idle");
    setKiteSyncCountInActive(false);
    syncInitiatorIdRef.current = null;
    if (mountedRef.current) {
      setSyncInitiatorId(null);
    }
  }, [
    broadcastKiteSync,
    buildRemotePlaybackGraph,
    cleanupKiteEngine,
    restoreLiveVoipTrackAfterKite,
  ]);

  // Resume/re-enable Kite Sync after setup — intentionally does NOT call
  // startP2PIntervalSchedulerRef (that belongs to handleStartBroadcastCountIn initial ignite).
  const toggleKiteSync = useCallback(() => {
    const next = !kiteSyncEnabledRef.current;
    const ownerId =
      ui.getUser()?.id ?? user?.id ?? `${role ?? "unknown"}:${sessionId ?? "local"}`;
    if (next) {
      const ctx = studioAudioContextRef.current;
      if (ctx) {
        flushAndSetRemoteGridTarget(ctx.currentTime + 0.01);
        const countInOneBarSec =
          (60 / metronomeBpmRef.current) *
          Math.max(1, Math.round(kiteSetupTimeSignatureTopRef.current));
        if (Number.isFinite(countInOneBarSec) && countInOneBarSec > 0) {
          kiteSyncCountInEndAtContextSecRef.current = ctx.currentTime + countInOneBarSec;
          if (metronomeGainRef.current) {
            metronomeGainRef.current.gain.value = 0;
          }
          setKiteSyncCountInActive(true);
          kiteSyncCountInActiveRef.current = true;
          kiteSyncCountInCompletionHandledRef.current = false;
        }
      }
      syncInitiatorIdRef.current = ownerId;
      if (mountedRef.current) {
        setSyncInitiatorId(ownerId);
      }
    } else {
      const canControlStop =
        !syncInitiatorIdRef.current || syncInitiatorIdRef.current === ownerId;
      if (!canControlStop) return;
      cleanupKiteEngine({ stopLocalTracks: false, isFull: false });
      restoreLiveVoipTrackAfterKite();
      const remoteStream = remoteStreamRef.current;
      if (remoteStream) {
        buildRemotePlaybackGraph(remoteStream);
      }
      syncInitiatorIdRef.current = null;
      if (mountedRef.current) {
        setSyncInitiatorId(null);
      }
    }
    setKiteSyncEnabled(next);
    setBroadcastStatus(next ? "syncing" : "idle");
    broadcastKiteSync({ kiteSyncEnabled: next });
  }, [cleanupKiteEngine, restoreLiveVoipTrackAfterKite, broadcastKiteSync, ui]);

  const onRemotePlaybackVolumeChangeAction = useCallback(
    (value: number) => {
      if (kiteSyncCountInActive && kiteSyncEnabled) return;
      if (!Number.isFinite(value)) return;
      const clamped = Math.min(
        Math.max(value, REMOTE_PLAYBACK_VOLUME_MIN),
        REMOTE_PLAYBACK_VOLUME_MAX
      );
      remotePlaybackVolumeRef.current = clamped;
      setRemotePlaybackVolume(clamped);
      applyRemotePlaybackSpeakerGain(isSpeakerMuted);
    },
    [applyRemotePlaybackSpeakerGain, isSpeakerMuted, kiteSyncCountInActive, kiteSyncEnabled]
  );

  const onMetronomeVolumeChangeAction = useCallback(
    (value: number) => {
      if (!Number.isFinite(value)) return;
      const clamped = Math.min(2, Math.max(0, value));
      metronomeVolumeRef.current = clamped;
      setMetronomeVolume(clamped);
      const ctx = studioAudioContextRef.current;
      const gainNode = metronomeGainRef.current;
      if (ctx && gainNode && ctx.state !== "closed" && !kiteSyncCountInActive) {
        try {
          gainNode.gain.cancelScheduledValues(ctx.currentTime);
          gainNode.gain.setTargetAtTime(clamped, ctx.currentTime, 0.01);
        } catch {
          /* ignore */
        }
      }
    },
    [kiteSyncCountInActive]
  );

  const startSoloLooperAction = useCallback(async () => {
    const timing = deriveKiteTimingMetadata();
    await startSoloLooperRunner(timing);
  }, [deriveKiteTimingMetadata, startSoloLooperRunner]);

  const engineState = useMemo(
    (): KiteEngineState => ({
    status,
    sessionId,
    role,
    pingMs,
    inboundPacketLossPercent,
    calculatedDelayMs,
    kiteSyncEnabled,
    metronomeBpm,
    beatsPerInterval,
    isVisualMetronomeOnly,
    localMicStream,
    echoSafetyMode,
    isBufferingEnabled,
    isWorkletLoaded,
    bufferDepthFrames,
    targetLeadFrames,
    isAutoBuffer,
    isBufferPrimed,
    lastCorrectionEvent,
    remoteStream,
    remoteMeterTapActive,
    isMicMuted,
    isSpeakerMuted,
    remotePlaybackVolume,
    isRecording,
    audioContextReady,
    audioInputDevices,
    activeDeviceIds,
    deviceVolumes,
    deviceInputChannelCount,
    interfaceInputDeviceFlags,
    interfaceLiveMonitorEnabledFlags,
    kiteSetupTimeSignatureTop,
    kiteSetupTimeSignatureBottom,
    kiteSetupIsSwing,
    kiteSetupChordCount,
    kiteSetupTempo,
    kiteSetupMode,
    kiteMode,
    broadcastStatus,
    jamSetupLock,
    soloLooperState,
    soloActiveRecordTrackIndex,
    isRecordingArmed,
    soloTrackVolumes,
    soloMasterLoopFrames,
    soloLooperLatencyMs,
    soloInputGain,
    soloLatencyCalibrationStatus,
    soloLatencyCalibrationMessage,
    soloLooperMode,
    handsfreeSequenceActive,
    soloLooperBarCount,
    isMasterPaused,
    soloSessionRecorderState,
    kiteSyncCountInActive,
    metronomeVolume,
    retryInitTick,
      kiteIntervalTimingRef,
    }),
    [
      status,
      sessionId,
      role,
      pingMs,
      inboundPacketLossPercent,
      calculatedDelayMs,
      kiteSyncEnabled,
      metronomeBpm,
      beatsPerInterval,
      isVisualMetronomeOnly,
      localMicStream,
      echoSafetyMode,
      isBufferingEnabled,
      isWorkletLoaded,
      bufferDepthFrames,
      targetLeadFrames,
      isAutoBuffer,
      isBufferPrimed,
      lastCorrectionEvent,
      remoteStream,
      remoteMeterTapActive,
      isMicMuted,
      isSpeakerMuted,
      remotePlaybackVolume,
      isRecording,
      audioContextReady,
      audioInputDevices,
      activeDeviceIds,
      deviceVolumes,
      deviceInputChannelCount,
      interfaceInputDeviceFlags,
      interfaceLiveMonitorEnabledFlags,
      kiteSetupTimeSignatureTop,
      kiteSetupTimeSignatureBottom,
      kiteSetupIsSwing,
      kiteSetupChordCount,
      kiteSetupTempo,
      kiteSetupMode,
      kiteMode,
      broadcastStatus,
      jamSetupLock,
      soloLooperState,
      soloActiveRecordTrackIndex,
      isRecordingArmed,
      soloTrackVolumes,
      soloMasterLoopFrames,
      soloLooperLatencyMs,
      soloInputGain,
      soloLatencyCalibrationStatus,
      soloLatencyCalibrationMessage,
      soloLooperMode,
      handsfreeSequenceActive,
      soloLooperBarCount,
      isMasterPaused,
      soloSessionRecorderState,
      kiteSyncCountInActive,
      metronomeVolume,
      retryInitTick,
      kiteIntervalTimingRef,
    ]
  );

  const engineActions = useMemo(
    (): KiteEngineActions => ({
    handleEnterStudio,
    handleEnterSoloStudio,
    confirmEndSession,
    returnToLobby,
    toggleAudioDevice,
    handleVolumeChange,
    setInterfaceInputDeviceFlag,
    setInterfaceLiveMonitorEnabledFlag,
    refreshAudioInputDevices,
    toggleMic,
    toggleSpeaker,
    onRemotePlaybackVolumeChange: onRemotePlaybackVolumeChangeAction,
    onMetronomeVolumeChange: onMetronomeVolumeChangeAction,
    startSoloLooper: startSoloLooperAction,
    handleRecordFirstLoop,
    commitActiveRecording,
    handleAutoCalibrateSoloLatency,
    handleSoloLatencyMsChange,
    handleStopAndResetSoloLooper,
    handleToggleMasterPause,
    handleResetSoloTrack,
    handleArmSoloOverdubTrack,
    onLooperPedalDown: () => onLooperPedalDown(soloPedalTargetTrackIndexRef.current),
    handleTrackTransportTap,
    handleSoloTrackVolumeChange,
    handleToggleSoloSessionRecording,
    downloadSoloSessionBlob,
    handleStartKiteSetup,
    handleCancelKiteSetup,
    handleConfirmKiteSetup,
    handleStartBroadcastCountIn,
    handleTapBeat,
    goToNextKiteSetupStep,
    goToPreviousKiteSetupStep,
    setSoloInputGain,
    setSoloLooperMode,
    setSoloLooperBarCount,
    setKiteSetupTempo,
    setKiteSetupTimeSignatureTop,
    setKiteSetupTimeSignatureBottom,
    setKiteSetupIsSwing,
    setKiteSetupChordCount,
    setIsVisualMetronomeOnly,
    setIsBufferingEnabled,
    setIsAutoBuffer,
    setTargetLeadFrames,
    setEchoSafetyMode,
    setRetryInitTick,
    runAudioTest,
    startLocalRecording,
    stopLocalRecording,
    registerMixerMeterElement,
    registerMasterLiveMeterElement,
    applyPedalFocus,
    dismissHighPingTip,
    broadcastKiteSyncStop,
    toggleKiteSync,
    }),
    [
      handleEnterStudio,
      handleEnterSoloStudio,
      confirmEndSession,
      returnToLobby,
      toggleAudioDevice,
      handleVolumeChange,
      setInterfaceInputDeviceFlag,
      setInterfaceLiveMonitorEnabledFlag,
      refreshAudioInputDevices,
      toggleMic,
      toggleSpeaker,
      onRemotePlaybackVolumeChangeAction,
      onMetronomeVolumeChangeAction,
      startSoloLooperAction,
      handleRecordFirstLoop,
      commitActiveRecording,
      handleAutoCalibrateSoloLatency,
      handleSoloLatencyMsChange,
      handleStopAndResetSoloLooper,
      handleToggleMasterPause,
      handleResetSoloTrack,
      handleArmSoloOverdubTrack,
      onLooperPedalDown,
      handleTrackTransportTap,
      handleSoloTrackVolumeChange,
      handleToggleSoloSessionRecording,
      downloadSoloSessionBlob,
      handleStartKiteSetup,
      handleCancelKiteSetup,
      handleConfirmKiteSetup,
      handleStartBroadcastCountIn,
      handleTapBeat,
      goToNextKiteSetupStep,
      goToPreviousKiteSetupStep,
      setSoloInputGain,
      setSoloLooperMode,
      setSoloLooperBarCount,
      setKiteSetupTempo,
      setKiteSetupTimeSignatureTop,
      setKiteSetupTimeSignatureBottom,
      setKiteSetupIsSwing,
      setKiteSetupChordCount,
      setIsVisualMetronomeOnly,
      setIsBufferingEnabled,
      setIsAutoBuffer,
      setTargetLeadFrames,
      setEchoSafetyMode,
      setRetryInitTick,
      runAudioTest,
      startLocalRecording,
      stopLocalRecording,
      registerMixerMeterElement,
      registerMasterLiveMeterElement,
      applyPedalFocus,
      dismissHighPingTip,
      broadcastKiteSyncStop,
      toggleKiteSync,
    ]
  );

  const engineRefs = useMemo(
    (): KiteEngineRefs => ({
    remoteAudioRef,
    localMonitorAudioRef,
    metronomeBlinkElementRef,
    soloMeterElementRef,
    perChannelMeterRefs,
    masterLiveMeterElementRef,
    }),
    [
      remoteAudioRef,
      localMonitorAudioRef,
      metronomeBlinkElementRef,
      soloMeterElementRef,
      perChannelMeterRefs,
      masterLiveMeterElementRef,
    ]
  );

  const presenterState = useMemo(
    (): KitePresenterState => ({
    statusNote,
    bridgeInitError,
    inviteLink,
    highPingTipOpen,
    visualActiveBeatInBar,
    micPermissionDenied,
    micPermissionHint,
    micSyncTimedOut,
    audioTestDone,
    audioTestPlaying,
    audioTestFailed,
    kiteSignal,
    studioUiPhase,
    roomCopyNote,
    remoteLevel,
    remoteMeterHeights,
    remoteMeterRafKey,
    recordingTimeMs,
    recordedBlobUrl,
    recordedDownloadExt,
    confirmExitOpen,
    collaboratorLeft,
    remoteParticipantName,
    lastDepartedParticipantName,
    connectionLostCountdown,
    user,
    authReady,
    kiteSetupStep,
    kiteSetupUsesCustomChords,
    kiteSetupOrigin,
    kiteSetupError,
    loopProgress,
    recordingArmedCountdown,
    soloRunwayDisplay,
    soloTrackSlotUi,
    focusedTrackIndex,
    soloOverdubArmedTrackIndex,
    syncInitiatorId,
    kiteSyncNetworkMetronomePaused,
    }),
    [
      statusNote,
      bridgeInitError,
      inviteLink,
      highPingTipOpen,
      visualActiveBeatInBar,
      micPermissionDenied,
      micPermissionHint,
      micSyncTimedOut,
      audioTestDone,
      audioTestPlaying,
      audioTestFailed,
      kiteSignal,
      studioUiPhase,
      roomCopyNote,
      remoteLevel,
      remoteMeterHeights,
      remoteMeterRafKey,
      recordingTimeMs,
      recordedBlobUrl,
      recordedDownloadExt,
      confirmExitOpen,
      collaboratorLeft,
      remoteParticipantName,
      lastDepartedParticipantName,
      connectionLostCountdown,
      user,
      authReady,
      kiteSetupStep,
      kiteSetupUsesCustomChords,
      kiteSetupOrigin,
      kiteSetupError,
      loopProgress,
      recordingArmedCountdown,
      soloRunwayDisplay,
      soloTrackSlotUi,
      focusedTrackIndex,
      soloOverdubArmedTrackIndex,
      syncInitiatorId,
      kiteSyncNetworkMetronomePaused,
    ]
  );

  const presenterActions = useMemo(
    (): KitePresenterActions => ({
      setConfirmExitOpen,
      setRoomCopyNote,
      setStatusNote,
      setKiteSetupUsesCustomChords,
      setKiteSetupMode,
    }),
    [setConfirmExitOpen, setRoomCopyNote, setStatusNote, setKiteSetupUsesCustomChords, setKiteSetupMode]
  );

  const engineLegacy = useMemo(
    (): KiteEngineLegacyApi => ({
    broadcastWizardStudioParam,
    sendJamSetupLock,
    studioAudioContextRef: studioAudioContextRef as MutableRefObject<AudioContext | null>,
    activeStreamsMapRef: activeStreamsMapRef as MutableRefObject<Map<string, MediaStream>>,
    setAudioContextReady,
    setMetronomeBpm,
    broadcastStudioParam,
    getStudioKiteSampleRate,
    clearRecordedBlobUrl,
    }),
    [
      broadcastWizardStudioParam,
      sendJamSetupLock,
      studioAudioContextRef,
      activeStreamsMapRef,
      setAudioContextReady,
      setMetronomeBpm,
      broadcastStudioParam,
      getStudioKiteSampleRate,
      clearRecordedBlobUrl,
    ]
  );

  return { engineState, engineActions, engineRefs, presenterState, presenterActions, engineLegacy };

}
