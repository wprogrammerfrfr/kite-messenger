"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  memo,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
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
  ChevronDown,
  Check,
  AlertTriangle,
  Video,
  VideoOff,
  Music2,
} from "lucide-react";

import type { KiteIntervalTiming } from "@/lib/kite-interval-math";
import type { RunwayDisplayLabel } from "@/lib/looper-runway-scheduler";

import type { LooperRunwayPhase } from "@/components/kite-loop-v2/LooperCountdownRunway";
import type { SoloLooperPlaybackUiStateEvent } from "@/lib/solo-looper-engine";
import { SoloLatencyCalibrationPanel } from "@/components/studio-bridge/SoloLatencyCalibrationPanel";
import type {
  GuidedRtlWizardState,
  SoloLooperMode,
  SoloLooperState,
} from "@/hooks/useKiteStudioEngine.types";
import { getBarCountOptionsForTimeSignature } from "@/lib/looper-math";
import KiteTunerPanel from "@/components/studio-bridge/KiteTunerPanel";
import KiteAirSynthPanel from "@/components/studio-bridge/KiteAirSynthPanel";
import { DEFAULT_INSTRUMENT_ID, type KiteTunerInstrumentId } from "@/hooks/useKiteTunerEngine";
import { useKiteAirSynthEngine } from "@/hooks/useKiteAirSynthEngine";
import type {
  AirSynthErrorCode,
  AirSynthMode,
  MusicalKey,
} from "@/lib/theremin/kite-theremin-types";
import { MUSICAL_KEYS } from "@/lib/theremin/kite-theremin-types";

export type SoloTrackLaneView = {
  trackIndex: 1 | 2 | 3 | 4;
  volume: number;
  progress: number;
  workletMode: string;
  onVolumeChange: (linear: number) => void;
  onArmRecord: () => void;
  armDisabled: boolean;
  armLabel: string;
  onResetTrack: () => void;
  resetDisabled: boolean;
  isFocused: boolean;
  onRequestFocus: () => void;
  /** Tracks 2–4: quantized overdub armed, waiting for Track 1 downbeat. */
  isOverdubArmedWaiting?: boolean;
  /** True when engine ref says this lane is capturing (before worklet slot.mode catches up). */
  isEngineRecording?: boolean;
  /** Grid/handsfree loop length in bars (lane-local). */
  barCount: number;
  barCountLocked: boolean;
  barCountDisabled: boolean;
  barCountOptions: readonly number[];
  onBarCountChange: (bars: number) => void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Public prop types — grouped buckets (mirror integration plan).

export type KiteLoopV4SessionRecorderState = "idle" | "recording" | "paused" | "saving";

export type KiteLoopV4LooperState = {
  soloLooperState: SoloLooperState;
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
  latencyCalibrationStale: boolean;
};

export type KiteLoopV4LooperConfig = {
  loopMode: SoloLooperMode;
  handsfreeAssist: boolean;
  /** True when Assist toggle must not change (timing locked, sequence active, or Handsfree off). */
  handsfreeAssistDisabled: boolean;
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
  onHandsfreeAssistChange: (on: boolean) => void;
  guidedRtlWizard: GuidedRtlWizardState;
  onBeginGuidedRtlWizard: () => void;
  onStartGuidedRtlCapture: () => void;
  onPreviewGuidedRtlLatencyMs: (ms: number) => void;
  onConfirmGuidedRtlWizard: () => void;
  onCancelGuidedRtlWizard: () => void;
  onRetryGuidedRtlCapture: () => void;
  latencyCalibrationStale: boolean;
  latencyStaleMessage: string | null;
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
  studioAudioContextRef: MutableRefObject<AudioContext | null>;
  activeStreamsMapRef: MutableRefObject<Map<string, MediaStream>>;
  /** Latest worklet slot snapshot for ref-driven lane progress fills. */
  soloTrackSlotUiLatestRef: MutableRefObject<
    SoloLooperPlaybackUiStateEvent["slots"] | null
  >;
  /** Master loop playback volume (0–1); live mic monitoring unaffected. */
  masterLoopVolume: number;
  onMasterLoopVolumeChange: (linear: number) => void;
  airSynth?: KiteLoopV4AirSynthProps;
};

export type KiteLoopV4AirSynthProps = {
  enabled: boolean;
  mode: AirSynthMode;
  key: MusicalKey;
  onEnabledChange: (enabled: boolean) => void;
  onModeChange: (mode: AirSynthMode) => void;
  onKeyChange: (key: MusicalKey) => void;
  registerVirtualInput: (deviceId: string, stream: MediaStream) => Promise<void>;
  unregisterVirtualInput: (deviceId: string) => Promise<void>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Tokens & glass primitives

const ORANGE = "#ff4500";
const EMERALD = "#22c55e";
const SLIDER_TRACK_EMPTY = "rgba(255,255,255,0.08)";

const STUDIO_GLOW_ROOT_BG =
  "radial-gradient(ellipse 140% 120% at 50% 38%, rgba(34, 197, 94, 0.32) 0%, rgba(255, 69, 0, 0.26) 28%, rgba(34, 197, 94, 0.14) 48%, rgba(0, 0, 0, 0.72) 78%, #000 100%)";
const STUDIO_GLOW_STAGE_BG =
  "radial-gradient(ellipse 115% 100% at 50% 50%, rgba(34, 197, 94, 0.30) 0%, rgba(255, 69, 0, 0.24) 38%, rgba(34, 197, 94, 0.12) 58%, rgba(0, 0, 0, 0.55) 82%, #000 100%)";
const STUDIO_GLOW_FRAME_SHADOW =
  "0 0 0 1px rgba(255,255,255,0.14), 0 0 48px rgba(34,197,94,0.55), 0 0 96px rgba(34,197,94,0.30), 0 0 140px rgba(255,69,0,0.35), 0 12px 48px rgba(0,0,0,0.55)";
const STUDIO_GLOW_VIGNETTE_BG =
  "radial-gradient(ellipse 85% 70% at 50% 45%, transparent 0%, rgba(0, 0, 0, 0.35) 72%, rgba(0, 0, 0, 0.65) 100%)";
const WEBCAM_FRAME_FALLBACK_ASPECT = 16 / 9;

function getWebcamFrameLayoutStyle(
  aspect: number,
  viewportWidth: number,
  viewportHeight: number,
  options?: { airSynthBoost?: boolean },
): CSSProperties {
  const boost = options?.airSynthBoost === true ? 1.12 : 1;
  const maxPct = `${100 * boost}%`;
  const base: CSSProperties = {
    aspectRatio: aspect,
    maxWidth: maxPct,
    maxHeight: maxPct,
    borderRadius: 14,
    overflow: "hidden",
    boxShadow: STUDIO_GLOW_FRAME_SHADOW,
  };
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return { ...base, width: maxPct, height: "auto" };
  }
  const effectiveHeight = viewportHeight / boost;
  const viewportAspect = viewportWidth / effectiveHeight;
  if (aspect >= viewportAspect) {
    return { ...base, width: maxPct, height: "auto" };
  }
  return { ...base, height: maxPct, width: "auto" };
}

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
const TUTORIAL_WATCHED_STORAGE_KEY = "kite-loop-tutorial-watched-v1";
const TUTORIAL_LATER_STORAGE_KEY = "kite-loop-tutorial-later-v1";
const TUTORIAL_VIDEO_URL = "https://youtu.be/4pTQ3RoJbQA";

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
  disabled?: boolean;
};

