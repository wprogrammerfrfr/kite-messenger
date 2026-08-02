"use client";

import type { MutableRefObject, RefObject } from "react";
import type { User } from "@supabase/supabase-js";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { KiteIntervalTiming } from "@/lib/kite-interval-math";
import type { RunwayDisplayLabel } from "@/lib/looper-runway-scheduler";
import type { SoloLooperPlaybackUiStateEvent } from "@/lib/solo-looper-engine";
import type { BridgeStatus, Role } from "@/lib/p2p/transport-port";
import type {
  KiteSessionChatMessage,
  KiteChatDataPayload,
} from "@/lib/p2p/kite-chat-message-types";
import type { KiteMode } from "@/hooks/useKiteSyncEngine";

export type SoloLooperMode = "free" | "grid" | "handsfree";

/** Studio bridge UI phase — stays in page presenter; engine reads via config. */
export type StudioUiPhase = "lobby" | "connecting" | "studio" | "kite-setup";

export type KiteSetupStep = 1 | 2 | 3 | 4 | 5;
export type BroadcastStatus = "idle" | "connecting" | "syncing" | "live";
export type SoloLooperState = "idle" | "recording" | "captured" | "playing";
export type SoloSessionRecorderState = "idle" | "recording" | "paused" | "saving";
export type JamSetupLock = { ownerId: string; ownerName: string; expiresAt: number } | null;
export type KiteSetupOrigin = "lobby" | "connected";

/** Guided RTL Calibration Wizard phases (UI + controller). */
export type GuidedRtlWizardPhase =
  | "idle"
  | "metronome"
  | "countdown"
  | "capturing"
  | "transition"
  | "adjusting"
  | "confirming"
  | "error";

export type GuidedRtlWizardState = {
  phase: GuidedRtlWizardPhase;
  /** Draft slider value while adjusting; committed only on confirm. */
  draftLatencyMs: number;
  /** Last committed/persisted value restored on cancel. */
  committedLatencyMs: number;
  message: string | null;
  error: string | null;
  open: boolean;
  /** 4…1 during count-in; null when not counting. */
  countdownBeatRemaining: number | null;
  /** 0…1 capture fill while recording claps. */
  captureProgress01: number;
  /** 1…4 while capturing; null otherwise. */
  captureBeatIndex: number | null;
};
export type DeviceFlagMap = Record<string, boolean>;

/**
 * Read-only Kite Sync readiness UI (display only — never used for transport).
 * Cold fields may live in React state (phase flips only).
 * Hot fields live on a ref and are consumed by RAF/DOM — never setState per tick.
 */
export type KiteSyncReadinessPhase = "idle" | "incoming" | "count-in" | "live";

/** React-owned cold readiness — re-render only on idle ↔ count-in ↔ incoming ↔ live (and leader flips). */
export type KiteSyncReadinessPhaseState = {
  phase: KiteSyncReadinessPhase;
  /** True when local peer initiated the current sync. */
  isLocalLeader: boolean;
};

/**
 * High-frequency readiness telemetry written only to a ref.
 * Display-only; never used for transport timing.
 */
export type KiteSyncReadinessHotSnapshot = {
  /** Beats left in the one-bar count-in; null when not counting in. */
  countdownBeatRemaining: number | null;
  /** 0…1 progress through the count-in bar; null when not counting in. */
  countInProgress01: number | null;
  /** 0…1 peer-audio arrive progress; null when not in incoming phase. */
  audioArriveProgress01: number | null;
  /** Seconds until peer audio unlock (display); null outside incoming. */
  audioArriveRemainingSec: number | null;
  /** 1-based bar index within the loop; null when not live. */
  loopBarIndex: number | null;
  /** Beat within bar (0 = downbeat); null when not live. */
  loopBeatInBar: number | null;
  /** 0…1 progress through the full loop; null when not live. */
  loopProgress01: number | null;
};

export const KITE_SYNC_READINESS_PHASE_IDLE: KiteSyncReadinessPhaseState = {
  phase: "idle",
  isLocalLeader: false,
};

