import { describe, expect, it } from "vitest";
import type { Exercise } from "@/lib/exercises/match";
import type { BodyweightEntry } from "@/lib/bodyweight/bodyweight";
import type { Sex } from "@/lib/profile/profile";
import {
  bestCompetitionLifts,
  dotsFor,
  dotsScore,
  formatDots,
  formatTotalBreakdown,
  COMPETITION_LIFTS,
} from "./dots";
import type { EstimatedInput, ReferenceMaxEntry } from "./reference-max";

/**
 * The coefficients are the reason this file exists.
 *
 * A wrong digit produces a number that looks entirely reasonable -- a DOTS of
 * 341 and a DOTS of 374 are both plausible for the same lifter -- so nothing
 * here may check the implementation against a restatement of itself. The
 * previous product's test did exactly that: it recomputed the same polynomial
 * inline and asserted the two agreed, which passes for any coefficients at all.
 *
 * So these are real lifters, at documented bodyweights and totals, whose DOTS
 * scores OpenPowerlifting publishes. If a coefficient were wrong, every one of
 * them would miss by percent.
 */

interface Reference {
  who: string;
  sex: Sex;
  /** Bodyweight exactly as openpowerlifting.org prints it, to 1dp. */
  bodyweightKg: number;
  totalKg: number;
  /** The Dots column on that row. */
  published: number;
}

/**
 * Sources, all retrieved 16 Sep 2026:
 *   https://www.openpowerlifting.org/u/jesusolivares
 *   https://www.openpowerlifting.org/u/agatasitko
 *   https://www.openpowerlifting.org/u/jessicabuettner
 *
 * Kilogram federations only (IPF, USAPL). The pound-based high-school meets on
 * the same pages carry converted totals whose hidden precision is its own
 * source of disagreement, and a reference point has to be unambiguous.
 */
const REFERENCES: readonly Reference[] = [
  { who: "Jesus Olivares, IPF Worlds 2023", sex: "male", bodyweightKg: 178.2, totalKg: 1152.5, published: 592.59 },
  { who: "Jesus Olivares, USAPL 2020", sex: "male", bodyweightKg: 157.8, totalKg: 1055.5, published: 560.02 },
  { who: "Jesus Olivares, IPF 2021", sex: "male", bodyweightKg: 167.0, totalKg: 1045.0, published: 546.3 },
  { who: "Agata Sitko, IPF Sheffield 2022", sex: "female", bodyweightKg: 76.0, totalKg: 726.0, published: 702.21 },
  { who: "Agata Sitko, IPF Worlds 2025", sex: "female", bodyweightKg: 63.4, totalKg: 612.5, published: 655.79 },
  { who: "Jessica Buettner, IPF Worlds 2026", sex: "female", bodyweightKg: 83.0, totalKg: 577.5, published: 534.44 },
  { who: "Jessica Buettner, IPF Worlds 2019", sex: "female", bodyweightKg: 71.5, totalKg: 532.5, published: 532.19 },
];

/**
 * Published DOTS is not reproducible to the last decimal from a published
 * bodyweight, and pretending otherwise would mean loosening the tolerance
 * until the test stopped meaning anything.
 *
 * The site stores bodyweight to two decimals and prints it to one, so a row
 * reading 63.4 was lifted at some weight in [63.4, 63.5). Heavier means a
 * lower score, so the true score lies between the score at the printed weight
 * and the score a tenth above it. Every reference point below was checked to
 * fall in that band -- across 98 rows on these three lifters, 96 did, and the
 * two that did not were pound-converted totals and are excluded above.
 *
 * The band is a few hundredths wide. A transposed digit in any coefficient
 * misses it by whole points.
 */
const DISPLAY_EPSILON = 0.006;

describe("DOTS against published scores", () => {
  for (const ref of REFERENCES) {
    it(`matches ${ref.who}`, () => {
      const atPrinted = dotsScore(ref.sex, ref.bodyweightKg, ref.totalKg);
      const atTenthHeavier = dotsScore(ref.sex, ref.bodyweightKg + 0.1, ref.totalKg);

      expect(ref.published).toBeLessThanOrEqual(atPrinted + DISPLAY_EPSILON);
      expect(ref.published).toBeGreaterThanOrEqual(atTenthHeavier - DISPLAY_EPSILON);
    });
  }

  it("covers both coefficient sets", () => {
    // Guards the table itself: a female-only list would leave the women's
    // coefficients completely unverified while every test still passed.
    expect(REFERENCES.some((r) => r.sex === "male")).toBe(true);
    expect(REFERENCES.some((r) => r.sex === "female")).toBe(true);
  });

  it("puts the men's and women's curves in the documented order", () => {
    // Same total, same bodyweight: the women's formula scores higher. Catches
    // the two coefficient sets being swapped, which no single-sex reference
    // point can see.
    expect(dotsScore("female", 75, 500)).toBeGreaterThan(dotsScore("male", 75, 500));
  });
});

