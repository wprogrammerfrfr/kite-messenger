"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Globe } from "lucide-react";
import type { Language } from "@/lib/translations";

const ACCENT = "#FF4500";

const LANG_OPTIONS: Array<{ value: Language; label: string }> = [
  { value: "en", label: "English" },
  { value: "kr", label: "한국어 (Korean)" },
  { value: "tr", label: "Türkçe (Turkish)" },
  { value: "fa", label: "فارسی (Farsi)" },
  { value: "ar", label: "العربية (Arabic)" },
];

export function LanguageDropdown({
  value,
  onChange,
  compact = false,
}: {
  value: Language;
  onChange: (next: Language) => void;
  compact?: boolean;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={[
            "inline-flex items-center justify-center rounded-full border transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80",
            compact ? "h-9 w-9" : "h-10 w-10",
          ].join(" ")}
          style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
          aria-label="Choose language"
        >
          <Globe className={compact ? "h-4 w-4" : "h-5 w-5"} aria-hidden />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          sideOffset={8}
          align="end"
          className="z-50 min-w-[220px] rounded-xl border p-1.5 shadow-2xl backdrop-blur-md"
          style={{
            background: "rgba(10, 10, 10, 0.94)",
            borderColor: "rgba(255, 255, 255, 0.12)",
            color: "white",
          }}
        >
          {LANG_OPTIONS.map((opt) => {
            const selected = value === opt.value;
            return (
              <DropdownMenu.Item
                key={opt.value}
                onSelect={() => onChange(opt.value)}
                className="flex cursor-pointer select-none items-center justify-between rounded-lg px-3 py-2 text-sm outline-none"
                style={{
                  background: selected ? ACCENT : "transparent",
                  color: selected ? "#111111" : "white",
                }}
              >
                <span>{opt.label}</span>
                {selected ? <Check className="h-4 w-4" aria-hidden /> : null}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
