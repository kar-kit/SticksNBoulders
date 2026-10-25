import { describe, expect, it } from "vitest";
import {
  rollupFrom,
  rollupKey,
  rollupMatches,
  weekStart,
  WEEK_TIME_ZONE,
  type RollupSet,
} from "./rollup";

const set = (over: Partial<RollupSet> = {}): RollupSet => ({
  loadKg: 100,
  reps: 5,
  isWarmup: false,
  e1rmKg: 120,
  loggedAt: new Date("2026-09-14T10:00:00Z"),
  ...over,
});

describe("weekStart", () => {
  const week = (iso: string) => weekStart(new Date(iso)).toISOString().slice(0, 10);

  it("is the Monday of that week, at midnight UTC", () => {
    // 14 Sep 2026 is a Monday.
    expect(weekStart(new Date("2026-09-14T09:30:00Z")).toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(week("2026-09-17T23:59:00Z")).toBe("2026-09-14");
  });

  it("puts Sunday at the end of its week, not the start of the next one", () => {
    // The off-by-one that would split a Sunday session away from the week it
    // belongs to. getUTCDay is 0 for Sunday, which is the trap.
    expect(week("2026-09-20T18:00:00Z")).toBe("2026-09-14");
    expect(week("2026-09-21T08:00:00Z")).toBe("2026-09-21");
  });

  it("keeps an early Monday session in the UK in the week it started", () => {
    // The bug UTC alone has. 23:30Z on Sunday is 00:30 Monday in London under
    // BST, and a UTC-only rule files a Monday-morning session into the week
    // that just ended -- one hour every Monday, for most of the year.
    expect(week("2026-09-13T23:30:00Z")).toBe("2026-09-14");
    // And the half hour before it really is still Sunday.
    expect(week("2026-09-13T22:30:00Z")).toBe("2026-09-07");
  });

  it("does the same thing in winter, when London is UTC", () => {
    // 14 Dec 2026 is a Monday and GMT is UTC, so the two rules agree here.
    expect(week("2026-12-14T00:30:00Z")).toBe("2026-12-14");
    expect(week("2026-12-13T23:30:00Z")).toBe("2026-12-07");
  });

  it("survives an environment that cannot resolve the timezone", () => {
    // Off by at most an hour beats losing the set. A thrown error here would
    // take out the write path for every set in the product.
    expect(weekStart(new Date("2026-09-17T10:00:00Z"), "Not/AZone").toISOString()).toBe(
      "2026-09-14T00:00:00.000Z",
    );
  });

  it("is the UK, because that is where the gym is", () => {
    expect(WEEK_TIME_ZONE).toBe("Europe/London");
  });

  it("keys a set by athlete, exercise and week", () => {
    expect(rollupKey("joey", "squat", new Date("2026-09-17T10:00:00Z"))).toBe(
      "joey/squat/2026-09-14T00:00:00.000Z",
    );
  });
});

describe("rollupFrom", () => {
  it("counts working sets, reps and tonnage", () => {
    const rollup = rollupFrom([set({ loadKg: 140, reps: 5 }), set({ loadKg: 150, reps: 3 })]);
    expect(rollup.setCount).toBe(2);
    expect(rollup.volumeReps).toBe(8);
    expect(rollup.tonnageKg).toBe(1150);
  });

  it("excludes warm-ups from everything", () => {
    // The same rule the session summary applies, so the week's numbers and the
    // session's numbers agree rather than quietly differing by a warm-up.
    const rollup = rollupFrom([
      set({ loadKg: 60, reps: 5, isWarmup: true, e1rmKg: 999 }),
      set({ loadKg: 140, reps: 5 }),
    ]);
    expect(rollup.setCount).toBe(1);
    expect(rollup.tonnageKg).toBe(700);
    expect(rollup.bestE1rmKg).toBe(120);
    expect(rollup.bestSingleKg).toBe(140);
  });

  it("takes the best e1RM of the week, ignoring sets that have none", () => {
    const rollup = rollupFrom([
      set({ e1rmKg: 150 }),
      set({ e1rmKg: null }),
      set({ e1rmKg: 162.5 }),
      set({ e1rmKg: 140 }),
    ]);
    expect(rollup.bestE1rmKg).toBe(162.5);
  });

  it("reports no best e1RM when no set earned one", () => {
    expect(rollupFrom([set({ e1rmKg: null })]).bestE1rmKg).toBeNull();
  });

  it("takes the most reps in one set, and on a tie the heavier one", () => {
    // A rep record that ignored the weight would reward the lightest set of
    // the week: 100x12 is a record, 60x12 on the same day is not.
    const rollup = rollupFrom([
      set({ loadKg: 60, reps: 12 }),
      set({ loadKg: 100, reps: 12 }),
      set({ loadKg: 140, reps: 5 }),
    ]);
    expect(rollup.bestReps).toBe(12);
    expect(rollup.bestRepsLoadKg).toBe(100);
  });

  it("does not count a warm-up as a rep record", () => {
    const rollup = rollupFrom([set({ loadKg: 40, reps: 20, isWarmup: true }), set({ reps: 5 })]);
    expect(rollup.bestReps).toBe(5);
  });

  it("on a heaviest-set tie, the most recently logged set wins, whatever the input order", () => {
    // Joey, 11 Oct 2026. 140x3 logged after 140x5 is the week as it ended.
    const early = set({ loadKg: 140, reps: 5, loggedAt: new Date("2026-09-14T10:00:00Z") });
    const late = set({ loadKg: 140, reps: 3, loggedAt: new Date("2026-09-16T10:00:00Z") });
    const other = set({ loadKg: 120, reps: 8, loggedAt: new Date("2026-09-17T10:00:00Z") });
    for (const sets of [[early, late, other], [late, early, other], [other, late, early]]) {
      const rollup = rollupFrom(sets);
      expect(rollup.bestSingleKg).toBe(140);
      expect(rollup.bestSingleReps).toBe(3);
    }
  });

  it("a heavier set still beats a later, lighter one; no tie, no change", () => {
    const rollup = rollupFrom([
      set({ loadKg: 150, reps: 1, loggedAt: new Date("2026-09-14T10:00:00Z") }),
      set({ loadKg: 140, reps: 5, loggedAt: new Date("2026-09-16T10:00:00Z") }),
    ]);
    expect(rollup.bestSingleKg).toBe(150);
    expect(rollup.bestSingleReps).toBe(1);
  });

  it("counts a working single like any other set", () => {
    // A peaking week is mostly singles. Dropping them would lose the week's
    // heaviest set, its best e1RM and a share of its tonnage all at once.
    const rollup = rollupFrom([
      set({ loadKg: 200, reps: 1, e1rmKg: 200 }),
      set({ loadKg: 150, reps: 5, e1rmKg: 175 }),
    ]);
    expect(rollup).toEqual({
      setCount: 2,
      volumeReps: 6,
      tonnageKg: 950,
      bestE1rmKg: 200,
      bestSingleKg: 200,
      bestSingleReps: 1,
      bestReps: 5,
      bestRepsLoadKg: 150,
    });
  });

  it("reports a week of only singles in full", () => {
    const rollup = rollupFrom([
      set({ loadKg: 180, reps: 1, e1rmKg: 190 }),
      set({ loadKg: 190, reps: 1, e1rmKg: 195 }),
      set({ loadKg: 185, reps: 1, e1rmKg: 192.5 }),
    ]);
    expect(rollup).toEqual({
      setCount: 3,
      volumeReps: 3,
      tonnageKg: 555,
      bestE1rmKg: 195,
      bestSingleKg: 190,
      bestSingleReps: 1,
      bestReps: 1,
      // Every set is one rep, so the rep record is the heaviest of them.
      bestRepsLoadKg: 190,
    });
  });

  it("handles doubles, and a single and a double at the same weight", () => {
    // Tied on 190: the later set (the double) is the one reported.
    const rollup = rollupFrom([
      set({ loadKg: 190, reps: 1, e1rmKg: 195, loggedAt: new Date("2026-09-14T10:00:00Z") }),
      set({ loadKg: 190, reps: 2, e1rmKg: 200, loggedAt: new Date("2026-09-15T10:00:00Z") }),
      set({ loadKg: 170, reps: 2, e1rmKg: 180 }),
    ]);
    expect(rollup).toMatchObject({
      setCount: 3,
      volumeReps: 5,
      tonnageKg: 910,
      bestE1rmKg: 200,
      bestSingleKg: 190,
      bestSingleReps: 2,
      bestReps: 2,
      bestRepsLoadKg: 190,
    });
  });

  it("totals a mixed week of singles, doubles, triples and fives in any order", () => {
    const sets = [
      set({ loadKg: 60, reps: 5, isWarmup: true, e1rmKg: null }),
      set({ loadKg: 205, reps: 1, e1rmKg: 210 }),
      set({ loadKg: 190, reps: 2, e1rmKg: 205 }),
      set({ loadKg: 175, reps: 3, e1rmKg: 195 }),
      set({ loadKg: 150, reps: 5, e1rmKg: 175 }),
    ];
    const expected = {
      setCount: 4,
      volumeReps: 11,
      // 205 + 380 + 525 + 750
      tonnageKg: 1860,
      bestE1rmKg: 210,
      bestSingleKg: 205,
      bestSingleReps: 1,
      bestReps: 5,
      bestRepsLoadKg: 150,
    };
    expect(rollupFrom(sets)).toEqual(expected);
    expect(rollupFrom([...sets].reverse())).toEqual(expected);
  });

  it("is empty rather than wrong for a week with only warm-ups", () => {
    const rollup = rollupFrom([set({ isWarmup: true })]);
    expect(rollup).toEqual({
      setCount: 0,
      volumeReps: 0,
      tonnageKg: 0,
      bestE1rmKg: null,
      bestSingleKg: null,
      bestSingleReps: null,
      bestReps: null,
      bestRepsLoadKg: null,
    });
  });

  it("does not accumulate float noise into the tonnage", () => {
    // 102.5 x 3 done seven times is the kind of arithmetic that ends up as
    // 2152.4999999999995 and then renders as that on a coach's screen.
    const rollup = rollupFrom(Array.from({ length: 7 }, () => set({ loadKg: 102.5, reps: 3 })));
    expect(rollup.tonnageKg).toBe(2152.5);
  });

  it("is the same answer however many times it is computed", () => {
    // The property the whole design rests on: recomputing a bucket is safe, so
    // a retried queue, an undo and the rebuild script all converge.
    const sets = [set({ loadKg: 140, reps: 5 }), set({ loadKg: 60, isWarmup: true })];
    expect(rollupFrom(sets)).toEqual(rollupFrom([...sets]));
    expect(rollupFrom(sets)).toEqual(rollupFrom([...sets].reverse()));
  });
});

describe("rollupMatches", () => {
  const computed = rollupFrom([set({ loadKg: 140, reps: 5 })]);

  it("spots a stored rollup that already agrees", () => {
    expect(rollupMatches({ ...computed }, computed)).toBe(true);
  });

  it("treats a missing optional as the null it means", () => {
    // Appwrite leaves an unset float undefined rather than null, and a rebuild
    // that rewrote every row on that difference would never settle.
    const empty = rollupFrom([]);
    expect(rollupMatches({ setCount: 0, volumeReps: 0, tonnageKg: 0 }, empty)).toBe(true);
  });

  it("spots one that has drifted", () => {
    expect(rollupMatches({ ...computed, tonnageKg: 699 }, computed)).toBe(false);
    expect(rollupMatches({ ...computed, bestE1rmKg: null }, computed)).toBe(false);
  });

  /**
   * Every stored field, one at a time. A field the comparison skipped would be
   * one the rebuild script reports "already correct" while it is wrong, so its
   * drift would never be repaired.
   */
  const fields = [
    "setCount",
    "volumeReps",
    "tonnageKg",
    "bestE1rmKg",
    "bestSingleKg",
    "bestSingleReps",
    "bestReps",
    "bestRepsLoadKg",
  ] as const satisfies ReadonlyArray<keyof typeof computed>;

  it("covers every field of a rollup", () => {
    expect([...fields].sort()).toEqual(Object.keys(computed).sort());
  });

  it.each(fields)("spots drift in %s alone", (field) => {
    const before = computed[field];
    expect(before).not.toBeNull();
    expect(rollupMatches({ ...computed, [field]: (before as number) + 1 }, computed)).toBe(false);
  });
});

describe("a failed set (F19)", () => {
  it("counts toward set count, volume and tonnage with the reps completed", () => {
    const r = rollupFrom([set({ loadKg: 100, reps: 5 }), set({ loadKg: 120, reps: 2, failed: true, e1rmKg: null })]);
    expect(r.setCount).toBe(2);
    expect(r.volumeReps).toBe(7);
    expect(r.tonnageKg).toBe(740);
  });

  it("is never the heaviest set, the most reps or the best e1RM", () => {
    const r = rollupFrom([
      set({ loadKg: 140, reps: 3, e1rmKg: 150 }),
      // Heavier than anything made, and more reps than anything made.
      set({ loadKg: 160, reps: 0, failed: true, e1rmKg: null }),
      set({ loadKg: 100, reps: 9, failed: true, e1rmKg: null }),
    ]);
    expect(r).toMatchObject({
      bestSingleKg: 140,
      bestSingleReps: 3,
      bestReps: 3,
      bestRepsLoadKg: 140,
      bestE1rmKg: 150,
    });
  });

  it("leaves a week of only failed sets counted but with no bests", () => {
    const r = rollupFrom([set({ loadKg: 200, reps: 0, failed: true, e1rmKg: null })]);
    expect(r).toEqual({
      setCount: 1,
      volumeReps: 0,
      tonnageKg: 0,
      bestE1rmKg: null,
      bestSingleKg: null,
      bestSingleReps: null,
      bestReps: null,
      bestRepsLoadKg: null,
    });
  });
});