function Toggle({ checked, onChange, label, sublabel, disabled = false }: ToggleProps): React.JSX.Element {
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
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          onChange(!checked);
        }}
        style={{
          flexShrink: 0,
          width: 36,
          height: 20,
          borderRadius: 999,
          background: checked ? EMERALD : "rgba(255,255,255,0.1)",
          border: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.45 : 1,
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

type VertSliderProps = { value: number; onChange: (v: number) => void; compact?: boolean };

function VertSlider({ value, onChange, compact = false }: VertSliderProps): React.JSX.Element {
  const trackHeight = compact ? 42 : 60;
  const wrapHeight = compact ? 46 : 64;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        height: wrapHeight,
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
          height: trackHeight,
          borderRadius: 9999,
          outline: "none",
          background: `linear-gradient(to top,${ORANGE} ${value}%,rgba(255,255,255,0.09) ${value}%)`,
          accentColor: ORANGE,
        }}
      />
    </div>
  );
}

/** Shared glass pill chrome for LIVE meter and LOOPS master volume. */
function SideRailMeterPill({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
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
      {icon}
      <div
        style={{
          height: 231,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {children}
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
        {label}
      </span>
    </div>
  );
}

/** Master loop fader — matches LiveSoundBar height (231px) with emerald→orange fill. */
function MasterLoopVolumeSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}): React.JSX.Element {
  const fillPct = Math.max(0, Math.min(100, value));
  return (
    <div
      style={{
        position: "relative",
        width: 10,
        height: 231,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 9999,
          background: SLIDER_TRACK_EMPTY,
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: `${fillPct}%`,
            background: `linear-gradient(to top, ${EMERALD} 0%, #eab308 61%, ${ORANGE} 100%)`,
            borderRadius: 9999,
          }}
        />
      </div>
      <input
        type="range"
        className="kite-master-loop-slider"
        min={0}
        max={100}
        value={value}
        aria-label="Master loop volume"
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          position: "relative",
          zIndex: 1,
          WebkitAppearance: "none",
          appearance: "none",
          cursor: "pointer",
          writingMode: "vertical-lr",
          direction: "rtl",
          width: 10,
          height: 231,
          borderRadius: 9999,
          outline: "none",
          background: "transparent",
          accentColor: EMERALD,
          margin: 0,
        }}
      />
    </div>
  );
}

type RecVisualKey = "idle" | "waiting" | "recording" | "playing";

function mapLaneToRecVisual(lane: SoloTrackLaneView): RecVisualKey {
  if (lane.isOverdubArmedWaiting) return "waiting";
  if (lane.isEngineRecording) return "recording";
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

function laneFillScaleFromSlot(
  slot: SoloLooperPlaybackUiStateEvent["slots"][number] | undefined
): number {
  if (!slot || slot.intervalFrames <= 0) return 0;
  if (slot.mode === "recording") {
    return Math.min(1, Math.max(0, slot.recordCursor / slot.intervalFrames));
  }
  if (slot.mode === "playing") {
    return Math.min(1, Math.max(0, slot.playbackCursor / slot.intervalFrames));
  }
  return 0;
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
  registerTrackFillEl: (trackIndex: 1 | 2 | 3 | 4, el: HTMLDivElement | null) => void;
  gridLikeMode: boolean;
  compact?: boolean;
};

type BarCountStripProps = {
  options: readonly number[];
  value: number;
  disabled: boolean;
  locked: boolean;
  onChange: (bars: number) => void;
};

function BarCountStrip({
  options,
  value,
  disabled,
  locked,
  onChange,
}: BarCountStripProps): React.JSX.Element | null {
  if (locked) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          width: "100%",
          padding: "3px 0",
          borderRadius: 7,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(0,0,0,0.22)",
          color: "rgba(255,255,255,0.32)",
          fontSize: 9,
          fontFamily: "monospace",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {value} bar{value === 1 ? "" : "s"}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 3,
        width: "100%",
        justifyContent: "center",
        opacity: disabled ? 0.4 : 1,
        pointerEvents: disabled ? "none" : "auto",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {options.map((b) => (
        <button
          key={b}
          type="button"
          disabled={disabled}
          onClick={() => onChange(b)}
          style={{
            flex: options.length > 4 ? "1 1 26%" : 1,
            minWidth: options.length > 4 ? 22 : undefined,
            borderRadius: 6,
            padding: options.length > 4 ? "3px 0" : "4px 0",
            border: `1px solid ${value === b ? "rgba(34,197,94,0.55)" : "rgba(255,255,255,0.09)"}`,
            background: value === b ? "rgba(34,197,94,0.1)" : "transparent",
            color: value === b ? EMERALD : "rgba(255,255,255,0.32)",
            fontSize: options.length > 4 ? 9 : 10,
            fontFamily: "monospace",
            cursor: disabled ? "default" : "pointer",
            transition: "all 0.18s",
          }}
        >
          {b}
        </button>
      ))}
    </div>
  );
}