export const KITE_SYNC_READINESS_HOT_IDLE: KiteSyncReadinessHotSnapshot = {
  countdownBeatRemaining: null,
  countInProgress01: null,
  audioArriveProgress01: null,
  audioArriveRemainingSec: null,
  loopBarIndex: null,
  loopBeatInBar: null,
  loopProgress01: null,
};

/** @deprecated Prefer PhaseState + HotSnapshot split. Kept for transitional imports. */
export type KiteSyncReadinessState = KiteSyncReadinessPhaseState & KiteSyncReadinessHotSnapshot;

/** @deprecated Prefer KITE_SYNC_READINESS_PHASE_IDLE + HOT_IDLE. */
export const KITE_SYNC_READINESS_IDLE: KiteSyncReadinessState = {
  ...KITE_SYNC_READINESS_PHASE_IDLE,
  ...KITE_SYNC_READINESS_HOT_IDLE,
};

export type KiteLoopChunkSendProgress = {
  status: "idle" | "sending" | "sent" | "error";
  sentChunks: number;
  totalChunks: number;
};

/** All engine-owned React state exposed to the UI shell. */
export type KiteEngineState = {
  status: BridgeStatus;
  sessionId: string | null;
  role: Role | null;
  pingMs: number | null;
  inboundPacketLossPercent: number | null;
  calculatedDelayMs: number | null;
  kiteSyncEnabled: boolean;
  metronomeBpm: number;
  beatsPerInterval: number;
  isVisualMetronomeOnly: boolean;
  localMicStream: MediaStream | null;
  echoSafetyMode: boolean;
  isBufferingEnabled: boolean;
  isWorkletLoaded: boolean;
  bufferDepthFrames: number;
  targetLeadFrames: number;
  isAutoBuffer: boolean;
  isBufferPrimed: boolean;
  lastCorrectionEvent: "drop" | "dupe" | "none";
  remoteStream: MediaStream | null;
  remoteMeterTapActive: boolean;
  isMicMuted: boolean;
  isSpeakerMuted: boolean;
  remotePlaybackVolume: number;
  isRecording: boolean;
  audioContextReady: boolean;
  audioInputDevices: MediaDeviceInfo[];
  activeDeviceIds: string[];
  deviceVolumes: Record<string, number>;
  deviceInputChannelCount: Record<string, 1 | 2>;
  interfaceInputDeviceFlags: DeviceFlagMap;
  interfaceLiveMonitorEnabledFlags: DeviceFlagMap;
  kiteSetupTimeSignatureTop: number;
  kiteSetupTimeSignatureBottom: number;
  kiteSetupIsSwing: boolean;
  kiteSetupChordCount: number;
  kiteSetupTempo: number;
  kiteSetupMode: KiteMode;
  kiteMode: KiteMode;
  broadcastStatus: BroadcastStatus;
  jamSetupLock: JamSetupLock;
  soloLooperState: SoloLooperState;
  /** Track index 1–4 actively capturing input; mirrors soloLooperActiveRecordTrackIndexRef (engine-authoritative, no RAF lag). */
  soloActiveRecordTrackIndex: number | null;
  isRecordingArmed: boolean;
  soloTrackVolumes: [number, number, number, number];
  /** Master loop playback volume (0–1); does not affect live mic monitoring. */
  masterLoopVolume: number;
  soloMasterLoopFrames: number | null;
  soloLooperLatencyMs: number;
  soloInputGain: number;
  soloLatencyCalibrationStatus: "idle" | "warning" | "listening" | "success" | "error";
  soloLatencyCalibrationMessage: string | null;
  /** True when saved RTL fingerprint no longer matches live audio hardware. */
  soloLatencyCalibrationStale: boolean;
  soloLatencyStaleMessage: string | null;
  /** Unclamped ms from last auto-calibration (entry gate + lobby quality feedback). */
  soloLatencyLastRawMeasuredMs: number | null;
  /** True when Windows RTL floor was applied to the last calibration result. */
  soloLatencyFloorApplied: boolean;
  /** Guided RTL Calibration Wizard controller state. */
  guidedRtlWizard: GuidedRtlWizardState;
  soloLooperMode: SoloLooperMode;
  /** Handsfree Assist: one full loop between takes when true; immediate handoff when false. */
  handsfreeAssist: boolean;
  /** True while worklet is auto-advancing T1→T4; used for UI disabled states. */
  handsfreeSequenceActive: boolean;
  /** Per-track bar counts (1–4 lanes); global BPM/time signature apply. */
  soloTrackBarCounts: [number, number, number, number];
  /** Locked after each track's first LOOP_READY — prevents mid-playback length edits. */
  soloTrackBarCountsLocked: [boolean, boolean, boolean, boolean];
  isMasterPaused: boolean;
  soloSessionRecorderState: SoloSessionRecorderState;
  kiteSyncCountInActive: boolean;
  /**
   * When true, count-in metronome clicks bypass the muted gain node and play
   * audibly (routing only). Default true — musicians hear the count-in.
   */
  audibleSyncCountIn: boolean;
  /**
   * Cold readiness phase for V2 overlay (React). Hot beat/progress lives on
   * `engineRefs.kiteSyncReadinessHotRef` — display only, never transport.
   */
  kiteSyncReadinessPhase: KiteSyncReadinessPhaseState;
  metronomeVolume: number;
  retryInitTick: number;
  /** Live timing ref for looper UI (not React state). */
  kiteIntervalTimingRef: MutableRefObject<KiteIntervalTiming | null>;
};

