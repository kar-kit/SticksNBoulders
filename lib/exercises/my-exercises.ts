import { normaliseExerciseName } from "@/appwrite/documents/write";
import type { QueuedOp } from "@/lib/offline/queue";
import { pendingOps } from "@/lib/offline/queue";
import type { Exercise } from "./match";
import type { ExerciseUsage } from "./usage-store";

/**
 * My exercises: the lifts an athlete typed into existence mid-session.
 *
 * Pure. Reads are in usage-store.ts, queue writes in my-exercises-store.ts.
 */

/** The `exercises.name` column's size. */
export const EXERCISE_NAME_MAX = 64;

/**
 * The athlete's own rows, A to Z.
 *
 * Owner and global flag both checked, though the library fetch already
 * filters on them: a coach's provider holds their athletes' rows too, and
 * listing one of those here would offer to rename somebody else's lift.
 */
export function myExercises(library: readonly Exercise[], userId: string): Exercise[] {
  return library
    .filter((exercise) => !exercise.isGlobal && exercise.ownerId === userId)
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

export type RenameCheck = { ok: true; name: string; unchanged: boolean } | { ok: false; message: string };

/**
 * Whether a rename can go ahead.
 *
 * Refused when the new name is one the library already has, for the reason
 * resolveOrCreateExercise refuses to create one: two rows that normalise the
 * same split a lift's history in two, and the typeahead would offer both. A
 * change of case or spacing on the same exercise is allowed -- "rdl" to "RDL"
 * is the most likely rename there is.
 */
export function checkRename(exercise: Exercise, typed: string, library: readonly Exercise[]): RenameCheck {
  const name = typed.replace(/\s+/g, " ").trim();
  if (!normaliseExerciseName(name)) return { ok: false, message: "Give it a name." };
  if (name.length > EXERCISE_NAME_MAX) {
    return { ok: false, message: `Keep it under ${EXERCISE_NAME_MAX} characters.` };
  }
  const normalised = normaliseExerciseName(name);
  const clash = library.find((other) => other.id !== exercise.id && other.normalisedName === normalised);
  if (clash) {
    return {
      ok: false,
      message: clash.isGlobal
        ? `${clash.name} is already in the library. Pick another name.`
        : `You already have ${clash.name}. Pick another name.`,
    };
  }
  return { ok: true, name, unchanged: name === exercise.name };
}

/** Sets still on this phone that were logged against the exercise. */
export const hasQueuedSets = (ops: readonly QueuedOp[], exerciseId: string): boolean =>
  pendingOps(ops).some((op) => op.kind === "set.create" && op.payload.exerciseId === exerciseId);

/**
 * Why an exercise cannot be deleted, or null when it can.
 *
 * Blocked rather than archived. An archive would need a column, a filter on
 * every reader of the library and a way back, to hide a name -- and the name
 * can be fixed by renaming. A delete that went ahead would orphan the sets,
 * maxes and program lines that point at it: History, Lift Detail and the
 * coach's program would show a raw id where the lift's name was.
 */
export function deleteRefusal(name: string, usage: ExerciseUsage, queuedSets = false): string | null {
  if (usage.sets || queuedSets) {
    return `You've logged sets of ${name}, so it stays. Rename it if the name is wrong.`;
  }
  if (usage.referenceMaxes) return `${name} has a max recorded against it, so it stays.`;
  if (usage.prescriptions) return `Your coach has programmed ${name}, so it stays.`;
  return null;
}
