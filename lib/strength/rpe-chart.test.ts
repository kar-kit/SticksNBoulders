import { describe, expect, it } from "vitest";
import {
  CHART_POINTS,
  KINK_AT_REPS_TO_FAILURE,
  RTS_CHART,
  chartOneRepMax,
  chartPercent,
  chartPercentFor,
} from "./rpe-chart";
import { MAX_REPS_TO_FAILURE, estimateOneRepMax } from "./e1rm";

/**
 * The chart exactly as published, rows = reps, columns = RPE.
 *
 * Transcribed from the table at
 * fitnessvolt.com/rpe-training/guides/tuchscherer-chart-explained/ and kept
 * here in its published shape on purpose: the module stores the curve, and
 * this is the independent copy that proves the curve reproduces the grid.
 */
const RPE_COLUMNS = [10, 9.5, 9, 8.5, 8, 7.5, 7, 6.5] as const;
const PUBLISHED: Record<number, readonly number[]> = {
  1: [100, 97.8, 95.5, 93.9, 92.2, 90.7, 89.2, 87.8],
  2: [95.5, 93.9, 92.2, 90.7, 89.2, 87.8, 86.3, 85.0],
  3: [92.2, 90.7, 89.2, 87.8, 86.3, 85.0, 83.7, 82.4],
  4: [89.2, 87.8, 86.3, 85.0, 83.7, 82.4, 81.1, 79.9],
  5: [86.3, 85.0, 83.7, 82.4, 81.1, 79.9, 78.6, 77.4],
  6: [83.7, 82.4, 81.1, 79.9, 78.6, 77.4, 76.2, 75.1],
  7: [81.1, 79.9, 78.6, 77.4, 76.2, 75.1, 73.9, 72.3],
  8: [78.6, 77.4, 76.2, 75.1, 73.9, 72.3, 70.7, 69.4],
  9: [76.2, 75.1, 73.9, 72.3, 70.7, 69.4, 68.0, 66.7],
  10: [73.9, 72.3, 70.7, 69.4, 68.0, 66.7, 65.3, 64.0],
};

describe("the chart reproduces every published cell", () => {
  /**
   * 80 cells, 26 values. The collapse is the verification: an 8 x 10 grid can
   * only fold onto a single curve if every cell agrees with every other cell
   * the same distance from failure, so a transcription error anywhere breaks
   * this test rather than sitting in the table unnoticed.
   */
  it("folds 80 cells onto one curve with no contradictions", () => {
    let checked = 0;
    for (const [reps, row] of Object.entries(PUBLISHED)) {
      RPE_COLUMNS.forEach((rpe, column) => {
        expect(chartPercentFor(Number(reps), rpe), `${reps} reps @ RPE ${rpe}`).toBe(row[column]);
        checked += 1;
      });
    }
    expect(checked).toBe(80);
    expect(RTS_CHART.size).toBe(26);
  });

  /**
   * The equivalence that makes it one curve: same distance from failure, same
   * percentage. This is the chart's own structural claim, tested directly.
   */
  it("gives the same percentage for the same distance from failure", () => {
    expect(chartPercentFor(3, 10)).toBe(92.2);
    expect(chartPercentFor(2, 9)).toBe(92.2);
    expect(chartPercentFor(1, 8)).toBe(92.2);
  });

  it("anchors at the weight on the bar for a true single", () => {
    expect(chartPercentFor(1, 10)).toBe(100);
  });
});

describe("the kink CLAUDE.md warned about", () => {
  /**
   * Each step down should shrink as the curve flattens. It does, all the way
   * to 10, then jumps at 11 and recovers. This test exists to stop someone
   * "fixing" the table later without reading why the number is what it is.
   */
  it("is real, isolated, and sits at reps-to-failure 11", () => {
    const whole = Array.from({ length: 12 }, (_, i) => i + 1);
    const deltas = whole.slice(1).map((rtf) => chartPercent(rtf)! - chartPercent(rtf - 1)!);
    const second = deltas.slice(1).map((d, i) => Math.round((d - deltas[i]) * 10) / 10);

    // Every step is a flattening (positive second difference) except one.
    const reversals = second
      // second[i] is centred on the step into reps-to-failure i + 3.
      .map((value, i) => ({ value, atRepsFromFailure: i + 3 }))
      .filter((entry) => entry.value < -0.1);

    expect(reversals).toHaveLength(1);
    expect(reversals[0].atRepsFromFailure).toBe(KINK_AT_REPS_TO_FAILURE);
    expect(reversals[0].value).toBeCloseTo(-0.9, 5);
  });

  /**
   * Kept as published rather than smoothed. Smoothing would swap a sourced
   * number for an invented one and hide the defect from the next reader; the
   * trend would put it near 71.6.
   */
  it("keeps the published value instead of smoothing it", () => {
    expect(chartPercent(11)).toBe(70.7);
  });
});

