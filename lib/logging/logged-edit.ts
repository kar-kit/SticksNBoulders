import { canComplete, type RpeValue } from "./set";
import type { SetValues } from "./offline-view";
import { noteOf } from "./set-note";
import { canCompleteCardio, isCardioSet } from "./cardio";

/**
 * Correcting a set already logged, from the Log (F9).
 *
 * Joey, on the gym floor: "No way to edit RPE, weight or reps after
 * completing a set; forced to delete and rewrite." Deleting to retype loses
 * the set's place in the session, its clip and its time, so the Log reopens
 * the keypad on the logged set instead and writes the correction through
 * `editSet`, History's path.
 *
 * What is being typed lives in a draft, never on the set. The row in the list
 * keeps showing what was logged until Save, so Cancel -- or a tap on the
 * dimmed page behind the sheet (F16), confirmed when the draft has changed --
 * leaves the set exactly as it was, with nothing to roll back. These are the rules for that draft; the screen holds it.
 */

/**
 * The values in the edit sheet. Load and reps go null while the athlete has
 * backspaced them empty, the same as a row being entered.
 *
 * A warm-up keeps the RPE it was opened with here even though it will not be
 * saved with one, so flipping the switch off and on again inside the one edit
 * gives the RPE back rather than making the athlete pick it again.
 */
export interface EditDraft {
  loadKg: number | null;
  reps: number | null;
  rpe: RpeValue | null;
  isWarmup: boolean;
  /** The athlete missed the set (F19): reps is what they completed, 0 allowed. */
  failed: boolean;
  /**
   * The note as typed (F11), untrimmed so the textarea keeps the athlete's
   * spaces while they type. Blank is no note; `editOf` decides what is stored.
   */
  notes: string;
  /**
   * The set being corrected is cardio (F23): the sheet edits its time and
   * level, and Save writes those. Fixed when the sheet opens, from the set
   * itself, so backspacing the time empty never turns it into a strength
   * draft. Absent is false.
   */
  cardio?: boolean;
  /** A cardio draft's time in seconds, null while backspaced empty. */
  durationSeconds?: number | null;
  /** A cardio draft's level, null for none. */
  level?: number | null;
}

/**
 * The draft a logged set opens with: its values as the screen shows them,
 * edits included.
 *
 * `heldRpe` is the RPE a warm-up had before it was made one (the set number's
 * flip clears it), so opening a warm-up and switching it back to working
 * offers the number the athlete originally gave.
 */
export function draftOf(set: SetValues, heldRpe: number | null = null): EditDraft {
  return {
    loadKg: set.loadKg,
    reps: set.reps,
    rpe: ((set.isWarmup ? heldRpe : set.rpe) ?? null) as RpeValue | null,
    isWarmup: set.isWarmup,
    failed: set.failed === true,
    notes: set.notes ?? "",
    ...(isCardioSet(set)
      ? { cardio: true, durationSeconds: set.durationSeconds ?? null, level: set.level ?? null }
      : {}),
  };
}

/**
 * What Save writes, or null when the draft is not a set yet (no load, no
 * reps, or zero of either: the same rule as the confirm square -- except
 * that a failed set may be saved with 0 reps, F19, and a set of a bodyweight
 * exercise at 0 kg, F20). `isBodyweight` is the exercise's flag, which the
 * draft does not carry: correcting a pull-up to 0 kg saves, correcting a
 * squat to 0 kg does not, exactly as when they were logged.
 *
 * The note always goes with it, trimmed, and null when blank: a Save from
 * this sheet is a statement about the whole set, note included, so emptying
 * the note and saving clears it.
 *
 * A warm-up is saved with no RPE. Warm-ups never ask for one and are left out
 * of PRs and rollups, and the stored e1RM is recomputed from these four
 * values, so an RPE left on a warm-up would be a number nothing reads.
 */
export function editOf(draft: EditDraft, isBodyweight = false): SetValues | null {
  // A cardio correction (F23) saves a time above zero and an optional level,
  // with the strength values as the inert ones the helper stores anyway.
  if (draft.cardio) {
    if (!canCompleteCardio(draft)) return null;
    return {
      loadKg: 0,
      reps: 0,
      rpe: null,
      isWarmup: false,
      failed: false,
      notes: noteOf(draft.notes),
      durationSeconds: draft.durationSeconds as number,
      level: draft.level ?? null,
    };
  }
  if (!canComplete({ ...draft, isBodyweight })) return null;
  return {
    loadKg: draft.loadKg as number,
    reps: draft.reps as number,
    rpe: draft.isWarmup ? null : draft.rpe,
    isWarmup: draft.isWarmup,
    failed: draft.failed,
    notes: noteOf(draft.notes),
  };
}

/**
 * Whether saving `edit` would change anything. Save on an untouched sheet is
 * a close, not a write: a queued update and a rollup refresh for nothing
 * would put a pending mark on a set that was never changed.
 */
export function changesSet(set: SetValues, edit: SetValues): boolean {
  return (
    set.loadKg !== edit.loadKg ||
    set.reps !== edit.reps ||
    (set.rpe ?? null) !== (edit.rpe ?? null) ||
    set.isWarmup !== edit.isWarmup ||
    // Absent is false: every set before v19, and every edit that predates F19.
    (set.failed === true) !== (edit.failed === true) ||
    // F23: a cardio set's time and level. Absent and null are both none.
    (set.durationSeconds ?? null) !== (edit.durationSeconds ?? null) ||
    (set.level ?? null) !== (edit.level ?? null) ||
    // A set with no note and a draft left blank are the same: absent, null
    // and "" all mean none.
    (edit.notes !== undefined && noteOf(set.notes) !== noteOf(edit.notes))
  );
}
