"use client";

import type { Actor } from "@/appwrite/documents";
import { openQueueStore } from "./idb-store";
import { runOp } from "./runner";
import {
  afterFailure,
  classify,
  newOp,
  opsDroppedByDelete,
  opsDroppedByRowDelete,
  pendingOps,
  readyPrefix,
  supersededRefresh,
  type DeletableRow,
  type OpKind,
  type QueueStore,
  type QueuedOp,
} from "./queue";

/**
 * The queue, wired to this device.
 *
 * One instance per tab. It holds the store, the sequence counter and the
 * listeners, and it is the only thing in the app that decides when to try the
 * network. Everything it decides with is in queue.ts, tested without a browser.
 *
 * On `navigator.onLine`: it is consulted as a hint and never as a gate. It
 * reports whether a network interface is up, not whether Appwrite is reachable,
 * and gym wifi that associates but routes nowhere reports online all session.
 * So writes are always attempted, and the real signal is the attempt failing.
 * The `online` event is still listened for, because when it does fire it is the
 * cheapest possible cue that waiting is over.
 */

type Listener = (ops: QueuedOp[]) => void;

let store: QueueStore | null = null;
let opening: Promise<QueueStore> | null = null;
let cache: QueuedOp[] = [];
let sequence = 0;
/** Who the queue sends as. Null once they sign out: nothing drains with nobody signed in. */
let actor: Actor | null = null;
/**
 * Whose ops this page reads and writes. Set by `attachQueue` and deliberately
 * kept by `detachQueue`, so a write that lands after sign-out (a clip finishing
 * its upload) is still stamped as the athlete who made it, never as nobody --
 * an op owned by nobody is adopted by whoever attaches next.
 */
let owner: string | null = null;
let draining: Promise<void> | null = null;
/** The op whose request is on the wire right now, so nothing drops it mid-send. */
let inFlight: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<Listener>();

/** While anything is waiting, check back. Covers the signal that returns without an event. */
const HEARTBEAT_MS = 5_000;

async function ready(): Promise<QueueStore> {
  if (store) return store;
  opening ??= openQueueStore().then((opened) => {
    store = opened;
    return opened;
  });
  return opening;
}

function announce() {
  for (const listener of listeners) listener(cache);
}

/** Whether an op belongs to whoever this page is attached as. */
const ownedHere = (op: QueuedOp): boolean => (op.ownerId ?? null) === owner;

async function refresh(open: QueueStore) {
  const everything = await open.all();
  // Survives a reload: the counter picks up above whatever is still on disk, so
  // ops written before the refresh keep their place in front of new ones.
  // Counted over every athlete's ops, not just this one's, so two people's
  // queues on one phone never share a sequence number.
  for (const op of everything) sequence = Math.max(sequence, op.sequence + 1);
  // Ops queued before ops carried an owner name nobody. They are adopted by the
  // first athlete to attach, and written back so the claim survives a reload.
  // On a phone with one athlete -- nearly all of them -- that is the right
  // owner; the alternative is stranding sets nobody can ever send.
  const adopted = owner
    ? await Promise.all(
        everything.map(async (op) => {
          if (op.ownerId !== undefined) return op;
          const claimed = { ...op, ownerId: owner as string };
          await open.put(claimed);
          return claimed;
        }),
      )
    : everything;
  // Everyone else's ops stay on disk, untouched, and out of this athlete's
  // screens: they are held, not dropped, until their owner signs back in here.
  cache = adopted.filter(ownedHere);
  announce();
}

function heartbeat() {
  if (typeof window === "undefined") return;
  if (timer || cache.length === 0) return;
  timer = setInterval(() => {
    if (cache.length === 0) {
      if (timer) clearInterval(timer);
      timer = null;
      return;
    }
    void flush();
  }, HEARTBEAT_MS);
}

/**
 * Loads whatever the last visit left behind.
 *
 * Called once when the athlete surface mounts. It is what turns "the phone died
 * mid-session" from lost sets into a flush that happens before they notice.
 */
export async function attachQueue(who: Actor): Promise<QueuedOp[]> {
  actor = who;
  owner = who.userId;
  // IndexedDB is evictable when the device is short of space, and what is in it
  // here is someone's training. Asking costs nothing and is ignored where it is
  // not supported.
  void navigator.storage?.persist?.().catch(() => false);
  const open = await ready();
  await refresh(open);
  heartbeat();
  void flush(true);
  return cache;
}

/**
 * Stops sending as the athlete who is signing out.
 *
 * Their ops stay on disk. Nothing is sent with nobody signed in, and the next
 * athlete to attach sees only their own -- see `refresh`. When the same
 * athlete signs back in on this phone, theirs flush as if nothing happened.
 */
