"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { t, type Language } from "@/lib/translations";

/** Visual tokens aligned with ProfileHub panels (caller passes active theme). */
export type E2eConnectPhoneModalTheme = {
  panelBg: string;
  border: string;
  accent: string;
  textPrimary: string;
  textSecondary: string;
  inputBg: string;
};

const DEFAULT_THEME: E2eConnectPhoneModalTheme = {
  panelBg: "rgba(14, 14, 18, 0.98)",
  border: "rgba(255, 69, 0, 0.35)",
  accent: "#FF4500",
  textPrimary: "rgba(255, 255, 255, 0.95)",
  textSecondary: "rgba(255, 255, 255, 0.6)",
  inputBg: "rgba(20, 20, 24, 0.95)",
};

export type E2eConnectPhoneModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  language: Language;
  /** Encrypt + upload; close on success. Reject with Error message for user-visible failures. */
  onConfirm: (pin: string) => Promise<void>;
  theme?: E2eConnectPhoneModalTheme;
};

export function E2eConnectPhoneModal({
  open,
  onOpenChange,
  language,
  onConfirm,
  theme: themeProp,
}: E2eConnectPhoneModalProps) {
  const titleId = useId();
  const theme = themeProp ?? DEFAULT_THEME;
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRtl = language === "fa" || language === "ar";

  useEffect(() => {
    if (!open) {
      setPin("");
      setConfirmPin("");
      setError(null);
      setBusy(false);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const a = pin.trim();
    const b = confirmPin.trim();

    if (!/^\d{6}$/.test(a)) {
      setError(t(language, "e2ePinVaultErrorInvalidPin"));
      return;
    }
    if (a !== b) {
      setError(t(language, "e2ePinVaultErrorPinsMismatch"));
      return;
    }

    setBusy(true);
    try {
      await onConfirm(a);
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim()
          ? err.message
          : t(language, "e2ePinVaultErrorGeneric")
      );
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        aria-label={t(language, "e2ePinVaultCancel")}
        onClick={handleClose}
        disabled={busy}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        dir={isRtl ? "rtl" : "ltr"}
        className="relative z-[101] flex max-h-[min(90dvh,640px)] w-full max-w-md flex-col rounded-t-2xl border p-5 shadow-2xl sm:rounded-2xl"
        style={{
          background: theme.panelBg,
          borderColor: theme.border,
          color: theme.textPrimary,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold tracking-tight sm:text-xl">
            {t(language, "e2ePinVaultModalTitle")}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            className="shrink-0 rounded-full p-2 transition hover:opacity-80 disabled:opacity-40"
            style={{ color: theme.textSecondary }}
            aria-label={t(language, "e2ePinVaultCancel")}
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <p className="mb-5 text-sm leading-relaxed" style={{ color: theme.textSecondary }}>
          {t(language, "e2ePinVaultModalBody")}
        </p>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <label htmlFor="e2e-pin-create" className="text-xs font-medium uppercase tracking-[0.14em]">
              {t(language, "e2ePinVaultPinLabel")}
            </label>
            <input
              id="e2e-pin-create"
              type="password"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              autoComplete="new-password"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full rounded-xl px-3 py-2.5 text-center text-lg tracking-[0.35em] outline-none border font-mono"
              style={{
                background: theme.inputBg,
                borderColor: theme.border,
                color: theme.textPrimary,
              }}
              disabled={busy}
              aria-invalid={Boolean(error)}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="e2e-pin-confirm" className="text-xs font-medium uppercase tracking-[0.14em]">
              {t(language, "e2ePinVaultConfirmPinLabel")}
            </label>
            <input
              id="e2e-pin-confirm"
              type="password"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              autoComplete="new-password"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full rounded-xl px-3 py-2.5 text-center text-lg tracking-[0.35em] outline-none border font-mono"
              style={{
                background: theme.inputBg,
                borderColor: theme.border,
                color: theme.textPrimary,
              }}
              disabled={busy}
            />
          </div>

          {error ? (
            <p className="text-sm text-red-500" role="alert">
              {error}
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
              {t(language, "e2ePinVaultCancel")}
            </button>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white sm:w-auto disabled:opacity-50"
              style={{ background: theme.accent }}
            >
              {busy ? t(language, "e2ePinVaultSaving") : t(language, "e2ePinVaultSubmit")}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
