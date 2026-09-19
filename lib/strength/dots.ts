import type { Sex } from "@/lib/profile/profile";
import type { Exercise } from "@/lib/exercises/match";
import {
  AVERAGE_DAYS,
  daysBetween,
  dayKey,
  latestEntry,
  type BodyweightEntry,
} from "@/lib/bodyweight/bodyweight";
import {
  resolveMaxes,
  type EstimatedInput,
  type MaxKind,
  type ReferenceMaxEntry,
} from "./reference-max";

/**
 * DOTS: a total, divided by what a lifter that size is expected to total.
 *
 * A personal progression number and nothing else. The ticket is explicit --
 * "not a leaderboard" -- and CLAUDE.md is explicit that leaderboards, groups
 * and friend competition are the final phase, not to be scaffolded for now. So
 * there is no ranking here, no comparison between athletes, and no data model
 * that would make one cheap to add. One athlete, one number, on two screens.
 *
 * ---
 *
 * THE COEFFICIENTS ARE NOT WRITTEN FROM MEMORY.
 *
 * They are transcribed from OpenPowerlifting's reference implementation, which
 * is the code that computes the DOTS shown on every lifter page on the site:
 *
 *   crates/coefficients/src/dots.rs, OpenPowerlifting (opl-data)
 *   https://gitlab.com/openpowerlifting/opl-data/-/blob/facce0f532698157f9aa0ef29f921cd36d2ea5c4/crates/coefficients/src/dots.rs
 *   blob 0972e0348132e67e24e53737544b57eecb19186d, retrieved 16 Sep 2026
 *   ISC licence, (c) 2020 The OpenPowerlifting Project
 *
 * The formula's author is Tim Konertz, written for the BVDK -- the German IPF
 * affiliate -- so that lifters of any sex could score on one team. There is
 * one published revision; these are it. See docs/dots.md for the reference
 * points this was validated against.
 *
 * Do not "tidy" a digit. Every one of them is load-bearing.
 */

interface Coefficients {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  /** The range the polynomial was fitted over. Outside it, it stops meaning anything. */
  minKg: number;
  maxKg: number;
}

/** Men's set. Fitted 40-210kg. */
const MEN: Coefficients = {
  a: -0.000001093,
  b: 0.0007391293,
  c: -0.1918759221,
  d: 24.0900756,
  e: -307.75076,
  minKg: 40,
  maxKg: 210,
};

/** Women's set. Fitted 40-150kg -- a narrower range, and deliberately so. */
const WOMEN: Coefficients = {
  a: -0.0000010706,
  b: 0.0005158568,
  c: -0.1126655495,
  d: 13.6175032,
  e: -57.96288,
  minKg: 40,
  maxKg: 150,
};

/**
 * Kept as two named constants rather than a record keyed by sex, so that a
 * lookup with a bad key is a type error rather than an undefined that reaches
 * the arithmetic and returns NaN to a screen.
 */
const coefficientsFor = (sex: Sex): Coefficients => (sex === "male" ? MEN : WOMEN);

/**
 * The expected total for a lifter of this bodyweight, as a quartic.
 *
 * Horner's method, which is how the reference implementation evaluates it --
 * fewer operations and no `bw ** 4`, which is where a naive version loses
 * precision at the top of the range.
 *
 * Bodyweight is clamped to the fitted range, exactly as the reference does.
 * This is not defensive tidiness: a quartic with a negative leading term turns
 * over past its fitted range, so an unclamped 250kg lifter would get a score
 * that climbs as they get heavier and a light enough input would cross zero
 * and flip sign. Clamping means a lifter outside the range is scored as if at
 * the boundary, which understates them rather than inverting them.
 */
function expectedTotalKg(sex: Sex, bodyweightKg: number): number {
  const k = coefficientsFor(sex);
  const bw = Math.min(Math.max(bodyweightKg, k.minKg), k.maxKg);
  return ((((k.a * bw + k.b) * bw + k.c) * bw + k.d) * bw) + k.e;
}

