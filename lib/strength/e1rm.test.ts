import { describe, expect, it } from "vitest";
import {
  estimateOneRepMax,
  isEstimableRpe,
  MAX_REPS_TO_FAILURE,
  MIN_ESTIMABLE_RPE,
  repsInReserve,
  repsToFailure,
} from "./e1rm";

const set = (over: Partial<Parameters<typeof estimateOneRepMax>[0]> = {}) =>
  estimateOneRepMax({ loadKg: 140, reps: 5, rpe: 8, ...over });

describe("reps to failure", () => {
  it("reads RPE as how many reps were left", () => {
    expect(repsInReserve(10)).toBe(0);
    expect(repsInReserve(8)).toBe(2);
    expect(repsInReserve(6)).toBe(4);
  });

  it("counts the set as if it had gone to failure", () => {
    expect(repsToFailure(5, 8)).toBe(7);
    expect(repsToFailure(1, 10)).toBe(1);
  });

  it("handles half points, which are most of what gets logged", () => {
    expect(repsToFailure(3, 8.5)).toBe(4.5);
  });
});

describe("estimateOneRepMax", () => {
  it("returns the weight on the bar for a single at RPE 10", () => {
    // The assertion that chose the formula. A single at RPE 10 is a tested max
    // by definition, so the estimate has to equal it. Epley returns 1.033x here,
    // which would report every heavy single as more than was actually lifted.
    expect(set({ loadKg: 200, reps: 1, rpe: 10 })).toBe(200);
    expect(set({ loadKg: 142.5, reps: 1, rpe: 10 })).toBe(142.5);
  });

  it("estimates a submaximal set from how close to failure it was", () => {
    // 140 x 5 @ RPE 8 is seven reps to failure: 140 x 36 / 30.
    expect(set()).toBe(168);
  });

  it("reads the same load and reps differently at different RPEs", () => {
    // The whole reason RPE is required. A rep-count-only formula treats these
    // three as the same set, and they are not remotely the same set.
    expect(set({ rpe: 10 })).toBe(157.5);
    expect(set({ rpe: 8 })).toBe(168);
    expect(set({ rpe: 6 })).toBe(180);
  });

  it("rises with load, reps and distance from failure", () => {
    expect(set({ loadKg: 150 })).toBeGreaterThan(set()!);
    expect(set({ reps: 6 })).toBeGreaterThan(set()!);
    expect(set({ rpe: 7 })).toBeGreaterThan(set()!);
  });

  it("rounds to a tenth of a kilo, finer than any plate", () => {
    // 100 x 3 @ RPE 9 is four reps to failure: 100 x 36 / 33 = 109.0909...
    expect(set({ loadKg: 100, reps: 3, rpe: 9 })).toBe(109.1);
    // 142.5 x 2 @ RPE 9 is three: 142.5 x 36 / 34 = 150.882...
    expect(set({ loadKg: 142.5, reps: 2, rpe: 9 })).toBe(150.9);
  });
});

describe("when there is no honest estimate", () => {
  it("says nothing for a set with no RPE", () => {
    // "Not sure" is a real answer. Without it the set could be a grinder or an
    // easy back-off at the same load and reps, and a wrong number is worse
    // than no number.
    expect(set({ rpe: null })).toBeNull();
  });

  it("says nothing for a warm-up", () => {
    expect(set({ isWarmup: true })).toBeNull();
    // Even one flagged at a high RPE, which is a mis-tap rather than a max.
    expect(set({ isWarmup: true, rpe: 10 })).toBeNull();
  });

  it("says nothing once the set is about endurance rather than strength", () => {
    // A twenty-rep back-off must never become somebody's best e1RM of the week.
    expect(repsToFailure(10, 8)).toBe(MAX_REPS_TO_FAILURE);
    expect(set({ reps: 10, rpe: 8 })).not.toBeNull();
    expect(set({ reps: 11, rpe: 8 })).toBeNull();
    expect(set({ reps: 20, rpe: 6 })).toBeNull();
  });

  it("says nothing for a set logged below RPE 6 (F10)", () => {
    // 100 x 5 @ 4 would be eleven reps to failure, inside MAX_REPS_TO_FAILURE,
    // and Brzycki would call it 138.5 kg: the same as 100 x 11 to failure.
    // "Easy" is not a count of reps in reserve, so it estimates nothing.
    expect(MIN_ESTIMABLE_RPE).toBe(6);
    expect(repsToFailure(5, 4)).toBeLessThanOrEqual(MAX_REPS_TO_FAILURE);
    for (const rpe of [5, 4, 3]) {
      expect(set({ loadKg: 100, reps: 5, rpe })).toBeNull();
      expect(set({ loadKg: 200, reps: 1, rpe })).toBeNull();
    }
    // Six is still the coach's scale, so it still estimates.
    expect(set({ rpe: 6 })).toBe(180);
  });

  it("knows which RPEs an estimate can be made from", () => {
    for (const rpe of [6, 6.5, 8, 10]) expect(isEstimableRpe(rpe)).toBe(true);
    for (const rpe of [null, 5, 5.5, 3, 10.5, Number.NaN]) expect(isEstimableRpe(rpe)).toBe(false);
  });

  it("says nothing for numbers that are not a set", () => {
    expect(set({ reps: 0 })).toBeNull();
    expect(set({ reps: -1 })).toBeNull();
    expect(set({ reps: 2.5 })).toBeNull();
    expect(set({ loadKg: 0 })).toBeNull();
    expect(set({ loadKg: Number.NaN })).toBeNull();
  });
});

describe("a failed set (F19)", () => {
  it("gets no estimate, whatever its load, reps and RPE", () => {
    // 150 x 3 @ 9 would otherwise be ~163 kg.
    expect(estimateOneRepMax({ loadKg: 150, reps: 3, rpe: 9 })).not.toBeNull();
    expect(estimateOneRepMax({ loadKg: 150, reps: 3, rpe: 9, failed: true })).toBeNull();
    expect(estimateOneRepMax({ loadKg: 200, reps: 0, rpe: 10, failed: true })).toBeNull();
  });

  it("is a made set when the flag is false or absent, as on every set before v19", () => {
    expect(estimateOneRepMax({ loadKg: 150, reps: 3, rpe: 9, failed: false })).toBe(
      estimateOneRepMax({ loadKg: 150, reps: 3, rpe: 9 }),
    );
  });
});
