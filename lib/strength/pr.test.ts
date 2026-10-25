import { detectPrs, priorBests, repBests, sessionPrs, type PriorSet, type SessionSetForPr } from "./pr";
import type { WeekPoint } from "./lift";
import { lbToKg, loadFromInput } from "@/lib/units";

// Thursday 22 Oct 2026, 18:00 London (BST, UTC+1). Its week began Monday 19 Oct.
const sessionStart = new Date("2026-10-22T17:00:00Z");

const week = (iso: string, over: Partial<WeekPoint> = {}): WeekPoint => ({
  weekStart: new Date(iso),
  bestE1rmKg: null,
  bestSingleKg: null,
  bestSingleReps: null,
  bestReps: null,
  bestRepsLoadKg: null,
  ...over,
});

const raw = (iso: string, over: Partial<PriorSet> = {}): PriorSet => ({
  loadKg: 100,
  reps: 5,
  rpe: null,
  isWarmup: false,
  loggedAt: new Date(iso),
  ...over,
});

const set = (id: string, loadKg: number, reps: number, rpe: number | null = null, isWarmup = false): SessionSetForPr => ({
  clientSetId: id,
  loadKg,
  reps,
  rpe,
  isWarmup,
});

describe("priorBests", () => {
  it("takes every week before the session's week from the rollups", () => {
    const weeks = [
      week("2026-10-05T00:00:00Z", { bestE1rmKg: 170, bestSingleKg: 150 }),
      week("2026-10-12T00:00:00Z", { bestE1rmKg: 165, bestSingleKg: 155 }),
    ];
    expect(priorBests(weeks, [], sessionStart)).toEqual({ e1rmKg: 170, heaviestKg: 155 });
  });

  it("ignores the session's own week's rollup, which syncing sets keep changing", () => {
    const weeks = [
      week("2026-10-12T00:00:00Z", { bestE1rmKg: 165, bestSingleKg: 150 }),
      // Already holds today's 160 single once it synced.
      week("2026-10-19T00:00:00Z", { bestE1rmKg: 180, bestSingleKg: 160 }),
    ];
    expect(priorBests(weeks, [], sessionStart)).toEqual({ e1rmKg: 165, heaviestKg: 150 });
  });

  it("covers earlier days of this week from raw sets logged before the session", () => {
    const weeks = [week("2026-10-12T00:00:00Z", { bestE1rmKg: 165, bestSingleKg: 150 })];
    const before = [
      // Monday this week: 152.5 x 3 @ 9.
      raw("2026-10-19T18:00:00Z", { loadKg: 152.5, reps: 3, rpe: 9, e1rmKg: 166.4 }),
    ];
    expect(priorBests(weeks, before, sessionStart)).toEqual({ e1rmKg: 166.4, heaviestKg: 152.5 });
  });

  it("files a Monday 00:30 BST set in this week, not last", () => {
    // 23:30 UTC on Sunday is 00:30 on Monday in London.
    const weeks: WeekPoint[] = [];
    const before = [raw("2026-10-18T23:30:00Z", { loadKg: 157.5 })];
    expect(priorBests(weeks, before, sessionStart)?.heaviestKg).toBe(157.5);
  });

  it("never counts a warm-up, or a set logged after the session started", () => {
    const before = [
      raw("2026-10-20T18:00:00Z", { loadKg: 200, isWarmup: true }),
      raw("2026-10-22T17:30:00Z", { loadKg: 190 }),
      raw("2026-10-20T18:00:00Z", { loadKg: 140 }),
    ];
    expect(priorBests([], before, sessionStart)).toEqual({ e1rmKg: null, heaviestKg: 140 });
  });

  it("estimates a raw set's e1RM when it was stored without one", () => {
    const before = [raw("2026-10-20T18:00:00Z", { loadKg: 150, reps: 1, rpe: 10 })];
    expect(priorBests([], before, sessionStart)?.e1rmKg).toBe(150);
  });

  it("is null when there is no working set on record at all", () => {
    expect(priorBests([], [], sessionStart)).toBeNull();
    expect(priorBests([], [raw("2026-10-20T18:00:00Z", { isWarmup: true })], sessionStart)).toBeNull();
    expect(priorBests([week("2026-10-12T00:00:00Z")], [], sessionStart)).toBeNull();
  });
});

describe("priorBests with sets logged below RPE 6", () => {
  it("takes their weight but not an estimate", () => {
    // Stored with no e1rm_kg, as the write helper stores them, and recomputed
    // to nothing too.
    const before = [raw("2026-10-20T18:00:00Z", { loadKg: 160, reps: 5, rpe: 4, e1rmKg: null })];
    expect(priorBests([], before, sessionStart)).toEqual({ e1rmKg: null, heaviestKg: 160 });
  });
});

