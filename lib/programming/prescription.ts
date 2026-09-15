import type { SetForEstimate } from "@/lib/strength/e1rm";
import { estimateOneRepMax } from "@/lib/strength/e1rm";
import type { RpeValue } from "@/lib/logging/set";
import { RPE_VALUES } from "@/lib/logging/set";
import type { MaxKind } from "@/lib/strength/reference-max";

/**
 * What a coach writes in the load cell.
 *
 * The Program Editor blueprint calls this "the hardest control in the product":
 * one cell that accepts five kinds of prescription and must be *typed* rather
 * than picked from a dropdown first. Ruairi types `75% @8` and moves on; making
 * him choose a load type before he can type the load is the thing that sends
 * him back to Excel.
 *
 *   fixed     142.5        142.5 kg
 *   percent   75%          75% resolved to their kg
 *   rpe       @8 / rpe8    RPE 8, they pick the weight
 *   capped    75% @8       75%, stop at RPE 8
 *   freeform  any text     shown as written
 *
 * Freeform is the escape hatch and is not optional. Every place this cell
 * refuses to hold what a coach wants to say is a place he reopens the
 * spreadsheet. So parsing never fails -- anything the grammar does not
 * recognise becomes freeform, and the returned spec carries its `kind` so the
 * editor can show what it landed as. A coach who meant 75% and typed `75%%`
 * needs to see that it became text, not discover it on an athlete's phone.
 *
 * ## No table here
 *
 * Order 18 is the model. Prescriptions hang off a block, a week and a day, and
 * that container is Order 19 -- still blocked on Ruairi's question about
 * whether he writes a block up front or session by session. `parse` and
 * `format` round-trip exactly, so Order 19 can store the typed text or the
 * structured fields and derive the other, and that choice belongs to whoever
 * owns the table.
 *
 * Pure. No client, no network, no clock.
 */

export type PrescriptionKind = "fixed" | "percent" | "rpe" | "capped" | "freeform";

/**
 * Which max a percentage is a percentage of.
 *
 * The blueprint: "A percentage needs a reference max, which defaults to the
 * training max and can be changed per row." That is which *kind* of max -- the
 * prescription's own exercise supplies it either way.
 *
 * Deliberately not a pointer at another exercise's max. Order 18's notes reject
 * "a single reference max standing in for lifts that move different weights",
 * which is exactly what tempo bench at a percentage of competition bench would
 * be. Whether Ruairi wants that anyway is still [SME to confirm]; if he does it
 * is one added field, not a reshaped union.
 */
export const DEFAULT_BASIS: MaxKind = "training";

export type PrescriptionSpec =
  | { kind: "fixed"; loadKg: number }
  | { kind: "percent"; percent: number; basis: MaxKind }
  | { kind: "rpe"; rpe: RpeValue }
  | { kind: "capped"; percent: number; basis: MaxKind; rpe: RpeValue }
  /** Exactly what the coach typed, shown to the athlete as written. */
  | { kind: "freeform"; text: string };

/* -------------------------------------------------------------------------
 * Parsing
 * ---------------------------------------------------------------------- */

const isRpe = (value: number): value is RpeValue =>
  (RPE_VALUES as readonly number[]).includes(value);

/** `@8`, `@8.5`, `rpe8`, `rpe 8.5`. */
const RPE_PART = /(?:@|rpe\s*)(\d+(?:\.\d+)?)/i;
/** `75%`, `75 %`, optionally `of training max` / `of tested` / `of e1rm`. */
const PERCENT_PART = /(\d+(?:\.\d+)?)\s*%(?:\s*of\s+(tested|training(?:\s+max)?|e1rm|estimated))?/i;
/** `142.5`, `60kg`, `60 kg`. The blueprint's own grid shows a `60 kg` cell. */
const FIXED_ONLY = /^(\d+(?:\.\d+)?)\s*(?:kg)?$/i;

function basisFrom(word: string | undefined): MaxKind {
  if (!word) return DEFAULT_BASIS;
  const normalised = word.trim().toLowerCase();
  if (normalised.startsWith("tested")) return "tested";
  if (normalised.startsWith("e1rm") || normalised.startsWith("estimated")) return "estimated";
  return "training";
}

/**
 * What the coach typed, as a spec. Never throws and never returns nothing:
 * unrecognised input is freeform, which is the point of freeform.
 *
 * Returns null only for an empty cell, which is the absence of a prescription
 * rather than a prescription of nothing.
 */