/** Minimal UI callbacks the engine still delegates to the presenter shell. */
export type KiteEngineUiConfig = {
  getUser: () => User | null;
  confirmResetTrack: (trackIndex: 1 | 2 | 3 | 4) => boolean;
  onJoinOwnSessionError: (message: string) => void;
};

/** Config passed from page.tsx into the headless engine hook. */
export type KiteEngineConfig = {
  router: AppRouterInstance;
  ui: KiteEngineUiConfig;
  /** Initial session id from URL (optional). */
  initialSessionId?: string | null;
  onAuthUserChange?: (user: User | null) => void;
  onAuthReadyChange?: (ready: boolean) => void;
};

/** DOM-bridge refs the UI shell must attach to hidden audio elements / meter drivers. */
export type KiteEngineRefs = {
  remoteAudioRef: MutableRefObject<HTMLAudioElement | null>;
  localMonitorAudioRef: MutableRefObject<HTMLAudioElement | null>;
  metronomeBlinkElementRef: MutableRefObject<HTMLDivElement | null>;
  soloMeterElementRef: MutableRefObject<HTMLDivElement | null>;
  perChannelMeterRefs: MutableRefObject<Map<string, HTMLDivElement>>;
  masterLiveMeterElementRef: MutableRefObject<HTMLDivElement | null>;
  /** Worklet slot snapshot for ref-driven lane progress (see timing drift audit). */
  soloTrackSlotUiLatestRef: MutableRefObject<
    import("@/lib/solo-looper-engine").SoloLooperPlaybackUiStateEvent["slots"] | null
  >;
  /**
   * High-frequency sync readiness telemetry (display only — never transport).
   * Mutated on metronome ticks; consumed by overlay RAF — not React state.
   */
  kiteSyncReadinessHotRef: MutableRefObject<KiteSyncReadinessHotSnapshot>;
};

/** P2P session chat transport surface (Phase A — UI consumes via useKiteSessionChat). */
export type KiteSessionChatPort = {
  subscribe: (handler: (msg: KiteSessionChatMessage) => void) => () => void;
  sendMessage: (text: string) => KiteChatDataPayload | null;
};

export type UseKiteSessionChatOptions = {
  enabled: boolean;
  sessionId: string | null;
  chatReady: boolean;
  port: KiteSessionChatPort;
};

export type UseKiteSessionChatResult = {
  messages: KiteSessionChatMessage[];
  sendMessage: (text: string) => void;
  clearMessages: () => void;
};

