"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Settings,
  Mic,
  Play,
  Pause,
  Circle,
  Trash2,
  Volume2,
  Zap,
  ChevronRight,
  AlertTriangle,
  Video,
  VideoOff,
} from "lucide-react";

import type { KiteIntervalTiming } from "@/lib/kite-interval-math";
import type { RunwayDisplayLabel } from "@/lib/looper-runway-scheduler";

import type { SoloTrackLaneView } from "@/components/kite-loop-v2/FourTrackLooperLanes";
import type { SoloLooperMode, SoloLooperUiState } from "@/components/kite-loop-v2/KiteLoopV2Panel";
import type { LooperRunwayPhase } from "@/components/kite-loop-v2/LooperCountdownRunway";

// ─────────────────────────────────────────────────────────────────────────────
// Public prop types — grouped buckets (mirror integration plan).

export type KiteLoopV4SessionRecorderState = "idle" | "recording" | "paused" | "saving";

export type KiteLoopV4LooperState = {
  soloLooperState: SoloLooperUiState;
  isRecordingArmed: boolean;
  isMasterPaused: boolean;
  sessionRecorderState: KiteLoopV4SessionRecorderState;
  recordingArmedCountdown: number | null;
  runwayDisplay: RunwayDisplayLabel | null;
  runwayPhase: LooperRunwayPhase;
  runwayVisualOnly: boolean;
  loopProgress: number;
  focusedTrackIndex: 1 | 2 | 3 | 4;
  soloTrackLanes: SoloTrackLaneView[];
  showCalibrationOnboardingHint: boolean;
};

export type KiteLoopV4LooperConfig = {
  loopMode: SoloLooperMode;
  barCount: number;
  latencyMs: number;
  kiteSetupTempo: number;
  kiteSetupTimeSignatureTop: number;
  kiteSetupTimeSignatureBottom: number;
  kiteSetupIsSwing: boolean;
  isTimingLocked: boolean;
  kiteIntervalTimingRef: MutableRefObject<KiteIntervalTiming | null>;
};

export type KiteLoopV4LooperHandlers = {
  onRecordFirstLoop: () => void;
  onToggleMasterPause: () => void;
  onToggleSessionRecording: () => void;
  onStopAndResetSoloLooper: () => void;
  onEndSession: () => void;
  onLoopModeChange: (value: SoloLooperMode) => void;
  onBarCountChange: (value: number) => void;
  onLatencyMsChange: (value: number) => void;
  onAutoCalibrateLatency: (mode: "acoustic" | "interface") => void;
  autoCalibrateLatencyStatus: "idle" | "warning" | "listening" | "success" | "error";
  autoCalibrateLatencyMessage: string | null;
  onTempoSliderChange: (value: number) => void;
  onTempoPreset: (bpm: number) => void;
  onSelectTimeSignature: (option: { title: string; top: number; bottom: number; swing: boolean }) => void;
};

export type KiteLoopV4InputDevicesProps = {
  audioInputDevices: MediaDeviceInfo[];
  activeDeviceIds: string[];
  deviceVolumes: Record<string, number>;
  deviceInputChannelCount: Record<string, number>;
  interfaceInputDeviceFlags: Record<string, boolean>;
  interfaceLiveMonitorEnabledFlags: Record<string, boolean>;
  onToggleDeviceActive: (deviceId: string) => void;
  onSetDeviceLaneVolume: (deviceId: string, lane: 0 | 1, value: number) => void;
  onSetInterfaceInputFlag: (deviceId: string, isInterface: boolean) => void;
  onSetInterfaceLiveMonitor: (deviceId: string, enabled: boolean) => void;
  registerMixerMeterElement: (laneKey: string, el: HTMLDivElement | null) => void;
  registerMasterLiveMeterElement: (el: HTMLDivElement | null) => void;
  recTrimSlot?: React.ReactNode;
};

export type KiteLoopV4MetronomeProps = {
  visualMetronomeControls: ReactNode;
  currentBeatIndex: number | null;
  metronomeVolume: number;
  onMetronomeVolumeChange: (value: number) => void;
};

export type KiteLoopV4PanelProps = {
  looperState: KiteLoopV4LooperState;
  looperConfig: KiteLoopV4LooperConfig;
  looperHandlers: KiteLoopV4LooperHandlers;
  inputDevices: KiteLoopV4InputDevicesProps;
  metronome: KiteLoopV4MetronomeProps;
};

// ─────────────────────────────────────────────────────────────────────────────
// Tokens & glass primitives

const ORANGE = "#ff4500";
const EMERALD = "#22c55e";
const SLIDER_TRACK_EMPTY = "rgba(255,255,255,0.08)";

const INLINE_LABEL: React.CSSProperties = {
  color: "rgba(255,255,255,0.28)",
  fontSize: 9,
};

const RESET_BTN: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: ORANGE,
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: "4px 8px",
  flexShrink: 0,
};

const MAX_ACTIVE_INPUT_DEVICES = 3;
const CALIBRATION_DISMISSED_STORAGE_KEY = "kite_calibration_dismissed";

const glass: React.CSSProperties = {
  background: "rgba(10,10,10,0.75)",
  backdropFilter: "blur(18px)",
  WebkitBackdropFilter: "blur(18px)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 18,
};
const glassSharp: React.CSSProperties = { ...glass, borderRadius: 12 };

// ─────────────────────────────────────────────────────────────────────────────
// Sub-primitives

type ToggleProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  sublabel?: string;
};

function Toggle({ checked, onChange, label, sublabel }: ToggleProps): React.JSX.Element {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
      <div>
        <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 11 }}>{label}</div>
        {sublabel ? (
          <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 9, marginTop: 2, lineHeight: 1.4 }}>
            {sublabel}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        style={{
          flexShrink: 0,
          width: 36,
          height: 20,
          borderRadius: 999,
          background: checked ? EMERALD : "rgba(255,255,255,0.1)",
          border: "none",
          cursor: "pointer",
          position: "relative",
          transition: "background 0.2s",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 3,
            left: checked ? 19 : 3,
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: "#fff",
            transition: "left 0.18s",
            display: "block",
          }}
        />
      </button>
    </div>
  );
}

type HSliderProps = {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  accent?: string;
  label?: string;
  disabled?: boolean;
  /** Native tooltip when supported (applied to wrapping row). */
  title?: string;
};

function HSlider({
  value,
  onChange,
  min = 0,
  max = 100,
  accent = EMERALD,
  label,
  disabled = false,
  title,
}: HSliderProps): React.JSX.Element {
  const fillPct = max === min ? 0 : ((value - min) / (max - min)) * 100;

  return (
    <div title={title} style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {label ? (
        <span
          style={{
            ...INLINE_LABEL,
            minWidth: 36,
          }}
        >
          {label}
        </span>
      ) : null}
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          flex: 1,
          height: 4,
          borderRadius: 9999,
          outline: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.45 : 1,
          accentColor: accent,
          background: `linear-gradient(to right,${accent} ${fillPct}%,${SLIDER_TRACK_EMPTY} ${fillPct}%)`,
          WebkitAppearance: "none",
          appearance: "none",
        }}
      />
      <span
        style={{
          color: "rgba(255,255,255,0.5)",
          fontSize: 10,
          fontFamily: "monospace",
          minWidth: 24,
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}

type CheckRowProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  warning?: string;
};

