"use client";

/**
 * Clips that started uploading and have not finished.
 *
 * The blob itself is kept, not just a reference: a `File` from an `<input>` is
 * gone the moment the page reloads, and an upload you cannot resume after a
 * reload only survives the failures that were never going to lose it anyway.
 * IndexedDB stores Blobs, which is what makes resume real.
 *
 * Separate database from the offline write queue on purpose. That one holds
 * small rows and must stay fast and evictable-last; this one holds tens of
 * megabytes per entry, and mixing a 40MB blob into the store the logger reads
 * on every render is how the log screen gets slow on a phone.
 *
 * Hand-rolled against raw IndexedDB to match lib/offline/idb-store.ts -- the
 * repo has six dependencies on purpose and this is four operations.
 */

const DB_NAME = "snb-video";
const DB_VERSION = 1;
const STORE = "pending";

export interface PendingUpload {
  /** The storage file id, which is also Appwrite's upload id. The key. */
  fileId: string;
  setId: string;
  athleteId: string;
  name: string;
  type: string;
  size: number;
  blob: Blob;
  /** Epoch ms, so a stale entry can be aged out rather than retried forever. */
  startedAt: number;
  attempts: number;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "fileId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB could not be opened"));
    request.onblocked = () => reject(new Error("IndexedDB is blocked by another tab"));
  });
}

function transact<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const tx = db.transaction(STORE, mode);
  const done = run(tx.objectStore(STORE));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => done.then(resolve, reject);
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/**
 * Every operation swallows its own failure.
 *
 * A browser that refuses storage -- private mode, a full quota, a locked-down
 * device -- must cost the athlete resume, not the ability to attach a video at
 * all. The upload still runs; it just cannot be picked up again.
 */
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
  fallback: T,
): Promise<T> {
  if (typeof indexedDB === "undefined") return fallback;
  try {
    const db = await openDatabase();
    try {
      return await transact(db, mode, run);
    } finally {
      db.close();
    }
  } catch {
    return fallback;
  }
}

export async function rememberUpload(entry: PendingUpload): Promise<void> {
  await withStore("readwrite", async (store) => void (await promisify(store.put(entry))), undefined);
}

export async function forgetUpload(fileId: string): Promise<void> {
  await withStore("readwrite", async (store) => void (await promisify(store.delete(fileId))), undefined);
}

export async function pendingUploads(): Promise<PendingUpload[]> {
  return withStore(
    "readonly",
    async (store) => (await promisify(store.getAll())) as PendingUpload[],
    [],
  );
}

export async function recordAttempt(fileId: string): Promise<void> {
  await withStore(
    "readwrite",
    async (store) => {
      const existing = (await promisify(store.get(fileId))) as PendingUpload | undefined;
      if (existing) await promisify(store.put({ ...existing, attempts: existing.attempts + 1 }));
    },
    undefined,
  );
}
