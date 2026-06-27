"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import Peer, { type Instance as PeerInstance, type SignalData } from "simple-peer";
import {
  applyLowLatencyInboundAudioReceivers,
  buildPeerConfig,
  decodePeerDataChunk,
  type TurnCredentialsBundle,
} from "@/lib/studio-bridge-webrtc";
import { decodeLoadIntervalChunk } from "@/lib/kite-data-chunking";
import { isPingMessage, isPongMessage } from "@/lib/p2p/data-channel-message-types";
import {
  filterNewRemoteIceCandidates,
  isSignalAnswer,
  isSignalCandidate,
  isSignalOffer,
  type IceCandidateRow,
} from "@/lib/p2p/signaling-helpers";
import type {
  BridgeStatus,
  Role,
  TransportCallbacks,
  TransportMessageHandler,
  TransportPort,
} from "@/lib/p2p/transport-port";
import { P2P_CONNECTED_NOTE } from "@/lib/p2p/transport-port";
import { forceMusicModeOpus } from "@/lib/sdp-utils";

type SessionControlLeaveMessage = {
  type: "LEAVE";
  from: Role;
  room: string;
  at: string;
};

type StudioSessionRow = {
  session_id: string;
  offer: SignalData | null;
  answer: SignalData | null;
  ice_candidates: IceCandidateRow[] | null;
  host_user_id: string | null;
  guest_user_id: string | null;
};

function normalizeStudioSessionId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6);
}

function randomSessionId(): string {
  return normalizeStudioSessionId(Math.random().toString(36).slice(2, 8));
}

function isStudioSafariWebKitEngine(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Safari/i.test(ua) && !/Chrome|Chromium|Edg|OPR|CriOS|FxiOS/i.test(ua);
}

export type UseKiteP2PTransportConfig = {
  callbacks: TransportCallbacks;
  mountedRef: RefObject<boolean>;
  supabase: SupabaseClient;
  fetchTurnCredentials: () => Promise<TurnCredentialsBundle>;
  forceRelay: boolean;
  onRemoteStreamReady: (stream: MediaStream) => void;
  onRemotePlaybackTeardown: () => void;
  onFullTeardown: () => Promise<void>;
  /** When true, page coordinator already ran full teardown — skip ordered async cleanup. */
  shouldSkipOrderedTeardown?: () => boolean;
  onCollaboratorDeparted: (params: { departedName: string; selfRole: Role | null }) => void;
  getLocalStream: () => MediaStream | null;
  getAudioContext: () => AudioContext | null;
  /** Reconnect stream resolution (mixer master vs mic fallback). */
  getConnectStream?: () => MediaStream | null;
  /** Host: register row delete cleanup after reserveSession. */
  onRegisterSessionCleanup?: (cleanup: () => Promise<void>) => void;
  /** peer.on("connect") bundle (pending KITE_SYNC, SET_INTERVAL, etc.). */
  onPeerConnect?: () => void;
  /** Data channel open — flush pending sync packets queued before `peer.connected`. */
  onTransportPortReady?: () => void;
  /** Host: peer dropped during active Kite session. */
  onHostPeerDisconnected?: () => void;
  /** peer.on("close") while not fully connected — begin lost countdown. */
  onRecoverablePeerClose?: () => void;
  /** Before ICE soft reboot transport teardown (VoIP restore + partial kite cleanup). */
  onReconnectPrepare?: () => void;
};

export type KiteP2PTransportApi = {
  reserveSession: () => Promise<boolean>;
  connect: (localStream: MediaStream, ctx: AudioContext) => Promise<void>;
  disconnect: () => void;
  reconnect: () => Promise<void>;
  sendLeave: () => Promise<void>;
  reset: () => void;
  transportPortRef: MutableRefObject<TransportPort | null>;
  peerRef: MutableRefObject<PeerInstance | null>;
  peerConnectionRef: MutableRefObject<RTCPeerConnection | null>;
  remoteStreamRef: MutableRefObject<MediaStream | null>;
  remoteParticipantNameRef: MutableRefObject<string | null>;
  p2pConnectSucceededRef: MutableRefObject<boolean>;
  activeRoleRef: MutableRefObject<Role | null>;
  isConnected: boolean;
  sessionId: string | null;
  role: Role | null;
};

