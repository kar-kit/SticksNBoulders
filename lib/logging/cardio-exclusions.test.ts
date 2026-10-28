import { describe, expect, it } from "vitest";
import { summariseSession, type SessionSet } from "./session";
import { totalsOf } from "./session-edit";
import { asksForRpe, canComplete, completionBlocker, countsTowardPrs } from "./set";
import { rollupFrom, type RollupSet } from "@/lib/strength/rollup";
import { estimateOneRepMax } from "@/lib/strength/e1rm";
import { detectPrs, priorBests, repBests, sessionPrs, type PrKind } from "@/lib/strength/pr";
import { topSetOf } from "@/lib/programming/backoff";
import { suggestLoad } from "@/lib/strength/suggestion";
import { nextSetSuggestion } from "./suggestion-gate";

/**
 * F23: every rule that keeps a cardio set out of the strength maths, one
 * place, each asserted on its own. A cardio set is stored as load 0, reps 0
 * with a duration and maybe a level (lib/logging/cardio.ts). The cases below
 * also feed it in with a strength-looking load and reps, because the rule is
 * the duration, not the zeroes: a cardio set that somehow carried 100 x 5
 * must still count for nothing.
 */

const at = new Date("2026-10-22T18:00:00Z");
const sessionStart = new Date("2026-10-22T17:00:00Z");

const stored = { loadKg: 0, reps: 0, rpe: null, isWarmup: false, failed: false };
const cardio = { ...stored, durationSeconds: 1200, level: 8 };
/** A cardio set with strength numbers on it: must still count for nothing. */
const disguised = { loadKg: 100, reps: 5, rpe: 8, isWarmup: false, failed: false, durationSeconds: 1200, level: 8 };
/** A cardio set read by code that dropped its columns: 0 x 0, not failed. */
const stripped = { ...stored };

const sessionSet = (over: Partial<SessionSet>): SessionSet => ({
  exerciseId: "squat",
  exerciseName: "Squat",
  loadKg: 100,
  reps: 5,
  rpe: 8,
  isWarmup: false,
  loggedAt: at,
  ...over,
});

describe("session totals: tonnage and set count", () => {
  it("leave a cardio set out of the tonnage and the set count, and total its time apart", () => {
    const summary = summariseSession([
      sessionSet({}),
      sessionSet({ exerciseId: "treadmill", exerciseName: "Treadmill", ...cardio }),
      sessionSet({ exerciseId: "bike", exerciseName: "Bike", ...disguised }),
    ]);
    expect(summary.setCount).toBe(1);
    expect(summary.tonnageKg).toBe(500);
    expect(summary.warmupCount).toBe(0);
    expect(summary.cardioSeconds).toBe(2400);
    // The Bike and the Treadmill were in the session.
    expect(summary.exerciseCount).toBe(3);
  });

  it("store 0 sets and 0 kg for a session that was only cardio", () => {
    const summary = summariseSession([sessionSet({ exerciseId: "stairs", ...cardio })]);
    expect(summary).toMatchObject({ setCount: 0, tonnageKg: 0, warmupCount: 0, cardioSeconds: 1200 });
  });

  it("never count a cardio set read without its columns as a set", () => {
    expect(summariseSession([sessionSet({ ...stripped })]).setCount).toBe(0);
  });

  it("agree after a History edit, which totals the same way", () => {
    const sets = [sessionSet({}), sessionSet({ exerciseId: "bike", ...disguised })];
    expect(totalsOf(sets)).toEqual({ setCount: 1, tonnageKg: 500 });
  });
});

describe("e1RM", () => {
  it("is never estimated from a cardio set, whatever load and reps it carries", () => {
    expect(estimateOneRepMax(cardio)).toBeNull();
    expect(estimateOneRepMax(disguised)).toBeNull();
    // The same numbers without a duration are a set with an estimate.
    expect(estimateOneRepMax({ loadKg: 100, reps: 5, rpe: 8 })).not.toBeNull();
  });
});

