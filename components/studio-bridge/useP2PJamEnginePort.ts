"use client";

/**
 * Maps useKiteStudioEngine facade → P2PJamPresenterPort.
 * No audio graph / transport logic — presentation mapping only.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useKiteSessionChat } from "@/hooks/useKiteSessionChat";
import type { UseKiteStudioEngineResult } from "@/hooks/useKiteStudioEngine.types";
import {
  KITE_SYNC_LOSS_PAUSE_PCT,
  KITE_SYNC_LOSS_RESUME_PCT,
} from "@/lib/p2p/kite-sync-loss";
import type {
  P2PJamActiveSnapshot,
  P2PJamPresenterPort,
  P2PJamSettingsState,
  P2PJamWizardState,
  P2PJamWizardTimeSignature,
} from "@/components/studio-bridge/P2PJamPresenter.types";

const OUTPUT_OPTIONS = [
  { id: "default", label: "Default — Speakers (Coming soon)" },
];

function tsFromEngine(top: number, bottom: number): P2PJamWizardTimeSignature {
  if (top === 4 && bottom === 4) return "4/4";
  if (top === 3 && bottom === 4) return "3/4";
  if (top === 6 && bottom === 8) return "6/8";
  return "custom";
}

function wizardFromEngine(
  engine: UseKiteStudioEngineResult["engineState"],
  step: 1 | 2 | 3 | 4 | 5
): P2PJamWizardState {
  const ts = tsFromEngine(engine.kiteSetupTimeSignatureTop, engine.kiteSetupTimeSignatureBottom);
  const chord = engine.kiteSetupChordCount;
  const barPreset = ([1, 2, 4, 8] as const).includes(chord as 1 | 2 | 4 | 8)
    ? (chord as 1 | 2 | 4 | 8)
    : ("custom" as const);
  return {
    step,
    bpm: engine.kiteSetupTempo,
    metronomeVolume: Math.round(Math.min(100, Math.max(0, engine.metronomeVolume * 50))),
    timeSignature: ts,
    customTop: engine.kiteSetupTimeSignatureTop,
    customBottom: engine.kiteSetupTimeSignatureBottom,
    barCount: barPreset,
    customBars: chord,
  };
}

function buildActiveJam(
  bpm: number,
  bars: number,
  timeSignature: string,
  metronomeVolume: number,
  beatsPerBar: number
): P2PJamActiveSnapshot {
  return {
    bpm,
    bars,
    timeSignature,
    metronomeVolume,
    loopSec: Math.round((60 / Math.max(1, bpm)) * beatsPerBar * bars),
  };
}

function peerPctFromLinear(linear: number): number {
  return Math.round(Math.min(200, Math.max(0, linear * 100)));
}

function linearFromPeerPct(pct: number): number {
  return Math.min(4, Math.max(0.5, pct / 100));
}

/**
 * P2P UI version flag.
 * Default = v2 (new UI). Explicit `?ui=v1` forces legacy fallback (old JSX retained, disconnected by default).
 * `?ui=v2` re-enables v2 and clears the v1 override.
 */
export function useP2PJamV2Flag(): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const ui = params.get("ui");
      if (ui === "v1") {
        window.localStorage.setItem("kite-p2p-ui-v2", "0");
        setOn(false);
        return;
      }
      if (ui === "v2") {
        window.localStorage.setItem("kite-p2p-ui-v2", "1");
        setOn(true);
        return;
      }
      // Default v2 unless user previously forced v1
      setOn(window.localStorage.getItem("kite-p2p-ui-v2") !== "0");
    } catch {
      setOn(true);
    }
  }, []);
  return on;
}

