/**
 * On-device store for loopstation session recordings (works fully offline).
 * MediaRecorder chunks are appended as they arrive, so a crash or tab kill keeps
 * everything up to the last ~1 s chunk. IndexedDB (not OPFS) for Safari parity.
 */

const DB_NAME = "kite-local-recordings";
const DB_VERSION = 1;
const RECORDINGS_STORE = "recordings";
const CHUNKS_STORE = "chunks";

export type LocalRecordingStatus = "recording" | "complete" | "recovered";

export type LocalRecordingMeta = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  mimeType: string;
  ext: string;
  captureMode: string;
  status: LocalRecordingStatus;
  durationMs: number | null;
  sizeBytes: number;
  chunkCount: number;
};

type ChunkRow = { recordingId: string; seq: number; blob: Blob };

export type LocalStorageEstimate = { usageBytes: number; quotaBytes: number };

/** Warn before recording when free space drops under this. */
export const LOCAL_RECORDINGS_LOW_SPACE_BYTES = 200 * 1024 * 1024;

const listeners = new Set<() => void>();
let dbPromise: Promise<IDBDatabase> | null = null;

export function isLocalRecordingsStoreSupported(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(RECORDINGS_STORE)) {
        db.createObjectStore(RECORDINGS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
        db.createObjectStore(CHUNKS_STORE, { keyPath: ["recordingId", "seq"] });
      }
    };
  }).catch((err: unknown) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function chunkRange(recordingId: string): IDBKeyRange {
  return IDBKeyRange.bound([recordingId, 0], [recordingId, Number.MAX_SAFE_INTEGER]);
}

function notifyChanged(): void {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      /* listener errors must not break writes */
    }
  });
}

export function subscribeLocalRecordings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function defaultTitle(createdAt: number): string {
  const d = new Date(createdAt);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `Session ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function newRecordingId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `rec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function createLocalRecording(meta: {
  mimeType: string;
  ext: string;
  captureMode: string;
}): Promise<LocalRecordingMeta> {
  const db = await openDb();
  const now = Date.now();
  const row: LocalRecordingMeta = {
    id: newRecordingId(),
    title: defaultTitle(now),
    createdAt: now,
    updatedAt: now,
    mimeType: meta.mimeType,
    ext: meta.ext,
    captureMode: meta.captureMode,
    status: "recording",
    durationMs: null,
    sizeBytes: 0,
    chunkCount: 0,
  };
  const tx = db.transaction(RECORDINGS_STORE, "readwrite");
  tx.objectStore(RECORDINGS_STORE).put(row);
  await txDone(tx);
  notifyChanged();
  return row;
}

/** Appends one MediaRecorder chunk and bumps size/count in the same transaction. */
export async function appendLocalRecordingChunk(
  recordingId: string,
  seq: number,
  blob: Blob
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([RECORDINGS_STORE, CHUNKS_STORE], "readwrite");
  tx.objectStore(CHUNKS_STORE).put({ recordingId, seq, blob } satisfies ChunkRow);
  const recordings = tx.objectStore(RECORDINGS_STORE);
  const metaReq = recordings.get(recordingId);
  metaReq.onsuccess = () => {
    const meta = metaReq.result as LocalRecordingMeta | undefined;
    if (!meta) return;
    recordings.put({
      ...meta,
      sizeBytes: meta.sizeBytes + blob.size,
      chunkCount: Math.max(meta.chunkCount, seq + 1),
      updatedAt: Date.now(),
    } satisfies LocalRecordingMeta);
  };
  await txDone(tx);
}

async function patchRecording(
  recordingId: string,
  patch: Partial<LocalRecordingMeta>
): Promise<LocalRecordingMeta | null> {
  const db = await openDb();
  const tx = db.transaction(RECORDINGS_STORE, "readwrite");
  const store = tx.objectStore(RECORDINGS_STORE);
  const meta = (await requestToPromise(store.get(recordingId))) as LocalRecordingMeta | undefined;
  if (!meta) {
    await txDone(tx);
    return null;
  }
  const next: LocalRecordingMeta = { ...meta, ...patch, updatedAt: Date.now() };
  store.put(next);
  await txDone(tx);
  notifyChanged();
  return next;
}

export function finalizeLocalRecording(
  recordingId: string,
  info: { durationMs: number | null }
): Promise<LocalRecordingMeta | null> {
  return patchRecording(recordingId, {
    status: "complete",
    durationMs: info.durationMs,
  });
}

export function renameLocalRecording(
  recordingId: string,
  title: string
): Promise<LocalRecordingMeta | null> {
  const trimmed = title.trim();
  return patchRecording(recordingId, trimmed ? { title: trimmed } : {});
}

export async function listLocalRecordings(): Promise<LocalRecordingMeta[]> {
  if (!isLocalRecordingsStoreSupported()) return [];
  const db = await openDb();
  const tx = db.transaction(RECORDINGS_STORE, "readonly");
  const rows = (await requestToPromise(
    tx.objectStore(RECORDINGS_STORE).getAll()
  )) as LocalRecordingMeta[];
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

/** Chunks concatenate in seq order into a playable file (first chunk carries the container header). */
export async function getLocalRecordingBlob(recordingId: string): Promise<Blob | null> {
  const db = await openDb();
  const tx = db.transaction([RECORDINGS_STORE, CHUNKS_STORE], "readonly");
  const meta = (await requestToPromise(
    tx.objectStore(RECORDINGS_STORE).get(recordingId)
  )) as LocalRecordingMeta | undefined;
  const chunks = (await requestToPromise(
    tx.objectStore(CHUNKS_STORE).getAll(chunkRange(recordingId))
  )) as ChunkRow[];
  if (!meta || chunks.length === 0) return null;
  chunks.sort((a, b) => a.seq - b.seq);
  return new Blob(
    chunks.map((c) => c.blob),
    { type: meta.mimeType || chunks[0].blob.type || "application/octet-stream" }
  );
}

export async function deleteLocalRecording(recordingId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([RECORDINGS_STORE, CHUNKS_STORE], "readwrite");
  tx.objectStore(CHUNKS_STORE).delete(chunkRange(recordingId));
  tx.objectStore(RECORDINGS_STORE).delete(recordingId);
  await txDone(tx);
  notifyChanged();
}

/**
 * Takes left in "recording" by a crash/tab kill become "recovered" (or are dropped if empty).
 * Call once on mount; rows created at/after `createdBefore` (a take started since mount) are skipped.
 */
export async function recoverUnfinishedLocalRecordings(createdBefore: number): Promise<number> {
  if (!isLocalRecordingsStoreSupported()) return 0;
  const rows = await listLocalRecordings();
  let recovered = 0;
  for (const row of rows) {
    if (row.status !== "recording" || row.createdAt >= createdBefore) continue;
    if (row.chunkCount === 0 || row.sizeBytes === 0) {
      await deleteLocalRecording(row.id);
      continue;
    }
    await patchRecording(row.id, { status: "recovered" });
    recovered += 1;
  }
  return recovered;
}

/** Ask the browser not to evict recordings under storage pressure (best-effort). */
export async function requestPersistentLocalStorage(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function getLocalStorageEstimate(): Promise<LocalStorageEstimate | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    return { usageBytes: usage ?? 0, quotaBytes: quota ?? 0 };
  } catch {
    return null;
  }
}
