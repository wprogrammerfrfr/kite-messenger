import { decodePeerDataChunk } from "@/lib/studio-bridge-webrtc";

export const KITE_CHAT_CHANNEL_LABEL = "kite-chat-channel";

export type KiteChatDataPayload = {
  type: "KITE_CHAT";
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  sentAt: number;
};

export type KiteSessionChatMessage = KiteChatDataPayload & {
  receivedAt: number;
  isLocal: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isKiteChatDataPayload(value: unknown): value is KiteChatDataPayload {
  if (!isRecord(value) || value.type !== "KITE_CHAT") return false;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.text === "string" &&
    typeof value.senderId === "string" &&
    typeof value.senderName === "string" &&
    typeof value.sentAt === "number" &&
    Number.isFinite(value.sentAt)
  );
}

export function parseKiteChatDataPayloadFromChannelData(
  data: unknown
): KiteChatDataPayload | null {
  try {
    const text = decodePeerDataChunk(data);
    const parsed: unknown = JSON.parse(text);
    return isKiteChatDataPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
