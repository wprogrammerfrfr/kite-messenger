/** Bridge connection status — mirrors `page.tsx` `BridgeStatus`. */
export type BridgeStatus = "connecting" | "connected" | "failed";

/** Local role in a studio session — mirrors `page.tsx` `Role`. */
export type Role = "host" | "peer";

export type TransportMessageHandler = (msg: {
  raw: unknown;
  text: string | null;
  parsed: unknown | null;
}) => void;

export interface TransportPort {
  sendJson: (payload: unknown) => void;
  sendBinary: (chunk: ArrayBuffer | Uint8Array) => void;
  isReady: () => boolean;
  replaceTrack: (
    oldTrack: MediaStreamTrack | null,
    newTrack: MediaStreamTrack,
    stream: MediaStream
  ) => void;
  /** Returns an unsubscribe function. */
  subscribe: (handler: TransportMessageHandler) => () => void;
  getPeerConnection: () => RTCPeerConnection | null;
}

/** Shown when P2P connects; cleared when bridge init failure note was stale. */
export const P2P_CONNECTED_NOTE = "P2P Connected.";

export interface TransportCallbacks {
  onStatusChange: (status: BridgeStatus) => void;
  onStatusNote: (note: string) => void;
  onError: (message: string | null) => void;
  onSessionId: (id: string) => void;
  onRole: (role: Role) => void;
  onInviteLink: (url: string) => void;
  onPingMs: (ms: number | null) => void;
  onRemoteStreamReset: () => void;
  onRemoteParticipantName: (name: string | null) => void;
  onLastDepartedParticipantName: (name: string | null) => void;
  onConnectionLostCountdown: (sec: number | null) => void;
  onLog: (message: string) => void;
}
