"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { KeyRound, X } from "lucide-react";
import { t, type Language } from "@/lib/translations";
import type { E2eConnectPhoneModalTheme } from "@/components/E2eConnectPhoneModal";

const DEFAULT_THEME: E2eConnectPhoneModalTheme = {
  panelBg: "rgba(14, 14, 18, 0.98)",
  border: "rgba(255, 69, 0, 0.35)",
  accent: "#FF4500",
  textPrimary: "rgba(255, 255, 255, 0.95)",
  textSecondary: "rgba(255, 255, 255, 0.6)",
  inputBg: "rgba(20, 20, 24, 0.95)",
};

export type E2ePinRestoreModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  language: Language;
  /** Parent sets true while decrypting / applying keys. */
  busy: boolean;
  /** Server/decrypt failure (e.g. wrong PIN); cleared by parent when appropriate. */
  errorMessage: string | null;
  /** Called with a validated 6-digit PIN; parent runs async restore and updates busy/error. */
  onSubmit: (pin: string) => void;
  theme?: E2eConnectPhoneModalTheme;
};

export function E2ePinRestoreModal({
  open,
  onOpenChange,
  language,
  busy,
  errorMessage,
  onSubmit,
  theme: themeProp,
}: E2ePinRestoreModalProps) {
  const titleId = useId();
  const theme = themeProp ?? DEFAULT_THEME;
  const [pin, setPin] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const isRtl = language === "fa" || language === "ar";
  const displayError = errorMessage ?? localError;

  useEffect(() => {
    if (!open) {
      setPin("");
      setLocalError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  const handleClose = () => {
    if (busy) return;
    onOpenChange(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    const digits = pin.trim();
    if (!/^\d{6}$/.test(digits)) {
      setLocalError(t(language, "e2ePinVaultErrorInvalidPin"));
      return;
    }

    onSubmit(digits);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        aria-label={t(language, "e2eRestoreCancel")}
        onClick={handleClose}
        disabled={busy}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
        dir={isRtl ? "rtl" : "ltr"}
        className="relative z-[101] flex max-h-[min(90dvh,560px)] w-full max-w-md flex-col rounded-t-2xl border p-5 shadow-2xl sm:rounded-2xl"
        style={{
          background: theme.panelBg,
          borderColor: theme.border,
          color: theme.textPrimary,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <KeyRound
              className="mt-0.5 h-5 w-5 shrink-0 opacity-90"
              style={{ color: theme.accent }}
              aria-hidden
            />
            <h2 id={titleId} className="text-lg font-semibold tracking-tight sm:text-xl">
              {t(language, "e2eRestoreModalTitle")}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            className="shrink-0 rounded-full p-2 transition hover:opacity-80 disabled:opacity-40"
            style={{ color: theme.textSecondary }}
            aria-label={t(language, "e2eRestoreCancel")}
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <p className="mb-5 text-sm leading-relaxed" style={{ color: theme.textSecondary }}>
          {t(language, "e2eRestoreModalBody")}
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <label htmlFor="e2e-pin-restore" className="text-xs font-medium uppercase tracking-[0.14em]">
              {t(language, "e2eRestorePinLabel")}
            </label>
            <input
              id="e2e-pin-restore"
              type="password"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              autoComplete="one-time-code"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, "").slice(0, 6));
                setLocalError(null);
              }}
              className="w-full rounded-xl px-3 py-2.5 text-center text-lg tracking-[0.35em] outline-none border font-mono"
              style={{
                background: theme.inputBg,
                borderColor: theme.border,
                color: theme.textPrimary,
              }}
              disabled={busy}
              aria-invalid={Boolean(displayError)}
            />
          </div>

          {displayError ? (
            <p className="text-sm text-red-500" role="alert">
              {displayError}
            </p>
          ) : null}

          <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={handleClose}
              disabled={busy}
              className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold border sm:w-auto"
              style={{ borderColor: theme.border, color: theme.textSecondary }}
            >
              {t(language, "e2eRestoreCancel")}
            </button>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white sm:w-auto disabled:opacity-50"
              style={{ background: theme.accent }}
            >
              {busy ? t(language, "e2eRestoreBusy") : t(language, "e2eRestoreSubmit")}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
