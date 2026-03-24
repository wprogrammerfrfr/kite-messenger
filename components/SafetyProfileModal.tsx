"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Copy, Check, Phone, Pencil } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { t, type Language } from "@/lib/translations";
import { contactDisplayLabel } from "@/lib/contact-display";
import { formatRelativeLastSeen } from "@/lib/relative-last-seen";
import type { DmConnectionStatus } from "@/lib/dm-connections";
import {
  readCachedSafetyProfile,
  writeCachedSafetyProfile,
  type CachedSafetyProfile,
} from "@/lib/safety-profile-cache";

export type SafetyProfileTarget = {
  id: string;
  /** Public profile nickname (may be empty). */
  nickname: string;
  /** Private label only you see; overrides display of `nickname` in lists and headers. */
  localAlias?: string | null;
  role: string | null;
  preferred_locale: string | null;
  isOnline: boolean;
  lastSeen: string | null;
};

/** Open request from sidebar or chat header */
export type SafetyProfileOpenPayload = {
  target: SafetyProfileTarget;
  dmStatus: DmConnectionStatus | null;
  isSelf: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  language: Language;
  /** Chat / settings appearance for stone + black palettes */
  appearance: "light" | "dark";
  viewerId: string;
  target: SafetyProfileTarget | null;
  /** DM status with target; null if no row (treat as not accepted except self). */
  dmStatus: DmConnectionStatus | null;
  isSelf: boolean;
  /** Called after saving or removing a local alias for a contact. */
  onContactAliasUpdated?: (contactId: string, alias: string | null) => void;
};

function localeBadge(locale: string | null): string | null {
  if (locale === "en" || locale === "fa" || locale === "ar" || locale === "tr") {
    return locale.toUpperCase();
  }
  if (locale === "kr") return "KO";
  return null;
}

function roleLabel(language: Language, role: string | null): string | null {
  if (role === "musician") return t(language, "roleMusician");
  if (role === "therapist") return t(language, "roleTherapist");
  if (role === "responder") return t(language, "roleResponder");
  return null;
}

/** Strip for tel: — keeps leading + and digits */
function toTelHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const compact = trimmed.replace(/[^\d+]/g, "");
  if (compact.replace(/\D/g, "").length < 5) return null;
  return `tel:${encodeURIComponent(compact)}`;
}

