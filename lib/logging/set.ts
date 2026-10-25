/**
 * Rules about a set that are shared between the logger, the rollup function and
 * the coach's views. They live here, not in a component, because a rollup
 * written by an Appwrite Function has to apply exactly the same warm-up rule as
 * the row the athlete tapped.
 */

/**
 * An RPE a coach can prescribe: half points from 6 to 10.
 *
 * Deliberately narrower than what an athlete can log (`RpeValue`). A coach
 * writes "@8" to set an effort; nobody programs a set to be RPE 4, and the
 * maths that turns a prescription into a weight (Brzycki on reps to failure,
 * lib/strength/e1rm.ts) is not trustworthy that far from failure anyway. So
 * the prescription parser, the backoff rule's "until RPE" and the Bump Week
 * clamp all take this type, and a sub-6 value cannot reach a program by
 * accident: it is a type error before it is a bug.
 */
export type PrescribableRpe = 6 | 6.5 | 7 | 7.5 | 8 | 8.5 | 9 | 9.5 | 10;

/**
 * What the athlete answered on the RPE sheet once they had finished the set,
 * null aside ("Not sure").
 *
 * Everything a coach can prescribe, plus whole points 5, 4 and 3 for the sets
 * that were too easy to call 6 (F10, Joey: "Need a sub RPE 6 sub menu for the
 * sets that are too easy"). Whole points only below 6: the distinction between
 * a 4 and a 4.5 is not one an athlete can feel, and the sheet stays one tap.
 * Nothing below 3, because a set that easy is a warm-up whatever it is called.
 *
 * Logging a sub-6 RPE is recording a fact about the set, not asking for a
 * number from it: such a set gets no e1RM and so no e1RM record, see
 * `MIN_ESTIMABLE_RPE` in lib/strength/e1rm.ts.
 */
export type RpeValue = 3 | 4 | 5 | PrescribableRpe;

/** The prescribable scale, low to high. Nine values. */
export const PRESCRIBABLE_RPE_VALUES: readonly PrescribableRpe[] = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];

/**
 * The "Under 6" sub-menu, in the order the sheet offers them: nearest the
 * main grid first, so the common "a bit easier than 6" answer is the closest
 * tap.
 */
export const UNDER_SIX_RPE_VALUES: readonly RpeValue[] = [5, 4, 3];

/**
 * Every RPE an athlete can log, low to high. Twelve values; thirteen answers
 * with "not sure", which is null.
 */
export const LOGGED_RPE_VALUES: readonly RpeValue[] = [3, 4, 5, ...PRESCRIBABLE_RPE_VALUES];

/** Whether a stored or typed number is an RPE an athlete could have logged. */
export const isLoggedRpe = (value: number): value is RpeValue =>
  (LOGGED_RPE_VALUES as readonly number[]).includes(value);

/** Whether a number is an RPE a coach may prescribe. Sub-6 is not. */
export const isPrescribableRpe = (value: number): value is PrescribableRpe =>
  (PRESCRIBABLE_RPE_VALUES as readonly number[]).includes(value);

export interface LoggableSet {
  loadKg: number | null;
  reps: number | null;
  /** Null is a real answer: "not sure". A forced guess pollutes the curve worse. */
  rpe: RpeValue | null;
  isWarmup: boolean;
  /** Set by the coach on the prescription, not by the athlete. */
  videoRequired?: boolean;
  hasVideo?: boolean;
  /** Recorded when the athlete taps "Skip, no video" -- the coach can see it. */
  videoSkipped?: boolean;
  /**
   * The athlete missed the set (F19, schema v19). `reps` is what they
   * actually completed, so 0 is a real answer here and nowhere else. Absent
   * and null read as false: every set before v19.
   */
  failed?: boolean | null;
}

/**
 * Warm-ups are excluded from PRs and rollups. A 60kg warm-up single is not a
 * rep PR and must never appear as one. Neither is a failed set (F19), of any
 * kind: a miss at 200 is not a weight record, and 3 reps of a failed 5 is not
 * a rep record.
 */
export function countsTowardPrs(set: LoggableSet): boolean {
  return !set.isWarmup && !set.failed && isComplete(set);
}

/**
 * Whether the set has a load and a rep count it can be logged with. Reps
 * above zero, except on a failed set (F19): a missed single is logged as
 * load x 0, which is the truth about it, and still counts as a set.
 */
function isComplete(set: LoggableSet): boolean {
  return (
    typeof set.loadKg === "number" &&
    Number.isFinite(set.loadKg) &&
    set.loadKg > 0 &&
    typeof set.reps === "number" &&
    Number.isInteger(set.reps) &&
    (set.reps > 0 || (set.failed === true && set.reps === 0))
  );
}

/**
 * Whether the confirm target is active.
 *
 * A video-required set will not tick complete without a clip or an explicit
 * skip. The problem being solved is forgetting to film, not that attaching is
 * hard, so the block sits at the moment of the set.
 */
export function canComplete(set: LoggableSet): boolean {
  if (!isComplete(set)) return false;
  if (!set.videoRequired) return true;
  return Boolean(set.hasVideo || set.videoSkipped);
}

/**
 * Why the confirm target is inactive, for the affordance beside it. Returns
 * null when nothing is blocking.
 */
export function completionBlocker(set: LoggableSet): "incomplete" | "video-required" | null {
  if (!isComplete(set)) return "incomplete";
  if (set.videoRequired && !set.hasVideo && !set.videoSkipped) return "video-required";
  return null;
}

/** RPE is optional on every set, and warm-ups are never asked. */
export function asksForRpe(set: LoggableSet): boolean {
  return !set.isWarmup;
}
