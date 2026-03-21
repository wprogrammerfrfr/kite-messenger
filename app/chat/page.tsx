"use client";

import {
  decryptMessage,
  encryptMessage,
  generateKeyPair,
  exportPublicKeyToBase64,
  exportPrivateKeyToBase64,
  importPublicKeyFromBase64,
  importPrivateKeyFromBase64,
  type KeyPair,
} from "@/lib/crypto";
import { t, type Language } from "@/lib/translations";
import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { Auth } from "@/components/Auth";
import { UserDiscoverySidebar } from "@/components/UserDiscoverySidebar";
import { ModeController } from "@/components/ModeController";
import { ensureDmConnectionAfterSend } from "@/lib/dm-connections";
import { SHOW_PROFESSIONAL_AND_ROLE_UI } from "@/lib/feature-flags";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Menu, Settings, Paperclip, X } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

/** Brand icon: `public/kite-mobile-icon.png` */
const KITE_APP_ICON = "/kite-mobile-icon.png";

interface ThemeVars {
  "--page-bg": string;
  "--sidebar-bg": string;
  "--panel-bg": string;
  "--text-primary": string;
  "--text-secondary": string;
  "--border": string;
  "--glow": string;
  "--input-bg": string;
  "--accent": string;
}

const MUSICIAN_THEME: ThemeVars = {
  "--page-bg": "#000000",
  "--sidebar-bg": "rgba(12, 12, 14, 0.94)",
  "--panel-bg": "rgba(20, 20, 24, 0.88)",
  "--text-primary": "rgba(255, 255, 255, 0.95)",
  "--text-secondary": "rgba(255, 255, 255, 0.6)",
  "--border": "rgba(255, 69, 0, 0.45)",
  "--glow": "0 0 24px rgba(255, 69, 0, 0.22), 0 0 48px rgba(255, 69, 0, 0.08)",
  "--input-bg": "rgba(20, 20, 24, 0.95)",
  "--accent": "#FF4500",
};

const THERAPIST_THEME: ThemeVars = {
  "--page-bg": "#e8efe6",
  "--sidebar-bg": "rgba(200, 210, 195, 0.75)",
  "--panel-bg": "rgba(255, 255, 255, 0.95)",
  "--text-primary": "#1a2a1a",
  "--text-secondary": "#2d3d2d",
  "--border": "rgba(100, 120, 95, 0.35)",
  "--glow": "none",
  "--input-bg": "rgba(255, 255, 255, 0.98)",
  "--accent": "#4a6348",
};

const SUPPORT_THEME: ThemeVars = {
  "--page-bg": "#000000",
  "--sidebar-bg": "#000000",
  "--panel-bg": "#000000",
  "--text-primary": "#FFFFFF",
  "--text-secondary": "#FFFFFF",
  "--border": "rgba(255, 69, 0, 0.6)",
  "--glow": "0 0 24px rgba(255, 69, 0, 0.6)",
  "--input-bg": "#000000",
  "--accent": "#FF4500",
};

const E2E_KEY_STORAGE_KEY = "kite-e2e-v1";
const KEY_MISMATCH_TEXT = "[Secure Message - Key Mismatch]";

/** Cast theme to a shape Framer Motion's animate prop accepts (CSS custom properties). */
function themeToMotionStyle(theme: ThemeVars): Record<string, string> {
  return { ...theme };
}

