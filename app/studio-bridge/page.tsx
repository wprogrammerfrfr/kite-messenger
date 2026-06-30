"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { BroadcastDashboard } from "@/components/studio-bridge/BroadcastDashboard";
import { StudioPreflightLobby } from "@/components/studio-bridge/StudioPreflightLobby";
import dynamic from "next/dynamic";
import type { KiteLoopV4InputDevicesProps, SoloTrackLaneView } from "@/components/kite-loop-v2/KiteLoopV4Panel";
import type { SoloLooperPlaybackUiStateEvent } from "@/lib/solo-looper-engine";
import { isSoloLatencyEntryAllowed } from "@/lib/solo-latency-persistence";
import { useKiteStudioEngine } from "@/hooks/useKiteStudioEngine";
import type { KiteMode } from "@/hooks/useKiteSyncEngine";
import {
  KITE_SYNC_LOSS_PAUSE_PCT,
  KITE_SYNC_LOSS_RESUME_PCT,
} from "@/lib/p2p/kite-sync-loss";

const KiteLoopV4Panel = dynamic(
  () =>
    import("@/components/kite-loop-v2/KiteLoopV4Panel").then((mod) => ({
      default: mod.KiteLoopV4Panel,
    })),
  { ssr: false }
);

type CheckRowState = "pending" | "done" | "error";
type KiteSignalState = "checking" | "secure" | "offline" | "error";

const ORANGE = "#ff4500";
const EMERALD = "#22c55e";
const OBSIDIAN = "#0c0a09";
const BASELINE_LEVEL_BAR_HEIGHTS = [0.12, 0.12, 0.12, 0.12, 0.12] as const;

function formatRecordingTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function meterBinsFromFrequencyData(buf: Uint8Array): number[] {
  const step = Math.max(1, Math.floor(buf.length / 5));
  return [0, 1, 2, 3, 4].map((i) => {
    let sum = 0;
    for (let j = 0; j < step; j++) sum += buf[i * step + j] ?? 0;
    return Math.min(1, (sum / step / 255) * 1.85);
  });
}

function ExternalLevelBars({ heights }: { heights: readonly number[] }) {
  return (
    <div
      className="flex h-11 items-end justify-center gap-1.5 rounded-xl border border-stone-800/80 bg-black/25 px-4 py-2"
      aria-hidden
    >
      {heights.map((h, i) => (
        <div
          key={i}
          className="w-1.5 origin-bottom rounded-full bg-gradient-to-t from-orange-600/90 to-emerald-400/90"
          style={{
            height: `${Math.max(10, 6 + h * 34)}px`,
            opacity: 0.4 + h * 0.6,
            transition: "height 80ms ease-out, opacity 80ms ease-out",
          }}
        />
      ))}
    </div>
  );
}