export function detachQueue(): void {
  actor = null;
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * Whether the signed-in athlete has writes still waiting to reach Appwrite.
 *
 * Permanently refused ops are left out: they will not send on the next sign-in
 * either, and the log screen already says so.
 */
export const hasUnsynced = (): boolean => pendingOps(cache).length > 0;

export function subscribeToQueue(listener: Listener): () => void {
  listeners.add(listener);
  listener(cache);
  return () => listeners.delete(listener);
}

export const queuedOps = (): QueuedOp[] => cache;

/** Writes the op down, then tries it. In that order, always. */
export async function enqueue(kind: OpKind, payload: Record<string, unknown>): Promise<void> {
  const open = await ready();
  const next = sequence++;
  // Padded because the id is IndexedDB's key and getAll returns by key: unpadded,
  // op-<t>-10 comes back ahead of op-<t>-9. The drain sorts by `sequence` anyway;
  // this keeps what is on disk readable in the same order.
  const op = newOp(kind, payload, next, `op-${Date.now()}-${String(next).padStart(8, "0")}`, Date.now(), owner);
  await open.put(op);
  cache = [...cache, op];
  announce();
  heartbeat();
  void flush();
}

/**
 * Takes a set out of the queue ahead of deleting it.
 *
 * Returns whether the set may already exist on the server -- if so the caller
 * queues a real delete. See `opsDroppedByDelete` for which ops go.
 */
export async function withdrawSet(setId: string): Promise<{ landed: boolean }> {
  const open = await ready();
  const { drop, landed } = opsDroppedByDelete(cache, setId, inFlight);
  // Out of memory first, synchronously, then off the disk. The drain decides
  // what to send from the cache, and the disk takes a tick per delete: in that
  // gap a drain that had moved on would still find the op and send it, after
  // this has already answered "never landed" and no delete is coming behind.
  const gone = new Set(drop.map((op) => op.id));
  if (gone.size > 0) {
    cache = cache.filter((each) => !gone.has(each.id));
    announce();
  }
  for (const op of drop) await open.remove(op.id);
  return { landed };
}

/**
 * Takes a session or an exercise out of the queue ahead of deleting it.
 *
 * `withdrawSet`'s twin, with the same in-memory-first ordering and the same
 * answer: whether the row may already exist on the server, in which case the
 * caller queues a real delete behind whatever is left.
 */
export async function withdrawRow(row: DeletableRow, rowId: string): Promise<{ landed: boolean }> {
  const open = await ready();
  const { drop, landed } = opsDroppedByRowDelete(cache, row, rowId, inFlight);
  const gone = new Set(drop.map((op) => op.id));
  if (gone.size > 0) {
    cache = cache.filter((each) => !gone.has(each.id));
    announce();
  }
  for (const op of drop) await open.remove(op.id);
  return { landed };
}

/**
 * Lets go of ops that failed permanently and carry nothing worth keeping.
 *
 * Failed ops are normally kept forever, because each is a set that did not
 * reach the coach. A delete the server refused is the opposite: the set is
 * still there, nothing was lost, and once the athlete has read why, the
 * notice has done its job.
 */
export async function dismissFailed(ids: readonly string[]): Promise<void> {
  const open = await ready();
  const targets = new Set(ids);
  const removable = cache.filter((op) => targets.has(op.id) && op.permanentError);
  for (const op of removable) await open.remove(op.id);
  if (removable.length === 0) return;
  const gone = new Set(removable.map((op) => op.id));
  cache = cache.filter((each) => !gone.has(each.id));
  announce();
}

/** Drains the queue head-first. One at a time: order is the guarantee. */
export function flush(force = false): Promise<void> {
  draining ??= drain(force).finally(() => {
    draining = null;
  });
  return draining;
}

async function drain(force: boolean): Promise<void> {
  // Captured once: a drain started as one athlete never finishes as another.
  const who = actor;
  if (!who) return;
  const open = await ready();

  // Loops rather than taking one batch, because a set logged while the previous
  // one was still in flight would otherwise sit until the heartbeat -- and the
  // athlete who just tapped confirm is exactly who is owed a prompt send.
  for (let pass = 0; ; pass += 1) {
    // Both paths sort by the stored sequence. The cache is in whatever order the
    // store returned it, and IndexedDB returns by key, not by when it was queued.
    const batch = force && pass === 0 ? pendingOps(cache) : readyPrefix(cache, Date.now());
    if (batch.length === 0) return;

    for (const op of batch) {
      // The batch is a snapshot. An op withdrawn since it was taken -- a set
      // deleted while an earlier op was sending -- must not be sent anyway.
      if (!cache.some((each) => each.id === op.id)) continue;
      // Signed out, or someone else signed in, since this drain began. Stop:
      // whatever is left is sent by the next drain, as whoever owns it.
      if (actor !== who) return;
      try {
        // A rollup refresh with a later one behind it would recompute a week
        // that is about to be recomputed again. Dropped rather than run, and
        // only ever the earlier one, so the survivor still runs after the sets.
        if (supersededRefresh(cache, op)) {
          await settle(open, op);
          continue;
        }
        inFlight = op.id;
        try {
          await runOp(who, op);
        } finally {
          inFlight = null;
        }
        await settle(open, op);
      } catch (error) {
        const outcome = classify(error);
        if (outcome === "done") {
          await settle(open, op);
          continue;
        }
        const next = afterFailure(op, outcome, error);
        await open.put(next);
        cache = cache.map((each) => (each.id === op.id ? next : each));
        announce();
        // A retryable failure means the network is gone, so everything behind
        // this would fail the same way. Stop and let the backoff do its job.
        if (outcome === "retry") return;
      }
    }
  }
}

async function settle(open: QueueStore, op: QueuedOp) {
  await open.remove(op.id);
  cache = cache.filter((each) => each.id !== op.id);
  announce();
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void flush(true));
  // Coming back to the tab is the other moment worth trying: a phone that slept
  // through the rest between sets fires no network event on waking.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flush(true);
  });
}

/** Test seam. Nothing in the app calls this. */
export function resetQueueForTests(next: QueueStore | null = null) {
  store = next;
  opening = next ? Promise.resolve(next) : null;
  cache = [];
  sequence = 0;
  actor = null;
  owner = null;
  draining = null;
  inFlight = null;
  if (timer) clearInterval(timer);
  timer = null;
  listeners.clear();
}
