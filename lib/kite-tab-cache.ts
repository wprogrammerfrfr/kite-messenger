const PREFIX = "kite-tab";

export function sidebarPrivacyCacheKey(userId: string): string {
  return `${PREFIX}:sidebar-privacy:v1:${userId}`;
}

export function dashboardAliasCacheKey(userId: string): string {
  return `${PREFIX}:dashboard-aliases:v1:${userId}`;
}

export function settingsProfileCacheKey(userId: string): string {
  return `${PREFIX}:settings-profile:v1:${userId}`;
}

export function readJsonCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJsonCache(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota / private mode
  }
}