describe("repBests", () => {
  it("keeps, per load, the most reps at that load or heavier, heaviest first", () => {
    const before = [
      raw("2026-10-01T18:00:00Z", { loadKg: 150, reps: 2 }),
      raw("2026-10-05T18:00:00Z", { loadKg: 140, reps: 5 }),
      raw("2026-10-08T18:00:00Z", { loadKg: 140, reps: 4 }),
      // Under 140 x 5 on both counts: says nothing more.
      raw("2026-10-12T18:00:00Z", { loadKg: 135, reps: 5 }),
      raw("2026-10-15T18:00:00Z", { loadKg: 120, reps: 10 }),
    ];
    expect(repBests(before, sessionStart)).toEqual([
      { loadKg: 150, reps: 2 },
      { loadKg: 140, reps: 5 },
      { loadKg: 120, reps: 10 },
    ]);
  });

  it("never counts a warm-up, an empty set, or a set logged after the session started", () => {
    const before = [
      raw("2026-10-20T18:00:00Z", { loadKg: 100, reps: 20, isWarmup: true }),
      raw("2026-10-20T18:00:00Z", { loadKg: 100, reps: 0 }),
      raw("2026-10-22T17:30:00Z", { loadKg: 100, reps: 12 }),
      raw("2026-10-20T18:00:00Z", { loadKg: 100, reps: 8 }),
    ];
    expect(repBests(before, sessionStart)).toEqual([{ loadKg: 100, reps: 8 }]);
  });

  it("files loads by the tenth of a kilo, so 315 lb typed twice is one load", () => {
    const before = [
      raw("2026-10-05T18:00:00Z", { loadKg: lbToKg(315), reps: 3 }),
      raw("2026-10-08T18:00:00Z", { loadKg: loadFromInput(315, "lb"), reps: 4 }),
    ];
    expect(repBests(before, sessionStart)).toEqual([{ loadKg: 142.9, reps: 4 }]);
  });
});

