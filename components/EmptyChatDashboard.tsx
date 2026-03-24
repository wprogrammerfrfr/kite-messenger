"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, Wifi } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { t, type Language } from "@/lib/translations";
import { useResilience } from "@/components/resilience-provider";
import { findProfileByDiscoverQuery } from "@/lib/profile-lookup";
import {
  createPendingDmRequest,
  fetchDmConnectionForPair,
  type DmConnectionStatus,
} from "@/lib/dm-connections";
import { contactDisplayLabel } from "@/lib/contact-display";
import type { SafetyProfileOpenPayload } from "@/components/SafetyProfileModal";

type Props = {
  language: Language;
  sessionUserId: string;
  myNickname: string | null;
  onViewMyProfile: () => void;
  onSelectRecipient: (id: string) => void;
  onOpenContactProfile: (payload: SafetyProfileOpenPayload) => void;
  onlineUserIds: Record<string, boolean>;
  aliasByContactId: Record<string, string>;
  onDmRequestCreated?: () => void;
};

type PairDm =
  | "idle"
  | "loading"
  | null
  | { status: DmConnectionStatus; initiated_by: string };

export function EmptyChatDashboard({
  language,
  sessionUserId,
  myNickname,
  onViewMyProfile,
  onSelectRecipient,
  onOpenContactProfile,
  onlineUserIds,
  aliasByContactId,
  onDmRequestCreated,
}: Props) {
  const { isOnline, isConnectionSlow } = useResilience();
  const [connectionTipOpen, setConnectionTipOpen] = useState(false);

  const connectionTier = !isOnline
    ? "offline"
    : isConnectionSlow
      ? "weak"
      : "excellent";

  const connectionTooltip =
    connectionTier === "excellent"
      ? t(language, "dashboardWifiTooltipExcellent")
      : connectionTier === "weak"
        ? t(language, "dashboardWifiTooltipWeak")
        : t(language, "dashboardWifiTooltipOffline");

  const wifiIconColor =
    connectionTier === "excellent"
      ? "rgba(34, 197, 94, 0.92)"
      : connectionTier === "weak"
        ? "rgba(234, 179, 8, 0.95)"
        : "rgba(239, 68, 68, 0.92)";

  useEffect(() => {
    if (!connectionTipOpen) return;
    const tId = window.setTimeout(() => setConnectionTipOpen(false), 4500);
    return () => window.clearTimeout(tId);
  }, [connectionTipOpen]);

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof findProfileByDiscoverQuery>
  > | null>(null);
  const [pairDm, setPairDm] = useState<PairDm>("idle");
  const [requestBusy, setRequestBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) {
      setSearched(false);
      setResult(null);
      setPairDm("idle");
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const found = await findProfileByDiscoverQuery(supabase, sessionUserId, q);
      setResult(found);
      if (!found) {
        setPairDm(null);
        return;
      }
      setPairDm("loading");
      const row = await fetchDmConnectionForPair(supabase, sessionUserId, found.id);
      setPairDm(row ?? null);
    } catch {
      setError(t(language, "emptyDashboardSearchError"));
      setResult(null);
      setPairDm(null);
    } finally {
      setLoading(false);
    }
  }, [query, sessionUserId, language]);

  const publicNick = myNickname?.trim() || "";
  const youLabel = contactDisplayLabel(
    publicNick,
    null,
    t(language, "anonymousLabel")
  );

  const dmStatusForProfile: DmConnectionStatus | null =
    pairDm === "idle" || pairDm === "loading" || pairDm === null
      ? null
      : pairDm.status;

  const openResultProfile = () => {
    if (!result) return;
    const pub = result.nickname?.trim() ?? "";
    onOpenContactProfile({
      target: {
        id: result.id,
        nickname: pub,
        localAlias: aliasByContactId[result.id] ?? null,
        role: result.role,
        preferred_locale: result.preferred_locale ?? null,
        isOnline: Boolean(onlineUserIds[result.id]),
        lastSeen: result.lastSeen ?? null,
      },
      dmStatus: dmStatusForProfile,
      isSelf: false,
    });
  };

  const sendRequest = async () => {
    if (!result || requestBusy) return;
    setRequestBusy(true);
    setError(null);
    const r = await createPendingDmRequest(supabase, sessionUserId, result.id);
    setRequestBusy(false);
    if (!r.ok) {
      setError(r.errorMessage ?? t(language, "emptyDashboardSearchError"));
      return;
    }
    setPairDm({ status: "pending", initiated_by: sessionUserId });
    onDmRequestCreated?.();
    onSelectRecipient(result.id);
  };

  const displayResultName = result
    ? contactDisplayLabel(
        result.nickname,
        aliasByContactId[result.id],
        t(language, "anonymousLabel")
      )
    : "";

  return (
    <div className="relative flex min-h-[min(70vh,520px)] flex-col items-center justify-center px-4 py-8">
      <div className="absolute top-1 z-10 sm:top-2 end-2 sm:end-4">
        <button
          type="button"
          className="relative rounded-full p-2.5 transition-colors hover:bg-white/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4500]/55"
          style={{ color: wifiIconColor }}
          aria-label={connectionTooltip}
          title={connectionTooltip}
          onClick={() => setConnectionTipOpen((open) => !open)}
        >
          <Wifi
            className="h-[22px] w-[22px] sm:h-6 sm:w-6"
            strokeWidth={2.25}
            aria-hidden
            style={{
              filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.65))",
            }}
          />
        </button>
        {connectionTipOpen ? (
          <div
            role="tooltip"
            className="absolute end-0 top-full z-20 mt-2 max-w-[min(92vw,300px)] rounded-xl border px-3.5 py-2.5 text-left text-xs leading-snug shadow-lg sm:text-[13px]"
            style={{
              borderColor: "rgba(255, 69, 0, 0.5)",
              background: "var(--panel-bg)",
              color: "var(--text-primary)",
              boxShadow: "var(--glow)",
            }}
          >
            {connectionTooltip}
          </div>
        ) : null}
      </div>
      <div className="w-full max-w-md space-y-8">
        <div>
          <label
            htmlFor="empty-dashboard-search"
            className="mb-2 block text-center text-sm font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {t(language, "emptyDashboardSearchHeading")}
          </label>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50"
                aria-hidden
              />
              <input
                id="empty-dashboard-search"
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSearched(false);
                  setResult(null);
                  setPairDm("idle");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void runSearch();
                  }
                }}
                placeholder={t(language, "emptyDashboardSearchPlaceholder")}
                className="w-full rounded-xl border border-[rgba(255,69,0,0.45)] bg-[var(--input-bg)] py-3 pl-10 pr-3 text-sm outline-none focus:border-[#FF4500] focus:ring-1 focus:ring-[#FF4500]"
                style={{ color: "var(--text-primary)" }}
                aria-label={t(language, "emptyDashboardSearchPlaceholder")}
              />
            </div>
            <button
              type="button"
              onClick={() => void runSearch()}
              disabled={loading}
              className="shrink-0 rounded-xl px-4 py-3 text-sm font-bold text-black transition disabled:opacity-50"
              style={{ background: "#FF4500" }}
            >
              {loading ? t(language, "sendingButton") : t(language, "discoverSearchButton")}
            </button>
          </div>
          {error ? (
            <p className="mt-2 text-center text-xs text-red-500" role="alert">
              {error}
            </p>
          ) : null}
          {searched && !loading && result ? (
            <div
              className="mt-4 rounded-xl border p-4"
              style={{
                borderColor: "var(--border)",
                background: "var(--panel-bg)",
                boxShadow: "var(--glow)",
              }}
            >
              <button
                type="button"
                onClick={openResultProfile}
                className="w-full text-left text-base font-semibold underline-offset-2 hover:underline"
                style={{ color: "var(--text-primary)" }}
              >
                {displayResultName}
              </button>
              <div className="mt-3 flex flex-col gap-2">
                {pairDm === "loading" ? (
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {t(language, "loadingUsers")}
                  </p>
                ) : null}

                {pairDm !== "loading" &&
                pairDm !== "idle" &&
                (pairDm === null || pairDm.status === "declined") ? (
                  <button
                    type="button"
                    disabled={requestBusy}
                    onClick={() => void sendRequest()}
                    className="w-full rounded-lg py-3 text-sm font-bold text-black transition disabled:opacity-50"
                    style={{ background: "#FF4500" }}
                  >
                    {requestBusy ? t(language, "sendingButton") : t(language, "sendDmRequestButton")}
                  </button>
                ) : null}

                {pairDm !== "loading" && pairDm !== "idle" && pairDm != null && pairDm.status === "accepted" ? (
                  <button
                    type="button"
                    onClick={() => onSelectRecipient(result.id)}
                    className="w-full rounded-lg py-3 text-sm font-bold text-black transition hover:opacity-95"
                    style={{ background: "#FF4500" }}
                  >
                    {t(language, "discoverMessageButton")}
                  </button>
                ) : null}

                {pairDm !== "loading" &&
                pairDm !== "idle" &&
                pairDm != null &&
                pairDm.status === "pending" &&
                pairDm.initiated_by === sessionUserId ? (
                  <button
                    type="button"
                    onClick={() => onSelectRecipient(result.id)}
                    className="w-full rounded-lg border-2 py-3 text-sm font-semibold transition hover:opacity-95"
                    style={{ borderColor: "#FF4500", color: "var(--text-primary)" }}
                  >
                    {t(language, "discoverMessageButton")}
                  </button>
                ) : null}

                {pairDm !== "loading" &&
                pairDm !== "idle" &&
                pairDm != null &&
                pairDm.status === "pending" &&
                pairDm.initiated_by !== sessionUserId ? (
                  <button
                    type="button"
                    onClick={() => onSelectRecipient(result.id)}
                    className="w-full rounded-lg py-3 text-sm font-bold text-black transition hover:opacity-95"
                    style={{ background: "#FF4500" }}
                  >
                    {t(language, "discoverViewRequestButton")}
                  </button>
                ) : null}
              </div>
            </div>
          ) : searched && !loading && !result ? (
            <p
              className="mt-4 text-center text-sm"
              style={{ color: "var(--text-secondary)" }}
            >
              {t(language, "sidebarNoExactUser")}
            </p>
          ) : null}
        </div>

        <div
          className="rounded-2xl border p-5"
          style={{
            borderColor: "var(--border)",
            background: "var(--panel-bg)",
            boxShadow: "var(--glow)",
          }}
        >
          <p
            className="text-[11px] font-bold uppercase tracking-wide"
            style={{ color: "#FF4500" }}
          >
            {t(language, "emptyDashboardSelfCardTitle")}
          </p>
          <p className="mt-2 text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            {youLabel}
          </p>
          <button
            type="button"
            onClick={onViewMyProfile}
            className="mt-4 w-full rounded-xl py-3 text-sm font-bold text-black transition hover:opacity-95"
            style={{ background: "#FF4500" }}
          >
            {t(language, "emptyDashboardViewMyProfile")}
          </button>
        </div>
      </div>
    </div>
  );
}
