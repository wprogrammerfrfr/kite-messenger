import type { SupabaseClient } from "@supabase/supabase-js";

export type DmConnectionStatus = "pending" | "accepted" | "declined";

/** Canonical pair order for dm_connections primary key (string compare on UUIDs). */
export function dmPairKey(a: string, b: string): { user_low: string; user_high: string } {
  return a < b ? { user_low: a, user_high: b } : { user_low: b, user_high: a };
}

/** Row for the pair, or null if no dm_connections row yet. */
export async function fetchDmConnectionForPair(
  supabase: SupabaseClient,
  userA: string,
  userB: string
): Promise<{ status: DmConnectionStatus; initiated_by: string } | null> {
  if (userA === userB) {
    return { status: "accepted", initiated_by: userA };
  }
  const { user_low, user_high } = dmPairKey(userA, userB);
  const { data, error } = await supabase
    .from("dm_connections")
    .select("status, initiated_by")
    .eq("user_low", user_low)
    .eq("user_high", user_high)
    .maybeSingle();

  if (error || !data) return null;
  return {
    status: data.status as DmConnectionStatus,
    initiated_by: data.initiated_by as string,
  };
}

export async function acceptDmConnection(
  supabase: SupabaseClient,
  me: string,
  otherUserId: string
): Promise<{ error: Error | null }> {
  const { user_low, user_high } = dmPairKey(me, otherUserId);
  const { error } = await supabase
    .from("dm_connections")
    .update({ status: "accepted", updated_at: new Date().toISOString() })
    .eq("user_low", user_low)
    .eq("user_high", user_high)
    .eq("status", "pending");
  return { error: error ? new Error(error.message) : null };
}

export async function declineDmConnection(
  supabase: SupabaseClient,
  me: string,
  otherUserId: string
): Promise<{ error: Error | null }> {
  const { user_low, user_high } = dmPairKey(me, otherUserId);
  const { error } = await supabase
    .from("dm_connections")
    .update({ status: "declined", updated_at: new Date().toISOString() })
    .eq("user_low", user_low)
    .eq("user_high", user_high)
    .eq("status", "pending");
  return { error: error ? new Error(error.message) : null };
}

/**
 * Create (or revive) a pending DM request before opening chat — used from Discover search.
 * Idempotent if already pending/accepted for this pair from the sender’s perspective.
 */
export async function createPendingDmRequest(
  supabase: SupabaseClient,
  me: string,
  otherUserId: string
): Promise<{ ok: boolean; errorMessage?: string }> {
  if (me === otherUserId) {
    return { ok: false, errorMessage: "Invalid recipient" };
  }

  const { user_low, user_high } = dmPairKey(me, otherUserId);

  const { data: row, error: selErr } = await supabase
    .from("dm_connections")
    .select("status")
    .eq("user_low", user_low)
    .eq("user_high", user_high)
    .maybeSingle();

  if (selErr) {
    return { ok: false, errorMessage: selErr.message };
  }

  if (!row) {
    const { error } = await supabase.from("dm_connections").insert({
      user_low,
      user_high,
      status: "pending",
      initiated_by: me,
    });
    return error ? { ok: false, errorMessage: error.message } : { ok: true };
  }

  if (row.status === "accepted" || row.status === "pending") {
    return { ok: true };
  }

  if (row.status === "declined") {
    const { error } = await supabase
      .from("dm_connections")
      .update({
        status: "pending",
        initiated_by: me,
        updated_at: new Date().toISOString(),
      })
      .eq("user_low", user_low)
      .eq("user_high", user_high);
    return error ? { ok: false, errorMessage: error.message } : { ok: true };
  }

  return { ok: true };
}

/**
 * After a message is sent, ensure a dm_connections row exists for this pair.
 * New pairs start as pending; initiator is the sender.
 */
export async function ensureDmConnectionAfterSend(
  supabase: SupabaseClient,
  senderId: string,
  receiverId: string
): Promise<void> {
  if (senderId === receiverId) return;

  const { user_low, user_high } = dmPairKey(senderId, receiverId);

  const { data: row, error: selErr } = await supabase
    .from("dm_connections")
    .select("status")
    .eq("user_low", user_low)
    .eq("user_high", user_high)
    .maybeSingle();

  if (selErr) {
    console.warn("dm_connections select:", selErr.message);
    return;
  }

  if (!row) {
    const { error } = await supabase.from("dm_connections").insert({
      user_low,
      user_high,
      status: "pending",
      initiated_by: senderId,
    });
    if (error) console.warn("dm_connections insert:", error.message);
    return;
  }

  if (row.status === "declined") {
    const { error } = await supabase
      .from("dm_connections")
      .update({
        status: "pending",
        initiated_by: senderId,
        updated_at: new Date().toISOString(),
      })
      .eq("user_low", user_low)
      .eq("user_high", user_high);
    if (error) console.warn("dm_connections revive:", error.message);
  }
}