export default function Home() {
  const [professionalMode, setProfessionalMode] = useState(false);
  const [isSupportMode, setIsSupportMode] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [nickname, setNickname] = useState<string | null>(null);
  const [messages, setMessages] = useState<
    Array<{
      id: string | number;
      text: string;
      isSessionMode: boolean;
      createdAt?: string;
      isImage?: boolean;
      imageUrl?: string;
      senderId?: string | null;
      receiverId?: string | null;
      isRead?: boolean | null;
    }>
  >([]);
  // Sender key pair (current user); recipient key pair used only for recipient's public key for encryption
  const [senderKeys, setSenderKeys] = useState<KeyPair | null>(null);
  const [recipientPublicKey, setRecipientPublicKey] = useState<CryptoKey | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const [activeRecipientId, setActiveRecipientId] = useState<string | null>(null);
  const [isOwnKeySyncing, setIsOwnKeySyncing] = useState(false);
  const [hasOwnKeyInDb, setHasOwnKeyInDb] = useState(false);
  const [hasRecipientKey, setHasRecipientKey] = useState(false);
  const [language, setLanguage] = useState<Language>("en");

  // Presence: users currently connected to "online-users".
  const [onlineUserIds, setOnlineUserIds] = useState<Record<string, boolean>>({});

  /** Mobile / tablet: sidebar hidden until hamburger opens (overlay). Desktop lg+: always visible. */
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarRefreshNonce, setSidebarRefreshNonce] = useState(0);
  const [nicknameBannerDismissed, setNicknameBannerDismissed] = useState(false);

  const wait = useCallback((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)), []);

  const decryptWithRetry = useCallback(
    async (ciphertext: string, privateKey: CryptoKey | null): Promise<string> => {
      if (!privateKey) {
        await wait(500);
        if (!senderKeys?.privateKey) {
          return KEY_MISMATCH_TEXT;
        }
        try {
          return await decryptMessage(ciphertext, senderKeys.privateKey);
        } catch {
          return KEY_MISMATCH_TEXT;
        }
      }

      try {
        return await decryptMessage(ciphertext, privateKey);
      } catch {
        await wait(500);
        const retryKey = senderKeys?.privateKey ?? privateKey;
        try {
          return await decryptMessage(ciphertext, retryKey);
        } catch {
          return KEY_MISMATCH_TEXT;
        }
      }
    },
    [senderKeys, wait]
  );

  // Hydrate professional mode (vibe) from localStorage so other pages can match it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem("nexus-professional-mode");
      if (stored === "therapist") {
        setProfessionalMode(true);
      } else if (stored === "musician") {
        setProfessionalMode(false);
      }
      const storedLang = localStorage.getItem("nexus-lang");
      if (storedLang === "fa" || storedLang === "ar" || storedLang === "en") {
        setLanguage(storedLang);
      }
    } catch {
      // Ignore storage errors and fall back to default.
    }
  }, []);

  // Keep <html dir> in sync with selected language and write cookie for SSR.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const isRtl = language === "fa" || language === "ar";
    document.documentElement.dir = isRtl ? "rtl" : "ltr";
    document.documentElement.lang = language;
    document.cookie = `nexus-lang=${language}; path=/; max-age=${60 * 60 * 24 * 365}`;
  }, [language]);

  // Support Mode dictator: force Professional Mode OFF.
  useEffect(() => {
    if (isSupportMode) {
      setProfessionalMode(false);
    }
  }, [isSupportMode]);

  // Track Supabase auth session
  useEffect(() => {
    let mounted = true;

    const getInitialSession = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;

      if (error) {
        console.error("Error getting session", error);
        setSession(null);
        return;
      }

      setSession(data.session);
    };

    getInitialSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (!mounted) return;
      setSession(currentSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Presence: last-seen + online status for sidebar.
  useEffect(() => {
    if (!session) return;

    const myId = session.user.id;
    const channel = supabase.channel("online-users", {
      config: { presence: { key: myId } },
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      const next: Record<string, boolean> = {};
      Object.keys(state).forEach((id) => {
        next[id] = true;
      });
      setOnlineUserIds(next);
    });

    channel.subscribe(async (status) => {
      if (status !== "SUBSCRIBED") return;

      const nowIso = new Date().toISOString();
      try {
        channel.track({ last_seen: nowIso });
      } catch {
        // ignore
      }

      // Persist last_seen for offline display.
      try {
        await supabase
          .from("profiles")
          .upsert({ id: myId, last_seen: nowIso }, { onConflict: "id" });
      } catch {
        // ignore
      }
    });

    const interval = window.setInterval(() => {
      const nowIso = new Date().toISOString();
      try {
        channel.track({ last_seen: nowIso });
      } catch {
        // ignore
      }
      try {
        supabase.from("profiles").upsert({ id: myId, last_seen: nowIso }, { onConflict: "id" });
      } catch {
        // ignore
      }
    }, 20000);

    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      const nowIso = new Date().toISOString();
      try {
        supabase.from("profiles").upsert({ id: myId, last_seen: nowIso }, { onConflict: "id" });
      } catch {
        // ignore
      }
    };

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      try {
        const nowIso = new Date().toISOString();
        supabase.from("profiles").upsert({ id: myId, last_seen: nowIso }, { onConflict: "id" });
      } catch {
        // ignore
      }
      supabase.removeChannel(channel);
    };
  }, [session]);

  // Load the current user's nickname for display in the header.
  useEffect(() => {
    if (!session) {
      setNickname(null);
      return;
    }

    let cancelled = false;

    const loadProfile = async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("nickname")
        .eq("id", session.user.id)
        .maybeSingle();

      if (cancelled) return;

      if (error || !data) {
        setNickname(null);
        return;
      }

      setNickname(
        typeof data.nickname === "string" && data.nickname.trim().length > 0
          ? data.nickname
          : null
      );
    };

    loadProfile();

    const onVis = () => {
      if (document.visibilityState === "visible") void loadProfile();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [session]);

  useEffect(() => {
    try {
      if (localStorage.getItem("kite-nickname-banner-dismissed") === "1") {
        setNicknameBannerDismissed(true);
      }
    } catch {
      // ignore
    }
  }, []);

  // Generate or restore a persistent key pair for the current user.
  useEffect(() => {
    let cancelled = false;

    const loadOrCreateKeys = async () => {
      try {
        const stored =
          localStorage.getItem(E2E_KEY_STORAGE_KEY) ??
          localStorage.getItem("nexus-e2e-keypair");
        if (stored) {
          const parsed = JSON.parse(stored) as {
            publicKeyBase64: string;
            privateKeyBase64: string;
          };

          const [publicKey, privateKey] = await Promise.all([
            importPublicKeyFromBase64(parsed.publicKeyBase64),
            importPrivateKeyFromBase64(parsed.privateKeyBase64),
          ]);

          if (cancelled) return;

          setSenderKeys({ publicKey, privateKey });
          localStorage.setItem(E2E_KEY_STORAGE_KEY, JSON.stringify(parsed));
          return;
        }
      } catch (error) {
        console.error("Failed to restore E2E keypair from storage", error);
      }

      const keys = await generateKeyPair();
      if (cancelled) return;

      setSenderKeys(keys);

      try {
        const [publicKeyBase64, privateKeyBase64] = await Promise.all([
          exportPublicKeyToBase64(keys.publicKey),
          exportPrivateKeyToBase64(keys.privateKey),
        ]);

        localStorage.setItem(
          E2E_KEY_STORAGE_KEY,
          JSON.stringify({ publicKeyBase64, privateKeyBase64 })
        );
      } catch (error) {
        console.error("Failed to persist E2E keypair", error);
      }
    };

    loadOrCreateKeys();

    return () => {
      cancelled = true;
    };
  }, []);

  // Once we have a logged-in user and a local key pair, ensure their public key
  // is uploaded to the `profiles` table so others can establish a secure channel.
  useEffect(() => {
    if (!session || !senderKeys) return;

    let cancelled = false;

    const ensurePublicKeyUploaded = async () => {
      setIsOwnKeySyncing(true);
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("public_key")
          .eq("id", session.user.id)
          .maybeSingle();

        if (cancelled) return;

        if (
          error &&
          // PGRST116 = no rows found
          // In that case we'll create the row via upsert below.
          // For other errors, just log and stop.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (error as any).code !== "PGRST116"
        ) {
          console.error("Failed to read profile for key upload", error);
          setIsOwnKeySyncing(false);
          return;
        }

        const publicKeyBase64 = await exportPublicKeyToBase64(senderKeys.publicKey);
        const dbPublicKey =
          data && typeof data.public_key === "string" ? data.public_key.trim() : "";

        if (dbPublicKey === publicKeyBase64) {
          setHasOwnKeyInDb(true);
          setIsOwnKeySyncing(false);
          return;
        }

        const { error: upsertError } = await supabase
          .from("profiles")
          .upsert(
            {
              id: session.user.id,
              public_key: publicKeyBase64,
            },
            { onConflict: "id" }
          );
        if (upsertError) {
          console.error("Failed to upload public key", upsertError);
          setIsOwnKeySyncing(false);
          return;
        }
        setHasOwnKeyInDb(true);
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to ensure public key is uploaded", err);
        }
      } finally {
        if (!cancelled) {
          setIsOwnKeySyncing(false);
        }
      }
    };

    ensurePublicKeyUploaded();

    return () => {
      cancelled = true;
    };
  }, [session, senderKeys]);

  // When the activeRecipientId changes, fetch that user's public key from
  // the profiles table and import it so we can encrypt messages to them.
  useEffect(() => {
  if (!activeRecipientId || !session) {
    setRecipientPublicKey(null);
    setHasRecipientKey(false);
    return;
  }

  let cancelled = false;

  const fetchFreshKey = async () => {
    try {
      // We force a fresh fetch from Supabase to catch new Incognito keys
      const { data, error } = await supabase
        .from("profiles")
        .select("public_key")
        .eq("id", activeRecipientId)
        .maybeSingle();

      if (cancelled) return;

      if (data?.public_key) {
        const key = await importPublicKeyFromBase64(data.public_key);
        setRecipientPublicKey(key);
        setHasRecipientKey(true);
      } else {
        setRecipientPublicKey(null);
        setHasRecipientKey(false);
      }
    } catch (err) {
      if (!cancelled) {
        console.error("Key sync error:", err);
        setRecipientPublicKey(null);
        setHasRecipientKey(false);
      }
    }
  };

  fetchFreshKey();

  return () => {
    cancelled = true;
  };
}, [activeRecipientId, session]); // Removed senderKeys dependency to force refresh on click

  // Fetch all existing messages on load and subscribe to new ones.
  // Every message is decrypted locally before being added to `messages`.
  useEffect(() => {
    if (!senderKeys) return;

    let cancelled = false;
    const channel = supabase
      .channel("messages-inserts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        async (payload) => {
          if (cancelled) return;
          try {
            const row = payload.new as {
              id?: string | number;
              encrypted_content?: string;
              content_for_sender?: string | null;
              sender_id?: string | null;
              receiver_id?: string | null;
              is_session_mode?: boolean;
              is_read?: boolean | null;
              created_at?: string;
            };

            if (!row.encrypted_content) return;

            const viewerId = session?.user.id ?? null;
            let encryptedForViewer =
              viewerId && row.sender_id === viewerId && row.content_for_sender
                ? row.content_for_sender
                : row.encrypted_content;

            // Realtime payloads can occasionally arrive without `content_for_sender`.
            // Refetch the row to get full ciphertext before decrypting.
            if (
              viewerId &&
              row.sender_id === viewerId &&
              (!row.content_for_sender || row.content_for_sender.trim().length === 0) &&
              row.id !== undefined &&
              row.id !== null
            ) {
              const { data: fullRow } = await supabase
                .from("messages")
                .select("encrypted_content, content_for_sender, sender_id")
                .eq("id", row.id)
                .maybeSingle();

              if (
                fullRow?.sender_id === viewerId &&
                typeof fullRow.content_for_sender === "string" &&
                fullRow.content_for_sender.trim().length > 0
              ) {
                encryptedForViewer = fullRow.content_for_sender;
              } else if (
                typeof fullRow?.encrypted_content === "string" &&
                fullRow.encrypted_content.trim().length > 0
              ) {
                encryptedForViewer = fullRow.encrypted_content;
              }
            }

            let text: string;
            let isImage = false;
            let imageUrl: string | undefined;
            try {
              const decrypted = await decryptWithRetry(
                encryptedForViewer,
                senderKeys.privateKey
              );
              try {
                const parsed = JSON.parse(decrypted) as {
                  type?: string;
                  url?: string;
                };
                if (parsed.type === "image" && typeof parsed.url === "string") {
                  isImage = true;
                  imageUrl = parsed.url;
                  text = parsed.url;
                } else {
                  text = decrypted;
                }
              } catch {
                text = decrypted;
              }
            } catch {
              // Final fallback: re-fetch complete row and retry decryption once more.
              if (row.id !== undefined && row.id !== null) {
                try {
                  const { data: fullRow } = await supabase
                    .from("messages")
                    .select("encrypted_content, content_for_sender, sender_id")
                    .eq("id", row.id)
                    .maybeSingle();

                  const fallbackCipher =
                    viewerId &&
                    fullRow?.sender_id === viewerId &&
                    typeof fullRow?.content_for_sender === "string" &&
                    fullRow.content_for_sender.trim().length > 0
                      ? fullRow.content_for_sender
                      : fullRow?.encrypted_content ?? encryptedForViewer;

                  text = await decryptWithRetry(fallbackCipher, senderKeys.privateKey);
                } catch {
                  text = KEY_MISMATCH_TEXT;
                }
              } else {
                text = KEY_MISMATCH_TEXT;
              }
            }

            if (
              session &&
              row.receiver_id === session.user.id &&
              row.is_read === false &&
              row.id !== undefined &&
              row.id !== null
            ) {
              void supabase
                .from("messages")
                .update({ is_read: true })
                .eq("id", row.id)
                .eq("receiver_id", session.user.id);
            }

            const id =
              row.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

            setMessages((prev) => {
              if (prev.some((m) => m.id === id)) return prev;
              return [
                ...prev,
                {
                  id,
                  text,
                  isSessionMode: Boolean(row.is_session_mode),
                  createdAt: row.created_at,
                  isImage,
                  imageUrl,
                  senderId: row.sender_id ?? null,
                  receiverId: row.receiver_id ?? null,
                  isRead: row.is_read ?? null,
                },
              ];
            });
          } catch {
            // Ignore messages that cannot be processed at all.
          }
        }
      )
      .subscribe();

    // Initial load: fetch and decrypt all existing messages.
    (async () => {
      const { data, error } = await supabase
        .from("messages")
        .select(
          "id, encrypted_content, content_for_sender, sender_id, receiver_id, is_session_mode, is_read, created_at"
        )
        .order("created_at", { ascending: true });

      if (cancelled || error || !data) return;

      const decrypted: Array<{
        id: string | number;
        text: string;
        isSessionMode: boolean;
        createdAt?: string;
        isImage?: boolean;
        imageUrl?: string;
        senderId?: string | null;
        receiverId?: string | null;
        isRead?: boolean | null;
      }> = [];

      const viewerId = session?.user.id ?? null;

      for (const row of data as Array<{
        id?: string | number;
        encrypted_content?: string;
        content_for_sender?: string | null;
        sender_id?: string | null;
        receiver_id?: string | null;
        is_session_mode?: boolean;
        is_read?: boolean | null;
        created_at?: string;
      }>) {
        if (!row.encrypted_content) continue;
        const id =
          row.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

        const encryptedForViewer =
          viewerId && row.sender_id === viewerId && row.content_for_sender
            ? row.content_for_sender
            : row.encrypted_content;

        try {
          const decryptedText = await decryptWithRetry(
            encryptedForViewer,
            senderKeys.privateKey
          );
          let isImage = false;
          let imageUrl: string | undefined;
          let text: string;

          try {
            const parsed = JSON.parse(decryptedText) as {
              type?: string;
              url?: string;
            };
            if (parsed.type === "image" && typeof parsed.url === "string") {
              isImage = true;
              imageUrl = parsed.url;
              text = parsed.url;
            } else {
              text = decryptedText;
            }
          } catch {
            text = decryptedText;
          }

          decrypted.push({
            id,
            text,
            isSessionMode: Boolean(row.is_session_mode),
            createdAt: row.created_at,
            isImage,
            imageUrl,
            senderId: row.sender_id ?? null,
            receiverId: row.receiver_id ?? null,
            isRead: row.is_read ?? null,
          });
        } catch {
          decrypted.push({
            id,
            text: KEY_MISMATCH_TEXT,
            isSessionMode: Boolean(row.is_session_mode),
            createdAt: row.created_at,
            senderId: row.sender_id ?? null,
            receiverId: row.receiver_id ?? null,
            isRead: row.is_read ?? null,
          });
        }
      }

      if (!cancelled) {
        setMessages(decrypted);
      }
    })();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [senderKeys, session, activeRecipientId, decryptWithRetry]);

  const sendMessage = useCallback(async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || !senderKeys || !session || !activeRecipientId) return;

    setSending(true);
    setSendError(null);

    const senderId = session.user.id;
    const receiverId = activeRecipientId;

    try {
      let keyToUse: CryptoKey | null = null;

      if (receiverId === senderId) {
        keyToUse = senderKeys.publicKey;
      } else {
        // Always refresh the recipient's public key right before encrypting.
        // This prevents stale keys across different login sessions.
        try {
          const { data, error } = await supabase
            .from("profiles")
            .select("public_key")
            .eq("id", receiverId)
            .single();

          if (error) throw error;

          if (!data?.public_key || typeof data.public_key !== "string") {
            const msg = "Waiting for user to initialize secure connection...";
            setSendError(msg);
            setSending(false);
            return;
          }

          const key = await importPublicKeyFromBase64(data.public_key);
          setRecipientPublicKey(key);
          setHasRecipientKey(true);
          keyToUse = key;
        } catch {
          const msg = "Waiting for user to initialize secure connection...";
          setSendError(msg);
          setSending(false);
          return;
        }
      }

      const encryptedForRecipient = await encryptMessage(trimmed, keyToUse, senderKeys);
      const encryptedForSender = await encryptMessage(
        trimmed,
        senderKeys.publicKey,
        senderKeys
      );

      const { error } = await supabase.from("messages").insert({
        encrypted_content: encryptedForRecipient,
        content_for_sender: encryptedForSender,
        sender_id: senderId,
        receiver_id: receiverId,
        is_session_mode: professionalMode,
        is_read: false,
      });
      if (error) {
        console.log("Supabase insert error:", error);
        setSendError(error.message ?? "Failed to send message");
      } else {
        void ensureDmConnectionAfterSend(supabase, senderId, receiverId);
        setSidebarRefreshNonce((n) => n + 1);
        setInputValue(""); // Clear the input field after a successful send
        if (textAreaRef.current) {
          textAreaRef.current.style.height = "44px";
        }
      }
    } catch (err) {
      console.log(err);
      setSendError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }, [inputValue, senderKeys, recipientPublicKey, professionalMode, session, activeRecipientId]);
  // --- NEW FILTERING LOGIC ---
  // This calculates which messages to show based on the person you clicked in the sidebar
  const baseFilteredMessages = messages.filter((m) => {
    // If no one is selected in the sidebar, show nothing
    if (!activeRecipientId) return false;
    
    // Show messages I sent to the recipient OR messages the recipient sent to me
    return (
      (m.senderId === session?.user.id && m.receiverId === activeRecipientId) ||
      (m.senderId === activeRecipientId && m.receiverId === session?.user.id)
    );
  });
  // ---------------------------
  const filteredMessages = isSupportMode
    ? baseFilteredMessages.filter((m) => !m.isImage && !m.imageUrl)
    : baseFilteredMessages;

  // Mark messages as read when they come from the currently active recipient.
  useEffect(() => {
    if (!session || !activeRecipientId) return;
    if (document.visibilityState !== "visible") return;
    if (typeof document.hasFocus === "function" && !document.hasFocus()) return;
    const myId = session.user.id;

    (async () => {
      try {
        await supabase
          .from("messages")
          .update({ is_read: true })
          .eq("receiver_id", myId)
          .eq("sender_id", activeRecipientId)
          .eq("is_read", false);

        setMessages((prev) =>
          prev.map((m) => {
            if (m.receiverId === myId && m.senderId === activeRecipientId) {
              return { ...m, isRead: true };
            }
            return m;
          })
        );
      } catch {
        // Don't block UI if the column doesn't exist yet.
      }
    })();
  }, [session, activeRecipientId, messages]);

  // Realtime: update read receipts without re-decrypting message content.
  useEffect(() => {
    if (!session) return;

    const channel = supabase
      .channel("messages-updates-is-read")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        (payload) => {
          const row = payload.new as { id?: string | number; is_read?: boolean | null };
          if (row.id === undefined || row.id === null) return;

          setMessages((prev) =>
            prev.map((m) => {
              if (String(m.id) !== String(row.id)) return m;
              return { ...m, isRead: row.is_read ?? null };
            })
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session]);
  const handleOpenFilePicker = () => {
    if (!session || !activeRecipientId || isSupportMode) return;
    fileInputRef.current?.click();
  };

  const handleImageSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !session || !senderKeys || !activeRecipientId || isSupportMode) return;

    setUploadingImage(true);
    setSendError(null);

    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${session.user.id}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("chat-images")
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        setSendError(uploadError.message ?? "Failed to upload image");
        return;
      }

      const { data: publicData } = supabase.storage
        .from("chat-images")
        .getPublicUrl(path);

      const publicUrl = publicData?.publicUrl;
      if (!publicUrl) {
        setSendError("Unable to get image URL");
        return;
      }

      const receiverId = activeRecipientId;
      const senderId = session.user.id;

      let keyToUse: CryptoKey | null = null;
      if (receiverId === senderId) {
        keyToUse = senderKeys.publicKey;
      } else {
        try {
          const { data, error } = await supabase
            .from("profiles")
            .select("public_key")
            .eq("id", receiverId)
            .maybeSingle();

          if (error) throw error;

          if (!data?.public_key || typeof data.public_key !== "string") {
            const msg = "Waiting for user to initialize secure connection...";
            setSendError(msg);
            setUploadingImage(false);
            event.target.value = "";
            return;
          }

          const key = await importPublicKeyFromBase64(data.public_key);
          setRecipientPublicKey(key);
          setHasRecipientKey(true);
          keyToUse = key;
        } catch {
          const msg = "Waiting for user to initialize secure connection...";
          setSendError(msg);
          setUploadingImage(false);
          event.target.value = "";
          return;
        }
      }

      const encryptedText = await encryptMessage(
        JSON.stringify({ type: "image", url: publicUrl }),
        keyToUse,
        senderKeys
      );

      const encryptedForSender = await encryptMessage(
        JSON.stringify({ type: "image", url: publicUrl }),
        senderKeys.publicKey,
        senderKeys
      );

      const { error: insertError } = await supabase.from("messages").insert({
        encrypted_content: encryptedText,
        content_for_sender: encryptedForSender,
        sender_id: session.user.id,
        receiver_id: activeRecipientId,
        is_session_mode: professionalMode,
        is_read: false,
      });

      if (insertError) {
        setSendError(insertError.message ?? "Failed to send image");
      } else {
        void ensureDmConnectionAfterSend(supabase, session.user.id, activeRecipientId);
        setSidebarRefreshNonce((n) => n + 1);
      }
    } catch (err) {
      setSendError(
        err instanceof Error ? err.message : "Failed to send image"
      );
    } finally {
      setUploadingImage(false);
      event.target.value = "";
    }
  };

  const handleSend = () => {
    sendMessage();
  };

  const handleInputChange = (value: string) => {
    setInputValue(value);
    const el = textAreaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const handleShareLocation = () => {
    if (!session || !senderKeys || !activeRecipientId) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setSendError("Geolocation is not supported by this browser.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const url = `https://www.google.com/maps?q=${latitude},${longitude}`;
        const content = `LOCATION: ${url}`;

        try {
          const senderId = session.user.id;
          const receiverId = activeRecipientId;

          let keyToUse: CryptoKey | null = null;
          if (receiverId === senderId) {
            keyToUse = senderKeys.publicKey;
          } else {
            try {
              const { data, error } = await supabase
                .from("profiles")
                .select("public_key")
                .eq("id", receiverId)
                .maybeSingle();

              if (error) throw error;

              if (!data?.public_key || typeof data.public_key !== "string") {
                const msg = "Waiting for user to initialize secure connection...";
                setSendError(msg);
                return;
              }

              const key = await importPublicKeyFromBase64(data.public_key);
              setRecipientPublicKey(key);
              setHasRecipientKey(true);
              keyToUse = key;
            } catch {
              const msg = "Waiting for user to initialize secure connection...";
              setSendError(msg);
              return;
            }
          }

          const encryptedText = await encryptMessage(content, keyToUse, senderKeys);
          const encryptedForSender = await encryptMessage(
            content,
            senderKeys.publicKey,
            senderKeys
          );

          const { error } = await supabase.from("messages").insert({
            encrypted_content: encryptedText,
            content_for_sender: encryptedForSender,
            sender_id: senderId,
            receiver_id: receiverId,
            is_session_mode: professionalMode,
            is_read: false,
          });

          if (error) {
            setSendError(error.message ?? "Failed to share location");
          } else {
            void ensureDmConnectionAfterSend(supabase, senderId, receiverId);
            setSidebarRefreshNonce((n) => n + 1);
          }
        } catch (err) {
          setSendError(
            err instanceof Error ? err.message : "Failed to share location"
          );
        }
      },
      (error) => {
        setSendError(error.message || "Failed to get location");
      }
    );
  };


  const trimmedInput = inputValue.trim();
  const canSend =
    Boolean(trimmedInput) &&
    Boolean(senderKeys) &&
    Boolean(activeRecipientId) &&
    !sending;

  const locationReady =
    Boolean(session) &&
    Boolean(senderKeys) &&
    Boolean(activeRecipientId) &&
    hasOwnKeyInDb &&
    (activeRecipientId === session?.user.id ? true : hasRecipientKey);

  const formatTime = (iso?: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (mobileSidebarOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileSidebarOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (mq.matches) setMobileSidebarOpen(false);
    };
    mq.addEventListener("change", closeOnDesktop);
    return () => mq.removeEventListener("change", closeOnDesktop);
  }, []);

  const isLtr = language === "en";
  const sidebarSlideClosed = isLtr ? "-translate-x-full" : "translate-x-full";
  const sidebarSlideOpen = "translate-x-0";
  const sidebarPos = isLtr ? "left-0" : "right-0";
  const sidebarBorder = isLtr ? "border-r" : "border-l";

  if (!session) {
    return <Auth />;
  }
  if (!senderKeys) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white">
        <div className="rounded-xl border border-white/20 px-6 py-4 text-sm font-semibold">
          Loading secure keys...
        </div>
      </div>
    );
  }

  return (
    <motion.div
      className={`relative flex h-[100dvh] max-h-[100dvh] overflow-hidden ${language === "en" ? "" : "flex-row-reverse"}`}
      dir={language === "en" ? "ltr" : "rtl"}
      data-theme={isSupportMode ? "support" : "default"}
      style={{
        background: "var(--page-bg)",
        color: "var(--text-primary)",
      }}
      initial={false}
      animate={themeToMotionStyle(
        isSupportMode ? SUPPORT_THEME : professionalMode ? THERAPIST_THEME : MUSICIAN_THEME
      )}
      transition={{ duration: 0.5, ease: "easeInOut" }}
    >
      {/* Mobile overlay backdrop */}
      <button
        type="button"
        aria-label="Close sidebar"
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity lg:hidden ${
          mobileSidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setMobileSidebarOpen(false)}
      />

      {/* Sidebar: overlay drawer on small screens; normal column from lg */}
      <motion.aside
        className={`fixed inset-y-0 z-50 flex h-full w-[min(18rem,85vw)] shrink-0 flex-col backdrop-blur-xl shadow-2xl transition-transform duration-300 ease-out lg:relative lg:z-0 lg:h-full lg:w-72 lg:max-w-none lg:translate-x-0 lg:shadow-none ${sidebarPos} ${sidebarBorder} ${
          mobileSidebarOpen ? sidebarSlideOpen : `${sidebarSlideClosed} lg:translate-x-0`
        }`}
        style={{
          background: "var(--sidebar-bg)",
          borderColor: "var(--border)",
          boxShadow: "var(--glow)",
        }}
        initial={false}
        animate={{
          background: isSupportMode
            ? SUPPORT_THEME["--sidebar-bg"]
            : professionalMode
            ? THERAPIST_THEME["--sidebar-bg"]
            : MUSICIAN_THEME["--sidebar-bg"],
          borderColor: isSupportMode
            ? SUPPORT_THEME["--border"]
            : professionalMode
            ? THERAPIST_THEME["--border"]
            : MUSICIAN_THEME["--border"],
          boxShadow: isSupportMode ? SUPPORT_THEME["--glow"] : MUSICIAN_THEME["--glow"],
        }}
        transition={{ duration: 0.5, ease: "easeInOut" }}
      >
        <div className="border-b p-4" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full border-2 border-white/20">
                <Image
                  src={KITE_APP_ICON}
                  alt=""
                  width={36}
                  height={36}
                  className="h-full w-full object-cover"
                  priority
                />
              </div>
              <h1 className="truncate text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
                Kite
              </h1>
            </div>
            <button
              type="button"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/20 text-white/90 transition hover:bg-white/10 lg:hidden"
              onClick={() => setMobileSidebarOpen(false)}
              aria-label="Close menu"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
          <div className="mt-2 flex gap-2">
            {(["en", "fa", "ar"] as Language[]).map((lang) => {
              const isActive = language === lang;
              const label = lang === "en" ? "EN" : lang === "fa" ? "FA" : "AR";
              return (
                <button
                  key={lang}
                  type="button"
                  onClick={() => {
                    setLanguage(lang);
                    try {
                      localStorage.setItem("nexus-lang", lang);
                    } catch {
                      // ignore
                    }
                  }}
                  className="inline-flex items-center justify-center rounded-full border px-2 py-1 text-[11px] font-medium transition-colors"
                  style={{
                    borderColor: isActive ? "#FF4500" : "var(--border)",
                    background: isActive ? "#FF4500" : "transparent",
                    color: isActive ? "#000000" : "var(--text-primary)",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="mt-0.5 text-sm" style={{ color: "var(--text-secondary)" }}>
            {isSupportMode
              ? t(language, "modeSupportLabel")
              : professionalMode
              ? t(language, "modeTherapistLabel")
              : t(language, "modeMusicianLabel")}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          <UserDiscoverySidebar
            sessionUserId={session.user.id}
            activeRecipientId={activeRecipientId}
            onSelectRecipientId={(id) => {
              setActiveRecipientId(id);
              setMobileSidebarOpen(false);
            }}
            language={language}
            onlineUserIds={onlineUserIds}
            refreshNonce={sidebarRefreshNonce}
          />
        </div>

        <ModeController
          professionalMode={professionalMode}
          isSupportMode={isSupportMode}
          language={language}
          showProfessionalUI={SHOW_PROFESSIONAL_AND_ROLE_UI}
          professionalDisabled={isSupportMode}
          onToggleProfessional={() =>
            setProfessionalMode((prev) => {
              if (isSupportMode) return prev;
              const next = !prev;
              try {
                localStorage.setItem(
                  "nexus-professional-mode",
                  next ? "therapist" : "musician"
                );
              } catch {
                // Ignore storage failures.
              }
              return next;
            })
          }
          onToggleSupport={() => {
            setIsSupportMode((prev) => {
              const next = !prev;
              if (next) {
                setProfessionalMode(false);
              }
              return next;
            });
          }}
          isOwnKeySyncing={isOwnKeySyncing}
          hasOwnKeyInDb={hasOwnKeyInDb}
        />

        <div className="border-t p-4" style={{ borderColor: "var(--border)" }}>
          <button
            type="button"
            onClick={async () => {
              await supabase.auth.signOut();
              if (typeof window !== "undefined") {
                window.location.href = "/";
              }
            }}
            className="w-full rounded-xl border px-3 py-2 text-xs font-medium transition-colors hover:bg-white/10"
            style={{
              borderColor: "var(--border)",
              color: "var(--text-primary)",
            }}
          >
            {isSupportMode
              ? t(language, "quickExit")
              : t(language, "quickExitLogout")}
          </button>
        </div>
      </motion.aside>

      {/* Main chat area */}
      <main className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
        {/* Header: hamburger + brand logo + title; actions */}
        <motion.header
          className="flex shrink-0 flex-col gap-2 border-b px-3 py-2 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4 sm:py-3 lg:px-6"
          style={{
            background: "var(--panel-bg)",
            borderColor: "var(--border)",
            boxShadow: professionalMode ? "none" : "var(--glow)",
          }}
          initial={false}
          animate={{
            background: professionalMode ? THERAPIST_THEME["--panel-bg"] : MUSICIAN_THEME["--panel-bg"],
            borderColor: professionalMode ? THERAPIST_THEME["--border"] : MUSICIAN_THEME["--border"],
            boxShadow: professionalMode ? "none" : MUSICIAN_THEME["--glow"],
          }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <button
              type="button"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition hover:bg-white/10 lg:hidden"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" aria-hidden />
            </button>
            <div className="flex shrink-0 items-center gap-2">
              <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full border-2 border-white/20">
                <Image
                  src={KITE_APP_ICON}
                  alt=""
                  width={32}
                  height={32}
                  className="h-full w-full object-cover"
                  priority
                />
              </div>
              <span className="text-sm font-semibold sm:text-base" style={{ color: "var(--text-primary)" }}>
                Kite
              </span>
            </div>
            <h2
              className="min-w-0 flex-1 truncate text-base font-medium sm:text-lg"
              style={{ color: "var(--text-primary)" }}
            >
              {t(language, "chatTitle")}
            </h2>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-4">
            <AnimatePresence mode="wait">
              {!isSupportMode && professionalMode ? (
                <motion.span
                  key="secure"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.2 }}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium"
                  style={{
                    background: "var(--accent)",
                    color: "#fff",
                  }}
                >
                  <span aria-hidden>🔒</span>
                  {t(language, "secureEncrypted")}
                </motion.span>
              ) : !isSupportMode ? (
                <motion.span
                  key="latency"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.2 }}
                  className="text-sm"
                  style={{ color: "var(--accent)" }}
                >
                  {t(language, "latency24ms")}
                </motion.span>
              ) : null}
            </AnimatePresence>

            <Link
              href="/settings"
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/10"
              style={{
                borderColor: "var(--border)",
                color: "var(--text-primary)",
              }}
            >
              {!isSupportMode && <Settings className="h-4 w-4" aria-hidden />}
              {nickname && (
                <span className="truncate max-w-[120px]">
                  {nickname}
                </span>
              )}
            </Link>

            <button
              type="button"
              onClick={async () => {
                if (!session || !activeRecipientId) return;
                if (
                  !window.confirm(
                    t(language, "wipeConfirm")
                  )
                ) {
                  return;
                }
                const myId = session.user.id;
                await supabase
                  .from("messages")
                  .delete()
                  .or(
                    `and(sender_id.eq.${myId},receiver_id.eq.${activeRecipientId}),and(sender_id.eq.${activeRecipientId},receiver_id.eq.${myId})`
                  );
                setMessages([]);
              }}
              className="inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/10"
              style={{
                borderColor: "var(--border)",
                color: "var(--text-primary)",
              }}
            >
              {!isSupportMode && <span aria-hidden className="mr-1">🗑️</span>}
              <span>{t(language, "wipeChat")}</span>
            </button>
          </div>
        </motion.header>

        {session &&
          !nickname &&
          !nicknameBannerDismissed && (
            <div
              className="mx-3 mt-2 flex items-start gap-3 rounded-xl border px-3 py-2.5 sm:mx-4"
              style={{
                borderColor: "rgba(255, 69, 0, 0.45)",
                background: "rgba(0, 0, 0, 0.75)",
              }}
              role="status"
            >
              <p className="min-w-0 flex-1 text-xs sm:text-sm" style={{ color: "var(--text-primary)" }}>
                {t(language, "nicknameOnboardingBanner")}
              </p>
              <Link
                href="/settings"
                className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold text-black"
                style={{ background: "#FF4500" }}
              >
                {t(language, "nicknameOnboardingCta")}
              </Link>
              <button
                type="button"
                className="shrink-0 rounded-lg p-1 text-lg leading-none text-white/70 hover:text-white"
                aria-label={t(language, "nicknameOnboardingDismiss")}
                onClick={() => {
                  try {
                    localStorage.setItem("kite-nickname-banner-dismissed", "1");
                  } catch {
                    // ignore
                  }
                  setNicknameBannerDismissed(true);
                }}
              >
                ×
              </button>
            </div>
          )}

        {/* Messages area */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6">
          <div className="mx-auto w-full max-w-full space-y-4 lg:max-w-2xl">
            {filteredMessages.length === 0 ? (
              <div
                className="rounded-2xl px-4 py-3 w-fit"
                style={{
                  background: "var(--panel-bg)",
                  border: "1px solid var(--border)",
                  boxShadow: professionalMode ? "none" : "var(--glow)",
                }}
              >
                <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                  {activeRecipientId
                    ? t(language, "noMessagesConversation")
                    : t(language, "selectUserToStart")}
                </p>
              </div>
            ) : (
              filteredMessages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${
                    m.senderId === session.user.id ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className="rounded-2xl px-4 py-3 max-w-[85%] w-fit"
                    style={{
                      background:
                        m.senderId === session.user.id ? "var(--accent)" : "var(--panel-bg)",
                      color:
                        m.senderId === session.user.id
                          ? isSupportMode
                            ? "#fff"
                            : professionalMode
                            ? "#fff"
                            : "rgba(12, 10, 18, 0.9)"
                          : "var(--text-primary)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    {m.isImage && m.imageUrl && !isSupportMode ? (
                      <div className="space-y-2">
                        <div className="relative overflow-hidden rounded-lg bg-black/10">
                          <Image
                            src={m.imageUrl}
                            alt="Shared image"
                            width={512}
                            height={512}
                            className="max-h-64 w-auto object-cover"
                          />
                        </div>
                        {m.text && m.text !== m.imageUrl && (
                          <p
                            className="text-xs opacity-80"
                            style={{ wordBreak: "break-word", whiteSpace: "pre-wrap" }}
                          >
                            {m.text}
                          </p>
                        )}
                      </div>
                    ) : m.text.startsWith("LOCATION:") ? (
                      <a
                        href={`https://www.google.com/maps?q=${m.text.replace("LOCATION:", "").trim()}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm underline break-words"
                      >
                        {m.text}
                      </a>
                    ) : (
                      <p
                        className="text-sm"
                        style={{
                          wordBreak: "break-word",
                          overflowWrap: "anywhere",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {m.text}
                      </p>
                    )}
                    {m.isSessionMode && (
                      <p className="mt-1 text-[11px] opacity-80">Session mode</p>
                    )}
                    <div className="mt-1 flex items-center justify-end gap-2 text-[11px] opacity-80">
                      <span>{formatTime(m.createdAt)}</span>
                      {m.senderId === session.user.id && (
                        <span
                          style={{
                            color: m.isRead ? "#FF4500" : "rgba(255, 255, 255, 0.55)",
                          }}
                          aria-label={m.isRead ? t(language, "readStatus") : t(language, "sentStatus")}
                        >
                          ✓✓
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Input — extra bottom padding for home indicator + on-screen keyboard */}
        <div
          className="shrink-0 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] pt-3 sm:p-4 sm:pb-[max(1rem,env(safe-area-inset-bottom,0px))]"
          style={{ borderColor: "var(--border)" }}
        >
          {sendError && (
            <p className="mx-auto mb-2 w-full max-w-full px-1 text-sm text-red-500 lg:max-w-2xl" role="alert">
              {sendError}
            </p>
          )}
          <div className="mx-auto w-full max-w-full lg:max-w-2xl">
            <div
              className="flex w-full min-w-0 items-end gap-2 rounded-xl border backdrop-blur-sm px-2"
              style={{
                background: "var(--input-bg)",
                borderColor: "var(--border)",
                boxShadow: professionalMode ? "none" : "var(--glow)",
              }}
            >
              <button
                type="button"
                onClick={handleOpenFilePicker}
                disabled={uploadingImage || !senderKeys || !recipientPublicKey || !activeRecipientId}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-xs font-medium transition hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ color: "var(--text-secondary)" }}
              >
                {!isSupportMode && <Paperclip className="h-4 w-4" aria-hidden />}
                <span className="sr-only">{t(language, "attachImage")}</span>
              </button>
              <button
                type="button"
                onClick={handleShareLocation}
                disabled={!locationReady}
                className="inline-flex h-9 px-2 items-center justify-center rounded-full text-xs font-medium transition hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ color: "var(--text-secondary)" }}
                title={
                  !locationReady
                    ? t(language, "locationRequiresSecureKeyExchange")
                    : undefined
                }
              >
                <span aria-hidden className="mr-1">
                  📍
                </span>
                <span className="hidden sm:inline">{t(language, "shareLocation")}</span>
              </button>
              <textarea
                ref={textAreaRef}
                rows={1}
                value={inputValue}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && canSend) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={t(language, "typePlaceholder")}
                className="flex-1 resize-none bg-transparent px-2 py-3 text-sm outline-none placeholder:opacity-60"
                style={{
                  color: "var(--text-primary)",
                  minHeight: 44,
                  maxHeight: 160,
                  overflowY: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
                disabled={sending}
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend}
                className="rounded-xl px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: "var(--accent)",
                  color: isSupportMode || professionalMode ? "#fff" : "rgba(12, 10, 18, 0.9)",
                }}
              >
                {sending ? t(language, "sendingButton") : t(language, "sendButton")}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageSelected}
              />
            </div>
          </div>
        </div>
      </main>
    </motion.div>
  );
}
