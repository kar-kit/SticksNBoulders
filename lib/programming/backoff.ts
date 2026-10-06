import type { SetForEstimate } from "@/lib/strength/e1rm";
import { roundToLoadable } from "@/lib/strength/plates";
import { RPE_VALUES, type RpeValue } from "@/lib/logging/set";

/**
 * Backoff rules on a prescription line. Order 21. Source: Inferred.
 *
 * A coach writes the top set as a line ("1 x 3 @8") and attaches a rule for
 * the sets that follow it. The rule is executed against what the athlete
 * ACTUALLY lifted for that top set today, never against a prescribed number,
 * because the point of an RPE top set is that nobody knew the weight in
 * advance.
 *
 * Two RTS-style patterns, typed into one cell the way the load cell is:
 *
 *   percent   `3 x 90%`, `3 x -10%`     N sets at X% of the top set's load
 *   drop      `-5% until @9`            the top set's load minus D%, repeated
 *             `repeat until @9`         until a set reaches RPE Y (D = 0)
 *             `-5% until @9 max 4`      ... and never more than 4 sets
 *
 * This is not an AI coach. Every number here is the coach's rule, executed:
 * the percentage, the drop, the stop RPE and the cap are what he typed. The
 * only thing the app supplies is the arithmetic and the rounding, and the
 * rounding is Order 18's (`roundToLoadable`), not a second copy of it.
 *
 * Unlike the load cell there is no freeform fallback. A backoff that does not
 * parse cannot be executed, so the editor refuses it on the cell and the coach
 * keeps the instruction in Notes instead -- which is where freeform already
 * lives.
 *
 * Pure. No client, no network, no clock. Works with no signal, because the
 * logger computes every target on the phone.
 */

export type BackoffRule =
  /** [Inference] load = roundDown(top set load x percent / 100). */
  | { kind: "percent"; sets: number; percent: number }
  /**
   * [Inference] load = roundDown(top set load x (1 - dropPercent / 100)), the
   * same load for every set, until one is logged at RPE >= untilRpe or the cap
   * is reached. The drop is measured on LOAD, not on e1RM -- [SME to confirm].
   */
  | { kind: "drop"; dropPercent: number; untilRpe: RpeValue; maxSets: number | null };

/**
 * How many sets a drop rule plans when the coach names no cap.
 *
 * [Inference] Not a training number: the athlete can always log more, and
 * extra sets simply get no target. It exists so an open-ended rule written in
 * the middle of a day cannot swallow the next line's sets forever. RTS-style
 * load-drop work rarely runs past four or five sets. [SME to confirm].
 */
export const DEFAULT_DROP_CAP = 5;

/** Longest a backoff cell may be. Stored in a 40-character column. */
export const BACKOFF_MAX_LENGTH = 40;

const MAX_SETS = 20;

const isRpe = (value: number): value is RpeValue => (RPE_VALUES as readonly number[]).includes(value);

const trim = (value: number): string => (Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2))));

/* -------------------------------------------------------------------------
 * Parsing and formatting
 * ---------------------------------------------------------------------- */

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const TIMES = String.raw`\s*(?:x|×|\*)\s*`;
/** `3 x 90%`, `3x-10%`, `3 × 90 %`. */
const SETS_THEN_PERCENT = new RegExp(String.raw`^(\d{1,2})${TIMES}(-)?\s*${NUM}\s*%$`, "i");
/** `90% x 3`, `-10% x 3`. */
const PERCENT_THEN_SETS = new RegExp(String.raw`^(-)?\s*${NUM}\s*%${TIMES}(\d{1,2})$`, "i");
/** `-5% until @9`, `repeat until rpe 9`, `-5% to @9 max 4`. */
const DROP = new RegExp(
  String.raw`^(?:-\s*${NUM}\s*%|(repeat|same))\s+(?:until|to)\s+(?:@|rpe\s*)${NUM}(?:\s*,?\s*max\s*(\d{1,2}))?$`,
  "i",
);

type Parsed = { ok: true; rule: BackoffRule | null } | { ok: false; reason: string };

