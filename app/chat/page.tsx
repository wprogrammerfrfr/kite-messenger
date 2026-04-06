"use client";

import dynamic from "next/dynamic";
import {
  decryptMessage,
  encryptMessage,
  generateKeyPair,
  exportPublicKeyToBase64,
  exportPrivateKeyToBase64,
  importPublicKeyFromBase64,
  importPrivateKeyFromBase64,
  unwrapPrivateKeyWithPin,
  type KeyPair,
} from "@/lib/crypto";
import {
  NEXUS_LANG_CHANGE_EVENT,
  readStoredLanguage,
  t,
  type Language,
} from "@/lib/translations";
import { useRouter, useSearchParams } from "next/navigation";
import { dispatchPushAfterOutgoingMessage } from "@/app/actions/notifications";
import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { UserDiscoverySidebar } from "@/components/UserDiscoverySidebar";
import type { SafetyProfileOpenPayload } from "@/components/SafetyProfileModal";

function AuthLazyLoadingFallback() {
  const lang = readStoredLanguage();
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-sm text-stone-400">
      {t(lang, "chatLoadingShort")}
    </div>
  );
}

const AuthLazy = dynamic(
  () => import("@/components/Auth").then((m) => m.Auth),
  {
    ssr: false,
    loading: () => <AuthLazyLoadingFallback />,
  }
);

const SafetyProfileModal = dynamic(
  () => import("@/components/SafetyProfileModal").then((m) => m.SafetyProfileModal),
  { ssr: false, loading: () => null }
);
const E2ePinRestoreModal = dynamic(
  () => import("@/components/E2ePinRestoreModal").then((m) => m.E2ePinRestoreModal),
  { ssr: false, loading: () => null }
);
import {
  acceptDmConnection,
  declineDmConnection,
  dmPairKey,
  ensureDmConnectionAfterSend,
  fetchDmConnectionForPair,
} from "@/lib/dm-connections";
import { MotionConfig, motion } from "framer-motion";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Loader2,
  MapPin,
  Paperclip,
  Send,
  Trash2,
} from "lucide-react";
import Image from "next/image";
import { useResilience } from "@/components/resilience-provider";
import { withPatience } from "@/lib/network-patience";
import {
  loadMessagesSnapshot,
  saveMessagesSnapshot,
} from "@/lib/offline-message-cache";
import {
  readSupportModeFromStorage,
  writeSupportModeToStorage,
} from "@/lib/support-mode-storage";
import { contactDisplayLabel } from "@/lib/contact-display";
import { areNotificationsGloballyDisabled } from "@/lib/kite-notifications";
import { registerKitePushSubscription } from "@/lib/kite-push-client";
import { isStandaloneDisplayMode } from "@/lib/pwa-standalone";
import { formatRelativeLastSeen } from "@/lib/relative-last-seen";
import {
  dashboardAliasCacheKey,
  readJsonCache,
  writeJsonCache,
} from "@/lib/kite-tab-cache";

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

/** Light appearance: off-white surfaces, dark grey text, Electric Orange accents. */
const LIGHT_MUSICIAN_THEME: ThemeVars = {
  "--page-bg": "#f5f5f4",
  "--sidebar-bg": "rgba(250, 250, 249, 0.97)",
  "--panel-bg": "#ffffff",
  "--text-primary": "#1c1917",
  "--text-secondary": "#57534e",
  "--border": "rgba(255, 69, 0, 0.28)",
  "--glow": "0 0 20px rgba(255, 69, 0, 0.12)",
  "--input-bg": "#fafaf9",
  "--accent": "#FF4500",
};

const LIGHT_THERAPIST_THEME: ThemeVars = {
  "--page-bg": "#f5f5f4",
  "--sidebar-bg": "rgba(245, 245, 244, 0.98)",
  "--panel-bg": "#ffffff",
  "--text-primary": "#1a2a1a",
  "--text-secondary": "#3f4f3f",
  "--border": "rgba(100, 120, 95, 0.28)",
  "--glow": "none",
  "--input-bg": "#fafaf9",
  "--accent": "#4a6348",
};

const E2E_KEY_STORAGE_KEY = "kite-e2e-v1";
const KEY_MISMATCH_TEXT = "[Secure Message - Key Mismatch]";
const CHAT_FILE_MAX_BYTES = 5 * 1024 * 1024;
/** Initial fetch: newest rows only, then reverse for chronological decrypt/display. */
const CHAT_INITIAL_MESSAGE_LIMIT = 50;

type MessagesFetchRow = {
  id?: string | number;
  encrypted_content?: string;
  content_for_sender?: string | null;
  sender_id?: string | null;
  receiver_id?: string | null;
  is_session_mode?: boolean;
  is_read?: boolean | null;
  created_at?: string;
};

type MessagesDecryptedItem = {
  id: string | number;
  text: string;
  isSessionMode: boolean;
  createdAt?: string;
  isImage?: boolean;
  imageUrl?: string;
  isFile?: boolean;
  fileUrl?: string;
  fileName?: string;
  fileMime?: string;
  senderId?: string | null;
  receiverId?: string | null;
  isRead?: boolean | null;
};

function mergeChatMessagesById(
  prev: MessagesDecryptedItem[],
  incoming: MessagesDecryptedItem[]
): MessagesDecryptedItem[] {
  const byId = new Map<string, MessagesDecryptedItem>();
  for (const m of prev) byId.set(String(m.id), m);
  for (const m of incoming) byId.set(String(m.id), m);
  return Array.from(byId.values()).sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ta - tb;
  });
}

function parseDecryptedPayload(decrypted: string): {
  text: string;
  isImage: boolean;
  imageUrl?: string;
  isFile: boolean;
  fileUrl?: string;
  fileName?: string;
  fileMime?: string;
} {
  try {
    const parsed = JSON.parse(decrypted) as {
      type?: string;
      url?: string;
      name?: string;
      mime?: string;
    };
    if (parsed.type === "image" && typeof parsed.url === "string") {
      return {
        text: parsed.url,
        isImage: true,
        imageUrl: parsed.url,
        isFile: false,
      };
    }
    if (parsed.type === "file" && typeof parsed.url === "string") {
      const fileName = typeof parsed.name === "string" ? parsed.name : "File";
      const fileMime =
        typeof parsed.mime === "string" ? parsed.mime : "application/octet-stream";
      return {
        text: fileName,
        isImage: false,
        isFile: true,
        fileUrl: parsed.url,
        fileName,
        fileMime,
      };
    }
  } catch {
    // plain text
  }
  return { text: decrypted, isImage: false, isFile: false };
}

/** Cast theme to a shape Framer Motion's animate prop accepts (CSS custom properties). */
function themeToMotionStyle(theme: ThemeVars): Record<string, string> {
  return { ...theme };
}

