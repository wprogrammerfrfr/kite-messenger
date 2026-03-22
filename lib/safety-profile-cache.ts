/**
 * Local cache for another user's safety profile fields (offline read).
 * Written after a successful online fetch when the DM pair is accepted.
 */

const PREFIX = "kite-safety-profile-v1";

export type CachedSafetyProfile = {
  targetUserId: string;
  emergency_contact: string | null;
  nickname: string | null;
  preferred_locale: string | null;
  role: string | null;
  cachedAt: number;
};

function key(viewerId: string, targetUserId: string): string {
  return `${PREFIX}:${viewerId}:${targetUserId}`;
}

export function readCachedSafetyProfile(
  viewerId: string,
  targetUserId: string
): CachedSafetyProfile | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key(viewerId, targetUserId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSafetyProfile;
    if (parsed?.targetUserId !== targetUserId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedSafetyProfile(
  viewerId: string,
  data: CachedSafetyProfile
): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key(viewerId, data.targetUserId), JSON.stringify(data));
  } catch {
    // quota / private mode
  }
}

export function clearCachedSafetyProfile(
  viewerId: string,
  targetUserId: string
): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(key(viewerId, targetUserId));
  } catch {
    // ignore
  }
}
