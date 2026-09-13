/**
 * Prefill precedence for a set row.
 *
 * Straight from the Set Row blueprint. Rule 3 is the one that matters most:
 * straight sets are the norm, so repeating the previous set must cost one tap.
 *
 *   1. A prescription for this set exists, with a resolvable load
 *   2. A suggestion from the RPE engine exists (marked as a suggestion)
 *   3. The previous set of this exercise this session
 *   4. The same exercise last session
 *   5. Empty
 */

export type PrefillSource =
  | "prescribed"
  | "suggested"
  | "repeated"
  | "last-session"
  | "empty";

export interface Prescription {
  /**
   * Null when the prescription is RPE-only, or a percentage with no reference
   * max to resolve against. The blueprint is explicit: the kilo field starts
   * empty and the engine fills it after the first working set.
   */
  loadKg: number | null;
  reps: number | null;
}

export interface Suggestion {
  loadKg: number;
  reps?: number | null;
  /** Both are shown to the athlete: "suggested from RPE 7 @ 142.5". */
  fromRpe: number;
  fromLoadKg: number;
}

export interface CompletedSet {
  loadKg: number;
  reps: number;
}

export interface PrefillInputs {
  prescription?: Prescription | null;
  suggestion?: Suggestion | null;
  previousSetThisSession?: CompletedSet | null;
  sameExerciseLastSession?: CompletedSet | null;
}

export interface Prefill {
  loadKg: number | null;
  reps: number | null;
  /** Which source supplied the LOAD. It is the load that carries the annotation. */
  source: PrefillSource;
  /** Shown under the row when the load did not come from the athlete. */
  note: string | null;
}

function isUsableLoad(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isUsableReps(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Load and reps resolve down the same ordered chain, but independently: a
 * source that cannot supply one is skipped for that field only.
 *
 * [Inference] The blueprint states the precedence as a single list, which reads
 * as all-or-nothing per source. Resolving independently is what makes an
 * RPE-prescribed set behave correctly -- "3 x 5 @ RPE 8" knows its reps but not
 * its load, and dropping the reps too would make the athlete retype a number
 * the coach already wrote. The reported `source` follows the load, because the
 * load is what the annotation explains.
 */
export function resolvePrefill(inputs: PrefillInputs = {}): Prefill {
  const { prescription, suggestion, previousSetThisSession, sameExerciseLastSession } = inputs;

  const repsChain = [
    prescription?.reps,
    suggestion?.reps,
    previousSetThisSession?.reps,
    sameExerciseLastSession?.reps,
  ];
  const reps = repsChain.find(isUsableReps) ?? null;

  if (isUsableLoad(prescription?.loadKg)) {
    return { loadKg: prescription.loadKg, reps, source: "prescribed", note: null };
  }

  if (suggestion && isUsableLoad(suggestion.loadKg)) {
    return {
      loadKg: suggestion.loadKg,
      reps,
      source: "suggested",
      note: `suggested from RPE ${formatNumber(suggestion.fromRpe)} @ ${formatNumber(suggestion.fromLoadKg)}`,
    };
  }

  if (previousSetThisSession && isUsableLoad(previousSetThisSession.loadKg)) {
    return { loadKg: previousSetThisSession.loadKg, reps, source: "repeated", note: null };
  }

  if (sameExerciseLastSession && isUsableLoad(sameExerciseLastSession.loadKg)) {
    return {
      loadKg: sameExerciseLastSession.loadKg,
      reps,
      source: "last-session",
      note: "from your last session",
    };
  }

  return { loadKg: null, reps, source: "empty", note: null };
}

/** Trims the trailing zero so 142.5 stays 142.5 and 145.0 renders as 145. */
export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}
