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

/** Strip padding for base64url compare (env keys may omit `=`). */
function normalizeVapidBase64Url(s: string): string {
  return cleanVapidPublicKey(s).replace(/=+$/, "");
}

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    const end = Math.min(i + chunk, bytes.length);
    for (let j = i; j < end; j++) {
      binary += String.fromCharCode(bytes[j]!);
    }
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * True when the subscription's applicationServerKey matches NEXT_PUBLIC_VAPID_PUBLIC_KEY
 * (byte-equal after decode, or normalized base64url-identical).
 */
function subscriptionApplicationServerKeyMatchesEnv(
  sub: PushSubscription,
  vapidClean: string
): boolean {
  const serverKey = sub.options?.applicationServerKey;
  if (!serverKey || !vapidClean) return false;
  const existing = bufferSourceToUint8Array(serverKey);
  let expected: Uint8Array;
  try {
    expected = urlBase64ToUint8Array(vapidClean);
  } catch {
    return false;
  }
  if (uint8ArraysEqual(existing, expected)) return true;
  return (
    normalizeVapidBase64Url(uint8ArrayToBase64Url(existing)) ===
    normalizeVapidBase64Url(vapidClean)
  );
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

    if (sub && !subscriptionApplicationServerKeyMatchesEnv(sub, vapidClean)) {
      console.warn(
        "[Kite Push] applicationServerKey ≠ NEXT_PUBLIC_VAPID_PUBLIC_KEY — unsubscribing for fresh subscribe"
      );
      const stale = await reg.pushManager.getSubscription();
      if (stale) {
        await removeKitePushFromServer(accessToken, stale.endpoint);
        await stale.unsubscribe();
      }
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

/** Unregister every service worker for this origin (e.g. after clearing push state). */
export async function unregisterAllKiteServiceWorkers(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
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
