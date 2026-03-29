"use client";

import Link from "next/link";
import { CircleDot } from "lucide-react";
import { motion } from "framer-motion";

/**
 * Studio lobby — entry from bottom nav (`/studio`).
 * Live WebRTC test flow remains at `/studio-bridge` until merged into this area.
 */
export default function StudioLobbyPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-950 p-6 text-white">
      <div
        className="w-full max-w-lg rounded-2xl border border-stone-800 bg-stone-900/40 p-8 shadow-2xl"
        style={{
          background:
            "radial-gradient(1200px circle at 20% -10%, rgba(255, 69, 0, 0.22), transparent 40%), radial-gradient(900px circle at 90% 0%, rgba(34, 197, 94, 0.14), transparent 45%), rgba(17, 17, 21, 0.72)",
        }}
      >
        <div className="text-center">
          <motion.div
            className="flex items-center justify-center gap-3"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          >
            <motion.span
              aria-hidden
              className="relative inline-flex"
              animate={{ scale: [1, 1.15, 1] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            >
              <CircleDot className="h-5 w-5 text-emerald-400" />
            </motion.span>
            <div className="text-xs font-semibold uppercase tracking-widest text-stone-300">Live</div>
          </motion.div>

          <h1 className="mt-4 text-3xl font-bold text-emerald-400">Kite Studio</h1>

          <motion.p
            className="mt-5 text-center text-base text-white/90 sm:text-lg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.35, ease: "easeOut" }}
          >
            Studio: Professional Collaboration, Zero Latency.
          </motion.p>

          <p className="mt-2 text-center text-sm text-stone-400">
            Coming soon. Developer tooling is available via the Test Lab link.
          </p>

          <div className="mt-10">
            <Link
              href="/studio-bridge"
              className="inline-flex w-full items-center justify-center rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm font-semibold transition hover:bg-emerald-500/20"
            >
              Test Lab
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