function TrackColumn({ lane, registerTrackFillEl, gridLikeMode, compact = false }: TrackColumnProps): React.JSX.Element {
  const visual = mapLaneToRecVisual(lane);
  const cfg = REC_CFG[visual];
  const isPulsing = visual === "waiting";
  const isMaster = lane.trackIndex === 1;
  const faderPct = Math.min(100, Math.max(0, Math.round(lane.volume * 100)));
  const ambient = resolveAmbientBackdropStyle(lane.workletMode, lane.progress);
  const canTapToToggle =
    visual === "recording" || visual === "waiting" || lane.isEngineRecording === true;
  const recInteractive = !lane.armDisabled || canTapToToggle;

  const handleRecPointerDown = (e: React.PointerEvent<HTMLButtonElement>): void => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (!recInteractive) return;
    e.preventDefault();
    lane.onArmRecord();
  };

  const handleRecClick = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation();
    if (e.detail !== 0) return;
    if (!recInteractive) return;
    lane.onArmRecord();
  };

  const recAriaLabel =
    visual === "recording" || lane.isEngineRecording
      ? `Stop recording ${trackDisplayName(lane.trackIndex)}`
      : visual === "waiting"
        ? `Disarm overdub ${trackDisplayName(lane.trackIndex)}`
        : isMaster && visual === "idle"
          ? "Start first loop on Master 1"
          : `Record on ${trackDisplayName(lane.trackIndex)}`;

  const handleClear = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (!lane.resetDisabled) lane.onResetTrack();
  };

  return (
    <div
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) lane.onRequestFocus();
      }}
      style={{
        ...glass,
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: compact ? "6px 6px" : "12px 8px",
        gap: compact ? 4 : 8,
        position: "relative",
        overflow: "hidden",
        cursor: "pointer",
        borderColor: lane.isFocused ? "rgba(255,69,0,0.45)" : "rgba(255,255,255,0.08)",
        transition: "border-color 0.2s, padding 0.18s, gap 0.18s",
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
        ref={(el) => registerTrackFillEl(lane.trackIndex, el)}
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "inherit",
          pointerEvents: "none",
          zIndex: 0,
          background: ambient.fillBackground,
          transformOrigin: "bottom",
          transform: "scaleY(0)",
          willChange: "transform",
        }}
      />
      <span
        style={{
          position: "relative",
          zIndex: 1,
          color: EMERALD,
          fontSize: compact ? 8 : 9,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          fontWeight: 600,
          opacity: 0.85,
        }}
      >
        {trackDisplayName(lane.trackIndex)}
      </span>

      {gridLikeMode ? (
        <div style={{ position: "relative", zIndex: 1, width: "100%" }}>
          <BarCountStrip
            options={lane.barCountOptions}
            value={lane.barCount}
            disabled={lane.barCountDisabled}
            locked={lane.barCountLocked}
            onChange={lane.onBarCountChange}
          />
        </div>
      ) : null}

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
        <VertSlider value={faderPct} onChange={(v) => lane.onVolumeChange(v / 100)} compact={compact} />
      </div>

      <motion.button
        type="button"
        aria-label={recAriaLabel}
        animate={isPulsing ? { opacity: [1, 0.5, 1] } : { opacity: recInteractive ? 1 : 0.45 }}
        transition={isPulsing ? { repeat: Infinity, duration: 0.9 } : {}}
        onPointerDown={handleRecPointerDown}
        onClick={handleRecClick}
        disabled={!recInteractive}
        style={{
          position: "relative",
          zIndex: 1,
          width: compact ? 56 : 80,
          height: compact ? 56 : 80,
          borderRadius: "50%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: cfg.bg,
          border: `2px solid ${cfg.bord}`,
          boxShadow: cfg.glow,
          cursor: recInteractive ? "pointer" : "not-allowed",
          gap: 4,
          padding: 0,
          touchAction: "manipulation",
          WebkitTapHighlightColor: "transparent",
          transition: "background 0.18s, border-color 0.18s",
        }}
      >
        <div
          style={{
            width: compact ? 14 : 18,
            height: compact ? 14 : 18,
            borderRadius: "50%",
            background: cfg.col,
            opacity: visual === "idle" && !lane.isEngineRecording ? 0.25 : 1,
            transition: "all 0.15s",
          }}
        />
        <span style={{ fontSize: 7, letterSpacing: "0.12em", color: cfg.col, textTransform: "uppercase" }}>
          {isMaster && visual === "idle" && !lane.isEngineRecording ? "START" : cfg.lbl}
        </span>
      </motion.button>

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
          fontSize: compact ? 6 : 7,
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
  airSynth?: KiteLoopV4AirSynthProps;
  isAirSynthActive: boolean;
  isCameraActive: boolean;
  airSynthStatusLine: string;
  airSynthError: AirSynthErrorCode;
  onAirSynthRetry: () => void;
  airSynthVolume: number;
  onAirSynthVolumeChange: (level: number) => void;
  airSynthWaveform: OscillatorType;
  onAirSynthWaveformChange: (type: OscillatorType) => void;
};