/**
 * The DOTS score for a total at a bodyweight.
 *
 * Zero bodyweight or zero total scores zero, matching the reference. The
 * previous product's version returned a negative number here, because at 0kg
 * the polynomial evaluates to its constant term -- which is negative for both
 * sexes. Nothing in this product can reach it now that the clamp exists, but
 * the guard is the reference's and stays.
 */
export function dotsScore(sex: Sex, bodyweightKg: number, totalKg: number): number {
  if (!Number.isFinite(bodyweightKg) || !Number.isFinite(totalKg)) return 0;
  if (bodyweightKg <= 0 || totalKg <= 0) return 0;
  return (500 / expectedTotalKg(sex, bodyweightKg)) * totalKg;
}

/**
 * The three lifts a DOTS total is made of, by normalised name.
 *
 * [Inference] Nobody specified how the app identifies a competition lift, and
 * no field in the schema carries the idea -- `reference-max.ts` says so
 * outright and avoids needing it by using library order. DOTS cannot avoid it:
 * it needs exactly these three and must not accept a fourth.
 *
 * Matched on exact normalised equality, never `includes`. The seeded library
 * holds Front Squat, Pause Squat, Tempo Squat, Box Squat, Safety Bar Squat,
 * Pause Bench Press, Close Grip Bench Press, Incline Bench Press, Sumo
 * Deadlift, Deficit Deadlift, Romanian Deadlift and Stiff Leg Deadlift -- a
 * substring match on "squat" picks up five lifts that are not the competition
 * squat, and seed.ts is explicit that a variation is its own exercise with its
 * own max. A tempo bench total is not a bench total.
 *
 * Global rows only, so an athlete who types their own "Squat" does not shadow
 * the seeded one and split the number in half.
 */
export const COMPETITION_LIFTS = ["squat", "bench press", "deadlift"] as const;
export type CompetitionLift = (typeof COMPETITION_LIFTS)[number];

/** How the three read on screen, in competition order. */
export const LIFT_LABELS: Record<CompetitionLift, string> = {
  squat: "Squat",
  "bench press": "Bench",
  deadlift: "Deadlift",
};

export interface LiftBest {
  lift: CompetitionLift;
  exerciseId: string;
  valueKg: number;
  /** Which number this is, so the screen can say where the total came from. */
  kind: MaxKind;
  asOf: string;
}

export interface LiftMaxInput {
  entries: readonly ReferenceMaxEntry[];
  estimated: ReadonlyMap<string, EstimatedInput>;
  exercises: readonly Exercise[];
  asOf: Date;
}

/**
 * The best number this athlete has on each competition lift.
 *
 * Tested max or best e1RM, whichever is higher -- and explicitly NOT
 * `preferredMax`, which the CURRENT MAXES panel uses.
 *
 * That divergence is the most consequential decision in this file, so the
 * reasoning is written down rather than assumed. `preferredMax` puts the
 * training max first, because a percentage prescription should track what the
 * coach wants percentages taken from. A training max is deliberately
 * submaximal: Ruairi sets it below the tested single on purpose. Feeding it
 * into DOTS would mean a coach starting a conservative block *lowers* their
 * athlete's progression number without the athlete doing anything, which is a
 * number that lies about the thing it claims to measure.
 *
 * So training maxes are ignored, and the other two are taken at their best.
 * Not e1RM alone either: reference-maxes.md says a tested max may be "entered
 * or detected", so a meet total the coach typed in has no set behind it and
 * would vanish from the rollups. Not tested alone either, because most
 * athletes never enter one and their DOTS would never appear.
 *
 * The estimate comes from `stats_rollups`, never from raw sets -- the rule in
 * rollups.md, and `fetchEstimatedMaxes` already takes the maximum across weeks
 * so a deload does not drop the score.
 */
