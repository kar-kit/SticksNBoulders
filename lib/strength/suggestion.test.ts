import { describe, expect, it } from "vitest";
import { MAX_SUGGESTION_SPAN, suggestLoad } from "./suggestion";
import { chartOneRepMax, chartPercent } from "./rpe-chart";
import { estimateOneRepMax } from "./e1rm";
import { LOADABLE_INCREMENT_KG } from "./plates";

const logged = (over: Partial<Parameters<typeof suggestLoad>[0]> = {}) => ({
  loadKg: 170,
  reps: 5,
  rpe: 7,
  ...over,
});

describe("the ticket's own example", () => {
  /** "Log RPE 7 at 170 and the app suggests the next step." */
  it("suggests going up when the set came in easier than the target", () => {
    const suggestion = suggestLoad(logged(), { reps: 5, rpe: 8 });
    expect(suggestion).toMatchObject({ loadKg: 175, fromRpe: 7, fromLoadKg: 170 });
  });

  it("suggests coming down when the set was harder than the target", () => {
    const suggestion = suggestLoad(logged({ rpe: 9 }), { reps: 5, rpe: 8 });
    expect(suggestion!.loadKg).toBeLessThan(170);
  });

  it("holds the weight when the athlete is already on target", () => {
    expect(suggestLoad(logged({ rpe: 8 }), { reps: 5, rpe: 8 })!.loadKg).toBe(170);
  });

  /** The provenance prefill renders: "suggested from RPE 7 @ 142.5". */
  it("reports the set it came from, not the target", () => {
    const suggestion = suggestLoad(logged({ loadKg: 142.5, rpe: 7 }), { reps: 5, rpe: 8 });
    expect(suggestion).toMatchObject({ fromRpe: 7, fromLoadKg: 142.5 });
  });
});

describe("what it refuses, and why each one is a real case", () => {
  it("says nothing without an RPE to anchor on", () => {
    // The athlete answered "not sure". The set could be a grinder or an easy
    // back-off at the same load and reps.
    expect(suggestLoad(logged({ rpe: null }), { reps: 5, rpe: 8 })).toBeNull();
  });

  it("says nothing from a warm-up", () => {
    expect(suggestLoad(logged({ isWarmup: true }), { reps: 5, rpe: 8 })).toBeNull();
  });

  it("says nothing once the set is about endurance rather than strength", () => {
    expect(suggestLoad(logged({ reps: 20, rpe: 8 }), { reps: 20, rpe: 9 })).toBeNull();
  });

  /**
   * An athlete who did 8 at RPE 7 has told you very little about a heavy
   * single. A suggestion that confident would be a guess wearing a number.
   */
  it("will not reach further than the last set is evidence for", () => {
    expect(MAX_SUGGESTION_SPAN).toBe(2);
    // 8 @ 7 is 11 from failure; 1 @ 9 is 2. Way outside.
    expect(suggestLoad(logged({ reps: 8, rpe: 7 }), { reps: 1, rpe: 9 })).toBeNull();
    // Exactly at the limit still answers.
    expect(suggestLoad(logged({ reps: 5, rpe: 7 }), { reps: 5, rpe: 9 })).not.toBeNull();
    // One step beyond does not.
    expect(suggestLoad(logged({ reps: 5, rpe: 7 }), { reps: 5, rpe: 9.5 })).toBeNull();
  });

  it("says nothing for numbers that are not a set", () => {
    expect(suggestLoad(logged({ loadKg: 0 }), { reps: 5, rpe: 8 })).toBeNull();
    expect(suggestLoad(logged({ reps: 0 }), { reps: 5, rpe: 8 })).toBeNull();
    expect(suggestLoad(logged(), { reps: 0, rpe: 8 })).toBeNull();
  });
});

describe("the weight is loadable, and rounded the safe way", () => {
  it("lands on a plate step", () => {
    const suggestion = suggestLoad(logged({ loadKg: 142.5, rpe: 7 }), { reps: 5, rpe: 8 });
    expect(suggestion!.loadKg % LOADABLE_INCREMENT_KG).toBe(0);
  });

  /**
   * Same argument as Order 18's percentages: suggesting heavier than the
   * athlete can hold at the target RPE is the harmful direction.
   */
  it("rounds down rather than up", () => {
    // Exact ratio is 142.5 x 30/29 = 147.4, which floors to 145.
    expect(suggestLoad(logged({ loadKg: 142.5, rpe: 7 }), { reps: 5, rpe: 8 })!.loadKg).toBe(145);
  });
});

describe("the suggestion is a ratio, so the open curve decision does not block it", () => {
  /**
   * The load appears on both sides of the ratio and the estimated max cancels,
   * so a suggestion depends on the SHAPE of the curve over a short span rather
   * than on its absolute value. Order 26 measured the two candidate curves
   * 2.7% apart; this is why that gap does not reach a suggestion.
   */
  const bySameCurveRatio = (loadKg: number, from: number, to: number) =>
    loadKg * (chartPercent(to)! / chartPercent(from)!);

  it("agrees with the RTS chart to inside one plate step on a normal suggestion", () => {
    const set = { loadKg: 170, reps: 5, rpe: 7 };
    const brzycki = suggestLoad(set, { reps: 5, rpe: 8 })!.loadKg;
    // 5 @ 7 is 8 from failure; 5 @ 8 is 7.
    const chart = bySameCurveRatio(170, 8, 7);
    expect(Math.abs(chart - brzycki)).toBeLessThan(LOADABLE_INCREMENT_KG);
  });

  it("is unaffected by the absolute disagreement between the two curves", () => {
    // The same set the two curves value 5.6kg apart as an e1RM...
    const set = { loadKg: 170, reps: 5, rpe: 8 };
    expect(chartOneRepMax(set)! - estimateOneRepMax(set)!).toBeCloseTo(5.6, 5);
    // ...still yields the same suggested weight from both.
    const brzycki = suggestLoad(set, { reps: 5, rpe: 9 })!.loadKg;
    const chart = Math.floor(bySameCurveRatio(170, 7, 6) / 2.5) * 2.5;
    expect(brzycki).toBe(chart);
  });

  /**
   * The exception, flagged rather than gated: working up to a top single is
   * exactly what a powerlifter does, so the suggestion is still given -- but
   * this is where Joey's pending curve decision could visibly move it.
   */
  it("marks a target near a maximal single, where the curves do diverge", () => {
    const topSingle = suggestLoad({ loadKg: 180, reps: 1, rpe: 8 }, { reps: 1, rpe: 9 });
    expect(topSingle!.nearMaximal).toBe(true);

    const backoff = suggestLoad(logged(), { reps: 5, rpe: 8 });
    expect(backoff!.nearMaximal).toBe(false);
  });
});
