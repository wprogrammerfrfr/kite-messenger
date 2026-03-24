"use client";

import { supabase } from "@/lib/supabase";
import { dmPairKey, type DmConnectionStatus } from "@/lib/dm-connections";
import { useCallback, useEffect, useState } from "react";
import { t, type Language } from "@/lib/translations";
import type { SafetyProfileOpenPayload } from "@/components/SafetyProfileModal";
import { formatRelativeLastSeen } from "@/lib/relative-last-seen";
import { contactDisplayLabel } from "@/lib/contact-display";

type Role = "musician" | "therapist" | "responder" | null;

type ProfileRow = {
  id: string;
  nickname: string | null;
  role: Role;
  lastSeen?: string | null;
  preferred_locale?: string | null;
};

type DmConnectionRow = {
  user_low: string;
  user_high: string;
  status: "pending" | "accepted" | "declined";
  initiated_by: string;
};

function otherInPair(row: DmConnectionRow, me: string): string {
  return row.user_low === me ? row.user_high : row.user_low;
}

export function UserDiscoverySidebar(props: {
  sessionUserId: string;
  activeRecipientId: string | null;
  onSelectRecipientId: (id: string) => void;
  language?: Language;
  onlineUserIds?: Record<string, boolean>;
  /** Increment from parent after sending a message to refresh inbox/requests. */
  refreshNonce?: number;
  /** Skip pulse animations (low-bandwidth / data saver). */
  lowBandwidth?: boolean;
  /** Safety profile modal (nickname / discover name). */
  onOpenSafetyProfile?: (payload: SafetyProfileOpenPayload) => void;
  /** Local display names for contacts (from `contact_aliases`). */
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

  const [profilesById, setProfilesById] = useState<Record<string, ProfileRow>>({});
  const [dmStatusByPartnerId, setDmStatusByPartnerId] = useState<
    Record<string, DmConnectionStatus | null>
  >({});
  const [inboxIds, setInboxIds] = useState<string[]>([]);
  const [requestIds, setRequestIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unreadBySender, setUnreadBySender] = useState<Record<string, number>>({});
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const loadPrivacyLists = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const me = sessionUserId;

    try {
      const { data: connRows, error: connErr } = await supabase
        .from("dm_connections")
        .select("user_low, user_high, status, initiated_by")
        .or(`user_low.eq.${me},user_high.eq.${me}`);

      if (connErr) {
        if (
          connErr.message?.includes("relation") ||
          connErr.message?.includes("does not exist") ||
          connErr.code === "42P01"
        ) {
          setLoadError(
            "Privacy tables missing. Run the SQL migration in supabase/migrations (dm_connections), then reload."
          );
          setInboxIds([me]);
          setRequestIds([]);
          setProfilesById({});
          setLoading(false);
          return;
        }
        throw connErr;
      }

      const connections = (connRows ?? []) as DmConnectionRow[];
      const connByPartner = new Map<string, DmConnectionRow>();
      for (const c of connections) {
        connByPartner.set(otherInPair(c, me), c);
      }

      const { data: msgRows, error: msgErr } = await supabase
        .from("messages")
        .select("sender_id, receiver_id")
        .or(`sender_id.eq.${me},receiver_id.eq.${me}`);

      if (msgErr) throw msgErr;

      const messagePartners = new Set<string>();
      for (const row of msgRows ?? []) {
        const s = row.sender_id as string | null;
        const r = row.receiver_id as string | null;
        if (s && r) {
          if (s === me) messagePartners.add(r);
          else if (r === me) messagePartners.add(s);
        }
      }

      const inbox = new Set<string>([me]);
      const requests = new Set<string>();

      const considerPartner = (v: string) => {
        if (!v || v === me) return;
        const conn = connByPartner.get(v);
        if (!conn) {
          if (messagePartners.has(v)) inbox.add(v);
          return;
        }
        if (conn.status === "accepted") {
          inbox.add(v);
          return;
        }
        if (conn.status === "declined") {
          return;
        }
        if (conn.status === "pending") {
          if (conn.initiated_by !== me) {
            requests.add(v);
          } else {
            inbox.add(v);
          }
        }
      };

      for (const v of Array.from(messagePartners)) considerPartner(v);
      for (const v of Array.from(connByPartner.keys())) considerPartner(v);

      requests.forEach((id) => inbox.delete(id));

      const inboxSorted = Array.from(inbox).sort((a, b) => {
        if (a === me) return -1;
        if (b === me) return 1;
        return a.localeCompare(b);
      });
      const requestSorted = Array.from(requests).sort((a, b) => a.localeCompare(b));

      const allIds = Array.from(new Set([...inboxSorted, ...requestSorted]));

      if (allIds.length === 0) {
        setProfilesById({});
        setInboxIds([me]);
        setRequestIds([]);
        setDmStatusByPartnerId({ [me]: "accepted" });
        setLoading(false);
        return;
      }

      const statusMap: Record<string, DmConnectionStatus | null> = {};
      for (const id of allIds) {
        if (id === me) {
          statusMap[id] = "accepted";
          continue;
        }
        const c = connByPartner.get(id);
        statusMap[id] = c ? c.status : null;
      }
      setDmStatusByPartnerId(statusMap);

      const { data: profRows, error: profErr } = await supabase
        .from("profiles")
        .select("id, nickname, role, lastSeen:last_seen, preferred_locale")
        .in("id", allIds);

      if (profErr) throw profErr;

      const map: Record<string, ProfileRow> = {};
      for (const p of (profRows ?? []) as ProfileRow[]) {
        map[p.id] = p;
      }

      setProfilesById(map);
      setInboxIds(inboxSorted.filter((id) => id === me || map[id]));
      setRequestIds(requestSorted.filter((id) => map[id]));
    } catch {
      setLoadError(t(language, "conversationsLoadError"));
      setInboxIds([me]);
      setRequestIds([]);
      setProfilesById({});
    } finally {
      setLoading(false);
    }
  }, [sessionUserId, language]);

  useEffect(() => {
    void loadPrivacyLists();
  }, [loadPrivacyLists, refreshNonce]);

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
          void loadPrivacyLists();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionUserId, loadPrivacyLists]);

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
      await loadPrivacyLists();
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
      await loadPrivacyLists();
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
        className="w-full rounded-lg px-2 py-2 transition-colors"
        style={{
          background: isActive ? "rgba(255, 69, 0, 0.14)" : "transparent",
          border: isActive ? "2px solid #FF4500" : "1px solid transparent",
          boxShadow: isActive ? "0 0 0 1px rgba(255, 69, 0, 0.25)" : undefined,
        }}
      >
        <div className="flex items-start justify-between gap-2 px-2 py-1.5 text-sm">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="min-w-0 truncate text-left font-medium underline-offset-2 hover:underline"
                style={{ color: "var(--text-primary)" }}
                onClick={openSafetyProfile}
                aria-label={`${t(language, "safetyProfileOpenProfileAria")}: ${displayName}`}
              >
                {displayName}
              </button>
              {isMe ? (
                <span className="shrink-0 text-xs" style={{ color: "var(--text-secondary)" }}>
                  {t(language, "youLabel")}
                </span>
              ) : null}
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
              className="flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition disabled:opacity-50"
              style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
            >
              {t(language, "messageRequestDecline")}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <p className="px-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            {t(language, "loadingUsers")}
          </p>
        ) : loadError ? (
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
              <div className="space-y-1 pb-4">
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
              <div className="space-y-1">
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