describe("detectPrs", () => {
  const bests = { e1rmKg: 170, heaviestKg: 150 };

  it("badges a heavier load than ever", () => {
    expect(detectPrs([set("a", 152.5, 1)], bests)).toEqual(new Map([["a", ["weight"]]]));
  });

  it("does not badge a tie", () => {
    expect(detectPrs([set("a", 150, 3)], bests).size).toBe(0);
  });

  it("badges an e1RM record only with an RPE", () => {
    // 145 x 5 @ 9: 6 to failure, 145 * 36 / 31 = 168.4. 150 x 5 @ 9 = 174.2.
    expect(detectPrs([set("a", 145, 5, 9)], bests).size).toBe(0);
    expect(detectPrs([set("b", 150, 5, 9)], bests)).toEqual(new Map([["b", ["e1rm"]]]));
    expect(detectPrs([set("c", 150, 5, null)], bests).size).toBe(0);
  });

  it("withholds only the e1RM record from a set logged below RPE 6 (F10)", () => {
    // 150 x 5 @ 9 is an e1RM record above. The same set called a 5 is not:
    // "easy" is not a count of reps in reserve. Every number it would have
    // claimed is higher still, which is exactly the overestimate refused.
    for (const rpe of [5, 4, 3]) {
      expect(detectPrs([set("a", 150, 5, rpe)], bests).size).toBe(0);
    }
    // Weight and rep records never read RPE: 155 on the bar is 155 however it felt.
    expect(detectPrs([set("w", 155, 2, 4)], bests)).toEqual(new Map([["w", ["weight"]]]));
    const frontier = { ...bests, repsAt: [{ loadKg: 140, reps: 5 }] };
    expect(detectPrs([set("r", 140, 6, 5)], frontier)).toEqual(new Map([["r", ["reps"]]]));
  });

  it("does not let an easy set's would-be estimate raise the bar for a later one", () => {
    // If 150 x 8 @ 3 counted, it would claim far more than 170 and block the
    // honest 150 x 5 @ 9 record after it.
    const found = detectPrs([set("easy", 150, 8, 3), set("real", 150, 5, 9)], bests);
    expect(found.get("easy")).toBeUndefined();
    expect(found.get("real")).toEqual(["e1rm"]);
  });

  it("gives one set both kinds, once each", () => {
    expect(detectPrs([set("a", 160, 3, 9)], bests)).toEqual(new Map([["a", ["e1rm", "weight"]]]));
  });

  it("measures each set against the best so far today, so a lighter later set is no record", () => {
    const found = detectPrs([set("a", 152.5, 1), set("b", 155, 1), set("c", 152.5, 1)], bests);
    expect([...found.keys()]).toEqual(["a", "b"]);
  });

  it("never counts a warm-up or an incomplete set", () => {
    expect(detectPrs([set("w", 200, 5, null, true), set("z", 200, 0), set("n", 0, 5)], bests).size).toBe(0);
  });

  it("says nothing without prior bests, and nothing of a kind with no prior best", () => {
    expect(detectPrs([set("a", 300, 1, 10)], null).size).toBe(0);
    // Never logged with an RPE: no e1RM to beat, but the weight still counts.
    expect(detectPrs([set("a", 160, 1, 10)], { e1rmKg: null, heaviestKg: 150 })).toEqual(new Map([["a", ["weight"]]]));
  });

  describe("rep records: most reps at this load or heavier", () => {
    const withReps = {
      e1rmKg: null,
      heaviestKg: 150,
      repsAt: [
        { loadKg: 150, reps: 2 },
        { loadKg: 142.5, reps: 5 },
        { loadKg: 120, reps: 10 },
      ],
    };

    it("badges more reps than ever at that load", () => {
      expect(detectPrs([set("a", 142.5, 6)], withReps)).toEqual(new Map([["a", ["reps"]]]));
    });

    it("counts a heavier set's reps as done at the lighter load", () => {
      // 140 x 5 was never done, but 142.5 x 5 was: a five at 140 is no record, a six is.
      expect(detectPrs([set("a", 140, 5)], withReps).size).toBe(0);
      expect(detectPrs([set("b", 140, 6)], withReps)).toEqual(new Map([["b", ["reps"]]]));
      // Ten at 120 covers everything down to the bar.
      expect(detectPrs([set("c", 100, 10)], withReps).size).toBe(0);
    });

    it("does not badge a tie", () => {
      expect(detectPrs([set("a", 142.5, 5)], withReps).size).toBe(0);
    });

    it("leaves a load heavier than ever to the weight record", () => {
      expect(detectPrs([set("a", 152.5, 3)], withReps)).toEqual(new Map([["a", ["weight"]]]));
    });

    it("measures each set against the sets before it today", () => {
      const found = detectPrs([set("a", 142.5, 6), set("b", 142.5, 7), set("c", 142.5, 7), set("d", 140, 7)], withReps);
      expect([...found.keys()]).toEqual(["a", "b"]);
    });

    it("lets today's heavier record set the bar for the reps that follow", () => {
      // 155 x 1 is a weight record; then 155 x 2 beats it on reps.
      const found = detectPrs([set("a", 155, 1), set("b", 155, 2)], withReps);
      expect(found).toEqual(
        new Map([
          ["a", ["weight"]],
          ["b", ["reps"]],
        ]),
      );
    });

    it("sits beside the other kinds on one set", () => {
      // 142.5 x 6 @ 9: 7 to failure, an estimate over 160.
      expect(detectPrs([set("a", 142.5, 6, 9)], { ...withReps, e1rmKg: 160 })).toEqual(
        new Map([["a", ["e1rm", "reps"]]]),
      );
    });

    it("never counts a warm-up", () => {
      expect(detectPrs([set("w", 142.5, 8, null, true)], withReps).size).toBe(0);
    });

    it("badges no rep record when the frontier is not known", () => {
      expect(detectPrs([set("a", 142.5, 9)], { ...withReps, repsAt: null }).size).toBe(0);
      expect(detectPrs([set("a", 142.5, 9)], { e1rmKg: null, heaviestKg: 150 }).size).toBe(0);
    });

    it("compares loads at a tenth of a kilo", () => {
      const prior = { e1rmKg: null, heaviestKg: 200, repsAt: [{ loadKg: lbToKg(315), reps: 3 }] };
      expect(detectPrs([set("a", loadFromInput(315, "lb"), 4)], prior)).toEqual(new Map([["a", ["reps"]]]));
      expect(detectPrs([set("a", loadFromInput(315, "lb"), 3)], prior).size).toBe(0);
    });
  });

  describe("units and rounding", () => {
    it("does not call 315 lb typed again a record by float noise", () => {
      const stored = loadFromInput(315, "lb");
      // As Appwrite might hand a float back.
      const prior = { e1rmKg: null, heaviestKg: lbToKg(315) };
      expect(detectPrs([set("a", stored, 1)], prior).size).toBe(0);
    });

    it("calls 316 lb over 315 lb a record", () => {
      const prior = { e1rmKg: null, heaviestKg: loadFromInput(315, "lb") };
      expect(detectPrs([set("a", loadFromInput(316, "lb"), 1)], prior).size).toBe(1);
    });

    it("compares at a tenth of a kilo", () => {
      expect(detectPrs([set("a", 150.04, 1)], bests).size).toBe(0);
      expect(detectPrs([set("a", 150.1, 1)], bests).size).toBe(1);
    });

    it("rounds the e1RM the same way it is stored", () => {
      // 155 x 3 @ 9 = 155 * 36 / 33 = 169.09..., stored 169.1: not over 169.1.
      expect(detectPrs([set("a", 155, 3, 9)], { e1rmKg: 169.1, heaviestKg: 200 }).size).toBe(0);
    });
  });
});

