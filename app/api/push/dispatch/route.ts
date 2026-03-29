import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { NextResponse } from "next/server";
import { cleanVapidPublicKey } from "@/lib/kite-push-client";

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
  const publicKey = cleanVapidPublicKey(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""
  );
  const privateKey = cleanVapidPublicKey(process.env.VAPID_PRIVATE_KEY ?? "");
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
    .select("id, subscription")
    .eq("user_id", receiverUserId);

  if (selErr) {
    return NextResponse.json({ error: selErr.message }, { status: 500 });
  }

  const pushPayload = JSON.stringify({ title, body: bodyText });
  let sent = 0;

  for (const row of rows ?? []) {
    const sub = row.subscription as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    } | null;
    const endpoint = sub?.endpoint;
    const p256dh = sub?.keys?.p256dh;
    const authSecret = sub?.keys?.auth;
    if (!endpoint || !p256dh || !authSecret) continue;
    try {
      await webpush.sendNotification(
        { endpoint, keys: { p256dh, auth: authSecret } },
        pushPayload,
        { TTL: 60 * 60 }
      );
      sent += 1;
    } catch (err: unknown) {
      const statusCode =
        err &&
        typeof err === "object" &&
        "statusCode" in err &&
        typeof (err as { statusCode: unknown }).statusCode === "number"
          ? (err as { statusCode: number }).statusCode
          : null;
      if (statusCode === 410 || statusCode === 401) {
        await admin.from("push_subscriptions").delete().eq("id", row.id as string);
      }
    }
  }

  return NextResponse.json({ ok: true, sent });
}
