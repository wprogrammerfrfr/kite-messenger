"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  useKiteP2PTransport,
  type KiteP2PTransportApi,
  type UseKiteP2PTransportConfig,
} from "@/hooks/useKiteP2PTransport";
import {
  useKiteSyncEngine,
  type CleanupKiteOpts,
  type KiteSyncEngineApi,
  type KiteSyncEngineConfig,
} from "@/hooks/useKiteSyncEngine";
import {
  useMeteredDelayPlayback,
  type MeteredDelayPlaybackApi,
  type UseMeteredDelayPlaybackConfig,
} from "@/hooks/useMeteredDelayPlayback";
import {
  isJamSetupLockMessage,
  isKiteSyncMessage,
  isLeaveMessage,
  isPresenceMessage,
  isSetIntervalMessage,
  isStudioParamMessage,
  type JamSetupLockMessage,
  type StudioParamMessage,
} from "@/lib/p2p/data-channel-message-types";
import type { BridgeStatus, Role } from "@/lib/p2p/transport-port";

export type KiteP2PEngineLeaveParams = {
  departedName: string;
  selfRole: Role | null;
};

export type KiteP2PEngineCollabHandlers = {
  onJamSetupLock: (msg: JamSetupLockMessage) => void;
  onStudioParam: (msg: StudioParamMessage) => void;
  onPresence: (name: string) => void;
};

export type DropKiteSyncToLiveP2POptions = {
  notifyPeer?: boolean;
};

export type UseKiteP2PEngineConfig = {
  meteredConfig: Omit<UseMeteredDelayPlaybackConfig, "peerConnectionRef">;
  syncConfig: Omit<KiteSyncEngineConfig, "getTransportPort" | "meteredDelay">;
  transportConfig: Omit<
    UseKiteP2PTransportConfig,
    "onFullTeardown" | "onRemotePlaybackTeardown" | "onCollaboratorDeparted"
  >;
  collabHandlers: KiteP2PEngineCollabHandlers;
  /** Bridge status for subscriber gating (`connecting` | `connected`). */
  bridgeStatus: BridgeStatus;
  /** Returns true when Kite Sync is actively syncing or live (not idle). */
  getKiteSyncActive: () => boolean;
  /** Solo engine, mixer, AudioContext close — after sync + metered teardown. */
  onPageFullTeardown: () => Promise<void>;
  /** Page presenter UI only after partial sync drop on LEAVE. */
  onCollaboratorLeave: (params: KiteP2PEngineLeaveParams) => void;
};

export type KiteP2PEngineApi = {
  transport: KiteP2PTransportApi;
  metered: MeteredDelayPlaybackApi;
  sync: KiteSyncEngineApi;
  /** Fixed order: sync.cleanup → metered.teardownGraph → page full teardown. */
  runOrderedSessionTeardown: (opts?: CleanupKiteOpts) => Promise<void>;
  /** Partial exit: Stop Kite Sync path (VoIP restore, live P2P). */
  dropKiteSyncToLiveP2P: (opts?: DropKiteSyncToLiveP2POptions) => void;
  /** Unified LEAVE handler (Realtime + data-channel). */
  handleCollaboratorLeave: (params: KiteP2PEngineLeaveParams) => void;
};

