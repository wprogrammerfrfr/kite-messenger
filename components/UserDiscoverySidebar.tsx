"use client";

import { supabase } from "@/lib/supabase";
import { useEffect, useMemo, useState } from "react";
import { t, type Language } from "@/lib/translations";

type Role = "musician" | "therapist" | "responder" | null;

type ProfileRow = {
  id: string;
  nickname: string | null;
  role: Role;
  lastSeen?: string | null;
};

export function UserDiscoverySidebar(props: {
  sessionUserId: string;
  activeRecipientId: string | null;
  onSelectRecipientId: (id: string) => void;
  language?: Language;
  onlineUserIds?: Record<string, boolean>;
}) {
  const {
    sessionUserId,
    activeRecipientId,
    onSelectRecipientId,
    language = "en",
    onlineUserIds = {},
  } = props;

  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [unreadBySender, setUnreadBySender] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setLoadError(null);

      const { data, error } = await supabase
        .from("profiles")
        .select("id, nickname, role, lastSeen:last_seen")
        .order("nickname", { ascending: true });

      if (cancelled) return;

      if (error) {
        setLoadError(error.message ?? "Failed to load users");
        setProfiles([]);
      } else {
        setProfiles((data ?? []) as ProfileRow[]);
      }

      setLoading(false);
    };

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  // Unread notification badges: show new unread messages from each sender
  // (excluding the currently active conversation).
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
        (data ?? []).forEach((row: any) => {
          const senderId = row.sender_id as string | null;
          if (!senderId) return;
          counts[senderId] = (counts[senderId] ?? 0) + 1;
        });
        setUnreadBySender(counts);
      } catch {
        // Non-blocking: sidebar can still render.
      }
    };

    loadUnreadCounts();

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

  // When opening a conversation, clear any badge count for that sender.
  useEffect(() => {
    if (!activeRecipientId) return;
    setUnreadBySender((prev) => {
      if (!(activeRecipientId in prev)) return prev;
      const next = { ...prev };
      delete next[activeRecipientId];
      return next;
    });
  }, [activeRecipientId]);

  const formatLastSeenMinutes = (iso?: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const mins = Math.floor((Date.now() - d.getTime()) / 60000);
    const safeMins = Math.max(0, mins);
    return safeMins <= 1
      ? `Last seen 1 minute ago`
      : `Last seen ${safeMins} minutes ago`;
  };

  const visibleProfiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return profiles;

    return profiles.filter((p) => {
      const nickname = (p.nickname ?? t(language, "anonymousLabel")).toLowerCase();
      const roleLabel =
        p.role === "therapist"
          ? t(language, "roleTherapist").toLowerCase()
          : p.role === "musician"
          ? t(language, "roleMusician").toLowerCase()
          : p.role === "responder"
          ? t(language, "roleResponder").toLowerCase()
          : t(language, "roleUnknown").toLowerCase();
      return nickname.includes(q) || roleLabel.includes(q);
    });
  }, [profiles, searchQuery, language]);

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="px-2 pt-2">
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t(language, "discoverUsersPlaceholder")}
          className="w-full rounded-xl border px-3 py-2 text-sm outline-none"
          style={{
            background: "var(--input-bg)",
            borderColor: "var(--border)",
            color: "var(--text-primary)",
          }}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <p className="px-2 py-3 text-sm" style={{ color: "var(--text-secondary)" }}>
          {t(language, "usersLabel")}
        </p>

        {loading ? (
          <p className="px-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            {t(language, "loadingUsers")}
          </p>
        ) : loadError ? (
          <p className="px-2 text-sm text-red-500" role="alert">
            {loadError}
          </p>
        ) : visibleProfiles.length === 0 ? (
          <p className="px-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            {t(language, "noMatchingUsers")}
          </p>
        ) : (
          <div className="space-y-1">
            {visibleProfiles.map((p) => {
              const isActive = p.id === activeRecipientId;
              const isMe = p.id === sessionUserId;
              const isOnline = Boolean(onlineUserIds[p.id]);
              const lastSeenText = formatLastSeenMinutes(p.lastSeen);
              const unreadCount = unreadBySender[p.id] ?? 0;
              const roleLabel =
                p.role === "musician"
                  ? t(language, "roleMusician")
                  : p.role === "therapist"
                  ? t(language, "roleTherapist")
                  : p.role === "responder"
                  ? t(language, "roleResponder")
                  : t(language, "roleUnknown");

              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSelectRecipientId(p.id)}
                  className="w-full rounded-lg px-3 py-2.5 text-left text-sm transition-colors"
                  style={{
                    background: isActive ? "var(--panel-bg)" : "transparent",
                    color: "var(--text-primary)",
                    border: isActive ? "1px solid var(--border)" : "1px solid transparent",
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {(p.nickname && p.nickname.trim()) || t(language, "anonymousLabel")}
                        {isMe && (
                          <span className="ml-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                            {t(language, "youLabel")}
                          </span>
                        )}
                      </p>
                      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                        {roleLabel}
                      </p>
                      <p className="mt-1 text-[11px]" style={{ color: "var(--text-secondary)" }}>
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
                      </p>
                    </div>
                    <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      {isActive ? (
                        t(language, "activeLabel")
                      ) : unreadCount > 0 ? (
                        unreadCount === 1 ? (
                          <span
                            className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full"
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
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

