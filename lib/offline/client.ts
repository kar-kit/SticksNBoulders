"use client";

import type { Actor } from "@/appwrite/documents";
import { openQueueStore } from "./idb-store";
import { runOp } from "./runner";
import {
  afterFailure,
  classify,
  collapsibleCreate,
  newOp,
  readyPrefix,
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
let actor: Actor | null = null;
let draining: Promise<void> | null = null;
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

async function refresh(open: QueueStore) {
  cache = await open.all();
  // Survives a reload: the counter picks up above whatever is still on disk, so
  // ops written before the refresh keep their place in front of new ones.
  for (const op of cache) sequence = Math.max(sequence, op.sequence + 1);
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

export function subscribeToQueue(listener: Listener): () => void {
  listeners.add(listener);
  listener(cache);
  return () => listeners.delete(listener);
}

export const queuedOps = (): QueuedOp[] => cache;

/** Writes the op down, then tries it. In that order, always. */
export async function enqueue(kind: OpKind, payload: Record<string, unknown>): Promise<void> {
  const open = await ready();
  const op = newOp(kind, payload, sequence++, `op-${Date.now()}-${sequence}`);
  await open.put(op);
  cache = [...cache, op];
  announce();
  heartbeat();
  void flush();
}

/**
 * Undo, for a write that has not been attempted yet.
 *
 * Returns false when the create has already been tried, in which case the
 * caller must queue a real delete: the attempt may have landed.
 */
export async function cancelQueued(kind: OpKind, rowId: string): Promise<boolean> {
  const open = await ready();
  const op = collapsibleCreate(cache, kind, rowId);
  if (!op) return false;
  await open.remove(op.id);
  cache = cache.filter((each) => each.id !== op.id);
  announce();
  return true;
}

/** Drains the queue head-first. One at a time: order is the guarantee. */
export function flush(force = false): Promise<void> {
  draining ??= drain(force).finally(() => {
    draining = null;
  });
  return draining;
}

async function drain(force: boolean): Promise<void> {
  if (!actor) return;
  const open = await ready();

  // Loops rather than taking one batch, because a set logged while the previous
  // one was still in flight would otherwise sit until the heartbeat -- and the
  // athlete who just tapped confirm is exactly who is owed a prompt send.
  for (let pass = 0; ; pass += 1) {
    const batch = force && pass === 0 ? cache.filter((op) => !op.permanentError) : readyPrefix(cache, Date.now());
    if (batch.length === 0) return;

    for (const op of batch) {
      try {
        await runOp(actor, op);
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
  draining = null;
  if (timer) clearInterval(timer);
  timer = null;
  listeners.clear();
}
