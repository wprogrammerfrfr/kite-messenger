import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");
const pagePath = path.join(root, "app/studio-bridge/page.tsx");
const outPath = path.join(root, "hooks/useKiteStudioEngine.ts");

const lines = fs.readFileSync(pagePath, "utf8").split(/\r?\n/);

const helpers = lines.slice(75, 334).join("\n");
const helperText = helpers
  .replace(/^type BridgeStatus = .*$/m, "")
  .replace(/^type StudioUiPhase = .*$/m, "")
  .replace(/^type Role = .*$/m, "")
  .replace(/^type KiteSetupStep = .*$/m, "")
  .replace(/^type KiteMode = .*$/m, "")
  .replace(/^type BroadcastStatus = .*$/m, "")
  .replace(/^type SoloLooperState = .*$/m, "")
  .replace(/^type SoloSessionRecorderState = .*$/m, "")
  .replace(/^type JamSetupLock = .*$/m, "")
  .replace(/^type KiteSetupOrigin = .*$/m, "")
  .replace(/^type DeviceFlagMap = .*$/m, "")
  .replace(/^type KiteLoopChunkSendProgress = \{[\s\S]*?\};\r?\n/m, "");

const includeRanges = [
  [518, 2231],
  [2265, 2268],
  [2279, 4813],
  [4896, 5435],
  [5485, 5719],
  [5721, 7336],
  [7391, 7401],
];

const bodyParts = [];
for (const [start, end] of includeRanges) {
  bodyParts.push(...lines.slice(start - 1, end));
}

let body = bodyParts.join("\n");

body = body.replace(
  /^\s*const router = useRouter\(\);/m,
  `  const { router, ui, initialSessionId, onAuthUserChange, onAuthReadyChange } = config;`
);

body = body.replace(
  /const localJamSetupOwnerId = user\?\.id \?\? `\$\{role \?\? "unknown"\}:\$\{sessionId \?\? "local"\}`;/,
  "const localJamSetupOwnerId = ui.getUser()?.id ?? user?.id ?? `${role ?? \"unknown\"}:${sessionId ?? \"local\"}`;"
);

body = body.replace(
  /setUser\(next \?\? null\);\s*\r?\n\s*setAuthReady\(true\);/g,
  "setUser(next ?? null);\n      onAuthUserChange?.(next ?? null);\n      setAuthReady(true);\n      onAuthReadyChange?.(true);"
);
body = body.replace(
  /setUser\(session\?\.user \?\? null\);\s*\r?\n\s*setAuthReady\(true\);/g,
  "setUser(session?.user ?? null);\n      onAuthUserChange?.(session?.user ?? null);\n      setAuthReady(true);\n      onAuthReadyChange?.(true);"
);

body = body.replace(
  /const track1Mode = soloTrackSlotUi\?\.\[0\]\?\.mode;/g,
  "const track1Mode = soloTrackSlotUi?.[0]?.mode;"
);

const returnBlock = `

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

  const engineState: KiteEngineState = {
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
    isRecordingArmed,
    soloTrackVolumes,
    soloMasterLoopFrames,
    soloLooperLatencyMs,
    soloInputGain,
    soloLatencyCalibrationStatus,
    soloLatencyCalibrationMessage,
    soloLooperMode,
    soloLooperBarCount,
    isMasterPaused,
    soloSessionRecorderState,
    kiteSyncCountInActive,
    metronomeVolume,
    retryInitTick,
    kiteIntervalTimingRef,
  };

  const engineActions: KiteEngineActions = {
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
    startSoloLooper: async () => {
      const timing = deriveKiteTimingMetadata();
      await startSoloLooperRunner(timing);
    },
    handleRecordFirstLoop,
    commitActiveRecording,
    handleAutoCalibrateSoloLatency,
    handleSoloLatencyMsChange,
    handleStopAndResetSoloLooper,
    handleToggleMasterPause,
    handleResetSoloTrack,
    handleArmSoloOverdubTrack,
    onLooperPedalDown: () => onLooperPedalDown(soloPedalTargetTrackIndexRef.current),
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
  };

  const engineRefs: KiteEngineRefs = {
    remoteAudioRef,
    localMonitorAudioRef,
    metronomeBlinkElementRef,
    soloMeterElementRef,
    perChannelMeterRefs,
    masterLiveMeterElementRef,
  };

  return { engineState, engineActions, engineRefs };
`;

body = body + `\n  const startSoloLooperRunner = startSoloLooper;\n` + returnBlock;

const imports = `"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
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
import type { SoloLooperMode } from "@/components/kite-loop-v2/KiteLoopV2Panel";
import type {
  KiteEngineActions,
  KiteEngineConfig,
  KiteEngineRefs,
  KiteEngineState,
  UseKiteStudioEngineResult,
  StudioUiPhase,
  KiteSetupStep,
  BroadcastStatus,
  SoloLooperState,
  SoloSessionRecorderState,
  JamSetupLock,
  KiteSetupOrigin,
  DeviceFlagMap,
  KiteLoopChunkSendProgress,
} from "@/hooks/useKiteStudioEngine.types";

`;

const header = `${imports}
${helperText}

/**
 * Headless Kite Studio engine hook (Phase 8).
 * Orchestrates audio DSP, WebRTC, looper, and Kite Sync — UI shell wires props only.
 */
export function useKiteStudioEngine(config: KiteEngineConfig): UseKiteStudioEngineResult {
`;

const full = header + body + "\n}\n";
fs.writeFileSync(outPath, full, "utf8");
console.log(`Wrote ${outPath}`);
console.log(`Line count: ${full.split(/\r?\n/).length}`);
