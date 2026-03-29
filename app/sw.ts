/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import {
  Serwist,
  NetworkFirst,
  CacheFirst,
  ExpirationPlugin,
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

/** Supabase REST, Realtime, Auth — prefer network; fall back when offline. */
const supabaseNetworkFirst = new NetworkFirst({
  cacheName: "kite-supabase-network-first",
  networkTimeoutSeconds: 25,
  plugins: [
    new ExpirationPlugin({
      maxEntries: 80,
      maxAgeSeconds: 60 * 10,
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
        /supabase\.co$/i.test(url.hostname) ||
        url.pathname.includes("/rest/v1/") ||
        url.pathname.includes("/realtime/"),
      handler: supabaseNetworkFirst,
    },
    {
      matcher: ({ request, sameOrigin }) =>
        sameOrigin &&
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
  const notificationOptions: NotificationOptions & { vibrate?: number[] } = {
    body,
    icon: "/kite-mobile-icon.png",
    badge: "/icons/icon-192x192.png",
    tag: "kite-message",
    vibrate: [200, 100, 200],
  };
  console.log("SW: Showing notification", title, notificationOptions);
  event.waitUntil(self.registration.showNotification(title, notificationOptions));
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("/chat");
    })
  );
});

serwist.addEventListeners();
