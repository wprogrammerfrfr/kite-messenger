"use client";

import { supabase } from "@/lib/supabase";
import { dmPairKey, type DmConnectionStatus } from "@/lib/dm-connections";
import {
  fetchSidebarPrivacySnapshot,
  type SidebarPrivacySnapshot,
  type SidebarProfileRow,
} from "@/lib/fetch-sidebar-privacy";
import { readJsonCache, sidebarPrivacyCacheKey, writeJsonCache } from "@/lib/kite-tab-cache";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Language } from "@/lib/translations";

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

export type UseSidebarPrivacyDataOptions = {
  /** Called after accept succeeds and list revalidates (e.g. navigate to chat). */
  onAfterAccept?: (otherId: string) => void;
};

export function useSidebarPrivacyData(
  sessionUserId: string,
  language: Language,
  refreshNonce: number,
  options?: UseSidebarPrivacyDataOptions
) {
  const onAfterAccept = options?.onAfterAccept;

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

  const handleAccept = useCallback(
    async (otherId: string) => {
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
        onAfterAccept?.(otherId);
      } finally {
        setActionBusy(null);
      }
    },
    [sessionUserId, revalidatePrivacyLists, onAfterAccept]
  );

  const handleDecline = useCallback(
    async (otherId: string) => {
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
    },
    [sessionUserId, revalidatePrivacyLists]
  );

  const showSkeleton = loading && !hydratedFromCacheRef.current;

  return {
    profilesById,
    dmStatusByPartnerId,
    inboxIds,
    requestIds,
    loading,
    loadError,
    showSkeleton,
    revalidatePrivacyLists,
    handleAccept,
    handleDecline,
    actionBusy,
  };
}
