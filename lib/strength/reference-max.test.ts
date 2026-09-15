import { describe, expect, it } from "vitest";
import {
  STORED_KINDS,
  buildMaxRows,
  currentMax,
  formatMaxKg,
  kindLabel,
  maxDateLabel,
  preferredMax,
  resolveMaxes,
  type ReferenceMaxEntry,
} from "./reference-max";

const SQUAT = "ex-squat";

function entry(over: Partial<ReferenceMaxEntry> & { id: string }): ReferenceMaxEntry {
  return {
    exerciseId: SQUAT,
    kind: "training",
    valueKg: 180,
    effectiveFrom: "2026-08-12T00:00:00.000Z",
    recordedBy: "coach-1",
    ...over,
  };
}

const at = (iso: string) => new Date(iso);

describe("STORED_KINDS", () => {
  /**
   * The guard on the decision, not a restatement of the literal. "Estimated"
   * is the best e1RM in stats_rollups; if it ever becomes writable here there
   * are two implementations of one aggregate and the rollup rebuild script
   * stops being the repair path. Adding a third kind must break this test.
   */
  it("holds exactly the two kinds a human enters", () => {
    expect([...STORED_KINDS]).toEqual(["tested", "training"]);
  });
});

describe("currentMax", () => {
  it("returns nothing when the athlete has never had one set", () => {
    expect(currentMax([], "training", at("2026-09-15T10:00:00.000Z"))).toBeNull();
  });

  it("picks the newest entry that has come into effect", () => {
    const entries = [
      entry({ id: "a", valueKg: 170, effectiveFrom: "2026-07-01T00:00:00.000Z" }),
      entry({ id: "b", valueKg: 180, effectiveFrom: "2026-08-12T00:00:00.000Z" }),
    ];
    expect(currentMax(entries, "training", at("2026-09-15T10:00:00.000Z"))).toMatchObject({
      valueKg: 180,
      entryId: "b",
    });
  });

  it("ignores input order", () => {
    const entries = [
      entry({ id: "b", valueKg: 180, effectiveFrom: "2026-08-12T00:00:00.000Z" }),
      entry({ id: "a", valueKg: 170, effectiveFrom: "2026-07-01T00:00:00.000Z" }),
    ];
    expect(currentMax(entries, "training", at("2026-09-15T10:00:00.000Z"))?.valueKg).toBe(180);
  });

  /**
   * The case the effective date exists for. A coach setting next block's
   * training max on Friday must not change Friday's percentages.
   */
  it("does not let a future-dated entry take effect early", () => {
    const entries = [
      entry({ id: "now", valueKg: 180, effectiveFrom: "2026-08-12T00:00:00.000Z" }),
      entry({ id: "next", valueKg: 190, effectiveFrom: "2026-10-01T00:00:00.000Z" }),
    ];
    expect(currentMax(entries, "training", at("2026-09-15T10:00:00.000Z"))?.valueKg).toBe(180);
    expect(currentMax(entries, "training", at("2026-10-02T10:00:00.000Z"))?.valueKg).toBe(190);
  });

  it("takes effect exactly on its own date, not the day after", () => {
    const entries = [entry({ id: "a", valueKg: 190, effectiveFrom: "2026-10-01T00:00:00.000Z" })];
    expect(currentMax(entries, "training", at("2026-10-01T00:00:00.000Z"))?.valueKg).toBe(190);
  });

  /** A typo correction re-enters the same date, and the correction must win. */
  it("breaks a tie on the later-listed entry, which is the correction", () => {
    const entries = [
      entry({ id: "typo", valueKg: 1800, effectiveFrom: "2026-08-12T00:00:00.000Z" }),
      entry({ id: "fixed", valueKg: 180, effectiveFrom: "2026-08-12T00:00:00.000Z" }),
    ];
    expect(currentMax(entries, "training", at("2026-09-15T10:00:00.000Z"))?.entryId).toBe("fixed");
  });

  it("keeps the kinds apart", () => {
    const entries = [
      entry({ id: "t", kind: "tested", valueKg: 195 }),
      entry({ id: "m", kind: "training", valueKg: 180 }),
    ];
    const asOf = at("2026-09-15T10:00:00.000Z");
    expect(currentMax(entries, "tested", asOf)?.valueKg).toBe(195);
    expect(currentMax(entries, "training", asOf)?.valueKg).toBe(180);
  });

  it("skips an unparseable date rather than sorting it randomly", () => {
    const entries = [
      entry({ id: "good", valueKg: 180 }),
      entry({ id: "bad", valueKg: 999, effectiveFrom: "not a date" }),
    ];
    expect(currentMax(entries, "training", at("2026-09-15T10:00:00.000Z"))?.entryId).toBe("good");
  });
});

