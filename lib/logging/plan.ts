import { resolvePrefill, type Suggestion } from "./prefill";
import type { RpeValue } from "./set";

/**
 * The rows an athlete has not logged yet.
 *
 * Until this existed the logger held exactly one unconfirmed row for the whole
 * session, so there was no way to write down the next set -- the programmed
 * 3 x 5, or a back-off at 90% -- before confirming the current one. Now each
 * exercise holds an ordered list of planned rows. The first is the one the
 * confirm square logs; the rest wait behind it, editable, in the order they
 * will be done.
 *
 * Pure, so the rules (what a new row is prefilled with, what happens after a
 * confirm, how rows are numbered) are tests rather than behaviour that only
 * shows up mid-session.
 */

export interface PlannedRow {
  exerciseId: string;
  /** Generated when the row appears, reused as the Appwrite row id on confirm. */
  clientSetId: string;
  loadKg: number | null;
  reps: number | null;
  rpe: RpeValue | null;
  isWarmup: boolean;
  /**
   * The athlete asked for this row with Add set, or it sits behind one they
   * did. Planned rows survive moving to another exercise; the automatic row
   * that tapping an exercise's name opens does not, which keeps a trail of
   * untouched rows off every exercise.
   */
  planned: boolean;
  /**
   * The prescription line this row answers and its target in words, when the
   * session was started from a prescribed day (Order 22). Stamped once when
   * the row appears; see `prescribeNewRows` in lib/programming/session-plan.
   */
  prescriptionId?: string;
  prescribed?: string;
  /**
   * Why the load is what it is, when the athlete did not type it: "suggested
   * from RPE 7 @ 170". Only ever set by a suggestion the coach's switch let
   * through (Order 28), and cleared the moment the athlete edits the load.
   */
  note?: string | null;
  /**
   * The load is the app's suggestion and the athlete has not touched it. The
   * row shows a "Suggested" marker for as long as this holds. Separate from
   * `note`, which also carries a backoff's provenance and is not a suggestion.
   * Cleared the moment the athlete edits the load.
   */
  suggested?: boolean;
}

export interface LoggedValues {
  loadKg: number;
  reps: number;
}

/**
 * A fresh row: a suggestion when one was let through (rule 2 of the prefill
 * order), otherwise a repeat of the set before it (rule 3).
 *
 * The suggestion arrives already gated -- see suggestion-gate.ts. This never
 * decides whether the athlete may see one; it only ranks what it is given.
 */
export function rowAfter(
  exerciseId: string,
  previous: { loadKg: number | null; reps: number | null } | null,
  newId: () => string,
  planned = false,
  suggestion: Suggestion | null = null,
): PlannedRow {
  const prefill = resolvePrefill({
    suggestion,
    previousSetThisSession:
      previous && previous.loadKg !== null && previous.reps !== null
        ? { loadKg: previous.loadKg, reps: previous.reps }
        : null,
  });
  return {
    exerciseId,
    clientSetId: newId(),
    loadKg: prefill.loadKg,
    reps: prefill.reps,
    // RPE is how that set felt, and the warm-up flag hides work from every
    // total when it sticks -- neither is ever carried into a new row.
    rpe: null,
    isWarmup: false,
    planned,
    ...(prefill.source === "suggested" ? { note: prefill.note, suggested: true } : {}),
  };
}

export const rowsOf = (rows: readonly PlannedRow[], exerciseId: string): PlannedRow[] =>
  rows.filter((row) => row.exerciseId === exerciseId);

/** The row the confirm square belongs to. */
export const headOf = (rows: readonly PlannedRow[], exerciseId: string): PlannedRow | null =>
  rows.find((row) => row.exerciseId === exerciseId) ?? null;