export function parsePrescription(input: string): PrescriptionSpec | null {
  const text = input.trim();
  if (!text) return null;

  const rpeMatch = RPE_PART.exec(text);
  const percentMatch = PERCENT_PART.exec(text);

  const rpeValue = rpeMatch ? Number(rpeMatch[1]) : null;
  // An out-of-range RPE is not an error to reject -- it falls through to
  // freeform, so `@12` reaches the athlete as the coach's own words rather
  // than as a silently clamped RPE 10.
  const rpe = rpeValue !== null && isRpe(rpeValue) ? rpeValue : null;

  const percent = percentMatch ? Number(percentMatch[1]) : null;
  const basis = basisFrom(percentMatch?.[2]);
  const usablePercent = percent !== null && Number.isFinite(percent) && percent > 0 ? percent : null;

  // Capped first: `75% @8` is both, and it is its own kind rather than a
  // percentage that happens to mention an RPE. Order-independent, so
  // `@8 75%` is the same prescription.
  if (usablePercent !== null && rpe !== null && consumesWholeCell(text, [percentMatch, rpeMatch])) {
    return { kind: "capped", percent: usablePercent, basis, rpe };
  }
  if (usablePercent !== null && !rpeMatch && consumesWholeCell(text, [percentMatch])) {
    return { kind: "percent", percent: usablePercent, basis };
  }
  if (rpe !== null && !percentMatch && consumesWholeCell(text, [rpeMatch])) {
    return { kind: "rpe", rpe };
  }

  const fixed = FIXED_ONLY.exec(text);
  if (fixed) {
    const loadKg = Number(fixed[1]);
    // A bare number is kilos, never RPE. The grammar requires @ or "rpe" for
    // an RPE, so a coach typing `8` gets 8kg -- deliberate, and the editor
    // showing the parsed kind is what makes it visible.
    if (Number.isFinite(loadKg) && loadKg > 0) return { kind: "fixed", loadKg };
  }

  return { kind: "freeform", text };
}

/**
 * True when the matched parts account for the whole cell, ignoring the glue
 * between them.
 *
 * Without this, `squat 75% then stretch` would parse as a clean 75% and the
 * coach's actual instruction would vanish. Anything with words left over is
 * freeform, which is the safe direction: it reaches the athlete as written.
 */
function consumesWholeCell(text: string, matches: Array<RegExpExecArray | null>): boolean {
  let remaining = text;
  for (const match of matches) {
    if (!match) continue;
    remaining = remaining.replace(match[0], " ");
  }
  return remaining.trim().length === 0;
}

/* -------------------------------------------------------------------------
 * Formatting
 * ---------------------------------------------------------------------- */

const trimZero = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));

const basisSuffix = (basis: MaxKind): string => {
  if (basis === DEFAULT_BASIS) return "";
  return basis === "estimated" ? " of e1RM" : " of tested";
};

/**
 * The canonical spelling of a spec, and the inverse of `parsePrescription`.
 *
 * `parse(format(spec))` returns the same spec for every kind, which is what
 * lets Order 19 store either the text or the fields and derive the other.
 */
export function formatPrescription(spec: PrescriptionSpec): string {
  switch (spec.kind) {
    case "fixed":
      return `${trimZero(spec.loadKg)}kg`;
    case "percent":
      return `${trimZero(spec.percent)}%${basisSuffix(spec.basis)}`;
    case "rpe":
      return `@${trimZero(spec.rpe)}`;
    case "capped":
      return `${trimZero(spec.percent)}%${basisSuffix(spec.basis)} @${trimZero(spec.rpe)}`;
    case "freeform":
      return spec.text;
  }
}

/* -------------------------------------------------------------------------
 * Resolving
 * ---------------------------------------------------------------------- */

/**
 * The smallest jump a loaded barbell actually makes: a 1.25kg plate on each
 * side. 73% of 182.5 is 133.225, and nobody can put that on a bar.
 *
 * [Inference] Neither the ticket nor the blueprint specifies an increment;
 * 2.5kg is the standard plate pair. Micro-plates would make 1.25 defensible
 * instead. [SME to confirm] with Ruairi.
 */
export const LOADABLE_INCREMENT_KG = 2.5;

/**
 * Down, never up, and this is a product decision rather than arithmetic.
 *
 * A percentage is a target intensity, and the two directions are not equally
 * wrong: prescribing more than the coach asked for is a missed rep or a
 * failed set, prescribing slightly less is a set that was a shade light.
 * Rounding to nearest also makes 100% of a 191.5kg max resolve to 192.5 --
 * a weight the athlete has never lifted, prescribed as if they had.
 *
 * The cost is that every resolved percentage sits up to 2.4kg under its exact
 * value, about 1% on a heavy squat. [SME to confirm] alongside the increment:
 * if Ruairi wants nearest, it is one word here.
 */