describe("looking a percentage up", () => {
  it("is exact at every point the source publishes", () => {
    expect(chartPercent(7)).toBe(81.1);
    expect(chartPercent(7.5)).toBe(79.9);
    expect(chartPercent(1)).toBe(100);
    for (const point of CHART_POINTS) {
      expect(chartPercent(point)).toBe(RTS_CHART.get(point));
    }
  });

  it("interpolates between published points", () => {
    // 7.25 sits halfway between 81.1 and 79.9.
    expect(chartPercent(7.25)).toBe(80.5);
  });

  it("says nothing outside the chart rather than extrapolating", () => {
    // Past the last point the published sources disagree with each other, so
    // there is no honest answer to give.
    expect(chartPercent(0.5)).toBeNull();
    expect(chartPercent(14)).toBeNull();
    expect(chartPercent(Number.NaN)).toBeNull();
  });

  it("refuses inputs that are not a set", () => {
    expect(chartPercentFor(0, 8)).toBeNull();
    expect(chartPercentFor(2.5, 8)).toBeNull();
    expect(chartPercentFor(5, 11)).toBeNull();
  });
});

describe("the chart as a rival to Brzycki", () => {
  /**
   * The measured gap, pinned so a future change to either curve has to move
   * this number deliberately. Joey's own example set.
   */
  it("reads 170 x 5 @ RPE 8 about 2.7% higher than the shipping formula", () => {
    const set = { loadKg: 170, reps: 5, rpe: 8 };
    expect(estimateOneRepMax(set)).toBe(204);
    expect(chartOneRepMax(set)).toBe(209.6);

    // 5.6kg on a 204kg max, which becomes 2.5kg on a 75% backoff once
    // Order 18 rounds it to something loadable.
    expect(chartOneRepMax(set)! - estimateOneRepMax(set)!).toBeCloseTo(5.6, 5);
    const gap = (chartOneRepMax(set)! / estimateOneRepMax(set)! - 1) * 100;
    expect(gap).toBeGreaterThan(2.7);
    expect(gap).toBeLessThan(2.8);
  });

  it("agrees exactly with Brzycki on a true single, which is the anchor", () => {
    const single = { loadKg: 200, reps: 1, rpe: 10 };
    expect(chartOneRepMax(single)).toBe(200);
    expect(estimateOneRepMax(single)).toBe(200);
  });

  it("reads higher than Brzycki everywhere else, never lower", () => {
    for (let reps = 1; reps <= 10; reps += 1) {
      for (const rpe of [7, 8, 9, 10]) {
        const set = { loadKg: 150, reps, rpe };
        const brzycki = estimateOneRepMax(set);
        const chart = chartOneRepMax(set);
        if (brzycki === null || chart === null) continue;
        expect(chart, `${reps} @ RPE ${rpe}`).toBeGreaterThanOrEqual(brzycki);
      }
    }
  });

  /**
   * Both must refuse the same sets, or a comparison between them would be a
   * comparison of what each was willing to touch rather than of the curves.
   */
  it("refuses exactly what Brzycki refuses", () => {
    const cases = [
      { loadKg: 170, reps: 5, rpe: 8, isWarmup: true },
      { loadKg: 170, reps: 5, rpe: null },
      { loadKg: 60, reps: 20, rpe: 8 },
      { loadKg: 0, reps: 5, rpe: 8 },
      { loadKg: 170, reps: 0, rpe: 8 },
    ];
    for (const set of cases) {
      expect(chartOneRepMax(set)).toBeNull();
      expect(estimateOneRepMax(set)).toBeNull();
    }
  });

  /** Independent support for a constant that was set on Brzycki's range alone. */
  it("stops where the sources stop trusting RIR reports", () => {
    expect(MAX_REPS_TO_FAILURE).toBe(12);
    expect(chartOneRepMax({ loadKg: 100, reps: 12, rpe: 10 })).not.toBeNull();
    expect(chartOneRepMax({ loadKg: 100, reps: 13, rpe: 10 })).toBeNull();
  });
});