export function bestCompetitionLifts(input: LiftMaxInput): {
  found: LiftBest[];
  missing: CompetitionLift[];
} {
  const found: LiftBest[] = [];
  const missing: CompetitionLift[] = [];

  for (const lift of COMPETITION_LIFTS) {
    const exercise = input.exercises.find((e) => e.isGlobal && e.normalisedName === lift);
    if (!exercise) {
      missing.push(lift);
      continue;
    }

    const maxes = resolveMaxes(
      input.entries.filter((e) => e.exerciseId === exercise.id),
      input.asOf,
      input.estimated.get(exercise.id) ?? null,
    );

    // Training deliberately absent from this list. See above.
    const candidates = [maxes.tested, maxes.estimated].filter((m) => m !== null);
    const best = candidates.reduce<(typeof candidates)[number] | null>(
      (winner, m) => (winner === null || m.valueKg > winner.valueKg ? m : winner),
      null,
    );

    if (!best) {
      missing.push(lift);
      continue;
    }
    found.push({
      lift,
      exerciseId: exercise.id,
      valueKg: best.valueKg,
      kind: best.kind,
      asOf: best.asOf,
    });
  }

  return { found, missing };
}

/**
 * What the screens render.
 *
 * A discriminated result rather than `number | null`, because every way this
 * can fail needs different words on screen. The blueprint asks for a prompt to
 * complete the profile when sex is missing, and "fail gracefully rather than
 * showing a broken figure" -- which it can only do if it knows which thing is
 * absent.
 */
export type DotsResult =
  | {
      status: "ready";
      score: number;
      totalKg: number;
      bodyweightKg: number;
      /** The day the bodyweight was measured, so the screen can date the number. */
      measuredOn: string;
      /**
       * The last weigh-in is older than the averaging window. The score is
       * still computed and still shown -- see below.
       */
      stale: boolean;
      lifts: LiftBest[];
    }
  | { status: "no-sex" }
  | { status: "no-bodyweight" }
  | { status: "incomplete-total"; missing: CompetitionLift[] };

export interface DotsInput extends LiftMaxInput {
  sex: Sex | null;
  bodyweight: readonly BodyweightEntry[];
  /** Local day key. Injected so staleness is testable without mocking a clock. */
  today?: string;
}

/**
 * DOTS for one athlete, or the reason there isn't one.
 *
 * Order of the refusals matters and is the order the athlete can act on them:
 * sex is one tap on Profile, a weigh-in is one tap here, and a missing lift
 * needs training. Reporting the cheapest fix first is the difference between a
 * prompt and a wall.
 *
 * A stale bodyweight still produces a score, carrying `stale` and the date.
 * This follows the precedent bodyweight.md set rather than inventing one: when
 * `trend` goes null both screens keep showing the last weight with the day it
 * was taken. Suppressing DOTS instead would leave the coach with nothing on
 * the screen that exists so he stops having to ask, and presenting it as
 * current is the "lie with a number attached" that doc names. Labelled, not
 * hidden. The window is the bodyweight module's own -- there is deliberately
 * no staleness constant in this file.
 */
export function dotsFor(input: DotsInput): DotsResult {
  if (input.sex === null) return { status: "no-sex" };

  const newest = latestEntry(input.bodyweight);
  if (!newest || newest.weightKg <= 0) return { status: "no-bodyweight" };

  const { found, missing } = bestCompetitionLifts(input);
  // All three or none. Two lifts is not a total: a missing deadlift would cut
  // the score by roughly a third and read as a collapse in form rather than as
  // an absent number.
  if (missing.length > 0) return { status: "incomplete-total", missing };

  const totalKg = found.reduce((sum, lift) => sum + lift.valueKg, 0);
  const elapsed = daysBetween(newest.measuredOn, input.today ?? dayKey());

  return {
    status: "ready",
    score: dotsScore(input.sex, newest.weightKg, totalKg),
    totalKg,
    bodyweightKg: newest.weightKg,
    measuredOn: newest.measuredOn,
    stale: elapsed === null || elapsed >= AVERAGE_DAYS,
    lifts: found,
  };
}

/**
 * One decimal place.
 *
 * DOTS moves by a point or two across a whole training block, so whole numbers
 * would hide a real month of progress. Three decimals would imply a precision
 * the inputs do not have -- the bodyweight behind it is itself only good to
 * 0.1kg, which moves the score by more than a hundredth.
 */
export const formatDots = (score: number): string => score.toFixed(1);

/** "212.5 / 140 / 200", in competition order, as the blueprint writes it. */
export const formatTotalBreakdown = (lifts: readonly LiftBest[]): string =>
  lifts.map((lift) => String(Math.round(lift.valueKg * 2) / 2)).join(" / ");
