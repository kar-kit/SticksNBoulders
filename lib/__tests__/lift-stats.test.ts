import { epley1RM, computeBest1RM, computeRepPRs } from "../lift-stats";
import type { WorkoutSet } from "../types";

function makeSet(overrides: Partial<WorkoutSet> = {}): WorkoutSet {
  return {
    $id: "set-" + Math.random(),
    $sequence: "0",
    $tableId: "workout_sets",
    $databaseId: "sticksnboulders",
    $createdAt: "",
    $updatedAt: "",
    $permissions: [],
    userId: "user-1",
    sessionId: "session-1",
    liftId: "squat",
    date: "2026-01-01T00:00:00.000Z",
    weightKg: 100,
    reps: 5,
    isWarmup: false,
    ...overrides,
  };
}

describe("epley1RM", () => {
  it("returns the weight as-is for a single rep", () => {
    expect(epley1RM(150, 1)).toBe(150);
  });

  it("returns the weight as-is for 0 reps (defensive, not a realistic input)", () => {
    expect(epley1RM(150, 0)).toBe(150);
  });

  it("applies the Epley formula for reps > 1", () => {
    // Epley: weight * (1 + reps/30)
    expect(epley1RM(100, 5)).toBeCloseTo(100 * (1 + 5 / 30), 10);
  });

  it("increases monotonically with reps at a fixed weight", () => {
    const at5 = epley1RM(100, 5);
    const at10 = epley1RM(100, 10);
    expect(at10).toBeGreaterThan(at5);
  });

  it("handles a 0kg weight without throwing", () => {
    expect(epley1RM(0, 8)).toBe(0);
  });
});

describe("computeBest1RM", () => {
  it("returns null for an empty set list", () => {
    expect(computeBest1RM([])).toBeNull();
  });

  it("returns null when every set is a warm-up", () => {
    const sets = [makeSet({ isWarmup: true }), makeSet({ isWarmup: true, weightKg: 200 })];
    expect(computeBest1RM(sets)).toBeNull();
  });

  it("excludes warm-up sets from consideration even if heavier", () => {
    const warmup = makeSet({ isWarmup: true, weightKg: 999, reps: 1 });
    const working = makeSet({ isWarmup: false, weightKg: 100, reps: 5 });
    const result = computeBest1RM([warmup, working]);
    expect(result?.sourceSet).toBe(working);
  });

  it("picks the set with the highest estimated 1RM, not the heaviest raw weight", () => {
    // 80kg x10 -> 80*(1+10/30) = 106.67 estimated 1RM
    // 100kg x1 -> 100 estimated 1RM
    const highRepLighter = makeSet({ weightKg: 80, reps: 10 });
    const singleHeavier = makeSet({ weightKg: 100, reps: 1 });
    const result = computeBest1RM([singleHeavier, highRepLighter]);
    expect(result?.sourceSet).toBe(highRepLighter);
    expect(result?.estimatedKg).toBeCloseTo(80 * (1 + 10 / 30), 10);
  });

  it("returns a single qualifying set correctly", () => {
    const only = makeSet({ weightKg: 120, reps: 3 });
    const result = computeBest1RM([only]);
    expect(result?.sourceSet).toBe(only);
    expect(result?.estimatedKg).toBeCloseTo(epley1RM(120, 3), 10);
  });
});

describe("computeRepPRs", () => {
  it("returns an empty map for no sets", () => {
    expect(computeRepPRs([]).size).toBe(0);
  });

  it("excludes warm-up sets", () => {
    const prs = computeRepPRs([makeSet({ isWarmup: true, reps: 5, weightKg: 999 })]);
    expect(prs.size).toBe(0);
  });

  it("excludes sets with 0 reps", () => {
    const prs = computeRepPRs([makeSet({ reps: 0, weightKg: 100 })]);
    expect(prs.size).toBe(0);
  });

  it("excludes sets above the 12-rep bracket ceiling", () => {
    const prs = computeRepPRs([makeSet({ reps: 13, weightKg: 100 })]);
    expect(prs.size).toBe(0);
  });

  it("includes a set at exactly the 12-rep ceiling", () => {
    const prs = computeRepPRs([makeSet({ reps: 12, weightKg: 100 })]);
    expect(prs.get(12)).toBe(100);
  });

  it("keeps the heaviest weight per rep count when duplicates exist", () => {
    const prs = computeRepPRs([
      makeSet({ reps: 5, weightKg: 100 }),
      makeSet({ reps: 5, weightKg: 120 }),
      makeSet({ reps: 5, weightKg: 90 }),
    ]);
    expect(prs.get(5)).toBe(120);
  });

  it("tracks separate PRs per distinct rep count", () => {
    const prs = computeRepPRs([
      makeSet({ reps: 1, weightKg: 150 }),
      makeSet({ reps: 5, weightKg: 120 }),
      makeSet({ reps: 10, weightKg: 80 }),
    ]);
    expect(prs.get(1)).toBe(150);
    expect(prs.get(5)).toBe(120);
    expect(prs.get(10)).toBe(80);
    expect(prs.size).toBe(3);
  });
});
