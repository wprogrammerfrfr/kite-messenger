import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { NextResponse } from "next/server";
import { cleanVapidPublicKey } from "@/lib/kite-push-client";

type SubKeys = { endpoint: string; p256dh: string; auth: string };

/** Accept flat body, nested PushSubscription JSON, or subscription as a JSON string. */
function parseSubscriptionBody(raw: unknown): SubKeys | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  let sub: unknown = o.subscription;
  if (typeof sub === "string") {
    try {
      sub = JSON.parse(sub) as unknown;
    } catch {
      return null;
    }
  }

  if (sub && typeof sub === "object") {
    const s = sub as Record<string, unknown>;
    const endpoint = typeof s.endpoint === "string" ? s.endpoint.trim() : "";
    const keys = s.keys as Record<string, unknown> | undefined;
    const p256dh = typeof keys?.p256dh === "string" ? keys.p256dh.trim() : "";
    const auth = typeof keys?.auth === "string" ? keys.auth.trim() : "";
    if (endpoint && p256dh && auth) return { endpoint, p256dh, auth };
  }

  const endpoint = typeof o.endpoint === "string" ? o.endpoint.trim() : "";
  const p256dhFlat = typeof o.p256dh === "string" ? o.p256dh.trim() : "";
  const authFlat = typeof o.auth === "string" ? o.auth.trim() : "";
  if (endpoint && p256dhFlat && authFlat) {
    return { endpoint, p256dh: p256dhFlat, auth: authFlat };
  }

  const topKeys = o.keys as Record<string, unknown> | undefined;
  const p256dh = typeof topKeys?.p256dh === "string" ? topKeys.p256dh.trim() : "";
  const auth = typeof topKeys?.auth === "string" ? topKeys.auth.trim() : "";
  if (endpoint && p256dh && auth) return { endpoint, p256dh, auth };

  return null;
}

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 503 });
    }

    const ac = createClient(url, anon);
    const {
      data: { user },
      error: userErr,
    } = await ac.auth.getUser(token);

    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let rawText: string;
    try {
      rawText = await request.text();
    } catch (readErr) {
      console.error("[push/subscribe] failed to read request body", readErr);
      return NextResponse.json({ error: "Failed to read request body" }, { status: 400 });
    }

    let parsed: unknown;
    try {
      parsed = rawText.trim() ? JSON.parse(rawText) : null;
    } catch (parseErr) {
      console.error(
        "[push/subscribe] JSON.parse failed:",
        parseErr,
        "raw (truncated):",
        rawText.slice(0, 2000)
      );
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const subKeys = parseSubscriptionBody(parsed);
    if (!subKeys) {
      return NextResponse.json({ error: "Missing subscription keys" }, { status: 400 });
    }

    const { endpoint, p256dh, auth: subscriptionAuth } = subKeys;

    const subscription = {
      endpoint,
      keys: {
        p256dh,
        auth: subscriptionAuth,
      },
    };

    const publicKey = cleanVapidPublicKey(
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""
    );
    const privateKey = cleanVapidPublicKey(process.env.VAPID_PRIVATE_KEY ?? "");
    const contact = process.env.VAPID_CONTACT_EMAIL ?? "mailto:admin@localhost";

    if (publicKey && privateKey) {
      try {
        webpush.setVapidDetails(contact, publicKey, privateKey);
      } catch (vapidErr) {
        const msg = vapidErr instanceof Error ? vapidErr.message : String(vapidErr);
        console.error("[push/subscribe] webpush.setVapidDetails failed:", msg, vapidErr);
        return NextResponse.json(
          { error: `VAPID configuration error: ${msg}` },
          { status: 500 }
        );
      }
    }

    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { error: deleteErr } = await userClient
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id)
      .eq("subscription->>endpoint", endpoint);

    if (deleteErr) {
      console.error("[push/subscribe] Supabase delete (dedupe) failed:", deleteErr.message, deleteErr);
      return NextResponse.json(
        { error: deleteErr.message ?? "Failed to update subscription" },
        { status: 500 }
      );
    }

    const { error: insertErr } = await userClient.from("push_subscriptions").insert({
      user_id: user.id,
      subscription,
    });

    if (insertErr) {
      console.error("[push/subscribe] Supabase insert failed:", insertErr.message, insertErr);
      return NextResponse.json(
        { error: insertErr.message ?? "Failed to save subscription" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[push/subscribe] unhandled error:", message, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
