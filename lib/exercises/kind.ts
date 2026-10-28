import type { Exercise } from "./match";

/**
 * Exercise kinds (F23, schema v21): what a set of an exercise records.
 *
 * Joey, after a session: there was nowhere to put the stairmaster. The app
 * only knew strength sets -- load, reps, RPE -- and a cardio block typed in
 * as "20 kg x 1" would have been a lie that every total then believed.
 *
 * The scope is deliberately small, Joey's call. A cardio set is a duration
 * and an optional level (the machine's level or intensity: stairmaster 8,
 * treadmill 2.5). No distance, heart rate or calories in this version, and
 * no machine-type field: the machine is the exercise -- Treadmill, Bike,
 * Stairmaster, Rowing Machine -- so it is named the way every other lift is,
 * and a new machine is a new exercise, typed or seeded.
 *
 * The kind lives on the exercise (`exercises.kind`) and decides one thing:
 * what the Log asks for when a set of it is entered. Nothing downstream reads
 * it. Each set carries its own answer -- a set with a duration is cardio
 * (lib/logging/cardio.ts `isCardioSet`) -- so an athlete who flips an
 * exercise's kind in My exercises keeps every set logged before exactly as
 * it was, the same rule F20 follows for the bodyweight flag.
 *
 * Absent and null read as strength: every row written before v21, every
 * library a phone cached before it, and any value this version does not know.
 * Reading an unknown kind as strength is the safe direction here because the
 * kind only gates input -- the strength maths never trusts it, it trusts the
 * set.
 */

export type ExerciseKind = "strength" | "cardio";

export const EXERCISE_KINDS: readonly ExerciseKind[] = ["strength", "cardio"];

/** The kind of an exercise. Anything but "cardio" -- absent, null, a future value -- is strength. */
export const kindOf = (exercise: Pick<Exercise, "kind"> | null | undefined): ExerciseKind =>
  exercise?.kind === "cardio" ? "cardio" : "strength";

/** Whether an exercise is logged as cardio: a duration and a level, not load and reps. */
export const isCardioExercise = (exercise: Pick<Exercise, "kind"> | null | undefined): boolean =>
  kindOf(exercise) === "cardio";

/**
 * A stored or typed value as a kind, for the library fetch and the cache.
 * Only the exact string "cardio" is cardio.
 */
export const parseKind = (value: unknown): ExerciseKind => (value === "cardio" ? "cardio" : "strength");

/**
 * A lookup by exercise id, for screens that hold rows and a library side by
 * side (the Log). An id the library does not know is strength: the row asks
 * for load and reps, which is what every exercise did before v21.
 */
export function cardioLookup(exercises: readonly Exercise[]): (exerciseId: string) => boolean {
  const cardio = new Set(exercises.filter(isCardioExercise).map((exercise) => exercise.id));
  return (exerciseId) => cardio.has(exerciseId);
}
