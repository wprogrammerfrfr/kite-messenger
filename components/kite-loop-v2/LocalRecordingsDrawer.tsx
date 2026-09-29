"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Download, HardDrive, Pause, Play, Share2, Trash2, X } from "lucide-react";

import {
  LOCAL_RECORDINGS_LOW_SPACE_BYTES,
  deleteLocalRecording,
  getLocalRecordingBlob,
  getLocalStorageEstimate,
  listLocalRecordings,
  subscribeLocalRecordings,
  type LocalRecordingMeta,
  type LocalStorageEstimate,
} from "@/lib/local-recordings-store";
import { shareOrDownloadBlob } from "@/lib/studio-mobile-share";

type LocalRecordingsDrawerProps = {
  open: boolean;
  onClose: () => void;
};

const SPRING = { type: "spring", stiffness: 380, damping: 36 } as const;

function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "--:--";
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function exportFilename(row: LocalRecordingMeta): string {
  const stamp = new Date(row.createdAt).toISOString().replace(/[:.]/g, "-");
  return `kite-loop-session-${stamp}.${row.ext || "webm"}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function LocalRecordingsDrawer({
  open,
  onClose,
}: LocalRecordingsDrawerProps): React.JSX.Element | null {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [rows, setRows] = useState<LocalRecordingMeta[]>([]);
  const [estimate, setEstimate] = useState<LocalStorageEstimate | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<{ id: string; url: string; isVideo: boolean } | null>(
    null
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const playingUrlRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, est] = await Promise.all([listLocalRecordings(), getLocalStorageEstimate()]);
      setRows(list);
      setEstimate(est);
      setLoadError(null);
    } catch {
      setLoadError("On-device storage is unavailable in this browser mode.");
    }
  }, []);

  const stopPlayback = useCallback(() => {
    if (playingUrlRef.current) {
      URL.revokeObjectURL(playingUrlRef.current);
      playingUrlRef.current = null;
    }
    setPlaying(null);
  }, []);

  useEffect(() => {
    if (!open) {
      stopPlayback();
      setConfirmDeleteId(null);
      return;
    }
    void refresh();
    return subscribeLocalRecordings(() => {
      void refresh();
    });
  }, [open, refresh, stopPlayback]);

  useEffect(() => stopPlayback, [stopPlayback]);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  const withBlob = useCallback(
    async (row: LocalRecordingMeta, action: (blob: Blob) => Promise<void> | void) => {
      setBusyId(row.id);
      try {
        const blob = await getLocalRecordingBlob(row.id);
        if (!blob) {
          setLoadError("This recording has no audio data.");
          return;
        }
        await action(blob);
      } finally {
        setBusyId(null);
      }
    },
    []
  );

  const handlePlay = useCallback(
    (row: LocalRecordingMeta) => {
      if (playing?.id === row.id) {
        stopPlayback();
        return;
      }
      void withBlob(row, (blob) => {
        stopPlayback();
        const url = URL.createObjectURL(blob);
        playingUrlRef.current = url;
        setPlaying({ id: row.id, url, isVideo: blob.type.startsWith("video/") });
      });
    },
    [playing?.id, stopPlayback, withBlob]
  );

  const handleShare = useCallback(
    (row: LocalRecordingMeta) => {
      void withBlob(row, async (blob) => {
        await shareOrDownloadBlob(blob, exportFilename(row));
      });
    },
    [withBlob]
  );

  const handleDownload = useCallback(
    (row: LocalRecordingMeta) => {
      void withBlob(row, (blob) => downloadBlob(blob, exportFilename(row)));
    },
    [withBlob]
  );

  const handleDelete = useCallback(
    async (row: LocalRecordingMeta) => {
      if (confirmDeleteId !== row.id) {
        setConfirmDeleteId(row.id);
        return;
      }
      setConfirmDeleteId(null);
      if (playing?.id === row.id) stopPlayback();
      setBusyId(row.id);
      try {
        await deleteLocalRecording(row.id);
      } finally {
        setBusyId(null);
      }
    },
    [confirmDeleteId, playing?.id, stopPlayback]
  );

  const usageRatio =
    estimate && estimate.quotaBytes > 0
      ? Math.min(1, estimate.usageBytes / estimate.quotaBytes)
      : 0;
  const lowSpace =
    estimate != null &&
    estimate.quotaBytes > 0 &&
    estimate.quotaBytes - estimate.usageBytes < LOCAL_RECORDINGS_LOW_SPACE_BYTES;
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.canShare === "function";

  if (!portalTarget) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="local-recordings-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={SPRING}
            onClick={onClose}
            className="fixed inset-0 z-[70] bg-black/60"
            aria-hidden
          />
          <motion.aside
            key="local-recordings-drawer"
            role="dialog"
            aria-label="My Recordings"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={SPRING}
            className="fixed bottom-0 right-0 top-0 z-[71] flex w-full max-w-md flex-col border-l border-white/10 bg-zinc-950 text-zinc-100"
            style={{
              paddingTop: "env(safe-area-inset-top, 0px)",
              paddingBottom: "env(safe-area-inset-bottom, 0px)",
            }}
          >
            <header className="flex items-center justify-between border-b border-white/10 px-6 py-5">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Saved on this device
                </p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight">My Recordings</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-lg border border-white/10 p-2 text-zinc-400 transition hover:text-zinc-100"
              >
                <X size={16} />
              </button>
            </header>

            <div className="border-b border-white/10 px-6 py-4">
              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <HardDrive size={12} /> Storage
                </span>
                <span className="font-mono tabular-nums">
                  {estimate
                    ? `${formatBytes(estimate.usageBytes)} / ${formatBytes(estimate.quotaBytes)}`
                    : "--"}
                </span>
              </div>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full ${lowSpace ? "bg-amber-400" : "bg-zinc-300"}`}
                  style={{ width: `${Math.max(2, usageRatio * 100)}%` }}
                />
              </div>
              {lowSpace ? (
                <p className="mt-2 text-[11px] text-amber-300/90">
                  Low space: export or delete recordings before your next long take.
                </p>
              ) : null}
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              {loadError ? (
                <p className="px-2 py-3 text-[12px] text-red-300/90">{loadError}</p>
              ) : null}
              {rows.length === 0 && !loadError ? (
                <p className="px-2 py-10 text-center text-sm text-zinc-500">
                  No recordings yet. Session recordings save here automatically, even offline.
                </p>
              ) : null}
              <ul className="flex flex-col gap-2">
                {rows.map((row) => {
                  const isPlaying = playing?.id === row.id;
                  const isBusy = busyId === row.id;
                  const isLive = row.status === "recording";
                  return (
                    <li
                      key={row.id}
                      className="rounded-xl border border-white/10 bg-zinc-900/40 px-4 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-zinc-100">{row.title}</p>
                          <p className="mt-0.5 font-mono text-[11px] tabular-nums text-zinc-500">
                            {formatDuration(row.durationMs)} · {formatBytes(row.sizeBytes)} ·{" "}
                            {row.captureMode === "audio-only" ? "Audio" : "Video"}
                          </p>
                        </div>
                        {row.status === "recovered" ? (
                          <span className="shrink-0 rounded-md border border-amber-400/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                            Recovered
                          </span>
                        ) : isLive ? (
                          <span className="shrink-0 rounded-md border border-red-400/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-300">
                            Recording
                          </span>
                        ) : null}
                      </div>

                      {isPlaying && playing ? (
                        playing.isVideo ? (
                          <video
                            src={playing.url}
                            controls
                            autoPlay
                            playsInline
                            className="mt-3 w-full rounded-lg bg-black"
                          />
                        ) : (
                          <audio src={playing.url} controls autoPlay className="mt-3 w-full" />
                        )
                      ) : null}

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={isBusy || isLive}
                          onClick={() => handlePlay(row)}
                          className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[11px] text-zinc-200 transition hover:bg-white/5 disabled:opacity-40"
                        >
                          {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                          {isPlaying ? "Close" : "Play"}
                        </button>
                        {canNativeShare ? (
                          <button
                            type="button"
                            disabled={isBusy || isLive}
                            onClick={() => handleShare(row)}
                            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[11px] text-zinc-200 transition hover:bg-white/5 disabled:opacity-40"
                          >
                            <Share2 size={12} /> Share
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={isBusy || isLive}
                          onClick={() => handleDownload(row)}
                          className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[11px] text-zinc-200 transition hover:bg-white/5 disabled:opacity-40"
                        >
                          <Download size={12} /> Save file
                        </button>
                        <button
                          type="button"
                          disabled={isBusy || isLive}
                          onClick={() => void handleDelete(row)}
                          className={`ml-auto flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] transition disabled:opacity-40 ${
                            confirmDeleteId === row.id
                              ? "border-red-500/50 text-red-300"
                              : "border-white/10 text-zinc-400 hover:text-zinc-200"
                          }`}
                        >
                          <Trash2 size={12} />
                          {confirmDeleteId === row.id ? "Confirm" : "Delete"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>,
    portalTarget
  );
}
