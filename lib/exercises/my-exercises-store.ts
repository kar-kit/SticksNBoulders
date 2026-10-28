import { enqueue, withdrawRow } from "@/lib/offline/client";
import type { QueuedOp } from "@/lib/offline/queue";
import { deleteRefusal, hasQueuedSets } from "./my-exercises";
import { fetchExerciseUsage } from "./usage-store";
import type { Exercise } from "./match";
import type { ExerciseKind } from "./kind";

/**
 * Renaming and deleting the athlete's own exercises. Both queued, like the
 * create that made them.
 */

export async function renameMyExercise(exerciseId: string, name: string): Promise<void> {
  await enqueue("exercise.rename", { exerciseId, name });
}

/**
 * Flags one of the athlete's own exercises as bodyweight, or clears it (F20).
 * Queued like the rename beside it, so it works with no signal; the Log reads
 * the flag from the library, which the caller updates first.
 */
export async function setMyExerciseBodyweight(exerciseId: string, isBodyweight: boolean): Promise<void> {
  await enqueue("exercise.bodyweight", { exerciseId, isBodyweight });
}

/**
 * Sets what one of the athlete's own exercises records (F23): cardio's
 * duration and level, or strength. Queued like the bodyweight flag beside
 * it, as its own op; the Log reads the kind from the library, which the
 * caller updates first.
 */
export async function setMyExerciseKind(exerciseId: string, kind: ExerciseKind): Promise<void> {
  await enqueue("exercise.kind", { exerciseId, kind });
}

export type ExerciseDeleteCheck = { ok: true } | { ok: false; message: string };

/**
 * Whether the exercise can go, asked before anything is queued.
 *
 * Needs signal for an exercise Appwrite already has: whether it has been
 * logged, or programmed by the coach, is only on the server. One that never
 * left the phone can only be referenced by sets still on the phone, which are
 * checked here without a read.
 */
export async function checkExerciseDeletable(
  athleteId: string,
  exercise: Exercise,
  ops: readonly QueuedOp[],
): Promise<ExerciseDeleteCheck> {
  const queuedSets = hasQueuedSets(ops, exercise.id);
  const unsent = ops.some(
    (op) => op.kind === "exercise.create" && op.payload.exerciseId === exercise.id && (op.attempts === 0 || Boolean(op.permanentError)),
  );
  if (unsent) {
    const refusal = deleteRefusal(exercise.name, { sets: false, referenceMaxes: false, prescriptions: false }, queuedSets);
    return refusal ? { ok: false, message: refusal } : { ok: true };
  }
  try {
    const usage = await fetchExerciseUsage(athleteId, exercise.id);
    const refusal = deleteRefusal(exercise.name, usage, queuedSets);
    return refusal ? { ok: false, message: refusal } : { ok: true };
  } catch {
    return {
      ok: false,
      message: "Deleting an exercise needs signal, to check nothing is logged against it. Try again in a moment.",
    };
  }
}

/**
 * Deletes it. An exercise whose create never left the phone is withdrawn
 * instead; one Appwrite has gets a queued delete whose guard re-checks usage
 * at the last moment.
 */
export async function deleteMyExercise(exerciseId: string): Promise<{ queued: boolean }> {
  const { landed } = await withdrawRow("exercise", exerciseId);
  if (!landed) return { queued: false };
  await enqueue("exercise.delete", { exerciseId });
  return { queued: true };
}