function CheckRow({ checked, onChange, label, warning }: CheckRowProps): React.JSX.Element {
  return (
    <div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          style={{ accentColor: EMERALD, width: 13, height: 13, cursor: "pointer" }}
        />
        <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 11 }}>{label}</span>
      </label>
      {warning && checked ? (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 5, marginTop: 5, paddingLeft: 21 }}>
          <AlertTriangle size={10} color={ORANGE} style={{ marginTop: 1, flexShrink: 0 }} />
          <span style={{ color: ORANGE, fontSize: 9, lineHeight: 1.4 }}>{warning}</span>
        </div>
      ) : null}
    </div>
  );
}

const AUDIO_METER_SEGMENT_COLORS = [
  "#ef4444",
  "#f97316",
  "#22c55e",
  "#22c55e",
  "#22c55e",
  "#22c55e",
  "#22c55e",
  "#22c55e",
] as const;

const AUDIO_METER_SEGMENT_PILL: React.CSSProperties = {
  width: 8,
  height: 5,
  flexShrink: 0,
  borderRadius: 2,
};

function AudioMeter({
  laneKey,
  registerMixerMeterElement,
}: {
  laneKey: string;
  registerMixerMeterElement: (laneKey: string, el: HTMLDivElement | null) => void;
}): React.JSX.Element {
  const maskRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const styleObj: Record<PropertyKey, unknown> = {};
    Object.defineProperty(styleObj, "width", {
      set(val: string) {
        if (maskRef.current) {
          maskRef.current.style.height = val;
        }
      },
      get(): string {
        return maskRef.current?.style.height ?? "";
      },
      enumerable: true,
      configurable: true,
    });
    const proxyRef = {
      style: styleObj as unknown as CSSStyleDeclaration,
    } as unknown as HTMLDivElement;
    registerMixerMeterElement(laneKey, proxyRef);

    return () => registerMixerMeterElement(laneKey, null);
  }, [laneKey, registerMixerMeterElement]);

  return (
    <div
      style={{
        position: "relative",
        width: 8,
        height: 64,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        flexShrink: 0,
      }}
    >
      {AUDIO_METER_SEGMENT_COLORS.map((color, i) => (
        <div
          key={`bg-${i}`}
          style={{
            ...AUDIO_METER_SEGMENT_PILL,
            background: color,
            opacity: 0.15,
          }}
        />
      ))}
      <div
        ref={maskRef}
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: "0%",
          overflow: "hidden",
          transition: "height 0.05s linear",
        }}
      >
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            width: 8,
            height: 64,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          {AUDIO_METER_SEGMENT_COLORS.map((color, i) => (
            <div
              key={`fg-${i}`}
              style={{
                ...AUDIO_METER_SEGMENT_PILL,
                background: color,
                opacity: 1,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function LiveSoundBar({
  active,
  registerMasterLiveMeterElement,
}: {
  active: boolean;
  registerMasterLiveMeterElement: (el: HTMLDivElement | null) => void;
}): React.JSX.Element {
  const maskRef = useRef<HTMLDivElement>(null);
  const segmentIndices = Array.from({ length: 18 }, (_, i) => i);
  const getSegmentColor = (i: number): string => (i >= 15 ? ORANGE : i >= 11 ? "#eab308" : EMERALD);

  useEffect(() => {
    const styleObj: Record<PropertyKey, unknown> = {};
    Object.defineProperty(styleObj, "width", {
      set(val: string) {
        if (maskRef.current) {
          maskRef.current.style.height = val;
        }
      },
      get(): string {
        return maskRef.current?.style.height ?? "";
      },
      enumerable: true,
      configurable: true,
    });
    const proxyRef = {
      style: styleObj as unknown as CSSStyleDeclaration,
    } as unknown as HTMLDivElement;
    registerMasterLiveMeterElement(proxyRef);

    return () => registerMasterLiveMeterElement(null);
  }, [registerMasterLiveMeterElement]);

  return (
    <div style={{ position: "relative", width: 10, height: 231, opacity: active ? 1 : 0.35, transition: "opacity 0.15s" }}>
      <div style={{ display: "flex", flexDirection: "column-reverse", gap: 3 }}>
      {segmentIndices.map((i) => (
        <div
          key={i}
          style={{
            width: 10,
            height: 10,
            borderRadius: 3,
            background: getSegmentColor(i),
            opacity: 0.15,
          }}
        />
      ))}
      </div>
      <div
        ref={maskRef}
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: "0%",
          overflow: "hidden",
          transition: "height 0.05s linear",
          pointerEvents: "none",
        }}
      >
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, display: "flex", flexDirection: "column-reverse", gap: 3 }}>
          {segmentIndices.map((i) => (
            <div
              key={`fg-${i}`}
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                background: getSegmentColor(i),
                opacity: 1,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

type VertSliderProps = { value: number; onChange: (v: number) => void };

function VertSlider({ value, onChange }: VertSliderProps): React.JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        height: 64,
        justifyContent: "center",
      }}
    >
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          WebkitAppearance: "none",
          appearance: "none",
          cursor: "pointer",
          writingMode: "vertical-lr",
          direction: "rtl",
          width: 5,
          height: 60,
          borderRadius: 9999,
          outline: "none",
          background: `linear-gradient(to top,${ORANGE} ${value}%,rgba(255,255,255,0.09) ${value}%)`,
          accentColor: ORANGE,
        }}
      />
    </div>
  );
}

type RecVisualKey = "idle" | "waiting" | "recording" | "playing";

function mapLaneToRecVisual(lane: SoloTrackLaneView): RecVisualKey {
  if (lane.isOverdubArmedWaiting) return "waiting";
  if (lane.workletMode === "recording") return "recording";
  if (lane.workletMode === "playing") return "playing";
  return "idle";
}

const REC_CFG: Record<
  RecVisualKey,
  { bg: string; bord: string; glow: string; lbl: string; col: string }
> = {
  idle: {
    bg: "rgba(30,30,30,0.6)",
    bord: "rgba(255,255,255,0.1)",
    glow: "none",
    lbl: "REC",
    col: "rgba(255,255,255,0.25)",
  },
  waiting: {
    bg: "rgba(255,69,0,0.15)",
    bord: "rgba(255,69,0,0.7)",
    glow: "0 0 28px rgba(255,69,0,0.45)",
    lbl: "WAITING",
    col: ORANGE,
  },
  recording: {
    bg: "rgba(255,69,0,0.22)",
    bord: ORANGE,
    glow: "0 0 40px rgba(255,69,0,0.6)",
    lbl: "REC ●",
    col: ORANGE,
  },
  playing: {
    bg: "rgba(34,197,94,0.15)",
    bord: "rgba(34,197,94,0.65)",
    glow: "0 0 32px rgba(34,197,94,0.5)",
    lbl: "PLAYING",
    col: EMERALD,
  },
};

function trackDisplayName(trackIndex: 1 | 2 | 3 | 4): string {
  return trackIndex === 1 ? "Master 1" : `Track ${trackIndex}`;
}

type AmbientBackdropStyle = {
  baseBackground: string;
  fillBackground: string;
  fillScaleY: number;
};

