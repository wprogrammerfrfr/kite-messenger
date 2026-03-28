import { supabase } from "@/lib/supabase";
import type { DmConnectionStatus } from "@/lib/dm-connections";
import { t, type Language } from "@/lib/translations";

export type SidebarRole = "musician" | "therapist" | "responder" | null;

export type SidebarProfileRow = {
  id: string;
  nickname: string | null;
  role: SidebarRole;
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

export type SidebarPrivacySnapshot = {
  profilesById: Record<string, SidebarProfileRow>;
  dmStatusByPartnerId: Record<string, DmConnectionStatus | null>;
  inboxIds: string[];
  requestIds: string[];
};

export type FetchSidebarPrivacyResult =
  | { ok: true; snapshot: SidebarPrivacySnapshot }
  | { ok: false; loadError: string; fallbackSnapshot: SidebarPrivacySnapshot };

/**
 * Fetches inbox / requests / profiles for the chat sidebar (same logic as UserDiscoverySidebar).
 * Safe to call from prefetch handlers.
 */
export async function fetchSidebarPrivacySnapshot(
  me: string,
  language: Language
): Promise<FetchSidebarPrivacyResult> {
  const emptyFallback = (): SidebarPrivacySnapshot => ({
    profilesById: {},
    dmStatusByPartnerId: {},
    inboxIds: [],
    requestIds: [],
  });

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
        return {
          ok: false,
          loadError: t(language, "discoverPrivacyMigrationRequired"),
          fallbackSnapshot: {
            profilesById: {},
            dmStatusByPartnerId: {},
            inboxIds: [],
            requestIds: [],
          },
        };
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
      .select("sender_id, receiver_id, created_at")
      .or(`sender_id.eq.${me},receiver_id.eq.${me}`);

    if (msgErr) throw msgErr;

    const messagePartners = new Set<string>();
    const latestByPartner: Record<string, number> = {};
    for (const row of msgRows ?? []) {
      const s = row.sender_id as string | null;
      const r = row.receiver_id as string | null;
      const createdAt = Date.parse((row.created_at as string | null) ?? "");
      if (s && r) {
        const partnerId = s === me ? r : r === me ? s : null;
        if (partnerId) {
          messagePartners.add(partnerId);
          if (!Number.isNaN(createdAt)) {
            latestByPartner[partnerId] = Math.max(latestByPartner[partnerId] ?? 0, createdAt);
          }
        }
      }
    }

    const inbox = new Set<string>();
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

    const sortByRecentFirst = (a: string, b: string) => {
      const aTs = latestByPartner[a] ?? 0;
      const bTs = latestByPartner[b] ?? 0;
      if (aTs !== bTs) return bTs - aTs;
      return a.localeCompare(b);
    };

    const inboxSorted = Array.from(inbox).sort(sortByRecentFirst);
    const requestSorted = Array.from(requests).sort(sortByRecentFirst);

    const allIds = Array.from(new Set([...inboxSorted, ...requestSorted]));

    if (allIds.length === 0) {
      return {
        ok: true,
        snapshot: {
          profilesById: {},
          inboxIds: [],
          requestIds: [],
          dmStatusByPartnerId: {},
        },
      };
    }

    const statusMap: Record<string, DmConnectionStatus | null> = {};
    for (const id of allIds) {
      if (id === me) continue;
      const c = connByPartner.get(id);
      statusMap[id] = c ? c.status : null;
    }

    const profileQueryIds = allIds.filter((id) => id !== me);

    const map: Record<string, SidebarProfileRow> = {};
    if (profileQueryIds.length > 0) {
      const { data: profRows, error: profErr } = await supabase
        .from("profiles")
        .select("id, nickname, role, lastSeen:last_seen, preferred_locale")
        .in("id", profileQueryIds);

      if (profErr) throw profErr;

      for (const p of (profRows ?? []) as SidebarProfileRow[]) {
        map[p.id] = p;
      }
    }

    return {
      ok: true,
      snapshot: {
        profilesById: map,
        dmStatusByPartnerId: statusMap,
        inboxIds: inboxSorted.filter((id) => id !== me && map[id]),
        requestIds: requestSorted.filter((id) => id !== me && map[id]),
      },
    };
  } catch {
    return {
      ok: false,
      loadError: t(language, "conversationsLoadError"),
      fallbackSnapshot: emptyFallback(),
    };
  }
}
