/**
 * Taking a whole exercise out of a running session.
 *
 * The block-level twin of deleting one set, and deliberately built from it:
 * every logged set in the block goes through the same `removeSet` path, so
 * the offline queue, the clip cleanup and the rollup refresh behave exactly
 * as they do for a single swipe. Nothing here writes; it decides what the
 * screen does, so it can be tested without one.
 */

export interface RemovableSet {
  clientSetId: string;
  exerciseId: string;
  isWarmup: boolean;
}

export type BlockRemoval<T extends RemovableSet> =
  | { kind: "ok"; sets: T[]; clearsRest: boolean }
  | { kind: "blocked"; reason: string };

export const BLOCK_COACH_COMMENTED =
  "Your coach has commented on a set here, so this exercise stays. Delete the other sets one by one, or correct them from History.";

/**
 * What removing `exerciseId` would take with it.
 *
 * Refused outright if any of its sets carries a coach's comment, for the same
 * reason a single commented set cannot be deleted: the coach's words would be
 * left pointing at nothing. Partial removal -- everything but the commented
 * set -- was considered and rejected, because a block that half-disappears
 * after "Remove exercise" reads as a bug.
 *
 * `clearsRest` is true when the most recent set of the whole session is in
 * this block: the running rest belongs to that set, and it is going.
 */
export function planBlockRemoval<T extends RemovableSet>(
  exerciseId: string,
  sessionSets: readonly T[],
  undeletable: ReadonlySet<string>,
  latestSetId: string | null,
): BlockRemoval<T> {
  const sets = sessionSets.filter((s) => s.exerciseId === exerciseId);
  if (sets.some((s) => undeletable.has(s.clientSetId))) {
    return { kind: "blocked", reason: BLOCK_COACH_COMMENTED };
  }
  return {
    kind: "ok",
    sets,
    clearsRest: latestSetId !== null && sets.some((s) => s.clientSetId === latestSetId),
  };
}

/** "Squat removed", "Squat removed · 3 sets deleted". What the undo toast says. */
export function blockRemovalLabel(name: string, sets: readonly RemovableSet[]): string {
  if (sets.length === 0) return `${name} removed`;
  return `${name} removed · ${sets.length} set${sets.length === 1 ? "" : "s"} deleted`;
}