export const roundToLoadable = (kg: number): number =>
  Math.floor(kg / LOADABLE_INCREMENT_KG) * LOADABLE_INCREMENT_KG;

export interface ResolvedPrescription {
  /**
   * Null when the athlete picks the weight (RPE), when a percentage has no max
   * to resolve against, or for freeform. `lib/logging/prefill.ts` already
   * documents exactly this case: the kilo field starts empty and the RPE
   * engine fills it after the first working set.
   */
  loadKg: number | null;
  /** The ceiling on a capped prescription, or the target on an RPE one. */
  rpe: RpeValue | null;
  /** What the athlete reads on the set row. */
  display: string;
  /**
   * True when this is a percentage that could not be resolved because the
   * athlete has no max for the lift yet. The editor warns the coach; the
   * athlete just sees the percentage and picks a weight.
   */
  unresolved: boolean;
  /** Which number the percentage was resolved against, if any. */
  basisUsed: BasisUsed | null;
  /**
   * True when the weight came from today's first working set rather than from
   * a stored max.
   *
   * It is a suggestion, and the feature list is explicit that a load
   * suggestion is "always a suggestion, always overridable, never silently
   * imposed" (Order 27). So the flag exists to be shown, not just recorded --
   * the athlete sees where the number came from and can ignore it.
   */
  synced: boolean;
}

/**
 * The maxes available for the prescription's own exercise, in kg.
 *
 * `session` is the one that makes a percentage useful rather than decorative.
 * See `sessionMaxFrom` below.
 */
export interface BasisMaxes extends Partial<Record<MaxKind, number | null>> {
  /** Derived from the first working set of this exercise today. */
  session?: number | null;
}

/** Which number the percentage actually got resolved against. */
export type BasisUsed = MaxKind | "session";

/**
 * Today's working max for one exercise, from the set the athlete just did.
 *
 * This is the mechanism that makes a percentage a weight recommendation
 * instead of arithmetic against a stale number. A coach prescribes the first
 * set at an RPE and the rest as percentages; the athlete hits the RPE, and
 * that set says what they are actually good for TODAY. Every remaining
 * percentage on that exercise then has a real weight against it.
 *
 * It is the answer to the problem the ticket opens with -- "athletes max out
 * mid block and wreck his programming". A stored training max goes stale the
 * moment someone gets stronger or turns up tired; the first working set does
 * not.
 *
 * Returns null for a warm-up, for a set logged without an RPE, and for one too
 * far from failure to estimate from -- all of which `estimateOneRepMax`
 * already refuses, because a wrong number here is a wrong weight on every
 * remaining set of the exercise.
 */
export function sessionMaxFrom(set: SetForEstimate): number | null {
  return estimateOneRepMax(set);
}

const kgLabel = (kg: number): string => `${trimZero(kg)} kg`;

/**
 * What the athlete sees for one prescription.
 *
 * A percentage with no max resolves to no load rather than to a guess. The
 * athlete sees "75%" and uses their own judgement, which is the honest
 * failure: inventing a number here would put a weight on a bar that no
 * coach chose and no data supports.
 */
const usable = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * Which number a percentage resolves against, and why.
 *
 * Today's working set beats the stored training max whenever there is one.
 * That is the whole point of prescribing the first set at an RPE: the training
 * max is a number from weeks ago, and the set the athlete just did is a
 * measurement from minutes ago. Preferring the stored number would leave a
 * coach's percentages priced against a max the athlete has already outgrown --
 * the exact complaint this ticket opens with.
 *
 * A coach who spells out `of tested` or `of e1RM` is naming a specific stored
 * number and gets it. Only the default basis autoregulates, so the escape
 * hatch is a word.
 */
function chooseBasis(basis: MaxKind, maxes: BasisMaxes): { kg: number; used: BasisUsed } | null {
  if (basis === DEFAULT_BASIS && usable(maxes.session)) {
    return { kg: maxes.session, used: "session" };
  }
  const stored = maxes[basis];
  return usable(stored) ? { kg: stored, used: basis } : null;
}

