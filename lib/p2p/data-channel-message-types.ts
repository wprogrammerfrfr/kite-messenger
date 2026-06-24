import type { KiteSyncMessage } from "@/lib/p2p/kite-sync-packet";
import type { KiteIntervalTiming } from "@/lib/kite-interval-math";

export type { KiteSyncMessage };

export type JamSetupLockAction = "acquire" | "release";

export type JamSetupLockMessage = {
  type: "JAM_SETUP_LOCK";
  action: JamSetupLockAction;
  ownerId: string;
  ownerName: string;
  expiresAt?: number;
};

export type LeaveMessage = {
  type: "LEAVE";
  from?: "host" | "peer";
};

export type StudioParamPatch = {
  bpm?: number;
  bpi?: number;
  kiteSetupTempo?: number;
  kiteSetupTimeSignatureTop?: number;
  kiteSetupTimeSignatureBottom?: number;
  kiteSetupChordCount?: number;
};

export type StudioParamMessage = {
  type: "STUDIO_PARAM";
  originatorId: string;
  studioRevision: number;
  patch: StudioParamPatch;
};

export type SetIntervalMessage = {
  type: "SET_INTERVAL";
  timing: KiteIntervalTiming;
  clockAnchorSec: number;
  hasRetainedLoop: boolean;
  igniteP2PEngine?: boolean;
  abortIgnition?: boolean;
  enterBroadcastMode?: boolean;
  initiatorId?: string;
};

export type PresenceMessage = {
  type: "presence";
  name: string;
};

export type PingMessage = {
  t: "ping";
  ts: number;
};

export type PongMessage = {
  t: "pong";
  ts: number;
};

function isRecord(msg: unknown): msg is Record<string, unknown> {
  return typeof msg === "object" && msg !== null;
}

function isKiteIntervalTimingShape(timing: unknown): timing is KiteIntervalTiming {
  return (
    timing !== null &&
    typeof timing === "object" &&
    typeof (timing as KiteIntervalTiming).bpm === "number" &&
    typeof (timing as KiteIntervalTiming).chords === "number" &&
    typeof (timing as KiteIntervalTiming).timeSignatureTop === "number" &&
    typeof (timing as KiteIntervalTiming).timeSignatureBottom === "number"
  );
}

export function isLeaveMessage(msg: unknown): msg is LeaveMessage {
  return isRecord(msg) && msg.type === "LEAVE";
}

export function isJamSetupLockMessage(msg: unknown): msg is JamSetupLockMessage {
  return (
    isRecord(msg) &&
    msg.type === "JAM_SETUP_LOCK" &&
    (msg.action === "acquire" || msg.action === "release")
  );
}

export function isSetIntervalMessage(msg: unknown): msg is SetIntervalMessage {
  return (
    isRecord(msg) &&
    msg.type === "SET_INTERVAL" &&
    isKiteIntervalTimingShape(msg.timing)
  );
}

export function isStudioParamMessage(msg: unknown): msg is StudioParamMessage {
  return (
    isRecord(msg) &&
    msg.type === "STUDIO_PARAM" &&
    typeof msg.originatorId === "string" &&
    typeof msg.studioRevision === "number" &&
    msg.patch !== null &&
    typeof msg.patch === "object"
  );
}

export function isPresenceMessage(msg: unknown): msg is PresenceMessage {
  return (
    isRecord(msg) &&
    msg.type === "presence" &&
    typeof msg.name === "string" &&
    msg.name.trim().length > 0
  );
}

export function isPingMessage(msg: unknown): msg is PingMessage {
  return isRecord(msg) && msg.t === "ping" && typeof msg.ts === "number";
}

export function isPongMessage(msg: unknown): msg is PongMessage {
  return isRecord(msg) && msg.t === "pong" && typeof msg.ts === "number";
}

export function isKiteSyncMessage(msg: unknown): msg is KiteSyncMessage {
  return (
    isRecord(msg) &&
    msg.type === "KITE_SYNC" &&
    typeof msg.sequenceNumber === "number" &&
    typeof msg.hostTime === "number" &&
    typeof msg.serverTimestamp === "number" &&
    typeof msg.bpm === "number" &&
    typeof msg.bpi === "number" &&
    typeof msg.enabled === "boolean"
  );
}
