/**
 * IndexedDB cache for last decrypted messages (offline read-up).
 * Device-local only; cleared on logout by overwriting on next login.
 */

const DB_NAME = "kite-offline-v1";
const STORE = "message_snapshots";
const MAX_MESSAGES = 50;

export type CachedChatMessage = {
  id: string | number;
  text: string;
  isSessionMode: boolean;
  createdAt?: string;
  isImage?: boolean;
  imageUrl?: string;
  isFile?: boolean;
  fileUrl?: string;
  fileName?: string;
  fileMime?: string;
  senderId?: string | null;
  receiverId?: string | null;
  isRead?: boolean | null;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "userId" });
      }
    };
  });
}

type Row = { userId: string; messages: CachedChatMessage[]; updatedAt: number };

export async function saveMessagesSnapshot(
  userId: string,
  messages: CachedChatMessage[]
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    const slice = messages.slice(-MAX_MESSAGES);
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({
      userId,
      messages: slice,
      updatedAt: Date.now(),
    } satisfies Row);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {
    // ignore quota / private mode
  }
}

export async function loadMessagesSnapshot(userId: string): Promise<CachedChatMessage[] | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openDb();
    const row = await new Promise<Row | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(userId);
      req.onsuccess = () => resolve(req.result as Row | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return row?.messages ?? null;
  } catch {
    return null;
  }
}
