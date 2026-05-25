"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import Peer, { type SignalData } from "simple-peer";
import { Check, ChevronLeft, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { useRouter } from "next/navigation";
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
import { KiteLoopV2Panel } from "@/components/kite-loop-v2/KiteLoopV2Panel";
import { KiteLoopV4Panel } from "@/components/kite-loop-v2/KiteLoopV4Panel";
import { FourBeatMetronome } from "@/components/kite-loop-v2/FourBeatMetronome";
import type { SoloTrackLaneView } from "@/components/kite-loop-v2/FourTrackLooperLanes";
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
import { createMetronomeScheduler, type MetronomeTick } from "@/lib/studio-metronome-schedule";
import {
  createMetronomePump,
  type MetronomePumpHandle,
} from "@/lib/studio-metronome-pump";
import {
  startLooperRunway,
  type RunwayDisplayLabel,
} from "@/lib/looper-runway-scheduler";
import { forceMusicModeOpus } from '@/lib/sdp-utils'

type BridgeStatus = "connecting" | "connected" | "failed";
type StudioUiPhase = "lobby" | "connecting" | "studio" | "kite-setup";
type Role = "host" | "peer";
type KiteSetupStep = 1 | 2 | 3 | 4 | 5;
type KiteMode = "live" | "solo" | "sync" | "broadcast";
type BroadcastStatus = "idle" | "connecting" | "syncing" | "live";
type SoloLooperState = "idle" | "recording" | "captured" | "playing";
type SoloSessionRecorderState = "idle" | "recording" | "paused" | "saving";
type JamSetupLock = { ownerId: string; ownerName: string; expiresAt: number } | null;
type JamSetupLockAction = "acquire" | "release";
type KiteSetupOrigin = "lobby" | "connected";
type DeviceFlagMap = Record<string, boolean>;
type KiteLoopChunkSendProgress = {
  status: "idle" | "sending" | "sent" | "error";
  sentChunks: number;
  totalChunks: number;
};
type RetainedKiteLoopBuffer = {
  intervalId: string;
  sequenceNumber: number;
  sampleRate: number;
  intervalFrames: number;
  channelCount: number;
  buffer: ArrayBuffer;
};
type JamSetupLockMessage = {
  type: "JAM_SETUP_LOCK";
  action: JamSetupLockAction;
  ownerId: string;
  ownerName: string;
  expiresAt?: number;
};
type SessionLeaveMessage = {
  type: "LEAVE";
  from: Role;
  room: string;
  at: string;
};
type KiteSyncMessage = {
  type: "KITE_SYNC";
  hostTime: number;
  bpm: number;
  bpi: number;
  enabled: boolean;
  serverTimestamp: number;
  sequenceNumber: number;
  initiatorId: string;
  studioRevision: number;
};
type StudioParamMessage = {
  type: "STUDIO_PARAM";
  originatorId: string;
  studioRevision: number;
  patch: {
    bpm?: number;
    bpi?: number;
    kiteSetupTempo?: number;
    kiteSetupTimeSignatureTop?: number;
    kiteSetupTimeSignatureBottom?: number;
    kiteSetupChordCount?: number;
  };
};
type SessionControlMessage = SessionLeaveMessage | KiteSyncMessage;

type IceCandidateRow = {
  id: string;
  from: Role;
  candidate: SignalData;
};

type StudioSessionRow = {
  session_id: string;
  offer: SignalData | null;
  answer: SignalData | null;
  ice_candidates: IceCandidateRow[] | null;
  host_user_id: string | null;
  guest_user_id: string | null;
};

type SessionHistoryInsert = {
  host_nickname: string;
  guest_nickname: string;
  duration_seconds: number;
};

const ORANGE = "#ff4500";
const EMERALD = "#22c55e";
const OBSIDIAN = "#0c0a09";

/** Shown when `init()` throws; cleared as soon as P2P is actually connected. */
const BRIDGE_INIT_FAIL_NOTE = "Could not initialize studio signaling bridge.";
const P2P_CONNECTED_NOTE = "P2P Connected.";

/** Data-channel ping interval is 2s; three highs ≈ sustained poor latency. */
const HIGH_PING_WARN_MS = 150;
const HIGH_PING_WARN_SAMPLES = 3;

/** Pause Kite metronome when inbound loss exceeds this; resume only after hysteresis (see below). */
const KITE_SYNC_LOSS_PAUSE_PCT = 5;
const KITE_SYNC_LOSS_RESUME_PCT = 3;
/** With 2s `getStats` cadence, 4s ≈ two consecutive samples below resume threshold. */
const KITE_SYNC_LOSS_STABLE_MS = 4000;

/** Remote listen path: Web Audio boost to `AudioContext.destination` (muted `<audio>` keep-alive + gain-based mute). */
const REMOTE_PLAYBACK_VOLUME_MIN = 0.5;
const REMOTE_PLAYBACK_VOLUME_MAX = 4;
const DEFAULT_REMOTE_PLAYBACK_VOLUME = 1;
const REMOTE_COMPRESSOR_THRESHOLD = -12;
const REMOTE_COMPRESSOR_KNEE      = 6;
const REMOTE_COMPRESSOR_RATIO     = 3;
const REMOTE_COMPRESSOR_ATTACK    = 0.003;
const REMOTE_COMPRESSOR_RELEASE   = 0.1;
const SOLO_LATENCY_STORAGE_KEY = "kite_solo_latency_ms";

function clampSoloLatencyMs(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(120, Math.round(value)));
}

const SESSION_VIDEO_MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
] as const;

function selectSessionVideoMediaRecorderOptions(): MediaRecorderOptions {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("MediaRecorder is not available in this environment.");
  }
  for (const mime of SESSION_VIDEO_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return {
        mimeType: mime,
        videoBitsPerSecond: 2_500_000,
        audioBitsPerSecond: 320_000,
      };
    }
  }
  return {
    videoBitsPerSecond: 2_500_000,
    audioBitsPerSecond: 320_000,
  };
}

function stopSoloSessionDisplayTracks(displayStreamRef: { current: MediaStream | null }): void {
  const stream = displayStreamRef.current;
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* ignore */
    }
  }
  displayStreamRef.current = null;
}

/** Linear fade for interface live-monitor duck / restore around Kite broadcast (avoid clicks). */
const BROADCAST_INTERFACE_MONITOR_RAMP_SEC = 0.05;

function rampLinearAudioGain(
  gainParam: AudioParam,
  ctx: AudioContext,
  targetValue: number,
  durationSec: number
): void {
  const t0 = ctx.currentTime;
  const end = t0 + Math.max(0, durationSec);
  gainParam.cancelScheduledValues(t0);
  gainParam.setValueAtTime(gainParam.value, t0);
  gainParam.linearRampToValueAtTime(targetValue, end);
}

/** Studio playback context: prefer 48 kHz + low latency; fall back if options unsupported. */
function createStudioAudioContext(): AudioContext {
  let ctx: AudioContext;
  try {
    ctx = new AudioContext({
      sampleRate: KITE_TARGET_SAMPLE_RATE,
      latencyHint: "interactive",
    });
  } catch {
    try {
      ctx = new AudioContext({ latencyHint: "interactive" });
    } catch {
      ctx = new AudioContext();
    }
  }
  if (Math.round(ctx.sampleRate) !== KITE_TARGET_SAMPLE_RATE) {
    console.warn(
      `[Studio] AudioContext.sampleRate is ${ctx.sampleRate} Hz (target ${KITE_TARGET_SAMPLE_RATE}). Kite paths require matching timing.sampleRate.`
    );
  }
  return ctx;
}

/** Single source of truth for session_id casing and shape (6-char A–Z / 0–9). */
function normalizeStudioSessionId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase();
}

function randomSessionId(): string {
  return normalizeStudioSessionId(Math.random().toString(36).slice(2, 8));
}

/** True for Safari/WebKit UAs, false for Chromium-based browsers that also advertise "Safari". */
function isStudioSafariWebKitEngine(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (!/Safari/i.test(ua)) return false;
  if (/Chrome|Chromium|Edg|OPR|Brave/i.test(ua)) return false;
  return true;
}

const MIC_ACCESS_DENIED_COPY =
  "Microphone access denied. Please allow microphone permissions to use the studio.";

function isMicPermissionDeniedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "NotAllowedError" || name === "PermissionDeniedError";
}

function isDeviceBusyError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "NotReadableError" || name === "TrackStartError" || name === "NotFoundError";
}

function addLog(msg: string) {
  console.log(msg);
}

function formatRecordingTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** ~1s clean sine tone for speaker check (Web Audio API). */
function playTestTone(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const ctx = new AudioContext();
      void ctx.resume().catch(() => {});
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 1);
      window.setTimeout(() => {
        void ctx.close().catch(() => {});
        resolve();
      }, 1050);
    } catch (e) {
      reject(e);
    }
  });
}

type CheckRowState = "pending" | "done" | "error";
type KiteSignalState = "checking" | "secure" | "offline" | "error";

