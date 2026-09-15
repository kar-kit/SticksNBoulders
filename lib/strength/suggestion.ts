import { MAX_REPS_TO_FAILURE, repsToFailure, type SetForEstimate } from "./e1rm";
import { roundToLoadable } from "./plates";
import type { RpeValue } from "@/lib/logging/set";

/**
 * "Log RPE 7 at 170 and the app suggests the next step."
 *
 * Joey already does this by hand, asking Claude between sets, which is the
 * strongest signal it belongs in the product. The athlete's last set says how
 * the day is actually going; the next set's target says where it should go.
 *
 * ## It is a ratio, which is why it is safe to build now
 *
 * A suggestion is `load x percent(target) / percent(logged)` -- the estimated
 * max appears in both halves and cancels. So the suggestion never depends on
 * the absolute value of the e1RM curve, only on its *shape* over a short span.
 *
 * That matters because which curve the product uses is an open decision: Order
 * 26 verified the RTS chart and measured it 2.7% away from the Brzycki formula
 * shipping today, and choosing between them is a live-data migration and
 * Joey's call. If a suggestion depended on the absolute curve it would have to
 * wait for that. It does not.
 *
 * [Fact] Over the suggestions this module will actually make -- the same reps
 * one RPE step harder, and similar -- the two curves disagree by 0.1 to 0.5kg,
 * which is inside a single plate step, so both round to the same weight.
 *
 * [Fact] The exception is a suggestion toward a near-maximal single: at three
 * or fewer reps from failure the two curves can differ by up to 4.4kg, because
 * they part company most where the curve is steepest. A suggestion into that
 * region is the one place Joey's pending decision could visibly move the
 * answer, and it is noted rather than gated, because working up to a top
 * single is exactly what a powerlifter does.
 *
 * ## Nothing is wired to it
 *
 * `lib/logging/prefill.ts` already accepts a `Suggestion` and ranks it second,
 * so unlike Order 18 a caller does exist. It stays unwired anyway: Order 28
 * asks whether load suggestions reach athletes directly or wait behind coach
 * approval, and calls that "a coaching philosophy question, not ours -- ask
 * Ruairi". Wiring the live path would answer it by default, in the direction
 * of straight through.
 *
 * Pure. No client, no network, no clock.
 */

/** The set the athlete just finished. */
export interface LoggedSet extends SetForEstimate {
  rpe: number | null;
}

/** Where the next set is meant to land, from the prescription. */
export interface SetTarget {
  reps: number;
  rpe: RpeValue;
}

export interface LoadSuggestion {
  /** What to put on the bar, rounded to something loadable. */
  loadKg: number;
  /** The set this was derived from -- shown to the athlete as provenance. */
  fromRpe: number;
  fromLoadKg: number;
  /** True when the target sits where the two candidate curves diverge. */
  nearMaximal: boolean;
}

/**
 * How far a suggestion will reach, in reps-to-failure.
 *
 * Two reps-to-failure covers the same reps two RPE steps harder, or two more
 * reps at the same RPE -- which is the span "the next step" honestly means.
 * Beyond it the last set stops being evidence about the next one: an athlete
 * who did 8 at RPE 7 has told you very little about a heavy single, and a
 * suggestion that confident would be a guess wearing a number.
 */
export const MAX_SUGGESTION_SPAN = 2;

/** At or below this, the target is a near-max attempt rather than a next set. */
const NEAR_MAXIMAL_REPS_FROM_FAILURE = 3;

/**
 * The load that should put this athlete at the target, today.
 *
 * Null rather than a guess whenever the anchor is not trustworthy, and each
 * refusal is a real case rather than defensive padding:
 *
 * - **No RPE on the logged set.** The athlete answered "not sure". Without it
 *   the set could be a grinder or an easy back-off at the same load and reps,
 *   and `estimateOneRepMax` refuses it for the same reason.
 * - **A warm-up.** It says nothing about what is left in the tank.
 * - **Either end outside the chart's range**, per `MAX_REPS_TO_FAILURE`.
 * - **A target further than `MAX_SUGGESTION_SPAN`** from what was just done.
 *
 * There is deliberately no default target. The target RPE comes from a
 * prescription, and when an athlete has none there is nothing to suggest
 * toward -- prefill's rule 3, repeat the previous set, is already the right
 * answer and a manufactured suggestion would outrank it while saying less.
 */
export function suggestLoad(logged: LoggedSet, target: SetTarget): LoadSuggestion | null {
  if (logged.isWarmup) return null;
  if (logged.rpe === null || !Number.isFinite(logged.rpe)) return null;
  if (!Number.isFinite(logged.loadKg) || logged.loadKg <= 0) return null;
  if (!Number.isInteger(logged.reps) || logged.reps < 1) return null;
  if (!Number.isInteger(target.reps) || target.reps < 1) return null;
  if (!Number.isFinite(target.rpe)) return null;

  const from = repsToFailure(logged.reps, logged.rpe);
  const to = repsToFailure(target.reps, target.rpe);
  if (from < 1 || from > MAX_REPS_TO_FAILURE) return null;
  if (to < 1 || to > MAX_REPS_TO_FAILURE) return null;
  if (Math.abs(to - from) > MAX_SUGGESTION_SPAN) return null;

  // The ratio of the curve at the two points. Brzycki's percentage of 1RM at
  // n reps from failure is (37 - n) / 36, so the 36s and the estimated max
  // both cancel and only the shape of the curve survives.
  const loadKg = roundToLoadable(logged.loadKg * ((37 - to) / (37 - from)));
  if (loadKg <= 0) return null;

  return {
    loadKg,
    // The set it came FROM, which is what prefill renders as
    // "suggested from RPE 7 @ 142.5".
    fromRpe: logged.rpe,
    fromLoadKg: logged.loadKg,
    nearMaximal: to <= NEAR_MAXIMAL_REPS_FROM_FAILURE,
  };
}