const AIR_SYNTH_WAVEFORM_OPTIONS: { value: OscillatorType; label: string }[] = [
  { value: "sine", label: "Sine" },
  { value: "square", label: "Square" },
  { value: "sawtooth", label: "Sawtooth" },
  { value: "triangle", label: "Triangle" },
];

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
  airSynth,
  isAirSynthActive,
  isCameraActive,
  airSynthStatusLine,
  airSynthError,
  onAirSynthRetry,
  airSynthVolume,
  onAirSynthVolumeChange,
  airSynthWaveform,
  onAirSynthWaveformChange,
}: SettingsModalProps): React.JSX.Element {
  const [airSynthKeyMenuOpen, setAirSynthKeyMenuOpen] = useState(false);
  const [airSynthWaveformMenuOpen, setAirSynthWaveformMenuOpen] = useState(false);
  const tapTimes = useRef<number[]>([]);

  const bpm = cfg.kiteSetupTempo;
  const gridMode = cfg.loopMode === "grid";
  const handsfreeMode = cfg.loopMode === "handsfree";
  const gridLikeMode = gridMode || handsfreeMode;
  const locked = cfg.isTimingLocked;
  const handleGridToggle = (on: boolean): void => {
    if (isAirSynthActive) {
      if (!on) {
        handlers.onLoopModeChange(handsfreeMode ? "handsfree" : "grid");
      } else {
        handlers.onLoopModeChange("grid");
      }
      return;
    }
    handlers.onLoopModeChange(on ? "grid" : "free");
  };
  const handleHandsfreeToggle = (on: boolean): void => {
    if (isAirSynthActive) {
      if (!on) {
        handlers.onLoopModeChange(gridMode ? "grid" : "handsfree");
      } else {
        handlers.onLoopModeChange("handsfree");
      }
      return;
    }
    handlers.onLoopModeChange(on ? "handsfree" : "free");
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

            <SoloLatencyCalibrationPanel
              variant="settings"
              latencyMs={cfg.latencyMs}
              stale={handlers.latencyCalibrationStale}
              staleMessage={handlers.latencyStaleMessage}
              disabled={cfg.isTimingLocked}
              wizard={handlers.guidedRtlWizard}
              onBeginWizard={handlers.onBeginGuidedRtlWizard}
              onStartCapture={handlers.onStartGuidedRtlCapture}
              onPreviewLatencyMs={handlers.onPreviewGuidedRtlLatencyMs}
              onConfirm={handlers.onConfirmGuidedRtlWizard}
              onCancel={handlers.onCancelGuidedRtlWizard}
              onRetryCapture={handlers.onRetryGuidedRtlCapture}
            />
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
                onChange={handleGridToggle}
                label="Grid Mode"
                sublabel={
                  isAirSynthActive
                    ? "Free Mode unavailable while Air Synth is active — use Grid or Handsfree."
                    : "Off = Free Mode (no quantize)"
                }
              />
              <Toggle
                checked={handsfreeMode}
                onChange={handleHandsfreeToggle}
                label="Handsfree Mode"
                sublabel="Auto-record tracks 1→4 at loop boundaries"
              />
              <Toggle
                checked={cfg.handsfreeAssist}
                onChange={handlers.onHandsfreeAssistChange}
                label="Handsfree Assist"
                sublabel="Wait one full loop between takes"
                disabled={cfg.handsfreeAssistDisabled}
              />
              <span style={{ color: "rgba(255,255,255,0.28)", fontSize: 9, lineHeight: 1.45 }}>
                Set bar length on each track lane below.
              </span>
            </div>

            {airSynth ? (
              <div
                style={{
                  borderTop: "1px solid rgba(255,255,255,0.05)",
                  paddingTop: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  marginTop: 4,
                }}
              >
                {sLabel("Air Synth")}
                <div
                  style={{
                    opacity: isCameraActive ? 1 : 0.45,
                    pointerEvents: isCameraActive ? "auto" : "none",
                  }}
                >
                  <Toggle
                    checked={airSynth.enabled}
                    onChange={airSynth.onEnabledChange}
                    label="Air Synth"
                    sublabel="Webcam chord input — requires Camera on"
                  />
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {(
                    [
                      { label: "1-Dial", mode: "single-hand" as const },
                      { label: "2-Dial", mode: "two-hand" as const },
                    ] as const
                  ).map(({ label, mode }) => {
                    const sel = airSynth.mode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => airSynth.onModeChange(mode)}
                        style={{
                          flex: 1,
                          borderRadius: 9,
                          padding: "8px 0",
                          border: `1px solid ${sel ? "rgba(255,69,0,0.55)" : "rgba(255,255,255,0.09)"}`,
                          background: sel ? "rgba(255,69,0,0.1)" : "transparent",
                          color: sel ? ORANGE : "rgba(255,255,255,0.38)",
                          fontSize: 11,
                          cursor: "pointer",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <DropdownMenu.Root open={airSynthKeyMenuOpen} onOpenChange={setAirSynthKeyMenuOpen}>
                    <DropdownMenu.Trigger asChild>
                      <button
                        type="button"
                        aria-label="Select key"
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          borderRadius: 9,
                          padding: "8px 10px",
                          border: `1px solid ${
                            airSynthKeyMenuOpen
                              ? "rgba(255,69,0,0.55)"
                              : "rgba(255,255,255,0.09)"
                          }`,
                          background: airSynthKeyMenuOpen
                            ? "rgba(255,69,0,0.1)"
                            : "rgba(0,0,0,0.35)",
                          color: airSynthKeyMenuOpen ? ORANGE : "rgba(255,255,255,0.6)",
                          fontSize: 11,
                          fontFamily: "monospace",
                          cursor: "pointer",
                          outline: "none",
                        }}
                      >
                        <span>{airSynth.key} major</span>
                        <ChevronDown
                          size={12}
                          style={{
                            opacity: 0.55,
                            flexShrink: 0,
                            transform: airSynthKeyMenuOpen ? "rotate(180deg)" : undefined,
                            transition: "transform 0.15s",
                          }}
                          aria-hidden
                        />
                      </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content
                        sideOffset={6}
                        align="start"
                        style={{
                          ...glassSharp,
                          zIndex: 80,
                          minWidth: "var(--radix-dropdown-menu-trigger-width)",
                          padding: 4,
                          boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
                        }}
                      >
                        {MUSICAL_KEYS.map((k) => {
                          const selected = airSynth.key === k;
                          return (
                            <DropdownMenu.Item
                              key={k}
                              onSelect={() => airSynth.onKeyChange(k)}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                borderRadius: 7,
                                padding: "8px 10px",
                                fontSize: 11,
                                fontFamily: "monospace",
                                cursor: "pointer",
                                outline: "none",
                                color: selected ? EMERALD : "rgba(255,255,255,0.55)",
                                background: selected ? "rgba(34,197,94,0.08)" : "transparent",
                              }}
                            >
                              <span>{k} major</span>
                              {selected ? (
                                <Check size={12} color={EMERALD} aria-hidden />
                              ) : null}
                            </DropdownMenu.Item>
                          );
                        })}
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={INLINE_LABEL}>Air Synth Volume</span>
                  <HSlider
                    value={Math.round(airSynthVolume * 100)}
                    onChange={(v) => onAirSynthVolumeChange(v / 100)}
                    min={0}
                    max={100}
                    accent={EMERALD}
                    disabled={!airSynth.enabled}
                    title="Air Synth output level before looper sum (0–100%)"
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={INLINE_LABEL}>Waveform</span>
                  <DropdownMenu.Root
                    open={airSynthWaveformMenuOpen}
                    onOpenChange={(open) => {
                      if (!airSynth.enabled) return;
                      setAirSynthWaveformMenuOpen(open);
                    }}
                  >
                    <DropdownMenu.Trigger asChild>
                      <button
                        type="button"
                        aria-label="Select waveform"
                        disabled={!airSynth.enabled}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          borderRadius: 9,
                          padding: "8px 10px",
                          border: `1px solid ${
                            airSynthWaveformMenuOpen
                              ? "rgba(255,69,0,0.55)"
                              : "rgba(255,255,255,0.09)"
                          }`,
                          background: airSynthWaveformMenuOpen
                            ? "rgba(255,69,0,0.1)"
                            : "rgba(0,0,0,0.35)",
                          color: !airSynth.enabled
                            ? "rgba(255,255,255,0.28)"
                            : airSynthWaveformMenuOpen
                              ? ORANGE
                              : "rgba(255,255,255,0.6)",
                          fontSize: 11,
                          fontFamily: "monospace",
                          cursor: airSynth.enabled ? "pointer" : "not-allowed",
                          outline: "none",
                          opacity: airSynth.enabled ? 1 : 0.55,
                        }}
                      >
                        <span>
                          {AIR_SYNTH_WAVEFORM_OPTIONS.find((o) => o.value === airSynthWaveform)
                            ?.label ?? "Triangle"}
                        </span>
                        <ChevronDown
                          size={12}
                          style={{
                            opacity: 0.55,
                            flexShrink: 0,
                            transform: airSynthWaveformMenuOpen ? "rotate(180deg)" : undefined,
                            transition: "transform 0.15s",
                          }}
                          aria-hidden
                        />
                      </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content
                        sideOffset={6}
                        align="start"
                        style={{
                          ...glassSharp,
                          zIndex: 80,
                          minWidth: "var(--radix-dropdown-menu-trigger-width)",
                          padding: 4,
                          boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
                        }}
                      >
                        {AIR_SYNTH_WAVEFORM_OPTIONS.map(({ value, label }) => {
                          const selected = airSynthWaveform === value;
                          return (
                            <DropdownMenu.Item
                              key={value}
                              onSelect={() => onAirSynthWaveformChange(value)}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                borderRadius: 7,
                                padding: "8px 10px",
                                fontSize: 11,
                                fontFamily: "monospace",
                                cursor: "pointer",
                                outline: "none",
                                color: selected ? EMERALD : "rgba(255,255,255,0.55)",
                                background: selected ? "rgba(34,197,94,0.08)" : "transparent",
                              }}
                            >
                              <span>{label}</span>
                              {selected ? (
                                <Check size={12} color={EMERALD} aria-hidden />
                              ) : null}
                            </DropdownMenu.Item>
                          );
                        })}
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={INLINE_LABEL}>Status</span>
                  <span
                    style={{
                      fontFamily: "monospace",
                      fontSize: 11,
                      color:
                        airSynth.enabled && airSynthError === "none"
                          ? EMERALD
                          : "rgba(255,255,255,0.55)",
                    }}
                  >
                    {airSynthStatusLine}
                  </span>
                </div>
                {airSynthError !== "none" ? (
                  <div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 5,
                        paddingLeft: 21,
                        color: ORANGE,
                        fontSize: 9,
                        lineHeight: 1.4,
                      }}
                    >
                      <AlertTriangle size={11} style={{ flexShrink: 0, marginTop: 1 }} />
                      {airSynthError === "vision_load_failed"
                        ? "Vision engine failed to load."
                        : airSynthError === "webcam_missing"
                          ? "Webcam not available."
                          : airSynthError === "audio_suspended"
                            ? "Tap to resume audio context."
                            : airSynthError === "audio_context_missing"
                              ? "Audio context not ready."
                              : "Air Synth error."}
                    </div>
                    <button type="button" onClick={onAirSynthRetry} style={RESET_BTN}>
                      Retry
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
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
                    <span className="font-sans text-[11px] font-medium uppercase tracking-widest text-emerald-500">Gain</span>
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
  idle: "#ef4444",
  recording: ORANGE,
  paused: "#eab308",
  saving: EMERALD,
};

