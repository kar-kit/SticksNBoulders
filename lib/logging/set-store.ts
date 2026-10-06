import { ID } from "appwrite";
import { enqueue, withdrawSet } from "@/lib/offline/client";
import { forgetUpload, pendingUploads } from "@/lib/video/pending-store";
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
  /** The prescription line this answers, when the session was prescribed (Order 22). */
  prescriptionId?: string | null;
  /** What that line's target said at the moment of logging. Stored as written. */
  prescribed?: string | null;
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
    ...(input.prescriptionId ? { prescriptionId: input.prescriptionId, prescribed: input.prescribed ?? null } : {}),
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

/** A correction from History. All four values, because e1RM depends on all four. */
export interface SetEdit {
  loadKg: number;
  reps: number;
  rpe: RpeValue | null;
  isWarmup: boolean;
}

/**
 * Corrects a set that was logged wrong.
 *
 * Queued like every other write, so an edit made on the gym floor with no
 * signal behaves the same as one made on the sofa. The rollup refresh goes
 * behind it: changing a weight changes the week's tonnage, and flagging a set
 * as a warm-up after the fact removes it from the week entirely.
 */
export async function editSet(
  clientSetId: string,
  edit: SetEdit,
  set: { exerciseId: string; loggedAt: Date },
): Promise<void> {
  await enqueue("set.update", {
    setId: clientSetId,
    loadKg: edit.loadKg,
    reps: edit.reps,
    rpe: edit.rpe,
    isWarmup: edit.isWarmup,
  });
  await queueRollupRefresh(set.exerciseId, set.loggedAt);
}

/**
 * Removes a set: the wrong tap in the logger, or a set deleted from History.
 *
 * In three steps, each for a knock-on effect of the set going:
 *
 * 1. **The queue.** Anything still waiting to write this set leaves. A set
 *    deleted before its create was ever sent never reaches Appwrite at all --
 *    faster, and nothing for the coach to glimpse. If the create has been
 *    tried it may have landed, so it stays and a real delete runs behind it.
 * 2. **A clip still uploading for it** is forgotten, so it stops occupying the
 *    phone's quota and retrying on every app start for a set that is gone.
 *    A clip that already uploaded is left in storage, the same trade
 *    `detachClipFromSet` makes: reclaiming files no set references is a sweep,
 *    and a broken player in the coach's queue is worse than a storage bill.
 * 3. **The rollup.** Queued behind the delete, so the week is recomputed from
 *    what is left -- volume, tonnage, set count, best e1RM and the best-set PR
 *    all come out of that one recompute, and a week with no working sets left
 *    loses its row entirely. Lift Detail's PRs and the estimated max read that
 *    row, so they follow without being touched.
 *
 * Returns whether a delete had to be queued, which is only useful to tests.
 */
export async function removeSet(
  clientSetId: string,
  set?: { exerciseId: string; loggedAt: Date },
): Promise<{ queued: boolean }> {
  const { landed } = await withdrawSet(clientSetId);
  void forgetUploadsFor(clientSetId);
  // Never reached the server, so the rollup never counted it. Any refresh the
  // set's own create queued is still behind it and recomputes harmlessly.
  if (!landed) return { queued: false };
  await enqueue("set.delete", { setId: clientSetId });
  if (set) await queueRollupRefresh(set.exerciseId, set.loggedAt);
  return { queued: true };
}

async function forgetUploadsFor(setId: string): Promise<void> {
  try {
    for (const upload of await pendingUploads()) {
      if (upload.setId === setId) await forgetUpload(upload.fileId);
    }
  } catch {
    // Housekeeping. The set is deleted whether or not a stale blob survives.
  }
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
