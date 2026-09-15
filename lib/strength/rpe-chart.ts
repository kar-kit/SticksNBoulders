import { MAX_REPS_TO_FAILURE, repsToFailure, type SetForEstimate } from "./e1rm";

/**
 * The RPE -> %1RM chart, verified.
 *
 * The build plan's copy of this chart was marked [Unverified] and CLAUDE.md
 * required it be checked against a published source before anything hardcoded
 * it, because wrong numbers here are wrong numbers in every athlete's program.
 * This file is that check. What it found is worth reading before trusting it.
 *
 * ## It is one curve, not a grid
 *
 * The chart is published as an 8 x 10 grid of RPE against reps, but it is
 * really a function of a single variable: reps-to-failure, which is the reps
 * performed plus the reps left in reserve. 3 reps at RPE 10, 2 at RPE 9 and 1
 * at RPE 8 are all 3 reps from failure, and the chart gives all three 92.2%.
 *
 * [Fact] All 80 published cells collapse onto 26 distinct reps-to-failure
 * values with zero contradictions -- checked cell by cell against the table at
 * fitnessvolt.com/rpe-training/guides/tuchscherer-chart-explained/. So the
 * grid is stored here as the curve it actually is, which is also what makes a
 * transcription error visible: a bad cell would break the collapse.
 *
 * ## The kink at row 11 is real
 *
 * CLAUDE.md flagged a suspicious kink and named row 11. It is there, and it is
 * the only one.
 *
 * [Fact] Walking the whole-number series, each step down shrinks smoothly --
 * -4.5, -3.3, -3.0, -2.9, -2.6, -2.6, -2.5, -2.4, -2.3 -- and then jumps to
 * -3.2 at 10 -> 11 before returning to -2.7. As second differences that is
 * +0.3, +0.1, +0.3, 0.0, +0.1, +0.1, +0.1, then -0.9, then +0.5. The single
 * sign reversal in the series sits exactly at reps-to-failure 11.
 *
 * The published value is kept rather than smoothed. Smoothing would replace a
 * sourced number with an invented one and hide the defect from whoever reads
 * this next; a chart that quietly disagrees with the one Ruairi has seen is
 * worse than one that matches it and says where it is soft.
 *
 * ## How much to trust the tail
 *
 * [Fact] Published versions of this chart disagree past roughly 10
 * reps-to-failure. A second source (1rmcalculator.org) gives 73%, 74% and 71%
 * for three cells that are all 11 reps-to-failure and must therefore be equal
 * -- it breaks the chart's own invariant, so its tail is rounding noise rather
 * than data.
 *
 * [Fact] A third source (rippedbody.com, citing Nuzzo et al. 2024) reports
 * that the spread of reps achieved at a given percentage is "surprisingly
 * large, especially at low percentages", and cautions specifically about RIR
 * ratings on sets beyond 12 reps. That is independent support for
 * `MAX_REPS_TO_FAILURE`, which was set at 12 on the strength of Brzycki's
 * range alone.
 *
 * ## Nothing is wired to this yet
 *
 * `estimateOneRepMax` still uses Brzycki. This chart disagrees with it by up
 * to 2.7% -- 170 x 5 at RPE 8 is 204.0kg by Brzycki and 209.6kg by the chart
 * -- and adopting it would rewrite every stored e1rm_kg, every rollup's best,
 * every estimated reference max and every percentage Order 18 syncs to a
 * session. That is a live-data migration and Joey's call, so this ships as the
 * reference the product can consult and changes nothing on its own.
 *
 * Pure. No client, no network.
 */

/**
 * Reps-to-failure -> percentage of 1RM, at every point the source publishes.
 *
 * Half steps are real entries, not interpolations: RPE is logged in half
 * points, so 5 reps at RPE 8.5 is 6.5 reps from failure and the source gives
 * it directly.
 */
export const RTS_CHART: ReadonlyMap<number, number> = new Map([
  [1, 100], [1.5, 97.8], [2, 95.5], [2.5, 93.9], [3, 92.2], [3.5, 90.7],
  [4, 89.2], [4.5, 87.8], [5, 86.3], [5.5, 85.0], [6, 83.7], [6.5, 82.4],
  [7, 81.1], [7.5, 79.9], [8, 78.6], [8.5, 77.4], [9, 76.2], [9.5, 75.1],
  [10, 73.9], [10.5, 72.3], [11, 70.7], [11.5, 69.4], [12, 68.0],
  [12.5, 66.7], [13, 65.3], [13.5, 64.0],
]);

/** The reps-to-failure the chart is defined at, ascending. */
export const CHART_POINTS: readonly number[] = [...RTS_CHART.keys()].sort((a, b) => a - b);

/** Where the published curve stops behaving, and the value is kept anyway. */
export const KINK_AT_REPS_TO_FAILURE = 11;

/**
 * The percentage of 1RM a set that many reps from failure represents.
 *
 * Exact at every published point. Between them -- which only happens for a
 * quarter point that no logger can produce, since RPE is captured in halves --
 * it interpolates linearly, because the curve is close to linear over any
 * single half-step and inventing a smoother model would be inventing data.
 *
 * Null outside the chart: below 1 is not a set, and past the last point the
 * sources disagree with each other, so there is no honest answer to give.
 */
export function chartPercent(repsFromFailure: number): number | null {
  if (!Number.isFinite(repsFromFailure)) return null;

  const exact = RTS_CHART.get(repsFromFailure);
  if (exact !== undefined) return exact;

  const first = CHART_POINTS[0];
  const last = CHART_POINTS[CHART_POINTS.length - 1];
  if (repsFromFailure < first || repsFromFailure > last) return null;

  const upperIndex = CHART_POINTS.findIndex((point) => point > repsFromFailure);
  const upper = CHART_POINTS[upperIndex];
  const lower = CHART_POINTS[upperIndex - 1];
  const span = upper - lower;
  const fraction = (repsFromFailure - lower) / span;
  const value = RTS_CHART.get(lower)! + fraction * (RTS_CHART.get(upper)! - RTS_CHART.get(lower)!);
  return Math.round(value * 10) / 10;
}

/** The same question asked the way a set is logged. */
export function chartPercentFor(reps: number, rpe: number): number | null {
  if (!Number.isInteger(reps) || reps < 1) return null;
  if (!Number.isFinite(rpe) || rpe > 10) return null;
  return chartPercent(repsToFailure(reps, rpe));
}

/**
 * One-rep max from the chart rather than from Brzycki.
 *
 * The alternative derivation, offered for comparison and deliberately not
 * wired to anything -- see the note above. It applies the same refusals
 * `estimateOneRepMax` does, so a comparison between the two is a comparison of
 * curves and not of which sets each was willing to touch.
 */
export function chartOneRepMax(set: SetForEstimate): number | null {
  if (set.isWarmup) return null;
  if (set.rpe === null || !Number.isFinite(set.rpe)) return null;
  if (!Number.isFinite(set.loadKg) || set.loadKg <= 0) return null;
  if (!Number.isInteger(set.reps) || set.reps < 1) return null;

  const total = repsToFailure(set.reps, set.rpe);
  if (total < 1 || total > MAX_REPS_TO_FAILURE) return null;

  const percent = chartPercent(total);
  if (percent === null || percent <= 0) return null;
  return Math.round((set.loadKg / (percent / 100)) * 10) / 10;
}
