export type KiteSyncMessage = {
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

export type BuildKiteSyncPacketInput = {
  ctxCurrentTimeSec: number;
  enabled: boolean;
  bpm: number;
  bpi: number;
  sequenceNumber: number;
  initiatorId: string;
  studioRevision: number;
  serverTimestampMs?: number;
};

/** Pure builder — caller must increment sequence/revision refs before calling. */
export function buildKiteSyncPacket(input: BuildKiteSyncPacketInput): KiteSyncMessage {
  return {
    type: "KITE_SYNC",
    hostTime: input.ctxCurrentTimeSec,
    bpm: input.bpm,
    bpi: input.bpi,
    enabled: input.enabled,
    serverTimestamp: input.serverTimestampMs ?? Date.now(),
    sequenceNumber: input.sequenceNumber,
    initiatorId: input.initiatorId,
    studioRevision: input.studioRevision,
  };
}

export function shouldAcceptKiteSyncSequence(
  incomingSeq: number,
  lastAcceptedSeq: number
): boolean {
  return incomingSeq > lastAcceptedSeq;
}

export function shouldAcceptKiteSyncDisable(
  msg: { initiatorId?: string },
  localInitiatorId: string | null
): boolean {
  const packetInitiator =
    typeof msg.initiatorId === "string" ? msg.initiatorId : null;
  if (packetInitiator !== null) {
    return packetInitiator === localInitiatorId;
  }
  return localInitiatorId === null;
}
