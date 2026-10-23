import { formatPrescription, parsePrescription } from "./prescription";
import { byPosition, type WeekTree } from "./program";
import { PRESCRIBABLE_RPE_VALUES, type PrescribableRpe } from "@/lib/logging/set";

/**
 * Duplicate a week with a bump: the copy is the week with every load moved by
 * the same step -- "+2.5%", "+5 kg", "+0.5 RPE" -- the edit a coach makes
 * line by line after "+ Week" today. docs/program-layout.md §5.
 *
 * It is the coach's step applied to the coach's lines, nothing inferred: a
 * fixed load takes the kilos, a percentage the percent, an RPE the RPE, a
 * capped line both of its parts. Freeform words are the coach's and are
 * never touched. Written afterwards as ordinary `updatePrescription`s on the
 * copy, so the server checks every one as if typed.
 *
 * Pure. No client, no network, no clock.
 */

export interface Bump {
  kg: number;
  percent: number;
  rpe: number;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

const NONE: Bump = { kg: 0, percent: 0, rpe: 0 };

/** `"2.5"`, `"+2.5"`, `"-5"`, or empty for no step. */
function step(text: string, label: string): Parsed<number> {
  const trimmed = text.trim().replace(",", ".");
  if (!trimmed) return { ok: true, value: 0 };
  if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) return { ok: false, reason: `${label} is a number, like 2.5 or -5` };
  return { ok: true, value: Number(trimmed) };
}

/**
 * The three fields of the form. An RPE step is a half-point multiple because
 * that is all a prescribed RPE can be (PRESCRIBABLE_RPE_VALUES); anything else would round silently.
 */
export function parseBump(fields: { kg: string; percent: string; rpe: string }): Parsed<Bump> {
  const kg = step(fields.kg, "Kilos");
  if (!kg.ok) return kg;
  const percent = step(fields.percent, "Percent");
  if (!percent.ok) return percent;
  const rpe = step(fields.rpe, "RPE");
  if (!rpe.ok) return rpe;
  if (!Number.isInteger(rpe.value * 2)) return { ok: false, reason: "RPE moves in half points, like 0.5" };
  return { ok: true, value: { kg: kg.value, percent: percent.value, rpe: rpe.value } };
}

export const isNoBump = (bump: Bump): boolean => bump.kg === 0 && bump.percent === 0 && bump.rpe === 0;

const RPE_MIN = PRESCRIBABLE_RPE_VALUES[0];
const RPE_MAX = PRESCRIBABLE_RPE_VALUES[PRESCRIBABLE_RPE_VALUES.length - 1];
/**
 * Kept on the coach's scale: +1 on @9.5 is @10, not an RPE that freeform
 * would swallow, and -2 on @7 is @6, not @5. The athlete can log below 6
 * (F10); a program cannot ask for it.
 */
const clampRpe = (rpe: number) => Math.min(RPE_MAX, Math.max(RPE_MIN, rpe)) as PrescribableRpe;
/** Two decimals at most: 0.1 + 0.2 is not 0.30000000000000004 kg. */
const tidy = (value: number) => Math.round(value * 100) / 100;

/**
 * One load cell, bumped, in the canonical spelling; or null when the bump
 * does not change it (freeform, empty, or a step of zero for its kind). A
 * step that would take a load to nothing or below is not applied.
 */
export function bumpLoad(load: string | null, bump: Bump = NONE): string | null {
  const spec = load ? parsePrescription(load) : null;
  if (!spec) return null;
  switch (spec.kind) {
    case "freeform":
      return null;
    case "fixed": {
      const loadKg = tidy(spec.loadKg + bump.kg);
      return bump.kg && loadKg > 0 ? formatPrescription({ ...spec, loadKg }) : null;
    }
    case "percent": {
      const percent = tidy(spec.percent + bump.percent);
      return bump.percent && percent > 0 ? formatPrescription({ ...spec, percent }) : null;
    }
    case "rpe": {
      const rpe = clampRpe(spec.rpe + bump.rpe);
      return rpe !== spec.rpe ? formatPrescription({ ...spec, rpe }) : null;
    }
    case "capped": {
      const percent = tidy(spec.percent + bump.percent);
      const rpe = clampRpe(spec.rpe + bump.rpe);
      const next = { ...spec, percent: percent > 0 ? percent : spec.percent, rpe };
      return next.percent !== spec.percent || next.rpe !== spec.rpe ? formatPrescription(next) : null;
    }
  }
}

/** One line of the copy that changes: where it is in the week, and from what to what. */
export interface BumpChange {
  dayIndex: number;
  lineIndex: number;
  exerciseId: string;
  from: string;
  to: string;
}

/**
 * Every line of the week the bump changes, by its place in the week (day by
 * position, line by position) -- the same place it takes in the copy, which
 * `duplicateWeek` writes day for day and line for line.
 */
export function bumpPlan(week: Pick<WeekTree, "days">, bump: Bump): BumpChange[] {
  const changes: BumpChange[] = [];
  byPosition(week.days).forEach((day, dayIndex) =>
    byPosition(day.prescriptions).forEach((line, lineIndex) => {
      const to = bumpLoad(line.load, bump);
      if (to !== null && line.load) changes.push({ dayIndex, lineIndex, exerciseId: line.exerciseId, from: line.load, to });
    }),
  );
  return changes;
}

/** The copy's line for a change, found by place. Null if the copy is not shaped like its source. */
export function lineAt(week: Pick<WeekTree, "days">, change: Pick<BumpChange, "dayIndex" | "lineIndex" | "exerciseId">) {
  const line = byPosition(byPosition(week.days)[change.dayIndex]?.prescriptions ?? [])[change.lineIndex];
  return line && line.exerciseId === change.exerciseId ? line : null;
}
