"use server";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Resolves the public origin used to call /api/push/dispatch from the server.
 * Set NEXT_PUBLIC_APP_URL in production if VERCEL_URL is not available.
 */
function resolveInternalAppOrigin(): string | null {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (explicit) return explicit;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NODE_ENV !== "production") return "http://127.0.0.1:3000";
  return null;
}

/**
 * After a successful outgoing message insert, notifies the recipient via Web Push.
 * Verifies the row exists, was sent by the current user, and is not a self-thread.
 * Never throws — failures are swallowed so chat UX stays fast.
 */
export async function dispatchPushAfterOutgoingMessage(
  messageId: string,
  options?: { title?: string; body?: string }
): Promise<void> {
  const secret = process.env.PUSH_DISPATCH_SECRET;
  const origin = resolveInternalAppOrigin();
  if (!secret || !origin) return;

  let messageIdTrimmed = typeof messageId === "string" ? messageId.trim() : "";
  if (!messageIdTrimmed) return;

  try {
    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set(name: string, value: string, cookieOptions: CookieOptions) {
            try {
              cookieStore.set({ name, value, ...cookieOptions });
            } catch {
              /* ignore */
            }
          },
          remove(name: string, cookieOptions: CookieOptions) {
            try {
              cookieStore.set({ name, value: "", ...cookieOptions });
            } catch {
              /* ignore */
            }
          },
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) return;

    const { data: row, error } = await supabase
      .from("messages")
      .select("sender_id, receiver_id")
      .eq("id", messageIdTrimmed)
      .maybeSingle();

    if (error || !row) return;
    const senderId = row.sender_id as string | null;
    const receiverId = row.receiver_id as string | null;
    if (!senderId || !receiverId || senderId !== user.id) return;
    if (receiverId === senderId) return;

    const title =
      typeof options?.title === "string" && options.title.trim()
        ? options.title.trim()
        : "Kite";
    const body =
      typeof options?.body === "string" && options.body.trim()
        ? options.body.trim()
        : "New message";

    await fetch(`${origin}/api/push/dispatch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        receiverUserId: receiverId,
        title,
        body,
      }),
    });
  } catch {
    // Best-effort only; do not surface to the client.
  }
}
