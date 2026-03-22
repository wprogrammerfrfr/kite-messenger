import { t, type Language } from "@/lib/translations";

/**
 * Relative "last online" for presence UI:
 * - &lt; 60 min: N minutes ago
 * - 1–24 h: N hours ago
 * - &gt; 24 h: N days ago
 */
export function formatRelativeLastSeen(
  iso: string | null | undefined,
  language: Language
): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) {
    return t(language, "relativeLastSeenJustNow");
  }

  const totalMinutes = Math.floor(diffMs / 60_000);

  if (totalMinutes < 60) {
    const m = Math.max(1, totalMinutes);
    if (m === 1) {
      return t(language, "relativeLastSeenOneMinute");
    }
    return t(language, "relativeLastSeenMinutes").replace("{{n}}", String(m));
  }

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    if (totalHours === 1) {
      return t(language, "relativeLastSeenOneHour");
    }
    return t(language, "relativeLastSeenHours").replace("{{n}}", String(totalHours));
  }

  const totalDays = Math.floor(totalHours / 24);
  if (totalDays === 1) {
    return t(language, "relativeLastSeenOneDay");
  }
  return t(language, "relativeLastSeenDays").replace("{{n}}", String(totalDays));
}
