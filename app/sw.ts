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

serwist.addEventListeners();
