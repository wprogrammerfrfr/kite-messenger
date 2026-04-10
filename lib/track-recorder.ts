const TRACK_RECORDER_MIME_TYPE = "audio/webm;codecs=opus";
const TRACK_RECORDER_AUDIO_BITS_PER_SECOND = 320000;

export class TrackRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private startedAt = 0;

  start(stream: MediaStream): void {
    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      throw new Error("TrackRecorder is already recording.");
    }

    if (!MediaRecorder.isTypeSupported(TRACK_RECORDER_MIME_TYPE)) {
      throw new Error("audio/webm;codecs=opus is not supported in this browser.");
    }

    this.chunks = [];
    this.mediaRecorder = new MediaRecorder(stream, {
      mimeType: TRACK_RECORDER_MIME_TYPE,
      audioBitsPerSecond: TRACK_RECORDER_AUDIO_BITS_PER_SECOND,
    });

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
    if (!recorder || recorder.state !== "recording") {
      return Promise.reject(new Error("TrackRecorder is not recording."));
    }

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
        const blob = new Blob(this.chunks, { type: TRACK_RECORDER_MIME_TYPE });
        this.mediaRecorder = null;
        resolve(blob);
      };

      const handleError = (event: Event): void => {
        if (settled) return;
        settled = true;
        cleanup();
        this.mediaRecorder = null;
        const target = event as any;
        reject(target.error ?? new Error("MediaRecorder failed."));
      };

      recorder.addEventListener("stop", handleStop);
      recorder.addEventListener("error", handleError as EventListener);
      recorder.stop();
    });
  }

  getTimestamp(): number {
    return this.startedAt;
  }
}
