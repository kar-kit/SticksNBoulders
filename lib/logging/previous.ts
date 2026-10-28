import { resolvePrefill } from "./prefill";
import type { PlannedRow } from "./plan";
import { isCardioSet, type CardioValues } from "./cardio";

/**
 * "Previous": what the athlete did on this exercise last time, set by set,
 * beside the set they are about to do (the Strong column athletes asked for).
 *
 * Pure. The read lives in exercise-history-store.ts and the cache in
 * use-exercise-history.ts; this decides which session counts as "last time",
 * which earlier set sits beside which row, and what a blank row defaults to
 * (rule 4 of the prefill order).
 */

/** One set as read back from Appwrite for this purpose. A cardio set (F23) carries its duration and level. */
export interface HistorySet extends CardioValues {
  sessionId: string;
  clientSetId: string;
  /** The stored ordinal. Null when the row had none worth trusting. */
  setIndex: number | null;
  loadKg: number;
  reps: number;
  rpe: number | null;
  isWarmup: boolean;
  /** F19: the athlete missed it. Absent reads as false. */
  failed?: boolean;
  loggedAt: Date;
  /** Stored at write time; null when the set had no honest estimate. */
  e1rmKg: number | null;
}

/**
 * What one earlier set was, as shown beside a row.
 *
 * A failed set (F19) stays in the list, in its place, and carries the flag:
 * hiding it would shift every later set of last time onto the wrong row, and
 * "you missed this last week" is exactly what an athlete loading the bar
 * wants to see. The row shows it as `PREV 200 × 0 · failed`.
 */
export interface PreviousSet extends CardioValues {
  loadKg: number;
  reps: number;
  isWarmup: boolean;
  /** Absent reads as false: every set before v19, and the device cache's older entries. */
  failed?: boolean;
  // A cardio set last time (F23) keeps its duration and level here, so the
  // row shows `PREV 20 min · level 8` rather than a 0 x 0 that never happened.
}

/**
 * The sets of the most recent earlier session that trained this exercise, in
 * the order they were done.
 *
 * "Most recent" is the session of the newest set, not the newest session row:
 * an athlete who skipped bench on Tuesday still sees Friday's bench. Sets of
 * `currentSessionId` never count, whatever their timestamps say, so the
 * session being logged can never be its own "last time".
 */
export function previousSessionSets(
  history: readonly HistorySet[],
  currentSessionId: string | null = null,
): PreviousSet[] {
  const earlier = history.filter((set) => set.sessionId !== currentSessionId);
  if (earlier.length === 0) return [];
  const newest = earlier.reduce((a, b) => (b.loggedAt.getTime() > a.loggedAt.getTime() ? b : a));
  return earlier
    .filter((set) => set.sessionId === newest.sessionId)
    .sort((a, b) => {
      // Order done, which is logged_at. set_index only breaks a tie: it can
      // have gaps after a delete, and a set re-flagged as a warm-up keeps it.
      const byTime = a.loggedAt.getTime() - b.loggedAt.getTime();
      if (byTime !== 0) return byTime;
      return (a.setIndex ?? Number.MAX_SAFE_INTEGER) - (b.setIndex ?? Number.MAX_SAFE_INTEGER);
    })
    .map(({ loadKg, reps, isWarmup, failed, durationSeconds, level }) => ({
      loadKg,
      reps,
      isWarmup,
      ...(failed ? { failed: true } : {}),
      ...(isCardioSet({ durationSeconds, level }) ? { durationSeconds: durationSeconds ?? null, level: level ?? null } : {}),
    }));
}

/**
 * Which earlier set sits beside each row.
 *
 * Warm-ups line up with warm-ups and working sets with working sets, each
 * counted per exercise: the third working row is set against last time's
 * third working set however many warm-ups either session did. Counting per
 * exercise is what makes a swapped variant honest -- Barbell Row sets logged
 * before a swap read Barbell Row's last time, the Dumbbell Row rows after it
 * read Dumbbell Row's, each numbered from its own first set.
 *
 * `rows` is the block in display order: logged sets, then rows not logged
 * yet. A row past the end of last time's list gets null, the same as an
 * exercise never trained before or one whose history could not be read.
 */
export function alignPrevious(
  rows: readonly { exerciseId: string; isWarmup: boolean }[],
  previousOf: (exerciseId: string) => readonly PreviousSet[] | null | undefined,
): (PreviousSet | null)[] {
  const seen = new Map<string, { warmup: number; working: number }>();
  return rows.map((row) => {
    const count = seen.get(row.exerciseId) ?? { warmup: 0, working: 0 };
    seen.set(row.exerciseId, count);
    const at = row.isWarmup ? count.warmup++ : count.working++;
    const previous = previousOf(row.exerciseId);
    if (!previous) return null;
    return previous.filter((set) => set.isWarmup === row.isWarmup)[at] ?? null;
  });
}

/**
 * Rule 4 of the prefill order: a row with nothing better to start from takes
 * last session's numbers.
 *
 * Only rows that are still blank are filled, so nothing the athlete typed and
 * nothing a higher rule supplied is ever overwritten:
 *
 * - not touched by hand, not a warm-up (the ramp is the athlete's), not a
 *   prescribed row (rule 1 owns those, and an RPE-only line's missing load
 *   is for the engine to fill after the first set, per the blueprint);
 * - no load and no reps at all. A row with either came from rule 1, 2 or 3.
 *
 * It runs again when last time's sets arrive after the row did (they are read
 * in the background), so the first row of a free exercise still fills in.
 * Each row takes the set it lines up with, or last time's final working set
 * when this session goes further than that one did.
 *
 * A failed set last time (F19) gives its load and not its reps: the reps
 * stored on a miss are what the athlete managed, not what they set out to
 * do, and prefilling "200 × 0" would hand them a row that cannot be logged
 * as a made set. The athlete types the reps; the Previous line beside the
 * row says what happened.
 */
export function fillFromLastSession(
  rows: readonly PlannedRow[],
  exerciseId: string,
  previous: readonly PreviousSet[],
  loggedWorking: number,
): PlannedRow[] {
  const working = previous.filter((set) => !set.isWarmup);
  if (working.length === 0) return rows as PlannedRow[];

  let position = loggedWorking;
  let changed = false;
  const next = rows.map((row) => {
    if (row.exerciseId !== exerciseId) return row;
    if (row.isWarmup) return row;
    const at = position++;
    if (row.touched || row.prescriptionId || row.loadKg !== null || row.reps !== null) return row;
    const last = working[at] ?? working[working.length - 1];
    // F23: last time was cardio, so the row takes its duration and level --
    // the same one-tap repeat a strength row gets -- and never its 0 x 0.
    if (isCardioSet(last)) {
      if (row.durationSeconds != null || row.level != null) return row;
      changed = true;
      return { ...row, durationSeconds: last.durationSeconds ?? null, level: last.level ?? null };
    }
    const prefill = resolvePrefill({ sameExerciseLastSession: { loadKg: last.loadKg, reps: last.reps } });
    if (prefill.source !== "last-session") return row;
    changed = true;
    // No note: the Previous line under the row already says where it came from.
    return { ...row, loadKg: prefill.loadKg, reps: last.failed ? null : prefill.reps };
  });
  return changed ? next : (rows as PlannedRow[]);
}
