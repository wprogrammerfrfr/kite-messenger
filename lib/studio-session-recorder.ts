import {
  extensionForRecorderMime,
  selectMediaRecorderMime,
  type TrackRecorderMimeSelection,
} from "@/lib/track-recorder";

export type SoloSessionRecorderCaptureMode = "screen-video" | "camera-video" | "audio-only";

/** Where session video comes from on this device. */
export type SessionVideoSource = "screen" | "camera" | "none";

const SESSION_VIDEO_MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
  "video/quicktime",
] as const;

const SESSION_VIDEO_MIME_CANDIDATES_IOS = [
  "video/mp4",
  "video/quicktime",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
] as const;

function isLikelyIosUa(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS reports as Macintosh but has touch
  return /Macintosh/i.test(ua) && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1;
}

export function canUseDisplayMedia(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function"
  );
}

export function canUseMediaRecorder(): boolean {
  return typeof MediaRecorder !== "undefined";
}

function isLikelyAndroidUa(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

export function canUseCameraCapture(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

/**
 * Android Chrome/Brave: camera (no tab capture). iOS/iPadOS Safari: screen only if WebKit ever
 * ships getDisplayMedia, otherwise camera. Desktop keeps screen capture.
 */
export function resolveSessionVideoSource(): SessionVideoSource {
  if (isLikelyAndroidUa()) {
    return canUseCameraCapture() ? "camera" : "none";
  }
  if (canUseDisplayMedia()) return "screen";
  return canUseCameraCapture() ? "camera" : "none";
}

/**
 * Video-only camera stream for session recording. `audio: false` keeps the mic path untouched;
 * 720p30 caps encoder load so the audio thread keeps its headroom.
 */
export async function getSessionCameraStream(
  facingMode: "user" | "environment" = "user"
): Promise<MediaStream> {
  if (!canUseCameraCapture()) {
    throw new Error("Camera is unavailable in this browser.");
  }
  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 1280, max: 1280 },
      height: { ideal: 720, max: 720 },
      frameRate: { ideal: 30, max: 30 },
    },
    audio: false,
  });
}

/**
 * Request display/tab capture for session recording.
 * 1080p30 is the desktop ceiling: max keeps Retina/4K captures from encoding larger,
 * ideal asks for 1080p when the surface is bigger. Extra constraint fields are ignored
 * by browsers that do not support them.
 */
export async function getSessionDisplayMediaStream(): Promise<MediaStream> {
  if (!canUseDisplayMedia()) {
    throw new Error("Screen capture is unavailable in this browser.");
  }
  // Prefer current tab when supported; unknown keys are ignored by older browsers.
  const constraints = {
    video: {
      width: { ideal: 1920, max: 1920 },
      height: { ideal: 1080, max: 1080 },
      frameRate: { ideal: 30, max: 30 },
    },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: "include",
    systemAudio: "exclude",
  } as MediaStreamConstraints & {
    preferCurrentTab?: boolean;
    selfBrowserSurface?: "include" | "exclude";
    systemAudio?: "include" | "exclude";
  };
  return navigator.mediaDevices.getDisplayMedia(constraints);
}

/** Camera / Android. Desktop screen capture passes a higher rate explicitly. */
const SESSION_CAMERA_VIDEO_BITS_PER_SECOND = 2_500_000;

/** 1080p30 screen capture. Same resolution as the 2.5 Mbps default, more bits. */
export const SESSION_SCREEN_VIDEO_BITS_PER_SECOND = 5_000_000;

export function selectSessionVideoMediaRecorderOptions(
  videoBitsPerSecond: number = SESSION_CAMERA_VIDEO_BITS_PER_SECOND
): MediaRecorderOptions {
  if (!canUseMediaRecorder()) {
    throw new Error("MediaRecorder is not available in this environment.");
  }
  const candidates = isLikelyIosUa()
    ? SESSION_VIDEO_MIME_CANDIDATES_IOS
    : SESSION_VIDEO_MIME_CANDIDATES;
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return {
        mimeType: mime,
        videoBitsPerSecond,
        audioBitsPerSecond: 320_000,
      };
    }
  }
  return {
    videoBitsPerSecond,
    audioBitsPerSecond: 320_000,
  };
}

export function selectSessionAudioMediaRecorderOptions(): TrackRecorderMimeSelection {
  return selectMediaRecorderMime();
}

export function resolveSessionDownloadExtension(
  mimeType: string
): "webm" | "mp4" | "m4a" | "aac" | "bin" {
  const lower = mimeType.toLowerCase();
  if (lower.startsWith("video/")) {
    if (lower.includes("webm")) return "webm";
    if (lower.includes("mp4") || lower.includes("quicktime")) return "mp4";
    return "bin";
  }
  return extensionForRecorderMime(mimeType);
}
