import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");
const pagePath = path.join(root, "app/studio-bridge/page.tsx");
const outPath = pagePath;

const lines = fs.readFileSync(pagePath, "utf8").split(/\r?\n/);

// UI shell: helpers + components (lines 1-516, excluding engine-only imports we'll trim)
const uiHeader = `"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronLeft, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import {
  KiteLoopV4Panel,
  type KiteLoopV4InputDevicesProps,
  type SoloTrackLaneView,
} from "@/components/kite-loop-v2/KiteLoopV4Panel";
import type { SoloLooperPlaybackUiStateEvent } from "@/lib/solo-looper-engine";
import { useKiteStudioEngine } from "@/hooks/useKiteStudioEngine";
import type { KiteMode } from "@/hooks/useKiteSyncEngine";

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
  return \`\${String(minutes).padStart(2, "0")}:\${String(seconds).padStart(2, "0")}\`;
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
            height: \`\${Math.max(10, 6 + h * 34)}px\`,
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
            className={\`mt-1 text-sm font-medium \${state === "error" ? "text-red-300/95" : "text-stone-200"}\`}
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
`;

// Extract presenter-only blocks from original page
const broadcastDashboard = lines.slice(4813, 4894).join("\n");
const soloTrackLanesBlock = lines.slice(5436, 5483).join("\n");
const copyHelpers = lines.slice(7337, 7358).join("\n");
const inputDevicesBlock = lines.slice(7402, 7614).join("\n");
const visualMetronomeBlock = lines.slice(7615, 7636).join("\n");
const jsxReturn = lines.slice(7637).join("\n");