describe("the shape of the curve", () => {
  it("scales linearly with the total", () => {
    expect(dotsScore("male", 82.4, 600)).toBeCloseTo(dotsScore("male", 82.4, 300) * 2, 9);
  });

  it("scores the lighter lifter higher on the same total", () => {
    expect(dotsScore("male", 70, 500)).toBeGreaterThan(dotsScore("male", 100, 500));
    expect(dotsScore("female", 55, 400)).toBeGreaterThan(dotsScore("female", 80, 400));
  });

  it("clamps below the fitted range rather than inverting", () => {
    // The quartic is only fitted from 40kg. Below it the polynomial heads for
    // its negative constant term, so an unclamped 20kg input would return a
    // negative score -- a child's account, or a weight typed in pounds.
    expect(dotsScore("male", 20, 300)).toBe(dotsScore("male", 40, 300));
    expect(dotsScore("female", 20, 300)).toBe(dotsScore("female", 40, 300));
    expect(dotsScore("male", 20, 300)).toBeGreaterThan(0);
  });

  it("clamps above each sex's own ceiling", () => {
    // Different ceilings, and they must not be shared: 210 for men, 150 for
    // women. A single shared bound would silently rescore every woman over
    // 150kg.
    expect(dotsScore("male", 260, 800)).toBe(dotsScore("male", 210, 800));
    expect(dotsScore("female", 200, 500)).toBe(dotsScore("female", 150, 500));
    expect(dotsScore("female", 160, 500)).not.toBe(dotsScore("female", 140, 500));
  });

  it("returns zero for a zero bodyweight or total, never a negative", () => {
    // The previous product returned a negative number at 0kg, because the
    // polynomial evaluates to its negative constant term there.
    expect(dotsScore("male", 0, 500)).toBe(0);
    expect(dotsScore("female", 0, 500)).toBe(0);
    expect(dotsScore("male", 82, 0)).toBe(0);
    expect(dotsScore("male", -5, 500)).toBe(0);
    expect(dotsScore("male", Number.NaN, 500)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Composition: which numbers make the total, and what happens when one is gone
// ---------------------------------------------------------------------------

const LIBRARY: Exercise[] = [
  { id: "sq", name: "Squat", normalisedName: "squat", isGlobal: true },
  { id: "bn", name: "Bench Press", normalisedName: "bench press", isGlobal: true },
  { id: "dl", name: "Deadlift", normalisedName: "deadlift", isGlobal: true },
  { id: "fsq", name: "Front Squat", normalisedName: "front squat", isGlobal: true },
  { id: "psq", name: "Pause Squat", normalisedName: "pause squat", isGlobal: true },
  { id: "sumo", name: "Sumo Deadlift", normalisedName: "sumo deadlift", isGlobal: true },
  { id: "cgbp", name: "Close Grip Bench Press", normalisedName: "close grip bench press", isGlobal: true },
  { id: "mine", name: "Squat", normalisedName: "squat", isGlobal: false, ownerId: "joey" },
];

const max = (
  exerciseId: string,
  kind: "tested" | "training",
  valueKg: number,
  effectiveFrom = "2026-09-01T00:00:00.000Z",
): ReferenceMaxEntry => ({
  id: `${exerciseId}-${kind}-${valueKg}`,
  exerciseId,
  kind,
  valueKg,
  effectiveFrom,
  recordedBy: "coach",
});

const weighIn = (measuredOn: string, weightKg: number): BodyweightEntry => ({
  id: `bw-${measuredOn}`,
  athleteId: "joey",
  weightKg,
  measuredOn,
  recordedAt: `${measuredOn}T07:00:00.000Z`,
});

const estimates = (pairs: Record<string, number>): Map<string, EstimatedInput> =>
  new Map(
    Object.entries(pairs).map(([id, valueKg]) => [id, { valueKg, asOf: "2026-09-07T00:00:00.000Z" }]),
  );

const ASOF = new Date("2026-09-16T10:00:00.000Z");

describe("picking the three competition lifts", () => {
  it("matches only the competition lift, never a variation of it", () => {
    // A substring match on "squat" would pick up Front Squat and Pause Squat
    // and total a lifter's three squats.
    const { found, missing } = bestCompetitionLifts({
      entries: [max("sq", "tested", 200), max("bn", "tested", 140), max("dl", "tested", 240)],
      estimated: estimates({ fsq: 300, psq: 300, sumo: 300, cgbp: 300 }),
      exercises: LIBRARY,
      asOf: ASOF,
    });

    expect(missing).toEqual([]);
    expect(found.map((f) => f.exerciseId)).toEqual(["sq", "bn", "dl"]);
    expect(found.reduce((sum, f) => sum + f.valueKg, 0)).toBe(580);
  });

  it("returns them in competition order whatever order the library is in", () => {
    const { found } = bestCompetitionLifts({
      entries: [max("dl", "tested", 240), max("sq", "tested", 200), max("bn", "tested", 140)],
      estimated: estimates({}),
      exercises: [...LIBRARY].reverse(),
      asOf: ASOF,
    });
    expect(found.map((f) => f.lift)).toEqual([...COMPETITION_LIFTS]);
  });

  it("ignores an athlete's own exercise that shares the name", () => {
    // `mine` is a non-global "Squat". Preferring it would split the lift's
    // history and halve the number.
    const { found } = bestCompetitionLifts({
      entries: [max("sq", "tested", 200), max("bn", "tested", 140), max("dl", "tested", 240)],
      estimated: estimates({ mine: 500 }),
      exercises: LIBRARY,
      asOf: ASOF,
    });
    expect(found.find((f) => f.lift === "squat")?.valueKg).toBe(200);
  });

  it("takes the better of the tested max and the rolling e1RM", () => {
    const { found } = bestCompetitionLifts({
      entries: [max("sq", "tested", 200), max("bn", "tested", 140), max("dl", "tested", 240)],
      // Squat estimate beats the tested max; bench estimate does not.
      estimated: estimates({ sq: 212.5, bn: 130 }),
      exercises: LIBRARY,
      asOf: ASOF,
    });
    expect(found.find((f) => f.lift === "squat")).toMatchObject({ valueKg: 212.5, kind: "estimated" });
    expect(found.find((f) => f.lift === "bench press")).toMatchObject({ valueKg: 140, kind: "tested" });
  });

  it("never lets a training max into the total", () => {
    // The decision this whole feature turns on. A coach setting a conservative
    // training max must not lower their athlete's progression number, and a
    // generous one must not raise it.
    const { found } = bestCompetitionLifts({
      entries: [
        max("sq", "tested", 200),
        max("sq", "training", 180),
        max("bn", "tested", 140),
        max("bn", "training", 999),
        max("dl", "tested", 240),
      ],
      estimated: estimates({}),
      exercises: LIBRARY,
      asOf: ASOF,
    });
    expect(found.map((f) => f.valueKg)).toEqual([200, 140, 240]);
  });

  it("ignores a max dated in the future, as the maxes table does", () => {
    const { found, missing } = bestCompetitionLifts({
      entries: [
        max("sq", "tested", 200),
        max("sq", "tested", 250, "2027-01-01T00:00:00.000Z"),
        max("bn", "tested", 140),
        max("dl", "tested", 240),
      ],
      estimated: estimates({}),
      exercises: LIBRARY,
      asOf: ASOF,
    });
    expect(missing).toEqual([]);
    expect(found.find((f) => f.lift === "squat")?.valueKg).toBe(200);
  });

  it("names the lifts that have no number at all", () => {
    const { missing } = bestCompetitionLifts({
      entries: [max("sq", "tested", 200)],
      estimated: estimates({}),
      exercises: LIBRARY,
      asOf: ASOF,
    });
    expect(missing).toEqual(["bench press", "deadlift"]);
  });

  it("reports a lift missing when the library does not carry it", () => {
    const { missing } = bestCompetitionLifts({
      entries: [max("sq", "tested", 200), max("bn", "tested", 140)],
      estimated: estimates({}),
      exercises: LIBRARY.filter((e) => e.id !== "dl"),
      asOf: ASOF,
    });
    expect(missing).toEqual(["deadlift"]);
  });
});

describe("DOTS for an athlete, and the four ways it can be absent", () => {
  const full = {
    entries: [max("sq", "tested", 212.5), max("bn", "tested", 140), max("dl", "tested", 200)],
    estimated: estimates({}),
    exercises: LIBRARY,
    asOf: ASOF,
  };

  it("computes the number when everything is there", () => {
    const result = dotsFor({
      ...full,
      sex: "male",
      bodyweight: [weighIn("2026-09-16", 82.4)],
      today: "2026-09-16",
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.totalKg).toBe(552.5);
    expect(result.bodyweightKg).toBe(82.4);
    expect(result.stale).toBe(false);
    // Checked independently against the published coefficients rather than
    // against this implementation.
    expect(result.score).toBeCloseTo(374.52, 1);
    expect(formatTotalBreakdown(result.lifts)).toBe("212.5 / 140 / 200");
  });

  it("refuses without a sex, because there are two formulas and no default", () => {
    const result = dotsFor({ ...full, sex: null, bodyweight: [weighIn("2026-09-16", 82.4)] });
    expect(result).toEqual({ status: "no-sex" });
  });

  it("refuses without a weigh-in", () => {
    expect(dotsFor({ ...full, sex: "male", bodyweight: [] })).toEqual({ status: "no-bodyweight" });
  });

  it("asks for the profile before the scales when both are missing", () => {
    // Cheapest fix first: sex is one tap on Profile, a weigh-in needs scales.
    expect(dotsFor({ ...full, sex: null, bodyweight: [] })).toEqual({ status: "no-sex" });
  });

  it("still scores a stale bodyweight, but says so", () => {
    // Seven days is where the bodyweight module's rolling average gives up.
    // Hiding DOTS here would empty the coach's panel; showing it unlabelled
    // would present three-week-old weight as this morning's.
    const result = dotsFor({
      ...full,
      sex: "male",
      bodyweight: [weighIn("2026-08-20", 90)],
      today: "2026-09-16",
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.stale).toBe(true);
    expect(result.measuredOn).toBe("2026-08-20");
    expect(result.score).toBeGreaterThan(0);
  });

  it("is not stale on the last day inside the window", () => {
    const fresh = dotsFor({
      ...full,
      sex: "male",
      bodyweight: [weighIn("2026-09-10", 82.4)],
      today: "2026-09-16",
    });
    const stale = dotsFor({
      ...full,
      sex: "male",
      bodyweight: [weighIn("2026-09-09", 82.4)],
      today: "2026-09-16",
    });

    expect(fresh.status === "ready" && fresh.stale).toBe(false);
    expect(stale.status === "ready" && stale.stale).toBe(true);
  });

  it("uses the newest weigh-in, not the first one it is handed", () => {
    const result = dotsFor({
      ...full,
      sex: "male",
      bodyweight: [weighIn("2026-09-10", 90), weighIn("2026-09-16", 82.4)],
      today: "2026-09-16",
    });
    expect(result.status === "ready" && result.bodyweightKg).toBe(82.4);
  });

  it("refuses an incomplete total and names what is missing", () => {
    // Two lifts is not a total. Scoring it anyway would read as a collapse in
    // form rather than as an absent deadlift.
    const result = dotsFor({
      ...full,
      entries: [max("sq", "tested", 212.5), max("bn", "tested", 140)],
      sex: "male",
      bodyweight: [weighIn("2026-09-16", 82.4)],
    });
    expect(result).toEqual({ status: "incomplete-total", missing: ["deadlift"] });
  });

  it("scores a woman on the women's curve", () => {
    const result = dotsFor({
      ...full,
      sex: "female",
      bodyweight: [weighIn("2026-09-16", 63.4)],
      today: "2026-09-16",
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.score).toBeCloseTo(dotsScore("female", 63.4, 552.5), 9);
    expect(result.score).not.toBeCloseTo(dotsScore("male", 63.4, 552.5), 1);
  });
});

describe("formatting", () => {
  it("keeps one decimal, because a block moves DOTS by a point or two", () => {
    expect(formatDots(374.5163)).toBe("374.5");
    expect(formatDots(374)).toBe("374.0");
  });

  it("writes the breakdown in competition order with halves intact", () => {
    const result = dotsFor({
      entries: [max("sq", "tested", 212.5), max("bn", "tested", 137.5), max("dl", "tested", 200)],
      estimated: estimates({}),
      exercises: LIBRARY,
      asOf: ASOF,
      sex: "male",
      bodyweight: [weighIn("2026-09-16", 82.4)],
      today: "2026-09-16",
    });
    expect(result.status === "ready" && formatTotalBreakdown(result.lifts)).toBe("212.5 / 137.5 / 200");
  });
});
