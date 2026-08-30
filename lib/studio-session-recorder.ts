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

export function canUseDisplayMedia(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function"
  );
}

export function canUseMediaRecorder(): boolean {
  return typeof MediaRecorder !== "undefined";
}

export function selectSessionVideoMediaRecorderOptions(): MediaRecorderOptions {
  if (!canUseMediaRecorder()) {
    throw new Error("MediaRecorder is not available in this environment.");
  }
  for (const mime of SESSION_VIDEO_MIME_CANDIDATES) {
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
): "webm" | "m4a" | "aac" | "bin" {
  const lower = mimeType.toLowerCase();
  if (lower.startsWith("video/")) {
    if (lower.includes("webm")) return "webm";
    if (lower.includes("mp4") || lower.includes("quicktime")) return "m4a";
    return "bin";
  }
  return extensionForRecorderMime(mimeType);
}
