import { enqueue, withdrawRow } from "@/lib/offline/client";
import { fetchCommentsForSets } from "@/lib/review/comment-store";
import { removeSet } from "./set-store";
import { deleteBlockedBy } from "./session-edit";

/**
 * Editing and deleting whole sessions from History.
 *
 * Every write here is a queue op, run later by the document helper -- the
 * same path the logger's writes take -- so a session renamed or deleted with
 * no signal behaves exactly as one renamed on the sofa.
 */

/** Renames a session, or edits its notes. Undefined leaves a field alone; blank clears it. */
export async function reviseSession(
  sessionId: string,
  change: { name?: string | null; notes?: string | null },
): Promise<void> {
  await enqueue("session.update", {
    sessionId,
    ...(change.name !== undefined && { name: change.name }),
    ...(change.notes !== undefined && { notes: change.notes }),
  });
}

/**
 * Restates a session's stored totals after a set in it changed.
 *
 * Queued behind the set's own edit or delete, so the totals land after the
 * change they describe. Without it the History card kept the numbers written
 * at finish forever: nothing else ever rewrote them.
 */
export async function reviseSessionTotals(
  sessionId: string,
  totals: { setCount: number; tonnageKg: number },
): Promise<void> {
  await enqueue("session.update", { sessionId, setCount: totals.setCount, tonnageKg: totals.tonnageKg });
}

export type DeleteCheck = { ok: true } | { ok: false; reason: "coach-feedback" | "offline"; message: string };

/**
 * Whether a session may go, asked before anything is queued.
 *
 * This read is the only part of deleting a session that needs signal, and it
 * needs it on purpose. The queue would refuse the commented sets anyway, but
 * one at a time and an hour later: the athlete would watch a session they
 * deleted come back with half its sets. Asking first means the answer is
 * given while they are still looking at it.
 *
 * A session none of whose sets have reached Appwrite cannot have been
 * commented on, so it needs no read and can be deleted in a basement.
 */
export async function checkSessionDeletable(
  athleteId: string,
  landedSetIds: readonly string[],
): Promise<DeleteCheck> {
  if (landedSetIds.length === 0) return { ok: true };
  let comments;
  try {
    comments = await fetchCommentsForSets(landedSetIds);
  } catch {
    return {
      ok: false,
      reason: "offline",
      message: "Deleting a session needs signal, to check your coach hasn't commented on it. Try again in a moment.",
    };
  }
  const blocked = deleteBlockedBy(comments, athleteId);
  return blocked ? { ok: false, reason: "coach-feedback", message: blocked } : { ok: true };
}

export interface SetToRemove {
  clientSetId: string;
  exerciseId: string;
  loggedAt: Date;
  videoFileId?: string | null;
}

/**
 * Deletes a session and everything logged in it.
 *
 * Each set goes through `removeSet`, the path a single set deleted from
 * History already takes: queued sets are withdrawn outright, landed ones get a
 * real delete with the coach-comment guard, a rollup refresh behind it for its
 * (exercise, week) -- duplicates collapse to the last one in the queue -- and a
 * clip delete behind that. The session's own delete goes last, so it runs
 * after every set has gone or been refused, and its guard keeps the session if
 * any set was.
 *
 * A session whose create never left the phone is withdrawn instead, with
 * nothing sent at all.
 */
export async function deleteSessionAndSets(
  sessionId: string,
  sets: readonly SetToRemove[],
): Promise<{ queued: boolean }> {
  for (const set of sets) {
    await removeSet(set.clientSetId, {
      exerciseId: set.exerciseId,
      loggedAt: set.loggedAt,
      videoFileId: set.videoFileId ?? null,
    });
  }
  const { landed } = await withdrawRow("session", sessionId);
  if (!landed) return { queued: false };
  await enqueue("session.delete", { sessionId });
  return { queued: true };
}