describe("resolveMaxes", () => {
  it("combines the two stored kinds with the derived one", () => {
    const entries = [
      entry({ id: "t", kind: "tested", valueKg: 195, effectiveFrom: "2026-08-12T00:00:00.000Z" }),
      entry({ id: "m", kind: "training", valueKg: 180 }),
    ];
    const maxes = resolveMaxes(entries, at("2026-09-15T10:00:00.000Z"), {
      valueKg: 191.5,
      asOf: "2026-09-11T00:00:00.000Z",
    });
    expect(maxes.tested?.valueKg).toBe(195);
    expect(maxes.training?.valueKg).toBe(180);
    expect(maxes.estimated).toMatchObject({ valueKg: 191.5, kind: "estimated" });
    // Nobody entered the estimate, so there is no row to edit.
    expect(maxes.estimated?.entryId).toBeUndefined();
  });

  it("has no estimate for an athlete who has logged nothing", () => {
    expect(resolveMaxes([], at("2026-09-15T10:00:00.000Z"), null).estimated).toBeNull();
  });
});

describe("preferredMax", () => {
  const asOf = at("2026-09-15T10:00:00.000Z");
  const estimate = { valueKg: 191.5, asOf: "2026-09-11T00:00:00.000Z" };

  /** The entire point of a training max is that it outranks the tested one. */
  it("prefers the training max over a higher tested max", () => {
    const entries = [
      entry({ id: "t", kind: "tested", valueKg: 195 }),
      entry({ id: "m", kind: "training", valueKg: 180 }),
    ];
    expect(preferredMax(resolveMaxes(entries, asOf, estimate))?.valueKg).toBe(180);
  });

  it("falls back to tested, then to the estimate", () => {
    const tested = [entry({ id: "t", kind: "tested", valueKg: 195 })];
    expect(preferredMax(resolveMaxes(tested, asOf, estimate))?.valueKg).toBe(195);
    expect(preferredMax(resolveMaxes([], asOf, estimate))?.valueKg).toBe(191.5);
    expect(preferredMax(resolveMaxes([], asOf, null))).toBeNull();
  });
});

describe("labels", () => {
  it("names each kind the way the panel does", () => {
    expect(kindLabel("tested")).toBe("tested");
    expect(kindLabel("estimated")).toBe("e1RM");
    expect(kindLabel("training")).toBe("training max");
  });

  it("keeps halves and drops everything finer", () => {
    expect(formatMaxKg(180)).toBe("180");
    expect(formatMaxKg(182.5)).toBe("182.5");
    expect(formatMaxKg(191.4732)).toBe("191.5");
    expect(formatMaxKg(180.2)).toBe("180");
  });
});

describe("maxDateLabel", () => {
  it("dates a row the way the blueprint does", () => {
    expect(maxDateLabel("2026-08-12T00:00:00.000Z")).toBe("12 Aug");
  });

  it("says nothing rather than 'Invalid Date' for a broken date", () => {
    expect(maxDateLabel("nonsense")).toBe("");
  });
});

describe("buildMaxRows", () => {
  const asOf = at("2026-09-15T10:00:00.000Z");
  const BENCH = "ex-bench";

  const library = [
    { exerciseId: SQUAT, exerciseName: "Squat" },
    { exerciseId: BENCH, exerciseName: "Bench Press" },
  ];

  it("drops exercises with no max at all", () => {
    const entries = [entry({ id: "m", kind: "training", valueKg: 180 })];
    const rows = buildMaxRows(entries, library, asOf);
    expect(rows.map((r) => r.exerciseName)).toEqual(["Squat"]);
  });

  it("is empty for an athlete who has never trained", () => {
    expect(buildMaxRows([], library, asOf)).toEqual([]);
  });

  /**
   * The blueprint's panel reads Squat, Bench, Deadlift -- competition order,
   * which is the order the seeded library is in. Sorting by weight would put
   * most lifters' deadlift first and diverge from the spec, so the rows come
   * out in library order even when that is not descending by weight.
   */
  it("keeps library order rather than sorting by weight", () => {
    const entries = [
      entry({ id: "s", exerciseId: SQUAT, kind: "training", valueKg: 142 }),
      entry({ id: "b", exerciseId: BENCH, kind: "training", valueKg: 180 }),
    ];
    expect(buildMaxRows(entries, library, asOf).map((r) => r.exerciseName)).toEqual([
      "Squat",
      "Bench Press",
    ]);
  });

  it("falls back to the estimate for a lift with no entered max", () => {
    const entries = [entry({ id: "s", exerciseId: SQUAT, kind: "tested", valueKg: 180 })];
    const rows = buildMaxRows(
      entries,
      [library[0], { ...library[1], estimated: { valueKg: 142, asOf: "2026-09-11T00:00:00.000Z" } }],
      asOf,
    );
    expect(rows).toEqual([
      expect.objectContaining({ exerciseName: "Squat", max: expect.objectContaining({ kind: "tested" }) }),
      expect.objectContaining({ exerciseName: "Bench Press", max: expect.objectContaining({ kind: "estimated" }) }),
    ]);
  });

  /** Entries for other athletes' lifts must never leak into a row. */
  it("only uses entries belonging to the exercise", () => {
    const entries = [entry({ id: "other", exerciseId: "ex-unrelated", valueKg: 999 })];
    expect(buildMaxRows(entries, library, asOf)).toEqual([]);
  });
});
