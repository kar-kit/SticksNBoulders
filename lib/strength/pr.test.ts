import { detectPrs, priorBests, sessionPrs, type PriorSet, type SessionSetForPr } from "./pr";
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

  it("is empty with nothing broken", () => {
    expect(sessionPrs([{ ...set("a", 100, 5), exerciseId: "squat" }], new Map())).toEqual([]);
  });
});
