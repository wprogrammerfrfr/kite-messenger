"use client";

import { Download } from "lucide-react";
import { t, type Language } from "@/lib/translations";
import { useInstallPromptOptional } from "@/components/install-prompt-provider";

const ACCENT = "#FF4500";

type Variant = "prominent" | "compact";

export function InstallKiteButton({
  language,
  variant = "prominent",
  className = "",
}: {
  language: Language;
  variant?: Variant;
  className?: string;
}) {
  const ctx = useInstallPromptOptional();

  if (!ctx?.canInstall) {
    return null;
  }

  const { requestInstall } = ctx;
  const label = t(language, "installKiteForOffline");

  const isProminent = variant === "prominent";

  return (
    <button
      type="button"
      onClick={() => void requestInstall()}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl font-bold text-white transition hover:opacity-95 active:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black",
        isProminent
          ? "w-full min-h-[52px] px-5 py-3.5 text-base sm:text-lg"
          : "w-full sm:w-auto min-h-[44px] px-4 py-2.5 text-sm",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ background: ACCENT }}
      aria-label={label}
    >
      <Download
        className={isProminent ? "h-5 w-5 shrink-0" : "h-4 w-4 shrink-0"}
        strokeWidth={2.5}
        aria-hidden
      />
      <span>{label}</span>
    </button>
  );
}
