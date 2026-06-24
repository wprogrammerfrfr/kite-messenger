"use client";

import type { MutableRefObject, RefObject } from "react";
import type { User } from "@supabase/supabase-js";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { KiteIntervalTiming } from "@/lib/kite-interval-math";
import type { RunwayDisplayLabel } from "@/lib/looper-runway-scheduler";
import type { SoloLooperPlaybackUiStateEvent } from "@/lib/solo-looper-engine";
import type { BridgeStatus, Role } from "@/lib/p2p/transport-port";
import type { KiteMode } from "@/hooks/useKiteSyncEngine";
import type { SoloLooperMode } from "@/components/kite-loop-v2/KiteLoopV2Panel";

/** Studio bridge UI phase — stays in page presenter; engine reads via config. */
export type StudioUiPhase = "lobby" | "connecting" | "studio" | "kite-setup";

export type KiteSetupStep = 1 | 2 | 3 | 4 | 5;
export type BroadcastStatus = "idle" | "connecting" | "syncing" | "live";
export type SoloLooperState = "idle" | "recording" | "captured" | "playing";
export type SoloSessionRecorderState = "idle" | "recording" | "paused" | "saving";
export type JamSetupLock = { ownerId: string; ownerName: string; expiresAt: number } | null;
export type KiteSetupOrigin = "lobby" | "connected";
export type DeviceFlagMap = Record<string, boolean>;

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
  isRecordingArmed: boolean;
  soloTrackVolumes: [number, number, number, number];
  soloMasterLoopFrames: number | null;
  soloLooperLatencyMs: number;
  soloInputGain: number;
  soloLatencyCalibrationStatus: "idle" | "warning" | "listening" | "success" | "error";
  soloLatencyCalibrationMessage: string | null;
  soloLooperMode: SoloLooperMode;
  soloLooperBarCount: number;
  isMasterPaused: boolean;
  soloSessionRecorderState: SoloSessionRecorderState;
  kiteSyncCountInActive: boolean;
  metronomeVolume: number;
  retryInitTick: number;
  /** Live timing ref for looper UI (not React state). */
  kiteIntervalTimingRef: MutableRefObject<KiteIntervalTiming | null>;
};

/** UI-only callbacks the engine invokes when it must update presenter state. */
export type KiteEngineUiCallbacks = {
  setStudioUiPhase: (phase: StudioUiPhase) => void;
  setStatusNote: (note: string) => void;
  setBridgeInitError: (error: string | null) => void;
  setInviteLink: (url: string | null) => void;
  setCollaboratorLeft: (left: boolean) => void;
  setLastDepartedParticipantName: (name: string | null) => void;
  setRemoteParticipantName: (name: string | null) => void;
  setConnectionLostCountdown: (sec: number | null) => void;
  setLoopProgress: (pct: number) => void;
  setSoloRunwayDisplay: (label: RunwayDisplayLabel | null) => void;
  setSoloTrackSlotUi: (slots: SoloLooperPlaybackUiStateEvent["slots"] | null) => void;
  setRecordingArmedCountdown: (sec: number | null) => void;
  setFocusedTrackIndex: (index: 1 | 2 | 3 | 4) => void;
  setSoloOverdubArmedTrackIndex: (index: number | null) => void;
  setSyncInitiatorId: (id: string | null) => void;
  setKiteSyncNetworkMetronomePaused: (paused: boolean) => void;
  setVisualActiveBeatInBar: (beat: 0 | 1 | 2 | 3 | null) => void;
  setRemoteMeterRafKey: (updater: (key: number) => number) => void;
  setRemoteLevel: (level: number) => void;
  setRemoteMeterHeights: (heights: number[]) => void;
  setLoopChunkSendError: (error: string | null) => void;
  setLoopChunkSendProgress: (progress: KiteLoopChunkSendProgress) => void;
  setKiteSetupError: (error: string | null) => void;
  setKiteSetupStep: (step: KiteSetupStep) => void;
  setKiteSetupOrigin: (origin: KiteSetupOrigin) => void;
  setKiteSetupUsesCustomChords: (v: boolean) => void;
  setRecordingTimeMs: (ms: number) => void;
  setRecordedBlobUrl: (url: string | null) => void;
  setRecordedDownloadExt: (ext: "webm" | "m4a" | "aac" | "bin") => void;
  setHighPingTipOpen: (open: boolean) => void;
  getStudioUiPhase: () => StudioUiPhase;
  getUser: () => User | null;
  getAuthReady: () => boolean;
  getKiteSetupOrigin: () => KiteSetupOrigin;
  getConfirmExitOpen: () => boolean;
  setConfirmExitOpen: (open: boolean) => void;
};