describe("personal records", () => {
  const bests = { e1rmKg: 50, heaviestKg: 50, repsAt: [{ loadKg: 0, reps: 1 }] };

  it("are never a cardio set: no e1RM, no weight, no reps record", () => {
    const found = detectPrs(
      [
        { clientSetId: "c", ...disguised },
        { clientSetId: "c0", ...cardio },
      ],
      bests,
    );
    expect(found.size).toBe(0);
  });

  it("never let a cardio set into the running bests a later lift is measured against", () => {
    // 100 x 5 dressed as cardio first: the real 60 x 3 after it is still a
    // weight record over the 50 on record.
    const found = detectPrs(
      [
        { clientSetId: "c", ...disguised },
        { clientSetId: "w", loadKg: 60, reps: 3, rpe: 8, isWarmup: false },
      ],
      bests,
    );
    expect(found.get("w")).toContain("weight");
  });

  it("never list one on the finish screen, even from a map that claims it", () => {
    const sets = [{ clientSetId: "c", exerciseId: "bike", ...disguised }];
    const claimed = new Map<string, PrKind[]>([["c", ["e1rm", "weight", "reps"]]]);
    expect(sessionPrs(sets, claimed)).toEqual([]);
  });

  it("are not history: a lift with only cardio before has no bests and no rep frontier", () => {
    const before = [
      { ...disguised, loggedAt: new Date("2026-10-20T18:00:00Z"), e1rmKg: 120 },
      { ...cardio, loggedAt: new Date("2026-10-20T18:05:00Z") },
      { ...stripped, loggedAt: new Date("2026-10-20T18:10:00Z") },
    ];
    expect(priorBests([], before, sessionStart)).toBeNull();
    expect(repBests(before, sessionStart)).toEqual([]);
  });

  it("countsTowardPrs says no for a cardio row", () => {
    expect(countsTowardPrs({ ...disguised, rpe: 8 as const, isCardio: true })).toBe(false);
    expect(countsTowardPrs({ ...disguised, rpe: 8 as const })).toBe(false);
  });
});

describe("weekly rollups (and so DOTS, Lift Detail, the roster and the week card)", () => {
  const rollupSet = (over: Partial<RollupSet>): RollupSet => ({
    loadKg: 100,
    reps: 5,
    isWarmup: false,
    e1rmKg: 120,
    loggedAt: at,
    ...over,
  });

  it("leave a cardio set out of every figure", () => {
    const rollup = rollupFrom([
      rollupSet({}),
      rollupSet({ ...disguised, e1rmKg: 200 }),
      rollupSet({ ...cardio, e1rmKg: null }),
    ]);
    expect(rollup).toEqual({
      setCount: 1,
      volumeReps: 5,
      tonnageKg: 500,
      bestE1rmKg: 120,
      bestSingleKg: 100,
      bestSingleReps: 5,
      bestReps: 5,
      bestRepsLoadKg: 100,
    });
  });

  it("make a week of only cardio a week with no working sets, which the rebuild removes", () => {
    const onlyCardio = [rollupSet({ ...cardio, e1rmKg: null }), rollupSet({ ...stripped, e1rmKg: null })];
    expect(rollupFrom(onlyCardio).setCount).toBe(0);
  });
});

describe("backoff and suggestions", () => {
  it("never take a cardio set as the top set", () => {
    expect(topSetOf([disguised])).toBeNull();
    expect(topSetOf([{ loadKg: 80, reps: 5, rpe: 8 }, disguised])).toEqual({ loadKg: 80, reps: 5, rpe: 8 });
  });

  it("never suggest a load from a cardio set", () => {
    expect(suggestLoad(disguised, { reps: 5, rpe: 8 })).toBeNull();
    expect(nextSetSuggestion("direct", disguised, { reps: 5, rpe: 8 })).toBeNull();
    // The same numbers without a duration do suggest.
    expect(suggestLoad({ loadKg: 100, reps: 5, rpe: 8 }, { reps: 5, rpe: 8 })).not.toBeNull();
  });
});

describe("the row: RPE sheet, Failed switch and the video ask", () => {
  it("never asks a cardio row for an RPE", () => {
    expect(asksForRpe({ loadKg: null, reps: null, rpe: null, isWarmup: false, isCardio: true })).toBe(false);
    expect(asksForRpe({ loadKg: null, reps: null, rpe: null, isWarmup: false })).toBe(true);
  });

  it("logs on a duration alone: no load, no reps, and no video gate", () => {
    const row = { loadKg: null, reps: null, rpe: null, isWarmup: false, isCardio: true };
    expect(canComplete({ ...row, durationSeconds: 1200 })).toBe(true);
    expect(canComplete({ ...row, durationSeconds: 1200, videoRequired: true })).toBe(true);
    expect(completionBlocker({ ...row, durationSeconds: 1200, videoRequired: true })).toBeNull();
    expect(canComplete({ ...row, durationSeconds: null, level: 8 })).toBe(false);
    expect(completionBlocker({ ...row, durationSeconds: null })).toBe("incomplete");
  });

  it("is never refused for its 0 kg, which on a strength row says 0 kg needs a bodyweight lift", () => {
    const row = { loadKg: 0, reps: 0, rpe: null, isWarmup: false, isCardio: true, durationSeconds: 600 };
    expect(completionBlocker(row)).toBeNull();
  });
});
