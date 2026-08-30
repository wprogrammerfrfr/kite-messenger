import { isMobileDevice } from "@/lib/studio-bridge-webrtc";

export function micPermissionRecoveryHint(): string {
  if (typeof navigator === "undefined") {
    return "Allow microphone access in your browser settings and reload this page.";
  }
  const ua = navigator.userAgent;
  const iPadOsMacintoshTrap =
    /Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
  const isIos =
    /iPhone|iPad|iPod/i.test(ua) || iPadOsMacintoshTrap || /CriOS|FxiOS|EdgiOS/i.test(ua);

  if (isIos) {
    return "On iPhone or iPad: Settings → Safari → Website Settings → Microphone, or tap the aA icon in the address bar and allow Microphone for this site.";
  }
  if (isMobileDevice()) {
    return "Open your browser menu → Site settings → Microphone and allow access for this page, then reload.";
  }
  return "Click the lock or site-settings icon in your browser address bar and allow Microphone access.";
}
