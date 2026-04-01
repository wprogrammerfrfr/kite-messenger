"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Peer, { type SignalData } from "simple-peer";
import { Check, ChevronLeft, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  acquireStudioMicStream,
  decodePeerDataChunk,
  STUDIO_PEER_CONNECTION_CONFIG,
  fetchTurnCredentials,
} from "@/lib/studio-bridge-webrtc";

type BridgeStatus = "connecting" | "connected" | "failed";
type Role = "host" | "peer";
type SessionControlMessage = {
  type: "LEAVE";
  from: Role;
  room: string;
  at: string;
};

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

/** Single source of truth for session_id casing and shape (6-char A–Z / 0–9). */
function normalizeStudioSessionId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase();
}

function randomSessionId(): string {
  return normalizeStudioSessionId(Math.random().toString(36).slice(2, 8));
}

function addLog(msg: string) {
  console.log(msg);
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

function MicLevelBars({
  stream,
  onLevel,
}: {
  stream: MediaStream | null;
  onLevel?: (level: number) => void;
}) {
  const [heights, setHeights] = useState([0.12, 0.12, 0.12, 0.12, 0.12]);

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
            const step = Math.max(1, Math.floor(buf.length / 5));
            const next = [0, 1, 2, 3, 4].map((i) => {
              let sum = 0;
              for (let j = 0; j < step; j++) sum += buf[i * step + j] ?? 0;
              return Math.min(1, (sum / step / 255) * 1.85);
            });
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
      void ctx?.close();
    };
  }, [stream, onLevel]);

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
  const [localMicStream, setLocalMicStream] = useState<MediaStream | null>(null);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);
  const [micPermissionHint, setMicPermissionHint] = useState<string | null>(null);
  const [micSyncTimedOut, setMicSyncTimedOut] = useState(false);
  const [audioTestDone, setAudioTestDone] = useState(false);
  const [audioTestPlaying, setAudioTestPlaying] = useState(false);
  const [audioTestFailed, setAudioTestFailed] = useState(false);
  const [kiteSignal, setKiteSignal] = useState<KiteSignalState>("checking");
  const [enteredStudio, setEnteredStudio] = useState(false);
  const [roomCopyNote, setRoomCopyNote] = useState<string | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [remoteLevel, setRemoteLevel] = useState(0);
  const [micMuted, setMicMuted] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [confirmExitOpen, setConfirmExitOpen] = useState(false);
  const [collaboratorLeft, setCollaboratorLeft] = useState(false);
  const [connectionLostCountdown, setConnectionLostCountdown] = useState<number | null>(null);
  const [retryInitTick, setRetryInitTick] = useState(0);

  const micDeniedThisInitRef = useRef(false);

  const peerRef = useRef<Peer.Instance | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const speakerMutedRef = useRef(false);
  const localMonitorAudioRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pingIntervalRef = useRef<number | null>(null);
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
  const lostCountdownIntervalRef = useRef<number | null>(null);
  const sessionStartedAtRef = useRef<number | null>(null);
  const historySavedRef = useRef(false);
  /** Prevents overlapping inits; cleared on effect cleanup so remount can proceed. */
  const bridgeInitInFlightRef = useRef(false);

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

  useEffect(() => {
    speakerMutedRef.current = speakerMuted;
    if (remoteAudioRef.current) remoteAudioRef.current.muted = speakerMuted;
  }, [speakerMuted]);

  useEffect(() => {
    if (!remoteStream) setRemoteLevel(0);
  }, [remoteStream]);

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

  const toggleMicMuted = useCallback(() => {
    setMicMuted((prev) => {
      const nextMuted = !prev;
      const enabled = !nextMuted;
      localStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
      });
      return nextMuted;
    });
  }, []);

  const toggleSpeakerMuted = useCallback(() => {
    setSpeakerMuted((prev) => {
      const nextMuted = !prev;
      speakerMutedRef.current = nextMuted;
      if (remoteAudioRef.current) remoteAudioRef.current.muted = nextMuted;
      return nextMuted;
    });
  }, []);

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
    statusRef.current = status;
  }, [status]);

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
    let sessionUserId: string | null = null;
    leaveSignalSentRef.current = false;
    leaveSignalReceivedRef.current = false;
    historySavedRef.current = false;
    sessionStartedAtRef.current = Date.now();
    setCollaboratorLeft(false);
    clearLostCountdown();
    setMicSyncTimedOut(false);
    setMicPermissionHint(null);

    appliedRemoteSignalRef.current = false;
    seenIceRef.current.clear();
    existingRowRef.current = null;

    // Defensive cleanup: stop any lingering local tracks from previous failed sync attempts.
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setLocalMicStream(null);

    const performTeardown = () => {
      if (teardownRan) return;
      teardownRan = true;
      cancelled = true;
      void (async () => {
        try {
          setPingMs(null);
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

          const toStop = micStream ?? localStreamRef.current;
          toStop?.getTracks().forEach((track) => track.stop());
          micStream = null;
          localStreamRef.current = null;

          if (mountedRef.current) {
            setLocalMicStream(null);
            setRemoteStream(null);
            setAudioTestDone(false);
            setAudioTestFailed(false);
            setRemoteLevel(0);
            setMicMuted(false);
            setSpeakerMuted(false);
            speakerMutedRef.current = false;
            setConnectionLostCountdown(null);
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
          mediaStream = await acquireStudioMicStream();
        } catch (micErr) {
          console.error(micErr);
          addLog("Microphone blocked or unavailable");
          micDeniedThisInitRef.current = true;
          if (mountedRef.current) {
            setMicPermissionDenied(true);
            setMicPermissionHint(
              "Microphone Access Denied. Please click the camera icon in your browser address bar to reset."
            );
            setStatusNote("Microphone Required.");
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

          const { data: fetched, error: fetchErr } = await supabase
            .from("studio_sessions")
            .select("session_id, offer, answer, ice_candidates")
            .eq("session_id", sessionId.toUpperCase())
            .single<StudioSessionRow>();

          if (fetchErr || !fetched) throw new Error("Room not found.");
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
        if (!mediaStream) return;
        addLog("Phase 3: Realtime subscribe + peer");
        setStatusNote("Starting peer connection...");

        const channel = supabase
          .channel(`session_id:${sessionId.toUpperCase()}`)
          .on("broadcast", { event: "session-control" }, (payload) => {
            const msg = payload.payload as SessionControlMessage | undefined;
            if (!msg || msg.type !== "LEAVE") return;
            if (msg.room !== sessionId.toUpperCase()) return;
            if (msg.from === activeRole) return;
            leaveSignalReceivedRef.current = true;
            addLog("Collaborator LEAVE received");
            clearLostCountdown();
            setCollaboratorLeft(true);
            setStatus("failed");
            setStatusNote("Collaborator has left the session.");
          })
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "studio_sessions",
              filter: `session_id=eq.${sessionId.toUpperCase()}`,
            },
            (payload) => {
              const nextRow = payload.new as StudioSessionRow;
              if (!nextRow || typeof nextRow !== "object") return;
              const peer = peerRef.current;

              if (activeRole === "host") {
                if (
                  peer &&
                  !appliedRemoteSignalRef.current &&
                  nextRow.answer &&
                  typeof nextRow.answer === "object"
                ) {
                  appliedRemoteSignalRef.current = true;
                  addLog("Answer received");
                  peer.signal(nextRow.answer);
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
                setStatusNote("Offer received. Creating answer...");
              }

              applyRemoteIce(nextRow.ice_candidates, activeRole);
            }
          )
          .subscribe();
        channelRef.current = channel;

        addLog(
          `Negotiation: ${isHost ? "host initiates (offer first)" : "guest answers"}`
        );

        const iceServers = await fetchTurnCredentials();
        const peerConfig = {
          ...STUDIO_PEER_CONNECTION_CONFIG,
          iceServers,
        };
        const peer = new Peer({
          initiator: isHost,
          trickle: true,
          stream: mediaStream,
          config: peerConfig,
        });
        peerRef.current = peer;

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
        scheduleConnectTimeout(15000);

        const rawPc = (peer as unknown as { _pc?: RTCPeerConnection })._pc;
        if (rawPc) {
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
              beginLostCountdown();
              return;
            }
            if (iceState === "failed") {
              beginLostCountdown();
              setStatusNote("Connection unstable, attempting to recover...");
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
            remoteEl.muted = speakerMutedRef.current;
            void remoteEl.play().catch(() => {
              addLog("Remote audio play() blocked (tap page if silent)");
            });
          }
        });

        peer.on("data", (chunk: unknown) => {
          try {
            const text = decodePeerDataChunk(chunk);
            const msg = JSON.parse(text) as { t?: string; ts?: number };
            if (msg.t === "ping" && typeof msg.ts === "number" && activeRole === "peer") {
              peer.send(JSON.stringify({ t: "pong", ts: msg.ts }));
            } else if (
              msg.t === "pong" &&
              typeof msg.ts === "number" &&
              activeRole === "host" &&
              mountedRef.current
            ) {
              setPingMs(Math.round(performance.now() - msg.ts));
            }
          } catch {
            // Ignore non-JSON or malformed ping payloads.
          }
        });

        const enqueueIceAppend = (nextCandidate: IceCandidateRow) => {
          iceAppendQueueRef.current = iceAppendQueueRef.current
            .then(async () => {
              await appendIceCandidate(sessionId, nextCandidate);
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
                id: `${activeRole}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                from: activeRole,
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
                  .eq("session_id", sessionId.toUpperCase());
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
                  .eq("session_id", sessionId.toUpperCase());
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
          if (connectTimeout !== null) {
            clearTimeout(connectTimeout);
            connectTimeout = null;
          }
        });

        peer.on("error", (err: unknown) => {
          if (!mountedRef.current) return;
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

        if (!isHost) {
          const initial = existingRowRef.current;
          if (initial?.offer && typeof initial.offer === "object") {
            appliedRemoteSignalRef.current = true;
            addLog("Initial offer applied");
            peer.signal(initial.offer);
            setStatusNote("Creating answer...");
          }
          if (initial?.ice_candidates) {
            applyRemoteIce(initial.ice_candidates, activeRole);
          }
        } else {
          const { data: current } = await supabase
            .from("studio_sessions")
            .select("answer, ice_candidates")
            .eq("session_id", sessionId.toUpperCase())
            .single<Pick<StudioSessionRow, "answer" | "ice_candidates">>();
          if (current?.answer && typeof current.answer === "object") {
            appliedRemoteSignalRef.current = true;
            addLog("Initial answer applied");
            peer.signal(current.answer);
          }
          if (current?.ice_candidates) {
            applyRemoteIce(current.ice_candidates, activeRole);
          }
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
      micStream?.getTracks().forEach((t) => t.stop());
      performTeardown();
    };
  }, [beginLostCountdown, clearLostCountdown, retryInitTick]);

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
      <audio ref={remoteAudioRef} className="sr-only" playsInline />

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

                {remoteStream ? (
                  <div className="mt-4">
                    <MicLevelBars stream={remoteStream} onLevel={setRemoteLevel} />
                    <p className="mt-2 text-center text-[10px] font-semibold uppercase tracking-wider text-stone-500">
                      Incoming Remote Level
                    </p>
                  </div>
                ) : null}

                <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-stone-800/70 bg-stone-950/25 px-2 py-2">
                  <motion.button
                    type="button"
                    disabled={!localMicStream || micPermissionDenied}
                    onClick={toggleMicMuted}
                    whileTap={{ scale: 0.97 }}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-2 py-2 text-sm font-semibold transition ${
                      micMuted
                        ? "border-orange-500/35 text-orange-200/90"
                        : "border-stone-800/70 text-stone-200/90"
                    }`}
                    style={
                      micMuted
                        ? {
                            boxShadow: `0 0 26px -10px ${ORANGE}cc`,
                          }
                        : undefined
                    }
                  >
                    {micMuted ? <MicOff className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
                    <span className="text-[11px]">{micMuted ? "Muted" : "Mic"}</span>
                  </motion.button>

                  <motion.button
                    type="button"
                    disabled={!remoteStream}
                    onClick={toggleSpeakerMuted}
                    whileTap={{ scale: 0.97 }}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-2 py-2 text-sm font-semibold transition ${
                      speakerMuted
                        ? "border-stone-800/70 text-stone-200/90"
                        : "border-emerald-500/35 text-emerald-200/90"
                    }`}
                    style={
                      speakerMuted
                        ? undefined
                        : {
                            boxShadow: `0 0 26px -10px ${EMERALD}cc`,
                          }
                    }
                  >
                    {speakerMuted ? (
                      <VolumeX className="h-4 w-4" aria-hidden />
                    ) : (
                      <Volume2 className="h-4 w-4" aria-hidden />
                    )}
                    <span className="text-[11px]">{speakerMuted ? "Muted" : "Speaker"}</span>
                  </motion.button>

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
                onClick={() => setEnteredStudio(true)}
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
              {status === "connected" && role === "host" ? (
                <div className="rounded-xl border border-stone-700 bg-stone-950/80 px-4 py-3 text-center font-mono text-sm text-stone-200">
                  Ping:{" "}
                  <span className="text-emerald-400 tabular-nums">
                    {pingMs === null ? "--" : `${pingMs}`}
                  </span>{" "}
                  ms
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
              <p className="text-sm font-semibold text-stone-200">Collaborator has left the session.</p>
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
        </motion.div>
      </div>
    </div>
  );
}
