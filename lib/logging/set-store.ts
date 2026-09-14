import { ID } from "appwrite";
import { cancelQueued, enqueue } from "@/lib/offline/client";
import { weekStart } from "@/lib/strength/rollup";
import type { UnnamedSet } from "./session-store";
import type { RpeValue } from "./set";

/**
 * Writing sets.
 *
 * Separate from session-store because this is the write an athlete makes forty
 * times a session and the one that has to feel instant. It is instant because
 * it never waits for Appwrite: the set is written to the durable queue and the
 * function returns. Whether there is signal in the room changes nothing about
 * how long this takes or what the screen does next.
 */

export interface NewSet {
  sessionId: string;
  exerciseId: string;
  setIndex: number;
  loadKg: number;
  reps: number;
  rpe: RpeValue | null;
  isWarmup: boolean;
  /** Generated when the row appears, and used as the Appwrite row id. */
  clientSetId: string;
}

/**
 * Logs a set.
 *
 * Resolves once the op is on disk, not once Appwrite has it. That is the whole
 * design: a set that reached IndexedDB is a set that will reach the coach, and
 * a set that has not reached IndexedDB has not been logged. There is no third
 * state for the athlete to worry about, and nothing for them to retry by hand.
 */
export async function logSet(input: NewSet): Promise<UnnamedSet> {
  const loggedAt = new Date();
  await enqueue("set.create", {
    setId: input.clientSetId,
    sessionId: input.sessionId,
    exerciseId: input.exerciseId,
    setIndex: input.setIndex,
    loadKg: input.loadKg,
    reps: input.reps,
    rpe: input.rpe,
    isWarmup: input.isWarmup,
    loggedAt: loggedAt.toISOString(),
  });
  await queueRollupRefresh(input.exerciseId, loggedAt);

  return {
    exerciseId: input.exerciseId,
    clientSetId: input.clientSetId,
    loadKg: input.loadKg,
    reps: input.reps,
    rpe: input.rpe,
    isWarmup: input.isWarmup,
    loggedAt,
  };
}

/**
 * Removes a set. Used by Undo, for the tap that logged the wrong thing.
 *
 * A set undone before its write was ever attempted just leaves the queue, which
 * is both faster and one less row for Appwrite to create and destroy. Once the
 * write has been tried, it may have landed with the response lost on the way
 * back, so the delete is queued properly and runs behind it.
 */
export async function removeSet(clientSetId: string, set?: { exerciseId: string; loggedAt: Date }): Promise<void> {
  // A set undone before it was ever sent leaves the queue, and the rollup never
  // heard of it, so there is nothing to recompute.
  if (await cancelQueued("set.create", clientSetId)) return;
  await enqueue("set.delete", { setId: clientSetId });
  if (set) await queueRollupRefresh(set.exerciseId, set.loggedAt);
}

/**
 * Behind every set write, queued rather than called.
 *
 * It runs after the set op, so the bucket is recomputed from what has actually
 * landed. Queued rather than fired and forgotten because a rollup that fails to
 * update looks exactly like one that is correct -- the queue retries it, and a
 * refusal that will never succeed ends up visible instead of silent.
 */
async function queueRollupRefresh(exerciseId: string, loggedAt: Date): Promise<void> {
  await enqueue("rollup.refresh", {
    exerciseId,
    loggedAt: loggedAt.toISOString(),
    // Carried so two sets in the same week collapse to one refresh, without
    // the queue having to know how a week is defined.
    weekKey: weekStart(loggedAt).toISOString(),
  });
}

/**
 * One per row, generated on the device -- and used as the Appwrite row id.
 *
 * The same trick as a session's: one id rather than two, so the row that
 * appears on screen with no signal is already the row Appwrite will store.
 */
export const newClientSetId = (): string => `st-${ID.unique()}`;