function MicLevelBars({
  stream,
  onLevel,
}: {
  stream: MediaStream | null;
  onLevel?: (level: number) => void;
}) {
  const [heights, setHeights] = useState<number[]>(() => [...BASELINE_LEVEL_BAR_HEIGHTS]);

  useEffect(() => {
    if (!stream) return;
    let ctx: AudioContext | undefined;
    let raf = 0;
    let stopped = false;
    let lastT = 0;

    const run = async () => {
      try {
        ctx = new AudioContext();
        await ctx.resume().catch(() => {});
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 128;
        an.smoothingTimeConstant = 0.62;
        src.connect(an);
        const buf = new Uint8Array(an.frequencyBinCount);
        const tick = (now: number) => {
          if (stopped) return;
          an.getByteFrequencyData(buf);
          if (now - lastT > 72) {
            lastT = now;
            const next = meterBinsFromFrequencyData(buf);
            setHeights(next);
            const avg = next.reduce((a, b) => a + b, 0) / next.length;
            onLevel?.(avg);
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        /* visualizer best-effort */
      }
    };
    void run();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [stream, onLevel]);

  return <ExternalLevelBars heights={heights} />;
}

function PreflightRow({
  label,
  pendingText,
  doneText,
  errorText,
  state,
  pendingShowsSpinner = true,
  rowAction,
}: {
  label: string;
  pendingText: string;
  doneText: string;
  errorText?: string;
  state: CheckRowState;
  pendingShowsSpinner?: boolean;
  rowAction?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-stone-800/80 py-3.5 last:border-0 last:pb-0 first:pt-0">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center">
        <AnimatePresence mode="wait">
          {state === "done" ? (
            <motion.span
              key="ok"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 28 }}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400"
            >
              <Check className="h-3.5 w-3.5 stroke-[2.5]" aria-hidden />
            </motion.span>
          ) : state === "error" ? (
            <motion.span
              key="err"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="h-2 w-2 rounded-full bg-red-500/90"
              aria-hidden
            />
          ) : pendingShowsSpinner ? (
            <motion.span
              key="pend"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="relative flex h-5 w-5 items-center justify-center"
              aria-hidden
            >
              <span
                className="absolute h-4 w-4 rounded-full border-2 border-orange-500/35 border-t-emerald-400/80 animate-spin"
                style={{ animationDuration: "1.1s" }}
              />
            </motion.span>
          ) : (
            <motion.span
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="h-2 w-2 rounded-full bg-stone-600"
              aria-hidden
            />
          )}
        </AnimatePresence>
      </div>
      <div className="min-w-0 flex-1 text-left">
        <div className="text-[11px] font-semibold uppercase tracking-widest text-stone-500">{label}</div>
        <AnimatePresence mode="wait">
          <motion.p
            key={state + pendingText + doneText}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className={`mt-1 text-sm font-medium ${state === "error" ? "text-red-300/95" : "text-stone-200"}`}
          >
            {state === "done" ? doneText : state === "error" ? (errorText ?? pendingText) : pendingText}
          </motion.p>
        </AnimatePresence>
        {state !== "done" && rowAction ? <div className="mt-3">{rowAction}</div> : null}
      </div>
    </div>
  );
}

type SoloLooperSlotRow = SoloLooperPlaybackUiStateEvent["slots"][number];

function soloSlotProgressPct(slot: SoloLooperSlotRow | undefined): number {
  if (!slot || slot.intervalFrames <= 0) return 0;
  if (slot.mode === "recording") {
    return Math.min(100, Math.max(0, (slot.recordCursor / slot.intervalFrames) * 100));
  }
  if (slot.mode === "playing") {
    return Math.min(100, Math.max(0, (slot.playbackCursor / slot.intervalFrames) * 100));
  }
  return 0;
}

export default function StudioBridgePage() {
  const router = useRouter();
  const userRef = useRef<User | null>(null);

  const engineUiConfig = useMemo(
    () => ({
      getUser: () => userRef.current,
      confirmResetTrack: (trackIndex: 1 | 2 | 3 | 4) =>
        window.confirm(`Reset Track ${trackIndex} while it is recording?`),
      onJoinOwnSessionError: (message: string) => window.alert(message),
    }),
    []
  );

  const { engineState, engineActions, engineRefs, presenterState, presenterActions, engineLegacy } =
    useKiteStudioEngine({
      router,
      ui: engineUiConfig,
    });

  useEffect(() => {
    userRef.current = presenterState.user;
  }, [presenterState.user]);

  // Engine state aliases (JSX compatibility)
  const status = engineState.status;
  const sessionId = engineState.sessionId;
  const role = engineState.role;
  const pingMs = engineState.pingMs;
  const inboundPacketLossPercent = engineState.inboundPacketLossPercent;
  const calculatedDelayMs = engineState.calculatedDelayMs;
  const kiteSyncEnabled = engineState.kiteSyncEnabled;
  const metronomeBpm = engineState.metronomeBpm;
  const isVisualMetronomeOnly = engineState.isVisualMetronomeOnly;
  const localMicStream = engineState.localMicStream;
  const echoSafetyMode = engineState.echoSafetyMode;
  const isBufferingEnabled = engineState.isBufferingEnabled;
  const bufferDepthFrames = engineState.bufferDepthFrames;
  const targetLeadFrames = engineState.targetLeadFrames;
  const isAutoBuffer = engineState.isAutoBuffer;
  const isBufferPrimed = engineState.isBufferPrimed;
  const lastCorrectionEvent = engineState.lastCorrectionEvent;
  const remoteStream = engineState.remoteStream;
  const remoteMeterTapActive = engineState.remoteMeterTapActive;
  const isMicMuted = engineState.isMicMuted;
  const isSpeakerMuted = engineState.isSpeakerMuted;
  const remotePlaybackVolume = engineState.remotePlaybackVolume;
  const isRecording = engineState.isRecording;
  const audioContextReady = engineState.audioContextReady;
  const audioInputDevices = engineState.audioInputDevices;
  const activeDeviceIds = engineState.activeDeviceIds;
  const deviceVolumes = engineState.deviceVolumes;
  const deviceInputChannelCount = engineState.deviceInputChannelCount;
  const interfaceInputDeviceFlags = engineState.interfaceInputDeviceFlags;
  const interfaceLiveMonitorEnabledFlags = engineState.interfaceLiveMonitorEnabledFlags;
  const kiteSetupTimeSignatureTop = engineState.kiteSetupTimeSignatureTop;
  const kiteSetupTimeSignatureBottom = engineState.kiteSetupTimeSignatureBottom;
  const kiteSetupIsSwing = engineState.kiteSetupIsSwing;
  const kiteSetupChordCount = engineState.kiteSetupChordCount;
  const kiteSetupTempo = engineState.kiteSetupTempo;
  const kiteSetupMode = engineState.kiteSetupMode;
  const kiteMode = engineState.kiteMode;
  const broadcastStatus = engineState.broadcastStatus;
  const jamSetupLock = engineState.jamSetupLock;
  const soloLooperState = engineState.soloLooperState;
  const soloActiveRecordTrackIndex = engineState.soloActiveRecordTrackIndex;
  const isRecordingArmed = engineState.isRecordingArmed;
  const soloTrackVolumes = engineState.soloTrackVolumes;
  const soloMasterLoopFrames = engineState.soloMasterLoopFrames;
  const soloLooperLatencyMs = engineState.soloLooperLatencyMs;
  const soloInputGain = engineState.soloInputGain;
  const soloLatencyCalibrationStatus = engineState.soloLatencyCalibrationStatus;
  const soloLatencyCalibrationMessage = engineState.soloLatencyCalibrationMessage;
  const soloLatencyCalibrationStale = engineState.soloLatencyCalibrationStale;
  const soloLatencyStaleMessage = engineState.soloLatencyStaleMessage;
  const soloLatencyLastRawMeasuredMs = engineState.soloLatencyLastRawMeasuredMs;
  const soloLooperMode = engineState.soloLooperMode;
  const soloLooperBarCount = engineState.soloLooperBarCount;
  const isMasterPaused = engineState.isMasterPaused;
  const soloSessionRecorderState = engineState.soloSessionRecorderState;
  const kiteSyncCountInActive = engineState.kiteSyncCountInActive;
  const metronomeVolume = engineState.metronomeVolume;
  const kiteIntervalTimingRef = engineState.kiteIntervalTimingRef;

  // Presenter state aliases
  const statusNote = presenterState.statusNote;
  const bridgeInitError = presenterState.bridgeInitError;
  const inviteLink = presenterState.inviteLink;
  const highPingTipOpen = presenterState.highPingTipOpen;
  const visualActiveBeatInBar = presenterState.visualActiveBeatInBar;
  const micPermissionDenied = presenterState.micPermissionDenied;
  const micPermissionHint = presenterState.micPermissionHint;
  const micSyncTimedOut = presenterState.micSyncTimedOut;
  const audioTestDone = presenterState.audioTestDone;
  const audioTestPlaying = presenterState.audioTestPlaying;
  const audioTestFailed = presenterState.audioTestFailed;
  const kiteSignal = presenterState.kiteSignal;
  const studioUiPhase = presenterState.studioUiPhase;
  const roomCopyNote = presenterState.roomCopyNote;
  const remoteLevel = presenterState.remoteLevel;
  const remoteMeterHeights = presenterState.remoteMeterHeights;
  const remoteMeterRafKey = presenterState.remoteMeterRafKey;
  const recordingTimeMs = presenterState.recordingTimeMs;
  const recordedBlobUrl = presenterState.recordedBlobUrl;
  const recordedDownloadExt = presenterState.recordedDownloadExt;
  const confirmExitOpen = presenterState.confirmExitOpen;
  const collaboratorLeft = presenterState.collaboratorLeft;
  const remoteParticipantName = presenterState.remoteParticipantName;
  const connectionLostCountdown = presenterState.connectionLostCountdown;
  const user = presenterState.user;
  const authReady = presenterState.authReady;
  const kiteSetupStep = presenterState.kiteSetupStep;
  const kiteSetupUsesCustomChords = presenterState.kiteSetupUsesCustomChords;
  const kiteSetupError = presenterState.kiteSetupError;
  const loopProgress = presenterState.loopProgress;
  const recordingArmedCountdown = presenterState.recordingArmedCountdown;
  const soloRunwayDisplay = presenterState.soloRunwayDisplay;
  const soloTrackSlotUi = presenterState.soloTrackSlotUi;
  const focusedTrackIndex = presenterState.focusedTrackIndex;
  const soloOverdubArmedTrackIndex = presenterState.soloOverdubArmedTrackIndex;
  const syncInitiatorId = presenterState.syncInitiatorId;
  const kiteSyncNetworkMetronomePaused = presenterState.kiteSyncNetworkMetronomePaused;

  // Presenter actions aliases
  const setConfirmExitOpen = presenterActions.setConfirmExitOpen;
  const setRoomCopyNote = presenterActions.setRoomCopyNote;
  const setStatusNote = presenterActions.setStatusNote;
  const setKiteSetupUsesCustomChords = presenterActions.setKiteSetupUsesCustomChords;
  const setKiteSetupMode = presenterActions.setKiteSetupMode;

  // Engine action aliases
  const handleEnterStudio = engineActions.handleEnterStudio;
  const handleEnterSoloStudio = engineActions.handleEnterSoloStudio;
  const confirmEndSession = engineActions.confirmEndSession;
  const returnToLobby = engineActions.returnToLobby;
  const toggleAudioDevice = engineActions.toggleAudioDevice;
  const handleVolumeChange = engineActions.handleVolumeChange;
  const setInterfaceInputDeviceFlag = engineActions.setInterfaceInputDeviceFlag;
  const setInterfaceLiveMonitorEnabledFlag = engineActions.setInterfaceLiveMonitorEnabledFlag;
  const toggleMic = engineActions.toggleMic;
  const toggleSpeaker = engineActions.toggleSpeaker;
  const onRemotePlaybackVolumeChange = engineActions.onRemotePlaybackVolumeChange;
  const onMetronomeVolumeChange = engineActions.onMetronomeVolumeChange;
  const handleRecordFirstLoop = engineActions.handleRecordFirstLoop;
  const handleAutoCalibrateSoloLatency = engineActions.handleAutoCalibrateSoloLatency;
  const handleSoloLatencyMsChange = engineActions.handleSoloLatencyMsChange;
  const handleStopAndResetSoloLooper = engineActions.handleStopAndResetSoloLooper;
  const handleToggleMasterPause = engineActions.handleToggleMasterPause;
  const handleResetSoloTrack = engineActions.handleResetSoloTrack;
  const handleTrackTransportTap = engineActions.handleTrackTransportTap;
  const handleSoloTrackVolumeChange = engineActions.handleSoloTrackVolumeChange;
  const handleToggleSoloSessionRecording = engineActions.handleToggleSoloSessionRecording;
  const handleStartKiteSetup = engineActions.handleStartKiteSetup;
  const handleCancelKiteSetup = engineActions.handleCancelKiteSetup;
  const handleConfirmKiteSetup = engineActions.handleConfirmKiteSetup;
  const handleStartBroadcastCountIn = engineActions.handleStartBroadcastCountIn;
  const handleTapBeat = engineActions.handleTapBeat;
  const goToNextKiteSetupStep = engineActions.goToNextKiteSetupStep;
  const goToPreviousKiteSetupStep = engineActions.goToPreviousKiteSetupStep;
  const setSoloInputGain = engineActions.setSoloInputGain;
  const setSoloLooperMode = engineActions.setSoloLooperMode;
  const setSoloLooperBarCount = engineActions.setSoloLooperBarCount;
  const setKiteSetupTempo = engineActions.setKiteSetupTempo;
  const setKiteSetupTimeSignatureTop = engineActions.setKiteSetupTimeSignatureTop;
  const setKiteSetupTimeSignatureBottom = engineActions.setKiteSetupTimeSignatureBottom;
  const setKiteSetupIsSwing = engineActions.setKiteSetupIsSwing;
  const setKiteSetupChordCount = engineActions.setKiteSetupChordCount;
  const setIsVisualMetronomeOnly = engineActions.setIsVisualMetronomeOnly;
  const setIsBufferingEnabled = engineActions.setIsBufferingEnabled;
  const setIsAutoBuffer = engineActions.setIsAutoBuffer;
  const setTargetLeadFrames = engineActions.setTargetLeadFrames;
  const setEchoSafetyMode = engineActions.setEchoSafetyMode;
  const setRetryInitTick = engineActions.setRetryInitTick;
  const runAudioTest = engineActions.runAudioTest;
  const startLocalRecording = engineActions.startLocalRecording;
  const stopLocalRecording = engineActions.stopLocalRecording;
  const registerMixerMeterElement = engineActions.registerMixerMeterElement;
  const registerMasterLiveMeterElement = engineActions.registerMasterLiveMeterElement;
  const applyPedalFocus = engineActions.applyPedalFocus;
  const dismissHighPingTip = engineActions.dismissHighPingTip;
  const refreshAudioInputDevices = engineActions.refreshAudioInputDevices;
  const broadcastKiteSyncStop = engineActions.broadcastKiteSyncStop;
  const toggleKiteSync = engineActions.toggleKiteSync;

  const REMOTE_PLAYBACK_VOLUME_MIN = 0.5;
  const REMOTE_PLAYBACK_VOLUME_MAX = 4;

  const onRemotePlaybackVolumeSliderChange = (event: ChangeEvent<HTMLInputElement>) => {
    onRemotePlaybackVolumeChange(Number(event.target.value));
  };
  const onMetronomeVolumeSliderChange = (event: ChangeEvent<HTMLInputElement>) => {
    onMetronomeVolumeChange(Number(event.target.value));
  };

  // Legacy dashboard bridge (presenter JSX still references these)
  const broadcastWizardStudioParam = engineLegacy.broadcastWizardStudioParam;
  const sendJamSetupLock = engineLegacy.sendJamSetupLock;
  const studioAudioContextRef = engineLegacy.studioAudioContextRef;
  const activeStreamsMapRef = engineLegacy.activeStreamsMapRef;
  const setAudioContextReady = engineLegacy.setAudioContextReady;
  const setMetronomeBpm = engineLegacy.setMetronomeBpm;
  const broadcastStudioParam = engineLegacy.broadcastStudioParam;
  const getStudioKiteSampleRate = engineLegacy.getStudioKiteSampleRate;
  const clearRecordedBlobUrl = engineLegacy.clearRecordedBlobUrl;

  // Engine refs
  const remoteAudioRef = engineRefs.remoteAudioRef;
  const localMonitorAudioRef = engineRefs.localMonitorAudioRef;
  const metronomeBlinkElementRef = engineRefs.metronomeBlinkElementRef;
  const soloMeterElementRef = engineRefs.soloMeterElementRef;
  const soloTrackSlotUiLatestRef = engineRefs.soloTrackSlotUiLatestRef;

  const localJamSetupOwnerId = user?.id ?? `${role ?? "unknown"}:${sessionId ?? "local"}`;
  const isInStudioPhase = studioUiPhase === "studio";

  const kiteSignalSecure = kiteSignal === "secure";
  const canEnterStudio =
    studioUiPhase === "lobby" &&
    Boolean(localMicStream) &&
    audioTestDone &&
    kiteSignalSecure;
  const entryLatencyMs = soloLatencyLastRawMeasuredMs ?? soloLooperLatencyMs;
  const soloLatencyEntryAllowed = isSoloLatencyEntryAllowed(entryLatencyMs);
  const soloLatencyReady =
    soloLooperLatencyMs > 0 &&
    !soloLatencyCalibrationStale &&
    soloLatencyEntryAllowed;
  const canPracticeAlone =
    studioUiPhase === "lobby" &&
    Boolean(localMicStream) &&
    audioTestDone &&
    soloLatencyReady &&
    soloLatencyCalibrationStatus !== "listening";

  const soloPracticeButtonLabel = ((): string => {
    if (canPracticeAlone) {
      return "Kite loopstation";
    }
    if (soloLatencyCalibrationStatus === "listening") {
      return "Calibrating latency…";
    }
    if (!localMicStream || !audioTestDone) {
      return "Complete preflight checks to enable session entry";
    }
    if (soloLooperLatencyMs <= 0) {
      return "Calibrate latency in Session panel";
    }
    if (soloLatencyCalibrationStale) {
      return "Re-calibrate latency — audio hardware changed";
    }
    if (!soloLatencyEntryAllowed) {
      return "Latency out of bounds. Re-calibrate";
    }
    return "Complete preflight checks to enable session entry";
  })();
  const showLobbyControls = studioUiPhase === "lobby";
  const localJamSetupOwnerName = role === "host" ? "Host" : "Bandmate";
  const canControlStop = !syncInitiatorId || syncInitiatorId === localJamSetupOwnerId;
  const canStartSync = broadcastStatus === "idle" && Boolean(remoteStream);
  const jamSetupLockedByRemote =
    Boolean(jamSetupLock) &&
    jamSetupLock!.ownerId !== localJamSetupOwnerId &&
    jamSetupLock!.expiresAt > Date.now();
  const remoteIsLive = remoteLevel > 0.07;
  const syncCountInBlocksLive = kiteSyncCountInActive && kiteSyncEnabled;
  const stealthBroadcastUiLock = kiteMode === "broadcast";
  const looperFootPedalArmed = kiteMode === "solo" && studioUiPhase === "studio";

  const micRowState: CheckRowState = micPermissionDenied
    ? "error"
    : localMicStream
      ? "done"
      : micSyncTimedOut
        ? "error"
        : "pending";
  const audioRowState: CheckRowState = audioTestFailed
    ? "error"
    : audioTestDone
      ? "done"
      : "pending";
  const connRowState: CheckRowState =
    kiteSignal === "secure" ? "done" : kiteSignal === "checking" ? "pending" : "error";

  const kitePendingCopy = micPermissionDenied
    ? "Waiting for microphone access..."
    : "Connecting to Kite Signal...";
  const kiteErrorCopy =
    kiteSignal === "offline"
      ? "You're offline. Check your network connection."
      : "Could not reach Kite Signal. Try again shortly.";
  const audioPendingCopy = micPermissionDenied
    ? "Waiting for microphone access..."
    : audioTestPlaying
      ? "Playing test tone…"
      : "Tap Test Audio to play a short tone.";

  const largeRoomCodeCard =
    sessionId != null && sessionId !== "" ? (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-stone-900/40 border border-stone-800/60 rounded-xl p-6 mb-4 cursor-pointer hover:bg-stone-900/60"
        onClick={() => void copyRoomCode()}
        whileTap={{ scale: 0.98 }}
      >
        <p className="text-[10px] font-bold uppercase tracking-widest text-stone-500 mb-2">
          ROOM CODE
        </p>
        <p className="text-2xl font-mono tracking-[0.2em] text-white">{sessionId.toUpperCase()}</p>
        <p className="mt-2 text-[10px] text-stone-600">Tap to copy</p>
      </motion.div>
    ) : null;

    const soloTrackLanes = useMemo((): SoloTrackLaneView[] => {
    const slotMap = new Map<number, SoloLooperSlotRow>();
    soloTrackSlotUi?.forEach((s) => slotMap.set(s.trackIndex, s));
    return [1, 2, 3, 4].map((n) => {
      const slot = slotMap.get(n);
      const progress = soloSlotProgressPct(slot);
      const isThisTrackRecording =
        slot?.mode === "recording" ||
        soloActiveRecordTrackIndex === n ||
        (soloLooperState === "recording" &&
          soloActiveRecordTrackIndex == null &&
          n === 1);
      const secondaryBlocked =
        soloMasterLoopFrames == null ||
        isRecordingArmed ||
        isMasterPaused ||
        soloLooperState === "idle" ||
        (soloLooperState === "recording" && !isThisTrackRecording);
      const track1ArmDisabled =
        isMasterPaused ||
        isRecordingArmed ||
        (soloLooperState === "recording" && !isThisTrackRecording);
      return {
        trackIndex: n as 1 | 2 | 3 | 4,
        volume: soloTrackVolumes[n - 1],
        progress,
        workletMode: slot?.mode ?? "idle",
        onVolumeChange: (lin: number) => handleSoloTrackVolumeChange(n as 1 | 2 | 3 | 4, lin),
        onArmRecord: () => handleTrackTransportTap(n as 1 | 2 | 3 | 4),
        armDisabled: n === 1 ? track1ArmDisabled : secondaryBlocked,
        armLabel: n === 1 ? "Record" : "Overdub",
        isFocused: focusedTrackIndex === n,
        onRequestFocus: () => applyPedalFocus(n as 1 | 2 | 3 | 4),
        onResetTrack: () => handleResetSoloTrack(n as 1 | 2 | 3 | 4),
        resetDisabled: isRecordingArmed || soloLooperState === "idle",
        isOverdubArmedWaiting:
          slot?.mode === "armed_overdub" ||
          (n >= 2 && soloOverdubArmedTrackIndex !== null && soloOverdubArmedTrackIndex === n),
        isEngineRecording:
          soloActiveRecordTrackIndex === n ||
          (soloLooperState === "recording" &&
            soloActiveRecordTrackIndex == null &&
            n === 1),
      };
    });
  }, [
    applyPedalFocus,
    focusedTrackIndex,
    soloOverdubArmedTrackIndex,
    soloTrackSlotUi,
    soloTrackVolumes,
    soloMasterLoopFrames,
    isRecordingArmed,
    isMasterPaused,
    soloLooperState,
    soloActiveRecordTrackIndex,
    handleSoloTrackVolumeChange,
    handleTrackTransportTap,
    handleResetSoloTrack,
  ]);

    const copyInviteLink = async () => {
    if (!inviteLink || typeof window === "undefined") return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setStatusNote("Invite link copied.");
    } catch {
      setStatusNote("Copy failed. Share the URL manually.");
    }
  };

  const copyRoomCode = async () => {
    if (!sessionId || typeof window === "undefined") return;
    try {
      await navigator.clipboard.writeText(sessionId.toUpperCase());
      setRoomCopyNote("Room code copied.");
      window.setTimeout(() => setRoomCopyNote(null), 1400);
    } catch {
      setRoomCopyNote("Copy not available.");
      window.setTimeout(() => setRoomCopyNote(null), 1400);
    }
  };

    const inputDevicesForPanel = useMemo<KiteLoopV4InputDevicesProps>(() => {
    if (kiteMode === "solo") {
      return {
        audioInputDevices,
        activeDeviceIds,
        deviceVolumes: {},
        deviceInputChannelCount: {},
        interfaceInputDeviceFlags,
        interfaceLiveMonitorEnabledFlags,
        onToggleDeviceActive: (deviceId) => void toggleAudioDevice(deviceId),
        onSetDeviceLaneVolume: () => {},
        onSetInterfaceInputFlag: setInterfaceInputDeviceFlag,
        onSetInterfaceLiveMonitor: setInterfaceLiveMonitorEnabledFlag,
        registerMixerMeterElement,
        registerMasterLiveMeterElement,
        recTrimSlot: (
          <>
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                gap: 16,
                alignItems: "stretch",
                height: 220,
                width: "100%",
                marginTop: 12,
              }}
            >
              {/* â”€â”€ Mic Level Card â”€â”€ */}
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  background: "rgba(24, 24, 27, 0.4)",
                  borderRadius: 12,
                  padding: "16px 12px",
                  gap: 12,
                }}
              >
                <span className="font-sans text-[11px] font-medium uppercase tracking-widest text-emerald-500">
                  Mic Level
                </span>
                {/* Sleek Borderless Track */}
                <div
                  style={{
                    width: 12,
                    flex: 1,
                    background: "rgba(0,0,0,0.4)",
                    borderRadius: 999,
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "flex-end",
                  }}
                >
                  {/* Animated Fill */}
                  <div
                    ref={(el) => {
                      soloMeterElementRef.current = el;
                    }}
                    style={{
                      width: "100%",
                      height: "0%",
                      background: "linear-gradient(to top, #10b981 40%, #f97316 100%)",
                      transition: "height 50ms linear",
                    }}
                  />
                </div>
              </div>

              {/* â”€â”€ Gain Control Card â”€â”€ */}
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  background: "rgba(24, 24, 27, 0.4)",
                  borderRadius: 12,
                  padding: "16px 12px",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 2,
                  }}
                >
                  <span className="font-sans text-[11px] font-medium uppercase tracking-widest text-emerald-500">
                    Gain
                  </span>
                  <span
                    style={{
                      color: "#f5f5f4",
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: "monospace",
                    }}
                  >
                    {soloInputGain.toFixed(1)}
                  </span>
                </div>

                {/* Native Vertical Slider wrapper */}
                <div
                  style={{
                    height: 110,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={0.1}
                    value={soloInputGain}
                    onChange={(e) => setSoloInputGain(Number(e.target.value))}
                    aria-label="Loopstation recording input gain"
                    style={{
                      writingMode: "vertical-lr",
                      direction: "rtl",
                      height: 110,
                      width: 20,
                      cursor: "pointer",
                      accentColor: "#10b981",
                      WebkitAppearance: "slider-vertical",
                      appearance: "slider-vertical",
                    } as unknown as React.CSSProperties}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setSoloInputGain(5)}
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: "#f97316",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "4px 8px",
                    marginTop: "auto",
                  }}
                >
                  Reset
                </button>
              </div>
            </div>
          </>
        ),
      };
    }
    return {
      audioInputDevices,
      activeDeviceIds,
      deviceVolumes,
      deviceInputChannelCount,
      interfaceInputDeviceFlags,
      interfaceLiveMonitorEnabledFlags,
      onToggleDeviceActive: (deviceId) => void toggleAudioDevice(deviceId),
      onSetDeviceLaneVolume: (deviceId, lane, value) =>
        handleVolumeChange(`${deviceId}:ch${lane}`, value),
      onSetInterfaceInputFlag: setInterfaceInputDeviceFlag,
      onSetInterfaceLiveMonitor: setInterfaceLiveMonitorEnabledFlag,
      registerMixerMeterElement,
      registerMasterLiveMeterElement,
    };
  }, [
    kiteMode,
    audioInputDevices,
    activeDeviceIds,
    deviceVolumes,
    deviceInputChannelCount,
    interfaceInputDeviceFlags,
    interfaceLiveMonitorEnabledFlags,
    toggleAudioDevice,
    handleVolumeChange,
    setInterfaceInputDeviceFlag,
    setInterfaceLiveMonitorEnabledFlag,
    registerMixerMeterElement,
    registerMasterLiveMeterElement,
    soloInputGain,
    setSoloInputGain,
  ]);

    const renderVisualMetronomeControls = () => (
    <>
      {!stealthBroadcastUiLock ? (
        <button
          type="button"
          title="Use if you don't have headphones!"
          onClick={() => setIsVisualMetronomeOnly(!isVisualMetronomeOnly)}
          className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
            isVisualMetronomeOnly
              ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/22"
              : "border-stone-700 bg-stone-900/60 text-stone-300 hover:bg-stone-800"
          }`}
        >
          {isVisualMetronomeOnly ? "👁️ Visual Mode Active" : "🔊 Audio Metronome"}
        </button>
      ) : null}
      <div className="flex items-center gap-2">
        <div className="flex flex-row items-center justify-center gap-2">
          {[0, 1, 2, 3].map((beatIndex) => {
            const isActive = visualActiveBeatInBar === beatIndex;
            const activeClass =
              beatIndex === 0
                ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"
                : "bg-stone-300";
            return (
              <div
                key={beatIndex}
                className={`h-4 w-4 rounded-full transition-colors duration-100 ${
                  isActive ? activeClass : "bg-stone-800 border border-stone-600"
                }`}
              />
            );
          })}
        </div>
      </div>
    </>
  );

    return (
    <div className="relative min-h-screen overflow-hidden text-white antialiased">
      <div className="fixed inset-0" style={{ backgroundColor: OBSIDIAN }} aria-hidden />
      <div
        className="pointer-events-none fixed inset-0 z-0"
        aria-hidden
        style={{
          background: `
            radial-gradient(ellipse 90% 70% at 0% -10%, rgba(255, 69, 0, 0.2), transparent 55%),
            radial-gradient(ellipse 80% 60% at 100% 0%, rgba(34, 197, 94, 0.14), transparent 50%),
            radial-gradient(ellipse 70% 50% at 100% 100%, rgba(255, 69, 0, 0.1), transparent 45%),
            radial-gradient(ellipse 75% 55% at 0% 100%, rgba(34, 197, 94, 0.12), transparent 48%)
          `,
        }}
      />

      <AnimatePresence>
        {confirmExitOpen ? (
          <motion.div
            className="fixed inset-0 z-[100] flex items-center justify-center p-5 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ background: "rgba(0,0,0,0.55)" }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 6 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="z-[101] w-full max-w-md rounded-2xl border border-orange-500/35 bg-stone-950/95 p-6 shadow-2xl"
              style={{
                boxShadow: `
                  0 0 0 1px rgba(255,69,0,0.2),
                  0 0 44px -18px rgba(255,69,0,0.45),
                  0 22px 44px -20px rgba(0,0,0,0.7)
                `,
                backgroundColor: "#0c0a09",
              }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="end-session-title"
            >
              <h2
                id="end-session-title"
                className="text-xl font-bold tracking-tight text-stone-100"
              >
                End Session?
              </h2>
              <p className="mt-2 text-sm font-medium text-stone-400">
                Are you sure you want to exit? This will disconnect all participants.
              </p>
              <div className="mt-6 flex items-center justify-end gap-3">
                <motion.button
                  type="button"
                  onClick={() => setConfirmExitOpen(false)}
                  whileTap={{ scale: 0.97 }}
                  className="rounded-xl border border-emerald-500/35 bg-transparent px-4 py-2.5 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/10"
                >
                  Keep Jamming
                </motion.button>
                <motion.button
                  type="button"
                  onClick={confirmEndSession}
                  whileTap={{ scale: 0.97 }}
                  className="rounded-xl border border-orange-500/45 bg-gradient-to-r from-orange-600/90 to-red-600/90 px-4 py-2.5 text-sm font-semibold text-white transition hover:from-orange-500 hover:to-red-500"
                >
                  End Session
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <audio ref={localMonitorAudioRef} className="sr-only" playsInline muted />
      <audio ref={remoteAudioRef} className="sr-only" playsInline muted />

      <div
        className={`relative z-10 mx-auto flex min-h-screen w-full flex-col ${
          studioUiPhase === "studio"
            ? "max-w-6xl justify-center px-6 py-16 pb-28 sm:px-8 lg:pb-16"
            : studioUiPhase === "lobby"
              ? "max-w-none justify-start p-0"
              : "max-w-md justify-center px-5 py-16 pb-28 sm:px-6 lg:pb-16"
        }`}
      >
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
          className="w-full"
        >
          {!authReady ? (
            <div className="mt-10 flex flex-col items-center rounded-2xl border border-stone-800/90 bg-stone-950/50 px-6 py-10 backdrop-blur-sm">
              <div
                className="h-9 w-9 rounded-full border-2 border-orange-500/35 border-t-emerald-400/80 animate-spin"
                style={{ animationDuration: "1.1s" }}
                aria-hidden
              />
              <p className="mt-4 text-sm font-medium text-stone-400">Checking your account…</p>
            </div>
          ) : user ? (
            <>
          {roomCopyNote && !showLobbyControls ? (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-3 text-center text-xs font-medium text-emerald-300/90"
              role="status"
            >
              {roomCopyNote}
            </motion.div>
          ) : null}

          {micPermissionDenied && !showLobbyControls ? (
            <div
              className="mt-6 rounded-xl border border-stone-700/90 bg-stone-950/50 px-4 py-3 text-center text-sm font-medium leading-relaxed text-stone-300"
              role="status"
            >
              {micPermissionHint ||
                "Microphone Access Required. Please enable it in your browser settings to continue."}
            </div>
          ) : null}

          {micSyncTimedOut && !localMicStream && !showLobbyControls ? (
            <div className="mt-4">
              <motion.button
                type="button"
                onClick={() => setRetryInitTick((n) => n + 1)}
                whileTap={{ scale: 0.97 }}
                className="w-full rounded-xl border border-orange-500/35 bg-gradient-to-r from-orange-500/15 to-emerald-500/15 px-4 py-3 text-sm font-semibold text-stone-100 transition hover:from-orange-500/25 hover:to-emerald-500/25"
              >
                Retry Microphone Sync
              </motion.button>
            </div>
          ) : null}

          {showLobbyControls ? (
            <StudioPreflightLobby
              returnToLobby={returnToLobby}
              micPermissionDenied={micPermissionDenied}
              micPermissionHint={micPermissionHint}
              micSyncTimedOut={micSyncTimedOut}
              localMicStream={localMicStream}
              setRetryInitTick={setRetryInitTick}
              micRowState={micRowState}
              audioRowState={audioRowState}
              connRowState={connRowState}
              runAudioTest={runAudioTest}
              audioTestPlaying={audioTestPlaying}
              pingMs={pingMs}
              kiteErrorCopy={kiteErrorCopy}
              kitePendingCopy={kitePendingCopy}
              copyRoomCode={copyRoomCode}
              sessionId={sessionId}
              roomCopyNote={roomCopyNote}
              canEnterStudio={canEnterStudio}
              handleEnterStudio={handleEnterStudio}
              canPracticeAlone={canPracticeAlone}
              handleEnterSoloStudio={handleEnterSoloStudio}
              soloPracticeButtonLabel={soloPracticeButtonLabel}
              soloLooperLatencyMs={soloLooperLatencyMs}
              soloLatencyEntryMs={entryLatencyMs}
              soloLatencyCalibrationStale={soloLatencyCalibrationStale}
              soloLatencyStaleMessage={soloLatencyStaleMessage}
              soloLatencyCalibrationStatus={soloLatencyCalibrationStatus}
              soloLatencyCalibrationMessage={soloLatencyCalibrationMessage}
              onCalibrateSoloLatency={handleAutoCalibrateSoloLatency}
              calibrationDisabled={micPermissionDenied || !localMicStream}
            />
          ) : studioUiPhase === "kite-setup" ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-8 rounded-2xl border border-stone-800/90 bg-stone-950/50 p-5 shadow-2xl backdrop-blur-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-300">
                    Kite Sync Setup
                  </p>
                  <h2 className="mt-1 text-xl font-bold tracking-tight text-stone-50">
                    Step {kiteSetupStep} of 5
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={handleCancelKiteSetup}
                  className="rounded-lg border border-stone-700 bg-stone-900/60 px-3 py-1.5 text-xs font-semibold text-stone-300 transition hover:bg-stone-800"
                >
                  Cancel
                </button>
              </div>

              <div className="mt-5 rounded-xl border border-stone-800/80 bg-stone-950/45 p-4">
                {kiteSetupStep === 1 ? (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-bold tracking-tight text-stone-100">
                        How does the beat group?
                      </h3>
                      <p className="mt-1 text-sm font-medium leading-relaxed text-stone-400">
                        Tap your foot to the song. Does it feel like it groups in 2s, 3s, or
                        something unusual? Pick the closest match.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {[
                        {
                          top: 4,
                          bottom: 4,
                          swing: false,
                          title: "Groups of 4",
                          meter: "4/4 time",
                          example: "Most pop, rock, jazz, blues",
                          dots: [4],
                        },
                        {
                          top: 3,
                          bottom: 4,
                          swing: false,
                          title: "Groups of 3",
                          meter: "3/4 time",
                          example: "Waltz, folk ballad, Chopin",
                          dots: [3],
                        },
                        {
                          top: 6,
                          bottom: 8,
                          swing: false,
                          title: "Two groups of 3",
                          meter: "6/8 time",
                          example: "Jig, compound feel, House of the Rising Sun",
                          dots: [3, 3],
                        },
                        {
                          top: 5,
                          bottom: 4,
                          swing: false,
                          title: "Groups of 5",
                          meter: "5/4 time",
                          example: "Take Five, Mission Impossible",
                          dots: [3, 2],
                        },
                        {
                          top: 7,
                          bottom: 4,
                          swing: false,
                          title: "Groups of 7",
                          meter: "7/4 time",
                          example: "Money (Pink Floyd), Unsquare Dance",
                          dots: [4, 3],
                        },
                        {
                          top: 4,
                          bottom: 4,
                          swing: true,
                          title: "4/4 swing feel",
                          meter: "4/4 shuffled",
                          example: "Jazz swing, shuffle blues",
                          dots: [4],
                        },
                      ].map((option) => {
                        const selected =
                          kiteSetupTimeSignatureTop === option.top &&
                          kiteSetupTimeSignatureBottom === option.bottom &&
                          kiteSetupIsSwing === option.swing;
                        return (
                          <button
                            key={`${option.title}-${option.meter}`}
                            type="button"
                            onClick={() => {
                              setKiteSetupTimeSignatureTop(option.top);
                              setKiteSetupTimeSignatureBottom(option.bottom);
                              setKiteSetupIsSwing(option.swing);
                              const bpi = Math.max(1, Math.round(kiteSetupChordCount * option.top));
                              broadcastWizardStudioParam({
                                kiteSetupTimeSignatureTop: option.top,
                                kiteSetupTimeSignatureBottom: option.bottom,
                                bpi,
                              });
                            }}
                            className={`rounded-xl border px-4 py-4 text-left transition ${
                              selected
                                ? "border-blue-500 bg-blue-950/25 text-stone-50"
                                : "border-stone-700 bg-stone-900/60 text-stone-300 hover:bg-stone-800"
                            }`}
                          >
                            <span className="flex h-5 items-center gap-1.5" aria-hidden>
                              {option.dots.map((group, groupIndex) => (
                                <span key={`${option.title}-${groupIndex}`} className="flex gap-1.5">
                                  {Array.from({ length: group }).map((_, dotIndex) => (
                                    <span
                                      key={dotIndex}
                                      className={`h-3 w-3 rounded-full ${
                                        dotIndex === 0 ? "bg-stone-100" : "bg-stone-500"
                                      }`}
                                    />
                                  ))}
                                </span>
                              ))}
                            </span>
                            <span className="mt-3 block text-base font-bold text-stone-100">
                              {option.title}
                            </span>
                            <span className="mt-0.5 block text-sm font-semibold text-stone-300">
                              {option.meter}
                            </span>
                            <span className="mt-1 block text-xs font-semibold italic leading-snug text-stone-400">
                              {option.example}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {kiteSetupStep === 2 ? (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-bold tracking-tight text-stone-100">
                        How many chords before it repeats?
                      </h3>
                      <p className="mt-1 text-sm font-medium leading-relaxed text-stone-400">
                        Count the chords in one cycle. Don&apos;t overthink â€” just count what
                        you&apos;d play before starting over.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                      {[
                        { count: 2, label: "Iâ€“V vamp" },
                        { count: 4, label: "pop 4-chord" },
                        { count: 8, label: "Canon / jazz 8" },
                        { count: 12, label: "12-bar blues" },
                        { count: 16, label: "long jazz form" },
                      ].map((option) => (
                        <button
                          key={option.count}
                          type="button"
                          onClick={() => {
                            setKiteSetupUsesCustomChords(false);
                            setKiteSetupChordCount(option.count);
                            broadcastWizardStudioParam({
                              kiteSetupChordCount: option.count,
                              bpi: Math.max(1, Math.round(option.count * kiteSetupTimeSignatureTop)),
                            });
                          }}
                          className={`rounded-xl border px-3 py-4 text-center transition ${
                            !kiteSetupUsesCustomChords && kiteSetupChordCount === option.count
                              ? "border-blue-500 bg-blue-950/25 text-stone-50"
                              : "border-stone-700 bg-stone-900/50 text-stone-300 hover:bg-stone-800"
                          }`}
                        >
                          <span className="block text-2xl font-bold">{option.count}</span>
                          <span className="mt-1 block text-[11px] font-semibold text-stone-400">
                            {option.label}
                          </span>
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setKiteSetupUsesCustomChords(true)}
                        className={`rounded-xl border px-3 py-4 text-center transition ${
                          kiteSetupUsesCustomChords
                            ? "border-blue-500 bg-blue-950/25 text-stone-50"
                            : "border-stone-700 bg-stone-900/50 text-stone-300 hover:bg-stone-800"
                        }`}
                      >
                        <span className="block text-lg font-bold">other</span>
                      </button>
                    </div>
                    {kiteSetupUsesCustomChords ? (
                      <div className="flex items-center gap-3">
                        <input
                          type="number"
                          min={1}
                          max={64}
                          value={kiteSetupChordCount}
                          onChange={(event) => {
                            const next = Number(event.target.value);
                            if (!Number.isFinite(next)) return;
                            const clamped = Math.max(1, Math.min(64, Math.round(next)));
                            setKiteSetupChordCount(clamped);
                            broadcastWizardStudioParam({
                              kiteSetupChordCount: clamped,
                              bpi: Math.max(1, Math.round(clamped * kiteSetupTimeSignatureTop)),
                            });
                          }}
                          placeholder="e.g. 10"
                          className="w-32 rounded-lg border border-stone-700 bg-stone-900 px-4 py-3 text-sm font-semibold text-stone-100 placeholder:text-stone-500"
                          inputMode="numeric"
                        />
                        <span className="text-sm font-semibold text-stone-400">
                          chords per cycle
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {kiteSetupStep === 3 ? (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-bold tracking-tight text-stone-100">How fast?</h3>
                      <p className="mt-1 text-sm font-medium leading-relaxed text-stone-400">
                        Tap the button in rhythm, or drag the slider.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { label: "Slow", bpm: 75 },
                        { label: "Medium", bpm: 120 },
                        { label: "Upbeat", bpm: 155 },
                      ].map((option) => (
                        <button
                          key={option.label}
                          type="button"
                          onClick={() => {
                            setKiteSetupTempo(option.bpm);
                            broadcastWizardStudioParam({
                              kiteSetupTempo: option.bpm,
                              bpm: option.bpm,
                            });
                          }}
                          className="rounded-full border border-stone-600 bg-stone-800/60 px-4 py-2 text-sm font-semibold text-stone-300 transition hover:bg-stone-700"
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-5 pt-5">
                      <input
                        type="range"
                        min={40}
                        max={240}
                        step={1}
                        value={kiteSetupTempo}
                        onChange={(event) => {
                          const v = Number(event.target.value);
                          setKiteSetupTempo(v);
                          broadcastWizardStudioParam({ kiteSetupTempo: v, bpm: v });
                        }}
                        className="h-2 flex-1 accent-stone-300"
                        aria-label="Kite Sync tempo"
                      />
                      <div className="min-w-16 text-right">
                        <div className="text-3xl font-bold leading-none text-stone-100">
                          {kiteSetupTempo}
                        </div>
                        <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-stone-400">
                          BPM
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleTapBeat}
                      className="w-full rounded-xl border border-stone-600 bg-stone-900/50 px-4 py-3 text-base font-bold text-stone-200 transition hover:bg-stone-800"
                    >
                      Tap the beat ♪
                    </button>
                    <p className="text-center text-xs font-semibold text-stone-400">
                      Tap 4+ times â€” resets after 2 seconds of silence
                    </p>
                  </div>
                ) : null}

                {kiteSetupStep === 4 ? (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold text-stone-100">Mode</h3>
                      <p className="mt-1 text-xs leading-relaxed text-stone-500">
                        Choose whether to practice alone or prepare to jam with someone.
                      </p>
                    </div>
                    <div className="grid gap-3">
                      {[
                        { mode: "solo" as const, title: "Practice Alone", copy: "Start the Solo Looper first." },
                        { mode: "sync" as const, title: "Jam With Someone", copy: "Prepare Kite Sync for collaboration." },
                      ].map((option) => (
                        <button
                          key={option.mode}
                          type="button"
                          onClick={() => setKiteSetupMode(option.mode)}
                          className={`rounded-xl border px-4 py-3 text-left transition ${
                            kiteSetupMode === option.mode
                              ? "border-emerald-500/45 bg-emerald-500/15"
                              : "border-stone-700 bg-stone-900/50 hover:bg-stone-800"
                          }`}
                        >
                          <span className="block text-sm font-semibold text-stone-100">
                            {option.title}
                          </span>
                          <span className="mt-1 block text-xs text-stone-500">{option.copy}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {kiteSetupStep === 5 ? (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-bold tracking-tight text-stone-100">
                        Your loop is ready
                      </h3>
                      <p className="mt-1 text-sm font-medium leading-relaxed text-stone-400">
                        Here&apos;s what we&apos;ve set up in plain terms.
                      </p>
                    </div>
                    <div className="rounded-xl bg-stone-900/70 px-5 py-4 text-sm font-semibold text-stone-300">
                      {[
                        {
                          label: "Beat grouping",
                          value: `${kiteSetupTimeSignatureTop}/${kiteSetupTimeSignatureBottom}${
                            kiteSetupIsSwing ? " swing" : ""
                          }`,
                        },
                        { label: "Chord cycle", value: `${kiteSetupChordCount} chords` },
                        {
                          label: "Loop length (BPI)",
                          value: `${kiteSetupChordCount} bars  (1× chord cycle)`,
                        },
                        { label: "Tempo", value: `${kiteSetupTempo} BPM` },
                        {
                          label: "Each loop lasts",
                          value: `${Math.round(
                            (60 / kiteSetupTempo) *
                              kiteSetupTimeSignatureTop *
                              kiteSetupChordCount
                          )} seconds`,
                        },
                        {
                          label: "Wait for bandmate",
                          value: `${Math.round(
                            (60 / kiteSetupTempo) *
                              kiteSetupTimeSignatureTop *
                              kiteSetupChordCount
                          )} seconds`,
                          accent: true,
                        },
                      ].map((row) => (
                        <div
                          key={row.label}
                          className="flex items-center justify-between gap-3 border-b border-stone-700/70 py-2 last:border-0"
                        >
                          <span>{row.label}</span>
                          <span
                            className={`text-right text-base font-bold ${
                              row.accent ? "text-blue-400" : "text-stone-100"
                            }`}
                          >
                            {row.value}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="border-l-2 border-stone-600 pl-4 text-sm font-semibold leading-relaxed text-stone-300">
                      Your song is in {kiteSetupTimeSignatureTop}/{kiteSetupTimeSignatureBottom}
                      {kiteSetupIsSwing ? " swing" : ""} â€” each bar has{" "}
                      {kiteSetupTimeSignatureTop} beats. We set the loop to {kiteSetupChordCount}{" "}
                      bars so your {kiteSetupChordCount}-chord cycle completes cleanly before the
                      next loop starts. Your bandmate will always hear a full phrase, never a
                      cut-off chord.
                    </div>
                    <motion.button
                      type="button"
                      onClick={handleConfirmKiteSetup}
                      whileTap={{ scale: 0.97 }}
                      className="w-full rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-4 py-3 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/22"
                    >
                      Confirm & Launch
                    </motion.button>
                  </div>
                ) : null}
              </div>

              {kiteSetupError ? (
                <p className="mt-3 rounded-lg border border-red-500/30 bg-red-950/20 px-3 py-2 text-xs font-medium text-red-200">
                  {kiteSetupError}
                </p>
              ) : null}

              <div className="mt-5 flex items-center justify-between gap-3">
                <motion.button
                  type="button"
                  disabled={kiteSetupStep === 1}
                  onClick={goToPreviousKiteSetupStep}
                  whileTap={kiteSetupStep === 1 ? undefined : { scale: 0.97 }}
                  className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
                    kiteSetupStep === 1
                      ? "cursor-not-allowed border-stone-800 bg-stone-900/40 text-stone-600"
                      : "border-stone-700 bg-stone-900/60 text-stone-200 hover:bg-stone-800"
                  }`}
                >
                  Previous
                </motion.button>
                <motion.button
                  type="button"
                  disabled={kiteSetupStep === 5}
                  onClick={goToNextKiteSetupStep}
                  whileTap={kiteSetupStep === 5 ? undefined : { scale: 0.97 }}
                  className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
                    kiteSetupStep === 5
                      ? "cursor-not-allowed border-stone-800 bg-stone-900/40 text-stone-600"
                      : "border-orange-500/35 bg-orange-500/12 text-orange-100 hover:bg-orange-500/18"
                  }`}
                >
                  Next
                </motion.button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-8 space-y-4"
            >
              {kiteMode !== "solo" ? largeRoomCodeCard : null}
              {kiteMode !== "solo" && status === "connected" ? (
                <div className="relative">
                {kiteMode === "broadcast" ? (
                  <BroadcastDashboard
                    metronomeBpm={metronomeBpm}
                    visualActiveBeatInBar={visualActiveBeatInBar}
                    broadcastStatus={broadcastStatus}
                    kiteSyncCountInActive={kiteSyncCountInActive}
                    kiteSyncEnabled={kiteSyncEnabled}
                    canStartSync={canStartSync}
                    canControlStop={canControlStop}
                    remoteParticipantName={remoteParticipantName}
                    syncInitiatorId={syncInitiatorId}
                    localJamSetupOwnerId={localJamSetupOwnerId}
                    onStartCountIn={handleStartBroadcastCountIn}
                    onStopSync={broadcastKiteSyncStop}
                  />
                ) : (
                <>
                  <div className="flex flex-wrap items-center justify-center gap-3 rounded-xl border border-stone-700 bg-stone-950/80 px-4 py-3 text-center">
                    <div className="w-full text-center">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">
                        Participants: {remoteParticipantName ? "2/2" : "1/2"}
                      </p>
                      <p className="mt-1 text-xs font-medium text-stone-300">
                        Remote: {remoteParticipantName ?? "Waiting..."}
                      </p>
                    </div>
                    <div className="font-mono text-sm text-stone-200">
                      Ping:{" "}
                      <span
                        className={`font-mono ${
                          pingMs === null
                            ? "text-gray-400"
                            : pingMs < 30
                              ? "text-emerald-400"
                              : pingMs < 70
                                ? "text-orange-400"
                                : "text-red-500"
                        }`}
                      >
                        {pingMs === null ? "-- ms" : `${pingMs} ms`}
                      </span>
                    </div>
                    <div className="font-mono text-sm text-stone-200">
                      Loss:{" "}
                      <span
                        className={`font-mono ${
                          inboundPacketLossPercent === null
                            ? "text-gray-400"
                            : inboundPacketLossPercent < 0.5
                              ? "text-emerald-400"
                              : inboundPacketLossPercent < 2
                                ? "text-orange-400"
                                : "text-red-500"
                        }`}
                      >
                        {inboundPacketLossPercent === null ? "--" : `${inboundPacketLossPercent}%`}
                      </span>
                    </div>
                    <div className="font-mono text-sm text-stone-200">
                      Delay:{" "}
                      <span
                        className={`font-mono ${
                          calculatedDelayMs === null
                            ? "text-gray-400"
                            : calculatedDelayMs < 20
                              ? "text-emerald-400"
                              : calculatedDelayMs < 50
                                ? "text-orange-400"
                                : "text-red-500"
                        }`}
                      >
                        {calculatedDelayMs === null ? "-- ms" : `${calculatedDelayMs} ms`}
                      </span>
                    </div>
                    <motion.button
                      type="button"
                      disabled={jamSetupLockedByRemote}
                      onClick={() => {
                        if (sendJamSetupLock("acquire")) {
                          handleStartKiteSetup("connected");
                        }
                      }}
                      whileTap={jamSetupLockedByRemote ? undefined : { scale: 0.97 }}
                      className={`w-full rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                        jamSetupLockedByRemote
                          ? "cursor-not-allowed border-stone-700 bg-stone-900/60 text-stone-500"
                          : "border-emerald-500/35 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15"
                      }`}
                    >
                      {jamSetupLockedByRemote ? "Bandmate is setting up..." : "Start Kite Sync"}
                    </motion.button>
                    {kiteSyncNetworkMetronomePaused && kiteSyncEnabled ? (
                      <div className="w-full rounded-lg border border-orange-500/30 bg-orange-950/25 px-3 py-2 text-left text-[11px] font-medium leading-snug text-orange-200/95">
                        Metronome paused: inbound loss exceeded {KITE_SYNC_LOSS_PAUSE_PCT}%. It
                        resumes after loss stays below {KITE_SYNC_LOSS_RESUME_PCT}% for a few
                        seconds (hysteresis).
                      </div>
                    ) : null}
                    <div className="w-full rounded-lg border border-stone-800/80 bg-stone-900/40 px-3 py-2">
                      <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-stone-500">
                        <span>Shared Metronome</span>
                        <div
                          ref={metronomeBlinkElementRef}
                          className="h-2.5 w-2.5 rounded-full bg-stone-700 transition-all duration-75"
                          aria-hidden
                        />
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={stealthBroadcastUiLock}
                          onClick={() => toggleKiteSync()}
                          className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                            kiteSyncEnabled
                              ? "border-emerald-500/40 bg-emerald-500/12 text-emerald-200 hover:bg-emerald-500/18"
                              : "border-stone-700 bg-stone-900/60 text-stone-300 hover:bg-stone-800"
                          }`}
                          aria-pressed={kiteSyncEnabled}
                        >
                          {kiteSyncEnabled ? "Enabled" : "Disabled"}
                        </button>
                        <button
                          type="button"
                          disabled={stealthBroadcastUiLock}
                          onClick={() => setIsBufferingEnabled(!isBufferingEnabled)}
                          className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                            isBufferingEnabled
                              ? "border-blue-500/40 bg-blue-500/12 text-blue-200 hover:bg-blue-500/18"
                              : "border-stone-700 bg-stone-900/60 text-stone-300 hover:bg-stone-800"
                          }`}
                          aria-pressed={isBufferingEnabled}
                        >
                          Buffer {isBufferingEnabled ? "On" : "Off"}
                        </button>
                        <button
                          type="button"
                          disabled={stealthBroadcastUiLock}
                          onClick={() => setEchoSafetyMode(!echoSafetyMode)}
                          className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                            echoSafetyMode
                              ? "border-yellow-500/40 bg-yellow-500/15 text-yellow-100 hover:bg-yellow-500/22"
                              : "border-stone-700 bg-stone-900/60 text-stone-300 hover:bg-stone-800"
                          }`}
                          aria-pressed={echoSafetyMode}
                        >
                          Echo Safety {echoSafetyMode ? "On" : "Off"}
                        </button>
                        <span className="rounded-md border border-yellow-500/35 bg-yellow-500/10 px-2 py-1 text-[10px] font-semibold text-yellow-200">
                          âš ï¸ Headphones Required for Sync Buffer. If using speakers, enable Echo Safety.
                        </span>
                        {studioAudioContextRef.current?.state !== "running" ? (
                          <button
                            type="button"
                            disabled={stealthBroadcastUiLock}
                            onClick={() => {
                              void (async () => {
                                const ctx = studioAudioContextRef.current;
                                if (!ctx || ctx.state === "closed") {
                                  setAudioContextReady(false);
                                  return;
                                }
                                try {
                                  await ctx.resume();
                                } catch {
                                  setAudioContextReady(false);
                                  return;
                                }
                                setAudioContextReady(ctx.state === "running");
                              })();
                            }}
                            className="rounded-md border border-orange-500/35 bg-orange-500/12 px-2.5 py-1 text-[11px] font-semibold text-orange-200 transition-colors hover:bg-orange-500/18 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            🔊 Resume Audio
                          </button>
                        ) : null}
                        {renderVisualMetronomeControls()}
                        <label className="flex items-center gap-1 text-[11px] text-stone-300">
                          <span className="uppercase tracking-wider text-stone-500">BPM</span>
                          {stealthBroadcastUiLock ? (
                            <span
                              className="min-w-[4rem] rounded border border-stone-700 bg-stone-900/80 px-2 py-1 text-right text-[11px] text-stone-200 tabular-nums"
                              aria-label={`Tempo ${metronomeBpm} BPM`}
                            >
                              {metronomeBpm}
                            </span>
                          ) : (
                            <input
                              type="number"
                              min={40}
                              max={240}
                              value={metronomeBpm}
                              onChange={(e) => {
                                const next = Number(e.target.value);
                                if (!Number.isFinite(next)) return;
                                setMetronomeBpm((prev) => {
                                  const normalized = Math.max(40, Math.min(240, Math.round(next)));
                                  if (normalized === prev) return prev;
                                  broadcastStudioParam({ bpm: normalized });
                                  return normalized;
                                });
                              }}
                              className="w-16 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-right text-[11px] text-stone-100"
                              inputMode="numeric"
                            />
                          )}
                        </label>
                        <label className="flex w-full min-w-[12rem] flex-col gap-1.5 text-[11px] text-stone-300 sm:min-w-0 sm:max-w-xs">
                          <span className="uppercase tracking-wider text-stone-500">
                            Metronome Vol
                          </span>
                          <input
                            type="range"
                            min={0}
                            max={2}
                            step={0.1}
                            value={metronomeVolume}
                            onChange={onMetronomeVolumeSliderChange}
                            className="h-2 w-full min-w-0 accent-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                            aria-label="Metronome volume"
                          />
                        </label>
                      </div>
                    </div>
                    <div className="w-full rounded-lg border border-stone-800/80 bg-stone-900/40 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">
                        Sync Buffer
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-stone-300">
                        <div>
                          Status:{" "}
                          <span
                            className={`font-semibold ${
                              isBufferPrimed ? "text-emerald-400" : "text-yellow-300"
                            }`}
                          >
                            {isBufferPrimed ? "Primed" : "Filling"}
                          </span>
                        </div>
                        <div>
                          Depth:{" "}
                          <span className="font-mono text-stone-100">
                            {Math.round(
                              bufferDepthFrames / (getStudioKiteSampleRate() / 1000)
                            )} ms
                          </span>
                        </div>
                        <div>
                          Correction:{" "}
                          <span className="font-mono uppercase text-stone-100">
                            {lastCorrectionEvent}
                          </span>
                        </div>
                        <label className="ml-auto flex items-center gap-2">
                          <span className="flex items-center uppercase tracking-wider text-stone-500">
                            Safety
                            <button
                              type="button"
                              disabled={stealthBroadcastUiLock}
                              onClick={() => setIsAutoBuffer(!isAutoBuffer)}
                              className={`ml-2 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${
                                isAutoBuffer
                                  ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-400"
                                  : "border-stone-700 bg-stone-800 text-stone-500"
                              } disabled:cursor-not-allowed disabled:opacity-40`}
                            >
                              {isAutoBuffer ? "Auto" : "Manual"}
                            </button>
                          </span>
                          <input
                            type="range"
                            min={480}
                            max={19200}
                            step={120}
                            value={targetLeadFrames}
                            disabled={stealthBroadcastUiLock}
                            onChange={(e) => {
                              const next = Number(e.target.value);
                              if (!Number.isFinite(next)) return;
                              setIsAutoBuffer(false);
                              setTargetLeadFrames(Math.max(0, Math.round(next)));
                            }}
                            className={`w-28 accent-orange-400 ${isAutoBuffer ? "opacity-60" : ""} disabled:cursor-not-allowed disabled:opacity-30`}
                          />
                          <input
                            type="number"
                            min={480}
                            max={19200}
                            step={120}
                            value={targetLeadFrames}
                            disabled={stealthBroadcastUiLock}
                            onChange={(e) => {
                              const next = Number(e.target.value);
                              if (!Number.isFinite(next)) return;
                              setIsAutoBuffer(false);
                              setTargetLeadFrames(Math.max(0, Math.round(next)));
                            }}
                            className={`w-20 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-right text-[11px] text-stone-100 ${isAutoBuffer ? "opacity-60" : ""} disabled:cursor-not-allowed disabled:opacity-30`}
                            inputMode="numeric"
                          />
                        </label>
                      </div>
                    </div>
                    <div className="ml-auto flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={toggleMic}
                        disabled={
                          !localMicStream ||
                          (syncCountInBlocksLive && isMicMuted) ||
                          stealthBroadcastUiLock
                        }
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
                          isMicMuted
                            ? "border-orange-500/35 bg-orange-500/10 text-orange-200/90 hover:bg-orange-500/15"
                            : "border-stone-700 bg-stone-900/50 text-emerald-300 hover:bg-stone-800"
                        } ${!localMicStream ? "cursor-not-allowed border-stone-800 text-stone-500 hover:bg-stone-900/50" : ""}`}
                        aria-label={isMicMuted ? "Enable microphone" : "Mute microphone"}
                        aria-pressed={isMicMuted}
                      >
                        {isMicMuted ? <MicOff className="h-3.5 w-3.5" aria-hidden /> : <Mic className="h-3.5 w-3.5" aria-hidden />}
                        <span>Mic</span>
                      </button>
                      <button
                        type="button"
                        onClick={toggleSpeaker}
                        disabled={
                          !remoteStream ||
                          (syncCountInBlocksLive && isSpeakerMuted) ||
                          stealthBroadcastUiLock
                        }
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
                          isSpeakerMuted
                            ? "border-stone-700 bg-stone-900/50 text-stone-300 hover:bg-stone-800"
                            : "border-emerald-500/35 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15"
                        } ${!remoteStream ? "cursor-not-allowed border-stone-800 text-stone-500 hover:bg-stone-900/50" : ""}`}
                        aria-label={isSpeakerMuted ? "Enable speaker" : "Mute speaker"}
                        aria-pressed={isSpeakerMuted}
                      >
                        {isSpeakerMuted ? <VolumeX className="h-3.5 w-3.5" aria-hidden /> : <Volume2 className="h-3.5 w-3.5" aria-hidden />}
                        <span>Spk</span>
                      </button>
                      <input
                        type="range"
                        min={REMOTE_PLAYBACK_VOLUME_MIN}
                        max={REMOTE_PLAYBACK_VOLUME_MAX}
                        step={0.1}
                        value={remotePlaybackVolume}
                        onChange={onRemotePlaybackVolumeSliderChange}
                        disabled={!remoteStream || syncCountInBlocksLive || stealthBroadcastUiLock}
                        aria-label="Remote playback volume"
                        className="h-2 w-24 shrink-0 accent-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </div>
                  </div>
                  {highPingTipOpen ? (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-xl border border-orange-500/35 bg-stone-900/85 px-4 py-3 shadow-lg"
                      role="status"
                    >
                      <p className="text-center text-sm font-medium leading-relaxed text-stone-200">
                        Latency has stayed high. Try a different network, switch to Wiâ€‘Fi, or move
                        closer to your router.
                      </p>
                      <div className="mt-3 flex justify-center">
                        <button
                          type="button"
                          onClick={dismissHighPingTip}
                          className="rounded-lg border border-stone-600 bg-stone-800/60 px-3 py-1.5 text-xs font-semibold text-stone-300 transition hover:bg-stone-800"
                        >
                          Dismiss
                        </button>
                      </div>
                    </motion.div>
                  ) : null}
                  {localMicStream ? (
                    <div className="rounded-xl border border-stone-800/90 bg-stone-950/40 px-4 py-3">
                      <MicLevelBars stream={localMicStream} />
                      <p className="mt-2 text-center text-[10px] font-semibold uppercase tracking-wider text-stone-500">
                        Default Input Level
                      </p>
                    </div>
                  ) : null}
                  {remoteStream && remoteMeterTapActive ? (
                    <div className="rounded-xl border border-stone-800/90 bg-stone-950/40 px-4 py-3">
                      <ExternalLevelBars heights={remoteMeterHeights} />
                      <p className="mt-2 text-center text-[10px] font-semibold uppercase tracking-wider text-stone-500">
                        Incoming Remote Level
                      </p>
                    </div>
                  ) : null}
                  <div className="rounded-xl border border-stone-800/90 bg-stone-950/40 px-4 py-3">
                    <p className="text-center text-[10px] font-semibold uppercase tracking-wider text-stone-500">
                      Local Track Recorder
                    </p>
                    {!isRecording && !recordedBlobUrl ? (
                      <motion.button
                        type="button"
                        onClick={startLocalRecording}
                        disabled={!localMicStream}
                        whileTap={localMicStream ? { scale: 0.97 } : undefined}
                        className={`mt-3 w-full rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
                          localMicStream
                            ? "border-orange-500/35 bg-gradient-to-r from-orange-500/12 to-emerald-500/12 text-stone-100 hover:from-orange-500/20 hover:to-emerald-500/20"
                            : "cursor-not-allowed border-stone-700 bg-stone-900/60 text-stone-500"
                        }`}
                      >
                        Start Recording
                      </motion.button>
                    ) : null}
                    {isRecording ? (
                      <motion.button
                        type="button"
                        onClick={() => void stopLocalRecording()}
                        whileTap={{ scale: 0.97 }}
                        className="mt-3 w-full rounded-xl border border-red-500/45 bg-gradient-to-r from-red-600/80 to-orange-600/80 px-4 py-2.5 text-sm font-semibold text-white transition hover:from-red-500 hover:to-orange-500"
                      >
                        Stop Recording ({formatRecordingTime(recordingTimeMs)})
                      </motion.button>
                    ) : null}
                    {!isRecording && recordedBlobUrl ? (
                      <div className="mt-3 flex items-center gap-2">
                        <a
                          href={recordedBlobUrl}
                          download={`my-track.${recordedDownloadExt}`}
                          className="flex-1 rounded-xl border border-emerald-500/35 bg-gradient-to-r from-emerald-500/15 to-stone-700/20 px-3 py-2 text-center text-sm font-semibold text-emerald-200 transition hover:from-emerald-500/25 hover:to-stone-700/30"
                        >
                          Download Track
                        </a>
                        <motion.button
                          type="button"
                          onClick={clearRecordedBlobUrl}
                          whileTap={{ scale: 0.97 }}
                          className="rounded-xl border border-stone-700 bg-stone-900/50 px-3 py-2 text-sm font-semibold text-stone-200 transition hover:bg-stone-800"
                        >
                          Record New Track
                        </motion.button>
                      </div>
                    ) : null}
                  </div>
                </>
                )}
                {kiteSyncCountInActive && kiteSyncEnabled ? (
                  <div
                    className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-xl bg-stone-950/86 px-4 py-6 text-center backdrop-blur-[2px]"
                    role="status"
                    aria-live="polite"
                  >
                    <p className="text-sm font-semibold text-stone-100">One-bar sync count-in…</p>
                    <p className="max-w-xs text-xs font-medium leading-relaxed text-stone-400">
                      A one-bar count-in is playing to lock the grid. Unmute and volume controls will unlock when it finishes.
                    </p>
                  </div>
                ) : null}
              </div>
              ) : null}

              {role === "host" && inviteLink && kiteMode !== "solo" ? (
                <motion.button
                  type="button"
                  onClick={() => void copyInviteLink()}
                  className="w-full rounded-xl border border-orange-500/35 bg-gradient-to-r from-orange-500/15 to-emerald-500/15 px-4 py-3 text-sm font-semibold text-stone-100 transition hover:from-orange-500/25 hover:to-emerald-500/25"
                  whileTap={{ scale: 0.97 }}
                >
                  Copy Invite Link
                </motion.button>
              ) : null}

              {kiteMode !== "solo" ? (
                <p className="text-center text-xs text-stone-500">
                  {status === "connected" ? statusNote : (bridgeInitError ?? statusNote)}
                </p>
              ) : null}
            </motion.div>
          )}

          {connectionLostCountdown !== null && !collaboratorLeft ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 rounded-xl border border-stone-700 bg-stone-900/40 px-4 py-4 text-center"
            >
              <p className="text-sm font-semibold text-stone-200">
                {connectionLostCountdown > 0
                  ? "Connection lost. Attempting to reconnect..."
                  : "Signal timed out."}
              </p>
              {connectionLostCountdown > 0 ? (
                <p className="mt-1 text-xs text-stone-400">
                  Signal retry window: {connectionLostCountdown}s
                </p>
              ) : null}
            </motion.div>
          ) : null}
            </>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="mt-10 w-full rounded-2xl border border-emerald-500/30 bg-stone-950/60 p-6 shadow-2xl backdrop-blur-sm"
              style={{
                boxShadow: `
                  0 0 0 1px rgba(34,197,94,0.12),
                  0 0 40px -16px rgba(255,69,0,0.2),
                  0 0 48px -18px rgba(34,197,94,0.15),
                  0 20px 40px -20px rgba(0,0,0,0.65)
                `,
              }}
            >
              <p className="text-center text-[11px] font-semibold uppercase tracking-widest text-stone-500">
                Sign in required
              </p>
              <p className="mt-3 text-center text-sm font-medium leading-relaxed text-stone-300">
                Log in to host or join a session.
              </p>
              <motion.button
                type="button"
                onClick={() => router.push("/")}
                whileTap={{ scale: 0.98 }}
                className="mt-6 w-full rounded-xl border border-orange-500/40 bg-gradient-to-r from-orange-500/18 to-emerald-500/18 px-4 py-3.5 text-sm font-semibold text-stone-100 shadow-lg transition hover:from-orange-500/28 hover:to-emerald-500/28"
                style={{
                  boxShadow: `0 0 24px -8px ${ORANGE}66, 0 0 28px -10px ${EMERALD}55`,
                }}
              >
                Log in to host or join a session
              </motion.button>
            </motion.div>
          )}
        </motion.div>
      </div>
      {studioUiPhase === "studio" && kiteMode !== "solo" ? (
        <motion.nav
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed left-4 top-4 z-[9999] flex items-center"
          aria-label="Broadcast session controls"
        >
          <button
            type="button"
            onClick={returnToLobby}
            className="rounded-xl border border-red-400/70 px-4 py-2 text-[11px] font-semibold text-red-400 transition hover:border-red-300 hover:text-red-300 focus:outline-none focus:ring-2 focus:ring-red-400/40"
          >
            End Session
          </button>
        </motion.nav>
      ) : null}
      {studioUiPhase !== "lobby" &&
      studioUiPhase !== "kite-setup" &&
      kiteMode === "solo" ? (
        <div className="caret-transparent outline-none select-none">
        <KiteLoopV4Panel
          looperState={{
            soloLooperState,
            isRecordingArmed,
            isMasterPaused,
            sessionRecorderState: soloSessionRecorderState,
            recordingArmedCountdown,
            runwayDisplay: soloRunwayDisplay,
            runwayPhase: isRecordingArmed ? "armed" : "idle",
            runwayVisualOnly: isVisualMetronomeOnly,
            loopProgress,
            focusedTrackIndex,
            soloTrackLanes,
            showCalibrationOnboardingHint: soloLooperLatencyMs <= 0,
            latencyCalibrationStale: soloLatencyCalibrationStale,
          }}
          looperConfig={{
            loopMode: soloLooperMode,
            barCount: soloLooperBarCount,
            latencyMs: soloLooperLatencyMs,
            kiteSetupTempo,
            kiteSetupTimeSignatureTop,
            kiteSetupTimeSignatureBottom,
            kiteSetupIsSwing,
            isTimingLocked: isRecordingArmed || soloLooperState !== "idle",
            kiteIntervalTimingRef,
          }}
          looperHandlers={{
            onRecordFirstLoop: handleRecordFirstLoop,
            onToggleMasterPause: handleToggleMasterPause,
            onToggleSessionRecording: handleToggleSoloSessionRecording,
            onStopAndResetSoloLooper: handleStopAndResetSoloLooper,
            onEndSession: returnToLobby,
            onLoopModeChange: setSoloLooperMode,
            onBarCountChange: setSoloLooperBarCount,
            onLatencyMsChange: handleSoloLatencyMsChange,
            onAutoCalibrateLatency: handleAutoCalibrateSoloLatency,
            autoCalibrateLatencyStatus: soloLatencyCalibrationStatus,
            autoCalibrateLatencyMessage: soloLatencyCalibrationMessage,
            latencyCalibrationStale: soloLatencyCalibrationStale,
            latencyStaleMessage: soloLatencyStaleMessage,
            entryLatencyMs,
            onTempoSliderChange: (v) => {
              setKiteSetupTempo(v);
              broadcastWizardStudioParam({ kiteSetupTempo: v, bpm: v });
            },
            onTempoPreset: (bpm) => {
              setKiteSetupTempo(bpm);
              broadcastWizardStudioParam({
                kiteSetupTempo: bpm,
                bpm,
              });
            },
            onSelectTimeSignature: (option) => {
              setKiteSetupTimeSignatureTop(option.top);
              setKiteSetupTimeSignatureBottom(option.bottom);
              setKiteSetupIsSwing(option.swing);
              const bpi = Math.max(1, Math.round(kiteSetupChordCount * option.top));
              broadcastWizardStudioParam({
                kiteSetupTimeSignatureTop: option.top,
                kiteSetupTimeSignatureBottom: option.bottom,
                bpi,
              });
            },
          }}
          inputDevices={inputDevicesForPanel}
          metronome={{
            visualMetronomeControls: renderVisualMetronomeControls(),
            currentBeatIndex: visualActiveBeatInBar,
            metronomeVolume,
            onMetronomeVolumeChange,
          }}
          studioAudioContextRef={studioAudioContextRef}
          activeStreamsMapRef={activeStreamsMapRef}
          soloTrackSlotUiLatestRef={soloTrackSlotUiLatestRef}
        />
        </div>
      ) : null}
    </div>
  );
}
