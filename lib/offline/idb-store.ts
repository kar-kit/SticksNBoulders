import { createMemoryStore } from "./memory-store";
import type { QueueStore, QueuedOp } from "./queue";

/**
 * The queue, on disk.
 *
 * Hand-rolled against the raw IndexedDB API rather than pulling in `idb`. The
 * whole surface is three operations on one object store, the repo has six
 * dependencies on purpose, and a wrapper would be more code to read than this.
 *
 * Everything is wrapped in one promise helper because IndexedDB is an event
 * API from 2010 and the rest of the codebase is not.
 */

const DB_NAME = "snb-offline";
const DB_VERSION = 1;
const STORE = "ops";

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
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB could not be opened"));
    // A second tab holding an old version open. Nothing to do but fail to the
    // memory store rather than hang the log screen forever.
    request.onblocked = () => reject(new Error("IndexedDB is blocked by another tab"));
  });
}

function transact<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const tx = db.transaction(STORE, mode);
  const done = run(tx.objectStore(STORE));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => done.then(resolve, reject);
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/**
 * The durable store, or the memory one where IndexedDB is unavailable.
 *
 * Private browsing, a locked-down browser, or a quota that is already full.
 * Losing the queue on reload is bad; refusing to let someone log their set
 * because their browser dislikes storage is worse, and only one of those is
 * visible to the athlete mid-session.
 */
export async function openQueueStore(): Promise<QueueStore> {
  if (typeof indexedDB === "undefined") return createMemoryStore();

  let db: IDBDatabase;
  try {
    db = await openDatabase();
  } catch {
    return createMemoryStore();
  }

  return {
    put: (op) => transact(db, "readwrite", (store) => promisify(store.put(op)).then(() => undefined)),
    remove: (id) => transact(db, "readwrite", (store) => promisify(store.delete(id))),
    all: () => transact(db, "readonly", (store) => promisify(store.getAll() as IDBRequest<QueuedOp[]>)),
  };
}
