"use client";

/**
 * Dummy port for /sandbox/p2p-jam — visual-only, no engine wiring.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  P2PJamActiveSnapshot,
  P2PJamInputPanelState,
  P2PJamPresenterPort,
  P2PJamSettingsState,
  P2PJamWizardState,
  P2PJamChatMessage,
} from "@/components/studio-bridge/P2PJamPresenter.types";
import { P2P_JAM_SYNC_READINESS_HOT_IDLE } from "@/components/studio-bridge/P2PJamPresenter.types";

const INITIAL_WIZARD: P2PJamWizardState = {
  step: 1,
  bpm: 120,
  metronomeVolume: 40,
  timeSignature: "4/4",
  customTop: 5,
  customBottom: 4,
  barCount: 4,
  customBars: 12,
};

const INITIAL_SETTINGS: P2PJamSettingsState = {
  outputDeviceId: "default",
  micMuted: false,
  speakerMuted: false,
  peerVolume: 100,
  autoBuffer: true,
  targetLeadFrames: 1920,
  bufferingEnabled: true,
  echoSafetyMode: true,
  metronomeBpm: 120,
  metronomeVolume: 40,
  visualMetronomeOnly: false,
};

const INITIAL_INPUT: P2PJamInputPanelState = {
  devices: [
    { id: "default", label: "Default — Microphone Array", channels: 1 },
    { id: "usb-2ch", label: "USB Audio Interface (2ch)", channels: 2 },
    { id: "bt-headset", label: "Bluetooth Headset Mic", channels: 1 },
    { id: "line-in", label: "Line In — Front Jack", channels: 2 },
  ],
  activeIds: ["default"],
  focusedId: "default",
  gains: {
    "default:ch0": 75,
    "usb-2ch:ch0": 75,
    "usb-2ch:ch1": 75,
    "bt-headset:ch0": 75,
    "line-in:ch0": 70,
    "line-in:ch1": 70,
  },
  interfaceFlags: {},
  liveMonitorFlags: {},
};

const OUTPUT_OPTIONS = [
  { id: "default", label: "Default — Speakers" },
  { id: "usb-out", label: "USB Interface Out" },
  { id: "headphones", label: "Wired Headphones" },
];

const MAX_ACTIVE = 2;

function log(action: string, value?: unknown): void {
  console.log("[P2P_DUMMY_UI] Action: ", action, value ?? "");
}

function resolveTimeSignatureLabel(w: P2PJamWizardState): string {
  if (w.timeSignature === "custom") return `${w.customTop}/${w.customBottom}`;
  return w.timeSignature;
}

function resolveBarCount(w: P2PJamWizardState): number {
  return w.barCount === "custom" ? w.customBars : w.barCount;
}

function resolveBeatsPerBar(w: P2PJamWizardState): number {
  if (w.timeSignature === "custom") return Math.max(1, w.customTop);
  if (w.timeSignature === "3/4") return 3;
  if (w.timeSignature === "6/8") return 6;
  return 4;
}

function buildSnapshot(w: P2PJamWizardState): P2PJamActiveSnapshot {
  const bars = resolveBarCount(w);
  const beats = resolveBeatsPerBar(w);
  return {
    bpm: w.bpm,
    bars,
    timeSignature: resolveTimeSignatureLabel(w),
    metronomeVolume: w.metronomeVolume,
    loopSec: Math.round((60 / w.bpm) * beats * bars),
  };
}

export function useP2PJamDummyPort(): P2PJamPresenterPort {
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [kiteSyncEnabled, setKiteSyncEnabled] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTimeMs, setRecordingTimeMs] = useState(0);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizard, setWizard] = useState<P2PJamWizardState>(INITIAL_WIZARD);
  const [activeJam, setActiveJam] = useState<P2PJamActiveSnapshot | null>(null);
  const [settings, setSettings] = useState<P2PJamSettingsState>(INITIAL_SETTINGS);
  const [inputPanel, setInputPanel] = useState<P2PJamInputPanelState>(INITIAL_INPUT);
  const [chatMessages, setChatMessages] = useState<P2PJamChatMessage[]>([]);
  const [pingMs, setPingMs] = useState(18);
  const [delayMs, setDelayMs] = useState(3);

  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const localMonitorAudioRef = useRef<HTMLAudioElement | null>(null);
  const metronomeBlinkElementRef = useRef<HTMLDivElement | null>(null);
  const kiteSyncReadinessHotRef = useRef({ ...P2P_JAM_SYNC_READINESS_HOT_IDLE });
  const meterElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const masterMeterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      setPingMs(15 + Math.floor(Math.random() * 11));
      setDelayMs(2 + Math.floor(Math.random() * 4));
    }, 800);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!isRecording) return;
    const id = window.setInterval(() => setRecordingTimeMs((t) => t + 1000), 1000);
    return () => window.clearInterval(id);
  }, [isRecording]);

  // Dummy master meter random walk via registered element
  useEffect(() => {
    let level = 42;
    const id = window.setInterval(() => {
      level = Math.max(12, Math.min(82, level + (Math.random() - 0.5) * 26));
      if (masterMeterRef.current) {
        masterMeterRef.current.style.height = `${Math.round(level)}%`;
      }
    }, 150);
    return () => window.clearInterval(id);
  }, []);

  // Display-only: fake loop progress so the sync taskbar helper animates in /sandbox/p2p-jam
  useEffect(() => {
    if (!kiteSyncEnabled || !activeJam) {
      kiteSyncReadinessHotRef.current = { ...P2P_JAM_SYNC_READINESS_HOT_IDLE };
      return undefined;
    }
    const loopSec = Math.max(1, activeJam.loopSec);
    const started = performance.now();
    let raf = 0;
    const tick = (): void => {
      const elapsed = ((performance.now() - started) / 1000) % loopSec;
      const progress01 = elapsed / loopSec;
      const beatsPerBar = 4;
      const bars = Math.max(1, activeJam.bars);
      const posInLoop = progress01 * bars * beatsPerBar;
      kiteSyncReadinessHotRef.current = {
        countdownBeatRemaining: null,
        countInProgress01: null,
        audioArriveProgress01: null,
        audioArriveRemainingSec: null,
        loopBarIndex: Math.floor(posInLoop / beatsPerBar) + 1,
        loopBeatInBar: Math.floor(posInLoop) % beatsPerBar,
        loopProgress01: progress01,
      };
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      kiteSyncReadinessHotRef.current = { ...P2P_JAM_SYNC_READINESS_HOT_IDLE };
    };
  }, [kiteSyncEnabled, activeJam]);

  const onSettingsUpdate = useCallback((patch: Partial<P2PJamSettingsState>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const port = useMemo<P2PJamPresenterPort>(
    () => ({
      pingMs,
      delayMs,
      packetLossPercent: 0.4,
      remoteParticipantName: "Guest",
      sessionId: "DEMO42",
      statusNote: null,
      bridgeInitError: null,
      connectionLostCountdown: null,
      collaboratorLeft: false,
      highPingTipOpen: false,
      onDismissHighPingTip: () => log("dismiss high ping tip"),
      onCopyRoomCode: () => log("copy room code", "DEMO42"),

      micOn,
      speakerOn,
      peerVolumePercent: settings.peerVolume,
      syncCountInBlocksLive: false,
      onToggleMic: () => {
        log("toggle mic", !micOn);
        setMicOn((v) => !v);
      },
      onToggleSpeaker: () => {
        log("toggle speaker", !speakerOn);
        setSpeakerOn((v) => !v);
      },
      onPeerVolumeChange: (pct) => {
        log("peer volume", pct);
        setSettings((s) => ({ ...s, peerVolume: pct }));
      },

      cameraOn,
      cameraToggleEnabled: true,
      onToggleCamera: () => {
        log("toggle camera (dummy)", !cameraOn);
        setCameraOn((v) => !v);
      },

      kiteSyncEnabled,
      jamSetupLockedByRemote: false,
      kiteSyncCountInActive: false,
      kiteSyncNetworkMetronomePaused: false,
      kiteSyncLossPausePct: 5,
      kiteSyncLossResumePct: 3,
      activeJam,
      kiteSyncReadinessPhase: kiteSyncEnabled ? "live" : "idle",
      kiteSyncReadinessIsLocalLeader: true,
      kiteSyncReadinessHotRef,
      audibleSyncCountIn: true,
      onAudibleSyncCountInChange: (enabled) => {
        log("audible sync count-in", enabled);
      },
      onStartKiteSync: () => {
        log("open kite sync wizard");
        setWizard(INITIAL_WIZARD);
        setWizardOpen(true);
      },
      onEndKiteSync: () => {
        log("end kite sync");
        setKiteSyncEnabled(false);
        setActiveJam(null);
      },

      wizardOpen,
      wizard,
      wizardError: null,
      onWizardChange: setWizard,
      onWizardConfirm: () => {
        const snap = buildSnapshot(wizard);
        log("confirm kite sync wizard", snap);
        setActiveJam(snap);
        setWizardOpen(false);
        setKiteSyncEnabled(true);
      },
      onWizardCancel: () => {
        log("cancel wizard");
        setWizardOpen(false);
      },

      settings,
      onSettingsUpdate,
      isBufferPrimed: true,
      bufferDepthFrames: settings.targetLeadFrames,
      lastCorrectionEvent: null,
      outputDeviceOptions: OUTPUT_OPTIONS,
      outputDeviceSelectable: false,

      isRecording,
      recordingTimeMs,
      recordedBlobUrl: null,
      onToggleRecord: () => {
        log("toggle record", !isRecording);
        setIsRecording((v) => {
          if (v) setRecordingTimeMs(0);
          return !v;
        });
      },
      onClearRecordedBlob: () => log("clear recorded blob"),

      inputPanel,
      onToggleInputDevice: (id) => {
        setInputPanel((prev) => {
          const active = prev.activeIds.includes(id);
          if (!active && prev.activeIds.length >= MAX_ACTIVE) return prev;
          const activeIds = active
            ? prev.activeIds.filter((x) => x !== id)
            : [...prev.activeIds, id];
          const focusedId = !active
            ? id
            : prev.focusedId === id
              ? (activeIds[0] ?? null)
              : prev.focusedId;
          log("toggle input device", { id, active: !active });
          return { ...prev, activeIds, focusedId };
        });
      },
      onFocusInputDevice: (id) => setInputPanel((p) => ({ ...p, focusedId: id })),
      onSetInputGain: (deviceId, ch, value) => {
        const key = `${deviceId}:ch${ch}`;
        log("set input gain", { key, value });
        setInputPanel((p) => ({ ...p, gains: { ...p.gains, [key]: value } }));
      },
      onSetInterfaceFlag: (deviceId, on) => {
        log("toggle interface flag", { deviceId, on });
        setInputPanel((p) => ({
          ...p,
          interfaceFlags: { ...p.interfaceFlags, [deviceId]: on },
        }));
      },
      onSetLiveMonitorFlag: (deviceId, on) => {
        log("toggle live monitor", { deviceId, on });
        setInputPanel((p) => ({
          ...p,
          liveMonitorFlags: { ...p.liveMonitorFlags, [deviceId]: on },
        }));
      },
      registerMixerMeterElement: (laneKey, el) => {
        if (el) meterElsRef.current.set(laneKey, el);
        else meterElsRef.current.delete(laneKey);
      },
      registerMasterLiveMeterElement: (el) => {
        masterMeterRef.current = el;
      },
      maxActiveInputs: MAX_ACTIVE,

      remoteMeterHeights: [0.2, 0.45, 0.7, 0.35, 0.55, 0.3, 0.6, 0.4],
      remoteLevel: 0.4,
      remoteMeterTapActive: true,
      masterLiveLevelPercent: null,
      localMicStream: null,

      remoteAudioRef,
      localMonitorAudioRef,
      metronomeBlinkElementRef,

      audioContextSuspended: false,
      onResumeAudio: () => log("resume audio"),

      chatReady: true,
      chatMessages,
      onSendChat: (text) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        log("send chat", trimmed);
        setChatMessages((prev) => [
          ...prev,
          {
            id: `local-${Date.now()}`,
            text: trimmed,
            isLocal: true,
            receivedAt: Date.now(),
          },
        ]);
      },

      onEndSession: () => log("end session"),
      isDummyMode: true,
    }),
    [
      pingMs,
      delayMs,
      micOn,
      speakerOn,
      settings,
      cameraOn,
      kiteSyncEnabled,
      activeJam,
      wizardOpen,
      wizard,
      onSettingsUpdate,
      isRecording,
      recordingTimeMs,
      inputPanel,
      chatMessages,
    ]
  );

  return port;
}
