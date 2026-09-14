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
 * - **Too far from failure to mean anything**, per MAX_REPS_TO_FAILURE.
 */
export function estimateOneRepMax(set: SetForEstimate): number | null {
  if (set.isWarmup) return null;
  if (set.rpe === null || !Number.isFinite(set.rpe)) return null;
  if (!Number.isFinite(set.loadKg) || set.loadKg <= 0) return null;
  if (!Number.isInteger(set.reps) || set.reps < 1) return null;

  const total = repsToFailure(set.reps, set.rpe);
  if (total < 1 || total > MAX_REPS_TO_FAILURE) return null;

  // Rounded to 0.1 kg: finer than any plate, and it keeps a stored float from
  // carrying fifteen digits of noise into every chart that reads it.
  return Math.round(((set.loadKg * 36) / (37 - total)) * 10) / 10;
}
