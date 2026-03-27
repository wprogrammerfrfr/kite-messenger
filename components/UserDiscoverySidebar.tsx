"use client";

import { supabase } from "@/lib/supabase";
import { dmPairKey, type DmConnectionStatus } from "@/lib/dm-connections";
import {
  fetchSidebarPrivacySnapshot,
  type SidebarPrivacySnapshot,
  type SidebarProfileRow,
} from "@/lib/fetch-sidebar-privacy";
import { readJsonCache, sidebarPrivacyCacheKey, writeJsonCache } from "@/lib/kite-tab-cache";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, memo } from "react";
import { t, type Language } from "@/lib/translations";
import type { SafetyProfileOpenPayload } from "@/components/SafetyProfileModal";
import { formatRelativeLastSeen } from "@/lib/relative-last-seen";
import { contactDisplayLabel } from "@/lib/contact-display";
import { SkeletonDiscover } from "@/components/SkeletonDiscover";

type ProfileRow = SidebarProfileRow;

function readSidebarCache(userId: string): SidebarPrivacySnapshot | null {
  return readJsonCache<SidebarPrivacySnapshot>(sidebarPrivacyCacheKey(userId));
}

function applySnapshot(
  s: SidebarPrivacySnapshot,
  setters: {
    setProfilesById: (v: Record<string, ProfileRow>) => void;
    setDmStatusByPartnerId: (v: Record<string, DmConnectionStatus | null>) => void;
    setInboxIds: (v: string[]) => void;
    setRequestIds: (v: string[]) => void;
  }
) {
  setters.setProfilesById(s.profilesById);
  setters.setDmStatusByPartnerId(s.dmStatusByPartnerId);
  setters.setInboxIds(s.inboxIds);
  setters.setRequestIds(s.requestIds);
}