const BASELINE_LEVEL_BAR_HEIGHTS = [0.12, 0.12, 0.12, 0.12, 0.12] as const;

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
        // Visualizer is best-effort; bars stay at baseline.
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
  /** When false, pending shows a static marker (e.g. manual action row). */
  pendingShowsSpinner?: boolean;
  /** Shown below the line while pending or error (e.g. Test Audio retry). */
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
        <div className="text-[11px] font-semibold uppercase tracking-widest text-stone-500">
          {label}
        </div>
        <AnimatePresence mode="wait">
          <motion.p
            key={state + pendingText + doneText}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className={`mt-1 text-sm font-medium ${
              state === "error" ? "text-red-300/95" : "text-stone-200"
            }`}
          >
            {state === "done"
              ? doneText
              : state === "error"
                ? (errorText ?? pendingText)
                : pendingText}
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
  const [status, setStatus] = useState<BridgeStatus>("connecting");
  const [statusNote, setStatusNote] = useState("Initializing session...");
  /** Initialization failure copy; cleared on successful P2P `connect` so it never competes with success UI. */
  const [bridgeInitError, setError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  /** Single UI/DB identifier: always the 6-char `session_id` in Supabase (uppercase). */
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [pingMs, setPingMs] = useState<number | null>(null);
  /** Inbound audio loss ratio as 0–100 for display (`getStats` while connected). */
  const [inboundPacketLossPercent, setInboundPacketLossPercent] = useState<number | null>(null);
  /** One-way network latency estimate from ICE RTT (`currentRoundTripTime / 2`). */
  const [calculatedDelayMs, setCalculatedDelayMs] = useState<number | null>(null);
  const [kiteSyncEnabled, setKiteSyncEnabled] = useState(false);
  const kiteSyncEnabledRef = useRef(kiteSyncEnabled);
  const [metronomeBpm, setMetronomeBpm] = useState(120);
  const [beatsPerInterval, setBeatsPerInterval] = useState(4);
  const [highPingTipOpen, setHighPingTipOpen] = useState(false);
  const [isVisualMetronomeOnly, setIsVisualMetronomeOnly] = useState(false);
  const isVisualMetronomeOnlyRef = useRef(false);
  const [visualActiveBeatInBar, setVisualActiveBeatInBar] = useState<0 | 1 | 2 | 3 | null>(null);
  const [localMicStream, setLocalMicStream] = useState<MediaStream | null>(null);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);
  const [micPermissionHint, setMicPermissionHint] = useState<string | null>(null);
  const [micSyncTimedOut, setMicSyncTimedOut] = useState(false);
  const [audioTestDone, setAudioTestDone] = useState(false);
  const [audioTestPlaying, setAudioTestPlaying] = useState(false);
  const [audioTestFailed, setAudioTestFailed] = useState(false);
  const [echoSafetyMode, setEchoSafetyMode] = useState(false);
  const [kiteSignal, setKiteSignal] = useState<KiteSignalState>("checking");
  const [studioUiPhase, setStudioUiPhase] = useState<StudioUiPhase>("lobby");
  const [isBufferingEnabled, setIsBufferingEnabled] = useState(false);
  const [isWorkletLoaded, setIsWorkletLoaded] = useState(false);
  const [bufferDepthFrames, setBufferDepthFrames] = useState(0);
  const [targetLeadFrames, setTargetLeadFrames] = useState(4800);
  const [isAutoBuffer, setIsAutoBuffer] = useState(true);
  const [isBufferPrimed, setIsBufferPrimed] = useState(false);
  const [lastCorrectionEvent, setLastCorrectionEvent] = useState<"drop" | "dupe" | "none">(
    "none"
  );
  const [roomCopyNote, setRoomCopyNote] = useState<string | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [remoteLevel, setRemoteLevel] = useState(0);
  /** Remote level bars driven by tap on studio playback graph (no third MediaStreamAudioSource). */
  const [remoteMeterHeights, setRemoteMeterHeights] = useState<number[]>(() => [
    ...BASELINE_LEVEL_BAR_HEIGHTS,
  ]);
  const [remoteMeterTapActive, setRemoteMeterTapActive] = useState(false);
  /** Bumps on graph teardown/build so the meter rAF effect restarts even if `remoteMeterTapActive` stays true. */
  const [remoteMeterRafKey, setRemoteMeterRafKey] = useState(0);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [remotePlaybackVolume, setRemotePlaybackVolume] = useState(
    DEFAULT_REMOTE_PLAYBACK_VOLUME
  );
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTimeMs, setRecordingTimeMs] = useState(0);
  const [recordedBlobUrl, setRecordedBlobUrl] = useState<string | null>(null);
  const [recordedDownloadExt, setRecordedDownloadExt] = useState<"webm" | "m4a" | "aac" | "bin">("webm");
  const [confirmExitOpen, setConfirmExitOpen] = useState(false);
  const [collaboratorLeft, setCollaboratorLeft] = useState(false);
  const [remoteParticipantName, setRemoteParticipantName] = useState<string | null>(null);
  const [lastDepartedParticipantName, setLastDepartedParticipantName] = useState<string | null>(null);
  const [connectionLostCountdown, setConnectionLostCountdown] = useState<number | null>(null);
  const [retryInitTick, setRetryInitTick] = useState(0);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [audioContextReady, setAudioContextReady] = useState(false);
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeDeviceIds, setActiveDeviceIds] = useState<string[]>([]);
  const [deviceVolumes, setDeviceVolumes] = useState<Record<string, number>>({});
  /** Per physical input: 1 = mono UI (`:ch0` only); 2 = dual lane faders. Populated from mixer probe in Phase 3. */
  const [deviceInputChannelCount, setDeviceInputChannelCount] = useState<Record<string, 1 | 2>>({});
  const [interfaceInputDeviceFlags, setInterfaceInputDeviceFlags] = useState<DeviceFlagMap>({});
  const [interfaceLiveMonitorEnabledFlags, setInterfaceLiveMonitorEnabledFlags] = useState<DeviceFlagMap>({});
  const [devicePanelOpen, setDevicePanelOpen] = useState(false);
  const [kiteSetupStep, setKiteSetupStep] = useState<KiteSetupStep>(1);
  const [kiteSetupTimeSignatureTop, setKiteSetupTimeSignatureTop] = useState(4);
  const [kiteSetupTimeSignatureBottom, setKiteSetupTimeSignatureBottom] = useState(4);
  const [kiteSetupIsSwing, setKiteSetupIsSwing] = useState(false);
  const [kiteSetupChordCount, setKiteSetupChordCount] = useState(4);
  const [kiteSetupUsesCustomChords, setKiteSetupUsesCustomChords] = useState(false);
  const [kiteSetupTempo, setKiteSetupTempo] = useState(120);
  const [kiteSetupOrigin, setKiteSetupOrigin] = useState<KiteSetupOrigin>("lobby");
  const [kiteSetupMode, setKiteSetupMode] = useState<KiteMode>("solo");
  const [kiteSetupError, setKiteSetupError] = useState<string | null>(null);
  const [kiteMode, setKiteMode] = useState<KiteMode>("live");
  const [broadcastStatus, setBroadcastStatus] = useState<BroadcastStatus>("idle");
  const [jamSetupLock, setJamSetupLock] = useState<JamSetupLock>(null);
  const [soloLooperState, setSoloLooperState] = useState<SoloLooperState>("idle");
  const [loopProgress, setLoopProgress] = useState(0);
  const [isRecordingArmed, setIsRecordingArmed] = useState(false);
  const [recordingArmedCountdown, setRecordingArmedCountdown] = useState<number | null>(null);
  /** Solo 4-beat runway: 3 → 2 → 1 → GO, driven by `startLooperRunway`. */
  const [soloRunwayDisplay, setSoloRunwayDisplay] = useState<RunwayDisplayLabel | null>(null);
  /** Latest per-slot snapshot from solo worklet (playback/recording cursors). */
  const [soloTrackSlotUi, setSoloTrackSlotUi] = useState<SoloLooperPlaybackUiStateEvent["slots"] | null>(
    null
  );
  /** Linear 0–1 fader values per track (UI + engine). */
  const [soloTrackVolumes, setSoloTrackVolumes] = useState<[number, number, number, number]>([
    1, 1, 1, 1,
  ]);
  /** Track 1 closed loop length in frames (drives overdub arm + snapping UI). */
  const [soloMasterLoopFrames, setSoloMasterLoopFrames] = useState<number | null>(null);
  /** Temporary RTL calibration control for hardware Clap Test. */
  const [soloLooperLatencyMs, setSoloLooperLatencyMs] = useState(0);
  const soloLooperLatencyMsRef = useRef(soloLooperLatencyMs);
  const soloLatencyPersistenceReadyRef = useRef(false);
  const [soloLatencyCalibrationStatus, setSoloLatencyCalibrationStatus] = useState<
    "idle" | "warning" | "listening" | "success" | "error"
  >("idle");
  const [soloLatencyCalibrationMessage, setSoloLatencyCalibrationMessage] = useState<string | null>(
    null
  );
  const [soloLooperMode, setSoloLooperMode] = useState<"free" | "grid">("free");
  const soloLooperModeRef = useRef(soloLooperMode);
  const [soloLooperBarCount, setSoloLooperBarCount] = useState<number>(1);
  const soloLooperBarCountRef = useRef(soloLooperBarCount);
  const kiteSetupTempoRef = useRef(kiteSetupTempo);
  const kiteSetupTimeSignatureTopRef = useRef(kiteSetupTimeSignatureTop);
  /** Lane the spacebar / foot pedal arms (1–4); kept in sync with `soloPedalTargetTrackIndexRef`. */
  const [focusedTrackIndex, setFocusedTrackIndex] = useState<1 | 2 | 3 | 4>(1);
  /** Secondary track index (2–4) armed for quantized overdub; recording starts on Track 1 loop wrap. */
  const [soloOverdubArmedTrackIndex, setSoloOverdubArmedTrackIndex] = useState<number | null>(null);
  const [isMasterPaused, setIsMasterPaused] = useState(false);
  const [soloSessionRecorderState, setSoloSessionRecorderState] =
    useState<SoloSessionRecorderState>("idle");
  /** V4 looper HUD is now the default studio solo UI. */
  const [useV4LooperUi] = useState(true);
  const [loopChunkSendError, setLoopChunkSendError] = useState<string | null>(null);
  const [loopChunkSendProgress, setLoopChunkSendProgress] = useState<KiteLoopChunkSendProgress>({
    status: "idle",
    sentChunks: 0,
    totalChunks: 0,
  });
  /** One-bar count-in after Kite Sync enables; blocks unmute and playback level changes until the grid stabilizes. */
  const [kiteSyncCountInActive, setKiteSyncCountInActive] = useState(false);
  /** User id (or stable fallback) of the peer that started the current Kite Sync session. */
  const [syncInitiatorId, setSyncInitiatorId] = useState<string | null>(null);
  /** Bumps when resuming metronome after network-loss pause (forces scheduler re-init). */
  const [kiteSyncMetronomeResumeNonce, setKiteSyncMetronomeResumeNonce] = useState(0);
  /** True while metronome is stopped due to inbound loss hysteresis (UX hint). */
  const [kiteSyncNetworkMetronomePaused, setKiteSyncNetworkMetronomePaused] = useState(false);
  const [metronomeVolume, setMetronomeVolume] = useState(0.85);
  const isInStudioPhase = studioUiPhase === "studio";

  const micDeniedThisInitRef = useRef(false);

  const peerRef = useRef<Peer.Instance | null>(null);
  /** Underlying PC for `getStats` polling; cleared with peer teardown. */
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  /** Wall-clock expiry (ms) for current TURN bundle when `/api/turn-credentials` provides it. */
  const turnCredentialExpiresAtMsRef = useRef<number | null>(null);
  /** When the active TURN bundle was fetched (ms since epoch). */
  const turnCredentialFetchedAtMsRef = useRef<number | null>(null);
  const turnCredentialRefreshTimerRef = useRef<number | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const speakerMutedRef = useRef(false);
  const remotePlaybackVolumeRef = useRef(DEFAULT_REMOTE_PLAYBACK_VOLUME);
  const localMonitorAudioRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const activeStreamsMapRef = useRef<Map<string, MediaStream>>(new Map());
  const mixerGainNodesRef = useRef<Map<string, GainNode>>(new Map());
  const mixerAnalyserNodesRef = useRef<Map<string, AnalyserNode>>(new Map());
  const mixerSourceNodesRef = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());
  const mixerSplitterNodesRef = useRef<Map<string, ChannelSplitterNode>>(new Map());
  const mixerMergerNodesRef = useRef<Map<string, ChannelMergerNode>>(new Map());
  const mixerLaneProbeRef = useRef<Map<string, StereoProbeResult>>(new Map());
  const mixerTeardownOriginRef = useRef<"none" | "performTeardown">("none");
  const mixerMasterStreamRef = useRef<MediaStream | null>(null);
  const mixerMasterDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  /** Parallel bus to the master VoIP mix; P2P / Kite capture reads this stream, not `mixerMasterDestinationRef`. */
  const mixerKiteTapDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mixerKiteTapStreamRef = useRef<MediaStream | null>(null);
  /** Raw primary mic → gain → destination; WebRTC sender uses this stream only (never the multi-input master mix). */
  const voipOutgoingDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const voipOutgoingGainRef = useRef<GainNode | null>(null);
  const voipOutgoingSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const activeDeviceIdsRef = useRef<string[]>([]);
  const interfaceInputDeviceFlagsRef = useRef<DeviceFlagMap>({});
  const interfaceLiveMonitorEnabledFlagsRef = useRef<DeviceFlagMap>({});
  const interfaceLiveMonitorSourceNodesRef = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());
  const interfaceLiveMonitorGainNodesRef = useRef<Map<string, GainNode>>(new Map());
  const perChannelMeterRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const masterLiveMeterElementRef = useRef<HTMLDivElement | null>(null);
  const localRecorderRef = useRef<TrackRecorder | null>(null);
  const recordingIntervalRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<number | null>(null);
  const handshakeFallbackIntervalRef = useRef<number | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const mountedRef = useRef(true);
  const statusRef = useRef<BridgeStatus>("connecting");
  /** Set synchronously in `peer.on('connect')` so init's `catch` cannot run after P2P success but before `statusRef` updates. */
  const p2pConnectSucceededRef = useRef(false);
  const appliedRemoteSignalRef = useRef(false);
  const seenIceRef = useRef<Set<string>>(new Set());
  const cleanupSessionRef = useRef<(() => Promise<void>) | null>(null);
  const iceAppendQueueRef = useRef<Promise<void>>(Promise.resolve());
  const existingRowRef = useRef<StudioSessionRow | null>(null);
  /** Idempotent mic / peer / Realtime teardown (explicit leave + unmount). */
  const bridgeTeardownRef = useRef<(() => void) | null>(null);
  const leaveSignalSentRef = useRef(false);
  const leaveSignalReceivedRef = useRef(false);
  /** Mirrors `activeRole` from bridge init so `performTeardown` can send `{ type, from }` over the data channel. */
  const bridgeActiveRoleRef = useRef<Role | null>(null);
  /** Host: latest teardown when the P2P peer drops during Kite (avoids stale `buildTransport` closures). */
  const hostExitKiteBroadcastOnPeerDisconnectRef = useRef<() => void>(() => {});
  const lostCountdownIntervalRef = useRef<number | null>(null);
  const sessionStartedAtRef = useRef<number | null>(null);
  const historySavedRef = useRef(false);
  /** Prevents overlapping inits; cleared on effect cleanup so remount can proceed. */
  const bridgeInitInFlightRef = useRef(false);
  const mixerRebuildInFlightRef = useRef(false);
  const buildTransportRef = useRef<((localStream: MediaStream, ctx: AudioContext) => Promise<void>) | null>(
    null
  );
  const initNetworkSessionRef = useRef<(() => Promise<void>) | null>(null);
  /** Set after `initNetworkSession` completes Phase 2+3 reservation (transportSessionId + row). */
  const studioSessionReservedRef = useRef(false);
  /** Mic-init early bootstrap; Enter Studio awaits this before calling `initNetworkSession` again. */
  const sessionBootstrapPromiseRef = useRef<Promise<void> | null>(null);
  const startP2PEngineRef = useRef<((timing: KiteIntervalTiming) => Promise<void>) | null>(null);
  const kiteIntervalTimingRef = useRef<KiteIntervalTiming | null>(null);
  /** Timing last used to build the P2P interval graph; consumed when igniting the scheduler after count-in. */
  const latestKiteIntervalTimingRef = useRef<KiteIntervalTiming | null>(null);
  const startP2PIntervalSchedulerRef = useRef<((timing: KiteIntervalTiming) => void) | null>(null);
  const soloLooperEngineRef = useRef<SoloLooperEngine | null>(null);
  const kiteP2PEngineRef = useRef<KiteIntervalGraph | null>(null);
  const kiteP2PGridPumpRef = useRef<MetronomePumpHandle | null>(null);
  /** Bumps when P2P grid pump is superseded or torn down so stale async loads cannot attach. */
  const p2pGridPumpGenerationRef = useRef(0);
  const kiteP2PSequenceRef = useRef(0);
  /** Next P2P grid boundary in `AudioContext` seconds; advanced from the grid AudioWorklet pump using audio clock. */
  const p2pGridNextBoundaryContextSecRef = useRef<number | null>(null);
  /** Monotonic count of audio-grid boundaries processed for this scheduler run (logging / warnings). */
  const p2pGridIntervalIndexRef = useRef(0);
  const queuedRemoteKiteIntervalRef = useRef<ReassembledLoadInterval[]>([]);
  const queuedRemoteKiteIntervalTimeoutRef = useRef<number | null>(null);
  const retryRetainedLoopSyncRef = useRef<(() => void) | null>(null);
  const kiteModeRef = useRef<KiteMode>("live");
  /** Tracks prior `kiteMode` so we can ramp interface live monitors back after leaving broadcast. */
  const prevKiteModeForBroadcastMonitorRef = useRef<KiteMode | null>(null);
  const broadcastStatusRef = useRef<BroadcastStatus>("idle");
  const isBroadcastConnectPendingRef = useRef(false);
  const retainedKiteLoopBufferRef = useRef<RetainedKiteLoopBuffer | null>(null);
  const retainedRemoteKiteLoopRef = useRef<ReassembledLoadInterval | null>(null);
  const lastRetainedKiteIntervalIdRef = useRef<string | null>(null);
  const lastRetainedKiteSequenceRef = useRef<number | null>(null);
  const hasCapturedFirstKiteLoopRef = useRef(false);
  const soloLooperStateRef = useRef<SoloLooperState>("idle");
  /** Snapshot of BPM at recording start; used by commitActiveRecording to avoid desync in grid mode. */
  const recordingStartBpmRef = useRef<number>(120);
  /** Frame length of Track 1 after first close; Tracks 2–4 sync to this (P5-05+). */
  const masterLoopIntervalFramesRef = useRef<number | null>(null);
  /** Solo worklet track index (1–4) while `startRecording` is active; null when idle (spacebar tap-to-toggle). */
  const soloLooperActiveRecordTrackIndexRef = useRef<number | null>(null);
  /** True between tap-stop `stopRecording` and worklet `LOOP_READY` (blocks double-finalize). */
  const soloLooperLoopFinalizePendingRef = useRef(false);
  const soloLooperLiveLoopIdRef = useRef<string | null>(null);
  const soloLooperEventIntervalIdRef = useRef<string | null>(null);
  const soloLooperEventSequenceNumberRef = useRef<number>(0);
  const isMasterPausedRef = useRef(false);
  const soloSessionMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const soloSessionChunksRef = useRef<BlobPart[]>([]);
  const soloSessionDisplayStreamRef = useRef<MediaStream | null>(null);
  const soloMetronomeLastBeatRef = useRef<number | null>(null);
  const soloMetronomeAnchorContextSecRef = useRef<number | null>(null);
  /** Spacebar routes to this track (1–4) on pedal down; lane arms sync this ref. */
  const soloPedalTargetTrackIndexRef = useRef(1);
  /** Overdub track (2–4) armed in worklet, waiting for Track 1 downbeat. */
  const soloOverdubArmedTrackIndexRef = useRef<number | null>(null);
  /** Latest worklet slot snapshot (mirrors `PLAYBACK_UI_STATE`). */
  const soloTrackSlotUiLatestRef = useRef<SoloLooperPlaybackUiStateEvent["slots"] | null>(null);

  const applyPedalFocus = useCallback((trackIndex: 1 | 2 | 3 | 4) => {
    soloPedalTargetTrackIndexRef.current = trackIndex;
    setFocusedTrackIndex(trackIndex);
  }, []);

  const loopProgressRafRef = useRef<number | null>(null);
  const soloTrackVolumesRef = useRef<[number, number, number, number]>([1, 1, 1, 1]);
  const isRecordingArmedRef = useRef(false);
  /** Solo looper 4-beat runway: metronome pump tick; transport arms after beat 4 via `startLooperRunway`. */
  const soloCountInPumpRef = useRef<MetronomePumpHandle | null>(null);
  const soloCountInPumpGenerationRef = useRef(0);
  const soloCountInEndAtContextSecRef = useRef(0);
  const soloCountInBeatSecRef = useRef(0);
  const soloRunwayGoClearTimerRef = useRef<number | null>(null);
  const scheduledMetronomeOscillatorsRef = useRef<Set<OscillatorNode>>(new Set());
  const kiteLoopChunksRef = useRef<ReturnType<typeof createLoadIntervalChunks> | null>(null);
  const kiteLoopChunkSenderRef = useRef<KiteDataChannelChunkSender | null>(null);
  const kiteLoopReassemblerRef = useRef<KiteIntervalReassembler | null>(null);
  const kiteLoopSendAbortControllerRef = useRef<AbortController | null>(null);
  const originalVoipSenderTrackRef = useRef<MediaStreamTrack | null>(null);
  const mutedVoipCloneTrackRef = useRef<MediaStreamTrack | null>(null);
  const voipSenderMutedForKiteRef = useRef(false);
  const jamSetupLockTokenRef = useRef<string | null>(null);
  const jamSetupLockExpiresAtRef = useRef<number | null>(null);
  const jamSetupLockTimerRef = useRef<number | null>(null);
  /** Lazily created; resumed on "Enter Studio" so Safari unlocks audio on a user gesture. */
  const studioAudioContextRef = useRef<AudioContext | null>(null);
  const getStudioKiteSampleRate = useCallback((): number => {
    const ctx = studioAudioContextRef.current;
    if (ctx && ctx.state !== "closed") {
      return Math.round(ctx.sampleRate);
    }
    return KITE_TARGET_SAMPLE_RATE;
  }, []);
  const workletLoadPromiseRef = useRef<Promise<boolean> | null>(null);
  const workletLoadedContextRef = useRef<AudioContext | null>(null);
  const lastWorkletTelemetryAtMsRef = useRef(0);
  const targetLeadFramesDebounceRef = useRef<number | null>(null);
  const remotePlaybackSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const remoteBufferNodeRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null);
  const remotePlaybackDelayRef = useRef<DelayNode | null>(null);
  const remotePlaybackGainRef = useRef<GainNode | null>(null);
  const remotePlaybackAnalyserRef = useRef<AnalyserNode | null>(null);
  /** Zero-gain sink so the analyser branch is pulled by the audio engine without audible bleed. */
  const remotePlaybackMeterSinkRef = useRef<GainNode | null>(null);
  const remotePlaybackCompressorRef = useRef<DynamicsCompressorNode | null>(null);
  const metronomeGainRef = useRef<GainNode | null>(null);
  const metronomeVolumeRef = useRef(0.85);
  const metronomeSchedulerRef = useRef<ReturnType<typeof createMetronomeScheduler> | null>(null);
  const metronomePumpRef = useRef<MetronomePumpHandle | null>(null);
  const metronomeBlinkQueueRef = useRef<{ startAt: number; isAccent: boolean }[]>([]);
  const metronomeBlinkRafIdRef = useRef<number | null>(null);
  const metronomeBlinkElementRef = useRef<HTMLDivElement | null>(null);
  const highPingStreakRef = useRef(0);
  const highPingTipDismissedRef = useRef(false);
  const calculatedDelayMsRef = useRef<number | null>(null);
  const kiteSyncSequenceRef = useRef(0);
  const pendingKiteSyncRef = useRef<KiteSyncMessage | null>(null);
  const lastAcceptedKiteSyncSeqRef = useRef(0);
  const syncInitiatorIdRef = useRef<string | null>(null);
  const studioRevisionRef = useRef(0);
  const lastAcceptedStudioRevisionRef = useRef(0);
  const studioParamPendingPatchRef = useRef<StudioParamMessage["patch"]>({});
  const studioParamDebounceTimerRef = useRef<number | null>(null);
  const lastAppliedGuestStartSecRef = useRef<number | null>(null);
  const lastSyncApplyAtMsRef = useRef<number | null>(null);
  const kiteSyncCountInEndAtContextSecRef = useRef(0);
  /** Permanent downbeat anchor in `AudioContext` seconds; set once at count-in → live. */
  const kiteGridAnchorContextSecRef = useRef<number | null>(null);
  /** Mirrors `kiteSyncCountInActive` for metronome pump callbacks (avoids stale closures). */
  const kiteSyncCountInActiveRef = useRef(false);
  /** Prevents duplicate count-in completion when `pumpScheduler` runs multiple times past `endAt`. */
  const kiteSyncCountInCompletionHandledRef = useRef(false);
  /** `AudioContext.baseLatency` captured at studio context creation (seconds). */
  const audioBaseLatencySecRef = useRef(0);
  /** `AudioContext.outputLatency` captured at studio context creation (seconds). */
  const audioOutputLatencySecRef = useRef(0);
  const kiteSyncLossPauseActiveRef = useRef(false);
  const kiteSyncLossRecoverySinceMsRef = useRef<number | null>(null);
  const applyKiteSyncLossGuardRef = useRef<(packetLossPercent: number | null) => void>(
    () => {}
  );
  const tapBeatTimestampsRef = useRef<number[]>([]);
  const echoModeApplyingRef = useRef(false);
  const previousEchoSafetyModeRef = useRef(echoSafetyMode);
  const isMicMutedRef = useRef(isMicMuted);
  const isBufferingEnabledRef = useRef(isBufferingEnabled);
  const isWorkletLoadedRef = useRef(isWorkletLoaded);
  const targetLeadFramesRef = useRef(targetLeadFrames);
  const isAutoBufferRef = useRef(true);
  const deviceVolumesRef = useRef(deviceVolumes);
  const deviceInputChannelCountRef = useRef(deviceInputChannelCount);
  const localMicStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    isMicMutedRef.current = isMicMuted;
  }, [isMicMuted]);

  useEffect(() => {
    soloLooperStateRef.current = soloLooperState;
  }, [soloLooperState]);

  useEffect(() => {
    isMasterPausedRef.current = isMasterPaused;
  }, [isMasterPaused]);

  useEffect(() => {
    soloTrackVolumesRef.current = soloTrackVolumes;
  }, [soloTrackVolumes]);

  useEffect(() => {
    soloLooperLatencyMsRef.current = soloLooperLatencyMs;
  }, [soloLooperLatencyMs]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(SOLO_LATENCY_STORAGE_KEY);
      if (raw !== null) {
        const parsed = Number(raw);
        const clamped = clampSoloLatencyMs(parsed);
        setSoloLooperLatencyMs(clamped);
      }
    } catch {
      /* ignore storage read errors */
    } finally {
      soloLatencyPersistenceReadyRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!soloLatencyPersistenceReadyRef.current || typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(SOLO_LATENCY_STORAGE_KEY, String(clampSoloLatencyMs(soloLooperLatencyMs)));
    } catch {
      /* ignore storage write errors */
    }
  }, [soloLooperLatencyMs]);

  useEffect(() => {
    soloLooperModeRef.current = soloLooperMode;
  }, [soloLooperMode]);

  useEffect(() => {
    soloLooperBarCountRef.current = soloLooperBarCount;
  }, [soloLooperBarCount]);

  useEffect(() => {
    kiteSetupTempoRef.current = kiteSetupTempo;
  }, [kiteSetupTempo]);

  useEffect(() => {
    kiteSetupTimeSignatureTopRef.current = kiteSetupTimeSignatureTop;
  }, [kiteSetupTimeSignatureTop]);

  useEffect(() => {
    kiteModeRef.current = kiteMode;
  }, [kiteMode]);

  useEffect(() => {
    broadcastStatusRef.current = broadcastStatus;
  }, [broadcastStatus]);

  useEffect(() => {
    kiteSyncEnabledRef.current = kiteSyncEnabled;
  }, [kiteSyncEnabled]);

  useEffect(() => {
    kiteSyncCountInActiveRef.current = kiteSyncCountInActive;
  }, [kiteSyncCountInActive]);

  useEffect(() => {
    if (kiteSyncCountInActive) {
      kiteSyncCountInCompletionHandledRef.current = false;
    }
  }, [kiteSyncCountInActive]);

  useEffect(() => {
    isRecordingArmedRef.current = isRecordingArmed;
  }, [isRecordingArmed]);

  useEffect(() => {
    isBufferingEnabledRef.current = isBufferingEnabled;
  }, [isBufferingEnabled]);

  useEffect(() => {
    isWorkletLoadedRef.current = isWorkletLoaded;
  }, [isWorkletLoaded]);

  useEffect(() => {
    isVisualMetronomeOnlyRef.current = isVisualMetronomeOnly;
    const engine = soloLooperEngineRef.current;
    const bpm = kiteIntervalTimingRef.current?.bpm || 120;

    // Check if Track 1 is the track currently being recorded
    const isTrack1Recording =
      soloLooperState === "recording" && soloLooperActiveRecordTrackIndexRef.current === 1;

    if (engine && !isMasterPaused) {
      if (isTrack1Recording && !isVisualMetronomeOnly) {
        engine.startAudibleMetronome(bpm);
      } else {
        // Explicitly stop the metronome for overdubs, visual-only mode, or idle state
        engine.stopAudibleMetronome();
      }
    }
  }, [isVisualMetronomeOnly, soloLooperState, isMasterPaused]);

  useEffect(() => {
    targetLeadFramesRef.current = targetLeadFrames;
  }, [targetLeadFrames]);

  useEffect(() => {
    isAutoBufferRef.current = isAutoBuffer;
  }, [isAutoBuffer]);

  useEffect(() => {
    deviceVolumesRef.current = deviceVolumes;
  }, [deviceVolumes]);

  useEffect(() => {
    deviceInputChannelCountRef.current = deviceInputChannelCount;
  }, [deviceInputChannelCount]);

  useEffect(() => {
    interfaceInputDeviceFlagsRef.current = interfaceInputDeviceFlags;
  }, [interfaceInputDeviceFlags]);

  useEffect(() => {
    interfaceLiveMonitorEnabledFlagsRef.current = interfaceLiveMonitorEnabledFlags;
  }, [interfaceLiveMonitorEnabledFlags]);

  useEffect(() => {
    localMicStreamRef.current = localMicStream;
  }, [localMicStream]);

  const stopMediaStreamTracks = useCallback(
    (stream: MediaStream | null | undefined, seenTrackIds: Set<string>) => {
      if (!stream) return;
      for (const track of stream.getTracks()) {
        if (seenTrackIds.has(track.id)) continue;
        seenTrackIds.add(track.id);
        track.onended = null;
        track.stop();
      }
    },
    []
  );

  useEffect(() => {
    activeDeviceIdsRef.current = activeDeviceIds;
  }, [activeDeviceIds]);

  useEffect(() => {
    let rafId = 0;

    const tick = () => {
      const activeLaneKeys = new Set(mixerAnalyserNodesRef.current.keys());
      let maxPeakPct = 0;

      for (const [laneKey, el] of Array.from(perChannelMeterRefs.current.entries())) {
        if (!activeLaneKeys.has(laneKey)) {
          el.style.width = "0%";
        }
      }

      for (const laneKey of Array.from(activeLaneKeys)) {
        const analyser = mixerAnalyserNodesRef.current.get(laneKey);
        const meterEl = perChannelMeterRefs.current.get(laneKey);
        if (!analyser) continue;

        const buf = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i += 1) {
          const sample = buf[i] ?? 0;
          if (sample > peak) peak = sample;
        }

        const levelPct = Math.min(100, Math.max(0, (peak / 255) * 100));
        if (levelPct > maxPeakPct) maxPeakPct = levelPct;
        if (meterEl) {
          meterEl.style.width = `${levelPct}%`;
        }
      }
      const masterMeterEl = masterLiveMeterElementRef.current;
      if (masterMeterEl) {
        masterMeterEl.style.width = `${maxPeakPct}%`;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, []);

  const refreshAudioInputDevices = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!mountedRef.current) return;
      const inputs = devices.filter((device) => device.kind === "audioinput");
      setAudioInputDevices(inputs);
    } catch {
      if (!mountedRef.current) return;
      setAudioInputDevices([]);
    }
  }, []);

  const teardownRemotePlaybackGraph = useCallback(() => {
    setRemoteMeterTapActive(false);
    try {
      remotePlaybackMeterSinkRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      remotePlaybackAnalyserRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      remotePlaybackDelayRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      remotePlaybackCompressorRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      remotePlaybackSourceRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      remoteBufferNodeRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      remotePlaybackGainRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    remotePlaybackMeterSinkRef.current = null;
    remotePlaybackAnalyserRef.current = null;
    remotePlaybackCompressorRef.current = null;
    remotePlaybackSourceRef.current = null;
    remoteBufferNodeRef.current = null;
    remotePlaybackDelayRef.current = null;
    remotePlaybackGainRef.current = null;
    setBufferDepthFrames(0);
    setIsBufferPrimed(false);
    setLastCorrectionEvent("none");
    setRemoteMeterRafKey((k) => k + 1);
  }, []);

  const applyRemotePlaybackSpeakerGain = useCallback((muted: boolean) => {
    const ctx = studioAudioContextRef.current;
    const gainNode = remotePlaybackGainRef.current;
    if (!ctx || !gainNode || ctx.state === "closed") return;
    const target = muted
      ? 0
      : Math.min(
          Math.max(remotePlaybackVolumeRef.current, REMOTE_PLAYBACK_VOLUME_MIN),
          REMOTE_PLAYBACK_VOLUME_MAX
        );
    try {
      gainNode.gain.cancelScheduledValues(ctx.currentTime);
      gainNode.gain.setTargetAtTime(target, ctx.currentTime, 0.01);
    } catch {
      /* ignore */
    }
  }, []);

  const replacePeerAudioTrack = useCallback(
    (
      oldTrack: MediaStreamTrack | null,
      newTrack: MediaStreamTrack,
      oldStream: MediaStream | null,
      newStream: MediaStream
    ) => {
      const peer = peerRef.current as (Peer.Instance & {
        replaceTrack?: (
          oldTrack: MediaStreamTrack,
          newTrack: MediaStreamTrack,
          stream: MediaStream
        ) => void;
      }) | null;
      if (!peer || typeof peer.replaceTrack !== "function") return;
      if (!oldTrack) return;
      try {
        peer.replaceTrack(oldTrack, newTrack, oldStream ?? newStream);
      } catch (err) {
        console.error("Failed to replace local audio track:", err);
      }
    },
    []
  );

  const teardownInterfaceLiveMonitorGraph = useCallback((deviceId: string) => {
    const sourceNode = interfaceLiveMonitorSourceNodesRef.current.get(deviceId);
    const gainNode = interfaceLiveMonitorGainNodesRef.current.get(deviceId);
    try {
      sourceNode?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      gainNode?.disconnect();
    } catch {
      /* ignore */
    }
    interfaceLiveMonitorSourceNodesRef.current.delete(deviceId);
    interfaceLiveMonitorGainNodesRef.current.delete(deviceId);
  }, []);

  const teardownAllInterfaceLiveMonitorGraphs = useCallback(() => {
    for (const deviceId of Array.from(interfaceLiveMonitorSourceNodesRef.current.keys())) {
      teardownInterfaceLiveMonitorGraph(deviceId);
    }
    for (const deviceId of Array.from(interfaceLiveMonitorGainNodesRef.current.keys())) {
      teardownInterfaceLiveMonitorGraph(deviceId);
    }
  }, [teardownInterfaceLiveMonitorGraph]);

  const duckInterfaceLiveMonitorNodesForBroadcast = useCallback(() => {
    const ctx = studioAudioContextRef.current;
    if (!ctx || ctx.state === "closed") return;
    for (const gainNode of Array.from(interfaceLiveMonitorGainNodesRef.current.values())) {
      try {
        gainNode.gain.cancelScheduledValues(ctx.currentTime);
        gainNode.gain.setValueAtTime(0, ctx.currentTime);
        gainNode.disconnect();
      } catch {
        /* ignore — node may already be disconnected */
      }
    }
  }, []);

  const restoreInterfaceLiveMonitorNodesFromSliders = useCallback(() => {
    const ctx = studioAudioContextRef.current;
    if (!ctx || ctx.state === "closed") return;
    for (const deviceId of Array.from(interfaceLiveMonitorGainNodesRef.current.keys())) {
      const gainNode = interfaceLiveMonitorGainNodesRef.current.get(deviceId);
      const sourceNode = interfaceLiveMonitorSourceNodesRef.current.get(deviceId);
      if (!gainNode) continue;
      const vols = deviceVolumesRef.current;
      const chCount = deviceInputChannelCountRef.current[deviceId] ?? 1;
      const v0 = vols[`${deviceId}:ch0`] ?? 100;
      const v1 = vols[`${deviceId}:ch1`] ?? 100;
      const blended = chCount >= 2 ? (v0 + v1) / 2 : v0;
      const targetLinear = Math.pow(Math.min(100, Math.max(0, blended)) / 100, 2);
      try {
        if (sourceNode) {
          try {
            sourceNode.connect(gainNode);
          } catch {
            /* already connected */
          }
        }
        try {
          gainNode.connect(ctx.destination);
        } catch {
          /* ignore */
        }
        rampLinearAudioGain(gainNode.gain, ctx, targetLinear, BROADCAST_INTERFACE_MONITOR_RAMP_SEC);
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    const prev = prevKiteModeForBroadcastMonitorRef.current;
    prevKiteModeForBroadcastMonitorRef.current = kiteMode;
    if (prev === "broadcast" && kiteMode !== "broadcast") {
      restoreInterfaceLiveMonitorNodesFromSliders();
    } else if (prev !== "broadcast" && kiteMode === "broadcast") {
      duckInterfaceLiveMonitorNodesForBroadcast();
    }
  }, [duckInterfaceLiveMonitorNodesForBroadcast, kiteMode, restoreInterfaceLiveMonitorNodesFromSliders]);

  useEffect(() => {
    if (kiteMode === "broadcast") {
      setDevicePanelOpen(false);
    }
  }, [kiteMode]);

  const clearInterfaceMonitorStateForDevice = useCallback((deviceId: string) => {
    interfaceInputDeviceFlagsRef.current = {
      ...interfaceInputDeviceFlagsRef.current,
      [deviceId]: false,
    };
    interfaceLiveMonitorEnabledFlagsRef.current = {
      ...interfaceLiveMonitorEnabledFlagsRef.current,
      [deviceId]: false,
    };
    setInterfaceInputDeviceFlags((prev) => {
      if (prev[deviceId] === undefined) return prev;
      const next = { ...prev };
      delete next[deviceId];
      return next;
    });
    setInterfaceLiveMonitorEnabledFlags((prev) => {
      if (prev[deviceId] === undefined) return prev;
      const next = { ...prev };
      delete next[deviceId];
      return next;
    });
  }, []);

  const clearMixerDeviceVolumeState = useCallback((deviceId: string) => {
    const lane0 = `${deviceId}:ch0`;
    const lane1 = `${deviceId}:ch1`;
    setDeviceVolumes((prev) => {
      if (
        prev[lane0] === undefined &&
        prev[lane1] === undefined &&
        prev[deviceId] === undefined
      ) {
        return prev;
      }
      const next = { ...prev };
      delete next[lane0];
      delete next[lane1];
      delete next[deviceId];
      return next;
    });
    setDeviceInputChannelCount((prev) => {
      if (prev[deviceId] === undefined) return prev;
      const next = { ...prev };
      delete next[deviceId];
      return next;
    });
  }, []);

  const removeAndCleanupDevice = useCallback((deviceId: string) => {
    const stream = activeStreamsMapRef.current.get(deviceId);
    const mergerNode = mixerMergerNodesRef.current.get(deviceId);
    const splitterNode = mixerSplitterNodesRef.current.get(deviceId);
    const sourceNode = mixerSourceNodesRef.current.get(deviceId);
    const laneKeys = [`${deviceId}:ch0`, `${deviceId}:ch1`] as const;

    for (const laneKey of laneKeys) {
      const gainNode = mixerGainNodesRef.current.get(laneKey);
      const analyserNode = mixerAnalyserNodesRef.current.get(laneKey);
      try {
        gainNode?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        analyserNode?.disconnect();
      } catch {
        /* ignore */
      }
      mixerGainNodesRef.current.delete(laneKey);
      mixerAnalyserNodesRef.current.delete(laneKey);
      mixerLaneProbeRef.current.delete(laneKey);
      const meterEl = perChannelMeterRefs.current.get(laneKey);
      if (meterEl) meterEl.style.width = "0%";
      perChannelMeterRefs.current.delete(laneKey);
    }
    if (masterLiveMeterElementRef.current) {
      masterLiveMeterElementRef.current.style.width = "0%";
    }

    try {
      mergerNode?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      splitterNode?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      sourceNode?.disconnect();
    } catch {
      /* ignore */
    }

    teardownInterfaceLiveMonitorGraph(deviceId);
    clearInterfaceMonitorStateForDevice(deviceId);
    stream?.getTracks().forEach((track) => track.stop());
    activeStreamsMapRef.current.delete(deviceId);
    mixerMergerNodesRef.current.delete(deviceId);
    mixerSplitterNodesRef.current.delete(deviceId);
    mixerSourceNodesRef.current.delete(deviceId);

    if (process.env.NODE_ENV !== "production") {
      const laneKeyPattern = /^.+:(ch0|ch1)$/;
      for (const laneKey of Array.from(mixerGainNodesRef.current.keys())) {
        console.assert(
          laneKeyPattern.test(laneKey),
          "[Kite][Invariant] mixerGainNodesRef key must match /^.+:(ch0|ch1)$/",
          laneKey
        );
      }
      for (const laneKey of Array.from(mixerAnalyserNodesRef.current.keys())) {
        console.assert(
          laneKeyPattern.test(laneKey),
          "[Kite][Invariant] mixerAnalyserNodesRef key must match /^.+:(ch0|ch1)$/",
          laneKey
        );
      }
      for (const laneKey of Array.from(perChannelMeterRefs.current.keys())) {
        console.assert(
          laneKeyPattern.test(laneKey),
          "[Kite][Invariant] perChannelMeterRefs key must match /^.+:(ch0|ch1)$/",
          laneKey
        );
      }
    }
  }, [clearInterfaceMonitorStateForDevice, teardownInterfaceLiveMonitorGraph]);

  const disconnectMixerLaneNodes = useCallback(() => {
    for (const laneKey of Array.from(mixerGainNodesRef.current.keys())) {
      const gainNode = mixerGainNodesRef.current.get(laneKey);
      const analyserNode = mixerAnalyserNodesRef.current.get(laneKey);
      try {
        gainNode?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        analyserNode?.disconnect();
      } catch {
        /* ignore */
      }
    }

    for (const deviceId of Array.from(mixerMergerNodesRef.current.keys())) {
      const mergerNode = mixerMergerNodesRef.current.get(deviceId);
      const splitterNode = mixerSplitterNodesRef.current.get(deviceId);
      const sourceNode = mixerSourceNodesRef.current.get(deviceId);
      try {
        mergerNode?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        splitterNode?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        sourceNode?.disconnect();
      } catch {
        /* ignore */
      }
    }
    mixerGainNodesRef.current.clear();
    mixerAnalyserNodesRef.current.clear();
    mixerMergerNodesRef.current.clear();
    mixerSplitterNodesRef.current.clear();
    mixerSourceNodesRef.current.clear();
    mixerLaneProbeRef.current.clear();
  }, []);

  const teardownMixerGraphNodes = useCallback(() => {
    if (process.env.NODE_ENV !== "production") {
      console.assert(
        mixerTeardownOriginRef.current === "performTeardown",
        "[Kite][Invariant] teardownMixerGraphNodes should be called only from performTeardown"
      );
    }
    disconnectMixerLaneNodes();
  }, [disconnectMixerLaneNodes]);

  const teardownMasterDestinationNode = useCallback(() => {
    try {
      voipOutgoingSourceRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    voipOutgoingSourceRef.current = null;
    try {
      voipOutgoingGainRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    voipOutgoingGainRef.current = null;
    try {
      voipOutgoingDestinationRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    voipOutgoingDestinationRef.current = null;
    try {
      mixerMasterDestinationRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      mixerKiteTapDestinationRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    mixerMasterDestinationRef.current = null;
    mixerMasterStreamRef.current = null;
    mixerKiteTapDestinationRef.current = null;
    mixerKiteTapStreamRef.current = null;
  }, []);

  const ensureMasterDestinationNode = useCallback(() => {
    const ctx = studioAudioContextRef.current;
    if (!ctx || ctx.state === "closed") return null;

    let destinationNode = mixerMasterDestinationRef.current;
    if (!destinationNode) {
      destinationNode = ctx.createMediaStreamDestination();
      mixerMasterDestinationRef.current = destinationNode;
      mixerMasterStreamRef.current = destinationNode.stream;
    } else if (!mixerMasterStreamRef.current) {
      mixerMasterStreamRef.current = destinationNode.stream;
    }

    let kiteTapNode = mixerKiteTapDestinationRef.current;
    if (!kiteTapNode) {
      kiteTapNode = ctx.createMediaStreamDestination();
      mixerKiteTapDestinationRef.current = kiteTapNode;
      mixerKiteTapStreamRef.current = kiteTapNode.stream;
    } else if (!mixerKiteTapStreamRef.current) {
      mixerKiteTapStreamRef.current = kiteTapNode.stream;
    }

    return destinationNode;
  }, []);

  const ensureVoipOutgoingDestination = useCallback((audioCtx: AudioContext): MediaStreamAudioDestinationNode | null => {
    if (!audioCtx || audioCtx.state === "closed") return null;
    let dest = voipOutgoingDestinationRef.current;
    if (!dest) {
      dest = audioCtx.createMediaStreamDestination();
      voipOutgoingDestinationRef.current = dest;
    }
    if (!voipOutgoingGainRef.current) {
      const gain = audioCtx.createGain();
      gain.gain.value = 1;
      gain.connect(dest);
      voipOutgoingGainRef.current = gain;
    }
    return dest;
  }, []);

  const rebuildMixerAndReplaceTrack = useCallback(async () => {
    if (mixerRebuildInFlightRef.current) return;
    mixerRebuildInFlightRef.current = true;
    const ctx = studioAudioContextRef.current;
    if (!ctx || ctx.state === "closed") {
      mixerRebuildInFlightRef.current = false;
      return;
    }

    try {
      if (
        voipOutgoingDestinationRef.current &&
        voipOutgoingDestinationRef.current.context !== ctx
      ) {
        try {
          voipOutgoingSourceRef.current?.disconnect();
        } catch {
          /* ignore */
        }
        voipOutgoingSourceRef.current = null;
        try {
          voipOutgoingGainRef.current?.disconnect();
        } catch {
          /* ignore */
        }
        voipOutgoingGainRef.current = null;
        try {
          voipOutgoingDestinationRef.current?.disconnect();
        } catch {
          /* ignore */
        }
        voipOutgoingDestinationRef.current = null;
      }

      const inputs = Array.from(activeStreamsMapRef.current.entries()).map(([deviceId, stream]) => ({
        deviceId,
        stream,
      }));

      disconnectMixerLaneNodes();
      const destinationNode = ensureMasterDestinationNode();
      if (!destinationNode || inputs.length === 0) {
        try {
          voipOutgoingSourceRef.current?.disconnect();
        } catch {
          /* ignore */
        }
        voipOutgoingSourceRef.current = null;
        setDeviceInputChannelCount({});
        return;
      }

      const kiteTapNode = mixerKiteTapDestinationRef.current;
      if (!kiteTapNode) {
        if (process.env.NODE_ENV !== "production") {
          console.assert(false, "[Kite][Invariant] kite tap destination must exist with master");
        }
        try {
          voipOutgoingSourceRef.current?.disconnect();
        } catch {
          /* ignore */
        }
        voipOutgoingSourceRef.current = null;
        setDeviceInputChannelCount({});
        return;
      }

      const nextChannelCounts: Record<string, 1 | 2> = {};

      for (const input of inputs) {
        const laneGraph = await createLaneGraph({
          deviceId: input.deviceId,
          stream: input.stream,
          audioCtx: ctx,
          destinationNode,
          kiteTapDestinationNode: kiteTapNode,
          deviceVolumes: deviceVolumesRef.current,
        });
        nextChannelCounts[input.deviceId] = laneGraph.laneInfo.channelCount;
        for (const [laneKey, gainNode] of Array.from(laneGraph.gainNodes.entries())) {
          mixerGainNodesRef.current.set(laneKey, gainNode);
        }
        for (const [laneKey, analyserNode] of Array.from(laneGraph.analyserNodes.entries())) {
          mixerAnalyserNodesRef.current.set(laneKey, analyserNode);
        }
        for (const laneKey of laneGraph.laneKeys) {
          mixerLaneProbeRef.current.set(laneKey, laneGraph.laneInfo);
        }
        mixerSourceNodesRef.current.set(input.deviceId, laneGraph.sourceNode);
        mixerSplitterNodesRef.current.set(input.deviceId, laneGraph.splitterNode);
        mixerMergerNodesRef.current.set(input.deviceId, laneGraph.mergerNode);
      }

      setDeviceInputChannelCount(nextChannelCounts);
      mixerKiteTapStreamRef.current = kiteTapNode.stream;

      mixerMasterDestinationRef.current = destinationNode;
      mixerMasterStreamRef.current = destinationNode.stream;
      if (process.env.NODE_ENV !== "production") {
        console.assert(
          mixerMasterDestinationRef.current !== null,
          "[Kite][Invariant] masterDestinationRef must exist after lane build"
        );
      }
      const masterTrack = destinationNode.stream.getAudioTracks()[0] ?? null;
      if (!masterTrack) return;

      setLocalMicStream(destinationNode.stream);
      const localEl = localMonitorAudioRef.current;
      if (localEl) {
        localEl.srcObject = destinationNode.stream;
        localEl.muted = true;
        void localEl.play().catch(() => {});
      }

      const voipDest = ensureVoipOutgoingDestination(ctx);
      const voipGain = voipOutgoingGainRef.current;
      const primaryDeviceId = activeDeviceIdsRef.current[0] ?? "";
      const rawStream = primaryDeviceId
        ? activeStreamsMapRef.current.get(primaryDeviceId) ?? null
        : null;
      const hasLivePrimary =
        rawStream !== null &&
        rawStream.getAudioTracks().some((t) => t.readyState === "live");

      try {
        voipOutgoingSourceRef.current?.disconnect();
      } catch {
        /* ignore */
      }
      voipOutgoingSourceRef.current = null;

      if (rawStream && voipDest && voipGain && hasLivePrimary) {
        try {
          const voipSource = ctx.createMediaStreamSource(rawStream);
          voipSource.connect(voipGain);
          voipOutgoingSourceRef.current = voipSource;
        } catch (err) {
          console.warn("[Studio] VoIP outgoing MediaStreamSource failed:", err);
        }
      }

      const voipTrack = voipDest?.stream.getAudioTracks()[0] ?? null;
      const prevStream = localStreamRef.current;
      const prevTrack = prevStream?.getAudioTracks()[0] ?? null;
      if (voipTrack && voipOutgoingSourceRef.current && voipDest) {
        if (prevTrack) {
          replacePeerAudioTrack(prevTrack, voipTrack, prevStream ?? null, voipDest.stream);
        }
        voipTrack.enabled = !isMicMutedRef.current;
        localStreamRef.current = voipDest.stream;
      }

      if (process.env.NODE_ENV !== "production") {
        const laneKeyPattern = /^.+:(ch0|ch1)$/;
        for (const laneKey of Array.from(mixerGainNodesRef.current.keys())) {
          console.assert(
            laneKeyPattern.test(laneKey),
            "[Kite][Invariant] mixerGainNodesRef key must match /^.+:(ch0|ch1)$/",
            laneKey
          );
        }
        for (const laneKey of Array.from(mixerAnalyserNodesRef.current.keys())) {
          console.assert(
            laneKeyPattern.test(laneKey),
            "[Kite][Invariant] mixerAnalyserNodesRef key must match /^.+:(ch0|ch1)$/",
            laneKey
          );
        }
        for (const laneKey of Array.from(perChannelMeterRefs.current.keys())) {
          console.assert(
            laneKeyPattern.test(laneKey),
            "[Kite][Invariant] perChannelMeterRefs key must match /^.+:(ch0|ch1)$/",
            laneKey
          );
        }
      }
    } finally {
      mixerRebuildInFlightRef.current = false;
    }
  }, [
    disconnectMixerLaneNodes,
    ensureMasterDestinationNode,
    ensureVoipOutgoingDestination,
    replacePeerAudioTrack,
    setDeviceInputChannelCount,
  ]);

  const toggleAudioDevice = useCallback(
    async (deviceId: string) => {
      if (mixerRebuildInFlightRef.current) return;
      let ctx = studioAudioContextRef.current;
      if (ctx?.state === "closed") {
        studioAudioContextRef.current = null;
        ctx = null;
      }
      if (!ctx) {
        ctx = createStudioAudioContext();
        studioAudioContextRef.current = ctx;
        audioBaseLatencySecRef.current = Number.isFinite(ctx.baseLatency) ? ctx.baseLatency : 0;
        audioOutputLatencySecRef.current = Number.isFinite(ctx.outputLatency)
          ? ctx.outputLatency
          : 0;
        console.log(
          `[HAL] base=${audioBaseLatencySecRef.current} output=${audioOutputLatencySecRef.current}`
        );
        workletLoadedContextRef.current = null;
        workletLoadPromiseRef.current = null;
        setIsWorkletLoaded(false);
      }
      const requestedDeviceId = deviceId.trim();
      if (!requestedDeviceId) return;

      const isActive = activeDeviceIdsRef.current.includes(requestedDeviceId);
      if (isActive) {
        setActiveDeviceIds((prev) => prev.filter((id) => id !== requestedDeviceId));
        clearMixerDeviceVolumeState(requestedDeviceId);
        removeAndCleanupDevice(requestedDeviceId);
        void rebuildMixerAndReplaceTrack();
        return;
      }

      if (activeDeviceIdsRef.current.length >= 3) {
        console.warn("Maximum 3 active input devices supported.");
        return;
      }

      setActiveDeviceIds((prev) => {
        if (prev.includes(requestedDeviceId)) return prev;
        return [...prev, requestedDeviceId];
      });

      try {
        const nextStream = await acquireStudioMicStream({
          deviceId: requestedDeviceId,
          echoSafetyMode,
        });
        if (!mountedRef.current) {
          nextStream.getTracks().forEach((track) => track.stop());
          return;
        }
        const stillIntended = activeDeviceIdsRef.current.includes(requestedDeviceId);
        if (!stillIntended) {
          nextStream.getTracks().forEach((track) => track.stop());
          return;
        }
        if ((nextStream.getAudioTracks()[0] ?? null) === null) {
          nextStream.getTracks().forEach((track) => track.stop());
          setActiveDeviceIds((prev) => prev.filter((id) => id !== requestedDeviceId));
          return;
        }
        activeStreamsMapRef.current.set(requestedDeviceId, nextStream);
        nextStream.getTracks().forEach((track) => {
          track.onended = () => {
            if (!activeDeviceIdsRef.current.includes(requestedDeviceId)) return;
            setActiveDeviceIds((prev) => prev.filter((id) => id !== requestedDeviceId));
            removeAndCleanupDevice(requestedDeviceId);
            clearMixerDeviceVolumeState(requestedDeviceId);
          };
        });
        setDeviceVolumes((prev) => {
          const lane0 = `${requestedDeviceId}:ch0`;
          const lane1 = `${requestedDeviceId}:ch1`;
          if (prev[lane0] !== undefined || prev[lane1] !== undefined) return prev;
          const legacy = prev[requestedDeviceId];
          if (legacy !== undefined) {
            const next = { ...prev };
            delete next[requestedDeviceId];
            return { ...next, [lane0]: legacy, [lane1]: legacy };
          }
          return { ...prev, [lane0]: 100, [lane1]: 100 };
        });
        await rebuildMixerAndReplaceTrack();
        if (process.env.NODE_ENV !== "production") {
          console.assert(
            mixerMasterDestinationRef.current !== null,
            "[Kite][Invariant] masterDestinationRef must exist after first device add"
          );
        }
      } catch (err) {
        setActiveDeviceIds((prev) => prev.filter((id) => id !== requestedDeviceId));
        const errorName = err && typeof err === "object" ? (err as { name?: string }).name : undefined;
        if (errorName === "NotFoundError") {
          setStatusNote("Device disconnected or not found.");
        } else if (isDeviceBusyError(err)) {
          setStatusNote("Device is busy. Please close Zoom, Discord, or your DAW and retry.");
        }
        console.error("Failed to toggle audio input device:", err);
      } finally {
        void refreshAudioInputDevices();
      }
    },
    [
      echoSafetyMode,
      rebuildMixerAndReplaceTrack,
      refreshAudioInputDevices,
      removeAndCleanupDevice,
      clearMixerDeviceVolumeState,
    ]
  );

  const handleVolumeChange = useCallback((laneKey: string, newVolume: number) => {
    const clampedVolume = Math.min(100, Math.max(0, newVolume));
    setDeviceVolumes((prev) => ({ ...prev, [laneKey]: clampedVolume }));

    const deviceId =
      laneKey.endsWith(":ch0") || laneKey.endsWith(":ch1") ? laneKey.slice(0, -4) : null;
    if (!deviceId || !activeStreamsMapRef.current.has(deviceId)) return;

    const ctx = studioAudioContextRef.current;
    if (!ctx || ctx.state === "closed") return;
    try {
      const perceptualGain = Math.pow(clampedVolume / 100, 2);
      const gainNode = mixerGainNodesRef.current.get(laneKey);
      if (gainNode) {
        gainNode.gain.cancelScheduledValues(ctx.currentTime);
        gainNode.gain.setTargetAtTime(perceptualGain, ctx.currentTime, 0.01);
      }

      const monitorGain = interfaceLiveMonitorGainNodesRef.current.get(deviceId);
      if (monitorGain) {
        if (kiteModeRef.current === "broadcast") {
          rampLinearAudioGain(monitorGain.gain, ctx, 0, BROADCAST_INTERFACE_MONITOR_RAMP_SEC);
        } else {
          const vols = deviceVolumesRef.current;
          const chCount = deviceInputChannelCountRef.current[deviceId] ?? 1;
          const v0 =
            laneKey === `${deviceId}:ch0` ? clampedVolume : vols[`${deviceId}:ch0`] ?? 100;
          const v1 =
            laneKey === `${deviceId}:ch1` ? clampedVolume : vols[`${deviceId}:ch1`] ?? 100;
          const blended = chCount >= 2 ? (v0 + v1) / 2 : v0;
          const monitorPerceptual = Math.pow(Math.min(100, Math.max(0, blended)) / 100, 2);
          rampLinearAudioGain(
            monitorGain.gain,
            ctx,
            monitorPerceptual,
            BROADCAST_INTERFACE_MONITOR_RAMP_SEC
          );
        }
      }
    } catch {
      /* ignore slider updates during active teardown */
    }
  }, []);

  const buildInterfaceLiveMonitorGraph = useCallback((deviceId: string) => {
    const ctx = studioAudioContextRef.current;
    if (!ctx || ctx.state === "closed") return;
    if (interfaceLiveMonitorSourceNodesRef.current.has(deviceId)) return;
    if (interfaceInputDeviceFlagsRef.current[deviceId] !== true) return;
    if (interfaceLiveMonitorEnabledFlagsRef.current[deviceId] !== true) return;

    const stream = activeStreamsMapRef.current.get(deviceId);
    if (!stream || stream.getAudioTracks().length === 0) return;

    try {
      const sourceNode = ctx.createMediaStreamSource(stream);
      const gainNode = ctx.createGain();
      const vols = deviceVolumesRef.current;
      const chCount = deviceInputChannelCountRef.current[deviceId] ?? 1;
      const v0 = vols[`${deviceId}:ch0`] ?? 100;
      const v1 = vols[`${deviceId}:ch1`] ?? 100;
      const volume = chCount >= 2 ? (v0 + v1) / 2 : v0;
      const targetLinear = Math.pow(Math.min(100, Math.max(0, volume)) / 100, 2);
      const t0 = ctx.currentTime;
      if (kiteModeRef.current === "broadcast") {
        gainNode.gain.setValueAtTime(0, t0);
      } else {
        gainNode.gain.setValueAtTime(0, t0);
        gainNode.gain.linearRampToValueAtTime(targetLinear, t0 + BROADCAST_INTERFACE_MONITOR_RAMP_SEC);
      }
      sourceNode.connect(gainNode);
      if (kiteModeRef.current !== "broadcast") {
        gainNode.connect(ctx.destination);
      }
      interfaceLiveMonitorSourceNodesRef.current.set(deviceId, sourceNode);
      interfaceLiveMonitorGainNodesRef.current.set(deviceId, gainNode);
    } catch (error) {
      console.warn("[Kite] Could not start interface live monitor:", error);
    }
  }, []);

  useEffect(() => {
    for (const deviceId of activeDeviceIds) {
      buildInterfaceLiveMonitorGraph(deviceId);
    }
  }, [activeDeviceIds, buildInterfaceLiveMonitorGraph, interfaceInputDeviceFlags, interfaceLiveMonitorEnabledFlags]);

  const setInterfaceInputDeviceFlag = useCallback((deviceId: string, isInterfaceInput: boolean) => {
    setInterfaceInputDeviceFlags((prev) => {
      const next = { ...prev };
      if (isInterfaceInput) {
        next[deviceId] = true;
      } else {
        delete next[deviceId];
      }
      interfaceInputDeviceFlagsRef.current = next;
      return next;
    });

    if (!isInterfaceInput) {
      teardownInterfaceLiveMonitorGraph(deviceId);
      setInterfaceLiveMonitorEnabledFlags((prev) => {
        if (prev[deviceId] === undefined) return prev;
        const next = { ...prev };
        delete next[deviceId];
        interfaceLiveMonitorEnabledFlagsRef.current = next;
        return next;
      });
    }
  }, [teardownInterfaceLiveMonitorGraph]);

  const setInterfaceLiveMonitorEnabledFlag = useCallback((deviceId: string, isMonitorEnabled: boolean) => {
    if (!isMonitorEnabled) {
      teardownInterfaceLiveMonitorGraph(deviceId);
    }
    setInterfaceLiveMonitorEnabledFlags((prev) => {
      const next = { ...prev };
      if (isMonitorEnabled) {
        next[deviceId] = true;
      } else {
        delete next[deviceId];
      }
      interfaceLiveMonitorEnabledFlagsRef.current = next;
      return next;
    });
  }, [teardownInterfaceLiveMonitorGraph]);

  const flushAndSetRemoteGridTarget = useCallback((targetTimeSec: number | null) => {
    const bufferNode = remoteBufferNodeRef.current;
    if (!bufferNode || !("port" in bufferNode)) return;
    bufferNode.port.postMessage({ type: "FLUSH_BUFFER" });
    if (typeof targetTimeSec === "number" && Number.isFinite(targetTimeSec)) {
      bufferNode.port.postMessage({
        type: "SET_GRID_TARGET",
        targetTimeSec,
      });
    }
  }, []);

  const ensureKiteBufferWorkletLoaded = useCallback(
    async (ctx: AudioContext): Promise<boolean> => {
      if (!isBufferingEnabledRef.current) return false;
      if (workletLoadedContextRef.current === ctx && isWorkletLoadedRef.current) {
        return true;
      }
      if (workletLoadPromiseRef.current) {
        return workletLoadPromiseRef.current;
      }
      const loadPromise = (async () => {
        const supported = await checkAudioWorkletSupport(ctx).catch(() => false);
        if (!supported) {
          if (mountedRef.current) setIsWorkletLoaded(false);
          return false;
        }
        try {
          await ctx.audioWorklet.addModule("/worklets/kite-buffer-processor.js");
          workletLoadedContextRef.current = ctx;
          if (mountedRef.current) setIsWorkletLoaded(true);
          return true;
        } catch {
          if (mountedRef.current) setIsWorkletLoaded(false);
          return false;
        } finally {
          workletLoadPromiseRef.current = null;
        }
      })();
      workletLoadPromiseRef.current = loadPromise;
      return loadPromise;
    },
    []
  );

  const buildRemotePlaybackGraph = useCallback((stream: MediaStream) => {
    const ctx = studioAudioContextRef.current;
    if (!ctx) return;
    teardownRemotePlaybackGraph();
    const source = ctx.createMediaStreamSource(stream);
    const delayNode = ctx.createDelay(5);
    delayNode.delayTime.value = 0; // MUST remain 0 for real-time jamming
    const gain = ctx.createGain();
    gain.gain.value = speakerMutedRef.current
      ? 0
      : Math.min(
          Math.max(remotePlaybackVolumeRef.current, REMOTE_PLAYBACK_VOLUME_MIN),
          REMOTE_PLAYBACK_VOLUME_MAX
        );
    remoteBufferNodeRef.current = null;
    if (isBufferingEnabledRef.current) {
      if (
        workletLoadedContextRef.current === ctx &&
        isWorkletLoadedRef.current
      ) {
        const bufferNode = new AudioWorkletNode(ctx, "kite-buffer-processor");
        bufferNode.port.onmessage = (event: MessageEvent) => {
          const data = event?.data as
            | {
                type?: string;
                bufferDepthFrames?: number;
                targetLeadFrames?: number;
                isPrimed?: boolean;
                driftCorrectionEvent?: "drop" | "dupe" | "none";
              }
            | undefined;
          if (!data || data.type !== "BUFFER_DEPTH") return;
          const nowMs = performance.now();
          if (nowMs - lastWorkletTelemetryAtMsRef.current < 250) return;
          lastWorkletTelemetryAtMsRef.current = nowMs;
          if (typeof data.bufferDepthFrames === "number") {
            setBufferDepthFrames(Math.max(0, Math.round(data.bufferDepthFrames)));
          }
          if (typeof data.targetLeadFrames === "number") {
            setTargetLeadFrames(Math.max(0, Math.round(data.targetLeadFrames)));
          }
          setIsBufferPrimed(Boolean(data.isPrimed));
          if (
            data.driftCorrectionEvent === "drop" ||
            data.driftCorrectionEvent === "dupe" ||
            data.driftCorrectionEvent === "none"
          ) {
            setLastCorrectionEvent(data.driftCorrectionEvent);
          }
        };
        bufferNode.port.postMessage({
          type: "SET_TARGET_LEAD_FRAMES",
          value: targetLeadFramesRef.current,
        });
        source.connect(bufferNode);
        bufferNode.connect(delayNode);
        remoteBufferNodeRef.current = bufferNode;
      } else {
        source.connect(delayNode);
      }
    } else {
      source.connect(delayNode);
    }
    delayNode.connect(gain);
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = REMOTE_COMPRESSOR_THRESHOLD;
    compressor.knee.value      = REMOTE_COMPRESSOR_KNEE;
    compressor.ratio.value     = REMOTE_COMPRESSOR_RATIO;
    compressor.attack.value    = REMOTE_COMPRESSOR_ATTACK;
    compressor.release.value   = REMOTE_COMPRESSOR_RELEASE;
    gain.connect(compressor);
    compressor.connect(ctx.destination);
    remotePlaybackCompressorRef.current = compressor;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.62;
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    gain.connect(analyser);
    analyser.connect(silentGain);
    silentGain.connect(ctx.destination);
    remotePlaybackSourceRef.current = source;
    remotePlaybackDelayRef.current = delayNode;
    remotePlaybackGainRef.current = gain;
    remotePlaybackAnalyserRef.current = analyser;
    remotePlaybackMeterSinkRef.current = silentGain;
    setRemoteMeterTapActive(true);
    setRemoteMeterRafKey((k) => k + 1);
  }, []);

  const rebuildRemoteGraphWithoutTeardown = useCallback(() => {
    if (isBroadcastConnectPendingRef.current || kiteModeRef.current === "broadcast") return;
    const ctx = studioAudioContextRef.current;
    const stream = remoteStreamRef.current;
    if (!ctx || !stream) return;
    const currentGain = remotePlaybackGainRef.current;
    if (currentGain) {
      try {
        currentGain.gain.cancelScheduledValues(ctx.currentTime);
        currentGain.gain.setValueAtTime(currentGain.gain.value, ctx.currentTime);
        currentGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.05);
      } catch {
        /* ignore */
      }
    }
    window.setTimeout(() => {
      if (!mountedRef.current) return;
      if (isBroadcastConnectPendingRef.current || kiteModeRef.current === "broadcast") return;
      buildRemotePlaybackGraph(stream);
      const rebuiltGain = remotePlaybackGainRef.current;
      const rebuiltCtx = studioAudioContextRef.current;
      if (!rebuiltGain || !rebuiltCtx) return;
      const targetGain = speakerMutedRef.current
        ? 0
        : Math.min(
            Math.max(remotePlaybackVolumeRef.current, REMOTE_PLAYBACK_VOLUME_MIN),
            REMOTE_PLAYBACK_VOLUME_MAX
          );
      try {
        rebuiltGain.gain.cancelScheduledValues(rebuiltCtx.currentTime);
        rebuiltGain.gain.setValueAtTime(0, rebuiltCtx.currentTime);
        rebuiltGain.gain.linearRampToValueAtTime(
          targetGain,
          rebuiltCtx.currentTime + 0.05
        );
      } catch {
        /* ignore */
      }
    }, 60);
  }, [buildRemotePlaybackGraph]);

  const micRowState: CheckRowState = micPermissionDenied
    ? "error"
    : localMicStream
      ? "done"
      : "pending";
  const audioRowState: CheckRowState = micPermissionDenied
    ? "pending"
    : audioTestFailed
      ? "error"
      : audioTestDone
        ? "done"
        : "pending";

  const connRowState: CheckRowState =
    micPermissionDenied
      ? "pending"
      : kiteSignal === "secure"
        ? "done"
        : kiteSignal === "checking"
          ? "pending"
          : "error";

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
  const localJamSetupOwnerId = user?.id ?? `${role ?? "unknown"}:${sessionId ?? "local"}`;
  const localJamSetupOwnerName = role === "host" ? "Host" : "Bandmate";
  const canControlStop = !syncInitiatorId || syncInitiatorId === localJamSetupOwnerId;
  const canStartSync = broadcastStatus === "idle" && Boolean(remoteStream);
  const jamSetupLockedByRemote =
    Boolean(jamSetupLock) &&
    jamSetupLock!.ownerId !== localJamSetupOwnerId &&
    jamSetupLock!.expiresAt > Date.now();

  const remoteIsLive = remoteLevel > 0.07;
  const syncCountInBlocksLive = kiteSyncCountInActive && kiteSyncEnabled;
  /** UI/control lock during P2P broadcast (Stealth Lock — Phase 2). */
  const stealthBroadcastUiLock = kiteMode === "broadcast";

  useEffect(() => {
    if (!kiteSyncEnabled) {
      kiteSyncCountInCompletionHandledRef.current = false;
      setKiteSyncCountInActive(false);
    }
  }, [kiteSyncEnabled]);

  useEffect(() => {
    speakerMutedRef.current = isSpeakerMuted;
    applyRemotePlaybackSpeakerGain(isSpeakerMuted);
  }, [isSpeakerMuted, applyRemotePlaybackSpeakerGain]);

  useEffect(() => {
    remotePlaybackVolumeRef.current = remotePlaybackVolume;
  }, [remotePlaybackVolume]);

  useEffect(() => {
    if (!remoteStream) {
      setRemoteLevel(0);
      setRemoteMeterHeights([...BASELINE_LEVEL_BAR_HEIGHTS]);
    }
  }, [remoteStream]);

  useEffect(() => {
    if (!remoteMeterTapActive) {
      setRemoteMeterHeights([...BASELINE_LEVEL_BAR_HEIGHTS]);
      setRemoteLevel(0);
      return;
    }
    const an = remotePlaybackAnalyserRef.current;
    if (!an) return;
    let raf = 0;
    let stopped = false;
    let lastT = 0;
    const buf = new Uint8Array(an.frequencyBinCount);
    const METER_READ_MS = 100;
    const tick = (now: number) => {
      if (stopped || !mountedRef.current) return;
      if (now - lastT >= METER_READ_MS) {
        lastT = now;
        an.getByteFrequencyData(buf);
        const next = meterBinsFromFrequencyData(buf);
        setRemoteMeterHeights(next);
        const avg = next.reduce((a, b) => a + b, 0) / next.length;
        setRemoteLevel(avg);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [remoteMeterTapActive, remoteMeterRafKey]);

  useEffect(() => {
    if (status !== "connected") {
      setInboundPacketLossPercent(null);
      setCalculatedDelayMs(null);
      calculatedDelayMsRef.current = null;
      kiteSyncLossRecoverySinceMsRef.current = null;
      kiteSyncLossPauseActiveRef.current = false;
      setKiteSyncNetworkMetronomePaused(false);
      return;
    }
    const isSafariWebKit = isStudioSafariWebKitEngine();
    const tick = () => {
      const pc = peerConnectionRef.current;
      if (!pc || !mountedRef.current) return;
      void pc
        .getStats()
        .then((stats) => {
          if (!mountedRef.current) return;
          const parsedRtt = parseSelectedCandidatePairRttMs(stats);
          if (parsedRtt === null) {
            setCalculatedDelayMs(null);
            calculatedDelayMsRef.current = null;
          } else {
            // One-way transport delay estimate for alignment/compensation engines.
            const oneWayDelayMs = Math.max(
              0,
              Math.min(2000, Math.round((parsedRtt.rttMs / 2) * 10) / 10)
            );
            setCalculatedDelayMs(oneWayDelayMs);
            calculatedDelayMsRef.current = oneWayDelayMs;
          }
          let jitterSec = 0;
          stats.forEach((stat) => {
            if (
              stat.type === "inbound-rtp" &&
              stat.kind === "audio" &&
              typeof (stat as RTCInboundRtpStreamStats).jitter === "number"
            ) {
              const j = (stat as RTCInboundRtpStreamStats).jitter;
              if (typeof j === "number") jitterSec = j;
            }
          });
          const parsed = parseInboundAudioPacketLoss(stats);
          if (isAutoBufferRef.current && parsedRtt !== null) {
            const sampleRate = getStudioKiteSampleRate();
            const rttSec = (parsedRtt.rttMs / 2) / 1000;
            let autoTarget = Math.round((rttSec + jitterSec + 0.02) * sampleRate);
            autoTarget = Math.max(480, Math.min(19200, autoTarget));
            const currentTarget = targetLeadFramesRef.current;
            if (Math.abs(autoTarget - currentTarget) >= 480) {
              const bufferNode = remoteBufferNodeRef.current;
              if (bufferNode && "port" in bufferNode) {
                bufferNode.port.postMessage({
                  type: "SET_TARGET_LEAD_FRAMES",
                  value: autoTarget,
                });
              }
              targetLeadFramesRef.current = autoTarget;
              setTargetLeadFrames(autoTarget);
            }
          }
          if (parsed === null) {
            setInboundPacketLossPercent(null);
            applyKiteSyncLossGuardRef.current(null);
            return;
          }
          const packetLossPercent = Math.round(parsed.ratio * 1000) / 10;
          applyLowLatencyInboundAudioReceivers(pc, {
            isSafariWebKit,
            packetLossPercent,
          });
          setInboundPacketLossPercent(packetLossPercent);
          applyKiteSyncLossGuardRef.current(packetLossPercent);
        })
        .catch(() => {});
    };
    tick();
    const id = window.setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [getStudioKiteSampleRate, status]);

  useEffect(() => {
    if (status !== "connected") {
      highPingStreakRef.current = 0;
      highPingTipDismissedRef.current = false;
      setHighPingTipOpen(false);
      return;
    }
    if (pingMs === null) return;

    if (pingMs <= HIGH_PING_WARN_MS) {
      highPingStreakRef.current = 0;
      highPingTipDismissedRef.current = false;
      setHighPingTipOpen(false);
      return;
    }

    highPingStreakRef.current += 1;
    if (
      highPingStreakRef.current >= HIGH_PING_WARN_SAMPLES &&
      !highPingTipDismissedRef.current
    ) {
      setHighPingTipOpen(true);
    }
  }, [pingMs, status]);

  const dismissHighPingTip = useCallback(() => {
    highPingTipDismissedRef.current = true;
    setHighPingTipOpen(false);
  }, []);

  const runAudioTest = useCallback(async () => {
    if (audioTestDone || audioTestPlaying || micPermissionDenied) return;
    setAudioTestPlaying(true);
    setAudioTestFailed(false);
    try {
      await playTestTone();
      if (mountedRef.current) setAudioTestDone(true);
    } catch {
      if (mountedRef.current) setAudioTestFailed(true);
    } finally {
      if (mountedRef.current) setAudioTestPlaying(false);
    }
  }, [audioTestDone, audioTestPlaying, micPermissionDenied]);

  const clearLostCountdown = useCallback(() => {
    if (lostCountdownIntervalRef.current !== null) {
      clearInterval(lostCountdownIntervalRef.current);
      lostCountdownIntervalRef.current = null;
    }
    setConnectionLostCountdown(null);
  }, []);

  const beginLostCountdown = useCallback(() => {
    clearLostCountdown();
    setConnectionLostCountdown(30);
    lostCountdownIntervalRef.current = window.setInterval(() => {
      setConnectionLostCountdown((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          if (lostCountdownIntervalRef.current !== null) {
            clearInterval(lostCountdownIntervalRef.current);
            lostCountdownIntervalRef.current = null;
          }
          setStatus("failed");
          setStatusNote("Signal timed out.");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [clearLostCountdown]);

  const sendLeaveSignal = useCallback(async () => {
    if (leaveSignalSentRef.current || !sessionId || !role) return;
    leaveSignalSentRef.current = true;
    const payload: SessionControlMessage = {
      type: "LEAVE",
      from: role,
      room: sessionId.toUpperCase(),
      at: new Date().toISOString(),
    };
    try {
      await channelRef.current?.send({
        type: "broadcast",
        event: "session-control",
        payload,
      });
      addLog("LEAVE signal sent");
    } catch (err) {
      console.error("LEAVE signal send failed", err);
    }
  }, [sessionId, role]);

  const toggleMic = useCallback(() => {
    if (kiteSyncCountInActive && kiteSyncEnabled) {
      setIsMicMuted((prev) => {
        if (!prev) {
          localStreamRef.current?.getAudioTracks().forEach((track) => {
            track.enabled = false;
          });
          return true;
        }
        return prev;
      });
      return;
    }
    setIsMicMuted((prev) => {
      const nextMuted = !prev;
      const enabled = !nextMuted;
      localStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
      });
      return nextMuted;
    });
  }, [kiteSyncCountInActive, kiteSyncEnabled]);

  const toggleSpeaker = useCallback(() => {
    if (kiteSyncCountInActive && kiteSyncEnabled) {
      setIsSpeakerMuted((prev) => {
        if (!prev) {
          speakerMutedRef.current = true;
          applyRemotePlaybackSpeakerGain(true);
          return true;
        }
        return prev;
      });
      return;
    }
    setIsSpeakerMuted((prev) => {
      const nextMuted = !prev;
      speakerMutedRef.current = nextMuted;
      applyRemotePlaybackSpeakerGain(nextMuted);
      return nextMuted;
    });
  }, [applyRemotePlaybackSpeakerGain, kiteSyncCountInActive, kiteSyncEnabled]);

  const onRemotePlaybackVolumeChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (kiteSyncCountInActive && kiteSyncEnabled) return;
      const next = Number(e.target.value);
      if (!Number.isFinite(next)) return;
      const clamped = Math.min(
        Math.max(next, REMOTE_PLAYBACK_VOLUME_MIN),
        REMOTE_PLAYBACK_VOLUME_MAX
      );
      remotePlaybackVolumeRef.current = clamped;
      setRemotePlaybackVolume(clamped);
      applyRemotePlaybackSpeakerGain(isSpeakerMuted);
    },
    [applyRemotePlaybackSpeakerGain, isSpeakerMuted, kiteSyncCountInActive, kiteSyncEnabled]
  );

  const onMetronomeVolumeChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const next = Number(e.target.value);
      if (!Number.isFinite(next)) return;
      const clamped = Math.min(2, Math.max(0, next));
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

  const clearRecordingInterval = useCallback(() => {
    if (recordingIntervalRef.current !== null) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
  }, []);

  /**
   * Single long-lived studio context for this page lifecycle.
   * Keeping creation centralized guarantees future schedulers always reference the same clock.
   */
  const ensureStudioAudioContext = useCallback((): AudioContext => {
    let ctx = studioAudioContextRef.current;
    if (ctx?.state === "closed") {
      studioAudioContextRef.current = null;
      workletLoadedContextRef.current = null;
      workletLoadPromiseRef.current = null;
      ctx = null;
      setAudioContextReady(false);
      setIsWorkletLoaded(false);
    }
    if (!ctx) {
      ctx = createStudioAudioContext();
      studioAudioContextRef.current = ctx;
      audioBaseLatencySecRef.current = Number.isFinite(ctx.baseLatency) ? ctx.baseLatency : 0;
      audioOutputLatencySecRef.current = Number.isFinite(ctx.outputLatency)
        ? ctx.outputLatency
        : 0;
      console.log(
        `[HAL] base=${audioBaseLatencySecRef.current} output=${audioOutputLatencySecRef.current}`
      );
      workletLoadedContextRef.current = null;
      workletLoadPromiseRef.current = null;
      setIsWorkletLoaded(false);
      void ensureKiteBufferWorkletLoaded(ctx);
      return ctx;
    }
    void ensureKiteBufferWorkletLoaded(ctx);
    return ctx;
  }, [ensureKiteBufferWorkletLoaded]);

  useEffect(() => {
    if (!isInStudioPhase) return;
    if (isBroadcastConnectPendingRef.current || kiteModeRef.current === "broadcast") return;
    if (!remoteStreamRef.current) return;
    rebuildRemoteGraphWithoutTeardown();
  }, [isInStudioPhase, isBufferingEnabled, rebuildRemoteGraphWithoutTeardown]);

  useEffect(() => {
    if (!isInStudioPhase || !isBufferingEnabled || !isWorkletLoaded) return;
    if (isBroadcastConnectPendingRef.current || kiteModeRef.current === "broadcast") return;
    if (!remoteStreamRef.current) return;
    rebuildRemoteGraphWithoutTeardown();
  }, [isInStudioPhase, isBufferingEnabled, isWorkletLoaded, rebuildRemoteGraphWithoutTeardown]);

  useEffect(() => {
    if (kiteSyncEnabled) return;
    const bufferNode = remoteBufferNodeRef.current;
    if (!bufferNode || !("port" in bufferNode)) return;
    bufferNode.port.postMessage({ type: "FLUSH_BUFFER" });
  }, [kiteSyncEnabled]);

  useEffect(() => {
    if (!isInStudioPhase) return;
    if (soloLooperStateRef.current === "recording") return;
    if (previousEchoSafetyModeRef.current === echoSafetyMode) return;
    if (echoModeApplyingRef.current) return;
    if (activeStreamsMapRef.current.size === 0 && !localStreamRef.current) return;

    echoModeApplyingRef.current = true;

    void (async () => {
      try {
        previousEchoSafetyModeRef.current = echoSafetyMode;

        const entries = Array.from(activeStreamsMapRef.current.entries());

        if (entries.length > 0) {
          for (const [deviceId, oldStream] of entries) {
            if (!activeDeviceIdsRef.current.includes(deviceId)) {
              removeAndCleanupDevice(deviceId);
              continue;
            }
            oldStream.getTracks().forEach((track) => track.stop());
            const nextStream = await acquireStudioMicStream({ deviceId, echoSafetyMode });
            if (!mountedRef.current) {
              nextStream.getTracks().forEach((track) => track.stop());
              return;
            }
            const stillIntended = activeDeviceIdsRef.current.includes(deviceId);
            if (!stillIntended) {
              nextStream.getTracks().forEach((track) => track.stop());
              removeAndCleanupDevice(deviceId);
              continue;
            }
            if ((nextStream.getAudioTracks()[0] ?? null) === null) {
              nextStream.getTracks().forEach((track) => track.stop());
              continue;
            }
            activeStreamsMapRef.current.set(deviceId, nextStream);
            nextStream.getTracks().forEach((track) => {
              track.onended = () => {
                if (!activeDeviceIdsRef.current.includes(deviceId)) return;
                setActiveDeviceIds((prev) => prev.filter((id) => id !== deviceId));
                removeAndCleanupDevice(deviceId);
                clearMixerDeviceVolumeState(deviceId);
              };
            });
          }
        } else if (localStreamRef.current) {
          const prevStream = localStreamRef.current;
          const prevTrack = prevStream.getAudioTracks()[0] ?? null;
          const deviceId =
            prevTrack?.getSettings().deviceId?.trim() ||
            activeDeviceIdsRef.current[0] ||
            "default";
          prevStream.getTracks().forEach((track) => track.stop());
          const nextStream = await acquireStudioMicStream({ deviceId, echoSafetyMode });
          if (!mountedRef.current) {
            nextStream.getTracks().forEach((track) => track.stop());
            return;
          }
          if ((nextStream.getAudioTracks()[0] ?? null) === null) {
            nextStream.getTracks().forEach((track) => track.stop());
            return;
          }
          activeStreamsMapRef.current.set(deviceId, nextStream);
          nextStream.getTracks().forEach((track) => {
            track.onended = () => {
              if (!activeDeviceIdsRef.current.includes(deviceId)) return;
              setActiveDeviceIds((prev) => prev.filter((id) => id !== deviceId));
              removeAndCleanupDevice(deviceId);
              clearMixerDeviceVolumeState(deviceId);
            };
          });
          setActiveDeviceIds((prev) => (prev.includes(deviceId) ? prev : [...prev, deviceId]));
        }

        await rebuildMixerAndReplaceTrack();
      } catch (err) {
        console.error("Failed to re-acquire microphone for echo safety mode:", err);
      } finally {
        echoModeApplyingRef.current = false;
      }
    })();
  }, [echoSafetyMode, rebuildMixerAndReplaceTrack, replacePeerAudioTrack]);

  useEffect(() => {
    if (isAutoBufferRef.current) return;
    if (targetLeadFramesDebounceRef.current !== null) {
      clearTimeout(targetLeadFramesDebounceRef.current);
    }
    targetLeadFramesDebounceRef.current = window.setTimeout(() => {
      const bufferNode = remoteBufferNodeRef.current;
      if (!bufferNode || !("port" in bufferNode)) return;
      bufferNode.port.postMessage({
        type: "SET_TARGET_LEAD_FRAMES",
        value: targetLeadFramesRef.current,
      });
      targetLeadFramesDebounceRef.current = null;
    }, 150);
    return () => {
      if (targetLeadFramesDebounceRef.current !== null) {
        clearTimeout(targetLeadFramesDebounceRef.current);
        targetLeadFramesDebounceRef.current = null;
      }
    };
  }, [targetLeadFrames, isAutoBuffer]);

  const buildKiteSyncPacket = useCallback((overrides?: {
    kiteSyncEnabled?: boolean;
    bpm?: number;
    bpi?: number;
  }): KiteSyncMessage | null => {
    const ctx = studioAudioContextRef.current;
    if (!ctx) return null;
    const nextEnabled = overrides?.kiteSyncEnabled ?? kiteSyncEnabled;
    const nextBpm = overrides?.bpm ?? metronomeBpm;
    const nextBpi =
      overrides?.bpi ??
      kiteIntervalTimingRef.current?.bpi ??
      latestKiteIntervalTimingRef.current?.bpi ??
      beatsPerInterval;
    kiteSyncSequenceRef.current += 1;
    studioRevisionRef.current += 1;
    console.log("Broadcasting KITE_SYNC packet...", {
      bpm: nextBpm,
      bpi: nextBpi,
    });
    return {
      type: "KITE_SYNC",
      hostTime: ctx.currentTime,
      bpm: nextBpm,
      bpi: nextBpi,
      enabled: nextEnabled,
      serverTimestamp: Date.now(),
      sequenceNumber: kiteSyncSequenceRef.current,
      initiatorId: syncInitiatorIdRef.current ?? localJamSetupOwnerId,
      studioRevision: studioRevisionRef.current,
    };
  }, [beatsPerInterval, kiteSyncEnabled, localJamSetupOwnerId, metronomeBpm]);

  const sendOrQueueKiteSyncPacket = useCallback((packet: KiteSyncMessage): void => {
    const peer = peerRef.current;
    if (!peer || peer.destroyed || peer.connected !== true) {
      pendingKiteSyncRef.current = packet;
      return;
    }
    try {
      peer.send(JSON.stringify(packet));
      pendingKiteSyncRef.current = null;
    } catch {
      // Coalesce to latest sync packet while channel is recovering.
      pendingKiteSyncRef.current = packet;
    }
  }, []);

  const broadcastKiteSync = useCallback((overrides?: {
    kiteSyncEnabled?: boolean;
    bpm?: number;
    bpi?: number;
  }): void => {
    const packet = buildKiteSyncPacket({
      kiteSyncEnabled: overrides?.kiteSyncEnabled,
      bpm: overrides?.bpm,
      bpi: overrides?.bpi,
    });
    if (!packet) return;
    sendOrQueueKiteSyncPacket(packet);
  }, [buildKiteSyncPacket, sendOrQueueKiteSyncPacket]);

  const flushStudioParamBroadcast = useCallback(() => {
    studioParamDebounceTimerRef.current = null;
    const peer = peerRef.current;
    const patch = { ...studioParamPendingPatchRef.current };
    studioParamPendingPatchRef.current = {};
    if (Object.keys(patch).length === 0) return;
    if (!peer || peer.destroyed || peer.connected !== true) return;
    studioRevisionRef.current += 1;
    const payload: StudioParamMessage = {
      type: "STUDIO_PARAM",
      originatorId: localJamSetupOwnerId,
      studioRevision: studioRevisionRef.current,
      patch,
    };
    try {
      peer.send(JSON.stringify(payload));
    } catch {
      /* coalesce — next edit will re-send merged patch */
    }
  }, [localJamSetupOwnerId]);

  const broadcastStudioParam = useCallback((partial: StudioParamMessage["patch"]) => {
    studioParamPendingPatchRef.current = {
      ...studioParamPendingPatchRef.current,
      ...partial,
    };
    if (studioParamDebounceTimerRef.current !== null) {
      window.clearTimeout(studioParamDebounceTimerRef.current);
    }
    studioParamDebounceTimerRef.current = window.setTimeout(() => {
      flushStudioParamBroadcast();
    }, 24);
  }, [flushStudioParamBroadcast]);

  const broadcastWizardStudioParam = useCallback(
    (partial: StudioParamMessage["patch"]) => {
      if (kiteSetupOrigin !== "connected") return;
      broadcastStudioParam(partial);
    },
    [broadcastStudioParam, kiteSetupOrigin]
  );

  /**
   * Send P2P timing metadata to the connected peer so both sides can agree on the
   * interval clock before the P2P engine starts. Does NOT trigger chunk transfer.
   */
  const sendSetInterval = useCallback((
    timing: KiteIntervalTiming,
    hasRetainedLoop: boolean,
    options?: { igniteP2PEngine?: boolean }
  ): void => {
    const peer = peerRef.current;
    if (!peer || peer.destroyed || peer.connected !== true) return;
    const clockAnchorSec = studioAudioContextRef.current?.currentTime ?? 0;
    const payload: {
      type: "SET_INTERVAL";
      timing: KiteIntervalTiming;
      clockAnchorSec: number;
      hasRetainedLoop: boolean;
      igniteP2PEngine?: boolean;
    } = {
      type: "SET_INTERVAL",
      timing,
      clockAnchorSec,
      hasRetainedLoop,
    };
    if (options?.igniteP2PEngine === true) {
      payload.igniteP2PEngine = true;
    }
    try {
      peer.send(JSON.stringify(payload));
      console.log("[SET_INTERVAL] sent", { bpm: timing.bpm, bpi: timing.bpi, clockAnchorSec, hasRetainedLoop });
    } catch {
      console.warn("[SET_INTERVAL] send failed — peer channel not ready");
    }
  }, []);

  /**
   * Apply incoming SET_INTERVAL timing to local setup state so the guest's UI
   * and math mirror the host's configuration. Does not send anything over the network.
   */
  const applySetIntervalLocally = useCallback((
    timing: KiteIntervalTiming,
    clockAnchorSec: number,
    hasRetainedLoop: boolean,
  ): void => {
    setKiteSetupTempo(Math.max(20, Math.min(320, Math.round(timing.bpm))));
    setKiteSetupTimeSignatureTop(Math.max(1, Math.min(16, Math.round(timing.timeSignatureTop))));
    setKiteSetupTimeSignatureBottom(Math.max(1, Math.min(32, Math.round(timing.timeSignatureBottom))));
    setKiteSetupChordCount(Math.max(1, Math.min(64, Math.round(timing.chords))));
    setBeatsPerInterval(Math.round(timing.bpi));
    setMetronomeBpm(timing.bpm);
    console.log("[SET_INTERVAL] local timing synced from host", {
      bpm: timing.bpm,
      chords: timing.chords,
      timeSignatureTop: timing.timeSignatureTop,
      timeSignatureBottom: timing.timeSignatureBottom,
      clockAnchorSec,
      hasRetainedLoop,
    });
  }, []);

  /**
   * Send the retained loop buffer to the peer as binary LOAD_INTERVAL chunks.
   * The retained loop is intentionally preserved on any failure so the caller
   * can trigger a fresh attempt via `retryRetainedLoopSyncRef`.
   */
  const sendRetainedLoopChunks = useCallback(async (): Promise<void> => {
    const retained = retainedKiteLoopBufferRef.current;
    if (!retained) return;

    const peer = peerRef.current;
    if (!peer || peer.destroyed || peer.connected !== true) {
      console.warn("[sendRetainedLoopChunks] peer not ready — retained loop preserved for retry");
      return;
    }

    const dataChannel = (peer as unknown as { _channel?: RTCDataChannel })._channel;
    if (!dataChannel || dataChannel.readyState !== "open") {
      console.warn("[sendRetainedLoopChunks] data channel not open — retained loop preserved for retry");
      return;
    }

    // Abort any in-progress send before starting a new one.
    kiteLoopSendAbortControllerRef.current?.abort("Replacing with new send attempt");
    const abortController = new AbortController();
    kiteLoopSendAbortControllerRef.current = abortController;

    let chunks: ReturnType<typeof createLoadIntervalChunks>;
    try {
      chunks = createLoadIntervalChunks({
        sessionId: sessionId ?? "kite",
        intervalId: retained.intervalId,
        origin: role ?? "host",
        channelCount: retained.channelCount,
        sampleRate: retained.sampleRate,
        intervalFrames: retained.intervalFrames,
        buffer: retained.buffer,
      });
    } catch (err) {
      console.error("[sendRetainedLoopChunks] failed to slice retained loop into chunks:", err);
      return; // Retained loop is preserved; caller can retry.
    }
    kiteLoopChunksRef.current = chunks;

    // Create a fresh sender bound to the current data channel.
    kiteLoopChunkSenderRef.current = new KiteDataChannelChunkSender(dataChannel);

    // Register a retry closure before attempting the send so callers can trigger
    // a fresh attempt if this one fails or the peer reconnects.
    retryRetainedLoopSyncRef.current = () => { void sendRetainedLoopChunks(); };

    try {
      await kiteLoopChunkSenderRef.current.sendChunks(chunks, { signal: abortController.signal });
      retryRetainedLoopSyncRef.current = null;
      console.log(
        "[sendRetainedLoopChunks] sent",
        chunks.length,
        "chunks for intervalId",
        retained.intervalId,
      );
    } catch (err) {
      if (abortController.signal.aborted) return; // Aborted intentionally — retained loop is preserved.
      console.error("[sendRetainedLoopChunks] send failed — retained loop preserved for retry:", err);
      // Intentionally do NOT clear retainedKiteLoopBufferRef.current here.
    }
  }, [sessionId, role]);

  /**
   * Parallel output branch for precision click-track playback.
   * This path is isolated from remote stream and local recorder chains.
   */
  const ensureMetronomeGainNode = useCallback((ctx: AudioContext): GainNode => {
    let node = metronomeGainRef.current;
    if (!node) {
      node = ctx.createGain();
      node.gain.value = metronomeVolumeRef.current;
      node.connect(ctx.destination);
      metronomeGainRef.current = node;
    }
    return node;
  }, []);

  const playMetronomeClick = useCallback(
    (
      ctx: AudioContext,
      time: number,
      tick: MetronomeTick,
      masterGainNode?: GainNode | null,
      forceAudio?: boolean
    ) => {
      if (!ctx || ctx.state === "closed") return;
      if (ctx.state !== "running") return;
      const halSec =
        audioBaseLatencySecRef.current + audioOutputLatencySecRef.current;
      const compensated = time - halSec;
      const startAt = Math.max(compensated, ctx.currentTime);
      metronomeBlinkQueueRef.current.push({ startAt, isAccent: tick.isAccent });
      if (metronomeBlinkQueueRef.current.length > 20) metronomeBlinkQueueRef.current.shift();
      const shouldPlayAudio = forceAudio || !isVisualMetronomeOnlyRef.current;
      if (shouldPlayAudio) {
        const osc = ctx.createOscillator();
        const durationSec = 0.1;
        const stopAt = startAt + durationSec;
        osc.type = "sine";
        const beatsPerBar = Math.max(1, Math.min(16, Math.round(kiteSetupTimeSignatureTop)));
        const frequency =
          tick.beatIndex === 0 ? 1760 : tick.beatIndex % beatsPerBar === 0 ? 880 : 440;
        osc.frequency.setValueAtTime(frequency, startAt);
        const targetNode = masterGainNode || ctx.destination;
        osc.connect(targetNode);
        osc.start(startAt);
        osc.stop(stopAt);
        osc.addEventListener("ended", () => {
          try {
            osc.disconnect();
          } catch {
            /* ignore */
          }
        });
      }
    },
    [kiteSetupTimeSignatureTop]
  );

  const resetKiteSyncSessionRefs = useCallback(() => {
    if (studioParamDebounceTimerRef.current !== null) {
      window.clearTimeout(studioParamDebounceTimerRef.current);
      studioParamDebounceTimerRef.current = null;
    }
    studioParamPendingPatchRef.current = {};
    pendingKiteSyncRef.current = null;
    lastAcceptedKiteSyncSeqRef.current = 0;
    kiteSyncSequenceRef.current = 0;
    syncInitiatorIdRef.current = null;
    if (mountedRef.current) {
      setSyncInitiatorId(null);
    }
    studioRevisionRef.current = 0;
    lastAcceptedStudioRevisionRef.current = 0;
    lastAppliedGuestStartSecRef.current = null;
    lastSyncApplyAtMsRef.current = null;
    audioBaseLatencySecRef.current = 0;
    audioOutputLatencySecRef.current = 0;
    kiteGridAnchorContextSecRef.current = null;
  }, []);

  const stopKiteMetronome = useCallback(() => {
    if (metronomeBlinkRafIdRef.current !== null) {
      cancelAnimationFrame(metronomeBlinkRafIdRef.current);
    }
    metronomeBlinkRafIdRef.current = null;
    metronomeBlinkQueueRef.current = [];
    metronomePumpRef.current?.teardown();
    metronomePumpRef.current = null;
    metronomeSchedulerRef.current?.stop();
    metronomeSchedulerRef.current = null;
    const gain = metronomeGainRef.current;
    const ctx = studioAudioContextRef.current;
    if (gain && ctx && ctx.state !== "closed") {
      try {
        gain.gain.cancelScheduledValues(ctx.currentTime);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const applyKiteSyncPacketLossGuard = useCallback(
    (packetLossPercent: number | null) => {
      if (!kiteSyncEnabled) {
        kiteSyncLossRecoverySinceMsRef.current = null;
        if (kiteSyncLossPauseActiveRef.current) {
          kiteSyncLossPauseActiveRef.current = false;
          setKiteSyncNetworkMetronomePaused(false);
        }
        return;
      }
      if (packetLossPercent === null) {
        kiteSyncLossRecoverySinceMsRef.current = null;
        return;
      }
      if (packetLossPercent > KITE_SYNC_LOSS_PAUSE_PCT) {
        kiteSyncLossRecoverySinceMsRef.current = null;
        if (!kiteSyncLossPauseActiveRef.current) {
          kiteSyncLossPauseActiveRef.current = true;
          stopKiteMetronome();
          setKiteSyncNetworkMetronomePaused(true);
        }
        return;
      }
      if (!kiteSyncLossPauseActiveRef.current) {
        kiteSyncLossRecoverySinceMsRef.current = null;
        return;
      }
      if (packetLossPercent >= KITE_SYNC_LOSS_RESUME_PCT) {
        kiteSyncLossRecoverySinceMsRef.current = null;
        return;
      }
      const now = performance.now();
      if (kiteSyncLossRecoverySinceMsRef.current === null) {
        kiteSyncLossRecoverySinceMsRef.current = now;
        return;
      }
      if (now - kiteSyncLossRecoverySinceMsRef.current >= KITE_SYNC_LOSS_STABLE_MS) {
        kiteSyncLossPauseActiveRef.current = false;
        kiteSyncLossRecoverySinceMsRef.current = null;
        setKiteSyncNetworkMetronomePaused(false);
        setKiteSyncMetronomeResumeNonce((n) => n + 1);
      }
    },
    [kiteSyncEnabled, stopKiteMetronome]
  );

  applyKiteSyncLossGuardRef.current = applyKiteSyncPacketLossGuard;

  const teardownKiteSyncTransport = useCallback(() => {
    stopKiteMetronome();
    setBroadcastStatus("idle");
    kiteSyncCountInCompletionHandledRef.current = false;
    kiteSyncCountInActiveRef.current = false;
    kiteSyncCountInEndAtContextSecRef.current = 0;
    kiteSyncLossPauseActiveRef.current = false;
    kiteSyncLossRecoverySinceMsRef.current = null;
    if (mountedRef.current) {
      setKiteSyncCountInActive(false);
      setKiteSyncNetworkMetronomePaused(false);
    }
    resetKiteSyncSessionRefs();
  }, [stopKiteMetronome, resetKiteSyncSessionRefs]);

  useEffect(() => {
    const gainNode = metronomeGainRef.current;
    if (!gainNode) return;
    if (kiteSyncCountInActive) return;
    gainNode.gain.value = metronomeVolumeRef.current;
  }, [kiteSyncCountInActive]);

  useEffect(() => {
    let cancelled = false;
    console.log("Metronome Effect running. Enabled:", kiteSyncEnabled, "BroadcastStatus:", broadcastStatus, "Context Ready:", audioContextReady);
    if (!kiteSyncEnabled || (broadcastStatus !== "syncing" && broadcastStatus !== "live")) {
      stopKiteMetronome();
      return undefined;
    }
    if (kiteSyncLossPauseActiveRef.current) {
      stopKiteMetronome();
      return undefined;
    }
    if (!audioContextReady) {
      stopKiteMetronome();
      return undefined;
    }

    const ctx = studioAudioContextRef.current ?? ensureStudioAudioContext();
    if (!ctx) return undefined;
    if (!metronomeGainRef.current) {
      console.log("Metronome gain ref null, attempting to ensure node...");
      ensureMetronomeGainNode(ctx);
    }
    if (!metronomeGainRef.current) return undefined;
    if (ctx.state !== "running") {
      stopKiteMetronome();
      return undefined;
    }
    if (metronomePumpRef.current !== null && metronomeSchedulerRef.current) return undefined;

    const localStartAtSec = ctx.currentTime + 0.01;
    let startAtSec = localStartAtSec;
    if (role !== "host") {
      const target = lastAppliedGuestStartSecRef.current;
      if (typeof target === "number" && Number.isFinite(target)) {
        const sixteenthSec = (60 / metronomeBpm) / 4;
        if (Number.isFinite(sixteenthSec) && sixteenthSec > 0 && target < ctx.currentTime) {
          startAtSec =
            target +
            Math.ceil((ctx.currentTime - target) / sixteenthSec) * sixteenthSec;
        } else {
          startAtSec = target;
        }
        console.log("Guest Scheduler Starting at:", startAtSec, "Snapped:", startAtSec !== target);
      }
    }

    const timing =
      latestKiteIntervalTimingRef.current ?? kiteIntervalTimingRef.current;
    const schedulerBpi = Math.max(1, Math.round(timing?.bpi ?? beatsPerInterval));

    const scheduler = createMetronomeScheduler(ctx, {
      bpm: metronomeBpm,
      beatsPerInterval: schedulerBpi,
      subdivision: 1,
      lookaheadMs: 25,
      scheduleAheadSec: 0.12,
      startAtSec,
      isExternalSync: role !=="host",
    });
    scheduler.start();
    const blinkTick = () => {
      const blinkCtx = studioAudioContextRef.current;
      if (!blinkCtx || blinkCtx.state === "closed") return;
      const now = blinkCtx.currentTime;
      const queue = metronomeBlinkQueueRef.current;

      while (queue.length > 0 && queue[0].startAt <= now) {
        const beat = queue.shift();
        const el = metronomeBlinkElementRef.current;
        if (beat && el) {
          el.classList.remove(
            "bg-emerald-400",
            "scale-125",
            "bg-emerald-600/60",
            "scale-110",
            "shadow-[0_0_8px_rgba(52,211,153,0.8)]"
          );
          void el.offsetWidth;
          if (beat.isAccent) {
            el.classList.add(
              "bg-emerald-400",
              "scale-125",
              "shadow-[0_0_8px_rgba(52,211,153,0.8)]"
            );
          } else {
            el.classList.add("bg-emerald-600/60", "scale-110");
          }
          window.setTimeout(() => {
            if (metronomeBlinkElementRef.current) {
              metronomeBlinkElementRef.current.classList.remove(
                "bg-emerald-400",
                "scale-125",
                "bg-emerald-600/60",
                "scale-110",
                "shadow-[0_0_8px_rgba(52,211,153,0.8)]"
              );
            }
          }, 100);
        }
      }
      metronomeBlinkRafIdRef.current = requestAnimationFrame(blinkTick);
    };
    metronomeBlinkRafIdRef.current = requestAnimationFrame(blinkTick);
    metronomeSchedulerRef.current = scheduler;
    if (metronomeGainRef.current) {
      metronomeGainRef.current.gain.value = metronomeVolumeRef.current;
      console.log("Metronome gain set to:", metronomeVolumeRef.current);
    }

    const pumpScheduler = () => {
      if (studioAudioContextRef.current?.state === "closed") {
        console.warn("⚠️ AudioContext was closed. Re-initializing...");
        ensureStudioAudioContext();
      }
      const activeScheduler = metronomeSchedulerRef.current;
      const activeCtx = studioAudioContextRef.current;
      if (!activeScheduler || !activeCtx || activeCtx.state !== "running") return;
      const nowSec = activeCtx.currentTime;
      const ticks = activeScheduler.consumeDueTicks(nowSec);
      const isCountIn =
        broadcastStatusRef.current === "syncing" ||
        (kiteSyncCountInEndAtContextSecRef.current !== null &&
          activeCtx.currentTime < kiteSyncCountInEndAtContextSecRef.current);
      for (const tick of ticks) {
        playMetronomeClick(activeCtx, tick.atSec, tick, metronomeGainRef.current, isCountIn);
      }

      if (
        kiteSyncCountInActiveRef.current &&
        !kiteSyncCountInCompletionHandledRef.current
      ) {
        const endAt = kiteSyncCountInEndAtContextSecRef.current;
        if (Number.isFinite(endAt) && endAt > 0 && activeCtx.currentTime >= endAt) {
          kiteSyncCountInCompletionHandledRef.current = true;
          kiteSyncCountInActiveRef.current = false;
          setKiteSyncCountInActive(false);
          if (kiteSyncEnabledRef.current) {
            broadcastStatusRef.current = "live";
            setBroadcastStatus("live");
          }
          if (metronomeGainRef.current) {
            metronomeGainRef.current.gain.value = metronomeVolumeRef.current;
          }
          const anchorSec = activeCtx.currentTime;
          kiteGridAnchorContextSecRef.current = anchorSec;
          if (anchorSec != null && Number.isFinite(anchorSec)) {
            kiteP2PEngineRef.current?.alignPhase(anchorSec);
          }
        }
      }
    };

    pumpScheduler();

    void (async () => {
      try {
        if (cancelled || ctx.state !== "running") return;
        const pump = await createMetronomePump(ctx, {
          pumpIntervalSec: scheduler.getLookaheadMs() / 1000,
        });
        if (cancelled || studioAudioContextRef.current?.state !== "running") {
          pump.teardown();
          return;
        }
        metronomePumpRef.current = pump;
        pump.start(() => {
          pumpScheduler();
        });
      } catch (err) {
        console.error("[Metronome] AudioWorklet pump failed:", err);
      }
    })();

    return () => {
      cancelled = true;
      stopKiteMetronome();
    };
  }, [
    beatsPerInterval,
    broadcastStatus,
    kiteSyncEnabled,
    metronomeBpm,
    role,
    ensureStudioAudioContext,
    ensureMetronomeGainNode,
    playMetronomeClick,
    audioContextReady,
    metronomeGainRef.current,
    stopKiteMetronome,
    kiteSyncMetronomeResumeNonce,
  ]);

  useEffect(() => {
    return () => {
      stopKiteMetronome();
    };
  }, [stopKiteMetronome]);

  useEffect(() => {
    if (kiteSyncEnabled) return;
    kiteSyncLossPauseActiveRef.current = false;
    kiteSyncLossRecoverySinceMsRef.current = null;
    setKiteSyncNetworkMetronomePaused(false);
    resetKiteSyncSessionRefs();
  }, [kiteSyncEnabled, resetKiteSyncSessionRefs]);

  const clearRecordedBlobUrl = useCallback(() => {
    setRecordedBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setRecordedDownloadExt("webm");
  }, []);

  const startRecordingTimer = useCallback((recorder: TrackRecorder) => {
    clearRecordingInterval();
    setRecordingTimeMs(0);
    recordingIntervalRef.current = window.setInterval(() => {
      setRecordingTimeMs(Math.max(0, Math.floor(performance.now() - recorder.getTimestamp())));
    }, 1000);
  }, [clearRecordingInterval]);

  const startLocalRecording = useCallback(() => {
    if (isRecording) return;
    const localStream = localStreamRef.current ?? localMicStream;
    if (!localStream) return;

    try {
      const recorder = new TrackRecorder();
      recorder.start(localStream);
      localRecorderRef.current = recorder;
      clearRecordedBlobUrl();
      startRecordingTimer(recorder);
      setIsRecording(true);
    } catch (err) {
      console.error("Failed to start local recording:", err);
      clearRecordingInterval();
      setIsRecording(false);
    }
  }, [
    clearRecordedBlobUrl,
    clearRecordingInterval,
    isRecording,
    localMicStream,
    startRecordingTimer,
  ]);

  const stopLocalRecording = useCallback(async () => {
    const recorder = localRecorderRef.current;
    if (!recorder) return;
    clearRecordingInterval();
    localRecorderRef.current = null;
    try {
      const ext = recorder.getDownloadExtension();
      const blob = await recorder.stop();
      setRecordedBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
      setRecordedDownloadExt(ext);
    } catch (err) {
      console.error("Failed to stop local recording:", err);
    } finally {
      setIsRecording(false);
    }
  }, [clearRecordedBlobUrl, clearRecordingInterval]);

  const downloadSoloSessionBlob = useCallback((blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kite-loop-session-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }, []);

  const stopSoloSessionRecording = useCallback(async () => {
    const recorder = soloSessionMediaRecorderRef.current;
    if (!recorder) return;
    soloSessionMediaRecorderRef.current = null;
    setSoloSessionRecorderState("saving");
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        const chunks = soloSessionChunksRef.current;
        const handleStop = (): void => {
          recorder.removeEventListener("stop", handleStop);
          recorder.removeEventListener("error", handleError as EventListener);
          const mime = recorder.mimeType?.trim() || "video/webm";
          resolve(new Blob(chunks, { type: mime }));
        };
        const handleError = (event: Event): void => {
          recorder.removeEventListener("stop", handleStop);
          recorder.removeEventListener("error", handleError as EventListener);
          const target = event as Event & { error?: DOMException };
          reject(target.error ?? new Error("MediaRecorder failed."));
        };
        recorder.addEventListener("stop", handleStop);
        recorder.addEventListener("error", handleError as EventListener);
        if (recorder.state === "inactive") {
          handleStop();
          return;
        }
        recorder.stop();
      });
      if (blob.size > 0) {
        downloadSoloSessionBlob(blob, "webm");
      }
    } catch (err) {
      console.error("[Solo session recorder] Failed to stop:", err);
    } finally {
      stopSoloSessionDisplayTracks(soloSessionDisplayStreamRef);
      soloSessionChunksRef.current = [];
      setSoloSessionRecorderState("idle");
    }
  }, [downloadSoloSessionBlob]);

  const clearJamSetupLockTimer = useCallback(() => {
    if (jamSetupLockTimerRef.current !== null) {
      window.clearTimeout(jamSetupLockTimerRef.current);
      jamSetupLockTimerRef.current = null;
    }
  }, []);

  const scheduleJamSetupLockExpiry = useCallback(
    (expiresAt: number) => {
      clearJamSetupLockTimer();
      const delayMs = expiresAt - Date.now();
      if (!Number.isFinite(delayMs) || delayMs <= 0) {
        jamSetupLockExpiresAtRef.current = null;
        setJamSetupLock(null);
        return;
      }
      jamSetupLockExpiresAtRef.current = expiresAt;
      jamSetupLockTimerRef.current = window.setTimeout(() => {
        jamSetupLockTimerRef.current = null;
        jamSetupLockExpiresAtRef.current = null;
        jamSetupLockTokenRef.current = null;
        setJamSetupLock(null);
      }, delayMs);
    },
    [clearJamSetupLockTimer]
  );

  const sendJamSetupLock = useCallback(
    (action: JamSetupLockAction): boolean => {
      const peer = peerRef.current;
      if (!peer || !peer.connected) return false;

      const ownerId = localJamSetupOwnerId;
      const ownerName = localJamSetupOwnerName;
      const expiresAt = action === "acquire" ? Date.now() + 60000 : undefined;
      const payload: JamSetupLockMessage = {
        type: "JAM_SETUP_LOCK",
        action,
        ownerId,
        ownerName,
        expiresAt,
      };

      try {
        peer.send(JSON.stringify(payload));
      } catch {
        return false;
      }

      if (action === "acquire" && expiresAt) {
        jamSetupLockTokenRef.current = ownerId;
        setJamSetupLock({ ownerId, ownerName, expiresAt });
        scheduleJamSetupLockExpiry(expiresAt);
      } else {
        clearJamSetupLockTimer();
        jamSetupLockTokenRef.current = null;
        jamSetupLockExpiresAtRef.current = null;
        setJamSetupLock(null);
      }

      return true;
    },
    [clearJamSetupLockTimer, localJamSetupOwnerId, localJamSetupOwnerName, scheduleJamSetupLockExpiry]
  );

  const clearSoloRunwayDisplay = useCallback(() => {
    if (soloRunwayGoClearTimerRef.current !== null) {
      clearTimeout(soloRunwayGoClearTimerRef.current);
      soloRunwayGoClearTimerRef.current = null;
    }
    setSoloRunwayDisplay(null);
    setVisualActiveBeatInBar(null);
  }, []);

  const teardownSoloCountInPump = useCallback(() => {
    soloCountInPumpGenerationRef.current += 1;
    soloCountInPumpRef.current?.teardown();
    soloCountInPumpRef.current = null;
    soloCountInEndAtContextSecRef.current = 0;
    soloCountInBeatSecRef.current = 0;
    clearSoloRunwayDisplay();
  }, [clearSoloRunwayDisplay]);

  const cleanupKiteEngine = useCallback(
    ({
      stopLocalTracks = false,
      isFull = false,
      preserveTiming = false,
      preserveSoloSessionRecording = false,
    }: {
      stopLocalTracks?: boolean;
      isFull?: boolean;
      preserveTiming?: boolean;
      preserveSoloSessionRecording?: boolean;
    } = {}) => {
      // ── Solo engine ──────────────────────────────────────────────────────────
      hasCapturedFirstKiteLoopRef.current = false;
      soloLooperStateRef.current = "idle";
      if (loopProgressRafRef.current !== null) {
        cancelAnimationFrame(loopProgressRafRef.current);
        loopProgressRafRef.current = null;
      }
      if (!preserveSoloSessionRecording) {
        void stopSoloSessionRecording();
      }
      teardownSoloCountInPump();
      if (!preserveTiming) {
        kiteIntervalTimingRef.current = null;
      }
      isMasterPausedRef.current = false;
      setSoloLooperState("idle");
      setIsMasterPaused(false);
      setLoopProgress(0);
      isRecordingArmedRef.current = false;
      setIsRecordingArmed(false);
      setRecordingArmedCountdown(null);
      if (!preserveSoloSessionRecording) {
        setKiteMode("live");
      }

      // ── P2P engine ───────────────────────────────────────────────────────────
      kiteP2PEngineRef.current?.teardown();
      kiteP2PEngineRef.current = null;
      p2pGridPumpGenerationRef.current += 1;
      kiteP2PGridPumpRef.current?.teardown();
      kiteP2PGridPumpRef.current = null;
      kiteP2PSequenceRef.current = 0;
      if (queuedRemoteKiteIntervalTimeoutRef.current !== null) {
        clearTimeout(queuedRemoteKiteIntervalTimeoutRef.current);
        queuedRemoteKiteIntervalTimeoutRef.current = null;
      }
      queuedRemoteKiteIntervalRef.current.length = 0;
      p2pGridNextBoundaryContextSecRef.current = null;
      p2pGridIntervalIndexRef.current = 0;

      // ── Chunk transfer ───────────────────────────────────────────────────────
      kiteLoopSendAbortControllerRef.current?.abort();
      kiteLoopSendAbortControllerRef.current = null;
      kiteLoopChunksRef.current = null;
      kiteLoopChunkSenderRef.current = null;
      kiteLoopReassemblerRef.current = null;
      setLoopChunkSendError(null);
      setLoopChunkSendProgress({ status: "idle", sentChunks: 0, totalChunks: 0 });

      // ── Full cleanup only ────────────────────────────────────────────────────
      if (isFull) {
        retainedKiteLoopBufferRef.current = null;
        retainedRemoteKiteLoopRef.current = null;
        lastRetainedKiteIntervalIdRef.current = null;
        lastRetainedKiteSequenceRef.current = null;
        retryRetainedLoopSyncRef.current = null;

        // Restore the outbound WebRTC audio sender from the muted Kite clone back
        // to the original live mic track. Only do this on full cleanup — partial
        // Solo-to-P2P transition cleanup must never accidentally restore VoIP.
        if (voipSenderMutedForKiteRef.current) {
          const peer = peerRef.current as (Peer.Instance & { replaceTrack?: (o: MediaStreamTrack, n: MediaStreamTrack, s: MediaStream) => void }) | null;
          const original = originalVoipSenderTrackRef.current;
          const clone = mutedVoipCloneTrackRef.current;
          const stream = localStreamRef.current;
          if (peer && typeof peer.replaceTrack === "function" && original && clone && stream) {
            try {
              peer.replaceTrack(clone, original, stream);
            } catch {
              // Peer may already be destroyed; restoration is best-effort.
            }
          }
          voipSenderMutedForKiteRef.current = false;
          originalVoipSenderTrackRef.current = null;
          mutedVoipCloneTrackRef.current = null;
        }

        // Disconnect all interface live monitor graphs. Partial Solo-to-P2P
        // transition cleanup must leave these running so the user continues to
        // hear hardware interface inputs during the mode switch.
        teardownAllInterfaceLiveMonitorGraphs();
      }

      if (stopLocalTracks) {
        const stoppedTrackIds = new Set<string>();
        stopMediaStreamTracks(localStreamRef.current, stoppedTrackIds);
        stopMediaStreamTracks(localMicStreamRef.current, stoppedTrackIds);
        localStreamRef.current = null;
        localMicStreamRef.current = null;
        setLocalMicStream(null);
      }
    },
    [
      stopMediaStreamTracks,
      stopSoloSessionRecording,
      teardownAllInterfaceLiveMonitorGraphs,
      teardownSoloCountInPump,
    ]
  );

  const handleStartKiteSetup = useCallback(
    (origin: KiteSetupOrigin) => {
      setKiteSetupStep(1);
      setKiteSetupTimeSignatureTop(4);
      setKiteSetupTimeSignatureBottom(4);
      setKiteSetupIsSwing(false);
      setKiteSetupChordCount(4);
      setKiteSetupUsesCustomChords(false);
      setKiteSetupTempo(metronomeBpm);
      setKiteSetupOrigin(origin);
      setKiteSetupMode(origin === "lobby" ? "solo" : "sync");
      setKiteSetupError(null);
      setStudioUiPhase("kite-setup");
    },
    [metronomeBpm]
  );

  const handleCancelKiteSetup = useCallback(() => {
    if (kiteSetupOrigin === "connected") {
      sendJamSetupLock("release");
      setStudioUiPhase("studio");
      return;
    }
    setStudioUiPhase("lobby");
    cleanupKiteEngine({ stopLocalTracks: true, isFull: true });
  }, [cleanupKiteEngine, kiteSetupOrigin, sendJamSetupLock]);

  const goToNextKiteSetupStep = useCallback(() => {
    setKiteSetupStep((step) => (step < 5 ? ((step + 1) as KiteSetupStep) : step));
  }, []);

  const goToPreviousKiteSetupStep = useCallback(() => {
    setKiteSetupStep((step) => (step > 1 ? ((step - 1) as KiteSetupStep) : step));
  }, []);

  const handleTapBeat = useCallback(() => {
    const now = performance.now();
    const taps = tapBeatTimestampsRef.current;
    const lastTap = taps[taps.length - 1] ?? 0;

    if (now - lastTap > 2000) {
      tapBeatTimestampsRef.current = [now];
      return;
    }

    const recentTaps = [...taps, now].slice(-8);
    tapBeatTimestampsRef.current = recentTaps;
    if (recentTaps.length < 4) return;

    const intervals = recentTaps.slice(1).map((tap, index) => tap - recentTaps[index]);
    const avgMs = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    if (!Number.isFinite(avgMs) || avgMs <= 0) return;

    const nextBpm = Math.round(60000 / avgMs);
    const clamped = Math.max(40, Math.min(240, nextBpm));
    setKiteSetupTempo(clamped);
    broadcastWizardStudioParam({ kiteSetupTempo: clamped, bpm: clamped });
  }, [broadcastWizardStudioParam]);

  const deriveKiteTimingMetadata = useCallback(
    (opts?: { overrideBpm?: number }): KiteIntervalTiming => {
      const localSampleRate = getStudioKiteSampleRate();
      const bpm = Math.max(
        20,
        Math.min(320, Math.round(opts?.overrideBpm ?? kiteSetupTempo))
      );
      const chords = Math.max(1, Math.min(64, Math.round(kiteSetupChordCount)));
      const beatsPerBar = Math.max(1, Math.min(16, Math.round(kiteSetupTimeSignatureTop)));
      const bpi = chords * beatsPerBar;
      const loopDurationSeconds = calcLoopDurationSeconds(bpm, bpi);
      const localIntervalFrames = calcIntervalFrames(loopDurationSeconds, localSampleRate);

      const timing: KiteIntervalTiming = {
        bpm,
        chords,
        beatsPerBar,
        timeSignatureTop: beatsPerBar,
        timeSignatureBottom: Math.max(1, Math.min(32, Math.round(kiteSetupTimeSignatureBottom))),
        bpi,
        loopDurationSeconds,
        intervalMs: loopDurationSeconds * 1000,
        hostSampleRate: localSampleRate,
        hostIntervalFrames: localIntervalFrames,
        localSampleRate,
        localIntervalFrames,
      };
      kiteIntervalTimingRef.current = timing;
      setBeatsPerInterval(bpi);
      setMetronomeBpm(bpm);
      return timing;
    },
  [
    getStudioKiteSampleRate,
    kiteSetupChordCount,
    kiteSetupTempo,
    kiteSetupTimeSignatureBottom,
    kiteSetupTimeSignatureTop,
  ]);

  const playSoloMetronomeClick = useCallback(
    (isDownbeat: boolean, startAtContextSec?: number, forceAudio?: boolean) => {
      const ctx = studioAudioContextRef.current;
      if (!ctx || ctx.state === "closed") return;

      const startAt = Math.max(ctx.currentTime, startAtContextSec ?? ctx.currentTime);

      const shouldPlayAudio =
        ctx.state === "running" && (forceAudio || !isVisualMetronomeOnlyRef.current);
      if (shouldPlayAudio) {
        const metronomeParent = ensureMetronomeGainNode(ctx);
        const countInLocksBroadcastSilence = kiteSyncCountInActiveRef.current;
        const bypassMetronomeGain =
          Boolean(forceAudio) && countInLocksBroadcastSilence;
        const metronomeVol = metronomeVolumeRef.current;

        const oscillator = ctx.createOscillator();
        scheduledMetronomeOscillatorsRef.current.add(oscillator);
        const gain = ctx.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(isDownbeat ? 1600 : 1050, startAt);
        const peakBase = isDownbeat ? 0.11 : 0.07;
        const peakEnv = bypassMetronomeGain ? peakBase * metronomeVol : peakBase;
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(peakEnv, startAt + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.045);
        oscillator.connect(gain);
        if (bypassMetronomeGain) {
          gain.connect(ctx.destination);
        } else {
          gain.connect(metronomeParent);
        }
        oscillator.start(startAt);
        oscillator.stop(startAt + 0.05);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
          scheduledMetronomeOscillatorsRef.current.delete(oscillator);
        };
      }
    },
    [ensureMetronomeGainNode]
  );

  const cancelScheduledMetronomeClicks = useCallback(() => {
    scheduledMetronomeOscillatorsRef.current.forEach(oscillator => {
      try {
        oscillator.stop();
        oscillator.disconnect();
      } catch (e) {
        // Oscillator may have already stopped/disconnected
      }
    });
    scheduledMetronomeOscillatorsRef.current.clear();

    setVisualActiveBeatInBar(null);
  }, []);

  const resolveSoloLooperInputStream = useCallback(
    (
      destinationNode: MediaStreamAudioDestinationNode
    ): { inputStream: MediaStream | null; masterStream: MediaStream } => {
      const masterStream = mixerMasterDestinationRef.current?.stream ?? destinationNode.stream;
      let inputStream: MediaStream | null = null;
      for (const deviceId of activeDeviceIdsRef.current) {
        const stream = activeStreamsMapRef.current.get(deviceId) ?? null;
        const hasLiveAudioTrack = stream
          ? stream.getAudioTracks().some((track) => track.readyState === "live")
          : false;
        if (hasLiveAudioTrack) {
          inputStream = stream;
          break;
        }
      }
      if (!inputStream) {
        const fallbackMic = localMicStreamRef.current;
        const fallbackOk =
          fallbackMic &&
          fallbackMic !== masterStream &&
          fallbackMic !== destinationNode.stream &&
          fallbackMic.getAudioTracks().some((track) => track.readyState === "live");
        inputStream = fallbackOk ? fallbackMic : null;
      }
      return { inputStream, masterStream };
    },
    []
  );

  const handleSoloLooperEvent = useCallback(
    (event: SoloLooperEngineEvent, ctx: AudioContext) => {
      const intervalId = soloLooperEventIntervalIdRef.current ?? `${sessionId ?? "solo"}-bootstrap`;
      const sequenceNumber = soloLooperEventSequenceNumberRef.current;
      if (event.type === "PLAYBACK_UI_STATE") {
        if (!mountedRef.current) return;
        const sanitizedSlots = event.slots.map((slot) => {
          if (
            slot.mode === "recording" &&
            soloLooperActiveRecordTrackIndexRef.current !== slot.trackIndex
          ) {
            return {
              ...slot,
              mode: slot.trackIndex === 1 ? "captured" : "playing",
            };
          }
          return slot;
        });
        soloTrackSlotUiLatestRef.current = sanitizedSlots;
        setSoloTrackSlotUi(sanitizedSlots);
        return;
      }
      if (event.type === "LOOP_STATE") {
        if (!mountedRef.current) return;
        if (event.state === "PAUSED") {
          isMasterPausedRef.current = true;
          setIsMasterPaused(true);
          return;
        }
        if (event.state === "RESUMED") {
          isMasterPausedRef.current = false;
          setIsMasterPaused(false);
          return;
        }
        if (event.state === "TRACK_RESET") {
          if (event.trackIndex === 1) {
            hasCapturedFirstKiteLoopRef.current = false;
            masterLoopIntervalFramesRef.current = null;
            setSoloMasterLoopFrames(null);
            setLoopProgress(0);
            soloLooperStateRef.current = "idle";
            setSoloLooperState("idle");
          }
          if (soloOverdubArmedTrackIndexRef.current === event.trackIndex || event.trackIndex === 1) {
            soloOverdubArmedTrackIndexRef.current = null;
            setSoloOverdubArmedTrackIndex(null);
          }
          soloLooperActiveRecordTrackIndexRef.current = null;
          soloLooperLoopFinalizePendingRef.current = false;
          return;
        }
        return;
      }
      if (event.type === "OVERDUB_ARMED") {
        if (!mountedRef.current) return;
        soloOverdubArmedTrackIndexRef.current = event.trackIndex;
        setSoloOverdubArmedTrackIndex(event.trackIndex);
        return;
      }
      if (event.type === "OVERDUB_ARM_REJECTED") {
        if (!mountedRef.current) return;
        if (event.reason === "master_not_playing_at_finalize") {
          console.warn(
            "[Solo looper] Overdub finalize rejected: master not playing at phase lock."
          );
          soloLooperLoopFinalizePendingRef.current = false;
          soloOverdubArmedTrackIndexRef.current = null;
          setSoloOverdubArmedTrackIndex(null);
        }
        return;
      }
      if (event.type === "CONFIGURE_REJECTED") {
        if (!mountedRef.current) return;
        console.warn(
          "[Solo looper] Configure rejected:",
          event.reason,
          event.trackIndex ?? "(no track)"
        );
        soloLooperLoopFinalizePendingRef.current = false;
        soloOverdubArmedTrackIndexRef.current = null;
        setSoloOverdubArmedTrackIndex(null);
        return;
      }
      if (event.type === "OVERDUB_STARTED") {
        if (!mountedRef.current) return;
        soloLooperEngineRef.current?.stopAudibleMetronome();
        soloOverdubArmedTrackIndexRef.current = null;
        setSoloOverdubArmedTrackIndex(null);
        soloLooperActiveRecordTrackIndexRef.current = event.trackIndex;
        soloLooperStateRef.current = "recording";
        setSoloLooperState("recording");
        return;
      }
      if (event.type === "OVERDUB_DISARMED") {
        if (!mountedRef.current) return;
        if (soloOverdubArmedTrackIndexRef.current === event.trackIndex) {
          soloOverdubArmedTrackIndexRef.current = null;
          setSoloOverdubArmedTrackIndex(null);
        }
        return;
      }
      if (event.type === "AUTO_STOP_COMPLETED") {
        if (!mountedRef.current) return;
        soloLooperActiveRecordTrackIndexRef.current = null;
        soloLooperEngineRef.current?.stopAudibleMetronome();
        cancelScheduledMetronomeClicks();
        if (event.trackIndex === 1) {
          setLoopProgress(100);
          soloLooperStateRef.current = "captured";
          setSoloLooperState("captured");
        }
        setSoloTrackSlotUi((prev) => {
          const next = prev
            ? prev.map((slot) =>
                slot.trackIndex === event.trackIndex
                  ? {
                      ...slot,
                      mode: event.trackIndex === 1 ? "captured" : "playing",
                    }
                  : slot
              )
            : prev;
          soloTrackSlotUiLatestRef.current = next;
          return next;
        });
        return;
      }
      if (event.type === "CALIBRATION_RESULT") {
        if (!mountedRef.current) return;
        if (event.latencyFrames === null) {
          setSoloLatencyCalibrationStatus("error");
          setSoloLatencyCalibrationMessage("No input response detected. Increase speaker level and try again.");
          return;
        }
        const resultSampleRate =
          Number.isFinite(ctx.sampleRate) && ctx.sampleRate > 0 ? ctx.sampleRate : 44100;
        const measuredMs = Math.round((event.latencyFrames / resultSampleRate) * 1000);
        const hardwareOutputMs = Math.round(((ctx.outputLatency || ctx.baseLatency || 0) * 1000));
        const trueOverdubMs = Math.max(0, measuredMs - hardwareOutputMs);
        const clampedMs = clampSoloLatencyMs(trueOverdubMs);
        console.log(
          `Latency Calibrated | RTL: ${measuredMs}ms | Output Drop: ${hardwareOutputMs}ms | Applied Overdub Latency: ${clampedMs}ms`
        );
        soloLooperLatencyMsRef.current = clampedMs;
        setSoloLooperLatencyMs(clampedMs);
        setSoloLatencyCalibrationStatus("success");
        setSoloLatencyCalibrationMessage(`RTL ${measuredMs} ms, applied overdub latency ${clampedMs} ms.`);
        return;
      }
      if (event.type !== "LOOP_READY") return;
      soloLooperLoopFinalizePendingRef.current = false;
      soloLooperActiveRecordTrackIndexRef.current = null;
      if (soloLooperStateRef.current !== "recording") return;
      const ti = event.trackIndex ?? 1;

      if (ti === 1) {
        if (hasCapturedFirstKiteLoopRef.current) return;
        hasCapturedFirstKiteLoopRef.current = true;
        masterLoopIntervalFramesRef.current = event.intervalFrames;
        setSoloMasterLoopFrames(event.intervalFrames);
        const retainedIntervalId = event.loopId ?? intervalId;
        const retainedSequenceNumber = sequenceNumber;
        const retainedBuffer = event.buffer.slice(0);
        retainedKiteLoopBufferRef.current = {
          intervalId: retainedIntervalId,
          sequenceNumber: retainedSequenceNumber,
          sampleRate: event.sampleRate,
          intervalFrames: event.intervalFrames,
          channelCount: event.channelCount,
          buffer: retainedBuffer,
        };
        lastRetainedKiteIntervalIdRef.current = retainedIntervalId;
        lastRetainedKiteSequenceRef.current = retainedSequenceNumber;
      }

      if (loopProgressRafRef.current !== null) {
        cancelAnimationFrame(loopProgressRafRef.current);
        loopProgressRafRef.current = null;
      }
      setLoopProgress(100);
      soloLooperEngineRef.current?.stopAudibleMetronome();
      cancelScheduledMetronomeClicks();
      soloLooperStateRef.current = "captured";
      setSoloLooperState("captured");
    },
    [cancelScheduledMetronomeClicks, sessionId]
  );

  const ensureSoloLooperEngineBootstrapped = useCallback(async (): Promise<SoloLooperEngine> => {
    const ctx = ensureStudioAudioContext();
    await ctx.resume();
    if (ctx.state !== "running") {
      setAudioContextReady(false);
      throw new Error("AudioContext is not running. Use Resume Audio or Enter Studio first.");
    }
    setAudioContextReady(true);

    const destinationNode = ensureMasterDestinationNode();
    if (!destinationNode) {
      throw new Error("Kite Sync output destination is unavailable.");
    }

    const { inputStream, masterStream } = resolveSoloLooperInputStream(destinationNode);
    if (!inputStream || inputStream.getAudioTracks().length === 0) {
      throw new Error("Raw microphone stream is unavailable for session recording.");
    }
    if (inputStream === destinationNode.stream || inputStream === masterStream) {
      throw new Error("Session recording input must be raw mic audio, not the master mix.");
    }

    const existing = soloLooperEngineRef.current;
    if (existing) {
      return existing;
    }

    const localSr = Math.round(ctx.sampleRate);
    const maxProvisionFrames = Math.max(1, Math.floor(localSr * 60));
    const bootstrapIntervalId = `${sessionId ?? "solo"}-bootstrap-${Date.now()}`;
    const bootstrapSequenceNumber = (lastRetainedKiteSequenceRef.current ?? 0) + 1;
    const engine = await buildSoloLooperEngine({
      audioContext: ctx,
      inputStream,
      destinationNode,
      timing: {
        localSampleRate: localSr,
        localIntervalFrames: maxProvisionFrames,
      },
      loopId: bootstrapIntervalId,
      trackIndex: 1,
      channelCount: 2,
      monitorDestination: ctx.destination,
      monitorGain: 1,
      onEvent: (event) => handleSoloLooperEvent(event, ctx),
    });
    soloLooperEngineRef.current = engine;
    soloLooperEventIntervalIdRef.current = bootstrapIntervalId;
    soloLooperEventSequenceNumberRef.current = bootstrapSequenceNumber;
    return engine;
  }, [
    ensureMasterDestinationNode,
    ensureStudioAudioContext,
    handleSoloLooperEvent,
    resolveSoloLooperInputStream,
    sessionId,
  ]);

  const startSoloSessionRecording = useCallback(async () => {
    if (soloSessionMediaRecorderRef.current) return;

    let displayStream: MediaStream;
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 30 } },
        audio: false,
      });
    } catch (err) {
      console.warn("[Solo session recorder] Display capture cancelled or denied:", err);
      return;
    }

    soloSessionDisplayStreamRef.current = displayStream;

    try {
      const engine = await ensureSoloLooperEngineBootstrapped();
      const stationStream = engine.getSessionStationMixStream();
      if (stationStream.getAudioTracks().length === 0) {
        throw new Error("Loop-station audio stream is unavailable.");
      }

      const combinedStream = new MediaStream([
        ...displayStream.getVideoTracks(),
        ...stationStream.getAudioTracks(),
      ]);

      soloSessionChunksRef.current = [];
      const recorderOptions = selectSessionVideoMediaRecorderOptions();
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(combinedStream, recorderOptions);
      } catch (primaryErr) {
        try {
          const { mimeType } = recorderOptions;
          recorder = new MediaRecorder(
            combinedStream,
            mimeType ? { mimeType } : {}
          );
        } catch {
          try {
            recorder = new MediaRecorder(combinedStream);
          } catch (fallbackErr) {
            throw primaryErr instanceof Error ? primaryErr : fallbackErr;
          }
        }
      }

      recorder.ondataavailable = (event: BlobEvent): void => {
        if (event.data.size > 0) {
          soloSessionChunksRef.current.push(event.data);
        }
      };

      soloSessionMediaRecorderRef.current = recorder;
      recorder.start(1000);

      if (isMasterPausedRef.current) {
        recorder.pause();
        setSoloSessionRecorderState("paused");
      } else {
        setSoloSessionRecorderState("recording");
      }
    } catch (err) {
      console.error("[Solo session recorder] Failed to start:", err);
      stopSoloSessionDisplayTracks(soloSessionDisplayStreamRef);
      soloSessionMediaRecorderRef.current = null;
      soloSessionChunksRef.current = [];
      setSoloSessionRecorderState("idle");
    }
  }, [ensureSoloLooperEngineBootstrapped]);

  const handleToggleSoloSessionRecording = useCallback(() => {
    if (soloSessionMediaRecorderRef.current) {
      void stopSoloSessionRecording();
      return;
    }
    void startSoloSessionRecording();
  }, [startSoloSessionRecording, stopSoloSessionRecording]);

  const startSoloLooper = useCallback(
    async (
      timing: KiteIntervalTiming,
      options?: { recordStartContextSec?: number }
    ): Promise<void> => {
      const ctx = ensureStudioAudioContext();
      await ctx.resume();
      if (ctx.state !== "running") {
        setAudioContextReady(false);
        throw new Error("AudioContext could not be started for Kite Sync.");
      }
      setAudioContextReady(true);

      const destinationNode = ensureMasterDestinationNode();
      if (!destinationNode) {
        throw new Error("Kite Sync output destination is unavailable.");
      }

      const { inputStream, masterStream } = resolveSoloLooperInputStream(destinationNode);
      if (!inputStream || inputStream.getAudioTracks().length === 0) {
        throw new Error("Raw microphone stream is unavailable for Kite Sync.");
      }
      if (inputStream === destinationNode.stream || inputStream === masterStream) {
        throw new Error("Kite Sync input must be raw mic audio, not the master mix.");
      }

      const MAX_SOLO_TRACK_RAM_SECONDS = 60;
      const localSr = Math.round(ctx.sampleRate);
      const maxProvisionFrames = Math.max(1, Math.floor(localSr * MAX_SOLO_TRACK_RAM_SECONDS));
      const provisionalLoopDurationSec = maxProvisionFrames / localSr;
      const engineTiming: KiteIntervalTiming = {
        ...timing,
        localSampleRate: localSr,
        hostSampleRate: localSr,
        loopDurationSeconds: provisionalLoopDurationSec,
        intervalMs: provisionalLoopDurationSec * 1000,
        localIntervalFrames: maxProvisionFrames,
        hostIntervalFrames: maxProvisionFrames,
      };

      const intervalId = `${sessionId ?? "solo"}-${Date.now()}`;
      soloLooperLiveLoopIdRef.current = intervalId;
      const sequenceNumber = (lastRetainedKiteSequenceRef.current ?? 0) + 1;
      let engine = soloLooperEngineRef.current;
      if (!engine) {
        engine = await buildSoloLooperEngine({
          audioContext: ctx,
          inputStream,
          destinationNode,
          timing: engineTiming,
          loopId: intervalId,
          trackIndex: 1,
          channelCount: 2,
          monitorDestination: ctx.destination,
          monitorGain: 1,
          onEvent: (event) => handleSoloLooperEvent(event, ctx),
        });
        soloLooperEngineRef.current = engine;
      }
      soloLooperEventIntervalIdRef.current = intervalId;
      soloLooperEventSequenceNumberRef.current = sequenceNumber;

      /** Re-provision Track 1 after RESET_TRACK wipes slots (`intervalFrames` must be > 0 before START_RECORDING). */
      engine.selectTrack(1);
      engine.configureLoop({
        intervalFrames: maxProvisionFrames,
        sampleRate: localSr,
        channelCount: 2,
        loopId: intervalId,
        trackIndex: 1,
      });

      isMasterPausedRef.current = false;
      setIsMasterPaused(false);
      soloMetronomeAnchorContextSecRef.current =
        options?.recordStartContextSec !== undefined && Number.isFinite(options.recordStartContextSec)
          ? options.recordStartContextSec
          : ctx.currentTime;
      for (let t = 1; t <= 4; t += 1) {
        engine.setTrackGain(t, soloTrackVolumesRef.current[t - 1]);
      }

      const buildStartRecordingParams = () => {
        const startSampleRate = Number.isFinite(ctx.sampleRate) && ctx.sampleRate > 0
          ? ctx.sampleRate
          : 44100;
        const latencyOffsetFrames = Math.max(
          0,
          Math.round((soloLooperLatencyMsRef.current / 1000) * startSampleRate)
        );
        let targetLengthFrames: number | undefined;
        if (soloLooperModeRef.current === "grid") {
          const timingSnapshot = kiteIntervalTimingRef.current;
          const bpm = Math.max(
            1,
            Math.round(timingSnapshot?.bpm ?? kiteSetupTempoRef.current ?? 120)
          );
          const beatsPerBar = Math.max(
            1,
            Math.round(
              timingSnapshot?.beatsPerBar ??
                timingSnapshot?.timeSignatureTop ??
                kiteSetupTimeSignatureTopRef.current ??
                4
            )
          );
          const barCount = Math.max(1, Math.round(soloLooperBarCountRef.current || 1));
          const secondsPerBeat = 60 / bpm;
          const totalSeconds = secondsPerBeat * beatsPerBar * barCount;
          targetLengthFrames = Math.max(1, Math.round(totalSeconds * startSampleRate));
        }

        return {
          loopMode: soloLooperModeRef.current,
          latencyOffsetFrames,
          ...(targetLengthFrames !== undefined ? { targetLengthFrames } : {}),
        };
      };

      const recordStartAt = options?.recordStartContextSec;
      if (recordStartAt !== undefined && Number.isFinite(recordStartAt)) {
        const delayMs = Math.max(0, (recordStartAt - ctx.currentTime) * 1000);
        if (delayMs <= 0) {
          soloLooperActiveRecordTrackIndexRef.current = 1;
          if (!isVisualMetronomeOnlyRef.current) {
            engine.startAudibleMetronome(timing.bpm);
          }
          engine.startRecording(buildStartRecordingParams());
        } else {
          window.setTimeout(() => {
            if (soloLooperEngineRef.current === engine) {
              soloLooperActiveRecordTrackIndexRef.current = 1;
              if (!isVisualMetronomeOnlyRef.current) {
                engine.startAudibleMetronome(timing.bpm);
              }
              engine.startRecording(buildStartRecordingParams());
            }
          }, delayMs);
        }
      } else {
        soloLooperActiveRecordTrackIndexRef.current = 1;
        if (!isVisualMetronomeOnlyRef.current) {
          engine.startAudibleMetronome(timing.bpm);
        }
        engine.startRecording(buildStartRecordingParams());
      }

      if (loopProgressRafRef.current !== null) {
        cancelAnimationFrame(loopProgressRafRef.current);
      }
      const intervalMs = (engineTiming.localIntervalFrames / engineTiming.localSampleRate) * 1000;
      const startedAt = performance.now();
      const animateProgress = () => {
        if (soloLooperStateRef.current !== "recording") {
          loopProgressRafRef.current = null;
          return;
        }
        const elapsedMs = performance.now() - startedAt;
        const currentTick = Math.min(intervalMs, Math.max(0, elapsedMs));
        setLoopProgress(Math.min(100, Math.max(0, (currentTick / intervalMs) * 100)));
        if (elapsedMs < intervalMs) {
          loopProgressRafRef.current = requestAnimationFrame(animateProgress);
        } else {
          loopProgressRafRef.current = null;
        }
      };
      animateProgress();
      setKiteMode(kiteSetupMode === "sync" ? "sync" : "solo");
    },
    [
      ensureMasterDestinationNode,
      ensureStudioAudioContext,
      handleSoloLooperEvent,
      kiteSetupMode,
      resolveSoloLooperInputStream,
      sessionId,
    ]
  );

  const restoreLiveVoipTrackAfterKite = useCallback(() => {
    if (voipSenderMutedForKiteRef.current) {
      const original = originalVoipSenderTrackRef.current;
      const clone = mutedVoipCloneTrackRef.current;
      const stream = localStreamRef.current;
      if (original && clone && stream) {
        replacePeerAudioTrack(clone, original, stream, stream);
        try {
          clone.stop();
        } catch {
          /* ignore */
        }
      }
      voipSenderMutedForKiteRef.current = false;
      originalVoipSenderTrackRef.current = null;
      mutedVoipCloneTrackRef.current = null;
    }
  }, [replacePeerAudioTrack]);

  useEffect(() => {
    hostExitKiteBroadcastOnPeerDisconnectRef.current = () => {
      if (!mountedRef.current) return;
      restoreLiveVoipTrackAfterKite();
      cleanupKiteEngine({ stopLocalTracks: false, isFull: false });
      const rs = remoteStreamRef.current;
      if (rs) buildRemotePlaybackGraph(rs);
      setKiteSyncEnabled(false);
      setBroadcastStatus("idle");
      setKiteSyncCountInActive(false);
    };
  }, [buildRemotePlaybackGraph, cleanupKiteEngine, restoreLiveVoipTrackAfterKite]);

  const advanceP2PGridBoundaries = useCallback((periodSec: number) => {
    const ctxNow = studioAudioContextRef.current;
    if (!ctxNow || ctxNow.state === "closed") return;
    if (!Number.isFinite(periodSec) || periodSec <= 0) return;

    let nextBoundary = p2pGridNextBoundaryContextSecRef.current;
    if (nextBoundary == null || !Number.isFinite(nextBoundary)) {
      p2pGridNextBoundaryContextSecRef.current = ctxNow.currentTime + periodSec;
      return;
    }

    const eps = ctxNow.sampleRate > 0 ? 2 / ctxNow.sampleRate : 0.00005;

    while (ctxNow.currentTime + eps >= nextBoundary) {
      p2pGridIntervalIndexRef.current += 1;
      const tickSeq = p2pGridIntervalIndexRef.current;

      const fifo = queuedRemoteKiteIntervalRef.current;
      const peeked = fifo.length > 0 ? fifo[0] : null;
      if (peeked && kiteP2PEngineRef.current) {
        fifo.shift();
        kiteP2PEngineRef.current.loadInterval({
          intervalId: peeked.intervalId,
          intervalFrames: peeked.intervalFrames,
          channelCount: peeked.channelCount,
          sampleRate: peeked.sampleRate,
          buffer: peeked.payload,
        });
        console.log(
          "[P2P TICK] loaded remote interval",
          peeked.intervalId,
          "tickSeq",
          tickSeq,
          "fifoRemaining",
          fifo.length
        );
      } else if (tickSeq > 1) {
        console.warn(
          "[P2P TICK] no remote interval queued at tickSeq",
          tickSeq,
          "— remote audio may be late or dropped"
        );
      }

      if (queuedRemoteKiteIntervalTimeoutRef.current !== null) {
        clearTimeout(queuedRemoteKiteIntervalTimeoutRef.current);
        queuedRemoteKiteIntervalTimeoutRef.current = null;
      }
      const intervalDurationMs = periodSec * 1000;
      queuedRemoteKiteIntervalTimeoutRef.current = window.setTimeout(() => {
        queuedRemoteKiteIntervalTimeoutRef.current = null;
        if (queuedRemoteKiteIntervalRef.current.length === 0) {
          console.warn(
            "[P2P TIMEOUT] remote interval deadline missed after tickSeq",
            tickSeq,
            "— packet may be lost or network is slow"
          );
        }
      }, intervalDurationMs) as unknown as number;

      nextBoundary += periodSec;
    }
    p2pGridNextBoundaryContextSecRef.current = nextBoundary;
  }, []);

  const startP2PIntervalScheduler = useCallback(
    (timing: KiteIntervalTiming) => {
      p2pGridPumpGenerationRef.current += 1;
      const gen = p2pGridPumpGenerationRef.current;
      kiteP2PGridPumpRef.current?.teardown();
      kiteP2PGridPumpRef.current = null;

      const periodSec = timing.localIntervalFrames / timing.localSampleRate;
      const ctxInit = studioAudioContextRef.current;
      if (
        ctxInit &&
        ctxInit.state !== "closed" &&
        Number.isFinite(periodSec) &&
        periodSec > 0
      ) {
        p2pGridNextBoundaryContextSecRef.current = ctxInit.currentTime + periodSec;
      } else {
        p2pGridNextBoundaryContextSecRef.current = null;
        console.warn(
          "[P2P SCHEDULER] AudioContext missing/closed or invalid loop period; grid will arm on first pulse when context is ready."
        );
      }
      p2pGridIntervalIndexRef.current = 0;

      const ctx = studioAudioContextRef.current;
      if (!ctx || ctx.state === "closed" || ctx.state !== "running") {
        console.warn(
          "[P2P GRID PUMP] AudioContext is not running; grid pump not started. Resume audio first."
        );
        return;
      }

      void (async () => {
        try {
          const pump = await createMetronomePump(ctx, { pumpIntervalSec: 0.01 });
          if (
            gen !== p2pGridPumpGenerationRef.current ||
            studioAudioContextRef.current?.state !== "running"
          ) {
            pump.teardown();
            return;
          }
          kiteP2PGridPumpRef.current = pump;
          pump.start(() => {
            advanceP2PGridBoundaries(periodSec);
          });
        } catch (err) {
          console.error("[P2P GRID PUMP] AudioWorklet pump failed:", err);
        }
      })();
    },
    [advanceP2PGridBoundaries]
  );

  useEffect(() => {
    startP2PIntervalSchedulerRef.current = startP2PIntervalScheduler;
  }, [startP2PIntervalScheduler]);

  const handleStartBroadcastCountIn = useCallback(() => {
    void (async () => {
      const ctx = studioAudioContextRef.current ?? ensureStudioAudioContext();
      await ctx.resume();
      if (ctx.state !== "running") {
        setAudioContextReady(false);
        return;
      }
      setAudioContextReady(true);

      flushAndSetRemoteGridTarget(ctx.currentTime + 0.01);

      const countInOneBarSec =
        (60 / metronomeBpm) * Math.max(1, Math.round(kiteSetupTimeSignatureTop));
      if (!Number.isFinite(countInOneBarSec) || countInOneBarSec <= 0) {
        return;
      }

      kiteSyncCountInEndAtContextSecRef.current = ctx.currentTime + countInOneBarSec;
      if (metronomeGainRef.current) {
        metronomeGainRef.current.gain.value = 0;
      }
      setKiteSyncCountInActive(true);
      kiteSyncCountInActiveRef.current = true;
      kiteSyncCountInCompletionHandledRef.current = false;

      setKiteSyncEnabled(true);
      setBroadcastStatus("syncing");
      syncInitiatorIdRef.current = localJamSetupOwnerId;
      if (mountedRef.current) {
        setSyncInitiatorId(localJamSetupOwnerId);
      }
      broadcastKiteSync({ kiteSyncEnabled: true });

      const timing =
        latestKiteIntervalTimingRef.current ?? kiteIntervalTimingRef.current;
      if (timing) {
        startP2PIntervalSchedulerRef.current?.(timing);
      } else {
        console.warn("[Kite] Host scheduler ignite skipped — no timing ref");
      }
    })();
  }, [
    broadcastKiteSync,
    ensureStudioAudioContext,
    flushAndSetRemoteGridTarget,
    kiteSetupTimeSignatureTop,
    localJamSetupOwnerId,
    metronomeBpm,
    setAudioContextReady,
    setBroadcastStatus,
    setKiteSyncCountInActive,
    setKiteSyncEnabled,
  ]);

  const startP2PEngine = useCallback(
    async (timing: KiteIntervalTiming): Promise<void> => {
      const ctx = ensureStudioAudioContext();
      await ctx.resume();
      if (ctx.state !== "running") {
        setAudioContextReady(false);
        throw new Error("AudioContext could not be started for P2P engine.");
      }
      setAudioContextReady(true);

      const destinationNode = ensureMasterDestinationNode();
      if (!destinationNode) {
        throw new Error("P2P engine output destination is unavailable.");
      }

      const masterStream = mixerMasterDestinationRef.current?.stream ?? destinationNode.stream;
      const tapStream = mixerKiteTapStreamRef.current;
      const tapOk =
        tapStream &&
        tapStream.getAudioTracks().length > 0 &&
        tapStream !== masterStream &&
        tapStream !== destinationNode.stream;
      const fallbackMic = localMicStreamRef.current;
      const fallbackOk =
        fallbackMic &&
        fallbackMic.getAudioTracks().length > 0 &&
        fallbackMic !== masterStream &&
        fallbackMic !== destinationNode.stream;

      // Prefer the Kite tap (parallel bus to the master mix). Fall back only when the tap
      // stream is missing (e.g. pre-mixer single-device path). Never use the master stream
      // as capture input — it would close a feedback loop through the interval graph.
      const inputStream = (tapOk ? tapStream : null) ?? (fallbackOk ? fallbackMic : null);
      if (!inputStream || inputStream.getAudioTracks().length === 0) {
        throw new Error("P2P engine input is unavailable (no Kite tap or fallback mic).");
      }
      if (inputStream === destinationNode.stream || inputStream === masterStream) {
        throw new Error("P2P engine input must not be the VoIP master mix.");
      }

      // Tear down any existing P2P graph and worker before rebuilding.
      kiteP2PEngineRef.current?.teardown();
      kiteP2PEngineRef.current = null;
      p2pGridPumpGenerationRef.current += 1;
      kiteP2PGridPumpRef.current?.teardown();
      kiteP2PGridPumpRef.current = null;
      kiteP2PSequenceRef.current = 0;
      p2pGridNextBoundaryContextSecRef.current = null;
      p2pGridIntervalIndexRef.current = 0;
      if (queuedRemoteKiteIntervalTimeoutRef.current !== null) {
        clearTimeout(queuedRemoteKiteIntervalTimeoutRef.current);
        queuedRemoteKiteIntervalTimeoutRef.current = null;
      }
      queuedRemoteKiteIntervalRef.current.length = 0;

      const intervalId = `${sessionId ?? "p2p"}-p2p-${Date.now()}`;

      // Partner-only local monitor: worklet output is playback (remote intervals), not dry mic.
      // Interface live monitor is ducked separately while kiteModeRef === "broadcast".
      const inputLatencyMs = KITE_DEFAULT_INPUT_LATENCY_MS;
      const inputNudgeFrames = calcInputNudgeFrames(
        inputLatencyMs,
        timing.localSampleRate,
        timing.localIntervalFrames
      );
      const graph = await buildKiteIntervalGraph({
        audioContext: ctx,
        inputStreams: [{ id: "p2p-mic", stream: inputStream }],
        destinationNode,
        timing,
        intervalId,
        channelCount: 2,
        inputLatencyMs,
        monitorDestination: ctx.destination,
        monitorGain: 1,
        onEvent: (event) => {
          if (event.type !== "INTERVAL_READY") return;
          if (
            kiteModeRef.current !== "broadcast" ||
            broadcastStatusRef.current !== "live"
          ) {
            console.log(
              "[P2P INTERVAL_READY] skipped — need broadcast mode and live status (kiteMode:",
              kiteModeRef.current,
              "broadcastStatus:",
              broadcastStatusRef.current,
              ")"
            );
            return;
          }
          kiteP2PSequenceRef.current += 1;
          const outboundSeq = kiteP2PSequenceRef.current;
          const liveIntervalId = `p2p-live-${outboundSeq}`;
          console.log("[P2P INTERVAL_READY] seq", outboundSeq, "frames:", event.intervalFrames);

          const peer = peerRef.current;
          const dataChannel = (peer as unknown as { _channel?: RTCDataChannel })._channel;
          if (!peer || peer.destroyed || peer.connected !== true || !dataChannel || dataChannel.readyState !== "open") {
            console.warn("[P2P INTERVAL_READY] data channel not ready, dropping interval seq", outboundSeq);
            return;
          }

          void (async () => {
            try {
              const chunks = createLoadIntervalChunks({
                sessionId: sessionId ?? "p2p",
                intervalId: liveIntervalId,
                origin: role ?? "host",
                channelCount: event.channelCount,
                sampleRate: event.sampleRate,
                intervalFrames: event.intervalFrames,
                buffer: event.buffer,
              });
              const sender = new KiteDataChannelChunkSender(dataChannel);
              await sender.sendChunks(chunks);
              console.log("[P2P INTERVAL_READY] sent", chunks.length, "chunks for", liveIntervalId);
            } catch (err) {
              console.error("[P2P INTERVAL_READY] send failed for seq", outboundSeq, err);
            }
          })();
        },
      });
      kiteP2PEngineRef.current = graph;
      latestKiteIntervalTimingRef.current = timing;
      kiteModeRef.current = "broadcast";
      console.log("[P2P Engine] record input nudge", {
        inputLatencyMs,
        inputNudgeFrames,
        sampleRate: timing.localSampleRate,
        intervalFrames: timing.localIntervalFrames,
      });

      const voipStream = localStreamRef.current;
      const liveVoipTrack = voipStream?.getAudioTracks()[0] ?? null;
      if (liveVoipTrack && voipStream && !voipSenderMutedForKiteRef.current) {
        const mutedClone = liveVoipTrack.clone();
        mutedClone.enabled = false;
        const mutedStream = new MediaStream([mutedClone]);
        replacePeerAudioTrack(liveVoipTrack, mutedClone, voipStream, mutedStream);
        originalVoipSenderTrackRef.current = liveVoipTrack;
        mutedVoipCloneTrackRef.current = mutedClone;
        voipSenderMutedForKiteRef.current = true;
      }

      teardownRemotePlaybackGraph();

      setKiteMode("broadcast");
      console.log("[P2P Engine] prepared (scheduler not started)", { bpm: timing.bpm, bpi: timing.bpi, intervalId });
    },
    [
      ensureStudioAudioContext,
      ensureMasterDestinationNode,
      replacePeerAudioTrack,
      teardownRemotePlaybackGraph,
      sessionId,
      role,
    ]
  );

  useEffect(() => {
    startP2PEngineRef.current = startP2PEngine;
  }, [startP2PEngine]);

  const handleConfirmKiteSetup = useCallback(() => {
    void (async () => {
      try {
        setKiteSetupError(null);
        hasCapturedFirstKiteLoopRef.current = false;
        if (kiteModeRef.current !== "broadcast" && broadcastStatusRef.current !== "live") {
          retainedKiteLoopBufferRef.current = null;
          lastRetainedKiteIntervalIdRef.current = null;
        }
        soloLooperStateRef.current = "idle";
        isRecordingArmedRef.current = false;
        setIsRecordingArmed(false);
        setRecordingArmedCountdown(null);
        setSoloLooperState("idle");
        setKiteMode(kiteSetupMode === "sync" ? "broadcast" : "solo");
        setStudioUiPhase("studio");
        if (kiteSetupOrigin === "connected") {
          sendJamSetupLock("release");
        }
        if (kiteSetupMode === "sync") {
          const timing = deriveKiteTimingMetadata();
          void startP2PEngine(timing);
          try {
            sendSetInterval(timing, retainedKiteLoopBufferRef.current !== null, {
              igniteP2PEngine: true,
            });
          } catch {
            /* SET_INTERVAL notify peer is best-effort */
          }
          syncInitiatorIdRef.current = localJamSetupOwnerId;
          if (mountedRef.current) {
            setSyncInitiatorId(localJamSetupOwnerId);
          }
        } else if (kiteSetupMode === "solo") {
          deriveKiteTimingMetadata();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not start Kite Sync.";
        setKiteSetupError(message);
        soloLooperStateRef.current = "idle";
        isRecordingArmedRef.current = false;
        setIsRecordingArmed(false);
        setRecordingArmedCountdown(null);
        setSoloLooperState("idle");
      }
    })();
  }, [
    deriveKiteTimingMetadata,
    kiteSetupMode,
    kiteSetupOrigin,
    localJamSetupOwnerId,
    sendJamSetupLock,
    sendSetInterval,
    startP2PEngine,
  ]);

  const BroadcastDashboard = () => {
    const syncStatusLabel =
      broadcastStatus === "idle"
        ? "Ready"
        : kiteSyncCountInActive
          ? "Count-in"
          : broadcastStatus === "live"
            ? "Live"
            : "Starting";
    const phaseLabel =
      visualActiveBeatInBar === 0
        ? "Downbeat"
        : visualActiveBeatInBar !== null
          ? "Beat"
          : "—";

    const partnerSessionLabel =
      remoteParticipantName?.trim() || "Partner";
    const jamAnchorMessage =
      syncInitiatorId === localJamSetupOwnerId
        ? "You're leading this sync."
        : syncInitiatorId
          ? `Synced by ${partnerSessionLabel}`
          : "Active jam session";

    return (
      <div className="space-y-3 rounded-xl border border-stone-800/90 bg-stone-950/45 p-4">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-center">
          <p className="font-mono text-sm text-stone-100">
            <span className="text-stone-500">BPM</span>{" "}
            <span className="font-semibold tabular-nums">{metronomeBpm}</span>
          </p>
          <p className="font-mono text-sm text-stone-100">
            <span className="text-stone-500">Phase</span>{" "}
            <span className="font-semibold">{phaseLabel}</span>
          </p>
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">{syncStatusLabel}</p>
        </div>
        {canStartSync ? (
          <button
            type="button"
            onClick={handleStartBroadcastCountIn}
            className="w-full rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/15"
          >
            Start Count-In &amp; Jam
          </button>
        ) : null}
        {broadcastStatus !== "idle" || kiteSyncEnabled ? (
          <p className="text-center text-xs font-medium text-stone-400">{jamAnchorMessage}</p>
        ) : null}
        <button
          type="button"
          disabled={!canControlStop}
          aria-disabled={!canControlStop}
          onClick={() => {
            if (!canControlStop) return;
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
          }}
          className={`w-full rounded-xl border px-4 py-3 text-sm font-semibold transition ${
            canControlStop
              ? "border-orange-500/40 bg-orange-500/10 text-orange-200 hover:bg-orange-500/15"
              : "cursor-not-allowed border-stone-700/80 bg-stone-900/50 text-stone-500 opacity-60"
          }`}
        >
          Stop Kite Sync
        </button>
      </div>
    );
  };

  const handleRecordFirstLoop = useCallback(() => {
    if (
      isRecordingArmedRef.current ||
      soloLooperStateRef.current === "recording" ||
      isMasterPausedRef.current
    ) {
      return;
    }
    applyPedalFocus(1);
    isRecordingArmedRef.current = true;
    setIsRecordingArmed(true);

    void (async () => {
      try {
        const timing = deriveKiteTimingMetadata();
        const ctx = studioAudioContextRef.current ?? ensureStudioAudioContext();
        await ctx.resume();
        if (ctx.state !== "running") {
          setAudioContextReady(false);
          throw new Error("AudioContext is not running. Use Resume Audio or Enter Studio first.");
        }
        setAudioContextReady(true);

        cleanupKiteEngine({
          stopLocalTracks: false,
          preserveTiming: true,
          preserveSoloSessionRecording: true,
        });
        setKiteMode("solo");
        isRecordingArmedRef.current = true;
        setIsRecordingArmed(true);

        hasCapturedFirstKiteLoopRef.current = false;
        retainedKiteLoopBufferRef.current = null;
        lastRetainedKiteIntervalIdRef.current = null;
        masterLoopIntervalFramesRef.current = null;
        isMasterPausedRef.current = false;
        setIsMasterPaused(false);
        soloMetronomeAnchorContextSecRef.current = null;
        soloLooperActiveRecordTrackIndexRef.current = null;
        soloLooperLiveLoopIdRef.current = null;
        setSoloTrackSlotUi(null);
        soloTrackSlotUiLatestRef.current = null;
        isMasterPausedRef.current = false;
        setIsMasterPaused(false);
        soloMetronomeAnchorContextSecRef.current = null;
        setSoloTrackVolumes([1, 1, 1, 1]);
        setSoloMasterLoopFrames(null);
        applyPedalFocus(1);
        soloOverdubArmedTrackIndexRef.current = null;
        setSoloOverdubArmedTrackIndex(null);
        soloLooperStateRef.current = "idle";
        setSoloLooperState("idle");
        setLoopProgress(0);

        clearSoloRunwayDisplay();
        setRecordingArmedCountdown(3);

        soloCountInPumpGenerationRef.current += 1;
        const gen = soloCountInPumpGenerationRef.current;

        try {
          const pump = await startLooperRunway({
            audioContext: ctx,
            bpm: timing.bpm,
            beatCount: timing.beatsPerBar,
            isAlive: () => mountedRef.current && gen === soloCountInPumpGenerationRef.current,
            onBeat: (payload) => {
              if (!mountedRef.current || gen !== soloCountInPumpGenerationRef.current) return;

              if (soloRunwayGoClearTimerRef.current !== null) {
                clearTimeout(soloRunwayGoClearTimerRef.current);
                soloRunwayGoClearTimerRef.current = null;
              }

              setSoloRunwayDisplay(payload.displayLabel);
              if (payload.displayLabel === "3") {
                setVisualActiveBeatInBar(0);
              } else if (payload.displayLabel === "2") {
                setVisualActiveBeatInBar(1);
              } else if (payload.displayLabel === "1") {
                setVisualActiveBeatInBar(2);
              } else if (payload.displayLabel === "GO") {
                setVisualActiveBeatInBar(3);
              }

              if (payload.playClick) {
                playSoloMetronomeClick(payload.isGoBeat, payload.contextTime, true);
              }

              if (!payload.isGoBeat) {
                const count =
                  payload.displayLabel === "3"
                    ? 3
                    : payload.displayLabel === "2"
                      ? 2
                      : payload.displayLabel === "1"
                        ? 1
                        : null;
                if (count !== null) {
                  setRecordingArmedCountdown(count);
                }
                return;
              }

              void (async () => {
                // Safari guard: resume the AudioContext before computing the timing
                // anchor — Safari may have suspended it during the count-in beats.
                await ctx.resume();

                setRecordingArmedCountdown(null);
                soloLooperStateRef.current = "recording";
                setSoloLooperState("recording");
                soloLooperActiveRecordTrackIndexRef.current = 1;
                hasCapturedFirstKiteLoopRef.current = false;

                soloRunwayGoClearTimerRef.current = window.setTimeout(() => {
                  soloRunwayGoClearTimerRef.current = null;
                  if (!mountedRef.current || gen !== soloCountInPumpGenerationRef.current) return;
                  setSoloRunwayDisplay(null);
                }, 400);

                const beatDurationSeconds = 60 / Math.max(1, timing.bpm);
                const recordAnchorContextSec = payload.contextTime + beatDurationSeconds;

                // Snapshot BPM so commitActiveRecording uses the correct value at
                // stop time even if kiteIntervalTimingRef changes in grid mode.
                recordingStartBpmRef.current = timing.bpm;

                await startSoloLooper(timing, { recordStartContextSec: recordAnchorContextSec });
              })().catch((err) => {
                soloLooperStateRef.current = "idle";
                setSoloLooperState("idle");
                hasCapturedFirstKiteLoopRef.current = false;
                console.error("Solo looper failed to start:", err);
                setKiteSetupError(
                  err instanceof Error ? err.message : "Failed to start looper engine."
                );
              });
            },
            onRunwayEnd: () => {
              if (!mountedRef.current || gen !== soloCountInPumpGenerationRef.current) return;
              soloCountInPumpRef.current?.teardown();
              soloCountInPumpRef.current = null;
              isRecordingArmedRef.current = false;
              setIsRecordingArmed(false);
              setRecordingArmedCountdown(null);
            },
          });

          if (gen !== soloCountInPumpGenerationRef.current) {
            pump.teardown();
            isRecordingArmedRef.current = false;
            setIsRecordingArmed(false);
            setRecordingArmedCountdown(null);
            clearSoloRunwayDisplay();
            return;
          }
          if (studioAudioContextRef.current?.state !== "running") {
            pump.teardown();
            isRecordingArmedRef.current = false;
            setIsRecordingArmed(false);
            setRecordingArmedCountdown(null);
            clearSoloRunwayDisplay();
            return;
          }
          soloCountInPumpRef.current = pump;
        } catch (pumpErr) {
          console.error("[Solo runway] AudioWorklet pump failed:", pumpErr);
          teardownSoloCountInPump();
          isRecordingArmedRef.current = false;
          setIsRecordingArmed(false);
          setRecordingArmedCountdown(null);
          throw pumpErr;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not start recording.";
        setKiteSetupError(message);
        teardownSoloCountInPump();
        isRecordingArmedRef.current = false;
        setIsRecordingArmed(false);
        setRecordingArmedCountdown(null);
      }
    })();
  }, [
    cleanupKiteEngine,
    clearSoloRunwayDisplay,
    deriveKiteTimingMetadata,
    ensureStudioAudioContext,
    playSoloMetronomeClick,
    startSoloLooper,
    teardownSoloCountInPump,
    applyPedalFocus,
  ]);

  const handleAutoCalibrateSoloLatency = useCallback(async (_mode: "acoustic" | "interface") => {
    if (echoSafetyMode) {
      setSoloLatencyCalibrationStatus("warning");
      setSoloLatencyCalibrationMessage("Disable Echo Safety before auto-calibration.");
      return;
    }
    if (isRecordingArmedRef.current || soloLooperStateRef.current === "recording") {
      setSoloLatencyCalibrationStatus("error");
      setSoloLatencyCalibrationMessage("Stop recording/count-in before auto-calibration.");
      return;
    }

    try {
      if (!soloLooperEngineRef.current) {
        const ctx = ensureStudioAudioContext();
        await ctx.resume();
        if (ctx.state !== "running") {
          setAudioContextReady(false);
          setSoloLatencyCalibrationStatus("error");
          setSoloLatencyCalibrationMessage("Audio engine could not start.");
          return;
        }
        setAudioContextReady(true);
        const destinationNode = ensureMasterDestinationNode();
        if (!destinationNode) {
          setSoloLatencyCalibrationStatus("error");
          setSoloLatencyCalibrationMessage("Kite Sync output destination is unavailable.");
          return;
        }
        const { inputStream, masterStream } = resolveSoloLooperInputStream(destinationNode);
        if (!inputStream || inputStream.getAudioTracks().length === 0) {
          setSoloLatencyCalibrationStatus("error");
          setSoloLatencyCalibrationMessage("Microphone not connected.");
          return;
        }
        if (inputStream === destinationNode.stream || inputStream === masterStream) {
          setSoloLatencyCalibrationStatus("error");
          setSoloLatencyCalibrationMessage("Kite Sync input must be raw mic audio, not the master mix.");
          return;
        }
        const localSr = Math.round(ctx.sampleRate);
        const maxProvisionFrames = Math.max(1, Math.floor(localSr * 60));
        const bootstrapIntervalId = `${sessionId ?? "solo"}-bootstrap-${Date.now()}`;
        const bootstrapSequenceNumber = (lastRetainedKiteSequenceRef.current ?? 0) + 1;
        const engine = await buildSoloLooperEngine({
          audioContext: ctx,
          inputStream,
          destinationNode,
          timing: {
            localSampleRate: localSr,
            localIntervalFrames: maxProvisionFrames,
          },
          loopId: bootstrapIntervalId,
          trackIndex: 1,
          channelCount: 2,
          monitorDestination: ctx.destination,
          monitorGain: 1,
          onEvent: (event) => handleSoloLooperEvent(event, ctx),
        });
        soloLooperEngineRef.current = engine;
        soloLooperEventIntervalIdRef.current = bootstrapIntervalId;
        soloLooperEventSequenceNumberRef.current = bootstrapSequenceNumber;
      }
      setSoloLatencyCalibrationStatus("listening");
      setSoloLatencyCalibrationMessage("Listening for speaker-to-mic response...");
      soloLooperEngineRef.current.startCalibration();
    } catch (error) {
      setSoloLatencyCalibrationStatus("error");
      setSoloLatencyCalibrationMessage(
        error instanceof Error ? error.message : "Auto-calibration could not start."
      );
    }
  }, [
    echoSafetyMode,
    ensureMasterDestinationNode,
    ensureStudioAudioContext,
    handleSoloLooperEvent,
    resolveSoloLooperInputStream,
    sessionId,
  ]);

  const handleSoloLatencyMsChange = useCallback((value: number) => {
    setSoloLooperLatencyMs(clampSoloLatencyMs(value));
  }, []);

  const handleStopAndResetSoloLooper = useCallback(() => {
    cancelScheduledMetronomeClicks();
    soloLooperEngineRef.current?.stopAudibleMetronome();
    soloLooperEngineRef.current?.teardown();
    soloLooperEngineRef.current = null;
    cleanupKiteEngine({ stopLocalTracks: false });
    isRecordingArmedRef.current = false;
    setIsRecordingArmed(false);
    setRecordingArmedCountdown(null);
    clearSoloRunwayDisplay();
    masterLoopIntervalFramesRef.current = null;
    isMasterPausedRef.current = false;
    soloMetronomeAnchorContextSecRef.current = null;
    soloLooperActiveRecordTrackIndexRef.current = null;
    soloLooperLoopFinalizePendingRef.current = false;
    soloLooperLiveLoopIdRef.current = null;
    setSoloTrackSlotUi(null);
    soloTrackSlotUiLatestRef.current = null;
    setSoloTrackVolumes([1, 1, 1, 1]);
    setSoloMasterLoopFrames(null);
    applyPedalFocus(1);
    soloOverdubArmedTrackIndexRef.current = null;
    setSoloOverdubArmedTrackIndex(null);
    soloLooperStateRef.current = "idle";
    setSoloLooperState("idle");
    setIsMasterPaused(false);
    setLoopProgress(0);
    hasCapturedFirstKiteLoopRef.current = false;
    setKiteMode("solo");
  }, [applyPedalFocus, cancelScheduledMetronomeClicks, cleanupKiteEngine, clearSoloRunwayDisplay]);

  const handleSoloTrackVolumeChange = useCallback((trackIndex: 1 | 2 | 3 | 4, linear: number) => {
    const g = Math.max(0, Math.min(1, linear));
    setSoloTrackVolumes((prev) => {
      const next: [number, number, number, number] = [...prev] as [number, number, number, number];
      next[trackIndex - 1] = g;
      return next;
    });
    soloLooperEngineRef.current?.setTrackGain(trackIndex, g);
  }, []);

  const handleToggleMasterPause = useCallback(() => {
    const engine = soloLooperEngineRef.current;
    if (!engine) return;
    const nextPaused = !isMasterPausedRef.current;
    engine.setPaused(nextPaused);
    isMasterPausedRef.current = nextPaused;
    setIsMasterPaused(nextPaused);
    if (nextPaused) {
      engine.stopAudibleMetronome();
    } else if (
      !isVisualMetronomeOnlyRef.current &&
      soloLooperActiveRecordTrackIndexRef.current === 1 &&
      soloLooperStateRef.current === "recording"
    ) {
      engine.startAudibleMetronome(kiteIntervalTimingRef.current?.bpm || 120);
    }

    const recorder = soloSessionMediaRecorderRef.current;
    if (!recorder) return;
    if (nextPaused) {
      if (recorder.state === "recording") {
        recorder.pause();
      }
      setSoloSessionRecorderState("paused");
    } else {
      if (recorder.state === "paused") {
        recorder.resume();
      }
      setSoloSessionRecorderState("recording");
    }
  }, []);

  const handleResetSoloTrack = useCallback((trackIndex: 1 | 2 | 3 | 4) => {
    const engine = soloLooperEngineRef.current;
    if (!engine) return;
    const slot = soloTrackSlotUiLatestRef.current?.find((s) => s.trackIndex === trackIndex);
    if (slot?.mode === "recording") {
      const confirmed = window.confirm(`Reset Track ${trackIndex} while it is recording?`);
      if (!confirmed) return;
    }

    engine.resetTrack(trackIndex);
    if (trackIndex === 1) {
      engine.stopAudibleMetronome();
      hasCapturedFirstKiteLoopRef.current = false;
      masterLoopIntervalFramesRef.current = null;
      setSoloMasterLoopFrames(null);
      setLoopProgress(0);
      soloLooperStateRef.current = "idle";
      setSoloLooperState("idle");
      soloOverdubArmedTrackIndexRef.current = null;
      setSoloOverdubArmedTrackIndex(null);
      setSoloTrackSlotUi((prev) =>
        prev?.map((s) => ({
          ...s,
          mode: "idle",
          playbackCursor: 0,
          intervalFrames: 0,
          recordCursor: 0,
        })) ?? prev
      );
    } else {
      if (soloOverdubArmedTrackIndexRef.current === trackIndex) {
        soloOverdubArmedTrackIndexRef.current = null;
        setSoloOverdubArmedTrackIndex(null);
      }
      setSoloTrackSlotUi((prev) =>
        prev?.map((s) =>
          s.trackIndex === trackIndex
            ? { ...s, mode: "idle", playbackCursor: 0, intervalFrames: 0, recordCursor: 0 }
            : s
        ) ?? prev
      );
    }
  }, []);

  const handleArmSoloOverdubTrack = useCallback(
    (trackIndex: 2 | 3 | 4) => {
      void (async () => {
        const ctx = studioAudioContextRef.current ?? ensureStudioAudioContext();
        await ctx.resume();
        if (!mountedRef.current) return;
        const engine = soloLooperEngineRef.current;
        const master = masterLoopIntervalFramesRef.current;
        if (
          !engine ||
          ctx.state === "closed" ||
          ctx.state !== "running" ||
          master == null ||
          master <= 0
        ) {
          return;
        }
        if (
          isRecordingArmedRef.current ||
          soloLooperStateRef.current === "recording" ||
          isMasterPausedRef.current
        ) {
          return;
        }
        applyPedalFocus(trackIndex);
        const MAX_SOLO_TRACK_RAM_SECONDS = 60;
        const localSr = Number.isFinite(ctx.sampleRate) && ctx.sampleRate > 0
          ? ctx.sampleRate
          : 44100;
        const maxProvisionFrames = Math.max(1, Math.floor(localSr * MAX_SOLO_TRACK_RAM_SECONDS));
        const latencyOffsetFrames = Math.max(
          0,
          Math.round((soloLooperLatencyMsRef.current / 1000) * localSr)
        );
        engine.armOverdub({
          trackIndex,
          intervalFrames: maxProvisionFrames,
          channelCount: 2,
          latencyOffsetFrames,
          ...(soloLooperLiveLoopIdRef.current !== null
            ? { loopId: soloLooperLiveLoopIdRef.current }
            : {}),
        });
      })();
    },
    [applyPedalFocus, ensureStudioAudioContext]
  );

  const looperFootPedalArmed = kiteMode === "solo" && studioUiPhase === "studio";

  const commitActiveRecording = useCallback(() => {
    if (soloLooperStateRef.current !== "recording") {
      return;
    }
    if (soloLooperLoopFinalizePendingRef.current) {
      return;
    }
    if (isMasterPausedRef.current) {
      return;
    }
    const ctx = studioAudioContextRef.current;
    const engine = soloLooperEngineRef.current;
    if (!ctx || ctx.state === "closed" || !engine) {
      if (soloLooperStateRef.current === "recording") {
        return;
      }
      handleStopAndResetSoloLooper();
      return;
    }
    const rawActive = soloLooperActiveRecordTrackIndexRef.current;
    if (
      rawActive == null ||
      !Number.isFinite(rawActive) ||
      rawActive < 1 ||
      rawActive > 4
    ) {
      handleStopAndResetSoloLooper();
      return;
    }
    const activeTrackIndex = Math.floor(rawActive);
    const currentBpm = recordingStartBpmRef.current || 120;

    soloLooperActiveRecordTrackIndexRef.current = null;

    if (loopProgressRafRef.current !== null) {
      cancelAnimationFrame(loopProgressRafRef.current);
      loopProgressRafRef.current = null;
    }
    const loopId = soloLooperLiveLoopIdRef.current;
    soloLooperLoopFinalizePendingRef.current = true;
    if (activeTrackIndex === 1) {
      engine.stopAudibleMetronome();
    }
    const sampleRate = Number.isFinite(ctx.sampleRate) && ctx.sampleRate > 0
      ? ctx.sampleRate
      : 44100;
    const latencyOffsetFrames = Math.max(
      0,
      Math.round((soloLooperLatencyMsRef.current / 1000) * sampleRate)
    );
    engine.stopRecording({
      trackIndex: activeTrackIndex,
      bpm: currentBpm,
      channelCount: 2,
      latencyOffsetFrames,
      loopMode: soloLooperModeRef.current,
      ...(loopId !== null ? { loopId } : {}),
    });
  }, [handleStopAndResetSoloLooper]);

  const onLooperPedalDown = useCallback(
    (targetTrackIndex: number) => {
      if (soloLooperActiveRecordTrackIndexRef.current != null) {
        commitActiveRecording();
        return;
      }
      if (soloOverdubArmedTrackIndexRef.current != null) {
        const armed = soloOverdubArmedTrackIndexRef.current;
        if (armed >= 2 && armed <= 4) {
          soloLooperEngineRef.current?.disarmOverdub(armed as 2 | 3 | 4);
        }
        return;
      }
      if (isRecordingArmedRef.current) {
        return;
      }
      if (isMasterPausedRef.current) {
        return;
      }
      const t =
        Number.isFinite(targetTrackIndex) && targetTrackIndex >= 1 && targetTrackIndex <= 4
          ? Math.floor(targetTrackIndex)
          : 1;
      if (t === 1) {
        handleRecordFirstLoop();
        return;
      }
      handleArmSoloOverdubTrack(t as 2 | 3 | 4);
    },
    [commitActiveRecording, handleArmSoloOverdubTrack, handleRecordFirstLoop]
  );

  const soloTrackLanes = useMemo((): SoloTrackLaneView[] => {
    const slotMap = new Map<number, SoloLooperSlotRow>();
    soloTrackSlotUi?.forEach((s) => slotMap.set(s.trackIndex, s));
    return [1, 2, 3, 4].map((n) => {
      const slot = slotMap.get(n);
      const progress = soloSlotProgressPct(slot);
      const secondaryBlocked =
        soloMasterLoopFrames == null ||
        isRecordingArmed ||
        isMasterPaused ||
        soloLooperState === "recording" ||
        soloLooperState === "idle";
      const track1ArmDisabled = isRecordingArmed || isMasterPaused || soloLooperState === "recording";
      return {
        trackIndex: n as 1 | 2 | 3 | 4,
        volume: soloTrackVolumes[n - 1],
        progress,
        workletMode: slot?.mode ?? "idle",
        onVolumeChange: (lin: number) => handleSoloTrackVolumeChange(n as 1 | 2 | 3 | 4, lin),
        onArmRecord:
          n === 1 ? handleRecordFirstLoop : () => handleArmSoloOverdubTrack(n as 2 | 3 | 4),
        armDisabled: n === 1 ? track1ArmDisabled : secondaryBlocked,
        armLabel: n === 1 ? "Record" : "Overdub",
        isFocused: focusedTrackIndex === n,
        onRequestFocus: () => applyPedalFocus(n as 1 | 2 | 3 | 4),
        onResetTrack: () => handleResetSoloTrack(n as 1 | 2 | 3 | 4),
        resetDisabled: !soloLooperEngineRef.current || isRecordingArmed,
        isOverdubArmedWaiting:
          slot?.mode === "armed_overdub" ||
          (n >= 2 && soloOverdubArmedTrackIndex !== null && soloOverdubArmedTrackIndex === n),
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
    handleSoloTrackVolumeChange,
    handleArmSoloOverdubTrack,
    handleRecordFirstLoop,
    handleResetSoloTrack,
  ]);

  useEffect(() => {
    if (kiteMode !== "solo" || studioUiPhase !== "studio") {
      return;
    }
    let rafId = 0;
    const tick = (): void => {
      soloLooperEngineRef.current?.requestPlaybackUiState();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [kiteMode, studioUiPhase]);

  const track1Mode = soloTrackSlotUi?.[0]?.mode;

  useEffect(() => {
    const runwayCountInActive = isRecordingArmed && recordingArmedCountdown !== null;
    const shouldPulse =
      kiteMode === "solo" &&
      studioUiPhase === "studio" &&
      !isMasterPaused &&
      (track1Mode === "recording" || soloLooperState === "recording");

    if (
      kiteMode === "solo" &&
      studioUiPhase === "studio" &&
      !isMasterPaused &&
      runwayCountInActive
    ) {
      return;
    }

    if (!shouldPulse) {
      soloMetronomeLastBeatRef.current = null;
      if (kiteMode === "solo") setVisualActiveBeatInBar(null);
      return;
    }
    const ctx = studioAudioContextRef.current;
    if (!ctx || ctx.state !== "running") {
      setVisualActiveBeatInBar(null);
      return;
    }

    let rafId = 0;
    const tick = (): void => {
      const timing = kiteIntervalTimingRef.current;
      const bpm = Math.max(1, timing?.bpm ?? kiteSetupTempo);
      const beatSec = 60 / bpm;
      const anchor = soloMetronomeAnchorContextSecRef.current ?? ctx.currentTime;
      soloMetronomeAnchorContextSecRef.current = anchor;
      const elapsedBeats = Math.floor(Math.max(0, ctx.currentTime - anchor) / beatSec);

      if (soloMetronomeLastBeatRef.current !== elapsedBeats) {
        soloMetronomeLastBeatRef.current = elapsedBeats;
        const currentBeatIndex = Math.floor(elapsedBeats) % (kiteIntervalTimingRef.current?.beatsPerBar || 4);
        setVisualActiveBeatInBar(currentBeatIndex as 0 | 1 | 2 | 3);
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      setVisualActiveBeatInBar(null);
    };
  }, [
    isMasterPaused,
    isRecordingArmed,
    kiteMode,
    kiteSetupTempo,
    recordingArmedCountdown,
    soloLooperState,
    studioUiPhase,
    track1Mode,
  ]);

  useLooperFootPedal({
    armContext: {
      enabled: looperFootPedalArmed,
      pedalTargetTrackIndexRef: soloPedalTargetTrackIndexRef,
    },
    onPedalDown: onLooperPedalDown,
  });

  const handleEnterStudio = useCallback(() => {
    void (async () => {
      try {
        if (!studioAudioContextRef.current) {
          ensureStudioAudioContext();
        }
        const resumePromise = studioAudioContextRef.current!.resume();
        await resumePromise;
        const ctx = studioAudioContextRef.current;
        if (!ctx || ctx.state !== "running") {
          setAudioContextReady(false);
          console.warn("[EnterStudio] Aborted: audio context missing or not running.");
          return;
        }
        setAudioContextReady(true);
        void rebuildMixerAndReplaceTrack();

        const masterDestination = mixerMasterDestinationRef.current;
        const masterTrack = masterDestination?.stream.getAudioTracks()[0] ?? null;
        const fallbackLocalStream = localStreamRef.current;
        const localStream =
          masterDestination && masterTrack && masterTrack.readyState === "live"
            ? masterDestination.stream
            : fallbackLocalStream;
        if (!localStream) {
          console.warn("[EnterStudio] Aborted: local stream unavailable.");
          return;
        }
        if (!masterDestination || !masterTrack || masterTrack.readyState !== "live") {
          console.warn(
            "Enter Studio: mixer master destination unavailable, falling back to localStreamRef.current."
          );
        }
        const buildTransport = buildTransportRef.current;
        if (!buildTransport) {
          console.warn("[EnterStudio] Aborted: buildTransport not ready.");
          return;
        }

        setStudioUiPhase("connecting");
        await (sessionBootstrapPromiseRef.current ?? Promise.resolve()).catch(() => {});
        if (!studioSessionReservedRef.current) {
          const initNetworkSession = initNetworkSessionRef.current;
          if (!initNetworkSession) {
            console.warn("[EnterStudio] Aborted: network session initializer not ready.");
            setStudioUiPhase("lobby");
            return;
          }
          await initNetworkSession();
        }
        await buildTransport(localStream, ctx);
        ensureMetronomeGainNode(ctx);
        const stream = remoteStreamRef.current;
        if (
          stream &&
          !isBroadcastConnectPendingRef.current &&
          kiteModeRef.current !== "broadcast"
        ) {
          buildRemotePlaybackGraph(stream);
        }
      } catch (err) {
        console.error("[EnterStudio] Failed to enter studio:", err);
      }
      setStudioUiPhase("studio");
    })();
  }, [buildRemotePlaybackGraph, ensureMetronomeGainNode, ensureStudioAudioContext]);

  const handleEnterSoloStudio = useCallback(() => {
    void (async () => {
      try {
        if (!studioAudioContextRef.current) {
          ensureStudioAudioContext();
        }
        const resumePromise = studioAudioContextRef.current!.resume();
        await resumePromise;
        const ctx = studioAudioContextRef.current;
        if (!ctx || ctx.state !== "running") {
          setAudioContextReady(false);
          console.warn("[EnterSoloStudio] Aborted: audio context missing or not running.");
          return;
        }
        setAudioContextReady(true);
        void rebuildMixerAndReplaceTrack();

        const masterDestination = mixerMasterDestinationRef.current;
        const masterTrack = masterDestination?.stream.getAudioTracks()[0] ?? null;
        const fallbackLocalStream = localStreamRef.current;
        const localStream =
          masterDestination && masterTrack && masterTrack.readyState === "live"
            ? masterDestination.stream
            : fallbackLocalStream;
        if (!localStream) {
          console.warn("[EnterSoloStudio] Aborted: local stream unavailable.");
          return;
        }
        ensureMetronomeGainNode(ctx);
        setKiteSetupError(null);
        hasCapturedFirstKiteLoopRef.current = false;
        retainedKiteLoopBufferRef.current = null;
        lastRetainedKiteIntervalIdRef.current = null;
        soloLooperStateRef.current = "idle";
        isRecordingArmedRef.current = false;
        setIsRecordingArmed(false);
        setRecordingArmedCountdown(null);
        setSoloLooperState("idle");
        setLoopProgress(0);
        setSoloTrackSlotUi(null);
        soloTrackSlotUiLatestRef.current = null;
        setSoloTrackVolumes([1, 1, 1, 1]);
        setSoloMasterLoopFrames(null);
        applyPedalFocus(1);
        soloOverdubArmedTrackIndexRef.current = null;
        setSoloOverdubArmedTrackIndex(null);
        soloLooperActiveRecordTrackIndexRef.current = null;
        const bpm = Math.max(40, Math.min(240, Math.round(metronomeBpm)));
        setKiteSetupTempo(bpm);
        deriveKiteTimingMetadata({ overrideBpm: bpm });
        setKiteMode("solo");
        setStudioUiPhase("studio");
      } catch (err) {
        console.error("[EnterSoloStudio] Failed to enter solo studio:", err);
      }
    })();
  }, [
    deriveKiteTimingMetadata,
    ensureMetronomeGainNode,
    ensureStudioAudioContext,
    metronomeBpm,
    rebuildMixerAndReplaceTrack,
    applyPedalFocus,
  ]);

  const returnToLobby = useCallback(() => {
    setConfirmExitOpen(true);
  }, []);

  const confirmEndSession = useCallback(() => {
    void (async () => {
      await sendLeaveSignal();
      // Give the signaling channel a brief chance to flush.
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      bridgeTeardownRef.current?.();
      router.push("/studio");
    })();
  }, [router, sendLeaveSignal]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data: { user: next } }) => {
      if (cancelled) return;
      setUser(next ?? null);
      setAuthReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setUser(session?.user ?? null);
      setAuthReady(true);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isRecording && soloSessionRecorderState === "idle") return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isRecording, soloSessionRecorderState]);

  useEffect(() => {
    return () => {
      clearRecordingInterval();
      if (recordingIntervalRef.current !== null) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
      if (localRecorderRef.current) {
        void localRecorderRef.current.stop().catch(() => {});
        localRecorderRef.current = null;
      }
      void stopSoloSessionRecording();
      if (recordedBlobUrl) {
        URL.revokeObjectURL(recordedBlobUrl);
      }
    };
  }, [clearRecordingInterval, recordedBlobUrl, stopSoloSessionRecording]);

  useEffect(() => {
    if (status !== "connected") return;
    setError(null);
  }, [status]);

  /** Stale init failures can leave the failure copy up if `status` flips to connected elsewhere — clear it here. */
  useEffect(() => {
    if (status !== "connected") return;
    setError(null);
    setStatusNote((prev) =>
      prev === BRIDGE_INIT_FAIL_NOTE ? P2P_CONNECTED_NOTE : prev
    );
  }, [status]);

  /** Stop local monitor path once P2P is live (muted alone is not always enough on WebKit). */
  useEffect(() => {
    if (status !== "connected") return;
    const el = localMonitorAudioRef.current;
    if (!el) return;
    el.muted = true;
    el.volume = 0;
    void el.pause();
    el.srcObject = null;
  }, [status]);

  /** Online + Supabase reachable (does not wait for WebRTC peer). */
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    const verifyKiteSignal = async () => {
      if (!navigator.onLine) {
        if (!cancelled) setKiteSignal("offline");
        return;
      }
      if (!cancelled) setKiteSignal("checking");
      try {
        const { error } = await supabase.from("studio_sessions").select("session_id").limit(1);
        if (cancelled) return;
        if (error) setKiteSignal("error");
        else setKiteSignal("secure");
      } catch {
        if (!cancelled) setKiteSignal("error");
      }
    };

    void verifyKiteSignal();

    const onOnline = () => {
      void verifyKiteSignal();
    };
    const onOffline = () => setKiteSignal("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.addEventListener ||
      !navigator.mediaDevices?.enumerateDevices
    ) {
      return;
    }
    const onDeviceChange = async () => {
      await refreshAudioInputDevices();
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      const connectedIds = new Set(
        devices.filter((d) => d.kind === "audioinput").map((d) => d.deviceId)
      );
      const missingActiveIds = activeDeviceIdsRef.current.filter((id) => !connectedIds.has(id));
      if (missingActiveIds.length === 0) return;
      setActiveDeviceIds((prev) => prev.filter((id) => connectedIds.has(id)));
      for (const missingId of missingActiveIds) {
        clearMixerDeviceVolumeState(missingId);
        removeAndCleanupDevice(missingId);
      }
      await rebuildMixerAndReplaceTrack();
    };
    navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", onDeviceChange);
    };
  }, [rebuildMixerAndReplaceTrack, refreshAudioInputDevices, removeAndCleanupDevice, clearMixerDeviceVolumeState]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;
    let micStream: MediaStream | null = null;
    let micSyncTimeout: number | null = null;
    micDeniedThisInitRef.current = false;
    let teardownRan = false;
    let connectTimeout: number | null = null;
    let localIceCandidateSeen = false;
    let timeoutExtendedForIce = false;
    let transportSessionId = "";
    let transportActiveRole: Role = "host";
    let transportIsHost = true;
    let transportForceRelay = false;
    let sessionUserId: string | null = null;
    leaveSignalSentRef.current = false;
    leaveSignalReceivedRef.current = false;
    bridgeActiveRoleRef.current = null;
    historySavedRef.current = false;
    sessionStartedAtRef.current = Date.now();
    setCollaboratorLeft(false);
    setRemoteParticipantName(null);
    setLastDepartedParticipantName(null);
    clearLostCountdown();
    setMicSyncTimedOut(false);
    setMicPermissionHint(null);

    appliedRemoteSignalRef.current = false;
    seenIceRef.current.clear();
    existingRowRef.current = null;
    peerConnectionRef.current = null;

    // Defensive cleanup: stop any lingering local tracks from previous failed sync attempts.
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setLocalMicStream(null);

    const performTeardown = () => {
      if (teardownRan) return;
      teardownRan = true;
      studioSessionReservedRef.current = false;
      sessionBootstrapPromiseRef.current = null;
      cancelled = true;
      teardownKiteSyncTransport();
      peerConnectionRef.current = null;
      highPingStreakRef.current = 0;
      highPingTipDismissedRef.current = false;
      try {
        if (peerRef.current && p2pConnectSucceededRef.current) {
          const activeRole = bridgeActiveRoleRef.current;
          if (activeRole) {
            peerRef.current.send(
              JSON.stringify({ type: "LEAVE", from: activeRole })
            );
          }
        }
      } catch {
        /* ignore */
      }
      void (async () => {
        try {
          const stoppedTrackIds = new Set<string>();
          setPingMs(null);
          setInboundPacketLossPercent(null);
          setCalculatedDelayMs(null);
          calculatedDelayMsRef.current = null;
          setHighPingTipOpen(false);
          clearLostCountdown();
          if (connectTimeout !== null) {
            clearTimeout(connectTimeout);
            connectTimeout = null;
          }
          if (micSyncTimeout !== null) {
            clearTimeout(micSyncTimeout);
            micSyncTimeout = null;
          }
          if (pingIntervalRef.current) {
            clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = null;
          }
          if (handshakeFallbackIntervalRef.current) {
            window.clearInterval(handshakeFallbackIntervalRef.current);
            handshakeFallbackIntervalRef.current = null;
          }
          if (turnCredentialRefreshTimerRef.current !== null) {
            clearTimeout(turnCredentialRefreshTimerRef.current);
            turnCredentialRefreshTimerRef.current = null;
          }
          turnCredentialExpiresAtMsRef.current = null;
          turnCredentialFetchedAtMsRef.current = null;
          teardownRemotePlaybackGraph();
          cleanupKiteEngine({ stopLocalTracks: true, isFull: true });
          soloLooperEngineRef.current?.teardown();
          soloLooperEngineRef.current = null;
          // Mixer teardown: stop every active hardware stream and clear mixer graph/state.
          for (const [deviceId, stream] of Array.from(activeStreamsMapRef.current.entries())) {
            stopMediaStreamTracks(stream, stoppedTrackIds);
            activeStreamsMapRef.current.delete(deviceId);
          }

          // Ensure all mixer audio nodes are disconnected and references cleared.
          mixerTeardownOriginRef.current = "performTeardown";
          teardownMixerGraphNodes();
          mixerTeardownOriginRef.current = "none";
          teardownMasterDestinationNode();

          // Reset mixer UI/state so lobby re-entry starts clean.
          setActiveDeviceIds([]);
          setDeviceVolumes({});
          setDeviceInputChannelCount({});
          interfaceInputDeviceFlagsRef.current = {};
          interfaceLiveMonitorEnabledFlagsRef.current = {};
          setInterfaceInputDeviceFlags({});
          setInterfaceLiveMonitorEnabledFlags({});
          for (const meterEl of Array.from(perChannelMeterRefs.current.values())) {
            meterEl.style.width = "0%";
          }
          perChannelMeterRefs.current.clear();
          if (masterLiveMeterElementRef.current) {
            masterLiveMeterElementRef.current.style.width = "0%";
            masterLiveMeterElementRef.current = null;
          }
          setStudioUiPhase("lobby");
          const ctx = studioAudioContextRef.current;
          if (ctx && ctx.state !== "closed") {
            await ctx.close().catch(() => {});
          }
          studioAudioContextRef.current = null;
          metronomeGainRef.current = null;
          workletLoadedContextRef.current = null;
          workletLoadPromiseRef.current = null;
          if (mountedRef.current) {
            setIsWorkletLoaded(false);
            setAudioContextReady(false);
          }
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = null;
          }
          stopMediaStreamTracks(remoteStreamRef.current, stoppedTrackIds);
          if (remoteStreamRef.current) {
            remoteStreamRef.current = null;
          }
          if (localMonitorAudioRef.current) {
            localMonitorAudioRef.current.srcObject = null;
          }
          channelRef.current?.unsubscribe();
          channelRef.current = null;

          peerRef.current?.destroy();
          peerRef.current = null;

          const localStreamToStop = localStreamRef.current;
          try {
            stopMediaStreamTracks(localStreamToStop, stoppedTrackIds);
            stopMediaStreamTracks(localMicStreamRef.current, stoppedTrackIds);
          } finally {
            micStream = null;
            localStreamRef.current = null;
          }

          if (mountedRef.current) {
            setLocalMicStream(null);
            setRemoteStream(null);
            setAudioTestDone(false);
            setAudioTestFailed(false);
            setRemoteLevel(0);
            setIsMicMuted(false);
            setIsSpeakerMuted(false);
            speakerMutedRef.current = false;
            setRemotePlaybackVolume(DEFAULT_REMOTE_PLAYBACK_VOLUME);
            remotePlaybackVolumeRef.current = DEFAULT_REMOTE_PLAYBACK_VOLUME;
            setConnectionLostCountdown(null);
            setRemoteParticipantName(null);
            setIsRecording(false);
            setRecordingTimeMs(0);
            setKiteSyncEnabled(false);
            setBroadcastStatus("idle");
            setRecordedBlobUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return null;
            });
          }

          clearRecordingInterval();
          if (localRecorderRef.current) {
            void localRecorderRef.current.stop().catch(() => {});
            localRecorderRef.current = null;
          }

          if (cleanupSessionRef.current) {
            await cleanupSessionRef.current();
            cleanupSessionRef.current = null;
          }
        } catch {
          // Ignore cleanup errors in dev teardown.
        }
      })();
    };

    bridgeTeardownRef.current = performTeardown;

    const appendIceCandidate = async (
      sessionId: string,
      nextCandidate: IceCandidateRow
    ) => {
      const { data: current, error: currentErr } = await supabase
        .from("studio_sessions")
        .select("ice_candidates")
        .eq("session_id", sessionId.toUpperCase())
        .single<{ ice_candidates: IceCandidateRow[] | null }>();

      if (currentErr) throw currentErr;
      const existing = Array.isArray(current?.ice_candidates) ? current.ice_candidates : [];
      const updated = [...existing, nextCandidate];

      const { error: updateErr } = await supabase
        .from("studio_sessions")
        .update({ ice_candidates: updated })
        .eq("session_id", sessionId.toUpperCase());
      if (updateErr) throw updateErr;
    };

    const applyRemoteIce = (
      incoming: IceCandidateRow[] | null | undefined,
      myRole: Role
    ) => {
      if (!Array.isArray(incoming) || !peerRef.current) return;
      for (const item of incoming) {
        if (!item || typeof item !== "object") continue;
        if (item.from === myRole) continue;
        if (!item.id || seenIceRef.current.has(item.id)) continue;
        if (!item.candidate || typeof item.candidate !== "object") continue;
        seenIceRef.current.add(item.id);
        peerRef.current.signal(item.candidate);
      }
    };

    let reconnectTransport: () => Promise<void> = async () => {};

    const clearTurnCredentialRefreshTimer = () => {
      if (turnCredentialRefreshTimerRef.current !== null) {
        clearTimeout(turnCredentialRefreshTimerRef.current);
        turnCredentialRefreshTimerRef.current = null;
      }
    };

    const scheduleTurnCredentialRefresh = (expiresAtEpochMs: number | null) => {
      clearTurnCredentialRefreshTimer();
      if (typeof expiresAtEpochMs !== "number" || !Number.isFinite(expiresAtEpochMs)) {
        return;
      }
      const refreshSkewMs = 60_000;
      const delayMs = Math.max(10_000, expiresAtEpochMs - Date.now() - refreshSkewMs);
      turnCredentialRefreshTimerRef.current = window.setTimeout(() => {
        turnCredentialRefreshTimerRef.current = null;
        void (async () => {
          if (cancelled || !mountedRef.current) return;
          try {
            const refreshBundle = await fetchTurnCredentialsWithMeta();
            const pc = peerConnectionRef.current;
            if (!pc || cancelled || !mountedRef.current) return;
            try {
              pc.setConfiguration(buildPeerConfig(refreshBundle.iceServers, transportForceRelay));
            } catch (cfgErr) {
              console.error("[Kite] setConfiguration after TURN refresh failed:", cfgErr);
            }
            if (typeof pc.restartIce === "function") {
              pc.restartIce();
            }
            turnCredentialExpiresAtMsRef.current = refreshBundle.expiresAtEpochMs;
            turnCredentialFetchedAtMsRef.current = Date.now();
            scheduleTurnCredentialRefresh(refreshBundle.expiresAtEpochMs);
          } catch (err) {
            console.error("[Kite] TURN credential refresh failed:", err);
            turnCredentialRefreshTimerRef.current = window.setTimeout(() => {
              scheduleTurnCredentialRefresh(
                turnCredentialExpiresAtMsRef.current ?? Date.now() + 150_000
              );
            }, 120_000);
          }
        })();
      }, delayMs);
    };

    const buildTransport = async (localStream: MediaStream, ctx: AudioContext) => {
      const localTrack = localStream.getAudioTracks()[0] ?? null;
      if (process.env.NODE_ENV !== "production") {
        console.assert(
          ctx.state === "running",
          "[Kite][Invariant] buildTransport requires running AudioContext",
          ctx.state
        );
        console.assert(
          localTrack?.readyState === "live",
          "[Kite][Invariant] buildTransport requires live local track",
          localTrack?.readyState
        );
      }
      p2pConnectSucceededRef.current = false;
      appliedRemoteSignalRef.current = false;
      seenIceRef.current = new Set();
      clearTurnCredentialRefreshTimer();
      turnCredentialExpiresAtMsRef.current = null;
      turnCredentialFetchedAtMsRef.current = null;
      setStatus("connecting");
      addLog("Phase 3: Realtime subscribe + peer");
      setStatusNote("Starting peer connection...");

      const roomId = `session_id:${transportSessionId.toUpperCase()}`;
      const channel = supabase
        .channel(
          roomId,
          { config: { realtime: { heartbeatIntervalMs: 3000 } } } as any
        )
        .on("broadcast", { event: "session-control" }, (payload) => {
          const msg = payload.payload as SessionControlMessage | undefined;
          if (!msg || msg.type !== "LEAVE") return;
          if (msg.room !== transportSessionId.toUpperCase()) return;
          if (msg.from === transportActiveRole) return;
          const departedName = remoteParticipantName || "A participant";
          leaveSignalReceivedRef.current = true;
          setKiteSyncEnabled(false);
          setBroadcastStatus("idle");
          stopKiteMetronome();
          addLog("Collaborator LEAVE received");
          clearLostCountdown();
          setCollaboratorLeft(true);
          setLastDepartedParticipantName(departedName);
          setRemoteParticipantName(null);
          setStatus("failed");
          setStatusNote(`${departedName} left the session.`);
        })
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "studio_sessions",
            filter: `session_id=eq.${transportSessionId.toUpperCase()}`,
          },
          (payload) => {
            console.log('[SUPABASE-POSTGRES-CHANGE] Payload received:', payload);
            const nextRow = payload.new as StudioSessionRow;
            if (!nextRow || typeof nextRow !== "object") return;
            const peer = peerRef.current;

            if (transportActiveRole === "host") {
              if (
                peer &&
                !appliedRemoteSignalRef.current &&
                nextRow.answer &&
                typeof nextRow.answer === "object"
              ) {
                appliedRemoteSignalRef.current = true;
                addLog("Answer received");
                peer.signal(nextRow.answer);
                scheduleConnectTimeout(60000);
                setStatusNote("Answer received. Negotiating...");
              }
            } else if (
              peer &&
              !appliedRemoteSignalRef.current &&
              nextRow.offer &&
              typeof nextRow.offer === "object"
            ) {
              appliedRemoteSignalRef.current = true;
              addLog("Offer received");
              peer.signal(nextRow.offer);
              scheduleConnectTimeout(60000);
              setStatusNote("Offer received. Creating answer...");
            }

            applyRemoteIce(nextRow.ice_candidates, transportActiveRole);
          }
        )
        .subscribe((status, err) => {
          console.log('[SUPABASE-CHANNEL-STATUS]', status, err);
          if (status === 'SUBSCRIBED') {
            console.log('[Kite] Signaling Bridge Restored');
          }
        });
      channelRef.current = channel;

      addLog(
        `Negotiation: ${transportIsHost ? "host initiates (offer first)" : "guest answers"}`
      );

      const isSafariWebKit = isStudioSafariWebKitEngine();
      const lowLatencyReceiverOpts = { isSafariWebKit };

      const bundle = await fetchTurnCredentialsWithMeta();
      const iceServers = bundle.iceServers;
      turnCredentialExpiresAtMsRef.current = bundle.expiresAtEpochMs;
      turnCredentialFetchedAtMsRef.current = Date.now();
      if (transportForceRelay && iceServers.length === 0) {
        setStatusNote("Secure relay servers unavailable. Restrictive network detected.");
      }
      const peerConfig = buildPeerConfig(iceServers, transportForceRelay);
      const peer = new Peer({
        initiator: transportIsHost,
        trickle: true,
        stream: localStream,
        config: peerConfig,
        sdpTransform: (sdp) => {
          console.log("[SDP-IN]", sdp);
          try {
            const result = forceMusicModeOpus(sdp, { isSafariWebKit });
            console.log("[SDP-OUT]", result);
            if (!result || typeof result !== "string") {
              console.error("[SDP-TRANSFORM] returned invalid value:", result);
            }
            return result;
          } catch (err) {
            console.error("[SDP-TRANSFORM] threw:", err);
            return sdp;
          }
        },
      });
      peerRef.current = peer;
      peer.on("error", (err) => {
        console.error("[PEER-ERROR]", err);
      });
      // Attach raw RTCPeerConnection diagnostic listeners
      if ((peer as any)._pc) {
        const pc = (peer as any)._pc;
        pc.addEventListener("icegatheringstatechange", () =>
          console.log("[ICE-GATHER]", pc.iceGatheringState)
        );
        pc.addEventListener("iceconnectionstatechange", () =>
          console.log("[ICE-CONN]", pc.iceConnectionState)
        );
        pc.addEventListener("signalingstatechange", () =>
          console.log("[SIG-STATE]", pc.signalingState)
        );
      }
      let presenceNotified = false;

      const scheduleConnectTimeout = (delayMs: number) => {
        if (connectTimeout !== null) {
          clearTimeout(connectTimeout);
        }
        connectTimeout = window.setTimeout(() => {
          if (!mountedRef.current || cancelled || statusRef.current !== "connecting") return;

          // On strict networks, ICE gathering can be slower; allow one grace extension.
          if (!localIceCandidateSeen && !timeoutExtendedForIce) {
            timeoutExtendedForIce = true;
            addLog("No local ICE yet after 15s; extending timeout window.");
            setStatusNote("Gathering network routes...");
            scheduleConnectTimeout(10000);
            return;
          }

          console.error("WebRTC timeout before connect", {
            iceServers: "Fetched dynamically",
            localIceCandidateSeen,
          });
          setStatus("failed");
          setStatusNote(
            "Network Restricted. This can happen on some restricted Wi-Fi networks. Try switching to Mobile Data."
          );
        }, delayMs);
      };

      // Start timeout window (with one automatic extension if ICE is still gathering).
      scheduleConnectTimeout(60000);

      // Phase 4.1.1: backup poll if Realtime misses postgres_changes during handshake.
      handshakeFallbackIntervalRef.current = window.setInterval(async () => {
        if (p2pConnectSucceededRef.current || statusRef.current !== "connecting" || !mountedRef.current) {
          if (handshakeFallbackIntervalRef.current) {
            window.clearInterval(handshakeFallbackIntervalRef.current);
            handshakeFallbackIntervalRef.current = null;
          }
          return;
        }

        try {
          const { data } = await supabase
            .from("studio_sessions")
            .select("offer, answer, ice_candidates")
            .eq("session_id", transportSessionId.toUpperCase())
            .single<StudioSessionRow>();

          if (!data) return;
          const currentPeer = peerRef.current;
          if (!currentPeer) return;

          if (transportActiveRole === "host") {
            if (!appliedRemoteSignalRef.current && data.answer && typeof data.answer === "object") {
              appliedRemoteSignalRef.current = true;
              addLog("Answer received (via Poller)");
              currentPeer.signal(data.answer);
              scheduleConnectTimeout(60000);
              setStatusNote("Answer received. Negotiating...");
            }
          } else {
            if (!appliedRemoteSignalRef.current && data.offer && typeof data.offer === "object") {
              appliedRemoteSignalRef.current = true;
              addLog("Offer received (via Poller)");
              currentPeer.signal(data.offer);
              scheduleConnectTimeout(60000);
              setStatusNote("Offer received. Creating answer...");
            }
          }
          applyRemoteIce(data.ice_candidates, transportActiveRole);
        } catch {
          /* ignore network errors during polling */
        }
      }, 4000);

      const rawPc = (peer as unknown as { _pc?: RTCPeerConnection })._pc;
      if (rawPc) {
        peerConnectionRef.current = rawPc;
        rawPc.addEventListener("track", () => {
          applyLowLatencyInboundAudioReceivers(rawPc, lowLatencyReceiverOpts);
        });

        rawPc.addEventListener("icegatheringstatechange", () => {
          // no-op
        });

        rawPc.addEventListener("icecandidate", (_event) => {
          // no-op
        });

        rawPc.addEventListener(
          "icecandidateerror",
          (event: RTCPeerConnectionIceErrorEvent) => {
            console.error("ICE candidate error detail:", {
              errorCode: event.errorCode,
              errorText: event.errorText,
              url: event.url,
            });
          }
        );

        rawPc.addEventListener("iceconnectionstatechange", () => {
          const iceState = rawPc.iceConnectionState;
          addLog(`iceConnectionState=${iceState}`);

          if (leaveSignalReceivedRef.current) return;
          if (iceState === "connected" || iceState === "completed") {
            p2pConnectSucceededRef.current = true;
            setError(null);
            setStatus("connected");
            clearLostCountdown();
            applyLowLatencyInboundAudioReceivers(rawPc, lowLatencyReceiverOpts);
            rawPc
              .getStats()
              .then((stats) => {
                stats.forEach((report) => {
                  if (report.type === "candidate-pair" && report.state === "succeeded") {
                    addLog(
                      `SELECTED PAIR — local: ${report.localCandidateId} remote: ${report.remoteCandidateId}`
                    );
                  }
                  if (report.type === "local-candidate") {
                    addLog(
                      `LOCAL candidate type: ${report.candidateType} protocol: ${report.protocol}`
                    );
                  }
                  if (report.type === "remote-candidate") {
                    addLog(
                      `REMOTE candidate type: ${report.candidateType} protocol: ${report.protocol}`
                    );
                  }
                });
              })
              .catch(() => {
                // Stats may not be available in all environments; ignore errors.
              });
            return;
          }
          if (iceState === "disconnected") {
            void reconnectTransport();
            return;
          }
          if (iceState === "failed") {
            void reconnectTransport();
          }
        });
        scheduleTurnCredentialRefresh(turnCredentialExpiresAtMsRef.current);
      }

      peer.on("stream", (remoteStream: MediaStream) => {
        if (!mountedRef.current) return;
        addLog("Remote audio stream received");
        remoteStreamRef.current = remoteStream;
        setRemoteStream(remoteStream);
        setRemoteLevel(0);
        const remoteEl = remoteAudioRef.current;
        if (remoteEl) {
          remoteEl.srcObject = remoteStream;
          remoteEl.muted = true;
          void remoteEl.play().catch(() => {
            addLog("Remote audio play() blocked (tap page if silent)");
          });
        }
        if (
          studioAudioContextRef.current &&
          !isBroadcastConnectPendingRef.current &&
          kiteModeRef.current !== "broadcast"
        ) {
          buildRemotePlaybackGraph(remoteStream);
        }
      });

      peer.on("data", (chunk: unknown) => {
        // Binary path: KITE interval chunk — must be checked before text/JSON path.
        const loadChunk = decodeLoadIntervalChunk(chunk);
        if (loadChunk) {
          if (!kiteLoopReassemblerRef.current) {
            kiteLoopReassemblerRef.current = new KiteIntervalReassembler();
          }
          const result = kiteLoopReassemblerRef.current.acceptChunk(loadChunk);
          if (result.status === "pending") {
            console.log(
              "[P2P RX] chunk pending",
              result.receivedChunks,
              "/",
              result.totalChunks,
              "key:",
              result.key
            );
          } else if (result.status === "discarded") {
            console.warn("[P2P RX] chunk discarded:", result.reason, "key:", result.key);
          } else if (result.status === "complete") {
            const interval = result.interval;
            const isLive = interval.intervalId.startsWith("p2p-live-");
            if (isLive) {
              queuedRemoteKiteIntervalRef.current.push(interval);
              console.log(
                "[P2P RX] live interval complete:",
                interval.intervalId,
                "frames:",
                interval.intervalFrames
              );
            } else {
              retainedRemoteKiteLoopRef.current = interval;
              console.log(
                "[P2P RX] retained loop complete:",
                interval.intervalId,
                "frames:",
                interval.intervalFrames
              );
            }
          }
          return;
        }

        // Text/JSON path: all signalling and control messages.
        try {
          const text = decodePeerDataChunk(chunk);
          const msg = JSON.parse(text) as {
            t?: string;
            ts?: number;
            type?: string;
            name?: string;
            bpm?: number;
            bpi?: number;
            hostTime?: number;
            enabled?: boolean;
            serverTimestamp?: number;
            sequenceNumber?: number;
            initiatorId?: string;
            studioRevision?: number;
            originatorId?: string;
            patch?: unknown;
            from?: Role;
            action?: JamSetupLockAction;
            ownerId?: string;
            ownerName?: string;
            expiresAt?: number;
            timing?: unknown;
            clockAnchorSec?: number;
            hasRetainedLoop?: boolean;
            igniteP2PEngine?: boolean;
          };
          if (msg.type === "LEAVE") {
            if (msg.from === transportActiveRole) return;
            const departedName = remoteParticipantName || "A participant";
            leaveSignalReceivedRef.current = true;
            setKiteSyncEnabled(false);
            setBroadcastStatus("idle");
            syncInitiatorIdRef.current = null;
            if (mountedRef.current) {
              setSyncInitiatorId(null);
            }
            stopKiteMetronome();
            clearLostCountdown();
            setCollaboratorLeft(true);
            setLastDepartedParticipantName(departedName);
            setRemoteParticipantName(null);
            setStatus("failed");
            setStatusNote(`${departedName} left the session.`);
            return;
          }
          if (msg.type === "JAM_SETUP_LOCK") {
            if (msg.action === "acquire") {
              if (
                typeof msg.ownerId !== "string" ||
                typeof msg.ownerName !== "string" ||
                typeof msg.expiresAt !== "number" ||
                msg.expiresAt <= Date.now()
              ) {
                return;
              }
              setJamSetupLock({
                ownerId: msg.ownerId,
                ownerName: msg.ownerName,
                expiresAt: msg.expiresAt,
              });
              scheduleJamSetupLockExpiry(msg.expiresAt);
              return;
            }
            if (msg.action === "release") {
              clearJamSetupLockTimer();
              jamSetupLockExpiresAtRef.current = null;
              jamSetupLockTokenRef.current = null;
              setJamSetupLock(null);
              return;
            }
          }
          if (
            msg.type === "SET_INTERVAL" &&
            msg.timing !== null &&
            typeof msg.timing === "object" &&
            typeof (msg.timing as KiteIntervalTiming).bpm === "number" &&
            typeof (msg.timing as KiteIntervalTiming).chords === "number" &&
            typeof (msg.timing as KiteIntervalTiming).timeSignatureTop === "number" &&
            typeof (msg.timing as KiteIntervalTiming).timeSignatureBottom === "number"
          ) {
            const timing = msg.timing as KiteIntervalTiming;
            const clockAnchorSec = typeof msg.clockAnchorSec === "number" ? msg.clockAnchorSec : 0;
            const hasRetainedLoop = typeof msg.hasRetainedLoop === "boolean" ? msg.hasRetainedLoop : false;
            applySetIntervalLocally(timing, clockAnchorSec, hasRetainedLoop);
            if (msg.igniteP2PEngine === true) {
              const run = startP2PEngineRef.current;
              if (!run) {
                console.error("[Kite] igniteP2PEngine dropped: ref is null");
                queueMicrotask(() => {
                  const retry = startP2PEngineRef.current;
                  if (retry) void retry(timing);
                });
                return;
              }
              void run(timing);
            }
            return;
          }
          if (msg.type === "STUDIO_PARAM") {
            if (
              typeof msg.originatorId !== "string" ||
              typeof msg.studioRevision !== "number" ||
              msg.patch === null ||
              typeof msg.patch !== "object"
            ) {
              return;
            }
            if (msg.studioRevision <= lastAcceptedStudioRevisionRef.current) return;
            lastAcceptedStudioRevisionRef.current = msg.studioRevision;
            const p = msg.patch as StudioParamMessage["patch"];
            if (typeof p.kiteSetupTempo === "number") {
              setKiteSetupTempo(Math.max(20, Math.min(320, Math.round(p.kiteSetupTempo))));
            }
            if (typeof p.kiteSetupTimeSignatureTop === "number") {
              setKiteSetupTimeSignatureTop(
                Math.max(1, Math.min(16, Math.round(p.kiteSetupTimeSignatureTop)))
              );
            }
            if (typeof p.kiteSetupTimeSignatureBottom === "number") {
              setKiteSetupTimeSignatureBottom(
                Math.max(1, Math.min(32, Math.round(p.kiteSetupTimeSignatureBottom)))
              );
            }
            if (typeof p.kiteSetupChordCount === "number") {
              setKiteSetupChordCount(Math.max(1, Math.min(64, Math.round(p.kiteSetupChordCount))));
            }
            if (typeof p.bpm === "number") {
              setMetronomeBpm(Math.max(40, Math.min(240, Math.round(p.bpm))));
            }
            if (typeof p.bpi === "number") {
              setBeatsPerInterval(Math.max(1, Math.round(p.bpi)));
            }
            return;
          }
          if (msg.type === "presence" && typeof msg.name === "string" && msg.name.trim().length > 0) {
            if (mountedRef.current) {
              const incomingName = msg.name.trim();
              setRemoteParticipantName(incomingName);
              if (!presenceNotified) {
                setStatusNote(`${incomingName} entered the session.`);
                presenceNotified = true;
              }
            }
          } else if (msg.t === "ping" && typeof msg.ts === "number") {
            peer.send(JSON.stringify({ t: "pong", ts: msg.ts }));
          } else if (msg.t === "pong" && typeof msg.ts === "number" && mountedRef.current) {
            const latency = Math.round(performance.now() - msg.ts);
            setPingMs(latency);
          } else if (
            msg.type === "KITE_SYNC" &&
            typeof msg.sequenceNumber === "number" &&
            typeof msg.hostTime === "number" &&
            typeof msg.serverTimestamp === "number" &&
            typeof msg.bpm === "number" &&
            typeof msg.bpi === "number" &&
            typeof msg.enabled === "boolean"
          ) {
            if (msg.sequenceNumber <= lastAcceptedKiteSyncSeqRef.current) return;

            if (!msg.enabled) {
              const packetInitiator = typeof msg.initiatorId === "string" ? msg.initiatorId : null;
              if (packetInitiator !== null) {
                if (packetInitiator !== syncInitiatorIdRef.current) return;
              } else if (syncInitiatorIdRef.current !== null) {
                return;
              }
              lastAcceptedKiteSyncSeqRef.current = msg.sequenceNumber;
              setKiteSyncEnabled(false);
              setBroadcastStatus("idle");
              syncInitiatorIdRef.current = null;
              if (mountedRef.current) {
                setSyncInitiatorId(null);
              }
              cleanupKiteEngine({ stopLocalTracks: false, isFull: false });

              restoreLiveVoipTrackAfterKite();

              const remoteStream = remoteStreamRef.current;
              if (remoteStream) {
                buildRemotePlaybackGraph(remoteStream);
              }
              return;
            }

            lastAcceptedKiteSyncSeqRef.current = msg.sequenceNumber;

            setKiteSyncEnabled(true);
            setBroadcastStatus("syncing");

            if (typeof msg.initiatorId === "string") {
              syncInitiatorIdRef.current = msg.initiatorId;
              if (mountedRef.current) {
                setSyncInitiatorId(msg.initiatorId);
              }
            }

            const incomingRev = typeof msg.studioRevision === "number" ? msg.studioRevision : null;
            let applyBpmBpi = true;
            if (incomingRev !== null) {
              if (incomingRev < lastAcceptedStudioRevisionRef.current) {
                applyBpmBpi = false;
              } else {
                lastAcceptedStudioRevisionRef.current = incomingRev;
              }
            }

            const receivedAtMs = Date.now();
            const rttDelaySec = (calculatedDelayMsRef.current || 0) / 1000;
            const offsetSec = (receivedAtMs - msg.serverTimestamp) / 1000;
            const sampleRate = getStudioKiteSampleRate();
            const bufferDelaySec = targetLeadFramesRef.current / sampleRate;
            const guestTargetSec =
              msg.hostTime + offsetSec + rttDelaySec + bufferDelaySec;

            lastAppliedGuestStartSecRef.current = guestTargetSec;
            lastSyncApplyAtMsRef.current = receivedAtMs;
            if (applyBpmBpi) {
              setMetronomeBpm(msg.bpm);
              setBeatsPerInterval(msg.bpi);
            }
            const ctx = studioAudioContextRef.current;
            if (ctx) {
              const sixteenthSec = 60 / msg.bpm / 4;
              let nextGridSec = guestTargetSec;
              if (
                Number.isFinite(sixteenthSec) &&
                sixteenthSec > 0 &&
                guestTargetSec < ctx.currentTime
              ) {
                nextGridSec =
                  guestTargetSec +
                  Math.ceil((ctx.currentTime - guestTargetSec) / sixteenthSec) * sixteenthSec;
              }
              flushAndSetRemoteGridTarget(nextGridSec);
              const timing =
                latestKiteIntervalTimingRef.current ?? kiteIntervalTimingRef.current;
              const beatsPerBar = Math.max(
                1,
                Math.round(timing?.beatsPerBar ?? timing?.timeSignatureTop ?? 4)
              );
              const countInOneBarSec = (60 / msg.bpm) * beatsPerBar;
              if (Number.isFinite(countInOneBarSec) && countInOneBarSec > 0) {
                kiteSyncCountInEndAtContextSecRef.current =
                  ctx.currentTime + countInOneBarSec;
                if (metronomeGainRef.current) metronomeGainRef.current.gain.value = 0;
                setKiteSyncCountInActive(true);
                kiteSyncCountInActiveRef.current = true;
                kiteSyncCountInCompletionHandledRef.current = false;

                void queueMicrotask(() => {
                  const timing =
                    latestKiteIntervalTimingRef.current ?? kiteIntervalTimingRef.current;
                  if (timing) {
                    startP2PIntervalSchedulerRef.current?.(timing);
                  } else {
                    console.warn("[Kite] Guest scheduler ignite skipped — no timing ref");
                  }
                });
              }
            }
            console.log("KITE_SYNC received! Guest Target Start:", guestTargetSec);
          }
        } catch {
          // Ignore non-JSON or malformed ping payloads.
        }
      });

      const enqueueIceAppend = (nextCandidate: IceCandidateRow) => {
        iceAppendQueueRef.current = iceAppendQueueRef.current
          .then(async () => {
            await appendIceCandidate(transportSessionId, nextCandidate);
            addLog("ICE candidate sent");
          })
          .catch((err) => {
            console.error("ICE append failed", err);
            addLog("ICE send failed");
          });
        void iceAppendQueueRef.current;
      };

      peer.on("signal", (signalData: SignalData) => {
        try {
          const candidateLike = (signalData as { candidate?: unknown }).candidate;
          const typeLike = (signalData as { type?: unknown }).type;

          if (candidateLike) {
            localIceCandidateSeen = true;
            const candidateRecord: IceCandidateRow = {
              id: `${transportActiveRole}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              from: transportActiveRole,
              candidate: signalData,
            };
            enqueueIceAppend(candidateRecord);
            return;
          }

          if (typeLike === "offer") {
            addLog("Offer sent");
            void (async () => {
              const { error } = await supabase
                .from("studio_sessions")
                .update({ offer: signalData })
                .eq("session_id", transportSessionId.toUpperCase());
              if (error) throw error;
              setStatusNote("Offer published. Waiting for peer answer...");
            })().catch((err) => {
              console.error("Offer publish failed", err);
              setStatus("failed");
              setStatusNote("Offer publish failed.");
            });
            return;
          }

          if (typeLike === "answer") {
            addLog("Answer sent");
            void (async () => {
              const { error } = await supabase
                .from("studio_sessions")
                .update({ answer: signalData })
                .eq("session_id", transportSessionId.toUpperCase());
              if (error) throw error;
              setStatusNote("Answer sent. Finalizing connection...");
            })().catch((err) => {
              console.error("Answer publish failed", err);
              setStatus("failed");
              setStatusNote("Answer publish failed.");
            });
            return;
          }
        } catch {
          setStatus("failed");
          setStatusNote("Signaling update failed.");
        }
      });

      peer.on("connect", () => {
        p2pConnectSucceededRef.current = true;
        setError(null);
        setStatus("connected");
        setStatusNote(P2P_CONNECTED_NOTE);
        void channel.unsubscribe();
        if (channelRef.current === channel) {
          channelRef.current = null;
        }
        console.log('[Kite] Handshake complete. Signaling bridge closed to reduce jitter.');
        try {
          peer.send(
            JSON.stringify({
              type: "presence",
              name: transportIsHost ? "Host" : "Guest",
            })
          );
        } catch {
          // Presence payload is best-effort; keep connect flow unchanged on send failures.
        }
        if (kiteSyncEnabled && pendingKiteSyncRef.current) {
          try {
            peer.send(JSON.stringify(pendingKiteSyncRef.current));
            pendingKiteSyncRef.current = null;
          } catch {
            // Keep queued packet for next successful send checkpoint.
          }
        }
        try {
          const timing = deriveKiteTimingMetadata();
          const hasRetainedLoop = retainedKiteLoopBufferRef.current !== null;
          sendSetInterval(timing, hasRetainedLoop);
        } catch {
          // SET_INTERVAL is best-effort on connect; retained loop is preserved.
        }
        if (connectTimeout !== null) {
          clearTimeout(connectTimeout);
          connectTimeout = null;
        }
        if (pingIntervalRef.current !== null) {
          clearInterval(pingIntervalRef.current);
        }
        pingIntervalRef.current = window.setInterval(() => {
          if (!mountedRef.current) return;
          try {
            peer.send(JSON.stringify({ t: "ping", ts: performance.now() }));
          } catch {
            console.warn("[Kite] Ping failed, peer likely closed");
          }
        }, 2000);
      });

      peer.on("error", (err: unknown) => {
        if (!mountedRef.current) return;
        if (pingIntervalRef.current !== null) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
        const msg =
          err instanceof Error
            ? err.message
            : typeof err === "object" && err !== null && "message" in err
              ? String((err as { message: unknown }).message)
              : String(err);
        const code =
          typeof err === "object" && err !== null && "code" in err
            ? String((err as { code: unknown }).code)
            : "";
        addLog(`Peer error: ${msg}${code ? ` code=${code}` : ""}`);
        console.error("WebRTC peer error detail", {
          message: msg,
          code,
          iceServers: peerConfig?.iceServers ?? "fetched-at-runtime",
        });
      });

      peer.on("close", () => {
        if (!mountedRef.current) return;
        setRemoteParticipantName(null);
        if (pingIntervalRef.current !== null) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
        if (connectTimeout !== null) {
          clearTimeout(connectTimeout);
          connectTimeout = null;
        }
        if (transportIsHost) {
          const inActiveKiteSession =
            kiteModeRef.current === "broadcast" || kiteSyncEnabledRef.current;
          if (inActiveKiteSession) {
            addLog("Host: peer disconnected — exiting Kite Sync");
            try {
              hostExitKiteBroadcastOnPeerDisconnectRef.current();
            } catch {
              /* ignore teardown errors while peer is torn down */
            }
          }
        }
        if (!leaveSignalReceivedRef.current && statusRef.current !== "connected") {
          addLog("Peer closed");
          beginLostCountdown();
          setStatusNote("Connection lost, attempting to recover...");
        }
      });

      if (!transportIsHost) {
        const initial = existingRowRef.current;
        if (initial?.offer && typeof initial.offer === "object") {
          appliedRemoteSignalRef.current = true;
          addLog("Initial offer applied");
          peer.signal(initial.offer);
          setStatusNote("Creating answer...");
        }
        if (initial?.ice_candidates) {
          applyRemoteIce(initial.ice_candidates, transportActiveRole);
        }
      } else {
        const { data: current } = await supabase
          .from("studio_sessions")
          .select("answer, ice_candidates")
          .eq("session_id", transportSessionId.toUpperCase())
          .single<Pick<StudioSessionRow, "answer" | "ice_candidates">>();
        if (current?.answer && typeof current.answer === "object") {
          appliedRemoteSignalRef.current = true;
          addLog("Initial answer applied");
          peer.signal(current.answer);
        }
        if (current?.ice_candidates) {
          applyRemoteIce(current.ice_candidates, transportActiveRole);
        }
      }
    };
    buildTransportRef.current = buildTransport;

    reconnectTransport = async () => {
      if (!localStreamRef.current || !studioAudioContextRef.current) return;
      clearTurnCredentialRefreshTimer();
      restoreLiveVoipTrackAfterKite();
      cleanupKiteEngine({ stopLocalTracks: false, isFull: false });
      addLog("Initiating ICE Soft Reboot...");
      setStatus("connecting");
      setStatusNote("Connection dropped. Reconnecting...");

      if (handshakeFallbackIntervalRef.current) {
        window.clearInterval(handshakeFallbackIntervalRef.current);
        handshakeFallbackIntervalRef.current = null;
      }
      if (connectTimeout !== null) {
        clearTimeout(connectTimeout);
        connectTimeout = null;
      }
      if (pingIntervalRef.current !== null) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      channelRef.current?.unsubscribe();
      channelRef.current = null;
      peerRef.current?.destroy();
      peerRef.current = null;
      peerConnectionRef.current = null;
      teardownRemotePlaybackGraph();

      if (transportIsHost) {
        await supabase
          .from("studio_sessions")
          .update({ offer: null, answer: null, ice_candidates: [] })
          .eq("session_id", transportSessionId.toUpperCase());
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }

      await buildTransport(
        localStreamRef.current,
        studioAudioContextRef.current as AudioContext
      );
    };

    const initNetworkSession = async () => {
      if (studioSessionReservedRef.current) return;
      if (bridgeInitInFlightRef.current) return;
      bridgeInitInFlightRef.current = true;
      try {
        const url = new URL(window.location.href);
        const forceRelay = url.searchParams.get("relay") === "true";
        // Host only when `room` query is absent. `?room=` (empty) is a guest URL with invalid code.
        const roomParamRaw = url.searchParams.get("room");
        const isHost = roomParamRaw === null;
        const sessionIdCandidate = isHost
          ? randomSessionId()
          : normalizeStudioSessionId(roomParamRaw ?? "").toUpperCase();
        if (!isHost && sessionIdCandidate.length !== 6) {
          throw new Error("Invalid room code. Expected 6 characters.");
        }
        const sessionId = sessionIdCandidate.toUpperCase();

        if (!isHost) {
          if (!cancelled && mountedRef.current) {
            setSessionId(sessionId);
          }
        } else {
          cleanupSessionRef.current = async () => {
            addLog("Cleaning up studio_sessions row...");
            await supabase
              .from("studio_sessions")
              .delete()
              .eq("session_id", sessionId.toUpperCase());
          };

          console.log(
            "DEBUG: Attempting Supabase Upsert for session (reservation):",
            sessionId.toUpperCase()
          );
          const { error: reserveErr } = await supabase.from("studio_sessions").upsert(
            { session_id: sessionId.toUpperCase() },
            { onConflict: "session_id" }
          );
          if (reserveErr) {
            console.error("DEBUG: Upsert Failed (reservation):", reserveErr);
            throw reserveErr;
          }

          if (!cancelled && mountedRef.current) {
            const hostUrlSynced = new URL(window.location.href);
            hostUrlSynced.searchParams.set("room", sessionId.toUpperCase());
            setInviteLink(hostUrlSynced.toString());
            window.history.replaceState(null, "", hostUrlSynced.toString());
            setSessionId(sessionId);
          }
        }

        const activeRole: Role = isHost ? "host" : "peer";
        bridgeActiveRoleRef.current = activeRole;
        setRole(activeRole);
        const { data: authData } = await supabase.auth.getUser();
        sessionUserId = authData.user?.id ?? null;

        if (isHost) {
          addLog("Phase 2: host full upsert studio_sessions");
          setStatusNote("Room Created. Waiting in Lobby...");

          console.log(
            "DEBUG: Attempting Supabase Upsert for session (full row):",
            sessionId.toUpperCase()
          );
          const { error: insertErr } = await supabase.from("studio_sessions").upsert(
            {
              session_id: sessionId.toUpperCase(),
              offer: null,
              answer: null,
              ice_candidates: [],
            },
            { onConflict: "session_id" }
          );
          if (insertErr) {
            console.error("DEBUG: Upsert Failed (full row):", insertErr);
            throw insertErr;
          }
        } else {
          addLog("Phase 2: guest fetch studio_sessions");
          setStatusNote("Room Joined. Waiting in Lobby...");

          let { data: fetched, error: fetchErr } = await supabase
            .from("studio_sessions")
            .select("session_id, offer, answer, ice_candidates, host_user_id")
            .eq("session_id", sessionId.toUpperCase())
            .single<StudioSessionRow>();

          if (fetchErr || !fetched) throw new Error("Room not found.");

          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (user?.id && fetched.host_user_id && user.id === fetched.host_user_id) {
            localMicStreamRef.current?.getTracks().forEach((t) => t.stop());
            localStreamRef.current = null;
            if (localMonitorAudioRef.current) {
              localMonitorAudioRef.current.srcObject = null;
            }
            if (mountedRef.current) {
              setLocalMicStream(null);
              setStatus("failed");
              setStatusNote("You cannot join your own session as a guest.");
              window.alert("You cannot join your own session as a guest.");
            }
            return;
          }

          existingRowRef.current = fetched;
        }

        if (cancelled || !mountedRef.current) {
          localMicStreamRef.current?.getTracks().forEach((track) => track.stop());
          localStreamRef.current = null;
          if (mountedRef.current) setLocalMicStream(null);
          return;
        }

        // —— Phase 3: Realtime + WebRTC ——
        transportSessionId = sessionId;
        transportActiveRole = activeRole;
        transportIsHost = isHost;
        transportForceRelay = forceRelay;
        studioSessionReservedRef.current = true;
      } finally {
        bridgeInitInFlightRef.current = false;
      }
    };
    initNetworkSessionRef.current = initNetworkSession;

    const init = async () => {
      if (bridgeInitInFlightRef.current) return;
      bridgeInitInFlightRef.current = true;
      let mediaStream: MediaStream | null = null;

      try {
        addLog("Bridge init started (linear)");
        p2pConnectSucceededRef.current = false;
        setError(null);
        setStatusNote("Initializing session...");
        setMicPermissionDenied(false);
        if (cancelled || !mountedRef.current) return;

        // —— Phase 1: mic only. Phase 1b (after success below) reserves room + sessionId for Pre-Flight UI. ——
        setStatusNote("Syncing microphone...");
        micSyncTimeout = window.setTimeout(() => {
          if (!mountedRef.current || cancelled || localStreamRef.current) return;
          setMicSyncTimedOut(true);
          setStatusNote("Microphone sync timed out.");
        }, 5000);

        addLog("Phase 1: getUserMedia (audio only)");
        try {
          if (!mixerMasterDestinationRef.current) {
            mediaStream = await acquireStudioMicStream({ echoSafetyMode });
          } else {
            mediaStream = localStreamRef.current;
          }
        } catch (micErr) {
          console.error(micErr);
          addLog("Microphone blocked or unavailable");
          micDeniedThisInitRef.current = true;
          if (mountedRef.current) {
            setMicPermissionDenied(true);
            if (isMicPermissionDeniedError(micErr)) {
              setStatus("failed");
              setMicSyncTimedOut(false);
              setStatusNote(MIC_ACCESS_DENIED_COPY);
              setMicPermissionHint(MIC_ACCESS_DENIED_COPY);
            } else {
              setMicPermissionHint(
                "Microphone Access Denied. Please click the camera icon in your browser address bar to reset."
              );
              setStatusNote("Microphone Required.");
            }
          }
          if (isMicPermissionDeniedError(micErr)) {
            return;
          }
          throw new Error("Microphone permission is required for the studio bridge.");
        } finally {
          if (micSyncTimeout !== null) {
            clearTimeout(micSyncTimeout);
            micSyncTimeout = null;
          }
        }

        if (cancelled || !mountedRef.current) {
          mediaStream?.getTracks().forEach((track) => track.stop());
          return;
        }

        if (!mediaStream) {
          throw new Error("Microphone stream is unavailable.");
        }
        const audioTracks = mediaStream.getAudioTracks();
        if (audioTracks.length === 0) {
          mediaStream.getTracks().forEach((track) => track.stop());
          throw new Error("Microphone stream has no audio tracks.");
        }
        const deviceId = audioTracks[0]?.getSettings().deviceId || "default";
        activeStreamsMapRef.current.set(deviceId, mediaStream);
        setActiveDeviceIds((prev) => (prev.includes(deviceId) ? prev : [...prev, deviceId]));
        void rebuildMixerAndReplaceTrack();

        micStream = mediaStream;
        if (!mixerMasterDestinationRef.current) {
          localStreamRef.current = mediaStream;
        }
        if (mountedRef.current) {
          setMicSyncTimedOut(false);
          setLocalMicStream(mediaStream);
          void refreshAudioInputDevices();
        }

        const localEl = localMonitorAudioRef.current;
        if (localEl) {
          localEl.srcObject = mediaStream;
          localEl.muted = true;
          await localEl.play().catch(() => {});
        }

        if (cancelled || !mountedRef.current) {
          micStream.getTracks().forEach((track) => track.stop());
          micStream = null;
          localStreamRef.current = null;
          if (mountedRef.current) setLocalMicStream(null);
          return;
        }

        bridgeInitInFlightRef.current = false;
        sessionBootstrapPromiseRef.current = (async () => {
          const boot = initNetworkSessionRef.current;
          if (boot) await boot();
        })();
        try {
          await sessionBootstrapPromiseRef.current;
        } catch (netErr) {
          console.error("Early studio session bootstrap failed:", netErr);
          if (mountedRef.current && !cancelled) {
            setStatusNote(
              "Could not reserve the jam room yet. Check your connection; you can retry when you enter the studio."
            );
          }
        } finally {
          sessionBootstrapPromiseRef.current = null;
        }

      } catch (error) {
        if (cancelled || !mountedRef.current) return;
        console.error("CRITICAL BRIDGE ERROR:", error);
        window.setTimeout(() => {
          if (!mountedRef.current || cancelled) return;
          if (statusRef.current === "connected" || p2pConnectSucceededRef.current) return;
          setStatus((prev) => prev === "connected" ? prev : "failed");
          setError((prev) => prev ?? "Could not initialize studio signaling bridge.");
        }, 1500);
      } finally {
        bridgeInitInFlightRef.current = false;
      }
    };

    void init();

    return () => {
      bridgeInitInFlightRef.current = false;
      bridgeTeardownRef.current = null;
      buildTransportRef.current = null;
      initNetworkSessionRef.current = null;
      startP2PEngineRef.current = null;
      micStream?.getTracks().forEach((t) => t.stop());
      performTeardown();
    };
  }, [
    beginLostCountdown,
    clearLostCountdown,
    cleanupKiteEngine,
    restoreLiveVoipTrackAfterKite,
    retryInitTick,
    stopKiteMetronome,
    teardownKiteSyncTransport,
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

  const registerMixerMeterElement = useCallback((laneKey: string, el: HTMLDivElement | null) => {
    if (el) {
      perChannelMeterRefs.current.set(laneKey, el);
    } else {
      perChannelMeterRefs.current.delete(laneKey);
    }
  }, []);

  const registerMasterLiveMeterElement = useCallback((el: HTMLDivElement | null) => {
    masterLiveMeterElementRef.current = el;
  }, []);

  const renderVisualMetronomeControls = () => (
    <>
      {!stealthBroadcastUiLock ? (
        <button
          type="button"
          title="Use if you don't have headphones!"
          onClick={() => setIsVisualMetronomeOnly((prev) => !prev)}
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
        <FourBeatMetronome activeBeat={visualActiveBeatInBar} />
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
        {!useV4LooperUi ? (
          <motion.button
            type="button"
            onClick={returnToLobby}
            className="mb-6 inline-flex w-fit items-center gap-1 rounded-lg border border-white/[0.12] bg-white/[0.03] px-2.5 py-2 text-left text-xs font-medium text-white/55 transition hover:border-orange-500/25 hover:border-emerald-500/20 hover:bg-white/[0.05] hover:text-white/80"
            whileTap={{ scale: 0.97 }}
            aria-label="Return to lobby"
          >
            <ChevronLeft className="h-4 w-4 shrink-0 opacity-70" strokeWidth={2} aria-hidden />
            <span>Return to Lobby</span>
          </motion.button>
        ) : null}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
          className="w-full"
        >
          {!useV4LooperUi ? (
            <>
              <h1 className="bg-gradient-to-r from-orange-400 via-stone-100 to-emerald-400 bg-clip-text text-center text-3xl font-bold tracking-tight text-transparent">
                Kite Studio
              </h1>
              <p className="mt-2 text-center text-xs font-semibold uppercase tracking-widest text-stone-500">
                Pre-flight check
              </p>
              <div className="mt-4 flex justify-center">
                <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-300">
                  Standard P2P Signaling
                </span>
              </div>
            </>
          ) : null}

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
            <div
              className="relative flex min-h-screen w-full flex-col overflow-hidden bg-stone-950 font-sans antialiased caret-transparent outline-none select-none"
              style={{ fontFamily: "'Sora', 'DM Sans', system-ui, sans-serif" }}
            >
              <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
                <div className="absolute -top-24 left-0 h-[34rem] w-[34rem] rounded-full bg-orange-500/[0.1] blur-3xl" />
                <div className="absolute top-1/3 right-0 h-[30rem] w-[30rem] rounded-full bg-emerald-500/[0.09] blur-3xl" />
                <div className="absolute bottom-0 left-1/3 h-[26rem] w-[26rem] rounded-full bg-orange-500/[0.06] blur-3xl" />
                <div className="absolute top-1/2 left-1/2 h-[22rem] w-[22rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/[0.05] blur-3xl" />
                <div
                  className="absolute inset-0 opacity-[0.015]"
                  style={{
                    backgroundImage:
                      "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
                    backgroundSize: "48px 48px",
                  }}
                />
              </div>

              <header className="relative shrink-0 px-4 py-5 md:px-8 md:py-6">
                <div className="flex w-full items-center gap-4 md:gap-8">
                  <motion.button
                    type="button"
                    onClick={returnToLobby}
                    className="shrink-0 rounded-xl border border-white/[0.14] bg-stone-900/70 px-4 py-2.5 text-sm font-semibold text-stone-300 shadow-sm transition-all hover:border-orange-500/35 hover:bg-orange-500/8 hover:text-white focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                    whileTap={{ scale: 0.97 }}
                    aria-label="Return to lobby"
                  >
                    <ChevronLeft className="mr-1 inline h-4 w-4 align-[-3px] opacity-70" strokeWidth={2} aria-hidden />
                    return to lobby
                  </motion.button>

                  <div className="flex flex-1 items-center justify-center gap-3 md:gap-4">
                    <h1 className="bg-gradient-to-r from-orange-400 via-orange-300 to-emerald-400 bg-clip-text text-2xl font-black tracking-tight text-transparent md:text-4xl">
                      Kite Studio
                    </h1>
                    <span className="rounded-lg border border-emerald-500/40 bg-emerald-500/12 px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-emerald-400 md:px-3 md:py-1.5 md:text-xs">
                      Preflight
                    </span>
                  </div>

                  <div className="hidden w-[168px] shrink-0 md:block" aria-hidden />
                </div>
              </header>

              <main className="relative flex min-h-0 w-full flex-1 flex-col px-4 py-4 md:px-6 md:py-5">
                {micPermissionDenied ? (
                  <div role="alert" className="mb-6 flex items-start gap-3 rounded-xl border border-orange-500/25 bg-orange-500/8 px-4 py-3.5">
                    <div>
                      <p className="text-sm font-semibold text-orange-300">Microphone Access Denied</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-stone-400">
                        {micPermissionHint ||
                          "Please allow microphone access in your browser or system settings, then reload this page."}
                      </p>
                    </div>
                  </div>
                ) : null}

                {micSyncTimedOut && !localMicStream ? (
                  <div role="alert" className="mb-6 flex items-start justify-between gap-3 rounded-xl border border-white/[0.08] bg-stone-800/60 px-4 py-3.5">
                    <div>
                      <p className="text-sm font-semibold text-stone-300">Microphone Sync Timeout</p>
                      <p className="mt-0.5 text-xs text-stone-500">Could not detect your mic within the expected time.</p>
                    </div>
                    <motion.button
                      type="button"
                      onClick={() => setRetryInitTick((n) => n + 1)}
                      whileTap={{ scale: 0.97 }}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-orange-500/30 px-3 py-1.5 text-xs font-semibold text-orange-400 transition-all hover:bg-orange-500/10 focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                    >
                      Retry
                    </motion.button>
                  </div>
                ) : null}

                <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[45fr_55fr] lg:items-stretch">
                  <section
                    aria-labelledby="preflight-heading"
                    className="flex h-full min-h-[360px] flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-stone-900/50 backdrop-blur-sm lg:min-h-0"
                  >
                    <div className="flex shrink-0 items-center justify-between border-b border-white/[0.05] px-5 py-4">
                      <div>
                        <h2 id="preflight-heading" className="text-sm font-bold tracking-tight text-white">
                          System Readiness
                        </h2>
                        <p className="mt-px text-[11px] text-stone-500">All checks must pass before entering</p>
                      </div>
                      <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                        micRowState === "done" && audioRowState === "done" && connRowState === "done"
                          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
                          : micRowState === "error" || audioRowState === "error" || connRowState === "error"
                            ? "border-orange-500/25 bg-orange-500/10 text-orange-400"
                            : "border-white/[0.06] bg-stone-800/60 text-stone-400"
                      }`}>
                        <span
                          className={`inline-block h-2 w-2 rounded-full ${
                            micRowState === "done" && audioRowState === "done" && connRowState === "done"
                              ? "animate-pulse bg-emerald-400"
                              : "bg-stone-600"
                          }`}
                          aria-hidden="true"
                        />
                        {micRowState === "done" && audioRowState === "done" && connRowState === "done"
                          ? "All Ready"
                          : micRowState === "error" || audioRowState === "error" || connRowState === "error"
                            ? "Action Required"
                            : "Checking..."}
                      </div>
                    </div>

                    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
                      <div className={`flex min-h-0 flex-1 flex-col rounded-xl border p-4 ${
                        micRowState === "done"
                          ? "border-emerald-500/25 bg-emerald-500/[0.06]"
                          : micRowState === "error"
                            ? "border-orange-500/25 bg-orange-500/[0.06]"
                            : "border-white/[0.08] bg-white/[0.02]"
                      }`}>
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className={`flex items-center gap-2 ${
                            micRowState === "done" ? "text-emerald-400" : micRowState === "error" ? "text-orange-400" : "text-stone-500"
                          }`}>
                            <Mic className="h-4 w-4" aria-hidden />
                            <span className="text-sm font-semibold text-white/90">Microphone</span>
                          </div>
                          <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${
                            micRowState === "done"
                              ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                              : micRowState === "error"
                                ? "border-orange-500/30 bg-orange-500/15 text-orange-400"
                                : "border-stone-600/40 bg-stone-700/60 text-stone-400"
                          }`}>
                            {micRowState === "done" ? "Ready" : micRowState === "error" ? "Error" : "Checking"}
                          </span>
                        </div>
                        <div className="flex min-h-0 w-full flex-1 items-center justify-center rounded-xl border border-emerald-500/10 bg-black/20 p-2">
                          <div className="mx-auto w-1/2 max-w-[200px] min-w-[140px]">
                            <MicLevelBars stream={localMicStream} />
                          </div>
                        </div>
                      </div>

                      <div className={`flex min-h-0 flex-1 flex-col rounded-xl border p-4 ${
                        audioRowState === "done"
                          ? "border-emerald-500/25 bg-emerald-500/[0.06]"
                          : audioRowState === "error"
                            ? "border-orange-500/25 bg-orange-500/[0.06]"
                            : "border-white/[0.08] bg-white/[0.02]"
                      }`}>
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className={`flex items-center gap-2 ${
                            audioRowState === "done" ? "text-emerald-400" : audioRowState === "error" ? "text-orange-400" : "text-stone-500"
                          }`}>
                            <Volume2 className="h-4 w-4" aria-hidden />
                            <span className="text-sm font-semibold text-white/90">Speaker</span>
                          </div>
                          <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${
                            audioRowState === "done"
                              ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                              : audioRowState === "error"
                                ? "border-orange-500/30 bg-orange-500/15 text-orange-400"
                                : "border-stone-600/40 bg-stone-700/60 text-stone-400"
                          }`}>
                            {audioRowState === "done" ? "Ready" : audioRowState === "error" ? "Error" : "Checking"}
                          </span>
                        </div>
                        <div className="flex min-h-0 flex-1 items-stretch">
                          {audioRowState === "done" ? (
                            <div className="flex h-full min-h-[3rem] w-full flex-1 items-center justify-center rounded-xl border border-emerald-500/20 bg-black/20 px-4 py-2 text-sm font-semibold text-emerald-300 shadow-inner shadow-emerald-950/20">
                              Audio output confirmed
                            </div>
                          ) : (
                            <motion.button
                              type="button"
                              onClick={() => void runAudioTest()}
                              disabled={audioTestPlaying}
                              whileTap={audioTestPlaying ? undefined : { scale: 0.97 }}
                              className={`flex h-full min-h-[3rem] w-full flex-1 items-center justify-center gap-1.5 rounded-xl border bg-black/20 px-4 py-2 text-sm font-semibold shadow-inner shadow-orange-950/20 transition-all focus:outline-none focus:ring-2 focus:ring-orange-500/30 ${
                                audioTestPlaying
                                  ? "cursor-not-allowed border-white/[0.08] text-stone-500"
                                  : "border-orange-500/25 text-orange-400 hover:border-orange-500/40 hover:bg-orange-500/8"
                              }`}
                            >
                              {audioTestPlaying ? "Playing..." : "tap to test audio"}
                            </motion.button>
                          )}
                        </div>
                      </div>

                      <div className={`flex min-h-0 flex-1 flex-col rounded-xl border p-4 ${
                        connRowState === "done"
                          ? "border-emerald-500/25 bg-emerald-500/[0.06]"
                          : connRowState === "error"
                            ? "border-orange-500/25 bg-orange-500/[0.06]"
                            : "border-white/[0.08] bg-white/[0.02]"
                      }`}>
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className={`flex items-center gap-2 ${
                            connRowState === "done" ? "text-emerald-400" : connRowState === "error" ? "text-orange-400" : "text-stone-500"
                          }`}>
                            <span className="text-sm font-semibold text-white/90">Kite Signal</span>
                          </div>
                          <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${
                            connRowState === "done"
                              ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                              : connRowState === "error"
                                ? "border-orange-500/30 bg-orange-500/15 text-orange-400"
                                : "border-stone-600/40 bg-stone-700/60 text-stone-400"
                          }`}>
                            {connRowState === "done" ? "Ready" : connRowState === "error" ? "Error" : "Checking"}
                          </span>
                        </div>
                        <div className="flex h-full min-h-[3rem] w-full flex-1 items-center justify-center rounded-lg border border-dashed border-white/[0.08] bg-white/[0.01] px-3">
                          <span className={`text-xs ${
                            connRowState === "done" ? "text-emerald-400/80" : connRowState === "error" ? "text-orange-400/80" : "text-stone-600"
                          }`}>
                            {connRowState === "done"
                              ? pingMs === null
                                ? "Relay connected"
                                : `Relay connected · ${pingMs} ms`
                              : connRowState === "error"
                                ? kiteErrorCopy
                                : kitePendingCopy}
                          </span>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="grid h-full min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-2xl border border-white/[0.07] bg-stone-900/50 backdrop-blur-sm max-lg:min-h-[360px] md:grid-cols-2">
                    <div className="flex min-h-0 flex-col gap-5 border-b border-white/[0.05] p-6 md:border-b-0 md:border-r">
                      <div>
                        <h2 className="text-sm font-bold tracking-tight text-white">Session</h2>
                        <p className="mt-1 text-[11px] leading-relaxed text-stone-500">
                          Share the room code with your collaborator.
                        </p>
                      </div>

                      <motion.button
                        type="button"
                        onClick={() => void copyRoomCode()}
                        className="w-full rounded-xl border border-white/[0.08] bg-stone-950/50 px-4 py-5 text-center transition-all hover:border-emerald-500/30 hover:bg-stone-950/70 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                        whileTap={{ scale: 0.98 }}
                      >
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">Room code</p>
                        <p className="mt-1 font-mono text-xl font-bold tracking-wider text-white">{sessionId?.toUpperCase() ?? "------"}</p>
                        {roomCopyNote ? (
                          <p className="mt-1 text-xs font-semibold text-emerald-300/90" role="status">
                            {roomCopyNote}
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-stone-500">tap to copy</p>
                        )}
                      </motion.button>

                      <div className="px-1 py-2">
                        <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-stone-600">Before you enter</p>
                        <ul className="space-y-2 text-sm leading-relaxed text-stone-400">
                          <li className="flex items-center gap-2">
                            <span className="h-2 w-2 rotate-45 rounded-[1px] bg-emerald-400 shadow-[0_0_12px_rgba(34,197,94,0.65)]" aria-hidden />
                            <span>use wired headphones</span>
                          </li>
                          <li className="flex items-center gap-2">
                            <span className="h-2 w-2 rotate-45 rounded-[1px] bg-emerald-400 shadow-[0_0_12px_rgba(34,197,94,0.65)]" aria-hidden />
                            <span>calibrate before looping</span>
                          </li>
                          <li className="flex items-center gap-2">
                            <span className="h-2 w-2 rotate-45 rounded-[1px] bg-emerald-400 shadow-[0_0_12px_rgba(34,197,94,0.65)]" aria-hidden />
                            <span>Ethernet for best performance</span>
                          </li>
                        </ul>
                      </div>
                    </div>

                    <div className="flex min-h-0 flex-col gap-4 p-6">
                      <div>
                        <h2 className="text-sm font-bold tracking-tight text-white">Session Actions</h2>
                        <p className="mt-1 text-[11px] leading-relaxed text-stone-500">
                          {canEnterStudio
                            ? "All checks passed. You're ready to enter."
                            : "Complete preflight checks to enable session entry."}
                        </p>
                      </div>

                      <motion.button
                        type="button"
                        onClick={handleEnterStudio}
                        disabled={!canEnterStudio}
                        aria-label="Jam with a friend"
                        whileTap={canEnterStudio ? { scale: 0.97 } : undefined}
                        className={`flex flex-1 items-center justify-center gap-3 rounded-2xl px-6 py-8 text-base font-bold tracking-tight transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-orange-500/40 ${
                          canEnterStudio
                            ? "bg-gradient-to-r from-orange-500 to-emerald-500 text-white shadow-lg shadow-orange-500/25 hover:scale-[1.01] hover:shadow-orange-500/40 active:scale-[0.99]"
                            : "cursor-not-allowed border border-white/[0.05] bg-stone-800/60 text-stone-600"
                        }`}
                      >
                        {canEnterStudio ? "Jam with a friend" : "Waiting for Preflight..."}
                      </motion.button>

                      <motion.button
                        type="button"
                        onClick={handleEnterSoloStudio}
                        disabled={!canPracticeAlone}
                        aria-label="Kite loopstation"
                        whileTap={canPracticeAlone ? { scale: 0.97 } : undefined}
                        className={`flex flex-[1.35] items-center justify-center gap-2.5 rounded-2xl border px-6 py-10 text-lg font-semibold tracking-tight transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 ${
                          canPracticeAlone
                            ? "border-emerald-500/30 text-emerald-400 hover:border-emerald-500/50 hover:bg-emerald-500/8 active:scale-[0.99]"
                            : "cursor-not-allowed border-white/[0.06] text-stone-600"
                        }`}
                      >
                        Kite loopstation
                      </motion.button>
                    </div>
                  </section>
                </div>
              </main>

              <footer className="relative flex shrink-0 items-center justify-between border-t border-white/[0.04] px-4 py-3 md:px-6">
                <span className="text-[10px] text-stone-700">Kite Studio © 2025</span>
                <span className="text-[10px] text-stone-700">Preflight v2 · Stable</span>
              </footer>
            </div>
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
                        Count the chords in one cycle. Don&apos;t overthink — just count what
                        you&apos;d play before starting over.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                      {[
                        { count: 2, label: "I–V vamp" },
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
                      Tap 4+ times — resets after 2 seconds of silence
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
                      {kiteSetupIsSwing ? " swing" : ""} — each bar has{" "}
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
              {kiteMode === "solo" ? (
                <>
                  {!useV4LooperUi ? (
                    <div className="caret-transparent outline-none select-none">
                    <KiteLoopV2Panel
                      soloLooperState={soloLooperState}
                      isRecordingArmed={isRecordingArmed}
                      isMasterPaused={isMasterPaused}
                      sessionRecorderState={soloSessionRecorderState}
                      recordingArmedCountdown={recordingArmedCountdown}
                      runwayDisplay={soloRunwayDisplay}
                      runwayPhase={isRecordingArmed ? "armed" : "idle"}
                      runwayVisualOnly={isVisualMetronomeOnly}
                      loopProgress={loopProgress}
                      kiteIntervalTimingRef={kiteIntervalTimingRef}
                      kiteSetupTempo={kiteSetupTempo}
                      kiteSetupTimeSignatureTop={kiteSetupTimeSignatureTop}
                      kiteSetupTimeSignatureBottom={kiteSetupTimeSignatureBottom}
                      kiteSetupIsSwing={kiteSetupIsSwing}
                      isTimingLocked={isRecordingArmed || soloLooperState !== "idle"}
                      loopMode={soloLooperMode}
                      barCount={soloLooperBarCount}
                      latencyMs={soloLooperLatencyMs}
                      visualMetronomeControls={renderVisualMetronomeControls()}
                      onLoopModeChange={setSoloLooperMode}
                      onBarCountChange={setSoloLooperBarCount}
                      onLatencyMsChange={handleSoloLatencyMsChange}
                      onTempoSliderChange={(v) => {
                        setKiteSetupTempo(v);
                        broadcastWizardStudioParam({ kiteSetupTempo: v, bpm: v });
                      }}
                      onTempoPreset={(bpm) => {
                        setKiteSetupTempo(bpm);
                        broadcastWizardStudioParam({
                          kiteSetupTempo: bpm,
                          bpm,
                        });
                      }}
                      onSelectTimeSignature={(option) => {
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
                      onRecordFirstLoop={handleRecordFirstLoop}
                      onToggleMasterPause={handleToggleMasterPause}
                      onToggleSessionRecording={handleToggleSoloSessionRecording}
                      onStopAndResetSoloLooper={handleStopAndResetSoloLooper}
                      soloTrackLanes={soloTrackLanes}
                    />
                    </div>
                  ) : null}
                </>
              ) : status === "connected" ? (
                <div className="relative">
                {kiteMode === "broadcast" ? (
                  <BroadcastDashboard />
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
                          onClick={() => {
                              const next = !kiteSyncEnabled;
                              console.log("Kite Sync Toggle Clicked. New State:", next);
                              if (next) {
                                const ctx = studioAudioContextRef.current;
                                if (ctx) {
                                  flushAndSetRemoteGridTarget(ctx.currentTime + 0.01);
                                  const countInOneBarSec = (60 / metronomeBpm) * Math.max(1, Math.round(kiteSetupTimeSignatureTop));
                                  if (Number.isFinite(countInOneBarSec) && countInOneBarSec > 0) {
                                    kiteSyncCountInEndAtContextSecRef.current =
                                      ctx.currentTime + countInOneBarSec;
                                    if (metronomeGainRef.current) {
                                      metronomeGainRef.current.gain.value = 0;
                                    }
                                    setKiteSyncCountInActive(true);
                                    kiteSyncCountInActiveRef.current = true;
                                    kiteSyncCountInCompletionHandledRef.current = false;
                                  }
                                }
                                syncInitiatorIdRef.current = localJamSetupOwnerId;
                                if (mountedRef.current) {
                                  setSyncInitiatorId(localJamSetupOwnerId);
                                }
                              } else {
                                if (!canControlStop) return;
                                cleanupKiteEngine({ stopLocalTracks: false, isFull: false });

                                restoreLiveVoipTrackAfterKite();

                                const remoteStream = remoteStreamRef.current;
                                if (remoteStream) {
                                  buildRemotePlaybackGraph(remoteStream);
                                }
                                syncInitiatorIdRef.current = null;
                                if (mountedRef.current) {
                                  setSyncInitiatorId(null);
                                }
                              }
                              setKiteSyncEnabled(next);
                              setBroadcastStatus(next ? "syncing" : "idle");
                              broadcastKiteSync({ kiteSyncEnabled: next });
                            }}
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
                          onClick={() => setIsBufferingEnabled((prev) => !prev)}
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
                          onClick={() => setEchoSafetyMode((prev) => !prev)}
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
                          ⚠️ Headphones Required for Sync Buffer. If using speakers, enable Echo Safety.
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
                            onChange={onMetronomeVolumeChange}
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
                        onChange={onRemotePlaybackVolumeChange}
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
                        Latency has stayed high. Try a different network, switch to Wi‑Fi, or move
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

          {!useV4LooperUi && collaboratorLeft ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 rounded-xl border border-orange-500/25 bg-stone-900/50 px-4 py-4 text-center"
            >
              <p className="text-sm font-semibold text-stone-200">
                {(lastDepartedParticipantName ?? "A participant")} left the session.
              </p>
              <motion.button
                type="button"
                onClick={returnToLobby}
                whileTap={{ scale: 0.97 }}
                className="mt-4 w-full rounded-xl border border-orange-500/35 bg-gradient-to-r from-orange-500/15 to-stone-700/20 px-4 py-3 text-sm font-semibold text-stone-100 transition hover:from-orange-500/25 hover:to-stone-700/30"
              >
                Return to Lobby
              </motion.button>
            </motion.div>
          ) : null}

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
      {!stealthBroadcastUiLock && !useV4LooperUi ? (
      <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
        <motion.button
          type="button"
          onClick={() => setDevicePanelOpen((prev) => !prev)}
          whileTap={{ scale: 0.97 }}
          className="pointer-events-auto rounded-lg border border-stone-700/90 bg-stone-950/85 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-stone-200 transition hover:border-emerald-500/45 hover:text-emerald-200"
          aria-expanded={devicePanelOpen}
          aria-controls="audio-input-panel"
        >
          {devicePanelOpen ? "Hide Inputs" : "Audio Inputs"}
        </motion.button>
        {devicePanelOpen ? (
          <div
            id="audio-input-panel"
            className="pointer-events-auto w-[17rem] rounded-xl border border-stone-700/90 bg-stone-950/95 p-3 shadow-2xl backdrop-blur-sm"
          >
            <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">
              Input Device
            </p>
            <div className="mt-2 max-h-52 space-y-1.5 overflow-y-auto pr-1">
              {audioInputDevices.length > 0 ? (
                audioInputDevices.map((device) => {
                  const deviceId = device.deviceId;
                  const isSelected = activeDeviceIds.includes(deviceId);
                  const isInterfaceInput = interfaceInputDeviceFlags[deviceId] === true;
                  const isInterfaceMonitorEnabled =
                    isInterfaceInput && interfaceLiveMonitorEnabledFlags[deviceId] === true;
                  const inputChannels = deviceInputChannelCount[deviceId] ?? 1;
                  const lane0Key = `${deviceId}:ch0`;
                  const lane1Key = `${deviceId}:ch1`;
                  const volCh0 = deviceVolumes[lane0Key] ?? 100;
                  const volCh1 = deviceVolumes[lane1Key] ?? 100;
                  return (
                    <div key={deviceId || `audio-input-${device.label}`} className="space-y-1.5">
                      <button
                        type="button"
                        onClick={() => void toggleAudioDevice(deviceId)}
                        className={`w-full rounded-lg border px-2.5 py-2 text-left text-xs font-medium transition ${
                          isSelected
                            ? "border-emerald-500/45 bg-emerald-500/10 text-emerald-200"
                            : "border-stone-700 bg-stone-900/65 text-stone-300 hover:border-stone-600"
                        }`}
                      >
                        {device.label || "Unnamed input device"}
                      </button>
                      {isSelected ? (
                        <div className="rounded-lg border border-stone-700/80 bg-stone-900/70 px-2 py-1.5">
                          <div className="mb-1.5 space-y-1">
                            <div className="h-1.5 w-full overflow-hidden rounded bg-stone-800">
                              <div
                                ref={(el) => {
                                  const laneKey = `${deviceId}:ch0`;
                                  if (el) perChannelMeterRefs.current.set(laneKey, el);
                                  else perChannelMeterRefs.current.delete(laneKey);
                                }}
                                className="h-full w-0 rounded bg-emerald-500 transition-[width] duration-75"
                              />
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded bg-stone-800">
                              <div
                                ref={(el) => {
                                  const laneKey = `${deviceId}:ch1`;
                                  if (el) perChannelMeterRefs.current.set(laneKey, el);
                                  else perChannelMeterRefs.current.delete(laneKey);
                                }}
                                className="h-full w-0 rounded bg-emerald-500/80 transition-[width] duration-75"
                              />
                            </div>
                          </div>
                          {inputChannels >= 2 ? (
                            <div className="space-y-2">
                              <div>
                                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                                  Input 1 / L — {volCh0}
                                </label>
                                <input
                                  type="range"
                                  min={0}
                                  max={100}
                                  step={1}
                                  value={volCh0}
                                  onChange={(e) =>
                                    handleVolumeChange(
                                      lane0Key,
                                      Number.parseInt(e.target.value, 10)
                                    )
                                  }
                                  className="w-full accent-emerald-500"
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                                  Input 2 / R — {volCh1}
                                </label>
                                <input
                                  type="range"
                                  min={0}
                                  max={100}
                                  step={1}
                                  value={volCh1}
                                  onChange={(e) =>
                                    handleVolumeChange(
                                      lane1Key,
                                      Number.parseInt(e.target.value, 10)
                                    )
                                  }
                                  className="w-full accent-emerald-500"
                                />
                              </div>
                            </div>
                          ) : (
                            <>
                              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                                Volume {volCh0}
                              </label>
                              <input
                                type="range"
                                min={0}
                                max={100}
                                step={1}
                                value={volCh0}
                                onChange={(e) =>
                                  handleVolumeChange(
                                    lane0Key,
                                    Number.parseInt(e.target.value, 10)
                                  )
                                }
                                className="w-full accent-emerald-500"
                              />
                            </>
                          )}
                          <div className="mt-2 space-y-2 rounded-lg border border-stone-800/90 bg-stone-950/45 px-2 py-2">
                            <label className="flex items-start gap-2 text-[11px] leading-snug text-stone-300">
                              <input
                                type="checkbox"
                                checked={isInterfaceInput}
                                onChange={(event) =>
                                  setInterfaceInputDeviceFlag(deviceId, event.target.checked)
                                }
                                className="mt-0.5 accent-emerald-500"
                              />
                              <span>
                                <span className="block font-semibold text-stone-200">
                                  Interface / line-in source
                                </span>
                                <span className="text-stone-500">
                                  Mark this only for plugged-in instruments or interface outputs.
                                </span>
                              </span>
                            </label>
                            <label
                              className={`flex items-start gap-2 text-[11px] leading-snug ${
                                isInterfaceInput ? "text-stone-300" : "text-stone-600"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isInterfaceMonitorEnabled}
                                disabled={!isInterfaceInput}
                                onChange={(event) =>
                                  setInterfaceLiveMonitorEnabledFlag(deviceId, event.target.checked)
                                }
                                className="mt-0.5 accent-emerald-500 disabled:accent-stone-700"
                              />
                              <span>
                                <span className="block font-semibold">Live monitor</span>
                                <span>
                                  Hear this interface input locally. Use headphones to avoid feedback.
                                </span>
                              </span>
                            </label>
                            {isInterfaceMonitorEnabled ? (
                              <p className="rounded border border-yellow-500/30 bg-yellow-500/10 px-2 py-1 text-[10px] font-medium leading-snug text-yellow-100">
                                Headphones recommended. This control only marks the monitor setting;
                                the audio graph is added in the next plan step.
                              </p>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <div className="rounded-lg border border-stone-800 bg-stone-900/60 px-2.5 py-2 text-xs text-stone-400">
                  <p>No devices found.</p>
                  <button
                    type="button"
                    onClick={() => void refreshAudioInputDevices()}
                    className="mt-2 rounded border border-stone-700 px-2 py-1 text-[11px] font-medium text-stone-300 hover:border-stone-600"
                  >
                    Click to load devices
                  </button>
                </div>
              )}
            </div>
            <div className="mt-3 rounded-lg border border-stone-700/80 bg-stone-900/70 px-2.5 py-2 text-[11px] leading-relaxed text-stone-400">
              Pro Tip: Use your interface&apos;s &apos;Direct Monitor&apos; button to hear yourself.
              Kite Studio captures your clean, direct signal for maximum speed. To use virtual
              amps (like Neural DSP), route your audio through Voicemeeter (PC) or Loopback
              (Mac).
            </div>
          </div>
        ) : null}
      </div>
      ) : null}
      {useV4LooperUi &&
      studioUiPhase !== "lobby" &&
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
          inputDevices={{
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
          }}
          metronome={{
            visualMetronomeControls: renderVisualMetronomeControls(),
            currentBeatIndex: visualActiveBeatInBar,
          }}
        />
        </div>
      ) : null}
    </div>
  );
}