const hookBody = `
export default function StudioBridgePage() {
  const router = useRouter();
  const userRef = useRef<User | null>(null);

  const { engineState, engineActions, engineRefs, presenterState, presenterActions } =
    useKiteStudioEngine({
      router,
      ui: {
        setStudioUiPhase: () => {},
        setStatusNote: () => {},
        setBridgeInitError: () => {},
        setInviteLink: () => {},
        setCollaboratorLeft: () => {},
        setLastDepartedParticipantName: () => {},
        setRemoteParticipantName: () => {},
        setConnectionLostCountdown: () => {},
        setLoopProgress: () => {},
        setSoloRunwayDisplay: () => {},
        setSoloTrackSlotUi: () => {},
        setRecordingArmedCountdown: () => {},
        setFocusedTrackIndex: () => {},
        setSoloOverdubArmedTrackIndex: () => {},
        setSyncInitiatorId: () => {},
        setKiteSyncNetworkMetronomePaused: () => {},
        setVisualActiveBeatInBar: () => {},
        setRemoteMeterRafKey: () => {},
        setRemoteLevel: () => {},
        setRemoteMeterHeights: () => {},
        setLoopChunkSendError: () => {},
        setLoopChunkSendProgress: () => {},
        setKiteSetupError: () => {},
        setKiteSetupStep: () => {},
        setKiteSetupOrigin: () => {},
        setKiteSetupUsesCustomChords: () => {},
        setRecordingTimeMs: () => {},
        setRecordedBlobUrl: () => {},
        setRecordedDownloadExt: () => {},
        setHighPingTipOpen: () => {},
        getStudioUiPhase: () => "lobby",
        getUser: () => userRef.current,
        getAuthReady: () => true,
        getKiteSetupOrigin: () => "lobby",
        getConfirmExitOpen: () => false,
        setConfirmExitOpen: () => {},
      },
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
  const beatsPerInterval = engineState.beatsPerInterval;
  const isVisualMetronomeOnly = engineState.isVisualMetronomeOnly;
  const localMicStream = engineState.localMicStream;
  const echoSafetyMode = engineState.echoSafetyMode;
  const isBufferingEnabled = engineState.isBufferingEnabled;
  const isWorkletLoaded = engineState.isWorkletLoaded;
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
  const isRecordingArmed = engineState.isRecordingArmed;
  const soloTrackVolumes = engineState.soloTrackVolumes;
  const soloMasterLoopFrames = engineState.soloMasterLoopFrames;
  const soloLooperLatencyMs = engineState.soloLooperLatencyMs;
  const soloInputGain = engineState.soloInputGain;
  const soloLatencyCalibrationStatus = engineState.soloLatencyCalibrationStatus;
  const soloLatencyCalibrationMessage = engineState.soloLatencyCalibrationMessage;
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
  const lastDepartedParticipantName = presenterState.lastDepartedParticipantName;
  const connectionLostCountdown = presenterState.connectionLostCountdown;
  const user = presenterState.user;
  const authReady = presenterState.authReady;
  const devicePanelOpen = presenterState.devicePanelOpen;
  const kiteSetupStep = presenterState.kiteSetupStep;
  const kiteSetupUsesCustomChords = presenterState.kiteSetupUsesCustomChords;
  const kiteSetupOrigin = presenterState.kiteSetupOrigin;
  const kiteSetupError = presenterState.kiteSetupError;
  const loopProgress = presenterState.loopProgress;
  const recordingArmedCountdown = presenterState.recordingArmedCountdown;
  const soloRunwayDisplay = presenterState.soloRunwayDisplay;
  const soloTrackSlotUi = presenterState.soloTrackSlotUi;
  const focusedTrackIndex = presenterState.focusedTrackIndex;
  const soloOverdubArmedTrackIndex = presenterState.soloOverdubArmedTrackIndex;
  const loopChunkSendError = presenterState.loopChunkSendError;
  const loopChunkSendProgress = presenterState.loopChunkSendProgress;
  const syncInitiatorId = presenterState.syncInitiatorId;
  const kiteSyncNetworkMetronomePaused = presenterState.kiteSyncNetworkMetronomePaused;
  const useV4LooperUi = presenterState.useV4LooperUi;

  // Presenter actions aliases
  const setConfirmExitOpen = presenterActions.setConfirmExitOpen;
  const setRoomCopyNote = presenterActions.setRoomCopyNote;
  const setDevicePanelOpen = presenterActions.setDevicePanelOpen;
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
  const commitActiveRecording = engineActions.commitActiveRecording;
  const handleAutoCalibrateSoloLatency = engineActions.handleAutoCalibrateSoloLatency;
  const handleSoloLatencyMsChange = engineActions.handleSoloLatencyMsChange;
  const handleStopAndResetSoloLooper = engineActions.handleStopAndResetSoloLooper;
  const handleToggleMasterPause = engineActions.handleToggleMasterPause;
  const handleResetSoloTrack = engineActions.handleResetSoloTrack;
  const handleArmSoloOverdubTrack = engineActions.handleArmSoloOverdubTrack;
  const handleSoloTrackVolumeChange = engineActions.handleSoloTrackVolumeChange;
  const handleToggleSoloSessionRecording = engineActions.handleToggleSoloSessionRecording;
  const downloadSoloSessionBlob = engineActions.downloadSoloSessionBlob;
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
  const broadcastKiteSyncStop = engineActions.broadcastKiteSyncStop;

  // Engine refs
  const remoteAudioRef = engineRefs.remoteAudioRef;
  const localMonitorAudioRef = engineRefs.localMonitorAudioRef;
  const metronomeBlinkElementRef = engineRefs.metronomeBlinkElementRef;
  const soloMeterElementRef = engineRefs.soloMeterElementRef;

  const localJamSetupOwnerId = user?.id ?? \`\${role ?? "unknown"}:\${sessionId ?? "local"}\`;
  const isInStudioPhase = studioUiPhase === "studio";

  const kiteSignalSecure = kiteSignal === "secure";
  const canEnterStudio =
    studioUiPhase === "lobby" &&
    Boolean(localMicStream) &&
    audioTestDone &&
    kiteSignalSecure;
  const canPracticeAlone =
    studioUiPhase === "lobby" &&
    Boolean(localMicStream) &&
    audioTestDone;
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

  ${soloTrackLanesBlock.replace(
    "resetDisabled: !soloLooperEngineRef.current || isRecordingArmed,",
    'resetDisabled: isRecordingArmed || soloLooperState === "idle",'
  )}

  ${broadcastDashboard.replace(
    /broadcastKiteSync\(\{ kiteSyncEnabled: false \}\);[\s\S]*?setSyncInitiatorId\(null\);[\s\S]*?\}/,
    "broadcastKiteSyncStop();"
  )}

  ${copyHelpers}

  ${inputDevicesBlock}

  ${visualMetronomeBlock}

  ${jsxReturn}
}
`;

// Fix missing useState import in uiHeader
const fullPage =
  uiHeader.replace(
    'import {\n  useCallback,\n  useEffect,\n  useMemo,\n  useRef,\n  type ReactNode,\n} from "react";',
    'import {\n  useCallback,\n  useEffect,\n  useMemo,\n  useRef,\n  useState,\n  type ReactNode,\n} from "react";'
  ) + hookBody;

fs.writeFileSync(outPath, fullPage, "utf8");
console.log(`Wrote slim ${outPath}`);
console.log(`Line count: ${fullPage.split(/\r?\n/).length}`);