function UserDiscoverySidebarInner(props: {
  sessionUserId: string;
  activeRecipientId: string | null;
  onSelectRecipientId: (id: string) => void;
  language?: Language;
  onlineUserIds?: Record<string, boolean>;
  refreshNonce?: number;
  lowBandwidth?: boolean;
  onOpenSafetyProfile?: (payload: SafetyProfileOpenPayload) => void;
  aliasByContactId?: Record<string, string>;
}) {
  const {
    sessionUserId,
    activeRecipientId,
    onSelectRecipientId,
    language = "en",
    onlineUserIds = {},
    refreshNonce = 0,
    lowBandwidth = false,
    onOpenSafetyProfile,
    aliasByContactId = {},
  } = props;

  const [profilesById, setProfilesById] = useState<Record<string, ProfileRow>>(() => {
    if (typeof window === "undefined") return {};
    return readSidebarCache(sessionUserId)?.profilesById ?? {};
  });
  const [dmStatusByPartnerId, setDmStatusByPartnerId] = useState<
    Record<string, DmConnectionStatus | null>
  >(() => {
    if (typeof window === "undefined") return {};
    return readSidebarCache(sessionUserId)?.dmStatusByPartnerId ?? {};
  });
  const [inboxIds, setInboxIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    return readSidebarCache(sessionUserId)?.inboxIds ?? [];
  });
  const [requestIds, setRequestIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    return readSidebarCache(sessionUserId)?.requestIds ?? [];
  });
  const [loading, setLoading] = useState(() => {
    if (typeof window === "undefined") return true;
    return readSidebarCache(sessionUserId) == null;
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unreadBySender, setUnreadBySender] = useState<Record<string, number>>({});
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const hydratedFromCacheRef = useRef(readSidebarCache(sessionUserId) != null);

  const setters = {
    setProfilesById,
    setDmStatusByPartnerId,
    setInboxIds,
    setRequestIds,
  };

  useLayoutEffect(() => {
    const cached = readSidebarCache(sessionUserId);
    hydratedFromCacheRef.current = cached != null;
    if (cached) {
      applySnapshot(cached, setters);
      setLoadError(null);
      setLoading(false);
    } else {
      setLoading(true);
      setProfilesById({});
      setDmStatusByPartnerId({});
      setInboxIds([]);
      setRequestIds([]);
    }
  }, [sessionUserId]);

  const revalidatePrivacyLists = useCallback(
    async (opts?: { showLoading?: boolean }) => {
      const showLoading = opts?.showLoading ?? !hydratedFromCacheRef.current;
      if (showLoading) {
        setLoading(true);
        setLoadError(null);
      }

      const result = await fetchSidebarPrivacySnapshot(sessionUserId, language);

      if (result.ok) {
        const s = result.snapshot;
        applySnapshot(s, setters);
        setLoadError(null);
        writeJsonCache(sidebarPrivacyCacheKey(sessionUserId), s);
        hydratedFromCacheRef.current = true;
      } else {
        setLoadError(result.loadError);
        applySnapshot(result.fallbackSnapshot, setters);
      }
      setLoading(false);
    },
    [sessionUserId, language]
  );

  useEffect(() => {
    void revalidatePrivacyLists({
      showLoading: !hydratedFromCacheRef.current,
    });
  }, [revalidatePrivacyLists, refreshNonce]);

  /** Realtime “knock”: new pending dm_connection or status change → refresh Requests / Inbox. */
  useEffect(() => {
    const me = sessionUserId;
    const channel = supabase
      .channel(`sidebar-dm-${me}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "dm_connections" },
        (payload) => {
          const n = (payload.new ?? payload.old) as {
            user_low?: string;
            user_high?: string;
          } | null;
          if (!n?.user_low || !n?.user_high) return;
          if (n.user_low !== me && n.user_high !== me) return;
          void revalidatePrivacyLists({ showLoading: false });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionUserId, revalidatePrivacyLists]);

  useEffect(() => {
    const me = sessionUserId;
    const channel = supabase
      .channel(`sidebar-messages-${me}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const row = payload.new as { sender_id?: string | null; receiver_id?: string | null };
          if (row.sender_id !== me && row.receiver_id !== me) return;
          void revalidatePrivacyLists({ showLoading: false });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionUserId, revalidatePrivacyLists]);

  const handleAccept = async (otherId: string) => {
    const me = sessionUserId;
    const { user_low, user_high } = dmPairKey(me, otherId);
    setActionBusy(otherId);
    try {
      await supabase
        .from("dm_connections")
        .update({ status: "accepted", updated_at: new Date().toISOString() })
        .eq("user_low", user_low)
        .eq("user_high", user_high)
        .eq("status", "pending");
      await revalidatePrivacyLists({ showLoading: false });
      onSelectRecipientId(otherId);
    } finally {
      setActionBusy(null);
    }
  };

  const handleDecline = async (otherId: string) => {
    const me = sessionUserId;
    const { user_low, user_high } = dmPairKey(me, otherId);
    setActionBusy(otherId);
    try {
      await supabase
        .from("dm_connections")
        .update({ status: "declined", updated_at: new Date().toISOString() })
        .eq("user_low", user_low)
        .eq("user_high", user_high)
        .eq("status", "pending");
      await revalidatePrivacyLists({ showLoading: false });
    } finally {
      setActionBusy(null);
    }
  };

  useEffect(() => {
    if (!sessionUserId) return;

    let cancelled = false;

    const loadUnreadCounts = async () => {
      try {
        const { data } = await supabase
          .from("messages")
          .select("sender_id, is_read")
          .eq("receiver_id", sessionUserId)
          .eq("is_read", false);

        if (cancelled) return;

        const counts: Record<string, number> = {};
        (data ?? []).forEach((row: { sender_id?: string | null }) => {
          const senderId = row.sender_id as string | null;
          if (!senderId) return;
          counts[senderId] = (counts[senderId] ?? 0) + 1;
        });
        setUnreadBySender(counts);
      } catch {
        // non-blocking
      }
    };

    void loadUnreadCounts();

    const channel = supabase
      .channel("messages-unread-badges")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const row = payload.new as {
            sender_id?: string | null;
            receiver_id?: string | null;
            is_read?: boolean | null;
          };

          if (!row.receiver_id || row.receiver_id !== sessionUserId) return;
          if (!row.sender_id) return;
          if (Boolean(row.is_read)) return;
          if (row.sender_id === activeRecipientId) return;

          setUnreadBySender((prev) => {
            const next = { ...prev };
            next[row.sender_id as string] = (next[row.sender_id as string] ?? 0) + 1;
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [sessionUserId, activeRecipientId]);

  useEffect(() => {
    if (!activeRecipientId) return;
    setUnreadBySender((prev) => {
      if (!(activeRecipientId in prev)) return prev;
      const next = { ...prev };
      delete next[activeRecipientId];
      return next;
    });
  }, [activeRecipientId]);

  const renderUserRow = (p: ProfileRow, opts: { showRequestActions?: boolean }) => {
    const isActive = p.id === activeRecipientId;
    const isMe = p.id === sessionUserId;
    const isOnline = Boolean(onlineUserIds[p.id]);
    const lastSeenText = formatRelativeLastSeen(p.lastSeen, language);
    const unreadCount = unreadBySender[p.id] ?? 0;
    const busy = actionBusy === p.id;
    const publicName = (p.nickname && p.nickname.trim()) || "";
    const localAlias = aliasByContactId[p.id];
    const displayName = contactDisplayLabel(
      publicName,
      localAlias,
      t(language, "anonymousLabel")
    );
    const partnerDmStatus = dmStatusByPartnerId[p.id] ?? null;

    const openSafetyProfile = () => {
      onOpenSafetyProfile?.({
        target: {
          id: p.id,
          nickname: publicName,
          localAlias: localAlias ?? null,
          role: p.role,
          preferred_locale: p.preferred_locale ?? null,
          isOnline,
          lastSeen: p.lastSeen ?? null,
        },
        dmStatus: isMe ? "accepted" : partnerDmStatus,
        isSelf: isMe,
      });
    };

    return (
      <div
        key={p.id}
        className={`mb-3 rounded-2xl bg-white dark:bg-white/5 p-4 hover:bg-orange-50 dark:hover:bg-white/10 transition-all border border-orange-400/50 dark:border-none ${
          isActive ? "ring-1 ring-orange-500/30 bg-orange-50 dark:bg-white/15" : ""
        }`}
      >
        <div className="flex items-start justify-between gap-2 px-2 py-1.5 text-sm">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="min-w-0 truncate text-left text-base font-semibold underline-offset-2 hover:underline"
                style={{ color: "var(--text-primary)" }}
                onClick={openSafetyProfile}
                aria-label={`${t(language, "safetyProfileOpenProfileAria")}: ${displayName}`}
              >
                {displayName}
              </button>
            </div>
            <button
              type="button"
              className="mt-1 w-full max-w-full rounded-md py-1 text-left text-[11px] transition hover:opacity-90"
              style={{ color: "var(--text-secondary)" }}
              onClick={() => onSelectRecipientId(p.id)}
              aria-label={`${t(language, "openChatButton")} ${displayName}`}
            >
              {isOnline ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Online
                </span>
              ) : lastSeenText ? (
                lastSeenText
              ) : (
                "Offline"
              )}
            </button>
          </div>
          <span className="shrink-0 self-start pt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
            {isActive ? (
              t(language, "activeLabel")
            ) : unreadCount > 0 ? (
              unreadCount === 1 ? (
                <span
                  className={`inline-flex h-2.5 w-2.5 rounded-full ${
                    lowBandwidth ? "" : "animate-pulse"
                  }`}
                  style={{ background: "#FF4500" }}
                  aria-label="New messages"
                />
              ) : (
                <span
                  className="inline-flex min-w-5 items-center justify-center rounded-full px-1 py-0.5 text-[10px] font-bold"
                  style={{
                    background: "#FF4500",
                    color: "#000000",
                  }}
                  aria-label={`${unreadCount} new messages`}
                >
                  {unreadCount}
                </span>
              )
            ) : (
              ""
            )}
          </span>
        </div>
        {opts.showRequestActions && !isMe && (
          <div className="mt-2 flex gap-2 px-2 pb-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleAccept(p.id)}
              className="flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-black transition disabled:opacity-50"
              style={{ background: "#FF4500" }}
            >
              {t(language, "messageRequestAccept")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleDecline(p.id)}
              className="flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition disabled:opacity-50"
              style={{ background: "rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}
            >
              {t(language, "messageRequestDecline")}
            </button>
          </div>
        )}
      </div>
    );
  };

  const showSkeleton = loading && !hydratedFromCacheRef.current;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {showSkeleton ? <SkeletonDiscover rows={6} /> : null}

        {!showSkeleton && loadError ? (
          <p className="px-2 text-xs text-red-500" role="alert">
            {loadError}
          </p>
        ) : null}

        {!loading && (
          <>
            <p
              className="flex items-center gap-2 px-2 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide"
              style={{ color: "#FF4500" }}
            >
              <span>{t(language, "sidebarRequests")}</span>
              {requestIds.length > 0 ? (
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px] font-bold text-black"
                  style={{ background: "#FF4500" }}
                >
                  {t(language, "sidebarNewRequestBadge")}
                </span>
              ) : null}
            </p>
            {requestIds.length === 0 ? (
              <p className="px-2 pb-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                {t(language, "sidebarNoRequests")}
              </p>
            ) : (
              <div className="space-y-3 pb-4">
                {requestIds.map((id) => {
                  const p = profilesById[id];
                  if (!p) return null;
                  return renderUserRow(p, { showRequestActions: true });
                })}
              </div>
            )}

            <p
              className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wide"
              style={{ color: "var(--text-secondary)" }}
            >
              {t(language, "sidebarInbox")}
            </p>
            {inboxIds.length === 0 ? (
              <p className="px-2 text-sm" style={{ color: "var(--text-secondary)" }}>
                {t(language, "noMatchingUsers")}
              </p>
            ) : (
              <div className="space-y-3">
                {inboxIds.map((id) => {
                  const p = profilesById[id];
                  if (!p) return null;
                  return renderUserRow(p, { showRequestActions: false });
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export const UserDiscoverySidebar = memo(UserDiscoverySidebarInner);
