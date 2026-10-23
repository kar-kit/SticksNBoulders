import type { QueuedOp } from "@/lib/offline/queue";
import { failedOps, pendingOps } from "@/lib/offline/queue";
import { EXERCISE_IN_USE, SESSION_HAS_SETS, SET_HAS_COACH_COMMENTS } from "@/appwrite/documents/write";
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
        programDayId: str(op.payload.programDayId) || null,
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

  return applyQueuedSessionEdits([...sessions.values()], ops);
}

/**
 * Sessions as the athlete last left them, with edits and deletes from History
 * that have not reached Appwrite yet.
 *
 * Applied over the server's copy as well as the queue's. A rename or a set
 * correction made in a basement is a session that has been renamed or
 * corrected, not one that will be later -- the same rule as everywhere else
 * in this file. A session whose delete is queued is simply not there.
 */
export function applyQueuedSessionEdits(sessions: readonly SessionRecord[], ops: readonly QueuedOp[]): SessionRecord[] {
  const pending = pendingOps(ops);
  const deleted = new Set(
    pending.filter((op) => op.kind === "session.delete").map((op) => str(op.payload.sessionId)),
  );
  const updates = pending.filter((op) => op.kind === "session.update");
  if (deleted.size === 0 && updates.length === 0) return [...sessions];

  return sessions
    .filter((session) => !deleted.has(session.id))
    .map((session) => {
      let next = session;
      for (const op of updates) {
        if (str(op.payload.sessionId) !== session.id) continue;
        const p = op.payload;
        next = {
          ...next,
          ...("name" in p && { name: typeof p.name === "string" && p.name.trim() ? p.name : null }),
          ...("notes" in p && { notes: typeof p.notes === "string" && p.notes.trim() ? p.notes : null }),
          ...(typeof p.setCount === "number" &&
            typeof p.tonnageKg === "number" && { setCount: p.setCount, tonnageKg: p.tonnageKg }),
        };
      }
      return next;
    });
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
        setIndex: num(op.payload.setIndex) || undefined,
        loadKg: num(op.payload.loadKg),
        reps: num(op.payload.reps),
        rpe: typeof op.payload.rpe === "number" ? op.payload.rpe : null,
        isWarmup: op.payload.isWarmup === true,
        loggedAt,
        ...(str(op.payload.prescriptionId) ? { prescriptionId: str(op.payload.prescriptionId) } : {}),
        ...(str(op.payload.notes) ? { notes: str(op.payload.notes) } : {}),
      } satisfies UnnamedSet;
    })
    .filter((set) => set !== null);
}

/** A logged set's values as an edit leaves them. The shape `editSet` queues. */
export interface SetValues {
  loadKg: number;
  reps: number;
  rpe: number | null;
  isWarmup: boolean;
  /**
   * The athlete's note (F11). Absent when the edit did not touch it -- the
   * warm-up flip restates the four numbers and nothing else -- so laying an
   * edit over a set never drops a note it did not mean to. Null is a note
   * cleared.
   */
  notes?: string | null;
}

/**
 * Sets with edits laid over them, keyed by client set id. With no edits the
 * list itself comes back, and sets without one come back as they were, so a
 * memo downstream stays put.
 */
export function withSetEdits<T extends { clientSetId: string } & SetValues>(
  sets: readonly T[],
  edits: ReadonlyMap<string, SetValues>,
): readonly T[] {
  if (edits.size === 0) return sets;
  return sets.map((set) => {
    const edit = edits.get(set.clientSetId);
    return edit ? { ...set, ...edit } : set;
  });
}

/**
 * Corrections queued and not yet at Appwrite, latest per set: the warm-up
 * flag flipped in the logger, a set corrected in History. A reload with no
 * signal reads the set from its queued create (or the server's last copy),
 * which predates the edit; this is what puts the edit back on screen.
 */
export function queuedSetEdits(ops: readonly QueuedOp[]): Map<string, SetValues> {
  const edits = new Map<string, SetValues>();
  for (const op of pendingOps(ops)) {
    if (op.kind !== "set.update") continue;
    const id = str(op.payload.setId);
    if (!id) continue;
    // Laid over the set's earlier edits rather than replacing them: a note
    // written, then the set number tapped, is two queued updates, and only
    // the first says anything about the note. The latest wins on what it
    // carries; what it leaves out comes from the one before.
    edits.set(id, {
      ...edits.get(id),
      loadKg: num(op.payload.loadKg),
      reps: num(op.payload.reps),
      rpe: typeof op.payload.rpe === "number" ? op.payload.rpe : null,
      isWarmup: op.payload.isWarmup === true,
      ...("notes" in op.payload && { notes: str(op.payload.notes) || null }),
    });
  }
  return edits;
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

/**
 * Deletes the server refused because a coach had already commented on the set.
 *
 * Keyed by set id, valued by op id so the notice can be dismissed. These are
 * failed ops but not lost work -- the set is still there, which is the point --
 * so the screen tells them apart from the failures that mean a set did not
 * reach the coach.
 */
export function refusedDeletes(ops: readonly QueuedOp[]): Map<string, string> {
  const refused = new Map<string, string>();
  for (const op of failedOps(ops)) {
    if (op.kind === "set.delete" && op.permanentError === SET_HAS_COACH_COMMENTS) {
      refused.set(str(op.payload.setId), op.id);
    }
  }
  return refused;
}

/**
 * Deletes refused because the thing still matters -- a set the coach spoke
 * about, a session that kept such a set, an exercise something is logged
 * against. Nothing was lost in any of them; the row is still there.
 */
const REFUSALS: ReadonlyArray<[QueuedOp["kind"], string]> = [
  ["set.delete", SET_HAS_COACH_COMMENTS],
  ["session.delete", SESSION_HAS_SETS],
  ["exercise.delete", EXERCISE_IN_USE],
];

export const isRefusedDelete = (op: QueuedOp): boolean =>
  REFUSALS.some(([kind, reason]) => op.kind === kind && op.permanentError === reason);

/**
 * Sessions or exercises whose delete was refused, keyed by row id, valued by
 * op id so the notice can be dismissed. `refusedDeletes` is the same for sets.
 */
export function refusedRowDeletes(ops: readonly QueuedOp[], row: "session" | "exercise"): Map<string, string> {
  const kind = row === "session" ? "session.delete" : "exercise.delete";
  const key = row === "session" ? "sessionId" : "exerciseId";
  const refused = new Map<string, string>();
  for (const op of failedOps(ops)) {
    if (op.kind === kind && isRefusedDelete(op)) refused.set(str(op.payload[key]), op.id);
  }
  return refused;
}

/**
 * Failed ops that do mean something did not reach the coach.
 *
 * A clip delete is housekeeping behind a set that is already gone: if it
 * cannot run, the sweep reclaims the file, and nothing the coach should see
 * is missing.
 */
export function lostOps(ops: readonly QueuedOp[]): QueuedOp[] {
  return failedOps(ops).filter((op) => !isRefusedDelete(op) && op.kind !== "clip.delete");
}