describe("sessionPrs", () => {
  it("lists one line per exercise per kind, the one standing at the end", () => {
    const sets = [
      { ...set("a", 152.5, 1), exerciseId: "squat" },
      { ...set("b", 105, 3, 9), exerciseId: "bench" },
      { ...set("c", 160, 3, 9), exerciseId: "squat" },
    ];
    const found = new Map([
      ["a", ["weight" as const]],
      ["b", ["weight" as const]],
      ["c", ["e1rm" as const, "weight" as const]],
    ]);
    expect(sessionPrs(sets, found).map((pr) => [pr.exerciseId, pr.kind, pr.clientSetId])).toEqual([
      ["squat", "e1rm", "c"],
      ["squat", "weight", "c"],
      ["bench", "weight", "b"],
    ]);
    expect(sessionPrs(sets, found)[0].e1rmKg).toBe(174.5);
  });

  it("lists rep records per load, folding one into a later record that covers it", () => {
    const sets = [
      { ...set("a", 140, 6), exerciseId: "squat" },
      { ...set("b", 140, 7), exerciseId: "squat" },
      { ...set("c", 120, 11), exerciseId: "squat" },
      { ...set("d", 100, 8), exerciseId: "bench" },
      { ...set("e", 160, 1), exerciseId: "squat" },
    ];
    const found = new Map([
      ["a", ["reps" as const]],
      ["b", ["reps" as const]],
      ["c", ["reps" as const]],
      ["d", ["reps" as const]],
      ["e", ["weight" as const]],
    ]);
    expect(sessionPrs(sets, found).map((pr) => [pr.exerciseId, pr.kind, pr.clientSetId])).toEqual([
      ["squat", "weight", "e"],
      ["squat", "reps", "b"],
      ["squat", "reps", "c"],
      ["bench", "reps", "d"],
    ]);
  });

  it("folds a rep record into a heavier one with as many reps", () => {
    const sets = [
      { ...set("a", 140, 6), exerciseId: "squat" },
      { ...set("b", 142.5, 6), exerciseId: "squat" },
    ];
    const found = new Map([
      ["a", ["reps" as const]],
      ["b", ["reps" as const]],
    ]);
    expect(sessionPrs(sets, found).map((pr) => pr.clientSetId)).toEqual(["b"]);
  });

  it("is empty with nothing broken", () => {
    expect(sessionPrs([{ ...set("a", 100, 5), exerciseId: "squat" }], new Map())).toEqual([]);
  });
});

describe("failed sets (F19)", () => {
  it("are never a prior best: not the heaviest, not an e1RM, not on the rep frontier", () => {
    const before = [
      raw("2026-10-20T18:00:00Z", { loadKg: 140, reps: 5, rpe: 8 }),
      raw("2026-10-20T18:10:00Z", { loadKg: 160, reps: 0, rpe: 10, failed: true }),
      raw("2026-10-20T18:20:00Z", { loadKg: 120, reps: 4, rpe: 10, failed: true, e1rmKg: 999 }),
    ];
    const bests = priorBests([], before, sessionStart);
    expect(bests?.heaviestKg).toBe(140);
    // 140 x 5 @ 8 by Brzycki (140 x 36 / 30); the 999 on the failed set is ignored.
    expect(bests?.e1rmKg).toBe(168);
    expect(repBests(before, sessionStart)).toEqual([{ loadKg: 140, reps: 5 }]);
  });

  it("leave no prior bests at all when they are all an athlete has done", () => {
    expect(priorBests([], [raw("2026-10-20T18:00:00Z", { loadKg: 160, reps: 1, failed: true })], sessionStart)).toBeNull();
  });

  it("badge nothing today, and do not raise the bar a later made set has to clear", () => {
    const bests = { e1rmKg: 160, heaviestKg: 150, repsAt: [{ loadKg: 140, reps: 5 }] };
    const sets: SessionSetForPr[] = [
      // Would be a weight record and a rep record, were it made.
      { ...set("f1", 155, 6, 10), failed: true },
      // So this is still a weight record over 150, and a rep record at 140.
      set("ok", 152.5, 1, 8),
      set("reps", 140, 6, 9),
    ];
    const found = detectPrs(sets, bests);
    expect(found.has("f1")).toBe(false);
    expect(found.get("ok")).toContain("weight");
    expect(found.get("reps")).toContain("reps");
  });
});
