/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import {
  Serwist,
  NetworkFirst,
  CacheFirst,
  CacheableResponsePlugin,
  ExpirationPlugin,
  NetworkOnly,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const staticCache = new CacheFirst({
  cacheName: "kite-static-assets",
  plugins: [
    new ExpirationPlugin({
      maxEntries: 120,
      maxAgeSeconds: 60 * 60 * 24 * 30,
    }),
  ],
});

// Loopstation document shell: online first, cached copy for offline solo mode.
// Only 200s are stored so an auth redirect to /signin is never replayed offline.
const studioShellCache = new NetworkFirst({
  cacheName: "kite-studio-shell",
  networkTimeoutSeconds: 3,
  plugins: [
    new CacheableResponsePlugin({ statuses: [200] }),
    {
      cacheKeyWillBeUsed: async ({ request }) => {
        const url = new URL(request.url);
        url.search = "";
        url.hash = "";
        return url.href;
      },
    },
    new ExpirationPlugin({
      maxEntries: 4,
      maxAgeSeconds: 60 * 60 * 24 * 30,
    }),
  ],
});

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ url }) =>
        url.hostname.endsWith(".supabase.co") ||
        url.hostname.endsWith(".supabase.in") ||
        url.pathname.includes("/rest/v1/") ||
        url.pathname.includes("/realtime/"),
      handler: new NetworkOnly(),
    },
    {
      matcher: ({ url, request }) =>
        url.pathname.startsWith("/studio-bridge") && request.mode === "navigate",
      handler: studioShellCache,
    },
    {
      // RSC fetches fail offline and Next falls back to a hard navigation (served above).
      matcher: ({ url }) => url.pathname.includes("/studio-bridge"),
      handler: new NetworkOnly(),
    },
    {
      matcher: ({ url, request, sameOrigin }) =>
        sameOrigin &&
        !url.pathname.startsWith("/worklets/") &&
        (request.destination === "script" ||
          request.destination === "style" ||
          request.destination === "font"),
      handler: staticCache,
    },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

self.addEventListener("push", (event: PushEvent) => {
  let data: { title?: string; body?: string } = {};
  try {
    if (event.data) {
      data = event.data.json() as { title?: string; body?: string };
      console.log("SW: Push received", data);
    } else {
      console.log("SW: Push received (no payload)");
    }
  } catch (e) {
    console.log("SW: Push received (JSON parse error)", e);
  }
  const title = typeof data.title === "string" ? data.title : "Kite";
  const body = typeof data.body === "string" ? data.body : "New message";
  const notificationOptions: NotificationOptions & {
    renotify?: boolean;
    vibrate?: number[];
    actions?: ReadonlyArray<{ action: string; title: string }>;
  } = {
    body,
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    tag: "kite-message",
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 200],
    actions: [{ action: "open", title: "View Message" }],
  };
  console.log("SW: Showing notification", title, notificationOptions);
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, notificationOptions);
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({ type: "kite-push-message", title, body });
      }
    })()
  );
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("/");
    })
  );
});

serwist.addEventListeners();