/** Legacy dashboard handlers/refs still referenced by presenter JSX (Phase 8 bridge). */
export type KiteEngineLegacyApi = {
  broadcastWizardStudioParam: (patch: Record<string, number>) => void;
  sendJamSetupLock: (action: "acquire" | "release") => boolean;
  studioAudioContextRef: MutableRefObject<AudioContext | null>;
  activeStreamsMapRef: MutableRefObject<Map<string, MediaStream>>;
  setAudioContextReady: (v: boolean) => void;
  setMetronomeBpm: (updater: number | ((prev: number) => number)) => void;
  broadcastStudioParam: (patch: Record<string, number>) => void;
  getStudioKiteSampleRate: () => number;
  clearRecordedBlobUrl: () => void;
};

/** Commands the UI shell sends to the engine. */
export type KiteEngineActions = {
  handleEnterStudio: () => void;
  handleEnterSoloStudio: () => void;
  confirmEndSession: () => void;
  returnToLobby: () => void;
  toggleAudioDevice: (deviceId: string) => void;
  registerVirtualInputStream: (deviceId: string, stream: MediaStream) => Promise<void>;
  unregisterVirtualInputStream: (deviceId: string) => Promise<void>;
  handleVolumeChange: (laneKey: string, value: number) => void;
  setInterfaceInputDeviceFlag: (deviceId: string, isInterface: boolean) => void;
  setInterfaceLiveMonitorEnabledFlag: (deviceId: string, enabled: boolean) => void;
  refreshAudioInputDevices: () => Promise<void>;
  toggleMic: () => void;
  toggleSpeaker: () => void;
  onRemotePlaybackVolumeChange: (value: number) => void;
  onMetronomeVolumeChange: (value: number) => void;
  startSoloLooper: () => Promise<void>;
  handleRecordFirstLoop: () => void;
  commitActiveRecording: () => void;
  handleSoloLatencyMsChange: (ms: number) => void;
  /** Open guided RTL wizard (auto-starts metronome when safe). */
  beginGuidedRtlWizard: () => void;
  /** Start four-beat clap capture into the dedicated worklet buffer. */
  startGuidedRtlCapture: () => void;
  /** Live draft preview while adjusting (does not persist). */
  previewGuidedRtlLatencyMs: (ms: number) => void;
  /** Persist draft RTL, fingerprint hardware, and dismiss wizard. */
  confirmGuidedRtlWizard: () => void;
  /** Discard draft, restore committed RTL, stop metronome/preview, dismiss. */
  cancelGuidedRtlWizard: () => void;
  /** Re-record four claps without leaving the wizard. */
  retryGuidedRtlCapture: () => void;
  handleStopAndResetSoloLooper: () => void;
  handleToggleMasterPause: () => void;
  handleResetSoloTrack: (trackIndex: 1 | 2 | 3 | 4) => void;
  handleArmSoloOverdubTrack: (trackIndex: 2 | 3 | 4) => void;
  onLooperPedalDown: () => void;
  handleTrackTransportTap: (trackIndex: 1 | 2 | 3 | 4) => void;
  handleSoloTrackVolumeChange: (trackIndex: 1 | 2 | 3 | 4, linear: number) => void;
  setMasterLoopVolume: (linear: number) => void;
  handleToggleSoloSessionRecording: () => void;
  downloadSoloSessionBlob: (blob: Blob, ext: string) => void;
  handleStartKiteSetup: (origin: KiteSetupOrigin, mode?: KiteMode) => void;
  handleCancelKiteSetup: () => void;
  handleConfirmKiteSetup: () => Promise<void>;
  handleStartBroadcastCountIn: () => Promise<void>;
  handleTapBeat: () => void;
  goToNextKiteSetupStep: () => void;
  goToPreviousKiteSetupStep: () => void;
  setSoloInputGain: (gain: number) => void;
  setSoloLooperMode: (mode: SoloLooperMode) => void;
  setHandsfreeAssist: (on: boolean) => void;
  setSoloTrackBarCount: (trackIndex: 1 | 2 | 3 | 4, bars: number) => void;
  setKiteSetupTempo: (bpm: number) => void;
  setKiteSetupTimeSignatureTop: (top: number) => void;
  setKiteSetupTimeSignatureBottom: (bottom: number) => void;
  setKiteSetupIsSwing: (swing: boolean) => void;
  setKiteSetupChordCount: (count: number) => void;
  setIsVisualMetronomeOnly: (v: boolean) => void;
  setIsBufferingEnabled: (v: boolean) => void;
  setIsAutoBuffer: (v: boolean) => void;
  setTargetLeadFrames: (frames: number) => void;
  setEchoSafetyMode: (v: boolean) => void;
  /** Toggle audible count-in clicks during Kite Sync (routing preference). */
  setAudibleSyncCountIn: (v: boolean) => void;
  setRetryInitTick: (updater: (tick: number) => number) => void;
  runAudioTest: () => Promise<void>;
  startLocalRecording: () => void;
  stopLocalRecording: () => void;
  registerMixerMeterElement: (laneKey: string, el: HTMLDivElement | null) => void;
  registerMasterLiveMeterElement: (el: HTMLDivElement | null) => void;
  applyPedalFocus: (trackIndex: 1 | 2 | 3 | 4) => void;
  dismissHighPingTip: () => void;
  broadcastKiteSyncStop: () => void;
  toggleKiteSync: () => void;
};

