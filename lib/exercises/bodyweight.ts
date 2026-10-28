import type { Exercise } from "./match";

/**
 * Bodyweight exercises (F20, schema v20): which lifts may be logged at 0 kg.
 *
 * Joey, mid-session: a set of pull-ups could not be logged, because the
 * confirm square wanted a load above zero and the honest load was nothing on
 * the belt. The schema never minded -- `sets.load_kg` has been `min: 0` from
 * the start -- it was the Log's completeness rule (`isComplete` in
 * lib/logging/set.ts) that refused it.
 *
 * Fixed per exercise rather than everywhere, Joey's call: a 0 typed on a
 * squat is a thumb that missed the 1, and the rule that refuses it has caught
 * real mistakes. So the flag is `exercises.is_bodyweight`, and 0 kg is a
 * valid load on a flagged exercise and nowhere else. Added load is unchanged
 * on either kind: a +20 kg weighted pull-up is logged as 20, exactly as it
 * was before the flag existed.
 *
 * What a 0 kg set is, everywhere downstream. The load is the added load, so
 * these are the rules for "the bar was empty", not a model of body mass:
 *
 *   - a set, and its reps: set count and volume, like any working set;
 *   - 0 kg of tonnage (0 x reps), so it can never inflate a session's total;
 *   - a rep record: most reps at 0 kg or heavier, measured on the same
 *     rep-max frontier as everything else (lib/strength/pr.ts);
 *   - never a weight record and never the week's heaviest set -- "heaviest"
 *     means added load, and 0 is not one (lib/strength/rollup.ts);
 *   - no e1RM: Brzycki on 0 kg is 0, which is not an estimate, so the stored
 *     `e1rm_kg` stays unset (lib/strength/e1rm.ts) and no e1RM record, best
 *     or suggestion is ever made from it;
 *   - not a top set to take a backoff percentage of, and not an anchor for a
 *     load suggestion (lib/programming/backoff.ts, lib/strength/suggestion.ts).
 *
 * [Inference] The flag gates input only. Every rule above is the same for any
 * set stored at 0 kg, flagged or not, so an athlete who unflags an exercise
 * after logging bodyweight sets of it keeps sound numbers: nothing in the
 * maths reads the flag, only the Log's confirm does.
 *
 * [SME to confirm] whether Ruairi wants bodyweight tonnage counted as body
 * mass x reps one day. That needs the athlete's bodyweight on the day of the
 * set, a different feature; 0 is the honest number until then.
 */

/** Whether an exercise is flagged bodyweight. Absent (older rows, older caches) reads as false. */
export const isBodyweight = (exercise: Pick<Exercise, "isBodyweight"> | null | undefined): boolean =>
  exercise?.isBodyweight === true;

/**
 * A lookup by exercise id, for screens that hold sets and a library side by
 * side. An id the library does not know is not bodyweight: the safe answer,
 * since it only ever refuses a 0 kg set, never one with a load.
 */
export function bodyweightLookup(exercises: readonly Exercise[]): (exerciseId: string) => boolean {
  const flagged = new Set(exercises.filter(isBodyweight).map((exercise) => exercise.id));
  return (exerciseId) => flagged.has(exerciseId);
}