export function resolvePrescription(
  spec: PrescriptionSpec,
  maxes: BasisMaxes = {},
): ResolvedPrescription {
  const none = { basisUsed: null, synced: false } as const;

  switch (spec.kind) {
    case "fixed":
      return {
        loadKg: spec.loadKg,
        rpe: null,
        display: kgLabel(spec.loadKg),
        unresolved: false,
        ...none,
      };

    case "rpe":
      return {
        loadKg: null,
        rpe: spec.rpe,
        display: `RPE ${trimZero(spec.rpe)}`,
        unresolved: false,
        ...none,
      };

    case "freeform":
      return { loadKg: null, rpe: null, display: spec.text, unresolved: false, ...none };

    case "percent":
    case "capped": {
      const chosen = chooseBasis(spec.basis, maxes);
      const cap = spec.kind === "capped" ? spec.rpe : null;
      const percentLabel = `${trimZero(spec.percent)}%`;
      const capLabel = cap === null ? "" : `, stop at RPE ${trimZero(cap)}`;

      if (!chosen) {
        return {
          loadKg: null,
          rpe: cap,
          display: `${percentLabel}${capLabel}`,
          unresolved: true,
          ...none,
        };
      }

      const loadKg = roundToLoadable((spec.percent / 100) * chosen.kg);
      const synced = chosen.used === "session";
      return {
        // The resolved kilos lead, because that is what goes on the bar. The
        // percentage stays visible so an athlete can see what it was a
        // percentage of when their max moves next block.
        loadKg,
        rpe: cap,
        display: `${kgLabel(loadKg)} (${percentLabel})${capLabel}`,
        unresolved: false,
        basisUsed: chosen.used,
        synced,
      };
    }
  }
}

/**
 * Every prescription for one exercise, resolved against the same session.
 *
 * This is the loop the whole percentage model exists for. A coach writes a
 * first set at an RPE and the rest as percentages. The athlete hits the first
 * set; that set says what they are good for today; every remaining percentage
 * on that exercise turns into a weight they can actually load. Before the
 * first set is logged, the percentages fall back to the stored training max,
 * so the session still opens with numbers rather than blanks.
 *
 * `firstWorkingSet` is the athlete's own first working set of this exercise.
 * Warm-ups and sets logged without an RPE produce no session max -- see
 * `sessionMaxFrom` -- and the percentages simply stay on the stored max, which
 * is the safe direction.
 *
 * Nothing here is imposed: a resolved prescription carries `synced` so the
 * logger can show where the weight came from, per Order 27's rule that a load
 * suggestion is never silently applied.
 */
export function resolveExercise(
  specs: readonly PrescriptionSpec[],
  maxes: BasisMaxes = {},
  firstWorkingSet?: SetForEstimate | null,
): ResolvedPrescription[] {
  const session = firstWorkingSet ? sessionMaxFrom(firstWorkingSet) : null;
  const withSession: BasisMaxes = { ...maxes, session: session ?? maxes.session ?? null };
  return specs.map((spec) => resolvePrescription(spec, withSession));
}

/**
 * Parse and resolve in one step, for a caller holding raw text.
 *
 * Returns null for an empty cell, matching `parsePrescription`.
 */
export function readPrescription(
  input: string,
  maxes: BasisMaxes = {},
): ResolvedPrescription | null {
  const spec = parsePrescription(input);
  return spec === null ? null : resolvePrescription(spec, maxes);
}

/* -------------------------------------------------------------------------
 * The logger's seam
 * ---------------------------------------------------------------------- */

/**
 * A resolved prescription in the shape `lib/logging/prefill.ts` already
 * expects, so the athlete's set row fills itself from the coach's programming.
 *
 * `reps` comes from the prescription row rather than the load cell -- the grid
 * has its own Sets and Reps columns -- so the caller supplies it. That row is
 * Order 19's, which is why this takes it as an argument instead of reaching
 * for it.
 *
 * Note what does not survive the trip: a capped prescription's RPE ceiling has
 * nowhere to go in prefill's contract, which carries a load and reps and
 * nothing else. That is correct for now -- the ceiling is an instruction to
 * display, not a value to prefill.
 *
 * `synced` does not survive either, and that one matters. prefill has separate
 * "prescribed" and "suggested" sources, and a weight derived from today's
 * first set is a suggestion -- Order 27 is explicit that a load suggestion is
 * never silently imposed. A caller wiring this up at Order 22 should read
 * `resolved.synced` and choose the source accordingly rather than letting a
 * derived weight present itself as the coach's own number.
 */
export function toPrefillPrescription(
  resolved: ResolvedPrescription,
  reps: number | null = null,
): { loadKg: number | null; reps: number | null } {
  return { loadKg: resolved.loadKg, reps };
}
