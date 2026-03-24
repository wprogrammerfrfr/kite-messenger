import type { SupabaseClient } from "@supabase/supabase-js";

export type ProfileLookupRow = {
  id: string;
  nickname: string | null;
  role: string | null;
  lastSeen: string | null;
  preferred_locale: string | null;
};

/** Exact nickname match, or profiles.email when query looks like an email (same as sidebar discover). */
export async function findProfileByDiscoverQuery(
  supabase: SupabaseClient,
  me: string,
  rawQuery: string
): Promise<ProfileLookupRow | null> {
  const q = rawQuery.trim();
  if (!q) return null;

  const { data: byNick } = await supabase
    .from("profiles")
    .select("id, nickname, role, lastSeen:last_seen, preferred_locale")
    .eq("nickname", q)
    .neq("id", me)
    .maybeSingle();

  let found: ProfileLookupRow | null = (byNick as ProfileLookupRow | null) ?? null;

  if (!found && q.includes("@")) {
    const { data: byEmail, error: emailErr } = await supabase
      .from("profiles")
      .select("id, nickname, role, lastSeen:last_seen, preferred_locale")
      .eq("email", q)
      .neq("id", me)
      .maybeSingle();
    if (!emailErr && byEmail) {
      found = byEmail as ProfileLookupRow;
    }
  }

  return found;
}