export default function Home() {
  const {
    isOnline,
    isLowBandwidthMode,
    isLowSignal,
    isConnectionSlow,
  } = useResilience();

  const [professionalMode, setProfessionalMode] = useState(false);
  const [isSupportMode, setIsSupportMode] = useState(false);

  useEffect(() => {
    const syncSupport = () => setIsSupportMode(readSupportModeFromStorage());
    syncSupport();
    window.addEventListener("kite-support-mode", syncSupport);
    window.addEventListener("storage", syncSupport);
    return () => {
      window.removeEventListener("kite-support-mode", syncSupport);
      window.removeEventListener("storage", syncSupport);
    };
  }, []);
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
      isFile?: boolean;
      fileUrl?: string;
      fileName?: string;
      fileMime?: string;
      senderId?: string | null;
      receiverId?: string | null;
      isRead?: boolean | null;
    }>
  >([]);
  const messagesRef = useRef<MessagesDecryptedItem[]>([]);
  // Sender key pair (current user); recipient key pair used only for recipient's public key for encryption
  const [senderKeys, setSenderKeys] = useState<KeyPair | null>(null);
  const [recipientPublicKey, setRecipientPublicKey] = useState<CryptoKey | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [notificationsMuted, setNotificationsMuted] = useState(false);
  const languageRef = useRef<Language>(readStoredLanguage());
  const senderKeysRef = useRef<KeyPair | null>(null);
  const decryptWithRetryRef = useRef<
    ((ciphertext: string, privateKey: CryptoKey | null) => Promise<string>) | null
  >(null);
  const isLowBandwidthModeRef = useRef(false);
  const decryptInitialRowsRef = useRef<
    ((chronological: MessagesFetchRow[], viewerId: string) => Promise<MessagesDecryptedItem[]>) | null
  >(null);
  const pendingInitialMessagesRef = useRef<{
    viewerId: string;
    rows: MessagesFetchRow[];
  } | null>(null);
  /** One pair-specific warmup fetch per (viewer, recipient) to fix empty filtered threads. */
  const pairWarmupAttemptedRef = useRef<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesListEndRef = useRef<HTMLDivElement | null>(null);
  const [activeRecipientId, setActiveRecipientId] = useState<string | null>(null);
  const [isOwnKeySyncing, setIsOwnKeySyncing] = useState(false);
  const [hasOwnKeyInDb, setHasOwnKeyInDb] = useState(false);
  const [hasRecipientKey, setHasRecipientKey] = useState(false);
  const [language, setLanguage] = useState<Language>(() => readStoredLanguage());
  const [appearance, setAppearance] = useState<"light" | "dark">("dark");
  /** True while CPU-heavy decrypt of initial / thread messages is in flight. */
  const [messagesDecryptLoading, setMessagesDecryptLoading] = useState(false);

  // Presence: users currently connected to "online-users".
  const [onlineUserIds, setOnlineUserIds] = useState<Record<string, boolean>>({});

  const router = useRouter();
  const [sidebarRefreshNonce, setSidebarRefreshNonce] = useState(0);
  const [nicknameBannerDismissed, setNicknameBannerDismissed] = useState(false);
  /** DM row for active thread: null status = no row yet (composer allowed). */
  const [dmThread, setDmThread] = useState<{
    status: "pending" | "accepted" | "declined" | null;
    initiatedBy: string | null;
  }>({ status: null, initiatedBy: null });
  const [activeRecipientNickname, setActiveRecipientNickname] = useState<string | null>(null);
  const [activeRecipientMeta, setActiveRecipientMeta] = useState<{
    role: string | null;
    preferred_locale: string | null;
    lastSeen: string | null;
    profilePictureUrl: string | null;
  } | null>(null);
  const [myProfileBadges, setMyProfileBadges] = useState<{
    role: string | null;
    preferred_locale: string | null;
    profilePictureUrl: string | null;
  }>({ role: null, preferred_locale: null, profilePictureUrl: null });
  const [chatImageLightboxUrl, setChatImageLightboxUrl] = useState<string | null>(null);
  const [safetyProfilePayload, setSafetyProfilePayload] =
    useState<SafetyProfileOpenPayload | null>(null);

  const searchParams = useSearchParams();

  // Support deep-linking into a thread from `/dashboard` (e.g. `?recipient=<id>`).
  useEffect(() => {
    const recipient = searchParams.get("recipient");
    setActiveRecipientId(recipient ?? null);
  }, [searchParams]);
  /** Local-only labels for contacts (`contact_aliases`). */
  const [contactAliases, setContactAliases] = useState<Record<string, string>>({});
  const [dmActionBusy, setDmActionBusy] = useState(false);

  type E2eRestorePayload = {
    encryptedPrivateKeyBackupBase64: string;
    saltBase64: string;
    publicKeyBase64: string;
  };
  const [e2eRestorePayload, setE2eRestorePayload] = useState<E2eRestorePayload | null>(null);
  const e2eRestorePayloadRef = useRef<E2eRestorePayload | null>(null);
  const [e2eRestoreModalOpen, setE2eRestoreModalOpen] = useState(false);
  const [e2eRestoreBusy, setE2eRestoreBusy] = useState(false);
  const [e2eRestoreError, setE2eRestoreError] = useState<string | null>(null);
  const [e2eForgotPinBusy, setE2eForgotPinBusy] = useState(false);
  const [e2eForgotPinError, setE2eForgotPinError] = useState<string | null>(null);
  /** True until local read + optional server backup check + create/restore decision finishes. */
  const [e2eKeyBootstrapLoading, setE2eKeyBootstrapLoading] = useState(true);
  /** Profile fetch failed (non–no-row) during E2EE bootstrap; do not fall through to keygen. */
  const [e2eNetworkError, setE2eNetworkError] = useState(false);
  /**
   * Server has a registered `public_key` but no complete PIN backup (no ciphertext + salt).
   * Blocks silent keygen until the user confirms via the chat banner.
   */
  const [e2eUnsyncedServerKeyNoBackup, setE2eUnsyncedServerKeyNoBackup] =
    useState(false);
  const [e2eUnsyncedGenerateBusy, setE2eUnsyncedGenerateBusy] = useState(false);

  useEffect(() => {
    e2eRestorePayloadRef.current = e2eRestorePayload;
  }, [e2eRestorePayload]);

  /** Shared by bootstrap and the unsynced-device banner escape hatch. */
  const generateAndPersistNewE2eKeys = useCallback(
    async (isCancelled?: () => boolean) => {
      const keys = await generateKeyPair();
      if (isCancelled?.()) return;
      const [publicKeyBase64, privateKeyBase64] = await Promise.all([
        exportPublicKeyToBase64(keys.publicKey),
        exportPrivateKeyToBase64(keys.privateKey),
      ]);
      if (isCancelled?.()) return;
      try {
        localStorage.setItem(
          E2E_KEY_STORAGE_KEY,
          JSON.stringify({ publicKeyBase64, privateKeyBase64 })
        );
      } catch (error) {
        console.error("Failed to persist E2E keypair", error);
        throw error;
      }
      if (isCancelled?.()) return;
      setSenderKeys(keys);
      setE2eUnsyncedServerKeyNoBackup(false);
      setE2eKeyBootstrapLoading(false);
    },
    []
  );

  const e2eUnsyncedGenerateBusyRef = useRef(false);
  const handleE2eUnsyncedGenerateAnyway = useCallback(() => {
    if (e2eUnsyncedGenerateBusyRef.current) return;
    e2eUnsyncedGenerateBusyRef.current = true;
    setE2eUnsyncedGenerateBusy(true);
    void (async () => {
      try {
        await generateAndPersistNewE2eKeys();
      } finally {
        e2eUnsyncedGenerateBusyRef.current = false;
        setE2eUnsyncedGenerateBusy(false);
      }
    })();
  }, [generateAndPersistNewE2eKeys]);

  const handleE2eRestoreSubmit = useCallback(
    (pin: string) => {
      if (!session?.user?.id) return;
      void (async () => {
        const payload = e2eRestorePayloadRef.current;
        if (!payload) return;
        setE2eRestoreBusy(true);
        setE2eRestoreError(null);
        try {
          const privateKey = await unwrapPrivateKeyWithPin(
            payload.encryptedPrivateKeyBackupBase64,
            payload.saltBase64,
            pin
          );
          const publicKey = await importPublicKeyFromBase64(payload.publicKeyBase64);
          const privateKeyBase64 = await exportPrivateKeyToBase64(privateKey);
          const stored = {
            publicKeyBase64: payload.publicKeyBase64,
            privateKeyBase64,
          };
          try {
            localStorage.setItem(E2E_KEY_STORAGE_KEY, JSON.stringify(stored));
          } catch (storageErr) {
            console.error("Failed to persist restored E2E keypair", storageErr);
            setE2eRestoreError(
              "Could not save your keys on this device (storage full or blocked). Free space or adjust browser settings, then try again."
            );
            return;
          }
          setSenderKeys({ publicKey, privateKey });
          setE2eUnsyncedServerKeyNoBackup(false);
          setE2eRestorePayload(null);
          setE2eRestoreModalOpen(false);
          setE2eRestoreError(null);
          setE2eForgotPinError(null);
        } catch {
          setE2eRestoreError(t(language, "e2eRestoreErrorWrongPin"));
        } finally {
          setE2eRestoreBusy(false);
        }
      })();
    },
    [session?.user?.id, language]
  );

  const handleE2eForgotPinConfirm = useCallback(() => {
    const userId = session?.user?.id;
    if (!userId) return;
    setE2eForgotPinBusy(true);
    setE2eForgotPinError(null);
    void (async () => {
      try {
        await generateAndPersistNewE2eKeys();
        const { error } = await supabase
          .from("profiles")
          .update({
            encrypted_private_key_backup: null,
            key_backup_salt: null,
          })
          .eq("id", userId);
        if (error) {
          console.error("Failed to clear E2EE PIN backup", error);
          setE2eForgotPinError(t(language, "e2eForgotPinError"));
          return;
        }
        setE2eRestorePayload(null);
        setE2eRestoreModalOpen(false);
        setE2eRestoreError(null);
        setE2eForgotPinError(null);
      } catch (err) {
        console.error("Forgot PIN reset failed", err);
        setE2eForgotPinError(t(language, "e2eForgotPinError"));
      } finally {
        setE2eForgotPinBusy(false);
      }
    })();
  }, [session?.user?.id, generateAndPersistNewE2eKeys, language]);

  const dmThreadRef = useRef(dmThread);
  const activeRecipientIdRef = useRef(activeRecipientId);
  useEffect(() => {
    dmThreadRef.current = dmThread;
  }, [dmThread]);
  useEffect(() => {
    activeRecipientIdRef.current = activeRecipientId;
  }, [activeRecipientId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  useEffect(() => {
    const sync = () => setNotificationsMuted(areNotificationsGloballyDisabled());
    sync();
    window.addEventListener("kite-notifications-setting", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("kite-notifications-setting", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  /** Push / VAPID registration only after startup — does not compete with message fetch. */
  useEffect(() => {
    if (!session?.user || notificationsMuted) return;
    if (typeof window === "undefined") return;
    if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return;
    if (!isStandaloneDisplayMode()) return;

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          if (areNotificationsGloballyDisabled()) return;
          if (Notification.permission !== "granted") return;
          const {
            data: { session: s },
          } = await supabase.auth.getSession();
          if (!s?.access_token) return;
          await registerKitePushSubscription(s.access_token);
        } catch {
          // silent
        }
      })();
    }, 5000);

    return () => clearTimeout(timer);
  }, [session?.user?.id, notificationsMuted]);

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

  useEffect(() => {
    senderKeysRef.current = senderKeys;
  }, [senderKeys]);

  useEffect(() => {
    decryptWithRetryRef.current = decryptWithRetry;
  }, [decryptWithRetry]);

  useEffect(() => {
    isLowBandwidthModeRef.current = isLowBandwidthMode;
  }, [isLowBandwidthMode]);

  const decryptInitialRows = useCallback(
    async (
      chronological: MessagesFetchRow[],
      viewerId: string
    ): Promise<MessagesDecryptedItem[]> => {
      const privateKey = senderKeys?.privateKey ?? null;
      if (!privateKey) return [];

      const decrypted: MessagesDecryptedItem[] = [];
      for (const row of chronological) {
        if (!row.encrypted_content) continue;
        const id =
          row.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

        const encryptedForViewer =
          viewerId && row.sender_id === viewerId && row.content_for_sender
            ? row.content_for_sender
            : row.encrypted_content;

        try {
          const decryptedText = await decryptWithRetry(encryptedForViewer, privateKey);
          const p = parseDecryptedPayload(decryptedText);

          decrypted.push({
            id,
            text: p.text,
            isSessionMode: Boolean(row.is_session_mode),
            createdAt: row.created_at,
            isImage: p.isImage,
            imageUrl: p.imageUrl,
            isFile: p.isFile,
            fileUrl: p.fileUrl,
            fileName: p.fileName,
            fileMime: p.fileMime,
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
      return decrypted;
    },
    [decryptWithRetry, senderKeys]
  );

  useEffect(() => {
    decryptInitialRowsRef.current = decryptInitialRows;
  }, [decryptInitialRows]);

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
      if (
        storedLang === "fa" ||
        storedLang === "ar" ||
        storedLang === "en" ||
        storedLang === "kr" ||
        storedLang === "tr"
      ) {
        setLanguage(storedLang);
      }
      setAppearance(localStorage.getItem("kite-appearance") === "light" ? "light" : "dark");
    } catch {
      // Ignore storage errors and fall back to default.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onAppearance = () => {
      try {
        setAppearance(localStorage.getItem("kite-appearance") === "light" ? "light" : "dark");
      } catch {
        setAppearance("dark");
      }
    };
    window.addEventListener("kite-appearance", onAppearance);
    return () => window.removeEventListener("kite-appearance", onAppearance);
  }, []);

  // Keep <html dir> in sync with selected language and write cookie for SSR.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const isRtl = language === "fa" || language === "ar";
    document.documentElement.dir = isRtl ? "rtl" : "ltr";
    document.documentElement.lang =
      language === "kr" ? "ko" : language === "tr" ? "tr" : language;
    document.cookie = `nexus-lang=${language}; path=/; max-age=${60 * 60 * 24 * 365}`;
  }, [language]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setLanguage(readStoredLanguage());
    window.addEventListener("storage", sync);
    window.addEventListener(NEXUS_LANG_CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(NEXUS_LANG_CHANGE_EVENT, sync);
    };
  }, []);

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

      if (data?.session) {
        setSession(data.session);
        return;
      }

      if (error) {
        console.error("Error getting session", error);
      }
      const offline =
        typeof navigator !== "undefined" && !navigator.onLine;
      if (!offline) {
        setSession(null);
      }
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
        .select("nickname, role, preferred_locale, profile_picture_url")
        .eq("id", session.user.id)
        .maybeSingle();

      if (cancelled) return;

      if (error || !data) {
        setNickname(null);
        setMyProfileBadges({ role: null, preferred_locale: null, profilePictureUrl: null });
        return;
      }

      setNickname(
        typeof data.nickname === "string" && data.nickname.trim().length > 0
          ? data.nickname
          : null
      );
      setMyProfileBadges({
        role: typeof data.role === "string" ? data.role : null,
        preferred_locale:
          data.preferred_locale === "en" ||
          data.preferred_locale === "fa" ||
          data.preferred_locale === "ar" ||
          data.preferred_locale === "kr" ||
          data.preferred_locale === "tr"
            ? data.preferred_locale
            : null,
        profilePictureUrl:
          typeof data.profile_picture_url === "string" ? data.profile_picture_url : null,
      });
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

  const loadContactAliases = useCallback(async () => {
    if (!session?.user?.id) return;
    const uid = session.user.id;
    const cached = readJsonCache<{ aliasByContactId: Record<string, string> }>(
      dashboardAliasCacheKey(uid)
    );
    if (cached?.aliasByContactId && Object.keys(cached.aliasByContactId).length > 0) {
      setContactAliases(cached.aliasByContactId);
    }
    const { data, error } = await supabase
      .from("contact_aliases")
      .select("contact_id, alias")
      .eq("user_id", uid);
    if (error) return;
    const map: Record<string, string> = {};
    for (const row of data ?? []) {
      const id = (row as { contact_id?: string }).contact_id;
      const a =
        typeof (row as { alias?: string }).alias === "string"
          ? (row as { alias: string }).alias.trim()
          : "";
      if (id && a) map[id] = a;
    }
    setContactAliases(map);
    writeJsonCache(dashboardAliasCacheKey(uid), { aliasByContactId: map });
  }, [session?.user?.id]);

  useEffect(() => {
    void loadContactAliases();
  }, [loadContactAliases]);

  // Active thread: dm_connections + recipient profile (incl. public_key) in one parallel round-trip.
  useEffect(() => {
    let cancelled = false;
    if (!session || !activeRecipientId) {
      setDmThread({ status: null, initiatedBy: null });
      setActiveRecipientNickname(null);
      setActiveRecipientMeta(null);
      setRecipientPublicKey(null);
      setHasRecipientKey(false);
      return;
    }

    const me = session.user.id;
    const other = activeRecipientId;

    void (async () => {
      const [row, profileRes] = await Promise.all([
        fetchDmConnectionForPair(supabase, me, other),
        supabase
          .from("profiles")
          .select(
            "nickname, role, preferred_locale, last_seen, profile_picture_url, public_key"
          )
          .eq("id", other)
          .maybeSingle(),
      ]);

      if (cancelled) return;

      if (!row) {
        setDmThread({ status: null, initiatedBy: null });
      } else {
        setDmThread({ status: row.status, initiatedBy: row.initiated_by });
      }

      if (other === me) {
        setActiveRecipientNickname(nickname?.trim() ? nickname.trim() : null);
        setActiveRecipientMeta({
          role: myProfileBadges.role,
          preferred_locale: myProfileBadges.preferred_locale,
          lastSeen: null,
          profilePictureUrl: myProfileBadges.profilePictureUrl,
        });
      } else {
        const data = profileRes.data;
        const nn =
          typeof data?.nickname === "string" && data.nickname.trim().length > 0
            ? data.nickname.trim()
            : null;
        setActiveRecipientNickname(nn);
        setActiveRecipientMeta(
          data
            ? {
                role: typeof data.role === "string" ? data.role : null,
                preferred_locale:
                  data.preferred_locale === "en" ||
                  data.preferred_locale === "fa" ||
                  data.preferred_locale === "ar" ||
                  data.preferred_locale === "kr" ||
                  data.preferred_locale === "tr"
                    ? data.preferred_locale
                    : null,
                lastSeen:
                  typeof data.last_seen === "string" ? data.last_seen : null,
                profilePictureUrl:
                  typeof data.profile_picture_url === "string"
                    ? data.profile_picture_url
                    : null,
              }
            : null
        );
      }

      const pkRow = profileRes.data;
      try {
        if (pkRow?.public_key && typeof pkRow.public_key === "string") {
          const key = await importPublicKeyFromBase64(pkRow.public_key);
          if (!cancelled) {
            setRecipientPublicKey(key);
            setHasRecipientKey(true);
          }
        } else if (!cancelled) {
          setRecipientPublicKey(null);
          setHasRecipientKey(false);
        }
      } catch {
        if (!cancelled) {
          setRecipientPublicKey(null);
          setHasRecipientKey(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    session,
    activeRecipientId,
    nickname,
    sidebarRefreshNonce,
    myProfileBadges.role,
    myProfileBadges.preferred_locale,
    myProfileBadges.profilePictureUrl,
  ]);

  // Realtime: partner accepted/declined or row inserted → refresh thread gatekeeping.
  useEffect(() => {
    if (!session?.user?.id || !activeRecipientId) return;
    const me = session.user.id;
    const other = activeRecipientId;
    if (other === me) return;

    const { user_low, user_high } = dmPairKey(me, other);

    const channel = supabase
      .channel(`dm-connection-${user_low}-${user_high}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "dm_connections",
          filter: `user_low=eq.${user_low}`,
        },
        (payload) => {
          const n = payload.new as {
            user_low?: string;
            user_high?: string;
            status?: string;
            initiated_by?: string;
          } | null;
          if (!n?.user_high || n.user_high !== user_high) return;
          if (n.status === "pending" || n.status === "accepted" || n.status === "declined") {
            setDmThread({
              status: n.status,
              initiatedBy: typeof n.initiated_by === "string" ? n.initiated_by : null,
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, activeRecipientId]);

  // Realtime: peer wiped the thread — clear local messages + offline snapshot for this pair.
  useEffect(() => {
    if (!session?.user?.id || !activeRecipientId) return;
    const me = session.user.id;
    const other = activeRecipientId;
    const { user_low, user_high } = dmPairKey(me, other);
    const threadId = `${user_low}:${user_high}`;
    const channelName = `chat-thread-${user_low}-${user_high}`;

    const ch = supabase
      .channel(channelName)
      .on(
        "broadcast",
        { event: "chat-wiped" },
        (payload) => {
          const p = payload.payload as { type?: string; threadId?: string };
          if (p?.type !== "CHAT_WIPED" || p.threadId !== threadId) return;
          const myId = session.user.id;
          pairWarmupAttemptedRef.current.delete(`${myId}:${other}`);
          setMessages((prev) => {
            const next = prev.filter(
              (m) =>
                !(
                  (m.senderId === myId && m.receiverId === other) ||
                  (m.senderId === other && m.receiverId === myId)
                )
            );
            void saveMessagesSnapshot(myId, next);
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [session?.user?.id, activeRecipientId]);

  useEffect(() => {
    try {
      if (localStorage.getItem("kite-nickname-banner-dismissed") === "1") {
        setNicknameBannerDismissed(true);
      }
    } catch {
      // ignore
    }
  }, []);

  // Generate, restore from localStorage, or prompt for PIN backup (same user as session).
  useEffect(() => {
    let cancelled = false;

    const loadOrCreateKeys = async () => {
      if (!session?.user?.id) {
        setSenderKeys(null);
        setE2eRestorePayload(null);
        setE2eRestoreModalOpen(false);
        setE2eRestoreError(null);
        setE2eUnsyncedServerKeyNoBackup(false);
        setE2eNetworkError(false);
        e2eUnsyncedGenerateBusyRef.current = false;
        setE2eUnsyncedGenerateBusy(false);
        setE2eKeyBootstrapLoading(false);
        return;
      }

      setE2eNetworkError(false);
      setE2eKeyBootstrapLoading(true);
      setE2eRestorePayload(null);
      setE2eRestoreModalOpen(false);
      setE2eRestoreError(null);
      setE2eUnsyncedServerKeyNoBackup(false);

      try {
        const stored =
          localStorage.getItem(E2E_KEY_STORAGE_KEY) ??
          localStorage.getItem("nexus-e2e-keypair");
        if (stored) {
          const parsed = JSON.parse(stored) as {
            publicKeyBase64?: string;
            privateKeyBase64?: string;
          };
            if (parsed.publicKeyBase64 && parsed.privateKeyBase64) {
            const [publicKey, privateKey] = await Promise.all([
              importPublicKeyFromBase64(parsed.publicKeyBase64),
              importPrivateKeyFromBase64(parsed.privateKeyBase64),
            ]);
            if (cancelled) return;
            let normalizedPersisted = false;
            try {
              localStorage.setItem(
                E2E_KEY_STORAGE_KEY,
                JSON.stringify({
                  publicKeyBase64: parsed.publicKeyBase64,
                  privateKeyBase64: parsed.privateKeyBase64,
                })
              );
              normalizedPersisted = true;
            } catch (normErr) {
              console.error("Failed to normalize E2E keypair in storage", normErr);
            }
            if (normalizedPersisted) {
              setSenderKeys({ publicKey, privateKey });
              setE2eUnsyncedServerKeyNoBackup(false);
              if (!cancelled) setE2eKeyBootstrapLoading(false);
              return;
            }
          }
        }
      } catch (error) {
        console.error("Failed to restore E2E keypair from storage", error);
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("encrypted_private_key_backup, key_backup_salt, public_key")
        .eq("id", session.user.id)
        .maybeSingle();

      if (cancelled) return;

      if (
        error &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (error as any).code !== "PGRST116"
      ) {
        console.error("Failed to load profile for E2EE restore", error);
        setE2eNetworkError(true);
        setE2eKeyBootstrapLoading(false);
        return;
      }

      const encRaw =
        data && typeof data.encrypted_private_key_backup === "string"
          ? data.encrypted_private_key_backup.trim()
          : "";
      const saltRaw =
        data && typeof data.key_backup_salt === "string"
          ? data.key_backup_salt.trim()
          : "";
      const pubRaw =
        data && typeof data.public_key === "string" ? data.public_key.trim() : "";

      if (encRaw && saltRaw && pubRaw) {
        setE2eUnsyncedServerKeyNoBackup(false);
        setE2eRestorePayload({
          encryptedPrivateKeyBackupBase64: encRaw,
          saltBase64: saltRaw,
          publicKeyBase64: pubRaw,
        });
        setE2eRestoreModalOpen(true);
        setE2eKeyBootstrapLoading(false);
        return;
      }

      if (pubRaw && !(encRaw && saltRaw)) {
        setE2eUnsyncedServerKeyNoBackup(true);
        setE2eKeyBootstrapLoading(false);
        return;
      }

      try {
        await generateAndPersistNewE2eKeys(() => cancelled);
      } catch {
        if (!cancelled) setE2eKeyBootstrapLoading(false);
      }
    };

    void loadOrCreateKeys();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, generateAndPersistNewE2eKeys]);

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

  // Load messages: realtime + initial query start as soon as `session` exists (parallel to E2E key init).
  useEffect(() => {
    if (!session?.user?.id) {
      pendingInitialMessagesRef.current = null;
      return;
    }

    let cancelled = false;
    const viewerId = session.user.id;
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

            if (
              row.sender_id !== viewerId &&
              row.receiver_id !== viewerId
            ) {
              return;
            }
            const dw = decryptWithRetryRef.current;
            const sk = senderKeysRef.current;
            if (!dw || !sk?.privateKey) return;

            let encryptedForViewer =
              viewerId && row.sender_id === viewerId && row.content_for_sender
                ? row.content_for_sender
                : row.encrypted_content;

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
            let isFile = false;
            let fileUrl: string | undefined;
            let fileName: string | undefined;
            let fileMime: string | undefined;
            try {
              const decrypted = await dw(encryptedForViewer, sk.privateKey);
              const p = parseDecryptedPayload(decrypted);
              text = p.text;
              isImage = p.isImage;
              imageUrl = p.imageUrl;
              isFile = p.isFile;
              fileUrl = p.fileUrl;
              fileName = p.fileName;
              fileMime = p.fileMime;
            } catch {
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

                  const raw = await dw(fallbackCipher, sk.privateKey);
                  const p = parseDecryptedPayload(raw);
                  text = p.text;
                  isImage = p.isImage;
                  imageUrl = p.imageUrl;
                  isFile = p.isFile;
                  fileUrl = p.fileUrl;
                  fileName = p.fileName;
                  fileMime = p.fileMime;
                } catch {
                  text = KEY_MISMATCH_TEXT;
                  isImage = false;
                  isFile = false;
                }
              } else {
                text = KEY_MISMATCH_TEXT;
              }
            }

            const senderIdForRead = row.sender_id;
            const d = dmThreadRef.current;
            const pid = activeRecipientIdRef.current;
            const pendingRequestThread =
              Boolean(senderIdForRead) &&
              pid === senderIdForRead &&
              pid !== viewerId &&
              d.status === "pending" &&
              d.initiatedBy === senderIdForRead;

            if (
              !isLowBandwidthModeRef.current &&
              !pendingRequestThread &&
              row.receiver_id === viewerId &&
              row.is_read === false &&
              row.id !== undefined &&
              row.id !== null
            ) {
              void supabase
                .from("messages")
                .update({ is_read: true })
                .eq("id", row.id)
                .eq("receiver_id", viewerId);
            }

            const id =
              row.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

            if (
              row.receiver_id === viewerId &&
              row.sender_id &&
              row.sender_id !== viewerId &&
              !areNotificationsGloballyDisabled()
            ) {
              const active = activeRecipientIdRef.current;
              const inFocusChat = active === row.sender_id;
              const vis =
                typeof document !== "undefined" &&
                document.visibilityState === "visible";
              if (!(inFocusChat && vis)) {
                try {
                  if (Notification.permission === "granted") {
                    const lang = languageRef.current;
                    new Notification(t(lang, "notificationNewMessageTitle"), {
                      body: t(lang, "notificationNewMessageBody"),
                      icon: "/kite-mobile-icon.png",
                    });
                  }
                } catch {
                  // ignore
                }
              }
            }

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
                  isFile,
                  fileUrl,
                  fileName,
                  fileMime,
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

    void (async () => {
      const { data, error } = await supabase
        .from("messages")
        .select(
          "id, encrypted_content, content_for_sender, sender_id, receiver_id, is_session_mode, is_read, created_at"
        )
        .or(`sender_id.eq.${viewerId},receiver_id.eq.${viewerId}`)
        .order("created_at", { ascending: false })
        .limit(CHAT_INITIAL_MESSAGE_LIMIT);

      if (cancelled) return;

      if (error || !data) {
        const cached = await loadMessagesSnapshot(viewerId);
        if (!cancelled && cached?.length) {
          setMessages(cached);
        }
        return;
      }

      const keys = senderKeysRef.current;
      if (!keys?.privateKey) {
        pendingInitialMessagesRef.current = { viewerId, rows: data };
        return;
      }

      const chronological = [...data].reverse();
      const fn = decryptInitialRowsRef.current;
      if (!fn || cancelled) {
        pendingInitialMessagesRef.current = { viewerId, rows: data };
        return;
      }
      if (!cancelled) setMessagesDecryptLoading(true);
      try {
        const decrypted = await fn(chronological, viewerId);
        if (!cancelled) {
          setMessages((prev) => {
            const merged = mergeChatMessagesById(prev, decrypted);
            void saveMessagesSnapshot(viewerId, merged);
            return merged;
          });
        }
      } finally {
        if (!cancelled) setMessagesDecryptLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      pendingInitialMessagesRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!senderKeys?.privateKey || !session?.user?.id) return;
    const pending = pendingInitialMessagesRef.current;
    if (!pending || pending.viewerId !== session.user.id) return;
    const fn = decryptInitialRowsRef.current;
    if (!fn) return;
    pendingInitialMessagesRef.current = null;

    let cancelled = false;
    const viewerId = session.user.id;
    const chronological = [...pending.rows].reverse();

    void (async () => {
      if (!cancelled) setMessagesDecryptLoading(true);
      try {
        const decrypted = await fn(chronological, viewerId);
        if (!cancelled) {
          setMessages((prev) => {
            const merged = mergeChatMessagesById(prev, decrypted);
            void saveMessagesSnapshot(viewerId, merged);
            return merged;
          });
        }
      } finally {
        if (!cancelled) setMessagesDecryptLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [senderKeys, session?.user?.id, decryptInitialRows]);

  // Low-traffic thread: if global inbox fetch missed this pair, load last 50 for the pair once.
  useEffect(() => {
    if (!session?.user?.id || !activeRecipientId || !senderKeys?.privateKey) return;
    if (messagesDecryptLoading) return;

    const myId = session.user.id;
    const otherId = activeRecipientId;
    const warmupKey = `${myId}:${otherId}`;

    const hasForPair = messagesRef.current.some(
      (m) =>
        (m.senderId === myId && m.receiverId === otherId) ||
        (m.senderId === otherId && m.receiverId === myId)
    );
    if (hasForPair) return;

    if (pairWarmupAttemptedRef.current.has(warmupKey)) return;
    pairWarmupAttemptedRef.current.add(warmupKey);

    let cancelled = false;
    const pairFilter = `and(sender_id.eq.${myId},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${myId})`;

    void (async () => {
      const { data, error } = await supabase
        .from("messages")
        .select(
          "id, encrypted_content, content_for_sender, sender_id, receiver_id, is_session_mode, is_read, created_at"
        )
        .or(pairFilter)
        .order("created_at", { ascending: false })
        .limit(CHAT_INITIAL_MESSAGE_LIMIT);

      if (cancelled || error || !data?.length) return;

      const fn = decryptInitialRowsRef.current;
      if (!fn) return;

      const chronological = [...data].reverse();
      if (!cancelled) setMessagesDecryptLoading(true);
      try {
        const decrypted = await fn(chronological, myId);
        if (cancelled) return;
        setMessages((prev) => {
          const merged = mergeChatMessagesById(prev, decrypted);
          void saveMessagesSnapshot(myId, merged);
          return merged;
        });
      } finally {
        if (!cancelled) setMessagesDecryptLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      // Cancelled warmups should be retryable when user returns to this thread.
      pairWarmupAttemptedRef.current.delete(warmupKey);
    };
  }, [
    activeRecipientId,
    session?.user?.id,
    senderKeys?.privateKey,
    messagesDecryptLoading,
  ]);

  const sendMessage = useCallback(async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || !senderKeys || !session || !activeRecipientId) return;

    const recipientPendingGate =
      activeRecipientId !== session.user.id &&
      dmThread.status === "pending" &&
      dmThread.initiatedBy != null &&
      dmThread.initiatedBy !== session.user.id;
    if (recipientPendingGate || dmThread.status === "declined") return;

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
          const profileRow = await withPatience(
            async () => {
              const { data, error } = await supabase
                .from("profiles")
                .select("public_key")
                .eq("id", receiverId)
                .single();
              if (error) throw error;
              return data;
            },
            { patient: isLowBandwidthMode }
          );

          if (
            !profileRow?.public_key ||
            typeof profileRow.public_key !== "string"
          ) {
            const msg = "Waiting for user to initialize secure connection...";
            setSendError(msg);
            setSending(false);
            return;
          }

          const key = await importPublicKeyFromBase64(profileRow.public_key);
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

      try {
        let insertedMessageId: string | null = null;
        await withPatience(
          async () => {
            const { data, error } = await supabase
              .from("messages")
              .insert({
                encrypted_content: encryptedForRecipient,
                content_for_sender: encryptedForSender,
                sender_id: senderId,
                receiver_id: receiverId,
                is_session_mode: professionalMode,
                is_read: false,
              })
              .select("id")
              .single();
            if (error) {
              throw new Error(error.message ?? "Failed to send message");
            }
            insertedMessageId = typeof data?.id === "string" ? data.id : null;
          },
          { patient: isLowBandwidthMode }
        );
        void ensureDmConnectionAfterSend(supabase, senderId, receiverId);
        if (insertedMessageId && receiverId !== senderId) {
          void dispatchPushAfterOutgoingMessage(insertedMessageId, {
            title: t(language, "notificationNewMessageTitle"),
            body: t(language, "notificationNewMessageBody"),
          });
        }
        setSidebarRefreshNonce((n) => n + 1);
        setInputValue("");
        if (textAreaRef.current) {
          textAreaRef.current.style.height = "44px";
        }
      } catch (err) {
        setSendError(
          err instanceof Error ? err.message : "Failed to send message"
        );
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }, [
    inputValue,
    senderKeys,
    recipientPublicKey,
    professionalMode,
    session,
    activeRecipientId,
    dmThread.status,
    dmThread.initiatedBy,
    isLowBandwidthMode,
    language,
  ]);
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

  const lastFilteredMessageId =
    filteredMessages.length > 0
      ? filteredMessages[filteredMessages.length - 1]?.id
      : undefined;

  /** Stable fingerprint of unread inbound for the active thread (mark-read effect deps on this, not `messages`). */
  const unreadInboundSignatureRef = useRef("");
  const unreadInboundSignature = useMemo(() => {
    if (!session?.user?.id || !activeRecipientId) return "";
    const myId = session.user.id;
    const ids: string[] = [];
    for (const m of messages) {
      if (
        m.receiverId === myId &&
        m.senderId === activeRecipientId &&
        m.isRead !== true
      ) {
        ids.push(String(m.id));
      }
    }
    ids.sort();
    return ids.join(",");
  }, [messages, activeRecipientId, session?.user?.id]);
  unreadInboundSignatureRef.current = unreadInboundSignature;

  const flushMarkActiveThreadAsRead = useCallback(() => {
    if (isLowBandwidthMode) return;
    const myId = session?.user?.id;
    if (!myId || !activeRecipientId) return;
    if (document.visibilityState !== "visible") return;
    if (typeof document.hasFocus === "function" && !document.hasFocus()) return;
    const pendingRecipientBlock =
      activeRecipientId !== myId &&
      dmThread.status === "pending" &&
      dmThread.initiatedBy != null &&
      dmThread.initiatedBy !== myId;
    if (pendingRecipientBlock) return;
    if (!unreadInboundSignatureRef.current) return;

    void (async () => {
      try {
        await supabase
          .from("messages")
          .update({ is_read: true })
          .eq("receiver_id", myId)
          .eq("sender_id", activeRecipientId)
          .eq("is_read", false);

        setMessages((prev) => {
          let changed = false;
          const next = prev.map((m) => {
            if (
              m.receiverId === myId &&
              m.senderId === activeRecipientId &&
              m.isRead !== true
            ) {
              changed = true;
              return { ...m, isRead: true };
            }
            return m;
          });
          return changed ? next : prev;
        });
      } catch {
        // Don't block UI if the column doesn't exist yet.
      }
    })();
  }, [
    isLowBandwidthMode,
    session?.user?.id,
    activeRecipientId,
    dmThread.status,
    dmThread.initiatedBy,
  ]);

  useEffect(() => {
    if (!activeRecipientId || filteredMessages.length === 0) return;
    messagesListEndRef.current?.scrollIntoView({
      behavior: isLowBandwidthMode ? "auto" : "smooth",
      block: "end",
    });
  }, [
    activeRecipientId,
    filteredMessages.length,
    lastFilteredMessageId,
    isLowBandwidthMode,
  ]);

  // Mark messages as read when they come from the currently active recipient (after you accepted).
  useEffect(() => {
    if (!unreadInboundSignature) return;
    flushMarkActiveThreadAsRead();
  }, [unreadInboundSignature, flushMarkActiveThreadAsRead]);

  useEffect(() => {
    if (isLowBandwidthMode) return;
    const onVisibility = () => {
      if (document.visibilityState === "visible") flushMarkActiveThreadAsRead();
    };
    const onFocus = () => {
      flushMarkActiveThreadAsRead();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [flushMarkActiveThreadAsRead, isLowBandwidthMode]);

  // Realtime: update read receipts without re-decrypting message content.
  useEffect(() => {
    if (isLowBandwidthMode) return;
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
  }, [session, isLowBandwidthMode]);

  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid || messages.length === 0) return;
    if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    snapshotTimerRef.current = setTimeout(() => {
      snapshotTimerRef.current = null;
      void saveMessagesSnapshot(uid, messages);
    }, 800);
    return () => {
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    };
  }, [messages, session?.user?.id]);

  const handleOpenFilePicker = () => {
    if (!session || !activeRecipientId || isSupportMode) return;
    const pendingRecipientBlock =
      activeRecipientId !== session.user.id &&
      dmThread.status === "pending" &&
      dmThread.initiatedBy != null &&
      dmThread.initiatedBy !== session.user.id;
    if (pendingRecipientBlock || dmThread.status === "declined") return;
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !session || !senderKeys || !activeRecipientId || isSupportMode) return;
    const pendingRecipientBlock =
      activeRecipientId !== session.user.id &&
      dmThread.status === "pending" &&
      dmThread.initiatedBy != null &&
      dmThread.initiatedBy !== session.user.id;
    if (pendingRecipientBlock || dmThread.status === "declined") return;

    if (file.size > CHAT_FILE_MAX_BYTES) {
      setSendError(t(language, "fileTooLargeLowBandwidth"));
      event.target.value = "";
      return;
    }

    setUploadingFile(true);
    setSendError(null);

    try {
      const rawExt =
        (file.name.includes(".") && file.name.split(".").pop()) ||
        (file.type && file.type.split("/").pop()) ||
        "bin";
      const ext = rawExt.replace(/[^a-zA-Z0-9.-]/g, "").slice(0, 16) || "bin";
      const path = `${session.user.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

      const contentType = file.type?.trim() || "application/octet-stream";

      await withPatience(
        async () => {
          const { error: uploadError } = await supabase.storage
            .from("chat-images")
            .upload(path, file, {
              cacheControl: "3600",
              upsert: false,
              contentType,
            });
          if (uploadError) {
            throw new Error(uploadError.message ?? "Failed to upload file");
          }
        },
        { patient: isLowBandwidthMode }
      );

      const { data: publicData } = supabase.storage
        .from("chat-images")
        .getPublicUrl(path);

      const publicUrl = publicData?.publicUrl;
      if (!publicUrl) {
        setSendError("Unable to get file URL");
        return;
      }

      const receiverId = activeRecipientId;
      const senderId = session.user.id;

      let keyToUse: CryptoKey | null = null;
      if (receiverId === senderId) {
        keyToUse = senderKeys.publicKey;
      } else {
        try {
          const profileRow = await withPatience(
            async () => {
              const { data, error } = await supabase
                .from("profiles")
                .select("public_key")
                .eq("id", receiverId)
                .maybeSingle();
              if (error) throw error;
              return data;
            },
            { patient: isLowBandwidthMode }
          );

          if (
            !profileRow?.public_key ||
            typeof profileRow.public_key !== "string"
          ) {
            const msg = "Waiting for user to initialize secure connection...";
            setSendError(msg);
            setUploadingFile(false);
            event.target.value = "";
            return;
          }

          const key = await importPublicKeyFromBase64(profileRow.public_key);
          setRecipientPublicKey(key);
          setHasRecipientKey(true);
          keyToUse = key;
        } catch {
          const msg = "Waiting for user to initialize secure connection...";
          setSendError(msg);
          setUploadingFile(false);
          event.target.value = "";
          return;
        }
      }

      const isImageUpload = contentType.startsWith("image/");
      const attachmentPayload = isImageUpload
        ? { type: "image" as const, url: publicUrl }
        : {
            type: "file" as const,
            url: publicUrl,
            name: file.name || "File",
            mime: contentType,
          };
      const payloadJson = JSON.stringify(attachmentPayload);

      const encryptedText = await encryptMessage(payloadJson, keyToUse, senderKeys);

      const encryptedForSender = await encryptMessage(
        payloadJson,
        senderKeys.publicKey,
        senderKeys
      );

      let insertedAttachmentId: string | null = null;
      await withPatience(
        async () => {
          const { data, error: insertError } = await supabase
            .from("messages")
            .insert({
              encrypted_content: encryptedText,
              content_for_sender: encryptedForSender,
              sender_id: session.user.id,
              receiver_id: activeRecipientId,
              is_session_mode: professionalMode,
              is_read: false,
            })
            .select("id")
            .single();
          if (insertError) {
            throw new Error(insertError.message ?? "Failed to send attachment");
          }
          insertedAttachmentId = typeof data?.id === "string" ? data.id : null;
        },
        { patient: isLowBandwidthMode }
      );

      void ensureDmConnectionAfterSend(supabase, session.user.id, activeRecipientId);
      if (
        insertedAttachmentId &&
        activeRecipientId &&
        activeRecipientId !== session.user.id
      ) {
        void dispatchPushAfterOutgoingMessage(insertedAttachmentId, {
          title: t(language, "notificationNewMessageTitle"),
          body: t(language, "notificationNewMessageBody"),
        });
      }
      setSidebarRefreshNonce((n) => n + 1);
    } catch (err) {
      setSendError(
        err instanceof Error ? err.message : "Failed to send file"
      );
    } finally {
      setUploadingFile(false);
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
    const pendingRecipientBlock =
      activeRecipientId !== session.user.id &&
      dmThread.status === "pending" &&
      dmThread.initiatedBy != null &&
      dmThread.initiatedBy !== session.user.id;
    if (pendingRecipientBlock || dmThread.status === "declined") return;
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
              const profileRow = await withPatience(
                async () => {
                  const { data, error } = await supabase
                    .from("profiles")
                    .select("public_key")
                    .eq("id", receiverId)
                    .maybeSingle();
                  if (error) throw error;
                  return data;
                },
                { patient: isLowBandwidthMode }
              );

              if (
                !profileRow?.public_key ||
                typeof profileRow.public_key !== "string"
              ) {
                const msg = "Waiting for user to initialize secure connection...";
                setSendError(msg);
                return;
              }

              const key = await importPublicKeyFromBase64(profileRow.public_key);
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

          let insertedLocationId: string | null = null;
          await withPatience(
            async () => {
              const { data, error } = await supabase
                .from("messages")
                .insert({
                  encrypted_content: encryptedText,
                  content_for_sender: encryptedForSender,
                  sender_id: senderId,
                  receiver_id: receiverId,
                  is_session_mode: professionalMode,
                  is_read: false,
                })
                .select("id")
                .single();
              if (error) {
                throw new Error(error.message ?? "Failed to share location");
              }
              insertedLocationId = typeof data?.id === "string" ? data.id : null;
            },
            { patient: isLowBandwidthMode }
          );

          void ensureDmConnectionAfterSend(supabase, senderId, receiverId);
          if (insertedLocationId && receiverId !== senderId) {
            void dispatchPushAfterOutgoingMessage(insertedLocationId, {
              title: t(language, "notificationNewMessageTitle"),
              body: t(language, "notificationNewMessageBody"),
            });
          }
          setSidebarRefreshNonce((n) => n + 1);
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

  const recipientPublicNickname =
    activeRecipientId === session?.user?.id
      ? (nickname?.trim() ?? "")
      : (activeRecipientNickname?.trim() ?? "");

  const recipientDisplayName = contactDisplayLabel(
    recipientPublicNickname,
    activeRecipientId ? contactAliases[activeRecipientId] : undefined,
    t(language, "anonymousLabel")
  );
  const recipientLastSeenFormatted = activeRecipientId
    ? formatRelativeLastSeen(activeRecipientMeta?.lastSeen ?? null, language)
    : null;
  const recipientStatusText =
    activeRecipientId && onlineUserIds[activeRecipientId]
      ? t(language, "safetyProfileBadgeOnline")
      : recipientLastSeenFormatted
        ? t(language, "chatHeaderRecipientLastSeen").replace(
            "{{time}}",
            recipientLastSeenFormatted
          )
        : t(language, "safetyProfileBadgeOffline");

  const handleOpenSafetyProfile = useCallback(
    (payload: SafetyProfileOpenPayload) => {
      setSafetyProfilePayload(payload);
    },
    []
  );

  const handleContactAliasUpdated = useCallback(
    (contactId: string, alias: string | null) => {
      setContactAliases((prev) => {
        const next = { ...prev };
        if (alias?.trim()) next[contactId] = alias.trim();
        else delete next[contactId];
        return next;
      });
      setSafetyProfilePayload((prev) => {
        if (!prev || prev.target.id !== contactId) return prev;
        return {
          ...prev,
          target: { ...prev.target, localAlias: alias },
        };
      });
    },
    []
  );

  const openActiveRecipientProfile = useCallback(() => {
    if (!session?.user?.id || !activeRecipientId) return;
    const isSelf = activeRecipientId === session.user.id;
    handleOpenSafetyProfile({
      target: {
        id: activeRecipientId,
        nickname: recipientPublicNickname,
        localAlias: isSelf ? null : contactAliases[activeRecipientId] ?? null,
        role: isSelf ? myProfileBadges.role : activeRecipientMeta?.role ?? null,
        preferred_locale: isSelf
          ? myProfileBadges.preferred_locale
          : activeRecipientMeta?.preferred_locale ?? null,
        isOnline: Boolean(onlineUserIds[activeRecipientId]),
        lastSeen: isSelf ? null : activeRecipientMeta?.lastSeen ?? null,
      },
      dmStatus: isSelf ? "accepted" : dmThread.status,
      isSelf,
    });
  }, [
    session?.user?.id,
    activeRecipientId,
    recipientPublicNickname,
    contactAliases,
    myProfileBadges.role,
    myProfileBadges.preferred_locale,
    activeRecipientMeta,
    onlineUserIds,
    dmThread.status,
    handleOpenSafetyProfile,
  ]);

  const isRecipientMessageRequest =
    !!session &&
    !!activeRecipientId &&
    session.user.id !== activeRecipientId &&
    dmThread.status === "pending" &&
    dmThread.initiatedBy != null &&
    dmThread.initiatedBy !== session.user.id;

  const isSenderAwaitingAccept =
    !!session &&
    !!activeRecipientId &&
    session.user.id !== activeRecipientId &&
    dmThread.status === "pending" &&
    dmThread.initiatedBy === session.user.id;

  const isThreadDeclined = dmThread.status === "declined";

  const composerDisabled =
    !session ||
    !senderKeys ||
    !activeRecipientId ||
    isRecipientMessageRequest ||
    isSenderAwaitingAccept ||
    isThreadDeclined;

  const handleAcceptMessageRequest = async () => {
    if (!session || !activeRecipientId || dmActionBusy) return;
    setDmActionBusy(true);
    setSendError(null);
    try {
      const { error } = await acceptDmConnection(supabase, session.user.id, activeRecipientId);
      if (error) {
        setSendError(error.message);
        return;
      }
      setDmThread({ status: "accepted", initiatedBy: dmThread.initiatedBy });
      setSidebarRefreshNonce((n) => n + 1);
    } finally {
      setDmActionBusy(false);
    }
  };

  const handleIgnoreMessageRequest = async () => {
    if (!session || !activeRecipientId || dmActionBusy) return;
    setDmActionBusy(true);
    setSendError(null);
    try {
      const { error } = await declineDmConnection(supabase, session.user.id, activeRecipientId);
      if (error) {
        setSendError(error.message);
        return;
      }
      setDmThread({ status: "declined", initiatedBy: dmThread.initiatedBy });
      setSidebarRefreshNonce((n) => n + 1);
      setActiveRecipientId(null);
    } finally {
      setDmActionBusy(false);
    }
  };

  const handleSelectRecipient = useCallback(
    (id: string) => {
      setActiveRecipientId(id);
      router.push(`/chat?recipient=${encodeURIComponent(id)}`);
    },
    [router]
  );

  const handleBackToList = useCallback(() => {
    setActiveRecipientId(null);
    router.push("/chat");
  }, [router]);

  const handleWipeConversation = useCallback(async () => {
    if (!session?.user?.id || !activeRecipientId) return;
    const confirmed =
      typeof window !== "undefined"
        ? window.confirm(t(language, "chatWipeConversationConfirm"))
        : false;
    if (!confirmed) return;

    const myId = session.user.id;
    const otherId = activeRecipientId;
    const pairFilter = `and(sender_id.eq.${myId},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${myId})`;

    const { error } = await supabase.from("messages").delete().or(pairFilter);
    if (error) {
      setSendError(error.message ?? t(language, "chatFailedToWipe"));
      return;
    }

    const { user_low, user_high } = dmPairKey(myId, otherId);
    const threadId = `${user_low}:${user_high}`;
    const wipeChannelName = `chat-thread-${user_low}-${user_high}`;
    const wipeCh = supabase.channel(wipeChannelName);
    await new Promise<void>((resolve) => {
      const done = () => {
        supabase.removeChannel(wipeCh);
        resolve();
      };
      const timeout = window.setTimeout(done, 4000);
      let sent = false;
      wipeCh.subscribe((status) => {
        if (status === "SUBSCRIBED" && !sent) {
          sent = true;
          void wipeCh
            .send({
              type: "broadcast",
              event: "chat-wiped",
              payload: { type: "CHAT_WIPED", threadId },
            })
            .finally(() => {
              window.clearTimeout(timeout);
              done();
            });
        }
      });
    });

    setMessages((prev) => {
      const next = prev.filter(
        (m) =>
          !(
            (m.senderId === myId && m.receiverId === otherId) ||
            (m.senderId === otherId && m.receiverId === myId)
          )
      );
      void saveMessagesSnapshot(myId, next);
      return next;
    });
    pairWarmupAttemptedRef.current.delete(`${myId}:${otherId}`);
    handleBackToList();
  }, [activeRecipientId, handleBackToList, language, session?.user?.id]);

  const canSend =
    Boolean(trimmedInput) &&
    Boolean(senderKeys) &&
    Boolean(activeRecipientId) &&
    !sending &&
    !composerDisabled;

  const locationReady =
    Boolean(session) &&
    Boolean(senderKeys) &&
    Boolean(activeRecipientId) &&
    !composerDisabled &&
    hasOwnKeyInDb &&
    (activeRecipientId === session?.user.id ? true : hasRecipientKey);

  const formatTime = (iso?: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const isRtlLayout = language === "fa" || language === "ar";

  const bodyTheme: ThemeVars = isSupportMode
    ? SUPPORT_THEME
    : professionalMode
      ? appearance === "light"
        ? LIGHT_THERAPIST_THEME
        : THERAPIST_THEME
      : appearance === "light"
        ? LIGHT_MUSICIAN_THEME
        : MUSICIAN_THEME;

  if (!session) {
    return <AuthLazy />;
  }

  const motionDuration = isLowBandwidthMode ? 0 : 0.2;

  return (
    <MotionConfig reducedMotion={isLowBandwidthMode ? "always" : "user"}>
    <motion.div
      className="relative flex h-[calc(100dvh-var(--bottom-nav-height))] max-h-[calc(100dvh-var(--bottom-nav-height))] flex-col overflow-hidden"
      dir={isRtlLayout ? "rtl" : "ltr"}
      data-theme={isSupportMode ? "support" : "default"}
      style={{
        background: "var(--page-bg)",
        color: "var(--text-primary)",
      }}
      initial={false}
      animate={themeToMotionStyle(bodyTheme)}
      transition={{ duration: motionDuration, ease: "easeOut" }}
    >
      <main className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
        {e2eKeyBootstrapLoading && !senderKeys && !e2eRestorePayload ? (
          <div
            className="shrink-0 border-b px-3 py-2.5 text-center text-xs sm:text-sm sm:px-4"
            style={{
              borderColor: "var(--border)",
              background: "var(--panel-bg)",
              color: "var(--text-secondary)",
            }}
            role="status"
          >
            {t(language, "syncingSecurity")}
          </div>
        ) : null}
        {e2eNetworkError ? (
          <div
            className="shrink-0 border-b px-3 py-3 sm:px-4"
            style={{
              borderColor: "var(--border)",
              background: "var(--panel-bg)",
            }}
            role="alert"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
                aria-hidden
              />
              <p
                className="min-w-0 flex-1 text-xs font-semibold sm:text-sm"
                style={{ color: "var(--text-primary)" }}
              >
                Network error verifying security. Please check your connection and refresh the
                page.
              </p>
            </div>
          </div>
        ) : null}
        {e2eUnsyncedServerKeyNoBackup &&
        !senderKeys &&
        !e2eRestorePayload &&
        !e2eKeyBootstrapLoading ? (
          <div
            className="shrink-0 border-b px-3 py-3 sm:px-4"
            style={{
              borderColor: "var(--border)",
              background: "var(--panel-bg)",
            }}
            role="alert"
          >
            <div className="mb-2 flex items-start gap-2">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
                aria-hidden
              />
              <div className="min-w-0 flex-1 space-y-2">
                <p
                  className="text-sm font-semibold"
                  style={{ color: "var(--text-primary)" }}
                >
                  {t(language, "e2eUnsyncedDeviceTitle")}
                </p>
                <p className="text-xs sm:text-sm" style={{ color: "var(--text-secondary)" }}>
                  {t(language, "e2eUnsyncedDeviceBody")}
                </p>
                <p className="text-xs sm:text-sm text-amber-600/95 dark:text-amber-400/95">
                  {t(language, "e2eUnsyncedDeviceHint")}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleE2eUnsyncedGenerateAnyway}
              disabled={e2eUnsyncedGenerateBusy}
              className="w-full rounded-xl px-4 py-2.5 text-xs font-semibold text-white sm:text-sm disabled:opacity-50"
              style={{ background: "var(--accent)" }}
            >
              {e2eUnsyncedGenerateBusy ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                  {t(language, "chatLoadingShort")}
                </span>
              ) : (
                t(language, "e2eUnsyncedGenerateNewKeys")
              )}
            </button>
          </div>
        ) : null}
        {e2eRestorePayload && !senderKeys && !e2eRestoreModalOpen ? (
          <div
            className="shrink-0 border-b px-3 py-3 sm:px-4"
            style={{
              borderColor: "var(--border)",
              background: "var(--panel-bg)",
            }}
            role="status"
          >
            <p className="mb-2 text-xs sm:text-sm" style={{ color: "var(--text-secondary)" }}>
              {t(language, "e2eRestoreModalTitle")}
            </p>
            <button
              type="button"
              onClick={() => {
                setE2eRestoreError(null);
                setE2eRestoreModalOpen(true);
              }}
              className="rounded-xl px-4 py-2 text-xs font-semibold text-white sm:text-sm"
              style={{ background: "var(--accent)" }}
            >
              {t(language, "e2eRestoreSubmit")}
            </button>
          </div>
        ) : null}
        {!activeRecipientId ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <header
              className="sticky top-0 z-10 shrink-0 px-4 py-3 backdrop-blur-md"
              style={{
                background:
                  appearance === "light"
                    ? "rgba(245, 245, 244, 0.88)"
                    : "rgba(0, 0, 0, 0.5)",
              }}
            >
              <h1
                className="text-center text-2xl font-bold tracking-tight"
                style={{ color: "var(--text-primary)" }}
              >
                {t(language, "chatAppTitle")}
              </h1>
            </header>
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-3 pb-3 pt-1 sm:px-4 sm:pb-4">
              <UserDiscoverySidebar
                sessionUserId={session.user.id}
                activeRecipientId={activeRecipientId}
                onSelectRecipientId={handleSelectRecipient}
                language={language}
                onlineUserIds={onlineUserIds}
                refreshNonce={sidebarRefreshNonce}
                lowBandwidth={isLowBandwidthMode}
                onOpenSafetyProfile={handleOpenSafetyProfile}
                aliasByContactId={contactAliases}
              />
            </div>
          </div>
        ) : (
          <>
            <div className="shrink-0 px-3 pt-3 sm:px-4">
              <div className="mx-auto grid w-full max-w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-xl bg-black/10 px-2 py-1 backdrop-blur-md lg:max-w-2xl">
                <div className="flex min-w-0 items-center">
                  <button
                    type="button"
                    onClick={handleBackToList}
                    className="inline-flex items-center gap-1 rounded-xl px-2 py-1.5 text-xs font-semibold hover:bg-white/10"
                    style={{ color: "var(--text-secondary)" }}
                    aria-label={t(language, "chatBackToChatsAria")}
                  >
                    <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="max-w-[4.5rem] truncate sm:max-w-none">
                      {t(language, "navTabChats")}
                    </span>
                  </button>
                </div>
                <div className="flex min-w-0 w-full flex-1 items-center gap-2">
                  <button
                    type="button"
                    onClick={openActiveRecipientProfile}
                    className="mx-auto flex min-w-0 max-w-full flex-1 flex-col items-center justify-center rounded-xl px-2 py-1 hover:bg-white/10"
                    style={{ color: "var(--text-primary)" }}
                  >
                    <div className="flex min-w-0 w-full max-w-full items-center justify-center gap-2">
                      {activeRecipientMeta?.profilePictureUrl ? (
                        <span
                          role="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setChatImageLightboxUrl(activeRecipientMeta.profilePictureUrl);
                          }}
                          className="h-8 w-8 shrink-0 overflow-hidden rounded-full"
                          aria-label={t(language, "chatOpenProfilePictureAria")}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={activeRecipientMeta.profilePictureUrl}
                            alt={t(language, "chatRecipientProfileAlt").replace(
                              "{{name}}",
                              recipientDisplayName
                            )}
                            className="h-full w-full object-cover"
                          />
                        </span>
                      ) : null}
                      <span className="min-w-0 truncate text-center text-xl font-bold">
                        {recipientDisplayName}
                      </span>
                    </div>
                    <span
                      className="hidden min-w-0 max-w-full truncate text-center text-xs sm:block"
                      style={{ color: "#a8a29e" }}
                    >
                      {recipientStatusText}
                    </span>
                  </button>
                </div>
                <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                  <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                    <span
                      className="whitespace-nowrap text-end text-[10px] font-semibold leading-tight sm:text-xs"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {t(language, "supportModeLabel")}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isSupportMode}
                      aria-label={t(language, "chatSupportModeToggleAria")}
                      onClick={() => {
                        const next = !isSupportMode;
                        setIsSupportMode(next);
                        writeSupportModeToStorage(next);
                      }}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border p-0.5 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent ${
                        isSupportMode
                          ? "border-orange-500/60 bg-orange-600"
                          : "border-stone-600/70 bg-stone-700"
                      }`}
                    >
                      <span
                        className={`pointer-events-none block h-5 w-5 rounded-full bg-white shadow transition-[margin] duration-200 ease-out ${
                          isSupportMode ? "ml-auto" : "ml-0"
                        }`}
                        aria-hidden
                      />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleWipeConversation()}
                    className="inline-flex shrink-0 items-center gap-1 rounded-xl px-2 py-1.5 text-xs font-semibold"
                    style={{ color: "#ef4444" }}
                    aria-label={t(language, "wipeChat")}
                  >
                    <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="hidden sm:inline">{t(language, "wipeChat")}</span>
                  </button>
                </div>
              </div>
            </div>

        {session && activeRecipientId && isRecipientMessageRequest && (
          <div
            className="mx-3 mt-2 flex flex-col gap-3 rounded-xl border px-3 py-3 sm:mx-4"
            style={{
              borderColor: "rgba(255, 69, 0, 0.55)",
              background: "rgba(0, 0, 0, 0.88)",
            }}
            role="region"
            aria-label={t(language, "messageRequestBannerTitle")}
          >
            <div>
              <p className="text-sm font-semibold" style={{ color: "#FF4500" }}>
                {t(language, "messageRequestBannerTitle")}
              </p>
              <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {t(language, "messageRequestBannerBody")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={dmActionBusy}
                onClick={() => void handleAcceptMessageRequest()}
                className="rounded-lg px-4 py-2 text-xs font-semibold text-black transition disabled:opacity-50"
                style={{ background: "#FF4500" }}
              >
                {t(language, "messageRequestAccept")}
              </button>
              <button
                type="button"
                disabled={dmActionBusy}
                onClick={() => void handleIgnoreMessageRequest()}
                className="rounded-lg border px-4 py-2 text-xs font-medium transition disabled:opacity-50"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              >
                {t(language, "messageRequestIgnoreBlock")}
              </button>
            </div>
          </div>
        )}

        {session && activeRecipientId && isSenderAwaitingAccept && (
          <div
            className="mx-3 mt-2 rounded-xl px-3 py-2 text-xs sm:mx-4"
            style={{
              background: "rgba(255, 69, 0, 0.08)",
              color: "var(--text-secondary)",
            }}
            role="status"
          >
            {t(language, "chatAwaitingAcceptComposer").replace(
              "{{nickname}}",
              recipientDisplayName
            )}
          </div>
        )}

        {/* Messages area */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6">
          <div className="mx-auto w-full max-w-full space-y-4 lg:max-w-2xl">
            {activeRecipientId ? (
              <div
                className="bg-stone-100 dark:bg-stone-900/40 text-stone-600 dark:text-stone-400 text-xs py-2 px-4 text-center border-b border-stone-200 dark:border-stone-800 mb-4"
                role="status"
              >
                🔒 Privacy Mode: Messages are automatically deleted every 30 days.
              </div>
            ) : null}
            {!senderKeys && activeRecipientId ? (
              <div
                className="rounded-2xl px-4 py-3 w-fit"
                style={{
                  background: "var(--panel-bg)",
                  border: "1px solid var(--border)",
                  boxShadow: professionalMode ? "none" : "var(--glow)",
                }}
              >
                <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                  {t(language, "syncingSecurity")}
                </p>
              </div>
            ) : activeRecipientId && messagesDecryptLoading && senderKeys ? (
              <div
                className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-stone-200 bg-stone-100/80 px-6 py-8 dark:border-stone-800 dark:bg-stone-900/40"
                role="status"
                aria-live="polite"
              >
                <Loader2
                  className="h-8 w-8 animate-spin text-emerald-600 dark:text-emerald-400"
                  aria-hidden
                  strokeWidth={2}
                />
                <p className="text-sm font-medium text-stone-600 dark:text-stone-400">
                  Loading messages…
                </p>
                <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
                  <div
                    className="h-full w-1/3 animate-pulse rounded-full bg-emerald-500/70 dark:bg-emerald-400/60"
                    aria-hidden
                  />
                </div>
              </div>
            ) : filteredMessages.length === 0 ? (
              activeRecipientId ? (
                <div
                  className="rounded-2xl px-4 py-3 w-fit"
                  style={{
                    background: "var(--panel-bg)",
                    border: "1px solid var(--border)",
                    boxShadow: professionalMode ? "none" : "var(--glow)",
                  }}
                >
                  <p className="text-sm text-stone-500 dark:text-stone-400">
                    Your chat history is clear. Messages older than 30 days are removed for your
                    privacy.
                  </p>
                </div>
              ) : (
                <div
                  className="rounded-2xl px-4 py-3"
                  style={{
                    background: "var(--panel-bg)",
                    border: "1px solid var(--border)",
                    boxShadow: professionalMode ? "none" : "var(--glow)",
                  }}
                >
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                    {t(language, "chatEmptySelectConversation")}
                  </p>
                </div>
              )
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
                              : appearance === "light"
                                ? "#000000"
                                : "rgba(12, 10, 18, 0.9)"
                          : "var(--text-primary)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    {m.isImage && m.imageUrl && !isSupportMode ? (
                      <div className="space-y-2">
                        {isLowBandwidthMode ? (
                          <a
                            href={m.imageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm underline break-words"
                            style={{ color: "inherit" }}
                          >
                            {t(language, "imageSkippedLowBandwidth")}
                          </a>
                        ) : (
                        <div className="relative overflow-hidden rounded-lg bg-black/10">
                          <Image
                            src={m.imageUrl}
                            alt="Shared image"
                            width={512}
                            height={512}
                            className="max-h-64 w-auto object-cover"
                          />
                        </div>
                        )}
                        {m.text && m.text !== m.imageUrl && (
                          <p
                            className="text-xs opacity-80"
                            style={{ wordBreak: "break-word", whiteSpace: "pre-wrap" }}
                          >
                            {m.text}
                          </p>
                        )}
                      </div>
                    ) : m.isFile && m.fileUrl && !isSupportMode ? (
                      <a
                        href={m.fileUrl}
                        download={m.fileName || "file"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-semibold underline break-all"
                        style={{ color: "inherit" }}
                      >
                        {m.fileName || m.text}
                        {m.fileMime ? (
                          <span className="block text-xs font-normal opacity-80">{m.fileMime}</span>
                        ) : null}
                      </a>
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
                      <p className="mt-1 text-[11px] opacity-80">
                        {t(language, "chatMessageSessionModeLabel")}
                      </p>
                    )}
                    <div className="mt-1 flex items-center justify-end gap-2 text-[11px] opacity-80">
                      <span>{formatTime(m.createdAt)}</span>
                      {m.senderId === session.user.id && !isLowBandwidthMode && (
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
            <div ref={messagesListEndRef} className="h-px w-full shrink-0" aria-hidden />
          </div>
        </div>

        {/* Input — hidden for recipient until they accept the message request */}
        <div
          className="shrink-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] pt-3 sm:p-4 sm:pb-[max(1rem,env(safe-area-inset-bottom,0px))]"
        >
          {sendError && (
            <p className="mx-auto mb-2 w-full max-w-full px-1 text-sm text-red-500 lg:max-w-2xl" role="alert">
              {sendError}
            </p>
          )}
          {!composerDisabled ? (
            <div className="mx-auto w-full max-w-full lg:max-w-2xl">
              <div
                className="flex w-full min-w-0 items-center gap-1.5 rounded-2xl border px-1.5 py-1 backdrop-blur-sm sm:gap-2 sm:px-2"
                style={{
                  background: "var(--input-bg)",
                  borderColor: "var(--border)",
                  boxShadow: professionalMode ? "none" : "var(--glow)",
                }}
              >
                {!isSupportMode ? (
                  <button
                    type="button"
                    onClick={handleOpenFilePicker}
                    disabled={
                      uploadingFile || !senderKeys || !recipientPublicKey || !activeRecipientId
                    }
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-medium transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ color: "var(--text-secondary)" }}
                    aria-label={t(language, "attachImage")}
                  >
                    <Paperclip className="h-5 w-5" aria-hidden strokeWidth={2} />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={handleShareLocation}
                  disabled={!locationReady}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-medium transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ color: "var(--text-secondary)" }}
                  title={
                    !locationReady
                      ? t(language, "locationRequiresSecureKeyExchange")
                      : t(language, "shareLocation")
                  }
                  aria-label={t(language, "shareLocation")}
                >
                  <MapPin className="h-5 w-5" aria-hidden strokeWidth={2} />
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
                  className="min-h-[40px] flex-1 resize-none bg-transparent px-1 py-2.5 text-sm outline-none placeholder:opacity-60 sm:px-2"
                  style={{
                    color: "var(--text-primary)",
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
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    background: "var(--accent)",
                    color:
                      isSupportMode || professionalMode
                        ? "#fff"
                        : appearance === "light"
                          ? "#000000"
                          : "rgba(12, 10, 18, 0.9)",
                  }}
                  aria-label={
                    sending ? t(language, "chatSendingAria") : t(language, "chatSendMessageAria")
                  }
                >
                  {sending ? (
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden strokeWidth={2} />
                  ) : (
                    <Send className="h-5 w-5" aria-hidden strokeWidth={2} />
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="*/*"
                  onChange={handleFileSelected}
                />
              </div>
            </div>
          ) : isThreadDeclined && activeRecipientId ? (
            <p className="mx-auto w-full max-w-full px-2 text-center text-xs lg:max-w-2xl" style={{ color: "var(--text-secondary)" }}>
              {t(language, "threadDeclinedNote")}
            </p>
          ) : isRecipientMessageRequest ? (
            <p className="mx-auto w-full max-w-full px-2 text-center text-xs lg:max-w-2xl" style={{ color: "var(--text-secondary)" }}>
              {t(language, "messageRequestComposerLocked")}
            </p>
          ) : null}
        </div>
          </>
        )}
      </main>

      {chatImageLightboxUrl ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setChatImageLightboxUrl(null)}
          role="dialog"
          aria-label="Image preview"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={chatImageLightboxUrl}
            alt="Preview"
            className="max-h-[90vh] max-w-[95vw] rounded-2xl object-contain"
          />
        </div>
      ) : null}

      {safetyProfilePayload ? (
        <SafetyProfileModal
          open
          onClose={() => setSafetyProfilePayload(null)}
          language={language}
          appearance={appearance}
          viewerId={session.user.id}
          target={safetyProfilePayload.target}
          dmStatus={
            safetyProfilePayload.isSelf
              ? "accepted"
              : safetyProfilePayload.dmStatus
          }
          isSelf={safetyProfilePayload.isSelf}
          onContactAliasUpdated={handleContactAliasUpdated}
        />
      ) : null}

      <E2ePinRestoreModal
        open={e2eRestoreModalOpen && Boolean(e2eRestorePayload)}
        onOpenChange={(open) => {
          setE2eRestoreModalOpen(open);
          if (!open) {
            setE2eRestoreError(null);
            setE2eForgotPinError(null);
          }
        }}
        language={language}
        busy={e2eRestoreBusy}
        errorMessage={e2eRestoreError}
        onSubmit={handleE2eRestoreSubmit}
        onForgotPinConfirm={handleE2eForgotPinConfirm}
        forgotPinBusy={e2eForgotPinBusy}
        forgotPinError={e2eForgotPinError}
        theme={{
          panelBg: bodyTheme["--panel-bg"],
          border: bodyTheme["--border"],
          accent: bodyTheme["--accent"],
          textPrimary: bodyTheme["--text-primary"],
          textSecondary: bodyTheme["--text-secondary"],
          inputBg: bodyTheme["--input-bg"],
        }}
      />
    </motion.div>
    </MotionConfig>
  );
}
