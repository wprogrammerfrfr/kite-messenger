import { supabase } from "@/lib/supabase";
import { fetchSidebarPrivacySnapshot } from "@/lib/fetch-sidebar-privacy";
import {
  dashboardAliasCacheKey,
  settingsProfileCacheKey,
  sidebarPrivacyCacheKey,
  writeJsonCache,
} from "@/lib/kite-tab-cache";
import type { Language } from "@/lib/translations";

type Role = "musician" | "therapist" | "responder";

/** Touch/hover prefetch: warms sidebar privacy snapshot cache. */
export function prefetchDiscoverSidebar(userId: string, language: Language = "en"): void {
  void (async () => {
    const result = await fetchSidebarPrivacySnapshot(userId, language);
    const snap =
      result.ok ? result.snapshot : result.fallbackSnapshot;
    writeJsonCache(sidebarPrivacyCacheKey(userId), snap);
  })();
}

/** Touch/hover prefetch: warms contact alias map used on Discover + Chat. */
export function prefetchDashboardAliases(userId: string): void {
  void (async () => {
    const { data, error } = await supabase
      .from("contact_aliases")
      .select("contact_id, alias")
      .eq("user_id", userId);
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
    writeJsonCache(dashboardAliasCacheKey(userId), { aliasByContactId: map });
  })();
}

/** Prefetch profile row for Settings / Profile tab (same cache as ProfileHub). */
export function prefetchSettingsProfile(userId: string): void {
  void (async () => {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("nickname, bio, emergency_contact, role, profile_picture_url")
      .eq("id", userId)
      .maybeSingle();
    if (error || !profile) return;
    const p = profile as {
      nickname: string | null;
      bio: string | null;
      emergency_contact: string | null;
      role: string | null;
      profile_picture_url: string | null;
    };
    const role: Role =
      p.role === "therapist" || p.role === "musician" || p.role === "responder"
        ? p.role
        : "musician";
    writeJsonCache(settingsProfileCacheKey(userId), {
      nickname: p.nickname ?? "",
      bio: p.bio ?? "",
      emergencyContact: p.emergency_contact ?? "",
      profilePictureUrl: p.profile_picture_url ?? "",
      role,
    });
  })();
}
