function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return view;
}

/** Subscribe this device for Web Push and store keys in Supabase (requires auth). */
export async function registerKitePushSubscription(
  accessToken: string
): Promise<{ ok: boolean; error?: string }> {
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapid || typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return { ok: false, error: "Push not configured" };
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid),
      });
    }

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
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "subscribe failed",
    };
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
