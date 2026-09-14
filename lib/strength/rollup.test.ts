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

  it("takes the heaviest working set, and the most reps at that weight", () => {
    // 140x5 is a better week than 140x3. A rollup that called them the same
    // would flatten exactly the progress the chart exists to show.
    const rollup = rollupFrom([
      set({ loadKg: 140, reps: 3 }),
      set({ loadKg: 140, reps: 5 }),
      set({ loadKg: 120, reps: 8 }),
    ]);
    expect(rollup.bestSingleKg).toBe(140);
    expect(rollup.bestSingleReps).toBe(5);
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
});
