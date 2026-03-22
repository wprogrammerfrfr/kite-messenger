/** Persisted Support Mode — drives tactical UI + consolidated low-bandwidth behavior. */
export const SUPPORT_MODE_STORAGE_KEY = "kite-support-mode";

export function readSupportModeFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SUPPORT_MODE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSupportModeToStorage(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) {
      window.localStorage.setItem(SUPPORT_MODE_STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(SUPPORT_MODE_STORAGE_KEY);
    }
    window.dispatchEvent(new Event("kite-support-mode"));
  } catch {
    // ignore
  }
}