/**
 * Adds a row to the end of an exercise's plan.
 *
 * Prefilled from the row above it -- the last planned row if there is one, the
 * last logged set if not -- so the programmed third set of five is one tap, and
 * a back-off is one number changed. Everything already planned for the
 * exercise is marked planned too: the athlete has committed to that sequence,
 * and it should not vanish if they glance at another lift.
 *
 * The suggestion only counts when nothing is planned, so the new row follows
 * the last logged set directly -- that set is what the engine priced it from.
 * Behind a planned row it would be pricing the wrong set, and the row above is
 * the athlete's own numbers, which a suggestion never overwrites.
 */
export function addRow(
  rows: readonly PlannedRow[],
  exerciseId: string,
  lastLogged: LoggedValues | null,
  newId: () => string,
  suggestion: Suggestion | null = null,
): PlannedRow[] {
  const mine = rowsOf(rows, exerciseId);
  const above = mine.at(-1) ?? lastLogged;
  const marked = rows.map((row) => (row.exerciseId === exerciseId ? { ...row, planned: true } : row));
  return [...marked, rowAfter(exerciseId, above ?? null, newId, true, mine.length === 0 ? suggestion : null)];
}

/**
 * The plan once a row has been logged.
 *
 * The confirmed row leaves. If the exercise still has rows waiting, the next
 * one becomes the head. If it has none, nothing takes its place: confirming
 * means "done", and a fresh row appearing under every tick read as the app
 * adding a set the athlete never asked for. Add set is the one way to get
 * another row, and it carries the prefill and the suggestion this used to.
 */
export function afterConfirm(
  rows: readonly PlannedRow[],
  confirmedId: string,
): { rows: PlannedRow[]; next: PlannedRow | null } {
  const confirmed = rows.find((row) => row.clientSetId === confirmedId);
  const rest = rows.filter((row) => row.clientSetId !== confirmedId);
  if (!confirmed) {
    throw new Error(`afterConfirm: no planned row ${confirmedId}`);
  }
  return { rows: rest, next: headOf(rest, confirmed.exerciseId) };
}

/** Drops a planned row. The athlete changed their mind about a set not yet done. */
export function discardRow(rows: readonly PlannedRow[], clientSetId: string): PlannedRow[] {
  return rows.filter((row) => row.clientSetId !== clientSetId);
}

/**
 * Moving to another exercise.
 *
 * Automatic rows elsewhere are dropped, exactly as the single draft used to
 * be. Rows the athlete planned stay where they are. The exercise being moved
 * to keeps its plan, or gets one fresh row if it has none.
 */
export function focusExercise(
  rows: readonly PlannedRow[],
  exerciseId: string,
  lastLogged: LoggedValues | null,
  newId: () => string,
): { rows: PlannedRow[]; head: PlannedRow } {
  const kept = rows.filter((row) => row.exerciseId === exerciseId || row.planned);
  const head = headOf(kept, exerciseId);
  if (head) return { rows: kept, head };
  const fresh = rowAfter(exerciseId, lastLogged, newId);
  return { rows: [...kept, fresh], head: fresh };
}

/**
 * The number shown on a planned row.
 *
 * Numbering continues from the logged working sets and counts working rows
 * above it in the plan. Warm-ups show W and do not advance it -- the same rule
 * the logged rows follow, so the row labelled 3 is the set both athlete and
 * coach call set 3.
 */
export function plannedIndex(
  loggedWorking: number,
  mine: readonly { isWarmup: boolean }[],
  at: number,
): number | "W" {
  if (mine[at].isWarmup) return "W";
  return loggedWorking + mine.slice(0, at + 1).filter((row) => !row.isWarmup).length;
}

/**
 * The stored set_index for a set about to be written.
 *
 * One past the highest index this exercise has used in the session, rather
 * than one past the count. Once any set can be deleted the count lies: delete
 * set 2 of 4 and "count + 1" hands out 4 again, and the review queue positions
 * a clip by finding its index among its siblings. Gaps are harmless -- every
 * screen numbers by order -- duplicates are not.
 */
export function nextSetIndex(existing: readonly { setIndex?: number }[]): number {
  return existing.reduce((max, set, at) => Math.max(max, set.setIndex ?? at + 1), 0) + 1;
}
