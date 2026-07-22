import {
  KITE_CHAT_CHANNEL_LABEL,
  parseKiteChatDataPayloadFromChannelData,
  type KiteChatDataPayload,
} from "@/lib/p2p/kite-chat-message-types";

export type KiteChatChannelHandle = {
  send: (payload: KiteChatDataPayload) => boolean;
  close: () => void;
  isOpen: () => boolean;
};

export type AttachKiteChatChannelParams = {
  pc: RTCPeerConnection;
  isInitiator: boolean;
  onMessage: (payload: KiteChatDataPayload) => void;
  onOpen?: () => void;
  onClose?: () => void;
};

function wireChannelEvents(
  channel: RTCDataChannel,
  onMessage: (payload: KiteChatDataPayload) => void,
  onOpen?: () => void,
  onClose?: () => void
): void {
  channel.onmessage = (event: MessageEvent) => {
    const payload = parseKiteChatDataPayloadFromChannelData(event.data);
    if (payload) onMessage(payload);
  };
  channel.onopen = () => {
    onOpen?.();
  };
  channel.onclose = () => {
    onClose?.();
  };
  channel.onerror = () => {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[KiteChat] data channel error");
    }
  };
}

function createHandle(channel: RTCDataChannel | null): KiteChatChannelHandle {
  let closed = false;

  return {
    send(payload: KiteChatDataPayload): boolean {
      if (closed || !channel || channel.readyState !== "open") return false;
      try {
        channel.send(JSON.stringify(payload));
        return true;
      } catch {
        return false;
      }
    },
    close(): void {
      if (closed) return;
      closed = true;
      if (!channel) return;
      try {
        channel.onmessage = null;
        channel.onopen = null;
        channel.onclose = null;
        channel.onerror = null;
        if (channel.readyState === "open" || channel.readyState === "connecting") {
          channel.close();
        }
      } catch {
        /* idempotent */
      }
    },
    isOpen(): boolean {
      return !closed && channel !== null && channel.readyState === "open";
    },
  };
}

export function attachKiteChatChannel(params: AttachKiteChatChannelParams): KiteChatChannelHandle {
  const { pc, isInitiator, onMessage, onOpen, onClose } = params;

  if (isInitiator) {
    const channel = pc.createDataChannel(KITE_CHAT_CHANNEL_LABEL, { ordered: true });
    wireChannelEvents(channel, onMessage, onOpen, onClose);
    return createHandle(channel);
  }

  let channel: RTCDataChannel | null = null;
  let closed = false;
  const priorOndatachannel = pc.ondatachannel;

  const bindChannel = (next: RTCDataChannel) => {
    if (closed || next.label !== KITE_CHAT_CHANNEL_LABEL || channel) return;
    channel = next;
    wireChannelEvents(channel, onMessage, onOpen, onClose);
    if (channel.readyState === "open") {
      onOpen?.();
    }
  };

  pc.ondatachannel = (event: RTCDataChannelEvent) => {
    try {
      priorOndatachannel?.call(pc, event);
    } catch {
      /* preserve prior handler best-effort */
    }
    bindChannel(event.channel);
  };

  return {
    send(payload: KiteChatDataPayload): boolean {
      if (closed || !channel || channel.readyState !== "open") return false;
      try {
        channel.send(JSON.stringify(payload));
        return true;
      } catch {
        return false;
      }
    },
    close(): void {
      if (closed) return;
      closed = true;
      pc.ondatachannel = priorOndatachannel ?? null;
      if (!channel) return;
      try {
        channel.onmessage = null;
        channel.onopen = null;
        channel.onclose = null;
        channel.onerror = null;
        if (channel.readyState === "open" || channel.readyState === "connecting") {
          channel.close();
        }
      } catch {
        /* idempotent */
      }
      channel = null;
    },
    isOpen(): boolean {
      return !closed && channel !== null && channel.readyState === "open";
    },
  };
}