function resolveAmbientBackdropStyle(
  workletMode: SoloTrackLaneView["workletMode"],
  progressPct: number
): AmbientBackdropStyle {
  const clampedProgress = Math.max(0, Math.min(100, progressPct));
  const progress01 = clampedProgress / 100;
  if (workletMode === "recording") {
    return {
      baseBackground: "linear-gradient(to top, rgba(249,115,22,0.06), rgba(239,68,68,0.09))",
      fillBackground: "linear-gradient(to top, rgba(249,115,22,0.20), rgba(239,68,68,0.28))",
      fillScaleY: progress01,
    };
  }
  if (workletMode === "playing") {
    return {
      baseBackground: "linear-gradient(to top, rgba(34,197,94,0.05), rgba(34,197,94,0.08))",
      fillBackground: "linear-gradient(to top, rgba(34,197,94,0.18), rgba(34,197,94,0.26))",
      fillScaleY: progress01,
    };
  }
  return {
    baseBackground: "transparent",
    fillBackground: "transparent",
    // Keep idle/empty lanes clear even if stale progress values exist.
    fillScaleY: 0,
  };
}

type TrackColumnProps = {
  lane: SoloTrackLaneView;
  masterOnIdleRecord: () => void;
};

function TrackColumn({ lane, masterOnIdleRecord }: TrackColumnProps): React.JSX.Element {
  const visual = mapLaneToRecVisual(lane);
  const cfg = REC_CFG[visual];
  const isPulsing = visual === "waiting";
  const isMaster = lane.trackIndex === 1;
  const faderPct = Math.min(100, Math.max(0, Math.round(lane.volume * 100)));
  const ambient = resolveAmbientBackdropStyle(lane.workletMode, lane.progress);

  const handleRecClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (lane.armDisabled) return;
    if (isMaster && visual === "idle") {
      masterOnIdleRecord();
      return;
    }
    lane.onArmRecord();
  };

  const handleClear = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (!lane.resetDisabled) lane.onResetTrack();
  };

  return (
    <div
      role="presentation"
      onClick={() => lane.onRequestFocus()}
      style={{
        ...glass,
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "12px 8px",
        gap: 8,
        position: "relative",
        overflow: "hidden",
        cursor: "pointer",
        borderColor: lane.isFocused ? "rgba(255,69,0,0.45)" : "rgba(255,255,255,0.08)",
        transition: "border-color 0.2s",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "inherit",
          pointerEvents: "none",
          zIndex: 0,
          background: ambient.baseBackground,
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "inherit",
          pointerEvents: "none",
          zIndex: 0,
          background: ambient.fillBackground,
          transformOrigin: "bottom",
          transform: `scaleY(${ambient.fillScaleY})`,
          willChange: "transform",
          transition: "transform 70ms linear",
        }}
      />
      <span
        style={{
          position: "relative",
          zIndex: 1,
          color: EMERALD,
          fontSize: 9,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          fontWeight: 600,
          opacity: 0.85,
        }}
      >
        {trackDisplayName(lane.trackIndex)}
      </span>

      <button
        type="button"
        onClick={handleClear}
        disabled={lane.resetDisabled}
        title="Clear track"
        style={{
          position: "absolute",
          top: 10,
          right: 8,
          zIndex: 2,
          background: "none",
          border: "none",
          cursor: lane.resetDisabled ? "not-allowed" : "pointer",
          color: EMERALD,
          padding: 3,
          opacity: lane.resetDisabled ? 0.25 : 0.6,
          transition: "opacity 0.15s",
        }}
        onMouseEnter={(ev) => {
          if (!lane.resetDisabled) ev.currentTarget.style.opacity = "1";
        }}
        onMouseLeave={(ev) => {
          if (!lane.resetDisabled) ev.currentTarget.style.opacity = "0.6";
        }}
      >
        <Trash2 size={11} />
      </button>

      <div style={{ position: "relative", zIndex: 1 }}>
        <VertSlider value={faderPct} onChange={(v) => lane.onVolumeChange(v / 100)} />
      </div>

      <motion.div
        animate={isPulsing ? { opacity: [1, 0.5, 1] } : { opacity: 1 }}
        transition={isPulsing ? { repeat: Infinity, duration: 0.9 } : {}}
        onClick={handleRecClick}
        style={{
          position: "relative",
          zIndex: 1,
          width: 80,
          height: 80,
          borderRadius: "50%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: cfg.bg,
          border: `2px solid ${cfg.bord}`,
          boxShadow: cfg.glow,
          cursor: lane.armDisabled ? "not-allowed" : "pointer",
          gap: 4,
          transition: "background 0.18s, border-color 0.18s",
          opacity: lane.armDisabled ? 0.45 : 1,
        }}
      >
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: cfg.col,
            opacity: visual === "idle" ? 0.25 : 1,
            transition: "all 0.15s",
          }}
        />
        <span style={{ fontSize: 7, letterSpacing: "0.12em", color: cfg.col, textTransform: "uppercase" }}>
          {isMaster && visual === "idle" ? "START" : cfg.lbl}
        </span>
      </motion.div>

      <div style={{ flex: 1, position: "relative", zIndex: 1 }} />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          padding: "4px 0",
          borderRadius: 7,
          textAlign: "center",
          border: `1px solid ${lane.isFocused ? "rgba(34,197,94,0.55)" : "rgba(255,255,255,0.07)"}`,
          background: lane.isFocused ? "rgba(34,197,94,0.08)" : "transparent",
          color: lane.isFocused ? EMERALD : "rgba(255,255,255,0.2)",
          fontSize: 7,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          transition: "all 0.18s",
        }}
      >
        {lane.isFocused ? "✦ SELECTED" : "SELECT"}
      </div>
    </div>
  );
}

type SettingsModalProps = {
  onClose: () => void;
  cfg: KiteLoopV4LooperConfig;
  handlers: KiteLoopV4LooperHandlers;
  metronomeVisualOnly: ReactNode;
  metronomeVolume: number;
  onMetronomeVolumeChange: (value: number) => void;
  runwayVisualOnly: boolean;
};

/** Time signatures aligned with `LooperCountdownConfig` options. */
const TIME_SIG_SHORT: {
  ui: string;
  option: { title: string; top: number; bottom: number; swing: boolean };
}[] = [
  { ui: "3/4", option: { title: "Waltz 3/4", top: 3, bottom: 4, swing: false } },
  { ui: "4/4", option: { title: "Straight 4/4", top: 4, bottom: 4, swing: false } },
  { ui: "6/8 ♩", option: { title: "Shuffle 6/8", top: 6, bottom: 8, swing: true } },
];