const PERCENT_REASON = "Backoff is like 3 x 90%, 3 x -10%, -5% until @9 or repeat until @9";

/**
 * What the coach typed, as a rule. Empty means no backoff.
 *
 * Refuses rather than guessing: a backoff above 100% of the top set, a drop of
 * half the bar or more, or an RPE that is not on the chart is a typo, and a
 * typo here is a wrong weight on several sets.
 */
export function parseBackoff(input: string | null | undefined): Parsed {
  const text = (input ?? "").trim().replace(/\s+/g, " ");
  if (!text) return { ok: true, rule: null };
  if (text.length > BACKOFF_MAX_LENGTH) return { ok: false, reason: `Backoff is ${BACKOFF_MAX_LENGTH} characters at most` };

  const percentForm = SETS_THEN_PERCENT.exec(text);
  const reversed = percentForm ? null : PERCENT_THEN_SETS.exec(text);
  if (percentForm || reversed) {
    const [sets, minus, value] = percentForm
      ? [Number(percentForm[1]), percentForm[2], Number(percentForm[3])]
      : [Number(reversed![3]), reversed![1], Number(reversed![2])];
    const percent = minus ? 100 - value : value;
    if (!Number.isInteger(sets) || sets < 1 || sets > MAX_SETS) {
      return { ok: false, reason: `A backoff is 1 to ${MAX_SETS} sets` };
    }
    if (!(percent > 0 && percent <= 100) || (minus && value <= 0)) {
      return { ok: false, reason: "A backoff is a percentage of the top set, above 0% and at most 100%" };
    }
    return { ok: true, rule: { kind: "percent", sets, percent: Number(percent.toFixed(2)) } };
  }

  const drop = DROP.exec(text);
  if (drop) {
    const dropPercent = drop[2] ? 0 : Number(drop[1]);
    const untilRpe = Number(drop[3]);
    const maxSets = drop[4] ? Number(drop[4]) : null;
    if (!(dropPercent >= 0 && dropPercent < 50)) return { ok: false, reason: "A load drop is under 50%" };
    if (!isRpe(untilRpe)) return { ok: false, reason: "The stop RPE is on the chart: 6 to 10, in halves" };
    if (maxSets !== null && (maxSets < 1 || maxSets > MAX_SETS)) {
      return { ok: false, reason: `A backoff is 1 to ${MAX_SETS} sets` };
    }
    return { ok: true, rule: { kind: "drop", dropPercent, untilRpe, maxSets } };
  }

  return { ok: false, reason: PERCENT_REASON };
}

/** The canonical spelling of a rule, and the inverse of `parseBackoff`. */
export function formatBackoff(rule: BackoffRule): string {
  if (rule.kind === "percent") return `${rule.sets} x ${trim(rule.percent)}%`;
  const head = rule.dropPercent === 0 ? "repeat" : `-${trim(rule.dropPercent)}%`;
  const cap = rule.maxSets === null ? "" : ` max ${rule.maxSets}`;
  return `${head} until @${trim(rule.untilRpe)}${cap}`;
}

/** The stored text for whatever the coach typed: canonical, or null for none. Throws on input `parseBackoff` refuses. */
export function normaliseBackoff(input: string | null | undefined): string | null {
  const parsed = parseBackoff(input);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.rule === null ? null : formatBackoff(parsed.rule);
}

/** A stored backoff, as a rule. A row holding something unparseable has no backoff rather than a broken one. */
export function readBackoff(stored: string | null | undefined): BackoffRule | null {
  const parsed = parseBackoff(stored);
  return parsed.ok ? parsed.rule : null;
}

/** What the rule means, in words, beside the editor's cell. */
export function describeBackoff(rule: BackoffRule | null): string {
  if (!rule) return "No backoff";
  if (rule.kind === "percent") {
    return `${rule.sets} set${rule.sets === 1 ? "" : "s"} at ${trim(rule.percent)}% of today's top set`;
  }
  const load = rule.dropPercent === 0 ? "Top set weight" : `Top set −${trim(rule.dropPercent)}%`;
  return `${load}, repeat until RPE ${trim(rule.untilRpe)} (max ${rule.maxSets ?? DEFAULT_DROP_CAP})`;
}

