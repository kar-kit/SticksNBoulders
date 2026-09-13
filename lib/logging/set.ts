/**
 * Rules about a set that are shared between the logger, the rollup function and
 * the coach's views. They live here, not in a component, because a rollup
 * written by an Appwrite Function has to apply exactly the same warm-up rule as
 * the row the athlete tapped.
 */

export type RpeValue = 6 | 6.5 | 7 | 7.5 | 8 | 8.5 | 9 | 9.5 | 10;

/** Half points from 6 to 10. Eleven values including "not sure", which is null. */
export const RPE_VALUES: readonly RpeValue[] = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];

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
}

/**
 * Warm-ups are excluded from PRs and rollups. A 60kg warm-up single is not a
 * rep PR and must never appear as one.
 */
export function countsTowardPrs(set: LoggableSet): boolean {
  return !set.isWarmup && isComplete(set);
}

function isComplete(set: LoggableSet): boolean {
  return (
    typeof set.loadKg === "number" &&
    Number.isFinite(set.loadKg) &&
    set.loadKg > 0 &&
    typeof set.reps === "number" &&
    Number.isInteger(set.reps) &&
    set.reps > 0
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
