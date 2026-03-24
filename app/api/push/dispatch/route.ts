import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { NextResponse } from "next/server";

/**
 * Sends a Web Push notification to all subscriptions for a user.
 * Protect with PUSH_DISPATCH_SECRET — call from a trusted worker (e.g. Supabase Database Webhook)
 * when a new `messages` row is inserted, with body: { receiverUserId, title, body }.
 */
export async function POST(request: Request) {
  const secret = process.env.PUSH_DISPATCH_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "PUSH_DISPATCH_SECRET is not configured." },
      { status: 503 }
    );
  }

  const authz = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (authz !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const contact = process.env.VAPID_CONTACT_EMAIL ?? "mailto:admin@localhost";

  if (!serviceKey || !url || !publicKey || !privateKey) {
    return NextResponse.json({ error: "Server misconfigured for push" }, { status: 503 });
  }

  let payload: { receiverUserId?: string; title?: string; body?: string };
  try {
    payload = (await request.json()) as {
      receiverUserId?: string;
      title?: string;
      body?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const receiverUserId =
    typeof payload.receiverUserId === "string" ? payload.receiverUserId.trim() : "";
  if (!receiverUserId) {
    return NextResponse.json({ error: "receiverUserId required" }, { status: 400 });
  }

  const title = typeof payload.title === "string" ? payload.title : "Kite";
  const bodyText = typeof payload.body === "string" ? payload.body : "New message";

  webpush.setVapidDetails(contact, publicKey, privateKey);

  const admin = createClient(url, serviceKey);
  const { data: rows, error: selErr } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", receiverUserId);

  if (selErr) {
    return NextResponse.json({ error: selErr.message }, { status: 500 });
  }

  const pushPayload = JSON.stringify({ title, body: bodyText });
  let sent = 0;

  for (const row of rows ?? []) {
    const endpoint = row.endpoint as string;
    const p256dh = row.p256dh as string;
    const auth = row.auth as string;
    try {
      await webpush.sendNotification(
        { endpoint, keys: { p256dh, auth } },
        pushPayload,
        { TTL: 60 * 60 }
      );
      sent += 1;
    } catch {
      await admin.from("push_subscriptions").delete().eq("id", row.id as string);
    }
  }

  return NextResponse.json({ ok: true, sent });
}
