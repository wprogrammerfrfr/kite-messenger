'use client';

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Peer, { type SignalData } from "simple-peer";
import { supabase } from "@/lib/supabase";
import { acquireStudioMicStream, decodePeerDataChunk } from "@/lib/studio-bridge-webrtc";

type BridgeStatus = "connecting" | "connected" | "failed";
type Role = "host" | "peer";

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
};

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  {
    urls: "turn:global.relay.metered.ca:80",
    username: "7cbd6d02cf78e3bc5683bb2a",
    credential: "CPfbkDJuKleKcmkv",
  },
  {
    urls: "turn:global.relay.metered.ca:80?transport=tcp",
    username: "7cbd6d02cf78e3bc5683bb2a",
    credential: "CPfbkDJuKleKcmkv",
  },
  {
    urls: "turn:global.relay.metered.ca:443",
    username: "7cbd6d02cf78e3bc5683bb2a",
    credential: "CPfbkDJuKleKcmkv",
  },
  {
    urls: "turns:global.relay.metered.ca:443?transport=tcp",
    username: "7cbd6d02cf78e3bc5683bb2a",
    credential: "CPfbkDJuKleKcmkv",
  },
];

function randomSessionId() {
  // 6-char session_id. Keep exact casing to match URL + DB lookup.
  return Math.random().toString(36).slice(2, 8);
}

function statusStyle(status: BridgeStatus) {
  if (status === "connected") {
    return {
      text: "Connected",
      color: "text-emerald-400",
      border: "border-emerald-500/40",
    };
  }
  if (status === "failed") {
    return { text: "Failed", color: "text-red-400", border: "border-red-500/40" };
  }
  return {
    text: "Connecting...",
    color: "text-yellow-400",
    border: "border-yellow-500/40",
  };
}

