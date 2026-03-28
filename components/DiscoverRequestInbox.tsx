"use client";

import { useRouter } from "next/navigation";
import { useSidebarPrivacyData } from "@/lib/use-sidebar-privacy-data";
import { t, type Language } from "@/lib/translations";
import type { SafetyProfileOpenPayload } from "@/components/SafetyProfileModal";
import { formatRelativeLastSeen } from "@/lib/relative-last-seen";
import { contactDisplayLabel } from "@/lib/contact-display";
import { SkeletonDiscover } from "@/components/SkeletonDiscover";
import type { SidebarProfileRow } from "@/lib/fetch-sidebar-privacy";

type Props = {
  sessionUserId: string;
  language: Language;
  appearance: "light" | "dark";
  onlineUserIds: Record<string, boolean>;
  aliasByContactId: Record<string, string>;
  onOpenContactProfile: (payload: SafetyProfileOpenPayload) => void;
};

export function DiscoverRequestInbox({
  sessionUserId,
  language,
  appearance,
  onlineUserIds,
  aliasByContactId,
  onOpenContactProfile,
}: Props) {
  const router = useRouter();
  const isLight = appearance === "light";
  const textPrimary = isLight ? "#1c1917" : "#ffffff";
  const textSecondary = isLight ? "#57534e" : "rgba(255, 255, 255, 0.6)";

  const cardClass = isLight
    ? "mb-3 rounded-2xl bg-stone-100/80 border border-orange-500/30 p-4 hover:bg-orange-50/90 transition-all"
    : "mb-3 rounded-2xl bg-white/5 border-none p-4 hover:bg-white/10 transition-all";

  const { profilesById, dmStatusByPartnerId, requestIds, loadError, showSkeleton, handleAccept, handleDecline, actionBusy } =
    useSidebarPrivacyData(sessionUserId, language, 0, {
      onAfterAccept: (otherId) => {
        router.push(`/chat?recipient=${encodeURIComponent(otherId)}`);
      },
    });

  const renderRequestCard = (p: SidebarProfileRow) => {
    const isOnline = Boolean(onlineUserIds[p.id]);
    const lastSeenText = formatRelativeLastSeen(p.lastSeen, language);
    const busy = actionBusy === p.id;
    const publicName = (p.nickname && p.nickname.trim()) || "";
    const localAlias = aliasByContactId[p.id];
    const displayName = contactDisplayLabel(
      publicName,
      localAlias,
      t(language, "anonymousLabel")
    );
    const partnerDmStatus = dmStatusByPartnerId[p.id] ?? null;

    const openSafetyProfile = () => {
      onOpenContactProfile({
        target: {
          id: p.id,
          nickname: publicName,
          localAlias: localAlias ?? null,
          role: p.role,
          preferred_locale: p.preferred_locale ?? null,
          isOnline,
          lastSeen: p.lastSeen ?? null,
        },
        dmStatus: partnerDmStatus,
        isSelf: false,
      });
    };

    return (
      <div key={p.id} className={cardClass}>
        <div className="flex items-start justify-between gap-2 px-1 py-0.5 text-sm">
          <div className="min-w-0 flex-1">
            <button
              type="button"
              className="min-w-0 truncate text-left text-base font-semibold underline-offset-2 hover:underline"
              style={{ color: textPrimary }}
              onClick={openSafetyProfile}
              aria-label={`${t(language, "safetyProfileOpenProfileAria")}: ${displayName}`}
            >
              {displayName}
            </button>
            <p className="mt-1 text-left text-[11px]" style={{ color: textSecondary }}>
              {isOnline ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Online
                </span>
              ) : lastSeenText ? (
                lastSeenText
              ) : (
                "Offline"
              )}
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-2 px-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleAccept(p.id)}
            className="flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-black transition disabled:opacity-50"
            style={{ background: "#FF4500" }}
          >
            {t(language, "messageRequestAccept")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleDecline(p.id)}
            className="flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition disabled:opacity-50"
            style={{
              background: isLight ? "rgba(28,25,23,0.08)" : "rgba(255,255,255,0.08)",
              color: textSecondary,
            }}
          >
            {t(language, "messageRequestDecline")}
          </button>
        </div>
      </div>
    );
  };

  return (
    <section className="mb-4" aria-label={t(language, "sidebarRequests")}>
      <p
        className="mb-2 flex items-center gap-2 px-1 text-[11px] font-bold uppercase tracking-wide"
        style={{ color: "#FF4500" }}
      >
        <span>{t(language, "sidebarRequests")}</span>
        {requestIds.length > 0 ? (
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] font-bold text-black"
            style={{ background: "#FF4500" }}
          >
            {t(language, "sidebarNewRequestBadge")}
          </span>
        ) : null}
      </p>

      {showSkeleton ? <SkeletonDiscover rows={2} /> : null}

      {!showSkeleton && loadError ? (
        <p className="px-1 text-xs text-red-500" role="alert">
          {loadError}
        </p>
      ) : null}

      {!showSkeleton && !loadError && requestIds.length === 0 ? (
        <p className="px-1 text-xs" style={{ color: textSecondary }}>
          {t(language, "sidebarNoRequests")}
        </p>
      ) : null}

      {!showSkeleton && requestIds.length > 0 ? (
        <div>{requestIds.map((id) => {
          const p = profilesById[id];
          if (!p) return null;
          return renderRequestCard(p);
        })}</div>
      ) : null}
    </section>
  );
}