/** UI-adjacent state owned by the engine hook but consumed by the page presenter shell. */
export type KitePresenterState = {
  statusNote: string;
  bridgeInitError: string | null;
  inviteLink: string | null;
  highPingTipOpen: boolean;
  visualActiveBeatInBar: 0 | 1 | 2 | 3 | null;
  micPermissionDenied: boolean;
  micPermissionHint: string | null;
  micSyncTimedOut: boolean;
  audioTestDone: boolean;
  audioTestPlaying: boolean;
  audioTestFailed: boolean;
  kiteSignal: "checking" | "secure" | "offline" | "error";
  studioUiPhase: StudioUiPhase;
  roomCopyNote: string | null;
  remoteLevel: number;
  remoteMeterHeights: number[];
  remoteMeterRafKey: number;
  recordingTimeMs: number;
  recordedBlobUrl: string | null;
  recordedDownloadExt: "webm" | "m4a" | "aac" | "bin";
  confirmExitOpen: boolean;
  collaboratorLeft: boolean;
  remoteParticipantName: string | null;
  lastDepartedParticipantName: string | null;
  connectionLostCountdown: number | null;
  user: User | null;
  authReady: boolean;
  kiteSetupStep: KiteSetupStep;
  kiteSetupUsesCustomChords: boolean;
  kiteSetupOrigin: KiteSetupOrigin;
  kiteSetupError: string | null;
  loopProgress: number;
  recordingArmedCountdown: number | null;
  soloRunwayDisplay: RunwayDisplayLabel | null;
  soloTrackSlotUi: SoloLooperPlaybackUiStateEvent["slots"] | null;
  focusedTrackIndex: 1 | 2 | 3 | 4;
  soloOverdubArmedTrackIndex: number | null;
  syncInitiatorId: string | null;
  kiteSyncNetworkMetronomePaused: boolean;
  /** True when the dedicated kite-chat-channel RTCDataChannel is open. */
  kiteChatReady: boolean;
};

export type KitePresenterActions = {
  setConfirmExitOpen: (open: boolean) => void;
  setRoomCopyNote: (note: string | null) => void;
  setStatusNote: (note: string) => void;
  setKiteSetupUsesCustomChords: (value: boolean) => void;
  setKiteSetupMode: (mode: KiteMode) => void;
};

export type UseKiteStudioEngineResult = {
  engineState: KiteEngineState;
  engineActions: KiteEngineActions;
  engineRefs: KiteEngineRefs;
  presenterState: KitePresenterState;
  presenterActions: KitePresenterActions;
  engineLegacy: KiteEngineLegacyApi;
  sessionChatPort: KiteSessionChatPort;
};
