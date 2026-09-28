import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import withSerwistInit from "@serwist/next";

const revision =
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.BUILD_ID ??
  `kite-${Date.now()}`;

// AudioWorklet modules load via addModule(), outside the Next build manifest — precache them
// so the solo loopstation boots offline. Content-hash revisions only bust when a worklet changes.
const workletDir = path.join(process.cwd(), "public", "worklets");
const workletPrecacheEntries = readdirSync(workletDir)
  .filter((file) => file.endsWith(".js"))
  .map((file) => ({
    url: `/worklets/${file}`,
    revision: createHash("sha256")
      .update(readFileSync(path.join(workletDir, file)))
      .digest("hex")
      .slice(0, 16),
  }));

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  cacheOnNavigation: true,
  register: true,
  // A reconnect must never reload the page mid-session (would drop loops and an active take).
  reloadOnOnline: false,
  additionalPrecacheEntries: [{ url: "/~offline", revision }, ...workletPrecacheEntries],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [{ source: "/studio-test", destination: "/studio", permanent: true }];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lwyovuyhbqvphdgsgefd.supabase.co",
        port: "",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default withSerwist(nextConfig);
