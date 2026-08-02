/**
 * Ports contract for the P2P Jam presenter.
 * Zero engine imports — adapters (dummy or live) supply this shape.
 */

import type { MutableRefObject, RefObject } from "react";

export type P2PJamWizardTimeSignature = "4/4" | "3/4" | "6/8" | "custom";
export type P2PJamWizardBarCount = 1 | 2 | 4 | 8 | "custom";

export type P2PJamWizardState = {
  step: 1 | 2 | 3 | 4 | 5;
  bpm: number;
  metronomeVolume: number; // 0–100 UI scale
  timeSignature: P2PJamWizardTimeSignature;
  customTop: number;
  customBottom: number;
  barCount: P2PJamWizardBarCount;
  customBars: number;
};

export type P2PJamActiveSnapshot = {
  bpm: number;
  bars: number;
  timeSignature: string;
  metronomeVolume: number;
  loopSec: number;
};

export type P2PJamSettingsState = {
  outputDeviceId: string;
  micMuted: boolean;
  speakerMuted: boolean;
  peerVolume: number; // 0–200 (%)
  autoBuffer: boolean;
  targetLeadFrames: number;
  bufferingEnabled: boolean;
  echoSafetyMode: boolean;
  metronomeBpm: number;
  metronomeVolume: number; // 0–100 UI
  visualMetronomeOnly: boolean;
};

export type P2PJamInputDevice = {
  id: string;
  label: string;
  channels: 1 | 2;
};

export type P2PJamInputPanelState = {
  devices: P2PJamInputDevice[];
  activeIds: string[];
  focusedId: string | null;
  gains: Record<string, number>;
  interfaceFlags: Record<string, boolean>;
  liveMonitorFlags: Record<string, boolean>;
};

export type P2PJamChatMessage = {
  id: string;
  text: string;
  isLocal: boolean;
  receivedAt: number;
};

/**
 * Read-only Kite Sync readiness for V2 overlay (mirrors engine cold/hot split).
 * Display only — never used for transport timing.
 */
export type P2PJamSyncReadinessPhase = "idle" | "incoming" | "count-in" | "live";

export type P2PJamSyncReadinessHotSnapshot = {
  countdownBeatRemaining: number | null;
  countInProgress01: number | null;
  /** 0…1 peer-audio arrive progress; null outside incoming. */
  audioArriveProgress01: number | null;
  /** Seconds until peer audio unlock (display); null outside incoming. */
  audioArriveRemainingSec: number | null;
  loopBarIndex: number | null;
  loopBeatInBar: number | null;
  loopProgress01: number | null;
};

export const P2P_JAM_SYNC_READINESS_HOT_IDLE: P2PJamSyncReadinessHotSnapshot = {
  countdownBeatRemaining: null,
  countInProgress01: null,
  audioArriveProgress01: null,
  audioArriveRemainingSec: null,
  loopBarIndex: null,
  loopBeatInBar: null,
  loopProgress01: null,
};

/** @deprecated Prefer phase + hotRef split. */
export type P2PJamSyncReadinessState = {
  phase: P2PJamSyncReadinessPhase;
  countdownBeatRemaining: number | null;
  countInProgress01: number | null;
  audioArriveProgress01: number | null;
  audioArriveRemainingSec: number | null;
  loopBarIndex: number | null;
  loopBeatInBar: number | null;
  loopProgress01: number | null;
  isLocalLeader: boolean;
};

/** @deprecated */
export const P2P_JAM_SYNC_READINESS_IDLE: P2PJamSyncReadinessState = {
  phase: "idle",
  ...P2P_JAM_SYNC_READINESS_HOT_IDLE,
  isLocalLeader: false,
};

