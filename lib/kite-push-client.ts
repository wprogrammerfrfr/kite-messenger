/** Strip whitespace/newlines from env-injected Base64 URL keys. */
export function cleanVapidPublicKey(raw: string): string {
  return raw.replace(/\s+/g, "").trim();
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const cleaned = cleanVapidPublicKey(base64String);
  const padding = "=".repeat((4 - (cleaned.length % 4)) % 4);
  const base64 = (cleaned + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return view;
}

function uint8ArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function bufferSourceToUint8Array(buf: BufferSource): Uint8Array {
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** True if the live subscription was created with the same VAPID public key. */
function subscriptionMatchesVapidKey(
  sub: PushSubscription,
  vapidClean: string
): boolean {
  const serverKey = sub.options?.applicationServerKey;
  if (!serverKey) return false;
  const existing = bufferSourceToUint8Array(serverKey);
  const expected = urlBase64ToUint8Array(vapidClean);
  return uint8ArraysEqual(existing, expected);
}

async function postSubscriptionToServer(
  accessToken: string,
  sub: PushSubscription
): Promise<{ ok: boolean; error?: string }> {
  const json = sub.toJSON();
  const endpoint = json.endpoint;
  const key = json.keys;
  if (!endpoint || !key?.p256dh || !key?.auth) {
    return { ok: false, error: "Invalid subscription" };
  }

  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      endpoint,
      p256dh: key.p256dh,
      auth: key.auth,
    }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? res.statusText };
  }
  return { ok: true };
}

/** Subscribe this device for Web Push and store keys in Supabase (requires auth). */
export async function registerKitePushSubscription(
  accessToken: string
): Promise<{ ok: boolean; error?: string }> {
  const rawVapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidClean = rawVapid ? cleanVapidPublicKey(rawVapid) : "";
  if (!vapidClean || typeof window === "undefined" || !("serviceWorker" in navigator)) {
    const err = !vapidClean ? "Push not configured (missing VAPID key)" : "Push not configured";
    console.warn("[Kite Push]", err);
    return { ok: false, error: err };
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();

    if (sub && !subscriptionMatchesVapidKey(sub, vapidClean)) {
      console.warn(
        "[Kite Push] VAPID key changed or mismatch — removing old subscription and re-subscribing"
      );
      const oldEndpoint = sub.endpoint;
      await removeKitePushFromServer(accessToken, oldEndpoint);
      await sub.unsubscribe();
      sub = null;
    }

    const appServerKey = urlBase64ToUint8Array(vapidClean) as BufferSource;

    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey,
      });
    }

    let posted = await postSubscriptionToServer(accessToken, sub);
    if (!posted.ok) {
      console.warn(
        "[Kite Push] Server rejected subscription, forcing fresh subscribe:",
        posted.error
      );
      const staleEndpoint = sub.endpoint;
      await removeKitePushFromServer(accessToken, staleEndpoint);
      await sub.unsubscribe();
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey,
      });
      posted = await postSubscriptionToServer(accessToken, sub);
    }

    if (!posted.ok) {
      console.error("[Kite Push] Failed after re-subscribe:", posted.error);
      return { ok: false, error: posted.error ?? "subscribe failed" };
    }

    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "subscribe failed";
    console.error("[Kite Push]", msg, e);
    return { ok: false, error: msg };
  }
}

export async function unsubscribeKitePushOnDevice(): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    await sub?.unsubscribe();
  } catch {
    // ignore
  }
}

export async function removeKitePushFromServer(
  accessToken: string,
  endpoint?: string | null
): Promise<void> {
  try {
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ endpoint: endpoint ?? null }),
    });
  } catch {
    // ignore
  }
}
