"use client";

import {
  useCallback,
  useEffect,
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
  acquireStudioMicStream,
  applyLowLatencyInboundAudioReceivers,
  checkAudioWorkletSupport,
  decodePeerDataChunk,
  parseSelectedCandidatePairRttMs,
  parseInboundAudioPacketLoss,
  buildPeerConfig,
  fetchTurnCredentials,
} from "@/lib/studio-bridge-webrtc";
import { createMetronomeScheduler, type MetronomeTick } from "@/lib/studio-metronome-schedule";
import { forceMusicModeOpus } from '@/lib/sdp-utils'

type BridgeStatus = "connecting" | "connected" | "failed";
type Role = "host" | "peer";
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
const DEFAULT_REMOTE_PLAYBACK_VOLUME = 2;
const REMOTE_COMPRESSOR_THRESHOLD = -12;
const REMOTE_COMPRESSOR_KNEE      = 6;
const REMOTE_COMPRESSOR_RATIO     = 3;
const REMOTE_COMPRESSOR_ATTACK    = 0.003;
const REMOTE_COMPRESSOR_RELEASE   = 0.1;

/** Studio playback context: prefer minimum buffering; fall back if options unsupported. */
function createStudioAudioContext(): AudioContext {
  try {
    return new AudioContext({ latencyHint: "interactive" });
  } catch {
    return new AudioContext();
  }
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
  const [metronomeBpm, setMetronomeBpm] = useState(120);
  const [beatsPerInterval, setBeatsPerInterval] = useState(16);
  const [highPingTipOpen, setHighPingTipOpen] = useState(false);
  const [localMicStream, setLocalMicStream] = useState<MediaStream | null>(null);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);
  const [micPermissionHint, setMicPermissionHint] = useState<string | null>(null);
  const [micSyncTimedOut, setMicSyncTimedOut] = useState(false);
  const [audioTestDone, setAudioTestDone] = useState(false);
  const [audioTestPlaying, setAudioTestPlaying] = useState(false);
  const [audioTestFailed, setAudioTestFailed] = useState(false);
  const [echoSafetyMode, setEchoSafetyMode] = useState(false);
  const [kiteSignal, setKiteSignal] = useState<KiteSignalState>("checking");
  const [enteredStudio, setEnteredStudio] = useState(false);
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
  const [confirmExitOpen, setConfirmExitOpen] = useState(false);
  const [collaboratorLeft, setCollaboratorLeft] = useState(false);
  const [remoteParticipantName, setRemoteParticipantName] = useState<string | null>(null);
  const [lastDepartedParticipantName, setLastDepartedParticipantName] = useState<string | null>(null);
  const [connectionLostCountdown, setConnectionLostCountdown] = useState<number | null>(null);
  const [retryInitTick, setRetryInitTick] = useState(0);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [audioContextReady, setAudioContextReady] = useState(false);
  /** One-bar count-in after Kite Sync enables; blocks unmute and playback level changes until the grid stabilizes. */
  const [kiteSyncCountInActive, setKiteSyncCountInActive] = useState(false);
  /** Bumps when resuming metronome after network-loss pause (forces scheduler re-init). */
  const [kiteSyncMetronomeResumeNonce, setKiteSyncMetronomeResumeNonce] = useState(0);
  /** True while metronome is stopped due to inbound loss hysteresis (UX hint). */
  const [kiteSyncNetworkMetronomePaused, setKiteSyncNetworkMetronomePaused] = useState(false);
  const [metronomeVolume, setMetronomeVolume] = useState(1);

  const micDeniedThisInitRef = useRef(false);

  const peerRef = useRef<Peer.Instance | null>(null);
  /** Underlying PC for `getStats` polling; cleared with peer teardown. */
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const speakerMutedRef = useRef(false);
  const remotePlaybackVolumeRef = useRef(DEFAULT_REMOTE_PLAYBACK_VOLUME);
  const localMonitorAudioRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
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
  const lostCountdownIntervalRef = useRef<number | null>(null);
  const sessionStartedAtRef = useRef<number | null>(null);
  const historySavedRef = useRef(false);
  /** Prevents overlapping inits; cleared on effect cleanup so remount can proceed. */
  const bridgeInitInFlightRef = useRef(false);
  /** Lazily created; resumed on "Enter Studio" so Safari unlocks audio on a user gesture. */
  const studioAudioContextRef = useRef<AudioContext | null>(null);
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
  const metronomeVolumeRef = useRef(1);
  const metronomeSchedulerRef = useRef<ReturnType<typeof createMetronomeScheduler> | null>(null);
  const metronomeIntervalRef = useRef<number | null>(null);
  const metronomeBlinkQueueRef = useRef<{ startAt: number; isAccent: boolean }[]>([]);
  const metronomeBlinkRafIdRef = useRef<number | null>(null);
  const metronomeBlinkElementRef = useRef<HTMLDivElement | null>(null);
  const highPingStreakRef = useRef(0);
  const highPingTipDismissedRef = useRef(false);
  const calculatedDelayMsRef = useRef<number | null>(null);
  const kiteSyncSequenceRef = useRef(0);
  const pendingKiteSyncRef = useRef<KiteSyncMessage | null>(null);
  const lastAcceptedKiteSyncSeqRef = useRef(0);
  const lastAppliedGuestStartSecRef = useRef<number | null>(null);
  const lastSyncApplyAtMsRef = useRef<number | null>(null);
  const kiteSyncCountInEndAtContextSecRef = useRef(0);
  const kiteSyncCountInRafIdRef = useRef<number | null>(null);
  const kiteSyncLossPauseActiveRef = useRef(false);
  const kiteSyncLossRecoverySinceMsRef = useRef<number | null>(null);
  const applyKiteSyncLossGuardRef = useRef<(packetLossPercent: number | null) => void>(
    () => {}
  );
  const echoModeApplyingRef = useRef(false);
  const isMicMutedRef = useRef(isMicMuted);
  const isBufferingEnabledRef = useRef(isBufferingEnabled);
  const isWorkletLoadedRef = useRef(isWorkletLoaded);
  const targetLeadFramesRef = useRef(targetLeadFrames);
  const isAutoBufferRef = useRef(true);

  useEffect(() => {
    isMicMutedRef.current = isMicMuted;
  }, [isMicMuted]);

  useEffect(() => {
    isBufferingEnabledRef.current = isBufferingEnabled;
  }, [isBufferingEnabled]);

  useEffect(() => {
    isWorkletLoadedRef.current = isWorkletLoaded;
  }, [isWorkletLoaded]);

  useEffect(() => {
    targetLeadFramesRef.current = targetLeadFrames;
  }, [targetLeadFrames]);

  useEffect(() => {
    isAutoBufferRef.current = isAutoBuffer;
  }, [isAutoBuffer]);

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
    Boolean(localMicStream) && audioTestDone && kiteSignalSecure;

  const remoteIsLive = remoteLevel > 0.07;
  const syncCountInBlocksLive = kiteSyncCountInActive && kiteSyncEnabled;

  useEffect(() => {
    if (!kiteSyncEnabled) {
      setKiteSyncCountInActive(false);
    }
  }, [kiteSyncEnabled]);

  useEffect(() => {
    if (!kiteSyncCountInActive || !kiteSyncEnabled) {
      if (kiteSyncCountInRafIdRef.current !== null) {
        cancelAnimationFrame(kiteSyncCountInRafIdRef.current);
        kiteSyncCountInRafIdRef.current = null;
      }
      return;
    }

    const tick = () => {
      if (!mountedRef.current) {
        kiteSyncCountInRafIdRef.current = null;
        return;
      }
      const ctx = studioAudioContextRef.current;
      if (!ctx || ctx.state === "closed") {
        kiteSyncCountInRafIdRef.current = requestAnimationFrame(tick);
        return;
      }
      const endAt = kiteSyncCountInEndAtContextSecRef.current;
      if (Number.isFinite(endAt) && ctx.currentTime >= endAt) {
        setKiteSyncCountInActive(false);
        if (metronomeGainRef.current) {
          metronomeGainRef.current.gain.value = metronomeVolumeRef.current;
        }
        kiteSyncCountInRafIdRef.current = null;
        return;
      }
      kiteSyncCountInRafIdRef.current = requestAnimationFrame(tick);
    };

    kiteSyncCountInRafIdRef.current = requestAnimationFrame(tick);
    return () => {
      if (kiteSyncCountInRafIdRef.current !== null) {
        cancelAnimationFrame(kiteSyncCountInRafIdRef.current);
        kiteSyncCountInRafIdRef.current = null;
      }
    };
  }, [kiteSyncCountInActive, kiteSyncEnabled]);

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
            const delayNode = remotePlaybackDelayRef.current;
            const ctx = studioAudioContextRef.current;
            if (delayNode && ctx) {
              const nextDelaySeconds = Math.max(
                0,
                Math.min(5, oneWayDelayMs / 1000)
              );
              delayNode.delayTime.setTargetAtTime(
                nextDelaySeconds,
                ctx.currentTime,
                0.08
              );
            }
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
            const rttSec = (parsedRtt.rttMs / 2) / 1000;
            let autoTarget = Math.round((rttSec + jitterSec + 0.02) * 48000);
            autoTarget = Math.max(480, Math.min(19200, autoTarget));
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
  }, [status]);

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
      workletLoadedContextRef.current = null;
      workletLoadPromiseRef.current = null;
      setIsWorkletLoaded(false);
      if (ctx.state === "running") {
        setAudioContextReady(true);
      } else {
        void ctx
          .resume()
          .then(() => setAudioContextReady(true))
          .catch(() => {});
      }
      void ensureKiteBufferWorkletLoaded(ctx);
      return ctx;
    }
    if (ctx.state === "running") {
      setAudioContextReady(true);
    } else {
      void ctx
        .resume()
        .then(() => setAudioContextReady(true))
        .catch(() => {});
    }
    void ensureKiteBufferWorkletLoaded(ctx);
    return ctx;
  }, [ensureKiteBufferWorkletLoaded]);

  useEffect(() => {
    if (!enteredStudio) return;
    if (!remoteStreamRef.current) return;
    rebuildRemoteGraphWithoutTeardown();
  }, [enteredStudio, isBufferingEnabled, rebuildRemoteGraphWithoutTeardown]);

  useEffect(() => {
    if (!enteredStudio || !isBufferingEnabled || !isWorkletLoaded) return;
    if (!remoteStreamRef.current) return;
    rebuildRemoteGraphWithoutTeardown();
  }, [enteredStudio, isBufferingEnabled, isWorkletLoaded, rebuildRemoteGraphWithoutTeardown]);

  useEffect(() => {
    if (kiteSyncEnabled) return;
    const bufferNode = remoteBufferNodeRef.current;
    if (!bufferNode || !("port" in bufferNode)) return;
    bufferNode.port.postMessage({ type: "FLUSH_BUFFER" });
  }, [kiteSyncEnabled]);

  useEffect(() => {
    if (!enteredStudio) return;
    const currentStream = localStreamRef.current;
    if (!currentStream || echoModeApplyingRef.current) return;
    echoModeApplyingRef.current = true;

    void (async () => {
      try {
        const nextStream = await acquireStudioMicStream({ echoSafetyMode });
        if (!mountedRef.current) {
          nextStream.getTracks().forEach((track) => track.stop());
          return;
        }
        const nextTrack = nextStream.getAudioTracks()[0] ?? null;
        if (!nextTrack) {
          nextStream.getTracks().forEach((track) => track.stop());
          return;
        }
        const prevStream = localStreamRef.current;
        const prevTrack = prevStream?.getAudioTracks()[0] ?? null;
        replacePeerAudioTrack(prevTrack, nextTrack, prevStream ?? null, nextStream);

        nextTrack.enabled = !isMicMutedRef.current;
        localStreamRef.current = nextStream;
        setLocalMicStream(nextStream);

        const localEl = localMonitorAudioRef.current;
        if (localEl) {
          localEl.srcObject = nextStream;
          localEl.muted = true;
          await localEl.play().catch(() => {});
        }

        if (prevStream && prevStream !== nextStream) {
          prevStream.getTracks().forEach((track) => track.stop());
        }
      } catch (err) {
        console.error("Failed to re-acquire microphone for echo safety mode:", err);
      } finally {
        echoModeApplyingRef.current = false;
      }
    })();
  }, [echoSafetyMode, enteredStudio, replacePeerAudioTrack]);

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
    const nextBpi = overrides?.bpi ?? beatsPerInterval;
    kiteSyncSequenceRef.current += 1;
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
    };
  }, [beatsPerInterval, kiteSyncEnabled, metronomeBpm]);

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

  const broadcastKiteSyncFromHost = useCallback((overrides?: {
    kiteSyncEnabled?: boolean;
    bpm?: number;
    bpi?: number;
  }): void => {
    if (role !== "host") return;
    const packet = buildKiteSyncPacket({
      kiteSyncEnabled: overrides?.kiteSyncEnabled,
      bpm: overrides?.bpm,
      bpi: overrides?.bpi,
    });
    if (!packet) return;
    sendOrQueueKiteSyncPacket(packet);
  }, [buildKiteSyncPacket, kiteSyncEnabled, role, sendOrQueueKiteSyncPacket]);

  /**
   * Parallel output branch for precision click-track playback.
   * This path is isolated from remote stream and local recorder chains.
   */
  const ensureMetronomeGainNode = useCallback((ctx: AudioContext): GainNode => {
    let node = metronomeGainRef.current;
    if (!node) {
      node = ctx.createGain();
      // Safety default: no metronome output until Kite Sync is explicitly enabled.
      node.gain.value = 0;
      node.connect(ctx.destination);
      metronomeGainRef.current = node;
    }
    console.log("Metronome Gain Node status:", node);
    return node;
  }, []);

  const playMetronomeClick = useCallback(
    (
      ctx: AudioContext,
      time: number,
      tick: MetronomeTick,
      masterGainNode?: GainNode | null
    ) => {
      if (!ctx || ctx.state === "closed") return;
      if (ctx.state === "suspended") void ctx.resume();
      console.log("🎵 TICK scheduled for:", time, "Downbeat:", tick.isAccent);
      console.log("DEBUG: Creating Oscillator at time:", time);
      const startAt = Math.max(time, ctx.currentTime);
      const osc = ctx.createOscillator();
      const durationSec = 0.1;
      const stopAt = startAt + durationSec;
      osc.type = "sine";
      const frequency =
        tick.beatIndex === 0 ? 1760 : tick.beatIndex % 4 === 0 ? 880 : 440;
      osc.frequency.setValueAtTime(frequency, startAt);
      const targetNode = masterGainNode || ctx.destination;
      osc.connect(targetNode);
      osc.start(startAt);
      metronomeBlinkQueueRef.current.push({ startAt, isAccent: tick.isAccent });
      if (metronomeBlinkQueueRef.current.length > 20) metronomeBlinkQueueRef.current.shift();
      osc.stop(stopAt);
      osc.addEventListener("ended", () => {
        try {
          osc.disconnect();
        } catch {
          /* ignore */
        }
      });
    },
    []
  );

  const resetKiteSyncSessionRefs = useCallback(() => {
    pendingKiteSyncRef.current = null;
    lastAcceptedKiteSyncSeqRef.current = 0;
    kiteSyncSequenceRef.current = 0;
    lastAppliedGuestStartSecRef.current = null;
    lastSyncApplyAtMsRef.current = null;
  }, []);

  const stopKiteMetronome = useCallback(() => {
    if (metronomeBlinkRafIdRef.current !== null) {
      cancelAnimationFrame(metronomeBlinkRafIdRef.current);
    }
    metronomeBlinkRafIdRef.current = null;
    metronomeBlinkQueueRef.current = [];
    if (metronomeIntervalRef.current !== null) {
      clearInterval(metronomeIntervalRef.current);
      metronomeIntervalRef.current = null;
    }
    metronomeSchedulerRef.current?.stop();
    metronomeSchedulerRef.current = null;
    const gain = metronomeGainRef.current;
    const ctx = studioAudioContextRef.current;
    if (gain && ctx && ctx.state !== "closed") {
      try {
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setValueAtTime(0, ctx.currentTime);
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
    if (kiteSyncCountInRafIdRef.current !== null) {
      cancelAnimationFrame(kiteSyncCountInRafIdRef.current);
      kiteSyncCountInRafIdRef.current = null;
    }
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
    gainNode.gain.value = kiteSyncEnabled ? metronomeVolumeRef.current : 0;
  }, [kiteSyncEnabled, kiteSyncCountInActive]);

  useEffect(() => {
    console.log("Metronome Effect running. Enabled:", kiteSyncEnabled, "Context Ready:", audioContextReady);
    if (!kiteSyncEnabled) {
      stopKiteMetronome();
      return;
    }
    if (kiteSyncLossPauseActiveRef.current) {
      stopKiteMetronome();
      return;
    }

    const ctx = studioAudioContextRef.current ?? ensureStudioAudioContext();
    if (!ctx) return;
    if (!metronomeGainRef.current) {
      console.log("Metronome gain ref null, attempting to ensure node...");
      ensureMetronomeGainNode(ctx);
    }
    if (!metronomeGainRef.current) return;
    if (metronomeIntervalRef.current !== null && metronomeSchedulerRef.current) return;

    const localStartAtSec = ctx.currentTime + 0.01;
    let startAtSec = localStartAtSec;
    if (role !== "host") {
      const target = lastAppliedGuestStartSecRef.current;
      if (typeof target === "number" && Number.isFinite(target)) {
        const barLenSec = (60 / metronomeBpm) * beatsPerInterval;
        if (Number.isFinite(barLenSec) && barLenSec > 0 && target < ctx.currentTime) {
          const snappedStart =
            target + Math.ceil((ctx.currentTime - target) / barLenSec) * barLenSec;
          startAtSec = snappedStart;
        } else {
          startAtSec = target;
        }
        console.log("Guest Scheduler Starting at:", startAtSec, "Snapped:", startAtSec !== target);
      }
    }

    const scheduler = createMetronomeScheduler(ctx, {
      bpm: metronomeBpm,
      beatsPerInterval,
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
      console.log(
        "DEBUG: Scheduler State - NextNoteTime:",
        (activeScheduler as { getNextNoteTime?: () => number }).getNextNoteTime?.(),
        "NowSec + Lookahead:",
        nowSec + 0.12
      );
      const ticks = activeScheduler.consumeDueTicks(nowSec);
      console.log("DEBUG: Ticks Generated:", ticks.length);
      for (const tick of ticks) {
        playMetronomeClick(activeCtx, tick.atSec, tick, metronomeGainRef.current);
      }
    };

    pumpScheduler();
    if (ctx.state !== "running") void ctx.resume();
    metronomeIntervalRef.current = window.setInterval(
      pumpScheduler,
      scheduler.getLookaheadMs()
    );
  }, [
    beatsPerInterval,
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
      const blob = await recorder.stop();
      clearRecordedBlobUrl();
      const url = URL.createObjectURL(blob);
      setRecordedBlobUrl(url);
    } catch (err) {
      console.error("Failed to stop local recording:", err);
    } finally {
      setIsRecording(false);
    }
  }, [clearRecordedBlobUrl, clearRecordingInterval]);

  const onEnterStudioClick = useCallback(() => {
    void (async () => {
      try {
        const ctx = ensureStudioAudioContext();
        await ctx.resume().catch(() => {});
        ensureMetronomeGainNode(ctx);
        const stream = remoteStreamRef.current;
        if (stream) {
          buildRemotePlaybackGraph(stream);
        }
      } catch {
        // Ignore; UI still enters studio.
      }
      setEnteredStudio(true);
    })();
  }, [buildRemotePlaybackGraph, ensureMetronomeGainNode, ensureStudioAudioContext]);

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
      if (!isRecording) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isRecording]);

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
      if (recordedBlobUrl) {
        URL.revokeObjectURL(recordedBlobUrl);
      }
    };
  }, [clearRecordingInterval, recordedBlobUrl]);

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
          teardownRemotePlaybackGraph();
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
          if (remoteStreamRef.current) {
            remoteStreamRef.current.getTracks().forEach((track) => track.stop());
            remoteStreamRef.current = null;
          }
          if (localMonitorAudioRef.current) {
            localMonitorAudioRef.current.srcObject = null;
          }
          channelRef.current?.unsubscribe();
          channelRef.current = null;

          if (!p2pConnectSucceededRef.current) {
            peerRef.current?.destroy();
          }
          peerRef.current = null;

          const localStreamToStop = localStreamRef.current;
          try {
            localStreamToStop?.getTracks().forEach((track) => track.stop());
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

    const buildTransport = async (localStream: MediaStream, ctx: AudioContext) => {
      p2pConnectSucceededRef.current = false;
      appliedRemoteSignalRef.current = false;
      seenIceRef.current = new Set();
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

      const iceServers = await fetchTurnCredentials();
      const peerConfig = buildPeerConfig(iceServers, transportForceRelay);
      const peer = new Peer({
        initiator: transportIsHost,
        trickle: true,
        stream: localStream,
        config: peerConfig,
        sdpTransform: (sdp) => {
          console.log("[SDP-IN]", sdp);
          try {
            const result = forceMusicModeOpus(sdp);
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
        if (studioAudioContextRef.current) {
          buildRemotePlaybackGraph(remoteStream);
        }
      });

      peer.on("data", (chunk: unknown) => {
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
            from?: Role;
          };
          if (msg.type === "LEAVE") {
            if (msg.from === transportActiveRole) return;
            const departedName = remoteParticipantName || "A participant";
            leaveSignalReceivedRef.current = true;
            setKiteSyncEnabled(false);
            stopKiteMetronome();
            clearLostCountdown();
            setCollaboratorLeft(true);
            setLastDepartedParticipantName(departedName);
            setRemoteParticipantName(null);
            setStatus("failed");
            setStatusNote(`${departedName} left the session.`);
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
            lastAcceptedKiteSyncSeqRef.current = msg.sequenceNumber;
            setKiteSyncEnabled(msg.enabled);
            if (!msg.enabled) return;

            const receivedAtMs = Date.now();
            const rttDelaySec = (calculatedDelayMsRef.current || 0) / 1000;
            const offsetSec = (receivedAtMs - msg.serverTimestamp) / 1000;
            const guestTargetSec = msg.hostTime + offsetSec + rttDelaySec;

            lastAppliedGuestStartSecRef.current = guestTargetSec;
            lastSyncApplyAtMsRef.current = receivedAtMs;
            setMetronomeBpm(msg.bpm);
            setBeatsPerInterval(msg.bpi);
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
              const countInTwoBeatsSec = (60 / msg.bpm) * 2;
              if (Number.isFinite(countInTwoBeatsSec) && countInTwoBeatsSec > 0) {
                kiteSyncCountInEndAtContextSecRef.current =
                  ctx.currentTime + countInTwoBeatsSec;
                if (metronomeGainRef.current) metronomeGainRef.current.gain.value = 0;
                setKiteSyncCountInActive(true);
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
        if (transportIsHost && kiteSyncEnabled && pendingKiteSyncRef.current) {
          try {
            peer.send(JSON.stringify(pendingKiteSyncRef.current));
            pendingKiteSyncRef.current = null;
          } catch {
            // Keep queued packet for next successful send checkpoint.
          }
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

    reconnectTransport = async () => {
      if (!localStreamRef.current || !studioAudioContextRef.current) return;
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
          setSessionId(sessionId);
        }

        // —— Host: reserve row first; URL + on-screen code only after Supabase confirms session_id ——
        if (isHost) {
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

        // —— Phase 1: hardware only (mic; host row already reserved in Supabase) ——
        setStatusNote("Syncing microphone...");
        micSyncTimeout = window.setTimeout(() => {
          if (!mountedRef.current || cancelled || localStreamRef.current) return;
          setMicSyncTimedOut(true);
          setStatusNote("Microphone sync timed out.");
        }, 5000);

        addLog("Phase 1: getUserMedia (audio only)");
        try {
          mediaStream = await acquireStudioMicStream({ echoSafetyMode });
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
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }

        const audioTracks = mediaStream.getAudioTracks();
        if (audioTracks.length === 0) {
          mediaStream.getTracks().forEach((track) => track.stop());
          throw new Error("Microphone stream has no audio tracks.");
        }

        micStream = mediaStream;
        localStreamRef.current = mediaStream;
        if (mountedRef.current) {
          setMicSyncTimedOut(false);
          setLocalMicStream(mediaStream);
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

        // —— Phase 2: database (after mic is live) ——
        const activeRole: Role = isHost ? "host" : "peer";
        bridgeActiveRoleRef.current = activeRole;
        setRole(activeRole);
        const { data: authData } = await supabase.auth.getUser();
        sessionUserId = authData.user?.id ?? null;

        if (isHost) {
          addLog("Phase 2: host full upsert studio_sessions");
          setStatusNote("Creating session...");

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
          setStatusNote("Fetching room...");

          const guestOfferReady = (row: StudioSessionRow) =>
            row.offer != null && typeof row.offer === "object";

          let { data: fetched, error: fetchErr } = await supabase
            .from("studio_sessions")
            .select("session_id, offer, answer, ice_candidates, host_user_id")
            .eq("session_id", sessionId.toUpperCase())
            .single<StudioSessionRow>();

          if (fetchErr || !fetched) throw new Error("Room not found.");

          if (!guestOfferReady(fetched)) {
            addLog("Phase 2: guest offer empty; retry after 2s");
            setStatusNote("Waiting for host…");
            await new Promise((resolve) => window.setTimeout(resolve, 2000));
            if (cancelled || !mountedRef.current) {
              micStream.getTracks().forEach((track) => track.stop());
              micStream = null;
              localStreamRef.current = null;
              if (mountedRef.current) setLocalMicStream(null);
              return;
            }
            const retry = await supabase
              .from("studio_sessions")
              .select("session_id, offer, answer, ice_candidates, host_user_id")
              .eq("session_id", sessionId.toUpperCase())
              .single<StudioSessionRow>();
            fetchErr = retry.error;
            fetched = retry.data ?? null;
            if (fetchErr || !fetched) throw new Error("Room not found.");
            if (!guestOfferReady(fetched)) {
              throw new Error(
                "Session not ready. The host may still be setting up—try again in a moment."
              );
            }
          }

          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (user?.id && fetched.host_user_id && user.id === fetched.host_user_id) {
            micStream?.getTracks().forEach((t) => t.stop());
            micStream = null;
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
          micStream.getTracks().forEach((track) => track.stop());
          micStream = null;
          localStreamRef.current = null;
          if (mountedRef.current) setLocalMicStream(null);
          return;
        }

        // —— Phase 3: Realtime + WebRTC ——
        transportSessionId = sessionId;
        transportActiveRole = activeRole;
        transportIsHost = isHost;
        transportForceRelay = forceRelay;
        if (!mediaStream) return;
        await buildTransport(
          localStreamRef.current!,
          studioAudioContextRef.current as AudioContext
        );
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
      micStream?.getTracks().forEach((t) => t.stop());
      performTeardown();
    };
  }, [
    beginLostCountdown,
    clearLostCountdown,
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
            className="fixed inset-0 z-50 flex items-center justify-center p-5 backdrop-blur-sm"
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
              className="w-full max-w-md rounded-2xl border border-orange-500/35 bg-stone-950/95 p-6 shadow-2xl"
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

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-16 pb-28 sm:px-6 lg:pb-16">
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
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
          className="w-full"
        >
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
          {sessionId ? (
            <motion.button
              type="button"
              onClick={() => void copyRoomCode()}
              whileTap={{ scale: 0.97 }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28 }}
              className="mt-6 w-full rounded-xl border border-white/[0.10] bg-white/[0.03] px-4 py-3 text-left transition hover:border-orange-500/20 hover:bg-white/[0.05]"
              aria-label="Copy room code"
            >
              <div className="text-[11px] font-semibold uppercase tracking-widest text-stone-500">
                {role === "host" ? "Your Room Code" : "Room Code"}
              </div>
              <div className="mt-2 font-mono text-lg font-bold tracking-[0.28em] text-stone-50">
                {sessionId.toUpperCase()}
              </div>
              <div className="mt-1 text-[11px] text-stone-500">Tap to copy</div>
            </motion.button>
          ) : null}

          {roomCopyNote ? (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-3 text-center text-xs font-medium text-emerald-300/90"
              role="status"
            >
              {roomCopyNote}
            </motion.div>
          ) : null}

          {micPermissionDenied ? (
            <div
              className="mt-6 rounded-xl border border-stone-700/90 bg-stone-950/50 px-4 py-3 text-center text-sm font-medium leading-relaxed text-stone-300"
              role="status"
            >
              {micPermissionHint ||
                "Microphone Access Required. Please enable it in your browser settings to continue."}
            </div>
          ) : null}

          {micSyncTimedOut && !localMicStream ? (
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

          {!enteredStudio ? (
            <>
              <div
                className="mt-8 rounded-2xl border border-stone-800/90 bg-stone-950/40 p-5 shadow-2xl backdrop-blur-sm"
                style={{
                  boxShadow: `
                    0 0 0 1px rgba(255,69,0,0.06),
                    0 0 48px -20px rgba(34,197,94,0.12),
                    0 24px 48px -24px rgba(0,0,0,0.65)
                  `,
                }}
              >
                <div className="text-[11px] font-semibold uppercase tracking-widest text-stone-500">
                  Status
                </div>
                <div className="mt-1">
                  <PreflightRow
                    label="Microphone"
                    pendingText="Scanning for input..."
                    doneText="Microphone Active"
                    errorText="Microphone unavailable."
                    state={micRowState}
                  />
                  <PreflightRow
                    label="Audio output"
                    pendingText={audioPendingCopy}
                    doneText="Output Ready"
                    errorText="Test tone could not play."
                    state={audioRowState}
                    pendingShowsSpinner={audioTestPlaying}
                    rowAction={
                      !micPermissionDenied && !audioTestDone ? (
                        <motion.button
                          type="button"
                          disabled={audioTestPlaying}
                          onClick={() => void runAudioTest()}
                          className={`w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                            audioTestPlaying
                              ? "cursor-wait border border-stone-600 bg-stone-800/50 text-stone-400"
                              : "border border-orange-500/35 bg-gradient-to-r from-orange-500/12 to-emerald-500/12 text-stone-100 hover:from-orange-500/20 hover:to-emerald-500/20"
                          }`}
                          whileTap={audioTestPlaying ? undefined : { scale: 0.97 }}
                        >
                          Test Audio
                        </motion.button>
                      ) : null
                    }
                  />
                  <PreflightRow
                    label="Kite Signal"
                    pendingText={kitePendingCopy}
                    doneText="Signal Secure"
                    errorText={kiteErrorCopy}
                    state={connRowState}
                  />
                </div>
                {localMicStream && !micPermissionDenied ? (
                  <div className="mt-4">
                    <MicLevelBars stream={localMicStream} />
                    <p className="mt-2 text-center text-[10px] font-semibold uppercase tracking-wider text-stone-500">
                      Default Input Level
                    </p>
                  </div>
                ) : null}

                {remoteStream && remoteMeterTapActive ? (
                  <div className="mt-4">
                    <ExternalLevelBars heights={remoteMeterHeights} />
                    <p className="mt-2 text-center text-[10px] font-semibold uppercase tracking-wider text-stone-500">
                      Incoming Remote Level
                    </p>
                  </div>
                ) : null}

                <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-stone-800/70 bg-stone-950/25 px-2 py-2">
                  <motion.button
                    type="button"
                    disabled={
                      !localMicStream ||
                      micPermissionDenied ||
                      (syncCountInBlocksLive && isMicMuted)
                    }
                    onClick={toggleMic}
                    whileTap={{ scale: 0.97 }}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-2 py-2 text-sm font-semibold transition ${
                      isMicMuted
                        ? "border-orange-500/35 text-orange-200/90"
                        : "border-stone-800/70 text-stone-200/90"
                    }`}
                    style={
                      isMicMuted
                        ? {
                            boxShadow: `0 0 26px -10px ${ORANGE}cc`,
                          }
                        : undefined
                    }
                  >
                    {isMicMuted ? (
                      <MicOff className="h-4 w-4" aria-hidden />
                    ) : (
                      <Mic className="h-4 w-4" aria-hidden />
                    )}
                    <span className="text-[11px]">{isMicMuted ? "Muted" : "Mic"}</span>
                  </motion.button>

                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <motion.button
                      type="button"
                      disabled={
                        !remoteStream || (syncCountInBlocksLive && isSpeakerMuted)
                      }
                      onClick={toggleSpeaker}
                      whileTap={{ scale: 0.97 }}
                      className={`flex w-full flex-1 items-center justify-center gap-2 rounded-lg border px-2 py-2 text-sm font-semibold transition ${
                        isSpeakerMuted
                          ? "border-stone-800/70 text-stone-200/90"
                          : "border-emerald-500/35 text-emerald-200/90"
                      }`}
                      style={
                        isSpeakerMuted
                          ? undefined
                          : {
                              boxShadow: `0 0 26px -10px ${EMERALD}cc`,
                            }
                      }
                    >
                      {isSpeakerMuted ? (
                        <VolumeX className="h-4 w-4" aria-hidden />
                      ) : (
                        <Volume2 className="h-4 w-4" aria-hidden />
                      )}
                      <span className="text-[11px]">{isSpeakerMuted ? "Muted" : "Speaker"}</span>
                    </motion.button>
                    <input
                      type="range"
                      min={REMOTE_PLAYBACK_VOLUME_MIN}
                      max={REMOTE_PLAYBACK_VOLUME_MAX}
                      step={0.1}
                      value={remotePlaybackVolume}
                      onChange={onRemotePlaybackVolumeChange}
                      disabled={!remoteStream || syncCountInBlocksLive}
                      aria-label="Remote playback volume"
                      className="h-2 w-full min-w-0 accent-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                    />
                  </div>

                  <motion.button
                    type="button"
                    disabled
                    className="flex flex-1 cursor-default items-center justify-center gap-2 rounded-lg border border-stone-800/70 bg-stone-950/20 px-2 py-2"
                    style={
                      remoteIsLive
                        ? {
                            boxShadow: `0 0 28px -10px ${EMERALD}dd`,
                            borderColor: "rgba(34,197,94,0.35)",
                          }
                        : undefined
                    }
                    aria-label="Live audio indicator"
                  >
                    <span
                      className="text-[11px] font-semibold uppercase tracking-widest"
                      style={{ color: remoteIsLive ? "rgba(167,243,208,0.95)" : "rgba(148,163,184,0.7)" }}
                    >
                      Live
                    </span>
                  </motion.button>
                </div>
              </div>

              <motion.button
                type="button"
                disabled={!canEnterStudio}
                onClick={onEnterStudioClick}
                className={`mt-8 w-full rounded-xl px-4 py-3.5 text-sm font-semibold transition ${
                  canEnterStudio
                    ? "border border-orange-500/40 text-stone-50 shadow-lg"
                    : "cursor-not-allowed border border-stone-700 bg-stone-900/60 text-stone-500"
                }`}
                style={
                  canEnterStudio
                    ? {
                        background: `linear-gradient(135deg, rgba(255,69,0,0.22), rgba(34,197,94,0.18))`,
                        boxShadow: `0 0 28px -6px ${ORANGE}88, 0 0 32px -8px ${EMERALD}66`,
                      }
                    : undefined
                }
                whileTap={canEnterStudio ? { scale: 0.97 } : undefined}
              >
                Enter Studio
              </motion.button>
            </>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-8 space-y-4"
            >
              {status === "connected" ? (
                <div className="relative">
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
                    {kiteSyncNetworkMetronomePaused && kiteSyncEnabled ? (
                      <div className="w-full rounded-lg border border-orange-500/30 bg-orange-950/25 px-3 py-2 text-left text-[11px] font-medium leading-snug text-orange-200/95">
                        Metronome paused: inbound loss exceeded {KITE_SYNC_LOSS_PAUSE_PCT}%. It
                        resumes after loss stays below {KITE_SYNC_LOSS_RESUME_PCT}% for a few
                        seconds (hysteresis).
                      </div>
                    ) : null}
                    <div className="w-full rounded-lg border border-stone-800/80 bg-stone-900/40 px-3 py-2">
                      <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-stone-500">
                        <span>Kite Sync</span>
                        <div
                          ref={metronomeBlinkElementRef}
                          className="h-2.5 w-2.5 rounded-full bg-stone-700 transition-all duration-75"
                          aria-hidden
                        />
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setKiteSyncEnabled((prev) => {
                              const next = !prev;
                              console.log("Kite Sync Toggle Clicked. New State:", next);
                              if (next) {
                                const ctx = studioAudioContextRef.current;
                                if (ctx) {
                                  flushAndSetRemoteGridTarget(ctx.currentTime + 0.01);
                                  const countInTwoBeatsSec = (60 / metronomeBpm) * 2;
                                  if (Number.isFinite(countInTwoBeatsSec) && countInTwoBeatsSec > 0) {
                                    kiteSyncCountInEndAtContextSecRef.current =
                                      ctx.currentTime + countInTwoBeatsSec;
                                    if (metronomeGainRef.current) {
                                      metronomeGainRef.current.gain.value = 0;
                                    }
                                    setKiteSyncCountInActive(true);
                                  }
                                }
                              }
                              broadcastKiteSyncFromHost({ kiteSyncEnabled: next });
                              return next;
                            })
                          }
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
                            onClick={() => {
                              void studioAudioContextRef.current
                                ?.resume()
                                .then(() => setAudioContextReady(true));
                            }}
                            className="rounded-md border border-orange-500/35 bg-orange-500/12 px-2.5 py-1 text-[11px] font-semibold text-orange-200 transition-colors hover:bg-orange-500/18"
                          >
                            🔊 Resume Audio
                          </button>
                        ) : null}
                        <label className="flex items-center gap-1 text-[11px] text-stone-300">
                          <span className="uppercase tracking-wider text-stone-500">BPM</span>
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
                                broadcastKiteSyncFromHost({ bpm: normalized });
                                return normalized;
                              });
                            }}
                            className="w-16 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-right text-[11px] text-stone-100"
                            inputMode="numeric"
                          />
                        </label>
                        <label className="flex items-center gap-1 text-[11px] text-stone-300">
                          <span className="uppercase tracking-wider text-stone-500">BPI</span>
                          <input
                            type="number"
                            min={1}
                            max={64}
                            value={beatsPerInterval}
                            onChange={(e) => {
                              const next = Number(e.target.value);
                              if (!Number.isFinite(next)) return;
                              setBeatsPerInterval((prev) => {
                                const normalized = Math.max(1, Math.min(64, Math.round(next)));
                                if (normalized === prev) return prev;
                                broadcastKiteSyncFromHost({ bpi: normalized });
                                return normalized;
                              });
                            }}
                            className="w-14 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-right text-[11px] text-stone-100"
                            inputMode="numeric"
                          />
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
                            className="h-2 w-full min-w-0 accent-emerald-400"
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
                            {Math.round(bufferDepthFrames / 48)} ms
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
                              onClick={() => setIsAutoBuffer(!isAutoBuffer)}
                              className={`ml-2 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${
                                isAutoBuffer
                                  ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-400"
                                  : "border-stone-700 bg-stone-800 text-stone-500"
                              }`}
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
                            onChange={(e) => {
                              const next = Number(e.target.value);
                              if (!Number.isFinite(next)) return;
                              setIsAutoBuffer(false);
                              setTargetLeadFrames(Math.max(0, Math.round(next)));
                            }}
                            className={`w-28 accent-orange-400 ${isAutoBuffer ? "opacity-60" : ""}`}
                          />
                          <input
                            type="number"
                            min={480}
                            max={19200}
                            step={120}
                            value={targetLeadFrames}
                            onChange={(e) => {
                              const next = Number(e.target.value);
                              if (!Number.isFinite(next)) return;
                              setIsAutoBuffer(false);
                              setTargetLeadFrames(Math.max(0, Math.round(next)));
                            }}
                            className={`w-20 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-right text-[11px] text-stone-100 ${isAutoBuffer ? "opacity-60" : ""}`}
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
                          !localMicStream || (syncCountInBlocksLive && isMicMuted)
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
                          !remoteStream || (syncCountInBlocksLive && isSpeakerMuted)
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
                        disabled={!remoteStream || syncCountInBlocksLive}
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
                          download="my-track.webm"
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
                {kiteSyncCountInActive && kiteSyncEnabled ? (
                  <div
                    className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-xl bg-stone-950/86 px-4 py-6 text-center backdrop-blur-[2px]"
                    role="status"
                    aria-live="polite"
                  >
                    <p className="text-sm font-semibold text-stone-100">Syncing…</p>
                    <p className="max-w-xs text-xs font-medium leading-relaxed text-stone-400">
                      Wait for the count-in to finish before unmuting or turning up remote audio.
                    </p>
                  </div>
                ) : null}
              </div>
              ) : null}

              {role === "host" && inviteLink ? (
                <motion.button
                  type="button"
                  onClick={() => void copyInviteLink()}
                  className="w-full rounded-xl border border-orange-500/35 bg-gradient-to-r from-orange-500/15 to-emerald-500/15 px-4 py-3 text-sm font-semibold text-stone-100 transition hover:from-orange-500/25 hover:to-emerald-500/25"
                  whileTap={{ scale: 0.97 }}
                >
                  Copy Invite Link
                </motion.button>
              ) : null}

              {sessionId ? (
                <p className="text-center text-[11px] font-medium text-stone-500">
                  Room: {sessionId.toUpperCase()}
                </p>
              ) : null}

              <p className="text-center text-xs text-stone-500">
                {status === "connected" ? statusNote : (bridgeInitError ?? statusNote)}
              </p>
            </motion.div>
          )}

          {collaboratorLeft ? (
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
    </div>
  );
}
