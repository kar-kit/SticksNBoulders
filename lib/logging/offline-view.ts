import type { QueuedOp } from "@/lib/offline/queue";
import { pendingOps } from "@/lib/offline/queue";
import type { SessionRecord } from "./session";
import type { UnnamedSet } from "./session-store";

/**
 * What the queue looks like as training.
 *
 * Appwrite does not know about a set logged in a basement, so every read has to
 * be told. This is the telling: the queue projected back into the same shapes
 * the screens already render, so an unsynced session is a session and an
 * unsynced set is a set. Nothing here is a special offline mode -- there is no
 * offline mode, only rows that have arrived and rows that have not.
 *
 * The projection lives here rather than in lib/offline because the queue knows
 * about ops and nothing else. The dependency runs one way.
 */

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number => (typeof value === "number" ? value : 0);
const date = (value: unknown): Date | null => {
  const parsed = new Date(str(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/** Sessions that exist on the device and not yet on the server. */
export function queuedSessions(ops: readonly QueuedOp[]): SessionRecord[] {
  const sessions = new Map<string, SessionRecord>();

  for (const op of pendingOps(ops)) {
    if (op.kind === "session.create") {
      const startedAt = date(op.payload.startedAt);
      const id = str(op.payload.sessionId);
      if (!startedAt || !id) continue;
      sessions.set(id, {
        id,
        clientSessionId: id,
        startedAt,
        finishedAt: null,
        setCount: 0,
        tonnageKg: 0,
        notes: null,
      });
    }
    if (op.kind === "session.finish") {
      // A finish can outlive its create in the queue only if the create landed,
      // in which case the server already has the session and this is a no-op.
      const existing = sessions.get(str(op.payload.sessionId));
      if (!existing) continue;
      existing.finishedAt = date(op.payload.finishedAt);
      existing.setCount = num(op.payload.setCount);
      existing.tonnageKg = num(op.payload.tonnageKg);
    }
  }

  return [...sessions.values()];
}

/** Sets of one session that are still on their way, minus any already undone. */
export function queuedSets(ops: readonly QueuedOp[], sessionId: string): UnnamedSet[] {
  const queue = pendingOps(ops);
  const removed = new Set(
    queue.filter((op) => op.kind === "set.delete").map((op) => str(op.payload.setId)),
  );

  return queue
    .filter((op) => op.kind === "set.create" && str(op.payload.sessionId) === sessionId)
    .map((op) => {
      const loggedAt = date(op.payload.loggedAt);
      const clientSetId = str(op.payload.setId);
      if (!loggedAt || !clientSetId || removed.has(clientSetId)) return null;
      return {
        exerciseId: str(op.payload.exerciseId),
        clientSetId,
        loadKg: num(op.payload.loadKg),
        reps: num(op.payload.reps),
        rpe: typeof op.payload.rpe === "number" ? op.payload.rpe : null,
        isWarmup: op.payload.isWarmup === true,
        loggedAt,
      } satisfies UnnamedSet;
    })
    .filter((set): set is UnnamedSet => set !== null);
}

/** Sets undone on the device whose delete has not reached Appwrite yet. */
export function deletedIds(ops: readonly QueuedOp[]): Set<string> {
  return new Set(
    pendingOps(ops)
      .filter((op) => op.kind === "set.delete")
      .map((op) => str(op.payload.setId)),
  );
}

/** Client ids the server has not confirmed, so their rows can carry a mark. */
export function unsyncedIds(ops: readonly QueuedOp[]): Set<string> {
  const ids = new Set<string>();
  for (const op of pendingOps(ops)) {
    const id = str(op.payload.setId) || str(op.payload.sessionId);
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Merges what the server returned with what is still queued.
 *
 * The server wins on any row it knows about: it has the authoritative copy, and
 * a queued op that has already landed is a duplicate waiting to be noticed.
 */
export function mergeById<T>(fromServer: T[], fromQueue: T[], idOf: (row: T) => string): T[] {
  const seen = new Set(fromServer.map(idOf));
  return [...fromServer, ...fromQueue.filter((row) => !seen.has(idOf(row)))];
}
