/**
 * Shared WebKit / iOS browser detection for studio WebRTC tuning.
 * All iOS browsers (Safari, Chrome, Firefox) use WebKit and need the same treatment.
 */
export function isStudioSafariWebKitEngine(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iPadOsMacintoshTrap =
    /Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
  const iosWebKit =
    /iPhone|iPad|iPod/i.test(ua) ||
    iPadOsMacintoshTrap ||
    /CriOS|FxiOS|EdgiOS/i.test(ua);
  if (iosWebKit) return true;
  if (!/Safari/i.test(ua)) return false;
  if (/Chrome|Chromium|Edg|OPR|Brave/i.test(ua)) return false;
  return true;
}
