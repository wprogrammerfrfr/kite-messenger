"use client";

import Image from "next/image";
import Link from "next/link";

const ORANGE = "#FF4500";
const INK = "#050506";
const PAPER = "#F5F1E8";
const MUTE = "#9A9AA2";

const displayFont = "'Sora', system-ui, sans-serif";
const monoFont = "'DM Mono', 'IBM Plex Mono', monospace";

export function BrandMark() {
  return (
    <div className="flex items-center gap-2">
      <Image
        src="/kite-mobile-icon.svg"
        width={32}
        height={32}
        alt=""
        aria-hidden
        style={{ flexShrink: 0 }}
      />
      <span
        className="text-lg font-bold tracking-tight"
        style={{ fontFamily: displayFont, color: PAPER }}
      >
        Kite<span style={{ color: ORANGE }}>Studio</span>
      </span>
    </div>
  );
}

type KiteStudioLandingFooterProps = {
  privacyPage?: boolean;
};

export function KiteStudioLandingFooter({ privacyPage = false }: KiteStudioLandingFooterProps) {
  return (
    <footer className="px-6 py-14 border-t" style={{ borderColor: "rgba(255,255,255,0.08)", background: INK }}>
      <div className="max-w-7xl mx-auto">
        <div>
          <BrandMark />
          <p style={{ fontFamily: displayFont, color: MUTE, fontSize: 13, marginTop: 8, maxWidth: 280 }}>
            The browser-based loopstation and P2P jam platform. Fly with Kite Studio.
          </p>
          <p style={{ fontFamily: monoFont, color: MUTE, fontSize: 12, marginTop: 12 }}>supportkite@gmail.com</p>
        </div>
      </div>
      <div
        className="max-w-7xl mx-auto mt-10 pt-6 border-t text-xs flex flex-wrap items-center gap-x-2 gap-y-1"
        style={{ borderColor: "rgba(255,255,255,0.06)", fontFamily: monoFont, color: "#5a5a60" }}
      >
        <span>
          © {new Date().getFullYear()} Kite Studio. Session media is peer-to-peer and never stored on our servers.
        </span>
        <span aria-hidden>·</span>
        {privacyPage ? (
          <span aria-current="page">Privacy Policy</span>
        ) : (
          <Link
            href="/privacy"
            className="transition-colors hover:text-[#FF7A45]"
            style={{ color: "inherit", textDecoration: "none" }}
          >
            Privacy Policy
          </Link>
        )}
      </div>
    </footer>
  );
}