export function useP2PJamEnginePort(
  engine: UseKiteStudioEngineResult,
  opts: {
    localJamSetupOwnerId: string;
    onCopyRoomCode: () => void;
    onEndSession: () => void;
  }
): P2PJamPresenterPort {
  const { engineState, engineActions, engineRefs, presenterState, engineLegacy, sessionChatPort } =
    engine;

  const wizardOpen = presenterState.studioUiPhase === "kite-setup";
  const [wizardDraft, setWizardDraft] = useState<P2PJamWizardState>(() =>
    wizardFromEngine(engineState, 1)
  );

  // Seed wizard draft when kite-setup opens
  useEffect(() => {
    if (!wizardOpen) return;
    setWizardDraft(
      wizardFromEngine(engineState, Math.min(5, Math.max(1, presenterState.kiteSetupStep)) as 1 | 2 | 3 | 4 | 5)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed only on open / step change from engine
  }, [wizardOpen, presenterState.kiteSetupStep]);

  const chat = useKiteSessionChat({
    enabled: engineState.status === "connected" && engineState.kiteMode !== "solo",
    sessionId: engineState.sessionId,
    chatReady: presenterState.kiteChatReady,
    port: sessionChatPort,
  });

  const jamSetupLockedByRemote =
    engineState.jamSetupLock != null &&
    engineState.jamSetupLock.ownerId !== opts.localJamSetupOwnerId &&
    engineState.jamSetupLock.expiresAt > Date.now();

  const syncCountInBlocksLive =
    engineState.kiteSyncCountInActive && engineState.kiteSyncEnabled;

  const pushWizardToEngine = useCallback(
    (next: P2PJamWizardState) => {
      setWizardDraft(next);
      engineActions.setKiteSetupTempo(next.bpm);
      engineLegacy.broadcastWizardStudioParam({ kiteSetupTempo: next.bpm, bpm: next.bpm });

      let top = 4;
      let bottom = 4;
      if (next.timeSignature === "3/4") {
        top = 3;
        bottom = 4;
      } else if (next.timeSignature === "6/8") {
        top = 6;
        bottom = 8;
      } else if (next.timeSignature === "custom") {
        top = next.customTop;
        bottom = next.customBottom;
      }
      engineActions.setKiteSetupTimeSignatureTop(top);
      engineActions.setKiteSetupTimeSignatureBottom(bottom);
      engineActions.setKiteSetupIsSwing(false);

      const bars = next.barCount === "custom" ? next.customBars : next.barCount;
      engineActions.setKiteSetupChordCount(bars);
      const bpi = Math.max(1, Math.round(bars * top));
      engineLegacy.broadcastWizardStudioParam({
        kiteSetupTimeSignatureTop: top,
        kiteSetupTimeSignatureBottom: bottom,
        kiteSetupChordCount: bars,
        bpi,
      });

      // Metronome volume: UI 0–100 → engine 0–2
      engineActions.onMetronomeVolumeChange(next.metronomeVolume / 50);
    },
    [engineActions, engineLegacy]
  );

  const settings: P2PJamSettingsState = useMemo(
    () => ({
      outputDeviceId: "default",
      micMuted: engineState.isMicMuted,
      speakerMuted: engineState.isSpeakerMuted,
      peerVolume: peerPctFromLinear(engineState.remotePlaybackVolume),
      autoBuffer: engineState.isAutoBuffer,
      targetLeadFrames: engineState.targetLeadFrames,
      bufferingEnabled: engineState.isBufferingEnabled,
      echoSafetyMode: engineState.echoSafetyMode,
      metronomeBpm: engineState.metronomeBpm,
      metronomeVolume: Math.round(Math.min(100, Math.max(0, engineState.metronomeVolume * 50))),
      visualMetronomeOnly: engineState.isVisualMetronomeOnly,
    }),
    [engineState]
  );

  const activeJam: P2PJamActiveSnapshot | null = useMemo(() => {
    if (!engineState.kiteSyncEnabled) return null;
    const top = engineState.kiteSetupTimeSignatureTop || 4;
    const bottom = engineState.kiteSetupTimeSignatureBottom || 4;
    const bars = engineState.kiteSetupChordCount || 4;
    return buildActiveJam(
      engineState.metronomeBpm,
      bars,
      `${top}/${bottom}`,
      Math.round(engineState.metronomeVolume * 50),
      top
    );
  }, [engineState]);

  const onSettingsUpdate = useCallback(
    (patch: Partial<P2PJamSettingsState>) => {
      if (patch.bufferingEnabled != null) {
        engineActions.setIsBufferingEnabled(patch.bufferingEnabled);
      }
      if (patch.echoSafetyMode != null) {
        engineActions.setEchoSafetyMode(patch.echoSafetyMode);
      }
      if (patch.autoBuffer != null) {
        engineActions.setIsAutoBuffer(patch.autoBuffer);
      }
      if (patch.targetLeadFrames != null) {
        engineActions.setIsAutoBuffer(false);
        engineActions.setTargetLeadFrames(patch.targetLeadFrames);
      }
      if (patch.metronomeBpm != null) {
        engineLegacy.setMetronomeBpm(patch.metronomeBpm);
        engineLegacy.broadcastStudioParam({ bpm: patch.metronomeBpm });
      }
      if (patch.metronomeVolume != null) {
        engineActions.onMetronomeVolumeChange(patch.metronomeVolume / 50);
      }
      if (patch.visualMetronomeOnly != null) {
        engineActions.setIsVisualMetronomeOnly(patch.visualMetronomeOnly);
      }
      if (patch.peerVolume != null) {
        engineActions.onRemotePlaybackVolumeChange(linearFromPeerPct(patch.peerVolume));
      }
      if (patch.micMuted != null && patch.micMuted !== engineState.isMicMuted) {
        engineActions.toggleMic();
      }
      if (patch.speakerMuted != null && patch.speakerMuted !== engineState.isSpeakerMuted) {
        engineActions.toggleSpeaker();
      }
    },
    [engineActions, engineLegacy, engineState.isMicMuted, engineState.isSpeakerMuted]
  );

  return useMemo<P2PJamPresenterPort>(
    () => ({
      pingMs: engineState.pingMs,
      delayMs: engineState.calculatedDelayMs,
      packetLossPercent: engineState.inboundPacketLossPercent,
      remoteParticipantName: presenterState.remoteParticipantName,
      sessionId: engineState.sessionId,
      statusNote: presenterState.statusNote || null,
      bridgeInitError: presenterState.bridgeInitError,
      connectionLostCountdown: presenterState.connectionLostCountdown,
      collaboratorLeft: presenterState.collaboratorLeft,
      highPingTipOpen: presenterState.highPingTipOpen,
      onDismissHighPingTip: engineActions.dismissHighPingTip,
      onCopyRoomCode: opts.onCopyRoomCode,

      micOn: !engineState.isMicMuted,
      speakerOn: !engineState.isSpeakerMuted,
      peerVolumePercent: peerPctFromLinear(engineState.remotePlaybackVolume),
      syncCountInBlocksLive,
      onToggleMic: engineActions.toggleMic,
      onToggleSpeaker: engineActions.toggleSpeaker,
      onPeerVolumeChange: (pct) =>
        engineActions.onRemotePlaybackVolumeChange(linearFromPeerPct(pct)),

      cameraOn: false,
      cameraToggleEnabled: false,
      onToggleCamera: () => {
        /* G1: no video engine — no-op */
      },

      kiteSyncEnabled: engineState.kiteSyncEnabled,
      jamSetupLockedByRemote,
      kiteSyncCountInActive: engineState.kiteSyncCountInActive,
      kiteSyncNetworkMetronomePaused: presenterState.kiteSyncNetworkMetronomePaused,
      kiteSyncLossPausePct: KITE_SYNC_LOSS_PAUSE_PCT,
      kiteSyncLossResumePct: KITE_SYNC_LOSS_RESUME_PCT,
      activeJam,
      kiteSyncReadinessPhase: engineState.kiteSyncReadinessPhase.phase,
      kiteSyncReadinessIsLocalLeader: engineState.kiteSyncReadinessPhase.isLocalLeader,
      kiteSyncReadinessHotRef: engineRefs.kiteSyncReadinessHotRef,
      audibleSyncCountIn: engineState.audibleSyncCountIn,
      onAudibleSyncCountInChange: engineActions.setAudibleSyncCountIn,
      onStartKiteSync: () => {
        if (jamSetupLockedByRemote) return;
        engineLegacy.sendJamSetupLock("acquire");
        engineActions.handleStartKiteSetup("connected", "sync");
      },
      onEndKiteSync: () => {
        if (engineState.kiteSyncEnabled) {
          engineActions.toggleKiteSync();
        }
        engineActions.broadcastKiteSyncStop();
      },

      wizardOpen,
      wizard: wizardDraft,
      wizardError: presenterState.kiteSetupError,
      onWizardChange: pushWizardToEngine,
      onWizardConfirm: () => {
        void (async () => {
          await engineActions.handleConfirmKiteSetup();
          await engineActions.handleStartBroadcastCountIn();
        })();
      },
      onWizardCancel: () => {
        engineActions.handleCancelKiteSetup();
        engineLegacy.sendJamSetupLock("release");
      },

      settings,
      onSettingsUpdate,
      isBufferPrimed: engineState.isBufferPrimed,
      bufferDepthFrames: engineState.bufferDepthFrames,
      lastCorrectionEvent:
        engineState.lastCorrectionEvent === "none" ? null : engineState.lastCorrectionEvent,
      outputDeviceOptions: OUTPUT_OPTIONS,
      outputDeviceSelectable: false,

      isRecording: engineState.isRecording,
      recordingTimeMs: presenterState.recordingTimeMs,
      recordedBlobUrl: presenterState.recordedBlobUrl,
      onToggleRecord: () => {
        if (engineState.isRecording) engineActions.stopLocalRecording();
        else engineActions.startLocalRecording();
      },
      onClearRecordedBlob: engineLegacy.clearRecordedBlobUrl,

      inputPanel: {
        devices: engineState.audioInputDevices.map((d) => ({
          id: d.deviceId,
          label: d.label || "Input device",
          channels: engineState.deviceInputChannelCount[d.deviceId] ?? 1,
        })),
        activeIds: engineState.activeDeviceIds,
        focusedId: engineState.activeDeviceIds[0] ?? null,
        gains: Object.fromEntries(
          Object.entries(engineState.deviceVolumes).map(([k, v]) => [k, Math.round(v)])
        ),
        interfaceFlags: engineState.interfaceInputDeviceFlags,
        liveMonitorFlags: engineState.interfaceLiveMonitorEnabledFlags,
      },
      onToggleInputDevice: engineActions.toggleAudioDevice,
      onFocusInputDevice: () => {
        /* focus is UI-only; activation is via toggle */
      },
      onSetInputGain: (deviceId, ch, value) => {
        engineActions.handleVolumeChange(`${deviceId}:ch${ch}`, value);
      },
      onSetInterfaceFlag: engineActions.setInterfaceInputDeviceFlag,
      onSetLiveMonitorFlag: engineActions.setInterfaceLiveMonitorEnabledFlag,
      registerMixerMeterElement: engineActions.registerMixerMeterElement,
      registerMasterLiveMeterElement: engineActions.registerMasterLiveMeterElement,
      maxActiveInputs: 2,

      remoteMeterHeights: presenterState.remoteMeterHeights,
      remoteLevel: presenterState.remoteLevel,
      remoteMeterTapActive: engineState.remoteMeterTapActive,
      // Prefer remote session level for the vertical LIVE rail (engine register writes width).
      masterLiveLevelPercent: (() => {
        const level = presenterState.remoteLevel;
        if (level > 0.02) return Math.round(Math.min(100, Math.max(0, level * 100)));
        const heights = presenterState.remoteMeterHeights;
        if (!heights.length) return null;
        let peak = 0;
        const n = heights.length;
        for (let i = 0; i < n; i += 1) {
          const w = 0.55 + (i / Math.max(1, n - 1)) * 0.45;
          peak = Math.max(peak, (heights[i] ?? 0) * w);
        }
        if (peak <= 0.02) return null;
        return Math.round(Math.min(100, Math.max(0, peak * 100)));
      })(),
      localMicStream: engineState.localMicStream,

      remoteAudioRef: engineRefs.remoteAudioRef,
      localMonitorAudioRef: engineRefs.localMonitorAudioRef,
      metronomeBlinkElementRef: engineRefs.metronomeBlinkElementRef,

      audioContextSuspended: !engineState.audioContextReady,
      onResumeAudio: () => {
        void engineLegacy.studioAudioContextRef.current?.resume();
        engineLegacy.setAudioContextReady(true);
      },

      chatReady: presenterState.kiteChatReady,
      chatMessages: chat.messages.map((m) => ({
        id: m.id,
        text: m.text,
        isLocal: m.isLocal,
        receivedAt: m.receivedAt,
      })),
      onSendChat: chat.sendMessage,

      onEndSession: opts.onEndSession,
      isDummyMode: false,
    }),
    [
      engineState,
      engineActions,
      engineRefs,
      presenterState,
      engineLegacy,
      opts,
      wizardOpen,
      wizardDraft,
      pushWizardToEngine,
      jamSetupLockedByRemote,
      syncCountInBlocksLive,
      activeJam,
      settings,
      onSettingsUpdate,
      chat.messages,
      chat.sendMessage,
    ]
  );
}