/** Config passed from page.tsx into the headless engine hook. */
export type KiteEngineConfig = {
  router: AppRouterInstance;
  ui: KiteEngineUiCallbacks;
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
};

/** Legacy dashboard handlers/refs still referenced by presenter JSX (Phase 8 bridge). */
export type KiteEngineLegacyApi = {
  broadcastWizardStudioParam: (patch: Record<string, number>) => void;
  sendJamSetupLock: (action: "acquire" | "release") => boolean;
  studioAudioContextRef: MutableRefObject<AudioContext | null>;
  flushAndSetRemoteGridTarget: (targetTimeSec: number | null) => void;
  cleanupKiteEngine: (opts: { stopLocalTracks: boolean; isFull: boolean }) => void;
  restoreLiveVoipTrackAfterKite: () => void;
  buildRemotePlaybackGraph: (stream: MediaStream) => void;
  broadcastKiteSync: (opts: { kiteSyncEnabled: boolean }) => void;
  setKiteSyncEnabled: (v: boolean) => void;
  setBroadcastStatus: (v: BroadcastStatus) => void;
  setSyncInitiatorId: (id: string | null) => void;
  setKiteSyncCountInActive: (v: boolean) => void;
  setAudioContextReady: (v: boolean) => void;
  setMetronomeBpm: (updater: number | ((prev: number) => number)) => void;
  broadcastStudioParam: (patch: Record<string, number>) => void;
  getStudioKiteSampleRate: () => number;
  clearRecordedBlobUrl: () => void;
  remoteStreamRef: MutableRefObject<MediaStream | null>;
  metronomeGainRef: MutableRefObject<GainNode | null>;
  kiteSyncCountInEndAtContextSecRef: MutableRefObject<number>;
  syncInitiatorIdRef: MutableRefObject<string | null>;
  mountedRef: MutableRefObject<boolean>;
  kiteSyncCountInActiveRef: MutableRefObject<boolean>;
  kiteSyncCountInCompletionHandledRef: MutableRefObject<boolean>;
  ensureStudioAudioContext: () => AudioContext;
  rebuildMixerAndReplaceTrack: () => Promise<void>;
};

/** Commands the UI shell sends to the engine. */
export type KiteEngineActions = {
  handleEnterStudio: () => void;
  handleEnterSoloStudio: () => void;
  confirmEndSession: () => void;
  returnToLobby: () => void;
  toggleAudioDevice: (deviceId: string) => void;
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
  handleAutoCalibrateSoloLatency: (mode: "acoustic" | "interface") => void;
  handleSoloLatencyMsChange: (ms: number) => void;
  handleStopAndResetSoloLooper: () => void;
  handleToggleMasterPause: () => void;
  handleResetSoloTrack: (trackIndex: 1 | 2 | 3 | 4) => void;
  handleArmSoloOverdubTrack: (trackIndex: 2 | 3 | 4) => void;
  onLooperPedalDown: () => void;
  handleSoloTrackVolumeChange: (trackIndex: 1 | 2 | 3 | 4, linear: number) => void;
  handleToggleSoloSessionRecording: () => void;
  downloadSoloSessionBlob: (blob: Blob, ext: string) => void;
  handleStartKiteSetup: (origin: KiteSetupOrigin, mode?: KiteMode) => void;
  handleCancelKiteSetup: () => void;
  handleConfirmKiteSetup: () => void;
  handleStartBroadcastCountIn: () => void;
  handleTapBeat: () => void;
  goToNextKiteSetupStep: () => void;
  goToPreviousKiteSetupStep: () => void;
  setSoloInputGain: (gain: number) => void;
  setSoloLooperMode: (mode: SoloLooperMode) => void;
  setSoloLooperBarCount: (bars: number) => void;
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
  setRetryInitTick: (updater: (tick: number) => number) => void;
  runAudioTest: () => Promise<void>;
  startLocalRecording: () => void;
  stopLocalRecording: () => void;
  registerMixerMeterElement: (laneKey: string, el: HTMLDivElement | null) => void;
  registerMasterLiveMeterElement: (el: HTMLDivElement | null) => void;
  applyPedalFocus: (trackIndex: 1 | 2 | 3 | 4) => void;
  dismissHighPingTip: () => void;
  broadcastKiteSyncStop: () => void;
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
  devicePanelOpen: boolean;
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
  loopChunkSendError: string | null;
  loopChunkSendProgress: KiteLoopChunkSendProgress;
  syncInitiatorId: string | null;
  kiteSyncNetworkMetronomePaused: boolean;
  useV4LooperUi: boolean;
};

export type KitePresenterActions = {
  setConfirmExitOpen: (open: boolean) => void;
  setRoomCopyNote: (note: string | null) => void;
  setDevicePanelOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
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
};
