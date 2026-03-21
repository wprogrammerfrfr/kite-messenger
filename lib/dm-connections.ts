import type { SupabaseClient } from "@supabase/supabase-js";

/** Canonical pair order for dm_connections primary key (string compare on UUIDs). */
export function dmPairKey(a: string, b: string): { user_low: string; user_high: string } {
  return a < b ? { user_low: a, user_high: b } : { user_low: b, user_high: a };
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