export const KiteLoopV4Panel = memo(function KiteLoopV4Panel({
  looperState,
  looperConfig,
  looperHandlers,
  inputDevices,
  metronome,
  studioAudioContextRef,
  activeStreamsMapRef,
  soloTrackSlotUiLatestRef,
  masterLoopVolume,
  onMasterLoopVolumeChange,
  airSynth,
}: KiteLoopV4PanelProps): React.JSX.Element {
  const timing = looperConfig.kiteIntervalTimingRef.current;
  const gridLikeMode =
    looperConfig.loopMode === "grid" || looperConfig.loopMode === "handsfree";
  const isAirSynthActive = airSynth?.enabled === true;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inputsOpen, setInputsOpen] = useState(false);
  const [isTunerOpen, setIsTunerOpen] = useState(false);
  const [tunerInstrumentId, setTunerInstrumentId] =
    useState<KiteTunerInstrumentId>(DEFAULT_INSTRUMENT_ID);
  const [calibrationDismissed, setCalibrationDismissed] = useState(false);
  const [showTutorialModal, setShowTutorialModal] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const webcamFrameRef = useRef<HTMLDivElement>(null);
  const videoAspectRatioRef = useRef(WEBCAM_FRAME_FALLBACK_ASPECT);
  const trackFillRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  /** Reactive snapshot of the studio AudioContext (ref alone does not re-render). */
  const [studioAudioContext, setStudioAudioContext] = useState<AudioContext | null>(
    () => studioAudioContextRef.current
  );

  useEffect(() => {
    const sync = (): void => {
      setStudioAudioContext(studioAudioContextRef.current);
    };
    sync();
    const ctx = studioAudioContextRef.current;
    if (!ctx) return;
    ctx.addEventListener("statechange", sync);
    return () => {
      ctx.removeEventListener("statechange", sync);
    };
  }, [studioAudioContextRef, isAirSynthActive, isCameraActive, videoReady]);

  const noopRegister = useCallback(async () => {}, []);
  const airSynthEngine = useKiteAirSynthEngine({
    audioContext: studioAudioContext,
    videoElement: videoReady ? videoRef.current : null,
    enabled: isAirSynthActive && isCameraActive && videoReady,
    mode: airSynth?.mode ?? "two-hand",
    key: airSynth?.key ?? "C",
    registerVirtualInput: airSynth?.registerVirtualInput ?? noopRegister,
    unregisterVirtualInput: airSynth?.unregisterVirtualInput ?? noopRegister,
  });

  const airSynthStatusLine = ((): string => {
    if (!airSynth?.enabled) return "Off";
    if (airSynthEngine.error !== "none") return "Error";
    if (airSynthEngine.status === "booting") return "Starting…";
    if (airSynthEngine.activeZone?.mode === "two-hand") {
      return `${airSynthEngine.activeZone.root} · ${airSynthEngine.activeZone.chordType}`;
    }
    if (airSynthEngine.activeZone?.mode === "single-hand") {
      return airSynthEngine.activeZone.degree;
    }
    return airSynthEngine.isVisionReady ? "Ready — move hands" : "Waiting…";
  })();

  const applyWebcamFrameLayout = useCallback(() => {
    const frameEl = webcamFrameRef.current;
    if (!frameEl) return;
    const layout = getWebcamFrameLayoutStyle(
      videoAspectRatioRef.current,
      window.innerWidth,
      window.innerHeight,
      { airSynthBoost: isAirSynthActive }
    );
    frameEl.style.aspectRatio = String(layout.aspectRatio ?? "");
    frameEl.style.maxWidth = layout.maxWidth as string;
    frameEl.style.maxHeight = layout.maxHeight as string;
    frameEl.style.borderRadius = String(layout.borderRadius ?? "");
    frameEl.style.overflow = layout.overflow as string;
    frameEl.style.boxShadow = layout.boxShadow as string;
    if (layout.width) frameEl.style.width = layout.width as string;
    if (layout.height) frameEl.style.height = layout.height as string;
  }, [isAirSynthActive]);

  const registerTrackFillEl = useCallback(
    (trackIndex: 1 | 2 | 3 | 4, el: HTMLDivElement | null) => {
      if (el) {
        trackFillRefs.current.set(trackIndex, el);
      } else {
        trackFillRefs.current.delete(trackIndex);
      }
    },
    []
  );

  const handleVideoMetadata = useCallback(() => {
    const el = videoRef.current;
    if (!el || el.videoWidth <= 0 || el.videoHeight <= 0) return;
    videoAspectRatioRef.current = el.videoWidth / el.videoHeight;
    setVideoReady(true);
    applyWebcamFrameLayout();
  }, [applyWebcamFrameLayout]);

  useEffect(() => {
    let rafId = 0;
    const tick = (): void => {
      const slots = soloTrackSlotUiLatestRef.current;
      for (let trackIndex = 1; trackIndex <= 4; trackIndex += 1) {
        const fillEl = trackFillRefs.current.get(trackIndex);
        if (!fillEl) continue;
        const slot = slots?.find((s) => s.trackIndex === trackIndex);
        const scaleY = laneFillScaleFromSlot(slot);
        fillEl.style.transform = `scaleY(${scaleY})`;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [soloTrackSlotUiLatestRef]);

  useEffect(() => {
    if (!isCameraActive) return;
    const onResize = (): void => {
      applyWebcamFrameLayout();
    };
    window.addEventListener("resize", onResize);
    applyWebcamFrameLayout();
    return () => window.removeEventListener("resize", onResize);
  }, [isCameraActive, applyWebcamFrameLayout]);

  const handleToggleCamera = useCallback(async () => {
    if (isCameraActive) {
      cameraStream?.getTracks().forEach((t) => t.stop());
      setCameraStream(null);
      setIsCameraActive(false);
      setCameraError(null);
      setVideoReady(false);
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

  useEffect(() => {
    const el = videoRef.current;
    if (el) el.srcObject = cameraStream;
    if (cameraStream) {
      requestAnimationFrame(() => applyWebcamFrameLayout());
    }
  }, [cameraStream, applyWebcamFrameLayout]);

  useEffect(() => {
    if (!cameraStream) {
      videoAspectRatioRef.current = WEBCAM_FRAME_FALLBACK_ASPECT;
    }
  }, [cameraStream]);

  useEffect(() => {
    return () => {
      cameraStream?.getTracks().forEach((t) => t.stop());
    };
  }, [cameraStream]);

  // Ensure cancel cleans up metronome/preview if the panel unmounts mid-wizard.
  useEffect(() => {
    return () => {
      if (looperHandlers.guidedRtlWizard.open) {
        looperHandlers.onCancelGuidedRtlWizard();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount-only cleanup
  }, []);

  useEffect(() => {
    try {
      const persisted = window.localStorage.getItem(CALIBRATION_DISMISSED_STORAGE_KEY);
      setCalibrationDismissed(persisted === "true");
    } catch {
      setCalibrationDismissed(false);
    }
  }, []);

  // First-visit tutorial: defer while RTL wizard is open; permanent only after watching video.
  useEffect(() => {
    if (looperHandlers.guidedRtlWizard.open) {
      setShowTutorialModal(false);
      return;
    }
    try {
      if (window.localStorage.getItem(TUTORIAL_WATCHED_STORAGE_KEY) === "1") {
        setShowTutorialModal(false);
        return;
      }
      if (window.sessionStorage.getItem(TUTORIAL_LATER_STORAGE_KEY) === "1") {
        setShowTutorialModal(false);
        return;
      }
    } catch {
      /* storage unavailable — still offer tutorial this visit */
    }
    setShowTutorialModal(true);
  }, [looperHandlers.guidedRtlWizard.open]);

  // First-boot / stale: auto-open guided wizard once Solo Studio is ready and idle.
  const autoWizardLaunchedRef = useRef(false);
  useEffect(() => {
    if (autoWizardLaunchedRef.current) return;
    if (looperHandlers.guidedRtlWizard.open) {
      autoWizardLaunchedRef.current = true;
      return;
    }
    if (looperConfig.isTimingLocked) return;
    const shouldAutoOpen =
      (looperState.showCalibrationOnboardingHint || looperState.latencyCalibrationStale) &&
      !calibrationDismissed &&
      looperState.soloLooperState === "idle" &&
      !looperState.isRecordingArmed;
    if (!shouldAutoOpen) return;
    autoWizardLaunchedRef.current = true;
    looperHandlers.onBeginGuidedRtlWizard();
  }, [
    calibrationDismissed,
    looperConfig.isTimingLocked,
    looperHandlers,
    looperState.isRecordingArmed,
    looperState.latencyCalibrationStale,
    looperState.showCalibrationOnboardingHint,
    looperState.soloLooperState,
  ]);

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
    (looperState.showCalibrationOnboardingHint || looperState.latencyCalibrationStale) &&
    !calibrationDismissed &&
    !looperHandlers.guidedRtlWizard.open &&
    !settingsOpen &&
    !inputsOpen &&
    !isTunerOpen &&
    looperState.runwayDisplay == null;

  const primaryRawStream = ((): MediaStream | null => {
    for (const deviceId of inputDevices.activeDeviceIds) {
      const stream = activeStreamsMapRef.current.get(deviceId) ?? null;
      if (stream?.getAudioTracks().some((track) => track.readyState === "live")) {
        return stream;
      }
    }
    return null;
  })();

  const dismissCalibrationOnboarding = (): void => {
    setCalibrationDismissed(true);
    try {
      window.localStorage.setItem(CALIBRATION_DISMISSED_STORAGE_KEY, "true");
    } catch {
      /* ignore storage write errors */
    }
  };

  const dismissTutorialMaybeLater = (): void => {
    setShowTutorialModal(false);
    try {
      window.sessionStorage.setItem(TUTORIAL_LATER_STORAGE_KEY, "1");
    } catch {
      /* ignore storage write errors */
    }
  };

  const openTutorialVideo = (): void => {
    try {
      window.localStorage.setItem(TUTORIAL_WATCHED_STORAGE_KEY, "1");
    } catch {
      /* ignore storage write errors */
    }
    setShowTutorialModal(false);
    window.open(TUTORIAL_VIDEO_URL, "_blank", "noopener,noreferrer");
  };

  const launchGuidedCalibration = (): void => {
    if (looperConfig.isTimingLocked) return;
    setInputsOpen(false);
    setSettingsOpen(false);
    dismissCalibrationOnboarding();
    looperHandlers.onBeginGuidedRtlWizard();
  };

  const centerWebcamLedColor = (): string => {
    if (isAirSynthActive && !isCameraActive) return ORANGE;
    if (cameraError) return ORANGE;
    if (isCameraActive) return EMERALD;
    return "rgba(255,255,255,0.15)";
  };

  const centerWebcamLabel = (): string => {
    if (isAirSynthActive && !isCameraActive) return "AIR SYNTH · NO CAMERA";
    if (cameraError) return "WEBCAM ERROR";
    if (isCameraActive && isAirSynthActive) return "WEBCAM ON · AIR SYNTH ON";
    if (isCameraActive) return "WEBCAM ON";
    return "WEBCAM OFF";
  };

  const webcamFrameAspect = videoAspectRatioRef.current;

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
        background: STUDIO_GLOW_ROOT_BG,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          zIndex: 0,
          background: STUDIO_GLOW_STAGE_BG,
        }}
      >
        {isCameraActive ? (
          <div
            ref={webcamFrameRef}
            style={{
              ...getWebcamFrameLayoutStyle(
                webcamFrameAspect,
                typeof window !== "undefined" ? window.innerWidth : 0,
                typeof window !== "undefined" ? window.innerHeight : 0,
                { airSynthBoost: isAirSynthActive }
              ),
              position: "relative",
            }}
          >
            <div
              style={{
                position: "relative",
                width: "100%",
                height: "100%",
                transform: "scaleX(-1)",
              }}
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                onLoadedMetadata={handleVideoMetadata}
                style={{
                  display: "block",
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  background: "#000",
                }}
              />
            </div>
            <KiteAirSynthPanel
              visible={isAirSynthActive && isCameraActive}
              mode={airSynth?.mode ?? "two-hand"}
              musicalKey={airSynth?.key ?? "C"}
              activeZone={airSynthEngine.activeZone}
              fingerPointersRef={airSynthEngine.fingerPointersRef}
            />
          </div>
        ) : null}
      </div>

      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 1,
          background: STUDIO_GLOW_VIGNETTE_BG,
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
              setIsTunerOpen(false);
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

        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
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

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              gap: 6,
            }}
          >
            <button
              type="button"
              disabled={sessionTapeState === "saving"}
              onClick={() => looperHandlers.onToggleSessionRecording()}
              style={{
                ...glassSharp,
                padding: "7px 14px",
                cursor: sessionTapeState === "saving" ? "wait" : "pointer",
                border: `1px solid ${sessionTapeState !== "idle" ? "rgba(255,69,0,0.45)" : "rgba(239, 68, 68, 0.5)"}`,
                background: sessionTapeState !== "idle" ? "rgba(255,69,0,0.08)" : "rgba(239, 68, 68, 0.06)",
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

            <AnimatePresence>
              {!inputsOpen ? (
                <motion.button
                  type="button"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  onClick={() => {
                    setInputsOpen(true);
                    setSettingsOpen(false);
                    setIsTunerOpen(false);
                  }}
                  style={{
                    ...glassSharp,
                    padding: "6px 10px",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(10,10,10,0.75)",
                    color: "rgba(255,255,255,0.5)",
                    fontSize: 10,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  <Mic size={12} color={EMERALD} />
                  Input Device
                  <ChevronRight size={10} color="rgba(255,255,255,0.2)" />
                </motion.button>
              ) : null}
            </AnimatePresence>
          </div>

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
          padding: isAirSynthActive ? "0 60px 10px" : "0 60px 18px",
          gap: isAirSynthActive ? 8 : 12,
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
          {showCalibrationOnboarding ? (
            <div
              style={{
                ...glass,
                marginBottom: 8,
                zIndex: 35,
                width: "100%",
                boxSizing: "border-box",
                padding: "8px 10px",
                border: "1px solid rgba(255,69,0,0.32)",
                background: "rgba(8,8,8,0.82)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
                <div style={{ color: "rgba(255,255,255,0.78)", fontSize: 11, fontWeight: 600 }}>
                  {looperState.latencyCalibrationStale
                    ? "Latency calibration is stale"
                    : "Latency not calibrated yet"}
                </div>
                <div style={{ color: "rgba(255,255,255,0.52)", fontSize: 10, lineHeight: 1.4 }}>
                  {looperState.latencyCalibrationStale
                    ? "Audio hardware changed. Run the guided clap wizard for tighter loop timing."
                    : "Run the guided clap wizard once for tighter loop timing on this device."}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  disabled={looperConfig.isTimingLocked}
                  onClick={launchGuidedCalibration}
                  style={{
                    padding: "6px 9px",
                    borderRadius: 8,
                    border: "1px solid rgba(255,69,0,0.4)",
                    background: "rgba(255,69,0,0.12)",
                    color: ORANGE,
                    fontSize: 10,
                    cursor: looperConfig.isTimingLocked ? "not-allowed" : "pointer",
                    opacity: looperConfig.isTimingLocked ? 0.5 : 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  Start calibration
                </button>
                <button
                  type="button"
                  onClick={dismissCalibrationOnboarding}
                  style={{
                    padding: "6px 9px",
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.15)",
                    background: "rgba(255,255,255,0.04)",
                    color: "rgba(255,255,255,0.7)",
                    fontSize: 10,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 8, width: "100%" }}>
            {looperState.soloTrackLanes.map((lane) => (
              <TrackColumn
                key={lane.trackIndex}
                lane={lane}
                registerTrackFillEl={registerTrackFillEl}
                gridLikeMode={gridLikeMode}
                compact={isAirSynthActive}
              />
            ))}
          </div>
        </div>
      </main>

      {/* Live meter + tuner toggle */}
      <div
        style={{
          position: "absolute",
          left: 10,
          top: "50%",
          transform: "translateY(-50%)",
          zIndex: 10,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
        }}
      >
        <button
          type="button"
          aria-label={isTunerOpen ? "Close tuner" : "Open tuner"}
          aria-pressed={isTunerOpen}
          onClick={() => {
            setIsTunerOpen((v) => !v);
            setInputsOpen(false);
            setSettingsOpen(false);
          }}
          style={{
            ...glassSharp,
            minWidth: 42,
            padding: "10px 8px 8px",
            borderRadius: 14,
            background: isTunerOpen ? "rgba(34,197,94,0.1)" : "rgba(10,10,10,0.75)",
            border: `1px solid ${isTunerOpen ? "rgba(34,197,94,0.4)" : "rgba(255,255,255,0.08)"}`,
            color: "rgba(255,255,255,0.75)",
            cursor: "pointer",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            flexShrink: 0,
          }}
        >
          <Music2 size={14} color={isTunerOpen ? EMERALD : "rgba(255,255,255,0.55)"} />
          <span
            style={{
              color: isTunerOpen ? EMERALD : "rgba(34,197,94,0.85)",
              fontSize: 7,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              fontWeight: 600,
              lineHeight: 1,
            }}
          >
            Tuner
          </span>
        </button>

        <SideRailMeterPill
          icon={<Volume2 size={11} color="rgba(255,255,255,0.2)" />}
          label="LIVE"
        >
          <LiveSoundBar
            active={masterTransportLive}
            registerMasterLiveMeterElement={inputDevices.registerMasterLiveMeterElement}
          />
        </SideRailMeterPill>
      </div>

      {/* Master loop volume — right rail */}
      <div
        style={{
          position: "absolute",
          right: 10,
          top: "50%",
          transform: "translateY(-50%)",
          zIndex: 10,
        }}
      >
        <SideRailMeterPill
          icon={<Volume2 size={11} color="rgba(34,197,94,0.35)" />}
          label="LOOPS"
        >
          <MasterLoopVolumeSlider
            value={Math.round(masterLoopVolume * 100)}
            onChange={(v) => onMasterLoopVolumeChange(v / 100)}
          />
        </SideRailMeterPill>
      </div>

      <KiteTunerPanel
        isOpen={isTunerOpen}
        onClose={() => setIsTunerOpen(false)}
        audioContext={studioAudioContextRef.current}
        inputStream={primaryRawStream}
        instrumentId={tunerInstrumentId}
        onInstrumentChange={setTunerInstrumentId}
      />

      {looperHandlers.guidedRtlWizard.open && !settingsOpen ? (
        <SoloLatencyCalibrationPanel
          variant="wizard"
          latencyMs={looperConfig.latencyMs}
          stale={looperHandlers.latencyCalibrationStale}
          staleMessage={looperHandlers.latencyStaleMessage}
          disabled={looperConfig.isTimingLocked}
          wizard={looperHandlers.guidedRtlWizard}
          onBeginWizard={looperHandlers.onBeginGuidedRtlWizard}
          onStartCapture={looperHandlers.onStartGuidedRtlCapture}
          onPreviewLatencyMs={looperHandlers.onPreviewGuidedRtlLatencyMs}
          onConfirm={looperHandlers.onConfirmGuidedRtlWizard}
          onCancel={looperHandlers.onCancelGuidedRtlWizard}
          onRetryCapture={looperHandlers.onRetryGuidedRtlCapture}
        />
      ) : null}

      {showTutorialModal ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="kite-loop-tutorial-title"
        >
          <div
            className="w-full max-w-sm space-y-4 rounded-xl border border-white/[0.08] bg-[rgba(10,10,10,0.92)] px-5 py-5 shadow-[0_16px_48px_rgba(0,0,0,0.55)] backdrop-blur-[18px]"
          >
            <p
              id="kite-loop-tutorial-title"
              className="m-0 text-center text-sm font-medium leading-snug text-white/90"
            >
              First time? Watch this tutorial video if you need help!
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={openTutorialVideo}
                className="cursor-pointer rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2.5 text-xs font-semibold text-emerald-400 transition-colors hover:border-emerald-500/55 hover:bg-emerald-500/20"
              >
                Watch tutorial
              </button>
              <button
                type="button"
                onClick={dismissTutorialMaybeLater}
                className="cursor-pointer rounded-lg border border-white/[0.1] bg-transparent px-3 py-2.5 text-xs font-medium text-stone-400 transition-colors hover:border-white/[0.16] hover:text-stone-300"
              >
                Maybe later
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
            airSynth={airSynth}
            isAirSynthActive={isAirSynthActive}
            isCameraActive={isCameraActive}
            airSynthStatusLine={airSynthStatusLine}
            airSynthError={airSynthEngine.error}
            onAirSynthRetry={airSynthEngine.retry}
            airSynthVolume={airSynthEngine.volume}
            onAirSynthVolumeChange={airSynthEngine.setVolume}
            airSynthWaveform={airSynthEngine.waveform}
            onAirSynthWaveformChange={airSynthEngine.setWaveform}
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
        {settingsOpen || inputsOpen || isTunerOpen ? (
          <motion.div
            role="presentation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              setSettingsOpen(false);
              setInputsOpen(false);
              setIsTunerOpen(false);
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
        input[type=range].kite-master-loop-slider::-webkit-slider-thumb { -webkit-appearance:none; width:14px; height:14px; border-radius:50%; background:#22c55e; border:1px solid rgba(255,255,255,0.35); cursor:pointer; box-shadow:0 0 6px rgba(34,197,94,0.55); }
        input[type=range].kite-master-loop-slider::-moz-range-thumb { width:14px; height:14px; border-radius:50%; background:#22c55e; border:1px solid rgba(255,255,255,0.35); cursor:pointer; box-shadow:0 0 6px rgba(34,197,94,0.55); }
        input[type=range] { -webkit-appearance:none; appearance:none; }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
});
