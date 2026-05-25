const RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/aac",
  "",
] as const;

export type TrackRecorderMimeSelection = {
  mediaRecorderOptions: MediaRecorderOptions;
  blobTypeHint: string;
};

/**
 * Picks the first MIME type the browser claims to support, or default constructor when "".
 */
export function selectMediaRecorderMime(): TrackRecorderMimeSelection {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("MediaRecorder is not available in this environment.");
  }
  for (const mime of RECORDER_MIME_CANDIDATES) {
    if (mime === "") {
      return { mediaRecorderOptions: {}, blobTypeHint: "" };
    }
    if (MediaRecorder.isTypeSupported(mime)) {
      const mediaRecorderOptions: MediaRecorderOptions = { mimeType: mime };
      if (mime.includes("opus") || mime === "audio/webm") {
        mediaRecorderOptions.audioBitsPerSecond = 320_000;
      }
      return { mediaRecorderOptions, blobTypeHint: mime };
    }
  }
  throw new Error("No supported MediaRecorder audio MIME type in this browser.");
}

function normalizeBlobType(hint: string, recorder: MediaRecorder): string {
  const fromRecorder = recorder.mimeType?.trim();
  if (fromRecorder) return fromRecorder;
  if (hint) return hint;
  return "audio/webm";
}

export function extensionForRecorderMime(mimeType: string): "webm" | "m4a" | "aac" | "bin" {
  const t = mimeType.toLowerCase();
  if (t.includes("webm")) return "webm";
  if (t.includes("mp4") || t.includes("m4a")) return "m4a";
  if (t.includes("aac")) return "aac";
  if (!t) return "webm";
  return "bin";
}

export class TrackRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private startedAt = 0;
  /** MIME used for Blob; set in start, updated from recorder if needed. */
  private activeBlobType = "";

  start(stream: MediaStream): void {
    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      throw new Error("TrackRecorder is already recording.");
    }

    const { mediaRecorderOptions, blobTypeHint } = selectMediaRecorderMime();
    this.chunks = [];
    this.activeBlobType = blobTypeHint;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mediaRecorderOptions);
    } catch (err) {
      if (mediaRecorderOptions.audioBitsPerSecond !== undefined) {
        const { audioBitsPerSecond: _br, ...rest } = mediaRecorderOptions;
        recorder = new MediaRecorder(stream, rest);
      } else {
        throw err;
      }
    }

    this.mediaRecorder = recorder;
    this.activeBlobType = normalizeBlobType(blobTypeHint, recorder);

    this.mediaRecorder.ondataavailable = (event: BlobEvent): void => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };

    this.startedAt = performance.now();
    this.mediaRecorder.start();
  }

  stop(): Promise<Blob> {
    const recorder = this.mediaRecorder;
    if (!recorder || recorder.state === "inactive") {
      return Promise.reject(new Error("TrackRecorder is not recording."));
    }

    const blobTypeForOutput = normalizeBlobType(this.activeBlobType, recorder);

    return new Promise<Blob>((resolve, reject) => {
      let settled = false;

      const cleanup = (): void => {
        recorder.removeEventListener("stop", handleStop);
        recorder.removeEventListener("error", handleError as EventListener);
      };

      const handleStop = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        const blob = new Blob(this.chunks, { type: blobTypeForOutput });
        this.mediaRecorder = null;
        this.activeBlobType = "";
        resolve(blob);
      };

      const handleError = (event: Event): void => {
        if (settled) return;
        settled = true;
        cleanup();
        this.mediaRecorder = null;
        this.activeBlobType = "";
        const target = event as Event & { error?: DOMException };
        reject(target.error ?? new Error("MediaRecorder failed."));
      };

      recorder.addEventListener("stop", handleStop);
      recorder.addEventListener("error", handleError as EventListener);
      recorder.stop();
    });
  }

  pause(): void {
    const recorder = this.mediaRecorder;
    if (recorder && recorder.state === "recording") {
      recorder.pause();
    }
  }

  resume(): void {
    const recorder = this.mediaRecorder;
    if (recorder && recorder.state === "paused") {
      recorder.resume();
    }
  }

  getState(): RecordingState | "inactive" {
    return this.mediaRecorder?.state ?? "inactive";
  }

  getTimestamp(): number {
    return this.startedAt;
  }

  /** MIME type chosen for the current/next recording (best-effort until stop clears it). */
  getRecordedMimeType(): string {
    return this.activeBlobType;
  }

  /** File extension for download links (no dot). */
  getDownloadExtension(): "webm" | "m4a" | "aac" | "bin" {
    const mime =
      this.activeBlobType ||
      (this.mediaRecorder?.mimeType?.trim() ? this.mediaRecorder.mimeType : "");
    return extensionForRecorderMime(mime);
  }
}