export function useKiteP2PEngine(config: UseKiteP2PEngineConfig): KiteP2PEngineApi {
  const configRef = useRef(config);
  configRef.current = config;

  const transportApiRef = useRef<KiteP2PTransportApi | null>(null);
  const syncApiRef = useRef<KiteSyncEngineApi | null>(null);
  const meteredTeardownRef = useRef<() => void>(() => {});
  const orderedTeardownRef = useRef<(opts?: CleanupKiteOpts) => Promise<void>>(
    async () => {}
  );
  const teardownInFlightRef = useRef(false);
  const handleCollaboratorLeaveRef = useRef<(params: KiteP2PEngineLeaveParams) => void>(
    () => {}
  );

  const runOrderedSessionTeardown = useCallback(async (opts?: CleanupKiteOpts): Promise<void> => {
    if (teardownInFlightRef.current) return;
    teardownInFlightRef.current = true;
    try {
      syncApiRef.current?.cleanup(opts);
      meteredTeardownRef.current();
      await configRef.current.onPageFullTeardown();
    } finally {
      teardownInFlightRef.current = false;
    }
  }, []);

  orderedTeardownRef.current = runOrderedSessionTeardown;

  const dropKiteSyncToLiveP2P = useCallback((opts?: DropKiteSyncToLiveP2POptions): void => {
    if (!configRef.current.getKiteSyncActive()) return;
    syncApiRef.current?.dropKiteSyncToLiveP2P(opts);
  }, []);

  const handleCollaboratorLeave = useCallback((params: KiteP2PEngineLeaveParams): void => {
    dropKiteSyncToLiveP2P({ notifyPeer: false });
    configRef.current.onCollaboratorLeave(params);
    void transportApiRef.current?.disconnect();
  }, [dropKiteSyncToLiveP2P]);

  handleCollaboratorLeaveRef.current = handleCollaboratorLeave;

  const transport = useKiteP2PTransport({
    ...config.transportConfig,
    onRemotePlaybackTeardown: () => meteredTeardownRef.current(),
    onFullTeardown: async () => {
      await orderedTeardownRef.current({ isFull: true });
    },
    onCollaboratorDeparted: (params) => {
      handleCollaboratorLeaveRef.current(params);
    },
  });

  transportApiRef.current = transport;

  const meteredConfig = useMemo(
    (): UseMeteredDelayPlaybackConfig => ({
      ...config.meteredConfig,
      peerConnectionRef: transport.peerConnectionRef,
    }),
    [config.meteredConfig, transport.peerConnectionRef]
  );

  const metered = useMeteredDelayPlayback(meteredConfig);
  meteredTeardownRef.current = metered.teardownGraph;

  const sync = useKiteSyncEngine({
    ...config.syncConfig,
    getTransportPort: () => transportApiRef.current?.transportPortRef.current ?? null,
    meteredDelay: {
      flushAndSetGridTarget: metered.flushAndSetGridTarget,
      calculatedDelayMsRef: metered.calculatedDelayMsRef,
      targetLeadFramesRef: metered.targetLeadFramesRef,
    },
  });

  syncApiRef.current = sync;

  useEffect(() => {
    const bridgeStatus = config.bridgeStatus;
    if (bridgeStatus !== "connecting" && bridgeStatus !== "connected") return;

    const port = transport.transportPortRef.current;
    if (!port) return;

    const activeRole = transport.activeRoleRef.current;

    return port.subscribe(({ raw, parsed }) => {
      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed as { type?: string }).type === "LOAD_INTERVAL"
      ) {
        syncApiRef.current?.handleLoadIntervalChunk(raw);
        return;
      }

      if (!parsed || typeof parsed !== "object") return;

      if (isLeaveMessage(parsed)) {
        if (parsed.from === activeRole) return;
        const departedName =
          transport.remoteParticipantNameRef.current?.trim() || "A participant";
        handleCollaboratorLeaveRef.current({
          departedName,
          selfRole: activeRole,
        });
        return;
      }

      const collab = configRef.current.collabHandlers;

      if (isJamSetupLockMessage(parsed)) {
        collab.onJamSetupLock(parsed);
        return;
      }
      if (isSetIntervalMessage(parsed)) {
        syncApiRef.current?.handleSetIntervalMessage(parsed);
        return;
      }
      if (isStudioParamMessage(parsed)) {
        collab.onStudioParam(parsed);
        return;
      }
      if (isPresenceMessage(parsed)) {
        collab.onPresence(parsed.name.trim());
        return;
      }
      if (isKiteSyncMessage(parsed)) {
        syncApiRef.current?.handleKiteSyncMessage(parsed);
      }
    });
  }, [config.bridgeStatus, transport]);

  useEffect(() => {
    if (config.bridgeStatus !== "connected") return;
    const port = transport.transportPortRef.current;
    if (!port?.isReady()) return;
    syncApiRef.current?.flushPendingKiteSyncPacket();
  }, [config.bridgeStatus, transport]);

  return useMemo(
    (): KiteP2PEngineApi => ({
      transport,
      metered,
      sync,
      runOrderedSessionTeardown,
      dropKiteSyncToLiveP2P,
      handleCollaboratorLeave,
    }),
    [transport, metered, sync, runOrderedSessionTeardown, dropKiteSyncToLiveP2P, handleCollaboratorLeave]
  );
}
