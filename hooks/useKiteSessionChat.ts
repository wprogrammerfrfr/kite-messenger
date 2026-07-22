"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KiteSessionChatMessage } from "@/lib/p2p/kite-chat-message-types";
import type {
  UseKiteSessionChatOptions,
  UseKiteSessionChatResult,
} from "@/hooks/useKiteStudioEngine.types";

export type { UseKiteSessionChatOptions, UseKiteSessionChatResult };

export function useKiteSessionChat(
  options: UseKiteSessionChatOptions
): UseKiteSessionChatResult {
  const { enabled, sessionId, chatReady, port } = options;
  const [messages, setMessages] = useState<KiteSessionChatMessage[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const prevSessionIdRef = useRef<string | null>(sessionId);
  const prevEnabledRef = useRef(enabled);
  const prevChatReadyRef = useRef(chatReady);

  const clearMessages = useCallback(() => {
    seenIdsRef.current.clear();
    setMessages([]);
  }, []);

  useEffect(() => {
    const sessionChanged = prevSessionIdRef.current !== sessionId;
    const disabled = !enabled;
    const wasEnabled = prevEnabledRef.current;
    const chatDropped = prevChatReadyRef.current && !chatReady;

    prevSessionIdRef.current = sessionId;
    prevEnabledRef.current = enabled;
    prevChatReadyRef.current = chatReady;

    if (sessionChanged || (wasEnabled && disabled) || chatDropped) {
      clearMessages();
    }
  }, [enabled, sessionId, chatReady, clearMessages]);

  useEffect(() => {
    if (!enabled) return;
    return port.subscribe((incoming) => {
      if (seenIdsRef.current.has(incoming.id)) return;
      seenIdsRef.current.add(incoming.id);
      setMessages((prev) => [...prev, incoming]);
    });
  }, [enabled, port]);

  const sendMessage = useCallback(
    (text: string) => {
      if (!enabled) return;
      const payload = port.sendMessage(text);
      if (!payload) return;
      if (seenIdsRef.current.has(payload.id)) return;
      seenIdsRef.current.add(payload.id);
      const localMsg: KiteSessionChatMessage = {
        ...payload,
        receivedAt: Date.now(),
        isLocal: true,
      };
      setMessages((prev) => [...prev, localMsg]);
    },
    [enabled, port]
  );

  return { messages, sendMessage, clearMessages };
}