export default function StudioBridgePage() {
  const [status, setStatus] = useState<BridgeStatus>("connecting");
  const [statusNote, setStatusNote] = useState("Initializing session...");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [pingMs, setPingMs] = useState<number | null>(null);

  const peerRef = useRef<Peer.Instance | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const localMonitorAudioRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pingIntervalRef = useRef<number | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const mountedRef = useRef(true);
  const statusRef = useRef<BridgeStatus>("connecting");
  const appliedRemoteSignalRef = useRef(false);
  const seenIceRef = useRef<Set<string>>(new Set());
  const cleanupSessionRef = useRef<(() => Promise<void>) | null>(null);
  const iceAppendQueueRef = useRef<Promise<void>>(Promise.resolve());
  const existingRowRef = useRef<StudioSessionRow | null>(null);

  const badge = useMemo(() => statusStyle(status), [status]);
  const addLog = (msg: string) => {
    const line = `${new Date().toLocaleTimeString()} ${msg}`;
    setDebugLogs((prev) => [...prev, line].slice(-5));
    console.log(msg);
  };

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
    if (typeof window === "undefined") return;

    let cancelled = false;
    /** Effect-owned mic stream for Strict Mode teardown (always stop tracks here). */
    let micStream: MediaStream | null = null;

    const appendIceCandidate = async (
      sessionId: string,
      nextCandidate: IceCandidateRow
    ) => {
      const { data: current, error: currentErr } = await supabase
        .from("studio_sessions")
        .select("ice_candidates")
        .eq("session_id", sessionId)
        .single<{ ice_candidates: IceCandidateRow[] | null }>();

      if (currentErr) throw currentErr;
      const existing = Array.isArray(current?.ice_candidates) ? current.ice_candidates : [];
      const updated = [...existing, nextCandidate];

      const { error: updateErr } = await supabase
        .from("studio_sessions")
        .update({ ice_candidates: updated })
        .eq("session_id", sessionId);
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
      try {
        addLog("Signaling started");
        setStatusNote("Initializing session...");
        if (cancelled || !mountedRef.current) return;

        const url = new URL(window.location.href);
        const roomParam = url.searchParams.get("room");
        const isHost = !roomParam;
        const activeRole: Role = isHost ? "host" : "peer";
        setRole(activeRole);

        // Keep exact casing for URL session_id -> DB lookup.
        const sessionId = roomParam || randomSessionId();
        setRoomId(sessionId);
        let existingRow: StudioSessionRow | null = null;

        if (isHost) {
          addLog("Host mode: inserting studio_sessions row...");
          setStatusNote("Creating session row...");

          const hostUrl = new URL(window.location.href);
          hostUrl.searchParams.set("room", sessionId);
          setInviteLink(hostUrl.toString());

          const { data, error: insertErr } = await supabase
            .from("studio_sessions")
            .insert({
              session_id: sessionId,
              offer: null,
              answer: null,
              ice_candidates: [],
            })
            .select()
            .single<StudioSessionRow>();

          console.log("Row Created:", data);
          addLog("Row Created");

          if (insertErr) throw insertErr;

          cleanupSessionRef.current = async () => {
            addLog("Cleaning up studio_sessions row...");
            await supabase.from("studio_sessions").delete().eq("session_id", sessionId);
          };
        } else {
          addLog("Peer mode: fetching studio_sessions row...");
          setStatusNote("Fetching room...");

          const { data: fetched, error: fetchErr } = await supabase
            .from("studio_sessions")
            .select("session_id, offer, answer, ice_candidates")
            .eq("session_id", sessionId)
            .single<StudioSessionRow>();

          if (fetchErr || !fetched) throw new Error("Room not found.");
          existingRow = fetched;
          existingRowRef.current = fetched;
        }

        if (cancelled || !mountedRef.current) return;

        setStatusNote("Requesting microphone access...");
        addLog("getUserMedia (audio only)");
        let mediaStream: MediaStream;
        try {
          mediaStream = await acquireStudioMicStream();
        } catch (micErr) {
          console.error(micErr);
          addLog("Microphone blocked or unavailable");
          throw new Error("Microphone permission is required for the studio bridge.");
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

        const localEl = localMonitorAudioRef.current;
        if (localEl) {
          localEl.srcObject = mediaStream;
          localEl.muted = true;
          await localEl.play().catch(() => {
            // Autoplay policies: stream still flows to the peer.
          });
        }

        if (cancelled || !mountedRef.current) {
          micStream.getTracks().forEach((track) => track.stop());
          micStream = null;
          localStreamRef.current = null;
          return;
        }

        addLog("Creating simple-peer with resolved mic stream (default browser SDP)...");
        setStatusNote("Starting WebRTC peer...");

        const peer = new Peer({
          initiator: isHost,
          trickle: true,
          stream: mediaStream,
          config: { iceServers: ICE_SERVERS },
        });
        peerRef.current = peer;

        peer.on("stream", (remoteStream: MediaStream) => {
          if (!mountedRef.current) return;
          addLog("Remote audio stream received");
          const remoteEl = remoteAudioRef.current;
          if (remoteEl) {
            remoteEl.srcObject = remoteStream;
            remoteEl.muted = false;
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
          // Queue to avoid concurrent read-modify-write overwrites.
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

            // Trickle ICE: send each candidate immediately as soon as it is discovered.
            if (candidateLike) {
              const candidateRecord: IceCandidateRow = {
                id: `${activeRole}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                from: activeRole,
                candidate: signalData,
              };
              addLog("ICE candidate found");
              enqueueIceAppend(candidateRecord);
              return;
            }

            if (typeLike === "offer") {
              addLog("Offer sent");
              void (async () => {
                const { error } = await supabase
                  .from("studio_sessions")
                  .update({ offer: signalData })
                  .eq("session_id", sessionId);
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
                  .eq("session_id", sessionId);
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
          if (!mountedRef.current) return;
          addLog("Peer connected (media + data channel)");
          setStatus("connected");
          setStatusNote("P2P channel established.");
          setPingMs(null);

          if (activeRole === "host") {
            if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = window.setInterval(() => {
              const p = peerRef.current;
              if (!p || p.destroyed) return;
              try {
                p.send(JSON.stringify({ t: "ping", ts: performance.now() }));
              } catch {
                // Channel may be closing.
              }
            }, 1000);
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
          setPingMs(null);
          if (pingIntervalRef.current) {
            clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = null;
          }
          setStatus("failed");
          setStatusNote(`WebRTC peer error: ${msg}`);
        });

        peer.on("close", () => {
          if (!mountedRef.current) return;
          setPingMs(null);
          if (pingIntervalRef.current) {
            clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = null;
          }
          if (statusRef.current !== "connected") {
            addLog("Peer closed");
            setStatus("failed");
            setStatusNote("Peer closed before connection completed.");
          }
        });

        const channel = supabase
          .channel(`studio-session-${sessionId}`)
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "studio_sessions",
              filter: `session_id=eq.${sessionId}`,
            },
            (payload) => {
              const nextRow = payload.new as StudioSessionRow;
              if (!nextRow || typeof nextRow !== "object") return;

              if (activeRole === "host") {
                if (
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

        // Apply initial signals after subscription is active.
        if (!isHost) {
          const initial = existingRowRef.current;
          if (initial?.offer && typeof initial.offer === "object") {
            appliedRemoteSignalRef.current = true;
            addLog("Initial offer applied");
            peer.signal(initial.offer);
            setStatusNote("Creating answer...");
          }
          if (initial?.ice_candidates) {
            addLog("Initial ICE loaded");
            applyRemoteIce(initial.ice_candidates, activeRole);
          }
        } else {
          const { data: current } = await supabase
            .from("studio_sessions")
            .select("answer, ice_candidates")
            .eq("session_id", sessionId)
            .single<Pick<StudioSessionRow, "answer" | "ice_candidates">>();
          if (current?.answer && typeof current.answer === "object") {
            appliedRemoteSignalRef.current = true;
            addLog("Initial answer applied");
            peer.signal(current.answer);
          }
          if (current?.ice_candidates) {
            addLog("Initial ICE loaded (host)");
            applyRemoteIce(current.ice_candidates, activeRole);
          }
        }
      } catch (err) {
        if (cancelled || !mountedRef.current) return;
        console.error(err);
        setStatus("failed");
        setStatusNote("Could not initialize studio signaling bridge.");
      }
    };

    void init();

    return () => {
      cancelled = true;
      void (async () => {
        try {
          setPingMs(null);
          if (pingIntervalRef.current) {
            clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = null;
          }
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = null;
          }
          if (localMonitorAudioRef.current) {
            localMonitorAudioRef.current.srcObject = null;
          }
          channelRef.current?.unsubscribe();
          channelRef.current = null;

          peerRef.current?.destroy();
          peerRef.current = null;

          const toStop = micStream ?? localStreamRef.current;
          toStop?.getTracks().forEach((track) => track.stop());
          micStream = null;
          localStreamRef.current = null;

          if (cleanupSessionRef.current) {
            await cleanupSessionRef.current();
            cleanupSessionRef.current = null;
          }
        } catch {
          // Ignore cleanup errors in dev teardown.
        }
      })();
    };
  }, []);

  const copyInviteLink = async () => {
    if (!inviteLink || typeof window === "undefined") return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setStatusNote("Invite link copied.");
    } catch {
      setStatusNote("Copy failed. Share the URL manually.");
    }
  };

  return (
    <div className="min-h-screen bg-stone-950 text-white p-8 flex flex-col items-center justify-center">
      <audio ref={localMonitorAudioRef} className="sr-only" playsInline muted />
      <audio ref={remoteAudioRef} className="sr-only" playsInline />

      <div className="bg-stone-900 p-8 rounded-2xl border border-stone-800 shadow-2xl max-w-md w-full text-center">
        <h1 className="text-3xl font-bold mb-2 text-emerald-400">Kite Studio</h1>
        <p className="text-stone-400 mb-6 italic">Phase 1: The Signaling Bridge</p>

        {status === "connected" && role === "host" ? (
          <div className="mb-4 rounded-xl border border-stone-700 bg-stone-950/80 px-4 py-2 font-mono text-sm text-stone-200">
            Ping:{" "}
            <span className="text-emerald-400 tabular-nums">
              {pingMs === null ? "--" : `${pingMs}`}
            </span>{" "}
            ms
          </div>
        ) : null}

        <div className={`py-4 px-6 bg-stone-950 rounded-xl border mb-4 ${badge.border}`}>
          <span className="text-sm text-stone-500 uppercase tracking-widest font-semibold">
            Status
          </span>
          <AnimatePresence mode="wait">
            <motion.div
              key={status}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className={`text-xl font-mono mt-1 ${badge.color}`}
            >
              {badge.text}
            </motion.div>
          </AnimatePresence>
          <p className="mt-2 text-xs text-stone-400">{statusNote}</p>
          {roomId ? (
            <p className="mt-2 text-[11px] text-stone-500">Room: {roomId}</p>
          ) : null}
        </div>

        {role === "host" && inviteLink ? (
          <button
            type="button"
            onClick={() => void copyInviteLink()}
            className="w-full mb-4 rounded-xl px-4 py-3 text-sm font-semibold border border-emerald-500/45 bg-emerald-500/10 hover:bg-emerald-500/20 transition"
          >
            Copy Invite Link
          </button>
        ) : null}

        <p className="text-xs text-stone-500">
          This page is private. Only you can see this during development.
        </p>

        <div className="mt-4 w-full text-left">
          <div className="text-[11px] text-stone-500 uppercase tracking-widest font-semibold">
            Debug Logs
          </div>
          <textarea
            readOnly
            value={debugLogs.join("\n")}
            className="mt-2 w-full resize-none rounded-xl border border-stone-800 bg-black/20 p-3 font-mono text-[11px] text-stone-300 outline-none"
            rows={5}
          />
        </div>
      </div>
    </div>
  );
}