/* -------------------------------------------------------------------------
 * Executing a rule against what was actually lifted
 * ---------------------------------------------------------------------- */

export interface TopSet {
  loadKg: number;
  reps: number;
  rpe: number | null;
}

/**
 * The top set among a line's own logged sets: the heaviest load.
 *
 * [Inference] Heaviest LOAD, not highest e1RM, because both rules are written
 * against the weight on the bar ("90% of the top set"). A tie goes to the later
 * set, which is the one the athlete just did. Warm-ups never count, whatever
 * they weighed -- a heavy opener single is not the set the coach prescribed.
 * Null when nothing usable has been logged, and then the backoff has no load
 * rather than a guessed one.
 */
export function topSetOf(sets: readonly SetForEstimate[]): TopSet | null {
  let best: SetForEstimate | null = null;
  for (const set of sets) {
    if (set.isWarmup || !(Number.isFinite(set.loadKg) && set.loadKg > 0)) continue;
    if (best === null || set.loadKg >= best.loadKg) best = set;
  }
  return best ? { loadKg: best.loadKg, reps: best.reps, rpe: best.rpe } : null;
}

/** The fraction of the top set's load a rule asks for. */
const factorOf = (rule: BackoffRule): number =>
  rule.kind === "percent" ? rule.percent / 100 : 1 - rule.dropPercent / 100;

/**
 * The load for every set of a backoff, from the top set's load.
 *
 * Rounded down to a loadable weight by Order 18's own function. One exception:
 * 100% (or a 0% drop, "repeat") is the top set's load exactly, because that
 * weight is already on the bar -- rounding 181 down to 180 for a "repeat" would
 * be the app quietly changing a number the athlete chose.
 *
 * Null when the rounded load would be nothing (a top set too light to take a
 * percentage of), rather than a target of 0 kg.
 */
export function backoffLoad(rule: BackoffRule, topLoadKg: number): number | null {
  if (!(Number.isFinite(topLoadKg) && topLoadKg > 0)) return null;
  const factor = factorOf(rule);
  if (factor === 1) return topLoadKg;
  const kg = roundToLoadable(topLoadKg * factor);
  return kg > 0 ? kg : null;
}

/**
 * How many backoff sets the plan holds right now, given the working sets
 * logged since the line's own sets.
 *
 * A percent rule is exactly its N. A drop rule is open-ended: each set logged
 * in the run counts, the run ends at the first set logged at or above the
 * stop RPE (that set included), and while it has not ended there is one more
 * set to do -- up to the cap. A set logged without an RPE cannot end the run,
 * because "Not sure" is not an answer to "did that reach @9".
 *
 * `after` is the working sets logged after the line's own sets, in order. Some
 * may belong to later lines; the run only consumes what it needs.
 */
export function backoffRun(rule: BackoffRule, after: readonly SetForEstimate[]): { sets: number; done: boolean } {
  if (rule.kind === "percent") return { sets: rule.sets, done: after.length >= rule.sets };
  const cap = rule.maxSets ?? DEFAULT_DROP_CAP;
  let logged = 0;
  for (const set of after) {
    if (logged >= cap) break;
    logged++;
    if (set.rpe !== null && set.rpe >= rule.untilRpe) return { sets: logged, done: true };
  }
  return logged >= cap ? { sets: logged, done: true } : { sets: logged + 1, done: false };
}

/** What a backoff set's load reads as: "162.5 kg (90% of top set)", or the rule alone with no top set yet. */
export function backoffDisplay(rule: BackoffRule, loadKg: number | null): string {
  const kg = loadKg === null ? "" : `${trim(loadKg)} kg `;
  const what =
    rule.kind === "percent"
      ? `${trim(rule.percent)}% of top set`
      : rule.dropPercent === 0
        ? "top set weight"
        : `top set −${trim(rule.dropPercent)}%`;
  const stop = rule.kind === "drop" ? `, until RPE ${trim(rule.untilRpe)}` : "";
  return loadKg === null ? `${what}${stop}` : `${kg}(${what})${stop}`;
}