function SettingsModal({
  onClose,
  cfg,
  handlers,
  metronomeVisualOnly,
  metronomeVolume,
  onMetronomeVolumeChange,
  runwayVisualOnly,
}: SettingsModalProps): React.JSX.Element {
  const [showAdvancedLatency, setShowAdvancedLatency] = useState(false);
  const [calibrationMode, setCalibrationMode] = useState<"acoustic" | "interface">("acoustic");
  const tapTimes = useRef<number[]>([]);

  const bpm = cfg.kiteSetupTempo;
  const gridMode = cfg.loopMode === "grid";
  const barCount = cfg.barCount;
  const rtlCompensation = cfg.latencyMs;
  const locked = cfg.isTimingLocked;
  const calibrationStatus = handlers.autoCalibrateLatencyStatus;
  const calibrationMessage = handlers.autoCalibrateLatencyMessage;
  const calibrationBusy = calibrationStatus === "listening";
  const calibrationStatusColor =
    calibrationStatus === "success"
      ? EMERALD
      : calibrationStatus === "warning" || calibrationStatus === "error"
        ? ORANGE
        : "rgba(255,255,255,0.5)";
  const selectedWarning =
    calibrationMode === "acoustic"
      ? "RTL CALIBRATION\n\n1. Keep your wired headphones plugged in.\n2. Find your laptop's built-in mic (usually a tiny hole next to the webcam or near the keyboard).\n3. Hold one headphone earcup directly against the mic.\n4. Hold it steady, then click OK to fire the ping."
      : "Unplug your instrument. Plug a standard audio cable directly from your interface's Output into its Input. Turn the input gain up.";

  const triggerCalibration = (mode: "acoustic" | "interface"): void => {
    const warningText =
      mode === "acoustic"
        ? "RTL CALIBRATION\n\n1. Keep your wired headphones plugged in.\n2. Find your laptop's built-in mic (usually a tiny hole next to the webcam or near the keyboard).\n3. Hold one headphone earcup directly against the mic.\n4. Hold it steady, then click OK to fire the ping."
        : "Unplug your instrument. Plug a standard audio cable directly from your interface's Output into its Input. Turn the input gain up.";
    if (!window.confirm(`${warningText}\n\nStart calibration now?`)) {
      return;
    }
    setCalibrationMode(mode);
    handlers.onAutoCalibrateLatency(mode);
  };

  const tap = (): void => {
    const now = Date.now();
    tapTimes.current.push(now);
    if (tapTimes.current.length > 5) tapTimes.current.shift();
    if (tapTimes.current.length >= 2) {
      const diffs = tapTimes.current.slice(1).map((t, i) => t - tapTimes.current[i]!);
      const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      handlers.onTempoSliderChange(Math.round(60000 / avg));
    }
  };

  const col: React.CSSProperties = {
    flex: 1,
    minWidth: "min(200px, 100%)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: "0 18px",
  };

  const colDivider: React.CSSProperties = {
    width: 1,
    alignSelf: "stretch",
    background: "rgba(255,255,255,0.06)",
    flexShrink: 0,
  };

  const sLabel = (t: string): React.JSX.Element => (
    <span
      style={{
        color: "rgba(255,255,255,0.22)",
        fontSize: 8,
        letterSpacing: "0.22em",
        textTransform: "uppercase",
      }}
    >
      {t}
    </span>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: -12, x: -8 }}
      animate={{ opacity: 1, y: 0, x: 0 }}
      exit={{ opacity: 0, y: -12, x: -8 }}
      transition={{ type: "spring", stiffness: 340, damping: 32 }}
      style={{
        position: "absolute",
        top: 64,
        left: 12,
        zIndex: 60,
        width: "min(700px, calc(100vw - 24px))",
        maxHeight: "calc(100dvh - 80px)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          ...glass,
          padding: "16px 0 18px",
          display: "flex",
          flexDirection: "column",
          gap: 0,
          overflowY: "auto",
          flex: 1,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0 18px 14px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <span
            style={{
              color: "rgba(255,255,255,0.75)",
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              display: "flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            <Settings size={12} color={ORANGE} /> Settings
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.3)",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
              padding: "0 2px",
            }}
          >
            ×
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", paddingTop: 16, minHeight: 200 }}>
          <div style={{ ...col, paddingLeft: 20 }}>
            {sLabel("BPM & Timing")}
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ color: ORANGE, fontFamily: "monospace", fontSize: 42, fontWeight: 700, lineHeight: 1 }}>
                {bpm}
              </span>
              <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 10 }}>BPM</span>
            </div>

            <input
              type="range"
              min={40}
              max={240}
              value={bpm}
              disabled={locked}
              onChange={(e) => handlers.onTempoSliderChange(Number(e.target.value))}
              style={{
                width: "100%",
                accentColor: ORANGE,
                cursor: locked ? "not-allowed" : "pointer",
                height: 4,
                appearance: "none",
                WebkitAppearance: "none",
                borderRadius: 9999,
                outline: "none",
                opacity: locked ? 0.45 : 1,
                background: `linear-gradient(to right,${ORANGE} ${((bpm - 40) / 200) * 100}%,rgba(255,255,255,0.09) ${((bpm - 40) / 200) * 100}%)`,
              }}
            />

            <div style={{ display: "flex", gap: 5 }}>
              <button
                type="button"
                disabled={locked}
                onClick={tap}
                style={{
                  padding: "6px 10px",
                  borderRadius: 9,
                  background: "rgba(255,69,0,0.1)",
                  border: "1px solid rgba(255,69,0,0.35)",
                  color: ORANGE,
                  fontSize: 10,
                  cursor: locked ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  opacity: locked ? 0.45 : 1,
                }}
              >
                <Zap size={10} color={ORANGE} /> TAP
              </button>
              {(
                [
                  { l: "Slow", v: 75 },
                  { l: "Mid", v: 120 },
                  { l: "Fast", v: 160 },
                ] as const
              ).map(({ l, v }) => (
                <button
                  key={v}
                  type="button"
                  disabled={locked}
                  onClick={() => handlers.onTempoPreset(v)}
                  style={{
                    flex: 1,
                    borderRadius: 9,
                    padding: "6px 0",
                    border: `1px solid ${bpm === v ? "rgba(255,69,0,0.55)" : "rgba(255,255,255,0.09)"}`,
                    background: bpm === v ? "rgba(255,69,0,0.1)" : "transparent",
                    color: bpm === v ? ORANGE : "rgba(255,255,255,0.32)",
                    fontSize: 9,
                    cursor: locked ? "not-allowed" : "pointer",
                    lineHeight: 1.8,
                    opacity: locked ? 0.45 : 1,
                  }}
                >
                  {l}
                  <br />
                  <span style={{ fontSize: 9, opacity: 0.6, fontFamily: "monospace" }}>{v}</span>
                </button>
              ))}
            </div>
          </div>

          <div style={colDivider} />

          <div style={col}>
            {sLabel("Time Signature")}
            <div style={{ display: "flex", gap: 6 }}>
              {TIME_SIG_SHORT.map(({ ui, option }) => {
                const sel =
                  cfg.kiteSetupTimeSignatureTop === option.top &&
                  cfg.kiteSetupTimeSignatureBottom === option.bottom &&
                  cfg.kiteSetupIsSwing === option.swing;
                return (
                  <button
                    key={ui}
                    type="button"
                    disabled={locked}
                    onClick={() => handlers.onSelectTimeSignature(option)}
                    style={{
                      flex: 1,
                      borderRadius: 9,
                      padding: "8px 0",
                      border: `1px solid ${sel ? "rgba(255,69,0,0.55)" : "rgba(255,255,255,0.09)"}`,
                      background: sel ? "rgba(255,69,0,0.1)" : "transparent",
                      color: sel ? ORANGE : "rgba(255,255,255,0.38)",
                      fontSize: 11,
                      cursor: locked ? "not-allowed" : "pointer",
                      opacity: locked ? 0.45 : 1,
                    }}
                  >
                    {ui}
                  </button>
                );
              })}
            </div>

            <div
              style={{
                borderTop: "1px solid rgba(255,255,255,0.05)",
                paddingTop: 12,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {sLabel("Metronome")}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={INLINE_LABEL}>Metronome Volume</span>
                  <button
                    type="button"
                    onClick={() => onMetronomeVolumeChange(1)}
                    style={RESET_BTN}
                  >
                    Reset
                  </button>
                </div>
                <HSlider
                  value={Math.round(metronomeVolume * 10)}
                  onChange={(v) => onMetronomeVolumeChange(v / 10)}
                  min={0}
                  max={20}
                  accent={EMERALD}
                  title="Metronome click volume (0–2)"
                />
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 8,
                  pointerEvents: locked ? "none" : undefined,
                  opacity: locked ? 0.45 : 1,
                }}
              >
                {metronomeVisualOnly}
                {runwayVisualOnly ? (
                  <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 9, fontStyle: "italic" }}>
                    (Visual only)
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div style={colDivider} />

          <div style={{ ...col, paddingRight: 20 }}>
            {sLabel("Grid Engine")}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Toggle
                checked={gridMode}
                onChange={(on) => handlers.onLoopModeChange(on ? "grid" : "free")}
                label="Grid Mode"
                sublabel="Off = Free Mode (no quantize)"
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ color: "rgba(255,255,255,0.28)", fontSize: 9 }}>Bar Count</span>
                <div style={{ display: "flex", gap: 5 }}>
                  {([1, 2, 4, 8] as const).map((b) => (
                    <button
                      key={b}
                      type="button"
                      disabled={!gridMode}
                      onClick={() => handlers.onBarCountChange(b)}
                      style={{
                        flex: 1,
                        borderRadius: 8,
                        padding: "6px 0",
                        border: `1px solid ${barCount === b ? "rgba(34,197,94,0.55)" : "rgba(255,255,255,0.09)"}`,
                        background: barCount === b ? "rgba(34,197,94,0.1)" : gridMode ? "transparent" : "rgba(0,0,0,0.2)",
                        color:
                          barCount === b ? EMERALD : gridMode ? "rgba(255,255,255,0.32)" : "rgba(255,255,255,0.15)",
                        fontSize: 12,
                        fontFamily: "monospace",
                        cursor: gridMode ? "pointer" : "default",
                        opacity: gridMode ? 1 : 0.4,
                        transition: "all 0.18s",
                      }}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div
              style={{
                borderTop: "1px solid rgba(255,255,255,0.05)",
                paddingTop: 12,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {sLabel("Latency Calibration")}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <button
                  type="button"
                  disabled={calibrationBusy}
                  onClick={() => triggerCalibration("acoustic")}
                  title={calibrationBusy ? "Calibration in progress" : "Calibrate over laptop speaker/mic path"}
                  style={{
                    padding: "8px 14px",
                    border: "1px solid rgba(34,197,94,0.35)",
                    background:
                      calibrationMode === "acoustic" ? "rgba(34,197,94,0.12)" : "rgba(34,197,94,0.07)",
                    color: EMERALD,
                    fontSize: 11,
                    cursor: calibrationBusy ? "wait" : "pointer",
                    opacity: calibrationBusy ? 0.6 : 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    borderRadius: 10,
                    justifyContent: "center",
                  }}
                >
                  <Zap size={12} color={EMERALD} />{" "}
                  {calibrationBusy && calibrationMode === "acoustic"
                    ? "Listening..."
                    : "Calibrate Laptop/Mic (Acoustic)"}
                </button>
                <button
                  type="button"
                  disabled={calibrationBusy}
                  onClick={() => triggerCalibration("interface")}
                  title={calibrationBusy ? "Calibration in progress" : "Calibrate with interface cable loopback"}
                  style={{
                    padding: "8px 14px",
                    border: "1px solid rgba(34,197,94,0.35)",
                    background:
                      calibrationMode === "interface" ? "rgba(34,197,94,0.12)" : "rgba(34,197,94,0.07)",
                    color: EMERALD,
                    fontSize: 11,
                    cursor: calibrationBusy ? "wait" : "pointer",
                    opacity: calibrationBusy ? 0.6 : 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    borderRadius: 10,
                    justifyContent: "center",
                  }}
                >
                  <Zap size={12} color={EMERALD} />{" "}
                  {calibrationBusy && calibrationMode === "interface"
                    ? "Listening..."
                    : "Calibrate Interface (Cable Loopback)"}
                </button>
              </div>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 5 }}>
                <AlertTriangle size={10} color={ORANGE} style={{ marginTop: 1, flexShrink: 0 }} />
                <span style={{ color: ORANGE, fontSize: 9, lineHeight: 1.5 }}>
                  {selectedWarning}
                </span>
              </div>
              {calibrationMessage ? (
                <div
                  style={{
                    borderRadius: 8,
                    border: `1px solid ${
                      calibrationStatus === "success"
                        ? "rgba(34,197,94,0.4)"
                        : calibrationStatus === "warning" || calibrationStatus === "error"
                          ? "rgba(255,69,0,0.35)"
                          : "rgba(255,255,255,0.12)"
                    }`,
                    background:
                      calibrationStatus === "success"
                        ? "rgba(34,197,94,0.08)"
                        : calibrationStatus === "warning" || calibrationStatus === "error"
                          ? "rgba(255,69,0,0.08)"
                          : "rgba(255,255,255,0.04)",
                    color: calibrationStatusColor,
                    fontSize: 9,
                    lineHeight: 1.5,
                    padding: "7px 8px",
                  }}
                >
                  {calibrationMessage}
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => setShowAdvancedLatency((v) => !v)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  color: "rgba(255,255,255,0.3)",
                  fontSize: 9,
                }}
              >
                <ChevronRight
                  size={11}
                  style={{
                    transform: showAdvancedLatency ? "rotate(90deg)" : "rotate(0deg)",
                    transition: "transform 0.2s",
                    color: "rgba(255,255,255,0.3)",
                  }}
                />
                Advanced Settings
              </button>

              {showAdvancedLatency ? (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  style={{ overflow: "hidden" }}
                >
                  <div
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      background: "rgba(255,69,0,0.05)",
                      border: "1px solid rgba(255,69,0,0.18)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 9 }}>RTL Compensation</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="range"
                        min={0}
                        max={120}
                        value={rtlCompensation}
                        onChange={(e) => handlers.onLatencyMsChange(Number(e.target.value))}
                        style={{
                          flex: 1,
                          accentColor: ORANGE,
                          cursor: "pointer",
                          height: 4,
                          appearance: "none",
                          WebkitAppearance: "none",
                          borderRadius: 9999,
                          outline: "none",
                          background: `linear-gradient(to right,${ORANGE} ${(rtlCompensation / 120) * 100}%,rgba(255,255,255,0.08) ${(rtlCompensation / 120) * 100}%)`,
                        }}
                      />
                      <span
                        style={{
                          color: ORANGE,
                          fontSize: 10,
                          fontFamily: "monospace",
                          minWidth: 38,
                          textAlign: "right",
                        }}
                      >
                        {rtlCompensation}ms
                      </span>
                    </div>
                  </div>
                </motion.div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

type RunwayOverlayProps = { countdown: RunwayDisplayLabel };

function RunwayOverlay({ countdown }: RunwayOverlayProps): React.JSX.Element {
  const display = countdown === "GO" ? "GO" : String(countdown);
  const isGo = countdown === "GO";
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.3 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 80,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
      }}
    >
      <span
        style={{
          fontFamily: "monospace",
          fontWeight: 700,
          lineHeight: 1,
          fontSize: "clamp(120px, 22vw, 220px)",
          color: isGo ? EMERALD : ORANGE,
          textShadow: isGo
            ? "0 0 80px rgba(34,197,94,0.8), 0 0 160px rgba(34,197,94,0.4)"
            : "0 0 80px rgba(255,69,0,0.8), 0 0 160px rgba(255,69,0,0.4)",
          userSelect: "none",
        }}
      >
        {display}
      </span>
    </motion.div>
  );
}

type InputModalProps = {
  onClose: () => void;
  inputDevices: KiteLoopV4InputDevicesProps;
};

function InputModal({ onClose, inputDevices }: InputModalProps): React.JSX.Element {
  const [focusedSelectedDeviceId, setFocusedSelectedDeviceId] = useState<string | null>(null);

  const { activeDeviceIds } = inputDevices;

  useEffect(() => {
    setFocusedSelectedDeviceId((prev) => {
      if (prev != null && activeDeviceIds.includes(prev)) return prev;
      return activeDeviceIds[0] ?? null;
    });
  }, [activeDeviceIds]);

  const atDeviceCap = activeDeviceIds.length >= MAX_ACTIVE_INPUT_DEVICES;

  const laneCh = (lane: 0 | 1): number =>
    focusedSelectedDeviceId == null ? 75 : inputDevices.deviceVolumes[`${focusedSelectedDeviceId}:ch${lane}`] ?? 75;

  const chCountRaw =
    focusedSelectedDeviceId != null ? inputDevices.deviceInputChannelCount[focusedSelectedDeviceId] : undefined;
  const chCount = chCountRaw == null || Number.isNaN(chCountRaw) ? 1 : Math.min(2, Math.max(1, Math.round(chCountRaw)));

  const handleToggleRow = (deviceId: string, isActive: boolean): void => {
    if (!isActive && atDeviceCap) return;
    inputDevices.onToggleDeviceActive(deviceId);
    if (!isActive) setFocusedSelectedDeviceId(deviceId);
  };

  const colDivider: React.CSSProperties = {
    width: 1,
    alignSelf: "stretch",
    background: "rgba(255,255,255,0.06)",
    flexShrink: 0,
  };

  const focusedLabel =
    focusedSelectedDeviceId == null
      ? null
      : inputDevices.audioInputDevices.find((d) => d.deviceId === focusedSelectedDeviceId)?.label ??
        focusedSelectedDeviceId;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ type: "spring", stiffness: 340, damping: 32 }}
      style={{
        position: "absolute",
        right: 24,
        top: 80,
        zIndex: 60,
        width: "min(600px, calc(100vw - 32px))",
        height: "80vh",
        maxHeight: 550,
      }}
    >
      <div
        style={{
          ...glass,
          padding: "16px 0 18px",
          flex: 1,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 0,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0 18px 14px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <span
            style={{
              color: "rgba(255,255,255,0.75)",
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              display: "flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            <Mic size={12} color={EMERALD} /> Input Device
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.3)",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "row", paddingTop: 14, flex: 1, minHeight: 0, overflow: "hidden" }}>
          <div
            style={{
              flex: 1,
              height: "100%",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              padding: "0 16px 0 18px",
              overflowY: "auto",
              minHeight: 0,
            }}
          >
            <span
              style={{
                color: "rgba(255,255,255,0.22)",
                fontSize: 8,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                marginBottom: 2,
              }}
            >
              Available Sources
            </span>
            {inputDevices.audioInputDevices.map((d) => {
              const active = activeDeviceIds.includes(d.deviceId);
              const blocked = !active && atDeviceCap;
              return (
                <button
                  key={d.deviceId || d.groupId || d.label}
                  type="button"
                  title={blocked ? `Maximum ${MAX_ACTIVE_INPUT_DEVICES} active inputs` : undefined}
                  onClick={() => handleToggleRow(d.deviceId, active)}
                  disabled={blocked}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    borderRadius: 11,
                    textAlign: "left",
                    border: `1px solid ${
                      active ? "rgba(34,197,94,0.5)" : "rgba(255,255,255,0.07)"
                    }`,
                    background: active ? "rgba(34,197,94,0.08)" : "rgba(255,255,255,0.02)",
                    cursor: blocked ? "not-allowed" : "pointer",
                    transition: "all 0.18s",
                    width: "100%",
                    opacity: blocked ? 0.45 : 1,
                  }}
                >
                  <input
                    type="checkbox"
                    readOnly
                    checked={active}
                    tabIndex={-1}
                    style={{ accentColor: EMERALD, width: 14, height: 14, flexShrink: 0, cursor: "inherit" }}
                  />
                  <span
                    style={{
                      fontSize: 12,
                      color: active ? EMERALD : "rgba(255,255,255,0.52)",
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {d.label || "Input device"}
                  </span>
                  <AudioMeter
                    laneKey={`${d.deviceId}:ch0`}
                    registerMixerMeterElement={inputDevices.registerMixerMeterElement}
                  />
                </button>
              );
            })}
            <p style={{ color: "rgba(255,255,255,0.18)", fontSize: 9, lineHeight: 1.6, marginTop: 4 }}>
              Use your own monitor if you have an interface.
            </p>
          </div>

          <div style={colDivider} />

          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, padding: "0 18px 0 16px", overflowY: "auto", minHeight: 0 }}>
            <div>
              <span
                style={{
                  color: "rgba(255,255,255,0.22)",
                  fontSize: 8,
                  letterSpacing: "0.22em",
                  textTransform: "uppercase",
                }}
              >
                Focused Input
              </span>
              {focusedSelectedDeviceId == null ? (
                <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>
                  Activate an input on the left to edit routing and gains.
                </div>
              ) : (
                <div style={{ color: EMERALD, fontSize: 13, fontWeight: 600, marginTop: 4 }}>{focusedLabel}</div>
              )}
            </div>

            {focusedSelectedDeviceId != null ? (
              <>
                {Object.keys(inputDevices.deviceVolumes).length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <span style={INLINE_LABEL}>Gain</span>
                    <HSlider
                      value={laneCh(0)}
                      onChange={(v) => inputDevices.onSetDeviceLaneVolume(focusedSelectedDeviceId, 0, v)}
                      accent={EMERALD}
                      label={chCount >= 2 ? "Ch 1 (L)" : "Ch 1"}
                    />
                    {chCount >= 2 ? (
                      <HSlider
                        value={laneCh(1)}
                        onChange={(v) => inputDevices.onSetDeviceLaneVolume(focusedSelectedDeviceId, 1, v)}
                        accent={EMERALD}
                        label="Ch 2 (R)"
                      />
                    ) : null}
                  </div>
                ) : null}

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    borderTop: "1px solid rgba(255,255,255,0.05)",
                    paddingTop: 12,
                  }}
                >
                  <CheckRow
                    checked={inputDevices.interfaceInputDeviceFlags[focusedSelectedDeviceId] === true}
                    onChange={(on) => inputDevices.onSetInterfaceInputFlag(focusedSelectedDeviceId, on)}
                    label="Interface / line-in source"
                  />
                  <CheckRow
                    checked={inputDevices.interfaceLiveMonitorEnabledFlags[focusedSelectedDeviceId] === true}
                    onChange={(on) =>
                      inputDevices.onSetInterfaceLiveMonitor(focusedSelectedDeviceId, on)
                    }
                    label="Live monitor enabled"
                    warning="Use headphones to prevent feedback."
                  />
                </div>
                {inputDevices.recTrimSlot ?? null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const SESSION_COLORS: Record<KiteLoopV4SessionRecorderState, string> = {
  idle: "rgba(255,255,255,0.4)",
  recording: ORANGE,
  paused: "#eab308",
  saving: EMERALD,
};

export function KiteLoopV4Panel({
  looperState,
  looperConfig,
  looperHandlers,
  inputDevices,
  metronome,
}: KiteLoopV4PanelProps): React.JSX.Element {
  const timing = looperConfig.kiteIntervalTimingRef.current;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inputsOpen, setInputsOpen] = useState(false);
  const [calibrationDismissed, setCalibrationDismissed] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const handleToggleCamera = useCallback(async () => {
    if (isCameraActive) {
      cameraStream?.getTracks().forEach((t) => t.stop());
      setCameraStream(null);
      setIsCameraActive(false);
      setCameraError(null);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      setCameraStream(stream);
      setIsCameraActive(true);
      setCameraError(null);
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : "Camera access denied");
      setIsCameraActive(false);
    }
  }, [cameraStream, isCameraActive]);

  /** Webcam is UI-only aesthetic; stream must not be forwarded to audio / page.tsx. */
  useEffect(() => {
    const el = videoRef.current;
    if (el) el.srcObject = cameraStream;
  }, [cameraStream]);

  useEffect(() => {
    return () => {
      cameraStream?.getTracks().forEach((t) => t.stop());
    };
  }, [cameraStream]);

  useEffect(() => {
    try {
      const persisted = window.localStorage.getItem(CALIBRATION_DISMISSED_STORAGE_KEY);
      setCalibrationDismissed(persisted === "true");
    } catch {
      setCalibrationDismissed(false);
    }
  }, []);

  const masterPaused = looperState.isMasterPaused;
  const solo = looperState.soloLooperState;
  const sessionTapeState = looperState.sessionRecorderState;

  const masterTransportLive =
    !masterPaused &&
    (solo !== "idle" || looperState.isRecordingArmed || timing != null || looperState.loopProgress > 0);

  const beatCount = Math.max(
    1,
    Math.min(16, Math.round(looperConfig.kiteSetupTimeSignatureTop) || 4),
  );
  const showCalibrationOnboarding =
    looperState.showCalibrationOnboardingHint &&
    !calibrationDismissed &&
    !settingsOpen &&
    !inputsOpen &&
    looperState.runwayDisplay == null;

  const dismissCalibrationOnboarding = (): void => {
    setCalibrationDismissed(true);
    try {
      window.localStorage.setItem(CALIBRATION_DISMISSED_STORAGE_KEY, "true");
    } catch {
      /* ignore storage write errors */
    }
  };

  const centerWebcamLedColor = (): string => {
    if (cameraError) return ORANGE;
    if (isCameraActive) return EMERALD;
    return "rgba(255,255,255,0.15)";
  };

  const centerWebcamLabel = (): string => {
    if (cameraError) return "WEBCAM ERROR";
    if (isCameraActive) return "WEBCAM ON";
    return "WEBCAM OFF";
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 50,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        background: "#000",
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          zIndex: 0,
          opacity: 1,
        }}
      />

      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 1,
          background:
            "radial-gradient(ellipse 80% 60% at 50% 50%, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.4) 100%)",
        }}
      />

      {/* TOP NAV */}
      <nav
        style={{
          position: "relative",
          zIndex: 20,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          padding: "14px 16px 6px",
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={() => looperHandlers.onEndSession()}
            style={{
              ...glassSharp,
              padding: "7px 14px",
              background: "rgba(153,27,27,0.8)",
              border: "1px solid rgba(248,113,113,0.7)",
              color: "#fee2e2",
              fontSize: 11,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            End Session
          </button>
          <button
            type="button"
            onClick={() => {
              setSettingsOpen((v) => !v);
              setInputsOpen(false);
            }}
            style={{
              ...glassSharp,
              padding: "7px 14px",
              background: settingsOpen ? "rgba(255,69,0,0.1)" : "rgba(10,10,10,0.75)",
              border: `1px solid ${settingsOpen ? "rgba(255,69,0,0.4)" : "rgba(255,255,255,0.08)"}`,
              color: "rgba(255,255,255,0.75)",
              fontSize: 11,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Settings size={12} color={settingsOpen ? ORANGE : undefined} /> Settings
          </button>

          <button
            type="button"
            title={cameraError ?? undefined}
            onClick={() => void handleToggleCamera()}
            style={{
              ...glassSharp,
              padding: "7px 14px",
              background: ORANGE,
              border: `1px solid ${cameraError ? "#7f1d1d" : "#c2410c"}`,
              color: "#fff",
              fontSize: 11,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {isCameraActive ? <Video size={12} /> : <VideoOff size={12} />}
            Camera
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 26,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              backgroundImage: "linear-gradient(to right, #fb923c, #f5f5f4, #34d399)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            Kite Looper
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: centerWebcamLedColor(),
                boxShadow:
                  !isCameraActive && cameraError == null ? "none" : `0 0 7px ${centerWebcamLedColor()}`,
                animation:
                  cameraError === null && isCameraActive ? "kiteLooperV4Pulse 2.2s infinite" : undefined,
              }}
            />
            <span
              style={{
                color: "rgba(255,255,255,0.3)",
                fontSize: 8,
                letterSpacing: "0.2em",
                fontFamily: "monospace",
              }}
            >
              {centerWebcamLabel()}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            disabled={solo === "idle" && !looperState.isRecordingArmed}
            onClick={() => looperHandlers.onToggleMasterPause()}
            style={{
              ...glassSharp,
              padding: "7px 14px",
              cursor: solo === "idle" && !looperState.isRecordingArmed ? "not-allowed" : "pointer",
              opacity: solo === "idle" && !looperState.isRecordingArmed ? 0.45 : 1,
              border: "1px solid #c2410c",
              background: ORANGE,
              color: "#fff",
              fontSize: 11,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {masterPaused ? <Play size={12} /> : <Pause size={12} />}
            {masterPaused ? "Play" : "Pause"}
          </button>

          <button
            type="button"
            disabled={sessionTapeState === "saving"}
            onClick={() => looperHandlers.onToggleSessionRecording()}
            style={{
              ...glassSharp,
              padding: "7px 14px",
              cursor: sessionTapeState === "saving" ? "wait" : "pointer",
              border: `1px solid ${sessionTapeState !== "idle" ? "rgba(255,69,0,0.45)" : "rgba(255,255,255,0.08)"}`,
              background: sessionTapeState !== "idle" ? "rgba(255,69,0,0.08)" : "rgba(10,10,10,0.75)",
              color: SESSION_COLORS[sessionTapeState],
              fontSize: 11,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Circle
              size={10}
              style={{
                fill: sessionTapeState === "recording" ? ORANGE : "transparent",
                color: SESSION_COLORS[sessionTapeState],
              }}
            />
            {sessionTapeState === "idle"
              ? "Record Session"
              : sessionTapeState === "recording"
                ? "Recording…"
                : sessionTapeState === "paused"
                  ? "Tape Paused"
                  : "Saving…"}
          </button>

          {(solo === "recording" || solo === "captured") && (
            <button
              type="button"
              onClick={() => looperHandlers.onStopAndResetSoloLooper()}
              style={{
                ...glassSharp,
                padding: "7px 12px",
                cursor: "pointer",
                border: "1px solid rgba(239,68,68,0.45)",
                background: "rgba(239,68,68,0.08)",
                color: "rgba(252,211,206,1)",
                fontSize: 10,
              }}
            >
              Reset
            </button>
          )}
        </div>
      </nav>

      {/* MAIN ARENA */}
      <main
        style={{
          position: "relative",
          zIndex: 10,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-end",
          padding: "0 60px 18px",
          gap: 12,
        }}
      >
        <p
          style={{
            color: "rgba(255, 255, 255, 0.95)",
            fontWeight: 600,
            textShadow: "0 1px 3px rgba(0,0,0,0.9), 0 0 12px rgba(0,0,0,0.7)",
            fontSize: 9,
            letterSpacing: "0.12em",
            textAlign: "center",
          }}
        >
          Tap{" "}
          <strong style={{ fontFamily: "monospace", fontWeight: 800 }}>SPACE</strong> with a focused track, or tap the transport to
          start looping.
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {Array.from({ length: beatCount }, (_, i) => {
            const isDown = i === 0;
            const active =
              metronome.currentBeatIndex != null &&
              metronome.currentBeatIndex === i &&
              !masterPaused &&
              (solo !== "idle" || looperState.isRecordingArmed);

            const borderStyle = active
              ? `2px solid ${
                  isDown ? EMERALD : "rgba(255,255,255,0.4)"
                }`
              : "2px solid rgba(255, 255, 255, 0.4)";
            return (
              <div
                key={i}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  cursor: "default",
                  border: borderStyle,
                  background: active
                    ? isDown
                      ? "#22c55e"
                      : "rgba(255, 255, 255, 0.95)"
                    : "rgba(0, 0, 0, 0.4)",
                  boxShadow: active
                    ? isDown
                      ? "0 0 22px rgba(34,197,94,0.7)"
                      : "0 0 14px rgba(255,255,255,0.25)"
                    : "0 0 0 1px rgba(0,0,0,0.6), inset 0 1px rgba(255,255,255,0.15)",
                  transition: "all 0.08s",
                }}
              />
            );
          })}
        </div>

        <div style={{ position: "relative", width: "100%", maxWidth: 580 }}>
          <div style={{ display: "flex", gap: 8, width: "100%" }}>
            {looperState.soloTrackLanes.map((lane) => (
              <TrackColumn
                key={lane.trackIndex}
                lane={lane}
                masterOnIdleRecord={() => looperHandlers.onRecordFirstLoop()}
              />
            ))}
          </div>
          {showCalibrationOnboarding ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 35,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
              }}
            >
              <div
                style={{
                  ...glass,
                  pointerEvents: "auto",
                  width: "min(440px, 92%)",
                  padding: "14px 16px",
                  border: "1px solid rgba(255,69,0,0.38)",
                  background: "rgba(8,8,8,0.88)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  textAlign: "center",
                }}
              >
                <div style={{ color: "rgba(255,255,255,0.78)", fontSize: 12, fontWeight: 600 }}>
                  Latency not calibrated yet
                </div>
                <div style={{ color: "rgba(255,255,255,0.52)", fontSize: 10, lineHeight: 1.5 }}>
                  Calibrate once for tighter loop timing on this device.
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setInputsOpen(false);
                      setSettingsOpen(true);
                    }}
                    style={{
                      padding: "7px 10px",
                      borderRadius: 9,
                      border: "1px solid rgba(255,69,0,0.4)",
                      background: "rgba(255,69,0,0.12)",
                      color: ORANGE,
                      fontSize: 10,
                      cursor: "pointer",
                    }}
                  >
                    Go to Settings
                  </button>
                  <button
                    type="button"
                    onClick={dismissCalibrationOnboarding}
                    style={{
                      padding: "7px 10px",
                      borderRadius: 9,
                      border: "1px solid rgba(255,255,255,0.15)",
                      background: "rgba(255,255,255,0.04)",
                      color: "rgba(255,255,255,0.7)",
                      fontSize: 10,
                      cursor: "pointer",
                    }}
                  >
                    Dismiss for now
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </main>

      {/* Live meter */}
      <div style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", zIndex: 10 }}>
        <div
          style={{
            ...glass,
            borderRadius: 9999,
            padding: "18px 11px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Volume2 size={11} color="rgba(255,255,255,0.2)" />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <LiveSoundBar
              active={masterTransportLive}
              registerMasterLiveMeterElement={inputDevices.registerMasterLiveMeterElement}
            />
          </div>
          <span
            style={{
              color: "rgba(255,255,255,0.15)",
              fontSize: 7,
              letterSpacing: "0.14em",
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
              marginTop: 4,
              fontFamily: "monospace",
            }}
          >
            LIVE
          </span>
        </div>
      </div>

      <AnimatePresence>
        {!inputsOpen && (
          <motion.button
            type="button"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            onClick={() => {
              setInputsOpen(true);
              setSettingsOpen(false);
            }}
            style={{
              position: "absolute",
              right: 10,
              top: "50%",
              transform: "translateY(-50%)",
              zIndex: 10,
              ...glassSharp,
              borderRadius: 14,
              padding: "14px 8px",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(10,10,10,0.75)",
            }}
          >
            <Mic size={13} color={EMERALD} />
            <span
              style={{
                color: "rgba(255,255,255,0.5)",
                fontSize: 7,
                letterSpacing: "0.15em",
                writingMode: "vertical-rl",
                textTransform: "uppercase",
              }}
            >
              Input Device
            </span>
            <ChevronRight size={10} color="rgba(255,255,255,0.2)" />
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {settingsOpen && (
          <SettingsModal
            onClose={() => setSettingsOpen(false)}
            cfg={looperConfig}
            handlers={looperHandlers}
            metronomeVisualOnly={metronome.visualMetronomeControls}
            metronomeVolume={metronome.metronomeVolume}
            onMetronomeVolumeChange={metronome.onMetronomeVolumeChange}
            runwayVisualOnly={looperState.runwayVisualOnly}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {inputsOpen && (
          <InputModal
            onClose={() => setInputsOpen(false)}
            inputDevices={inputDevices}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {settingsOpen || inputsOpen ? (
          <motion.div
            role="presentation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              setSettingsOpen(false);
              setInputsOpen(false);
            }}
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 50,
              backdropFilter: "blur(3px)",
              background: "rgba(0,0,0,0.2)",
            }}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {looperState.runwayDisplay != null ? (
          <RunwayOverlay countdown={looperState.runwayDisplay} />
        ) : null}
      </AnimatePresence>

      <style>{`
        @keyframes kiteLooperV4Pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:13px; height:13px; border-radius:50%; background:#fff; cursor:pointer; box-shadow:0 0 4px rgba(0,0,0,0.6); }
        input[type=range] { -webkit-appearance:none; appearance:none; }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
}