export function SafetyProfileModal({
  open,
  onClose,
  language,
  appearance,
  viewerId,
  target,
  dmStatus,
  isSelf,
  onContactAliasUpdated,
}: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [emergencyContact, setEmergencyContact] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [offlineWithoutCache, setOfflineWithoutCache] = useState(false);
  const [copyDone, setCopyDone] = useState(false);
  const [editingAlias, setEditingAlias] = useState(false);
  const [aliasDraft, setAliasDraft] = useState("");
  const [aliasSaving, setAliasSaving] = useState(false);
  const [aliasError, setAliasError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    if (!target || isSelf) {
      setEmergencyContact(null);
      setFromCache(false);
      setOfflineWithoutCache(false);
      return;
    }

    if (dmStatus !== "accepted") {
      setEmergencyContact(null);
      setFromCache(false);
      setOfflineWithoutCache(false);
      return;
    }

    const cached = readCachedSafetyProfile(viewerId, target.id);
    const online = typeof navigator !== "undefined" && navigator.onLine;

    if (!online && cached) {
      setEmergencyContact(cached.emergency_contact);
      setFromCache(true);
      setOfflineWithoutCache(false);
      setLoading(false);
      return;
    }

    if (!online && !cached) {
      setEmergencyContact(null);
      setFromCache(false);
      setOfflineWithoutCache(true);
      setLoading(false);
      return;
    }

    setOfflineWithoutCache(false);

    if (cached && online) {
      setEmergencyContact(cached.emergency_contact);
      setFromCache(true);
    } else {
      setEmergencyContact(null);
      setFromCache(false);
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("emergency_contact, nickname, preferred_locale, role")
        .eq("id", target.id)
        .maybeSingle();

      if (error) throw error;

      const row = data as {
        emergency_contact?: string | null;
        nickname?: string | null;
        preferred_locale?: string | null;
        role?: string | null;
      } | null;

      const ec =
        typeof row?.emergency_contact === "string"
          ? row.emergency_contact.trim() || null
          : null;

      setEmergencyContact(ec);
      setFromCache(false);

      const payload: CachedSafetyProfile = {
        targetUserId: target.id,
        emergency_contact: ec,
        nickname: row?.nickname ?? target.nickname,
        preferred_locale: row?.preferred_locale ?? target.preferred_locale,
        role: (row?.role as string | null) ?? target.role,
        cachedAt: Date.now(),
      };
      writeCachedSafetyProfile(viewerId, payload);
    } catch {
      if (cached) {
        setEmergencyContact(cached.emergency_contact);
        setFromCache(true);
      }
    } finally {
      setLoading(false);
    }
  }, [target, isSelf, dmStatus, viewerId]);

  useEffect(() => {
    if (!open) {
      setCopyDone(false);
      setOfflineWithoutCache(false);
      setEditingAlias(false);
      setAliasDraft("");
      setAliasError(null);
      return;
    }
    void loadProfile();
  }, [open, loadProfile]);

  useEffect(() => {
    if (!open || !target) return;
    setAliasDraft((target.localAlias ?? "").trim());
    setEditingAlias(false);
    setAliasError(null);
  }, [open, target?.id, target?.localAlias]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      panelRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [open]);

  const copyNumber = useCallback(async () => {
    if (!emergencyContact) return;
    try {
      await navigator.clipboard.writeText(emergencyContact);
      setCopyDone(true);
      window.setTimeout(() => setCopyDone(false), 2000);
    } catch {
      // ignore
    }
  }, [emergencyContact]);

  if (!open || !target || typeof document === "undefined") return null;

  const anonymousLabel = t(language, "anonymousLabel");
  const publicForEmergency = target.nickname.trim() || anonymousLabel;
  const profileHeadingName = contactDisplayLabel(
    target.nickname,
    target.localAlias,
    anonymousLabel
  );

  const saveContactAlias = async () => {
    if (isSelf) return;
    setAliasSaving(true);
    setAliasError(null);
    const trimmed = aliasDraft.trim();
    try {
      if (!trimmed) {
        const { error } = await supabase
          .from("contact_aliases")
          .delete()
          .eq("user_id", viewerId)
          .eq("contact_id", target.id);
        if (error) throw error;
        onContactAliasUpdated?.(target.id, null);
      } else {
        const { error } = await supabase.from("contact_aliases").upsert(
          {
            user_id: viewerId,
            contact_id: target.id,
            alias: trimmed,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,contact_id" }
        );
        if (error) throw error;
        onContactAliasUpdated?.(target.id, trimmed);
      }
      setEditingAlias(false);
    } catch {
      setAliasError(t(language, "contactAliasSaveError"));
    } finally {
      setAliasSaving(false);
    }
  };

  const isLight = appearance === "light";
  const shell = isLight
    ? "bg-stone-100 text-stone-900 border-stone-300"
    : "bg-black text-stone-100 border-stone-700";
  const muted = isLight ? "text-stone-500" : "text-stone-400";
  const badgeBg = isLight ? "bg-stone-200 text-stone-800" : "bg-stone-800 text-stone-200";
  const langBadge = localeBadge(target.preferred_locale);
  const role = roleLabel(language, target.role);
  const lastSeenText = !target.isOnline
    ? formatRelativeLastSeen(target.lastSeen, language)
    : null;

  let emergencyBlock: React.ReactNode = null;

  if (isSelf) {
    emergencyBlock = (
      <p className={`text-sm ${muted}`}>{t(language, "safetyProfileSelfHint")}</p>
    );
  } else if (dmStatus === "pending") {
    emergencyBlock = (
      <p className={`text-sm ${muted}`}>
        {t(language, "safetyProfileNotAcceptedPending")}
      </p>
    );
  } else if (dmStatus === "declined") {
    emergencyBlock = (
      <p className={`text-sm ${muted}`}>
        {t(language, "safetyProfileNotAcceptedDeclined")}
      </p>
    );
  } else if (dmStatus !== "accepted") {
    emergencyBlock = (
      <p className={`text-sm ${muted}`}>
        {t(language, "safetyProfileNotAcceptedHint")}
      </p>
    );
  } else if (dmStatus === "accepted" && offlineWithoutCache) {
    emergencyBlock = (
      <p className={`text-sm ${muted}`}>{t(language, "safetyProfileOfflineNoCache")}</p>
    );
  } else if (dmStatus === "accepted" && loading && emergencyContact === null) {
    emergencyBlock = (
      <p className={`text-sm ${muted}`}>{t(language, "safetyProfileLoading")}</p>
    );
  } else if (
    dmStatus === "accepted" &&
    (!emergencyContact || emergencyContact.length === 0)
  ) {
    emergencyBlock = (
      <p className={`text-sm ${muted}`}>
        {t(language, "safetyProfileNoEmergency").replace(
          "{{nickname}}",
          publicForEmergency
        )}
      </p>
    );
  } else if (dmStatus === "accepted" && emergencyContact) {
    const telHref = toTelHref(emergencyContact);
    emergencyBlock = (
      <div className="flex flex-col gap-3">
        {fromCache ? (
          <p className={`text-xs ${muted}`} role="status">
            {t(language, "safetyProfileCachedHint")}
          </p>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
          {telHref ? (
            <>
              <a
                href={telHref}
                className="inline-flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-xl px-5 py-4 text-base font-bold text-white shadow-lg transition hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
                style={{ background: "#FF4500" }}
              >
                <Phone className="h-6 w-6 shrink-0" aria-hidden />
                {t(language, "safetyProfileCallEmergency")}
              </a>
              <button
                type="button"
                onClick={() => void copyNumber()}
                className={`inline-flex min-h-[52px] min-w-[52px] items-center justify-center rounded-xl border-2 border-[#FF4500] px-4 py-4 text-[#FF4500] transition hover:bg-[#FF4500]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 ${isLight ? "bg-white" : "bg-stone-950"}`}
                aria-label={t(language, "safetyProfileCopyNumber")}
                title={t(language, "safetyProfileCopyNumber")}
              >
                {copyDone ? (
                  <Check className="h-6 w-6" aria-hidden />
                ) : (
                  <Copy className="h-6 w-6" aria-hidden />
                )}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void copyNumber()}
              className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl px-5 py-4 text-base font-bold text-white shadow-lg transition hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 sm:flex-1"
              style={{ background: "#FF4500" }}
            >
              <Copy className="h-6 w-6 shrink-0" aria-hidden />
              {t(language, "safetyProfileCopyNumber")}
            </button>
          )}
        </div>
        {!telHref ? (
          <p className={`text-xs ${muted}`}>{t(language, "safetyProfileNonPhoneHint")}</p>
        ) : null}
        {copyDone ? (
          <p className="text-xs text-emerald-600 dark:text-emerald-400" role="status">
            {t(language, "safetyProfileCopied")}
          </p>
        ) : null}
      </div>
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-label={t(language, "safetyProfileClose")}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative z-[101] flex max-h-[min(90dvh,720px)] w-full max-w-lg flex-col rounded-t-2xl border p-5 shadow-2xl sm:rounded-2xl ${shell}`}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="truncate text-xl font-semibold tracking-tight"
            >
              {profileHeadingName}
            </h2>
            {target.localAlias?.trim() ? (
              <p className={`mt-1 text-xs ${muted}`}>
                {t(language, "contactAliasPublicLine").replace(
                  "{{name}}",
                  target.nickname.trim() || anonymousLabel
                )}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              {target.isOnline ? (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${badgeBg}`}
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                  {t(language, "safetyProfileBadgeOnline")}
                </span>
              ) : (
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${badgeBg}`}
                >
                  {lastSeenText ?? t(language, "safetyProfileBadgeOffline")}
                </span>
              )}
              {langBadge ? (
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badgeBg}`}
                >
                  {t(language, "safetyProfileBadgeLanguage")}: {langBadge}
                </span>
              ) : null}
              {role ? (
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badgeBg}`}
                >
                  {role}
                </span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`shrink-0 rounded-full p-2 transition hover:opacity-80 ${muted}`}
            aria-label={t(language, "safetyProfileClose")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-stone-300 pt-4 dark:border-stone-700">
          {!isSelf ? (
            <div className="mb-6">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-[#FF4500]">
                {t(language, "contactAliasSectionTitle")}
              </h3>
              {!editingAlias ? (
                <button
                  type="button"
                  onClick={() => {
                    setAliasDraft((target.localAlias ?? "").trim());
                    setEditingAlias(true);
                    setAliasError(null);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-[#FF4500] px-3 py-2 text-sm font-semibold text-[#FF4500] transition hover:bg-[#FF4500]/10"
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                  {t(language, "contactAliasEditButton")}
                </button>
              ) : (
                <div className="flex flex-col gap-3">
                  <input
                    value={aliasDraft}
                    onChange={(e) => setAliasDraft(e.target.value)}
                    className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#FF4500] ${isLight ? "border-stone-300 bg-white text-stone-900" : "border-stone-600 bg-stone-950 text-stone-100"}`}
                    placeholder={t(language, "contactAliasPlaceholder")}
                    maxLength={80}
                    autoComplete="off"
                    aria-label={t(language, "contactAliasPlaceholder")}
                  />
                  {aliasError ? (
                    <p className="text-xs text-red-500" role="alert">
                      {aliasError}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={aliasSaving}
                      onClick={() => void saveContactAlias()}
                      className="rounded-lg px-4 py-2 text-sm font-bold text-black transition disabled:opacity-50"
                      style={{ background: "#FF4500" }}
                    >
                      {aliasSaving ? t(language, "sendingButton") : t(language, "contactAliasSave")}
                    </button>
                    <button
                      type="button"
                      disabled={aliasSaving}
                      onClick={() => {
                        setEditingAlias(false);
                        setAliasDraft((target.localAlias ?? "").trim());
                        setAliasError(null);
                      }}
                      className={`rounded-lg border px-4 py-2 text-sm font-medium ${isLight ? "border-stone-300" : "border-stone-600"}`}
                    >
                      {t(language, "contactAliasCancel")}
                    </button>
                    <button
                      type="button"
                      disabled={aliasSaving || !(target.localAlias ?? "").trim()}
                      onClick={() => {
                        setAliasDraft("");
                        void (async () => {
                          setAliasSaving(true);
                          setAliasError(null);
                          try {
                            const { error } = await supabase
                              .from("contact_aliases")
                              .delete()
                              .eq("user_id", viewerId)
                              .eq("contact_id", target.id);
                            if (error) throw error;
                            onContactAliasUpdated?.(target.id, null);
                            setEditingAlias(false);
                          } catch {
                            setAliasError(t(language, "contactAliasSaveError"));
                          } finally {
                            setAliasSaving(false);
                          }
                        })();
                      }}
                      className="rounded-lg px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400"
                    >
                      {t(language, "contactAliasRemove")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-[#FF4500]">
            {t(language, "safetyProfileEmergencySection")}
          </h3>
          {emergencyBlock}
        </div>
      </div>
    </div>,
    document.body
  );
}