function createTransportPort(
  peer: PeerInstance,
  getPeerConnection: () => RTCPeerConnection | null,
  subscribers: Set<TransportMessageHandler>
): TransportPort {
  return {
    sendJson: (payload: unknown) => {
      if (!peer.connected || peer.destroyed) return;
      try {
        peer.send(JSON.stringify(payload));
      } catch {
        /* best-effort */
      }
    },
    sendBinary: (chunk: ArrayBuffer | Uint8Array) => {
      if (!peer.connected || peer.destroyed) return;
      try {
        const buf = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        peer.send(buf);
      } catch {
        /* best-effort */
      }
    },
    isReady: () => peer.connected === true && !peer.destroyed,
    replaceTrack: (oldTrack, newTrack, stream) => {
      const p = peer as PeerInstance & {
        replaceTrack?: (
          o: MediaStreamTrack | null,
          n: MediaStreamTrack,
          s: MediaStream
        ) => void;
      };
      if (typeof p.replaceTrack === "function") {
        p.replaceTrack(oldTrack, newTrack, stream);
      }
    },
    subscribe: (handler) => {
      subscribers.add(handler);
      return () => {
        subscribers.delete(handler);
      };
    },
    getPeerConnection,
  };
}

// Attach fan-out helper on port creation closure via subscribers Set passed by reference
function wireDataChannelFanOut(
  peer: PeerInstance,
  subscribers: Set<TransportMessageHandler>,
  mountedRef: RefObject<boolean>,
  onPingMs: (ms: number | null) => void
): void {
  peer.on("data", (chunk: unknown) => {
    const loadChunk = decodeLoadIntervalChunk(chunk);
    if (loadChunk) {
      subscribers.forEach((handler) => {
        handler({ raw: chunk, text: null, parsed: loadChunk });
      });
      return;
    }

    try {
      const text = decodePeerDataChunk(chunk);
      const parsed: unknown = JSON.parse(text);
      if (isPingMessage(parsed)) {
        try {
          peer.send(JSON.stringify({ t: "pong", ts: parsed.ts }));
        } catch {
          /* ignore */
        }
        return;
      }
      if (isPongMessage(parsed)) {
        if (mountedRef.current) {
          onPingMs(Math.round(performance.now() - parsed.ts));
        }
        return;
      }
      subscribers.forEach((handler) => {
        handler({ raw: chunk, text, parsed });
      });
    } catch {
      // Ignore non-JSON or malformed ping payloads.
    }
  });
}

