/** True when the app is likely running as an installed PWA. */
export function isStandaloneDisplayMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
  } catch {
    // ignore
  }
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}
