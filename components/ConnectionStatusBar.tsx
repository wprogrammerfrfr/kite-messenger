"use client";

import { t, type Language } from "@/lib/translations";

type Props = {
  language: Language;
  isOnline: boolean;
  /** Slow network from Navigator (2G / save-data), not Support Mode alone. */
  isConnectionSlow: boolean;
};

export function ConnectionStatusBar({ language, isOnline, isConnectionSlow }: Props) {
  let bg = "rgba(22, 163, 74, 0.92)";
  let label = t(language, "connectionBarConnected");
  let sub: string | null = null;

  if (!isOnline) {
    bg = "rgba(185, 28, 28, 0.92)";
    label = t(language, "connectionBarOffline");
    sub = t(language, "connectionBarOfflineSub");
  } else if (isConnectionSlow) {
    bg = "rgba(202, 138, 4, 0.94)";
    label = t(language, "connectionBarWeak");
    sub = t(language, "connectionBarWeakSub");
  }

  return (
    <div
      className="z-[60] flex shrink-0 items-center justify-center gap-2 px-3 py-1.5 text-center text-[11px] font-semibold leading-snug text-white shadow-sm sm:text-xs"
      style={{ background: bg }}
      role="status"
    >
      <span>{label}</span>
      {sub ? <span className="hidden opacity-90 sm:inline">· {sub}</span> : null}
    </div>
  );
}