export function useKiteP2PTransport(config: UseKiteP2PTransportConfig): KiteP2PTransportApi {
  const configRef = useRef(config);
  configRef.current = config;

  const callbacksRef = useRef(config.callbacks);
  useEffect(() => {
    callbacksRef.current = config.callbacks;
  }, [config.callbacks]);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const transportPortRef = useRef<TransportPort | null>(null);
  const peerRef = useRef<PeerInstance | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteParticipantNameRef = useRef<string | null>(null);
  const p2pConnectSucceededRef = useRef(false);
  const activeRoleRef = useRef<Role | null>(null);
  const statusRef = useRef<BridgeStatus>("connecting");

  const channelRef = useRef<ReturnType<SupabaseClient["channel"]> | null>(null);
  const seenIceRef = useRef<Set<string>>(new Set());
  const appliedRemoteSignalRef = useRef(false);
  const existingRowRef = useRef<StudioSessionRow | null>(null);
  const leaveSignalSentRef = useRef(false);
  const leaveSignalReceivedRef = useRef(false);
  const studioSessionReservedRef = useRef(false);
  const bridgeInitInFlightRef = useRef(false);
  const pingIntervalRef = useRef<number | null>(null);
  const handshakeFallbackIntervalRef = useRef<number | null>(null);
  const turnCredentialRefreshTimerRef = useRef<number | null>(null);
  const turnCredentialExpiresAtMsRef = useRef<number | null>(null);
  const turnCredentialFetchedAtMsRef = useRef<number | null>(null);
  const iceAppendQueueRef = useRef<Promise<void>>(Promise.resolve());
  const messageSubscribersRef = useRef<Set<TransportMessageHandler>>(new Set());

  const transportSessionIdRef = useRef("");
  const transportIsHostRef = useRef(true);
  const transportForceRelayRef = useRef(config.forceRelay);
  const cancelledRef = useRef(false);
  const teardownRanRef = useRef(false);
  const connectTimeoutRef = useRef<number | null>(null);
  const localIceCandidateSeenRef = useRef(false);
  const timeoutExtendedForIceRef = useRef(false);

  const setStatus = useCallback((status: BridgeStatus) => {
    statusRef.current = status;
    setIsConnected(status === "connected");
    callbacksRef.current.onStatusChange(status);
  }, []);

  const addLog = useCallback((message: string) => {
    callbacksRef.current.onLog(message);
  }, []);

  const clearConnectTimeout = useCallback(() => {
    if (connectTimeoutRef.current !== null) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
  }, []);

  const clearPingInterval = useCallback(() => {
    if (pingIntervalRef.current !== null) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
  }, []);

  const clearHandshakeFallback = useCallback(() => {
    if (handshakeFallbackIntervalRef.current !== null) {
      window.clearInterval(handshakeFallbackIntervalRef.current);
      handshakeFallbackIntervalRef.current = null;
    }
  }, []);

  const clearTurnCredentialRefreshTimer = useCallback(() => {
    if (turnCredentialRefreshTimerRef.current !== null) {
      clearTimeout(turnCredentialRefreshTimerRef.current);
      turnCredentialRefreshTimerRef.current = null;
    }
  }, []);

  const appendIceCandidate = useCallback(
    async (sessionId: string, nextCandidate: IceCandidateRow) => {
      const { supabase } = configRef.current;
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
    },
    []
  );

  const applyRemoteIce = useCallback(
    (incoming: IceCandidateRow[] | null | undefined, myRole: Role) => {
      const peer = peerRef.current;
      if (!peer) return;
      const newCandidates = filterNewRemoteIceCandidates(incoming, myRole, seenIceRef.current);
      for (const item of newCandidates) {
        seenIceRef.current.add(item.id);
        peer.signal(item.candidate as SignalData);
      }
    },
    []
  );

  const scheduleTurnCredentialRefresh = useCallback(
    (expiresAtEpochMs: number | null, transportForceRelay: boolean) => {
      clearTurnCredentialRefreshTimer();
      if (typeof expiresAtEpochMs !== "number" || !Number.isFinite(expiresAtEpochMs)) {
        return;
      }
      const refreshSkewMs = 60_000;
      const delayMs = Math.max(10_000, expiresAtEpochMs - Date.now() - refreshSkewMs);
      turnCredentialRefreshTimerRef.current = window.setTimeout(() => {
        turnCredentialRefreshTimerRef.current = null;
        void (async () => {
          if (cancelledRef.current || !configRef.current.mountedRef.current) return;
          try {
            const refreshBundle = await configRef.current.fetchTurnCredentials();
            const pc = peerConnectionRef.current;
            if (!pc || cancelledRef.current || !configRef.current.mountedRef.current) return;
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
            scheduleTurnCredentialRefresh(refreshBundle.expiresAtEpochMs, transportForceRelay);
          } catch (err) {
            console.error("[Kite] TURN credential refresh failed:", err);
            turnCredentialRefreshTimerRef.current = window.setTimeout(() => {
              scheduleTurnCredentialRefresh(
                turnCredentialExpiresAtMsRef.current ?? Date.now() + 150_000,
                transportForceRelay
              );
            }, 120_000);
          }
        })();
      }, delayMs);
    },
    [clearTurnCredentialRefreshTimer]
  );

  const destroyPeerAndChannel = useCallback(() => {
    clearConnectTimeout();
    clearPingInterval();
    clearHandshakeFallback();
    channelRef.current?.unsubscribe();
    channelRef.current = null;
    peerRef.current?.destroy();
    peerRef.current = null;
    peerConnectionRef.current = null;
    transportPortRef.current = null;
  }, [clearConnectTimeout, clearHandshakeFallback, clearPingInterval]);

  const disconnect = useCallback(() => {
    if (teardownRanRef.current) return;
    teardownRanRef.current = true;
    cancelledRef.current = true;
    studioSessionReservedRef.current = false;

    try {
      if (peerRef.current && p2pConnectSucceededRef.current) {
        const activeRole = activeRoleRef.current;
        if (activeRole) {
          peerRef.current.send(JSON.stringify({ type: "LEAVE", from: activeRole }));
        }
      }
    } catch {
      /* ignore */
    }

    clearTurnCredentialRefreshTimer();
    turnCredentialExpiresAtMsRef.current = null;
    turnCredentialFetchedAtMsRef.current = null;
    callbacksRef.current.onPingMs(null);
    destroyPeerAndChannel();

    void (async () => {
      try {
        if (configRef.current.shouldSkipOrderedTeardown?.()) return;
        configRef.current.onRemotePlaybackTeardown();
        await configRef.current.onFullTeardown();
      } catch {
        // Ignore cleanup errors in dev teardown.
      }
    })();
  }, [clearTurnCredentialRefreshTimer, destroyPeerAndChannel]);

  const connectRef = useRef<
    ((localStream: MediaStream, ctx: AudioContext) => Promise<void>) | null
  >(null);

  const reconnect = useCallback(async () => {
    const getStream =
      configRef.current.getConnectStream ?? configRef.current.getLocalStream;
    const ctx = configRef.current.getAudioContext();
    if (!getStream() || !ctx) return;

    clearTurnCredentialRefreshTimer();
    configRef.current.onReconnectPrepare?.();
    addLog("Initiating ICE Soft Reboot...");
    setStatus("connecting");
    callbacksRef.current.onStatusNote("Connection dropped. Reconnecting...");

    destroyPeerAndChannel();
    p2pConnectSucceededRef.current = false;
    appliedRemoteSignalRef.current = false;
    seenIceRef.current = new Set();

    const { supabase } = configRef.current;
    const sessionId = transportSessionIdRef.current;
    const transportIsHost = transportIsHostRef.current;

    if (transportIsHost) {
      await supabase
        .from("studio_sessions")
        .update({ offer: null, answer: null, ice_candidates: [] })
        .eq("session_id", sessionId.toUpperCase());
    } else {
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }

    const resolvedStream = getStream();
    if (!resolvedStream) {
      console.warn(
        "[ReconnectTransport] Aborted: Local stream vanished during teardown wait."
      );
      return;
    }

    const connect = connectRef.current;
    if (!connect) {
      console.warn("[ReconnectTransport] Aborted: connect not ready.");
      return;
    }

    await connect(resolvedStream, ctx);
  }, [addLog, clearTurnCredentialRefreshTimer, destroyPeerAndChannel, setStatus]);

  const connect = useCallback(
    async (localStream: MediaStream, ctx: AudioContext) => {
      const localTrack = localStream?.getAudioTracks()[0] ?? null;
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
      cancelledRef.current = false;
      teardownRanRef.current = false;
      localIceCandidateSeenRef.current = false;
      timeoutExtendedForIceRef.current = false;
      leaveSignalReceivedRef.current = false;

      const transportSessionId = transportSessionIdRef.current;
      const transportActiveRole = activeRoleRef.current ?? "host";
      const transportIsHost = transportIsHostRef.current;
      const transportForceRelay =
        transportForceRelayRef.current || configRef.current.forceRelay;

      setStatus("connecting");
      addLog("Phase 3: Realtime subscribe + peer");
      callbacksRef.current.onStatusNote("Starting peer connection...");

      const { supabase, mountedRef } = configRef.current;
      const cb = () => callbacksRef.current;

      const scheduleConnectTimeout = (delayMs: number) => {
        clearConnectTimeout();
        connectTimeoutRef.current = window.setTimeout(() => {
          if (!mountedRef.current || cancelledRef.current || statusRef.current !== "connecting") {
            return;
          }
          if (!localIceCandidateSeenRef.current && !timeoutExtendedForIceRef.current) {
            timeoutExtendedForIceRef.current = true;
            addLog("No local ICE yet after 15s; extending timeout window.");
            callbacksRef.current.onStatusNote("Gathering network routes...");
            scheduleConnectTimeout(10000);
            return;
          }
          console.error("WebRTC timeout before connect", {
            iceServers: "Fetched dynamically",
            localIceCandidateSeen: localIceCandidateSeenRef.current,
          });
          setStatus("failed");
          callbacksRef.current.onStatusNote(
            "Network Restricted. This can happen on some restricted Wi-Fi networks. Try switching to Mobile Data."
          );
        }, delayMs);
      };

      const roomId = `session_id:${transportSessionId.toUpperCase()}`;
      const channel = supabase
        .channel(roomId, {
          config: { realtime: { heartbeatIntervalMs: 3000 } },
        } as Parameters<SupabaseClient["channel"]>[1])
        .on("broadcast", { event: "session-control" }, (payload) => {
          const msg = payload.payload as SessionControlLeaveMessage | undefined;
          if (!msg || msg.type !== "LEAVE") return;
          if (msg.room !== transportSessionId.toUpperCase()) return;
          if (msg.from === transportActiveRole) return;
          const departedName =
            remoteParticipantNameRef.current?.trim() || "A participant";
          leaveSignalReceivedRef.current = true;
          addLog("Collaborator LEAVE received");
          configRef.current.onCollaboratorDeparted({
            departedName,
            selfRole: transportActiveRole,
          });
          cb().onLastDepartedParticipantName(departedName);
          cb().onRemoteParticipantName(null);
          remoteParticipantNameRef.current = null;
          cb().onStatusNote(`${departedName} left the session.`);
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
            const nextRow = payload.new as StudioSessionRow;
            if (!nextRow || typeof nextRow !== "object") return;
            const peer = peerRef.current;

            if (transportActiveRole === "host") {
              if (
                peer &&
                !appliedRemoteSignalRef.current &&
                nextRow.answer != null &&
                isSignalAnswer(nextRow.answer)
              ) {
                appliedRemoteSignalRef.current = true;
                addLog("Answer received");
                peer.signal(nextRow.answer);
                scheduleConnectTimeout(60000);
                callbacksRef.current.onStatusNote("Answer received. Negotiating...");
              }
            } else if (
              peer &&
              !appliedRemoteSignalRef.current &&
              nextRow.offer != null &&
              isSignalOffer(nextRow.offer)
            ) {
              appliedRemoteSignalRef.current = true;
              addLog("Offer received");
              peer.signal(nextRow.offer);
              scheduleConnectTimeout(60000);
              callbacksRef.current.onStatusNote("Offer received. Creating answer...");
            }

            applyRemoteIce(nextRow.ice_candidates, transportActiveRole);
          }
        )
        .subscribe((status, err) => {
          console.log("[SUPABASE-CHANNEL-STATUS]", status, err);
          if (status === "SUBSCRIBED") {
            console.log("[Kite] Signaling Bridge Restored");
          }
        });
      channelRef.current = channel;

      addLog(
        `Negotiation: ${transportIsHost ? "host initiates (offer first)" : "guest answers"}`
      );

      const isSafariWebKit = isStudioSafariWebKitEngine();
      const lowLatencyReceiverOpts = { isSafariWebKit };

      const bundle = await configRef.current.fetchTurnCredentials();
      const iceServers = bundle.iceServers;
      turnCredentialExpiresAtMsRef.current = bundle.expiresAtEpochMs;
      turnCredentialFetchedAtMsRef.current = Date.now();
      if (transportForceRelay && iceServers.length === 0) {
        callbacksRef.current.onStatusNote(
          "Secure relay servers unavailable. Restrictive network detected."
        );
      }
      const peerConfig = buildPeerConfig(iceServers, transportForceRelay);
      const peer = new Peer({
        initiator: transportIsHost,
        trickle: true,
        stream: localStream,
        config: peerConfig,
        channelConfig: {
          ordered: true,
        },
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

      const subscribers = messageSubscribersRef.current;
      transportPortRef.current = createTransportPort(
        peer,
        () => peerConnectionRef.current,
        subscribers
      );
      wireDataChannelFanOut(peer, subscribers, mountedRef, (ms) => {
        callbacksRef.current.onPingMs(ms);
      });

      peer.on("error", (err) => {
        console.error("[PEER-ERROR]", err);
      });

      if ((peer as unknown as { _pc?: RTCPeerConnection })._pc) {
        const pc = (peer as unknown as { _pc: RTCPeerConnection })._pc;
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

      scheduleConnectTimeout(60000);

      handshakeFallbackIntervalRef.current = window.setInterval(async () => {
        if (
          p2pConnectSucceededRef.current ||
          statusRef.current !== "connecting" ||
          !mountedRef.current
        ) {
          clearHandshakeFallback();
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
            if (
              !appliedRemoteSignalRef.current &&
              data.answer != null &&
              isSignalAnswer(data.answer)
            ) {
              appliedRemoteSignalRef.current = true;
              addLog("Answer received (via Poller)");
              currentPeer.signal(data.answer);
              scheduleConnectTimeout(60000);
              callbacksRef.current.onStatusNote("Answer received. Negotiating...");
            }
          } else if (
            !appliedRemoteSignalRef.current &&
            data.offer != null &&
            isSignalOffer(data.offer)
          ) {
            appliedRemoteSignalRef.current = true;
            addLog("Offer received (via Poller)");
            currentPeer.signal(data.offer);
            scheduleConnectTimeout(60000);
            callbacksRef.current.onStatusNote("Offer received. Creating answer...");
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

        rawPc.addEventListener("icecandidate", () => {
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
            callbacksRef.current.onError(null);
            setStatus("connected");
            callbacksRef.current.onConnectionLostCountdown(null);
            applyLowLatencyInboundAudioReceivers(rawPc, lowLatencyReceiverOpts);
            void rawPc
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
                /* stats may be unavailable */
              });
            return;
          }
          if (iceState === "disconnected") {
            void reconnect();
            return;
          }
          if (iceState === "failed") {
            void reconnect();
          }
        });
        scheduleTurnCredentialRefresh(turnCredentialExpiresAtMsRef.current, transportForceRelay);
      }

      peer.on("stream", (remoteStream: MediaStream) => {
        if (!mountedRef.current) return;
        addLog("Remote audio stream received");
        remoteStreamRef.current = remoteStream;
        configRef.current.onRemoteStreamReady(remoteStream);
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
          if (isSignalCandidate(signalData)) {
            localIceCandidateSeenRef.current = true;
            const candidateRecord: IceCandidateRow = {
              id: `${transportActiveRole}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              from: transportActiveRole,
              candidate: signalData,
            };
            enqueueIceAppend(candidateRecord);
            return;
          }

          if (isSignalOffer(signalData)) {
            addLog("Offer sent");
            void (async () => {
              const { error } = await supabase
                .from("studio_sessions")
                .update({ offer: signalData })
                .eq("session_id", transportSessionId.toUpperCase());
              if (error) throw error;
              callbacksRef.current.onStatusNote("Offer published. Waiting for peer answer...");
            })().catch((err) => {
              console.error("Offer publish failed", err);
              setStatus("failed");
              callbacksRef.current.onStatusNote("Offer publish failed.");
            });
            return;
          }

          if (isSignalAnswer(signalData)) {
            addLog("Answer sent");
            void (async () => {
              const { error } = await supabase
                .from("studio_sessions")
                .update({ answer: signalData })
                .eq("session_id", transportSessionId.toUpperCase());
              if (error) throw error;
              callbacksRef.current.onStatusNote("Answer sent. Finalizing connection...");
            })().catch((err) => {
              console.error("Answer publish failed", err);
              setStatus("failed");
              callbacksRef.current.onStatusNote("Answer publish failed.");
            });
            return;
          }
        } catch {
          setStatus("failed");
          callbacksRef.current.onStatusNote("Signaling update failed.");
        }
      });

      peer.on("connect", () => {
        p2pConnectSucceededRef.current = true;
        callbacksRef.current.onError(null);
        setStatus("connected");
        callbacksRef.current.onStatusNote(P2P_CONNECTED_NOTE);
        void channel.unsubscribe();
        if (channelRef.current === channel) {
          channelRef.current = null;
        }
        console.log("[Kite] Handshake complete. Signaling bridge closed to reduce jitter.");
        try {
          peer.send(
            JSON.stringify({
              type: "presence",
              name: transportIsHost ? "Host" : "Guest",
            })
          );
        } catch {
          /* presence best-effort */
        }
        configRef.current.onPeerConnect?.();
        configRef.current.onTransportPortReady?.();
        clearConnectTimeout();
        clearPingInterval();
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
        clearPingInterval();
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
        callbacksRef.current.onRemoteParticipantName(null);
        remoteParticipantNameRef.current = null;
        clearPingInterval();
        clearConnectTimeout();
        if (transportIsHost) {
          configRef.current.onHostPeerDisconnected?.();
        }
        if (!leaveSignalReceivedRef.current && statusRef.current !== "connected") {
          addLog("Peer closed");
          configRef.current.onRecoverablePeerClose?.();
          callbacksRef.current.onStatusNote("Connection lost, attempting to recover...");
        }
      });

      if (!transportIsHost) {
        const initial = existingRowRef.current;
        if (initial?.offer != null && isSignalOffer(initial.offer)) {
          appliedRemoteSignalRef.current = true;
          addLog("Initial offer applied");
          peer.signal(initial.offer);
          callbacksRef.current.onStatusNote("Creating answer...");
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
        if (current?.answer != null && isSignalAnswer(current.answer)) {
          appliedRemoteSignalRef.current = true;
          addLog("Initial answer applied");
          peer.signal(current.answer);
        }
        if (current?.ice_candidates) {
          applyRemoteIce(current.ice_candidates, transportActiveRole);
        }
      }
    },
    [
      addLog,
      appendIceCandidate,
      applyRemoteIce,
      clearConnectTimeout,
      clearHandshakeFallback,
      clearPingInterval,
      clearTurnCredentialRefreshTimer,
      reconnect,
      scheduleTurnCredentialRefresh,
      setStatus,
    ]
  );

  connectRef.current = connect;

  const reserveSession = useCallback(async (): Promise<boolean> => {
    if (studioSessionReservedRef.current) return true;
    if (bridgeInitInFlightRef.current) return false;
    cancelledRef.current = false;
    bridgeInitInFlightRef.current = true;
    try {
      const url = new URL(window.location.href);
      const forceRelay =
        url.searchParams.get("relay") === "true" || configRef.current.forceRelay;
      transportForceRelayRef.current = forceRelay;

      const roomParamRaw = url.searchParams.get("room");
      const isHost = roomParamRaw === null;
      const sessionIdCandidate = isHost
        ? randomSessionId()
        : normalizeStudioSessionId(roomParamRaw ?? "").toUpperCase();
      if (!isHost && sessionIdCandidate.length !== 6) {
        throw new Error("Invalid room code. Expected 6 characters.");
      }
      const sessionId = sessionIdCandidate.toUpperCase();
      const { supabase, mountedRef } = configRef.current;
      const cb = () => callbacksRef.current;

      if (!isHost) {
        if (!cancelledRef.current && mountedRef.current) {
          setSessionId(sessionId);
          cb().onSessionId(sessionId);
        }
      } else {
        configRef.current.onRegisterSessionCleanup?.(async () => {
          addLog("Cleaning up studio_sessions row...");
          await supabase
            .from("studio_sessions")
            .delete()
            .eq("session_id", sessionId.toUpperCase());
        });

        const { error: reserveErr } = await supabase.from("studio_sessions").upsert(
          { session_id: sessionId.toUpperCase() },
          { onConflict: "session_id" }
        );
        if (reserveErr) throw reserveErr;

        if (!cancelledRef.current && mountedRef.current) {
          const hostUrlSynced = new URL(window.location.href);
          hostUrlSynced.searchParams.set("room", sessionId.toUpperCase());
          const invite = hostUrlSynced.toString();
          cb().onInviteLink(invite);
          window.history.replaceState(null, "", hostUrlSynced.toString());
          setSessionId(sessionId);
          cb().onSessionId(sessionId);
        }
      }

      const activeRole: Role = isHost ? "host" : "peer";
      activeRoleRef.current = activeRole;
      setRole(activeRole);
      cb().onRole(activeRole);

      if (isHost) {
        addLog("Phase 2: host full upsert studio_sessions");
        cb().onStatusNote("Room Created. Waiting in Lobby...");

        const { error: insertErr } = await supabase.from("studio_sessions").upsert(
          {
            session_id: sessionId.toUpperCase(),
            offer: null,
            answer: null,
            ice_candidates: [],
          },
          { onConflict: "session_id" }
        );
        if (insertErr) throw insertErr;
      } else {
        addLog("Phase 2: guest fetch studio_sessions");
        cb().onStatusNote("Room Joined. Waiting in Lobby...");

        const { data: fetched, error: fetchErr } = await supabase
          .from("studio_sessions")
          .select("session_id, offer, answer, ice_candidates, host_user_id")
          .eq("session_id", sessionId.toUpperCase())
          .single<StudioSessionRow>();

        if (fetchErr || !fetched) throw new Error("Room not found.");

        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user?.id && fetched.host_user_id && user.id === fetched.host_user_id) {
          if (mountedRef.current) {
            cb().onStatusChange("failed");
            cb().onStatusNote("You cannot join your own session as a guest.");
            window.alert("You cannot join your own session as a guest.");
          }
          return false;
        }

        existingRowRef.current = fetched;
      }

      if (cancelledRef.current || !mountedRef.current) {
        return false;
      }

      transportSessionIdRef.current = sessionId;
      transportIsHostRef.current = isHost;
      studioSessionReservedRef.current = true;
      return true;
    } finally {
      bridgeInitInFlightRef.current = false;
    }
  }, [addLog]);

  const sendLeave = useCallback(async () => {
    const activeSessionId = sessionId ?? transportSessionIdRef.current;
    const activeRole = role ?? activeRoleRef.current;
    if (leaveSignalSentRef.current || !activeSessionId || !activeRole) return;
    leaveSignalSentRef.current = true;
    const payload: SessionControlLeaveMessage = {
      type: "LEAVE",
      from: activeRole,
      room: activeSessionId.toUpperCase(),
      at: new Date().toISOString(),
    };
    try {
      const peer = peerRef.current;
      if (peer && !peer.destroyed && peer.connected === true) {
        peer.send(JSON.stringify(payload));
        addLog("LEAVE signal sent over data channel");
      }
    } catch (err) {
      console.error("Data-channel LEAVE signal send failed", err);
    }
    try {
      await channelRef.current?.send({
        type: "broadcast",
        event: "session-control",
        payload,
      });
      addLog("LEAVE signal sent over signaling channel");
    } catch (err) {
      console.error("Signaling LEAVE signal send failed", err);
    }
  }, [addLog, role, sessionId]);

  const reset = useCallback(() => {
    cancelledRef.current = true;
    teardownRanRef.current = false;
    studioSessionReservedRef.current = false;
    bridgeInitInFlightRef.current = false;
    leaveSignalSentRef.current = false;
    leaveSignalReceivedRef.current = false;
    p2pConnectSucceededRef.current = false;
    appliedRemoteSignalRef.current = false;
    seenIceRef.current.clear();
    existingRowRef.current = null;
    messageSubscribersRef.current.clear();
    clearTurnCredentialRefreshTimer();
    destroyPeerAndChannel();
    transportPortRef.current = null;
    remoteStreamRef.current = null;
    remoteParticipantNameRef.current = null;
    activeRoleRef.current = null;
    transportSessionIdRef.current = "";
    statusRef.current = "connecting";
    setIsConnected(false);
    setSessionId(null);
    setRole(null);
  }, [clearTurnCredentialRefreshTimer, destroyPeerAndChannel]);

  const apiRef = useRef<KiteP2PTransportApi>({
    reserveSession,
    connect,
    disconnect,
    reconnect,
    sendLeave,
    reset,
    transportPortRef,
    peerRef,
    peerConnectionRef,
    remoteStreamRef,
    remoteParticipantNameRef,
    p2pConnectSucceededRef,
    activeRoleRef,
    isConnected,
    sessionId,
    role,
  });

  apiRef.current = {
    reserveSession,
    connect,
    disconnect,
    reconnect,
    sendLeave,
    reset,
    transportPortRef,
    peerRef,
    peerConnectionRef,
    remoteStreamRef,
    remoteParticipantNameRef,
    p2pConnectSucceededRef,
    activeRoleRef,
    isConnected,
    sessionId,
    role,
  };

  return apiRef.current;
}
