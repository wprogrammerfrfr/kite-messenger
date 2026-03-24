const DISABLE_KEY = "kite-notifications-all-disabled";

export function areNotificationsGloballyDisabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(DISABLE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setNotificationsGloballyDisabled(disabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (disabled) localStorage.setItem(DISABLE_KEY, "1");
    else localStorage.removeItem(DISABLE_KEY);
    window.dispatchEvent(new Event("kite-notifications-setting"));
  } catch {
    // ignore
  }
}
