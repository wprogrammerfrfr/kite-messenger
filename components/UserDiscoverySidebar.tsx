"use client";

import { supabase } from "@/lib/supabase";
import { useSidebarPrivacyData } from "@/lib/use-sidebar-privacy-data";
import { useEffect, useState, memo } from "react";
import { t, type Language } from "@/lib/translations";
import type { SafetyProfileOpenPayload } from "@/components/SafetyProfileModal";
import { formatRelativeLastSeen } from "@/lib/relative-last-seen";
import { contactDisplayLabel } from "@/lib/contact-display";
import { SkeletonDiscover } from "@/components/SkeletonDiscover";
import type { SidebarProfileRow } from "@/lib/fetch-sidebar-privacy";

type ProfileRow = SidebarProfileRow;

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

  const {
    profilesById,
    dmStatusByPartnerId,
    inboxIds,
    loadError,
    showSkeleton,
  } = useSidebarPrivacyData(sessionUserId, language, refreshNonce);

  const [unreadBySender, setUnreadBySender] = useState<Record<string, number>>({});

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

  const renderUserRow = (p: ProfileRow) => {
    const isActive = p.id === activeRecipientId;
    const isMe = p.id === sessionUserId;
    const isOnline = Boolean(onlineUserIds[p.id]);
    const lastSeenText = formatRelativeLastSeen(p.lastSeen, language);
    const unreadCount = unreadBySender[p.id] ?? 0;
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
                  {t(language, "safetyProfileBadgeOnline")}
                </span>
              ) : lastSeenText ? (
                lastSeenText
              ) : (
                t(language, "safetyProfileBadgeOffline")
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
                  aria-label={t(language, "chatInboxNewMessagesAria")}
                />
              ) : (
                <span
                  className="inline-flex min-w-5 items-center justify-center rounded-full px-1 py-0.5 text-[10px] font-bold"
                  style={{
                    background: "#FF4500",
                    color: "#000000",
                  }}
                  aria-label={t(language, "chatInboxNewMessagesCountAria").replace(
                    "{{n}}",
                    String(unreadCount)
                  )}
                >
                  {unreadCount}
                </span>
              )
            ) : (
              ""
            )}
          </span>
        </div>
      </div>
    );
  };

  const visibleInboxIds = inboxIds.filter((id) => id !== sessionUserId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {showSkeleton ? <SkeletonDiscover rows={6} /> : null}

        {!showSkeleton && loadError ? (
          <p className="px-2 text-xs text-red-500" role="alert">
            {loadError}
          </p>
        ) : null}

        {!showSkeleton && (
          <>
            <p
              className="px-2 pb-1 pt-1 text-[11px] font-bold uppercase tracking-wide"
              style={{ color: "var(--text-secondary)" }}
            >
              {t(language, "sidebarInbox")}
            </p>
            {visibleInboxIds.length === 0 ? (
              <p className="px-2 text-sm" style={{ color: "var(--text-secondary)" }}>
                {t(language, "noMatchingUsers")}
              </p>
            ) : (
              <div className="space-y-3">
                {visibleInboxIds.map((id) => {
                  const p = profilesById[id];
                  if (!p) return null;
                  return renderUserRow(p);
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
