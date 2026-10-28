/**
 * Estimated one-rep max, from a set that was not a one-rep max.
 *
 * This is the number the rest of the product is built on: the progression
 * chart, the rollups, reference maxes, the RPE engine, the attempt board. It is
 * computed and stored when the set is written, because Appwrite has no GROUP BY
 * and nothing can derive it on read.
 *
 * ## The formula
 *
 * Brzycki, on reps-to-failure rather than reps performed:
 *
 *     RIR   = 10 - RPE                     (reps left in the tank)
 *     total = reps + RIR                   (what the set would have been to failure)
 *     e1RM  = load x 36 / (37 - total)
 *
 * Source: Brzycki, M. (1993). "Strength Testing -- Predicting a One-Rep Max
 * from Reps-to-Fatigue." Journal of Physical Education, Recreation & Dance
 * 64(1), 88-90. Most accurate over 1-6 reps and derived on slow-tempo barbell
 * bench and squat, which is this product's entire domain rather than general
 * fitness.
 *
 * ## Why Brzycki and not Epley
 *
 * Epley -- load x (1 + total/30) -- is the more common choice in RPE
 * calculators and the two agree within a few percent through the middle of the
 * range. They part company at one rep, and that is what decides it: Epley
 * returns 1.033 x load for a single, so every heavy single an athlete logs at
 * RPE 10 would report an estimated max above the weight that was actually on
 * the bar. A single at RPE 10 is a tested max by definition, not an estimate.
 * Brzycki returns exactly the load at one rep. Getting the most scrutinised
 * number in the app visibly wrong would cost trust in every other number.
 *
 * ## Half points
 *
 * RPE is logged in half points, so most real sets produce a fractional
 * reps-to-failure -- 3 reps at RPE 8.5 is 4.5 -- and land on a denominator the
 * 1993 paper never contemplated. Brzycki is linear in that term, so it
 * interpolates smoothly and a half point moves the estimate by about half of
 * what a whole one does, which is the behaviour an athlete expects. Rounding
 * the total instead would throw away the distinction the RPE sheet exists to
 * capture.
 *
 * [Unverified] Neither formula has a documented empirical derivation, and both
 * predate RPE-based training. Order 26 revisits this against the RTS chart, and
 * `npm run e1rm:backfill` exists so that revision is a script run rather than a
 * migration. Do not treat the constants here as settled.
 *
 * Nothing in this file imports anything. It is the one place the maths lives,
 * so the write helper and the client agree by construction.
 */

export interface SetForEstimate {
  loadKg: number;
  reps: number;
  /** Null when the athlete answered "Not sure". */
  rpe: number | null;
  isWarmup?: boolean;
  /**
   * The athlete missed the set (F19, schema v19): `reps` is what they
   * completed, and the set never reached its target. Absent reads as false.
   */
  failed?: boolean;
}

/**
 * Above this, the estimate stops being about strength.
 *
 * Brzycki's relationship holds to roughly ten reps; past that, endurance and
 * lactate tolerance are what end the set. Twelve is a deliberate little further
 * than that, so an honest 10 x RPE 8 still gets a number, and a twenty-rep
 * back-off set does not quietly become somebody's best e1RM of the week.
 */
export const MAX_REPS_TO_FAILURE = 12;

/**
 * The lowest RPE an estimate is made from. Below it, the set is logged and
 * counted -- volume, tonnage, the heaviest weight, the most reps -- but it
 * gets no e1RM.
 *
 * The whole formula rests on RIR = 10 - RPE, and that equivalence is only as
 * good as the athlete's sense of how many reps were left. Near failure that
 * sense is sharp: the difference between one and two in the tank is felt.
 * Far from it, it is not -- an athlete calling a set RPE 4 is saying "easy",
 * not "exactly six more", and evidence on RIR-based ratings is that accuracy
 * falls away as the set gets further from failure ([Inference], from the
 * Zourdos/Helms RIR-RPE work; the cut-off itself is Joey's call, F10). Six
 * reps of reserve fed into Brzycki inflates the estimate: 100 x 5 @4 would
 * claim 138.5 kg, the same as 100 x 11 to failure, and could become the
 * week's best e1RM, a "record", and the working max a percentage is priced
 * off.
 *
 * Six is also where the coach's scale starts (`PrescribableRpe` in
 * lib/logging/set.ts), so every RPE the product can prescribe is still one it
 * can estimate from. Sets logged before F10 were all 6 or above, so the
 * stored numbers do not move; `npm run e1rm:backfill` would apply this to
 * anything that slipped through.
 */
export const MIN_ESTIMABLE_RPE = 6;

/** Whether an RPE is close enough to failure to estimate a max from. */
export const isEstimableRpe = (rpe: number | null): rpe is number =>
  rpe !== null && Number.isFinite(rpe) && rpe >= MIN_ESTIMABLE_RPE && rpe <= 10;

/** RPE is how close to failure the set was; RIR is the same fact counted down. */
export const repsInReserve = (rpe: number): number => 10 - rpe;

export const repsToFailure = (reps: number, rpe: number): number => reps + repsInReserve(rpe);

/**
 * The estimate, or null when there is honestly no estimate to make.
 *
 * Null is not a failure case and appears on plenty of sets:
 *
 * - **No RPE.** The athlete answered "Not sure", and without it the set could
 *   be a grinder or an easy back-off at the same load and reps. A rep-count-only
 *   formula cannot tell those apart and would treat 5 @ RPE 7 as 5 @ RPE 10.
 *   A wrong number is worse than no number, so this stays empty.
 * - **A warm-up.** Excluded from PRs and rollups everywhere else, and a warm-up
 *   flagged at a high RPE is a mis-tap rather than a max.
 * - **An RPE below 6**, per MIN_ESTIMABLE_RPE: logged as easy, too far from
 *   failure for reps-in-reserve to be counted. Above 10 is not an RPE at all.
 * - **Too far from failure to mean anything**, per MAX_REPS_TO_FAILURE.
 * - **A failed set** (F19). The reps it records are the ones completed before
 *   the bar stopped, and whatever RPE was tapped, the set hit failure short of
 *   what the athlete set out to do. Brzycki on "3 of 5, then stuck" is not an
 *   estimate anyone should program off, so it gets none -- and with none, no
 *   e1RM record, no best e1RM in the rollup, no working max for the day.
 * - **A bodyweight set at 0 kg** (F20). Brzycki on nothing is nothing: the
 *   formula would return 0, and 0 is not an estimate of anyone's max. So
 *   null, never 0 and never NaN -- the load guard below. A weighted pull-up
 *   (+20 kg) is estimated on its added load, exactly as before F20.
 */
export function estimateOneRepMax(set: SetForEstimate): number | null {
  if (set.isWarmup) return null;
  if (set.failed) return null;
  if (!isEstimableRpe(set.rpe)) return null;
  if (!Number.isFinite(set.loadKg) || set.loadKg <= 0) return null;
  if (!Number.isInteger(set.reps) || set.reps < 1) return null;

  const total = repsToFailure(set.reps, set.rpe);
  if (total < 1 || total > MAX_REPS_TO_FAILURE) return null;

  // Rounded to 0.1 kg: finer than any plate, and it keeps a stored float from
  // carrying fifteen digits of noise into every chart that reads it.
  return Math.round(((set.loadKg * 36) / (37 - total)) * 10) / 10;
}
