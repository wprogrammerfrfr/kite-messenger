'use client';

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Peer, { type SignalData } from "simple-peer";
import { supabase } from "@/lib/supabase";

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

  const peerRef = useRef<Peer.Instance | null>(null);
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

        addLog("Initializing simple-peer...");
        setStatusNote("Starting WebRTC peer...");

        const peer = new Peer({
          initiator: isHost,
          trickle: true,
          config: { iceServers: ICE_SERVERS },
        });
        peerRef.current = peer;

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
          addLog("Peer connected");
          setStatus("connected");
          setStatusNote("P2P channel established.");
        });

        peer.on("error", () => {
          if (!mountedRef.current) return;
          addLog("Peer error");
          setStatus("failed");
          setStatusNote("WebRTC peer error.");
        });

        peer.on("close", () => {
          if (!mountedRef.current) return;
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
      } catch {
        if (!mountedRef.current) return;
        setStatus("failed");
        setStatusNote("Could not initialize studio signaling bridge.");
      }
    };

    void init();

    return () => {
      void (async () => {
        try {
          channelRef.current?.unsubscribe();
          channelRef.current = null;
          peerRef.current?.destroy();
          peerRef.current = null;
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
      <div className="bg-stone-900 p-8 rounded-2xl border border-stone-800 shadow-2xl max-w-md w-full text-center">
        <h1 className="text-3xl font-bold mb-2 text-emerald-400">Kite Studio</h1>
        <p className="text-stone-400 mb-6 italic">Phase 1: The Signaling Bridge</p>

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

