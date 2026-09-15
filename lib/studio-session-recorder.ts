import {
  extensionForRecorderMime,
  selectMediaRecorderMime,
  type TrackRecorderMimeSelection,
} from "@/lib/track-recorder";

export type SoloSessionRecorderCaptureMode = "screen-video" | "audio-only";

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

/**
 * Request display/tab capture for session recording.
 * Extra DisplayMediaStreamConstraints fields are ignored by browsers that do not support them.
 */
export async function getSessionDisplayMediaStream(): Promise<MediaStream> {
  if (!canUseDisplayMedia()) {
    throw new Error("Screen capture is unavailable in this browser.");
  }
  // Prefer current tab when supported; unknown keys are ignored by older browsers.
  const constraints = {
    video: { frameRate: { ideal: 30, max: 30 } },
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

export function selectSessionVideoMediaRecorderOptions(): MediaRecorderOptions {
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
        videoBitsPerSecond: 2_500_000,
        audioBitsPerSecond: 320_000,
      };
    }
  }
  return {
    videoBitsPerSecond: 2_500_000,
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