export type P2PJamPresenterPort = {
  // ── Connection / telemetry ──────────────────────────────────────────
  pingMs: number | null;
  delayMs: number | null;
  packetLossPercent: number | null;
  remoteParticipantName: string | null;
  sessionId: string | null;
  statusNote: string | null;
  bridgeInitError: string | null;
  connectionLostCountdown: number | null;
  collaboratorLeft: boolean;
  highPingTipOpen: boolean;
  onDismissHighPingTip: () => void;
  onCopyRoomCode: () => void;

  // ── Mic / speaker / peer mix ────────────────────────────────────────
  micOn: boolean;
  speakerOn: boolean;
  peerVolumePercent: number;
  syncCountInBlocksLive: boolean;
  onToggleMic: () => void;
  onToggleSpeaker: () => void;
  onPeerVolumeChange: (pct: number) => void;

  // ── Camera (audio-only engine: local UI only / disabled) ────────────
  cameraOn: boolean;
  cameraToggleEnabled: boolean;
  onToggleCamera: () => void;

  // ── Kite Sync ───────────────────────────────────────────────────────
  kiteSyncEnabled: boolean;
  jamSetupLockedByRemote: boolean;
  kiteSyncCountInActive: boolean;
  kiteSyncNetworkMetronomePaused: boolean;
  kiteSyncLossPausePct: number;
  kiteSyncLossResumePct: number;
  activeJam: P2PJamActiveSnapshot | null;
  /** Cold readiness phase (React) — idle / count-in / live. */
  kiteSyncReadinessPhase: P2PJamSyncReadinessPhase;
  kiteSyncReadinessIsLocalLeader: boolean;
  /** Hot beat/progress telemetry — RAF/DOM only; never React state. */
  kiteSyncReadinessHotRef: RefObject<P2PJamSyncReadinessHotSnapshot> | MutableRefObject<P2PJamSyncReadinessHotSnapshot>;
  /** When true, count-in metronome clicks are audible. */
  audibleSyncCountIn: boolean;
  onAudibleSyncCountInChange: (enabled: boolean) => void;
  onStartKiteSync: () => void;
  onEndKiteSync: () => void;

  // ── Wizard ──────────────────────────────────────────────────────────
  wizardOpen: boolean;
  wizard: P2PJamWizardState;
  wizardError: string | null;
  onWizardChange: (next: P2PJamWizardState) => void;
  onWizardConfirm: () => void;
  onWizardCancel: () => void;

  // ── Settings (jam mix / buffer / metronome) ─────────────────────────
  settings: P2PJamSettingsState;
  onSettingsUpdate: (patch: Partial<P2PJamSettingsState>) => void;
  isBufferPrimed: boolean;
  bufferDepthFrames: number;
  lastCorrectionEvent: string | null;
  outputDeviceOptions: { id: string; label: string }[];
  outputDeviceSelectable: boolean;

  // ── Recording ───────────────────────────────────────────────────────
  isRecording: boolean;
  recordingTimeMs: number;
  recordedBlobUrl: string | null;
  onToggleRecord: () => void;
  onClearRecordedBlob: () => void;

  // ── Input devices ───────────────────────────────────────────────────
  inputPanel: P2PJamInputPanelState;
  onToggleInputDevice: (id: string) => void;
  onFocusInputDevice: (id: string) => void;
  onSetInputGain: (deviceId: string, ch: 0 | 1, value: number) => void;
  onSetInterfaceFlag: (deviceId: string, on: boolean) => void;
  onSetLiveMonitorFlag: (deviceId: string, on: boolean) => void;
  registerMixerMeterElement: (laneKey: string, el: HTMLDivElement | null) => void;
  registerMasterLiveMeterElement: (el: HTMLDivElement | null) => void;
  maxActiveInputs: number;

  // ── Meters / levels ─────────────────────────────────────────────────
  remoteMeterHeights: number[];
  remoteLevel: number;
  remoteMeterTapActive: boolean;
  masterLiveLevelPercent: number | null; // null = derive from remote / dummy
  /** Local mic stream for host waveform (UI-only analyser). */
  localMicStream: MediaStream | null;

  // ── Audio element refs (must stay mounted) ──────────────────────────
  remoteAudioRef: RefObject<HTMLAudioElement | null> | MutableRefObject<HTMLAudioElement | null>;
  localMonitorAudioRef: RefObject<HTMLAudioElement | null> | MutableRefObject<HTMLAudioElement | null>;
  metronomeBlinkElementRef: RefObject<HTMLDivElement | null> | MutableRefObject<HTMLDivElement | null>;

  // ── AudioContext ────────────────────────────────────────────────────
  audioContextSuspended: boolean;
  onResumeAudio: () => void;

  // ── Chat ────────────────────────────────────────────────────────────
  chatReady: boolean;
  chatMessages: P2PJamChatMessage[];
  onSendChat: (text: string) => void;

  // ── Session ─────────────────────────────────────────────────────────
  onEndSession: () => void;

  /** When true, presenter uses local dummy meter animations where registers are no-ops. */
  isDummyMode: boolean;
};
