import { Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import { authenticRows } from "@/appwrite/documents";
import { fetchLiftWeeks } from "@/lib/strength/lift-store";
import { priorBests, repBests, type PriorBests } from "@/lib/strength/pr";
import { previousSessionSets, type HistorySet, type PreviousSet } from "./previous";

/**
 * What the Log needs to know about one exercise's past: last time's sets
 * (the Previous line) and the bests to beat (PR badges).
 *
 * Two reads, both on existing indexes, and nothing written:
 *
 * - `sets`: this athlete, this exercise, logged before the session started,
 *   newest first, every page of it. `idx_athlete_exercise` is (athlete_id,
 *   exercise_id, logged_at desc), which is exactly this filter and order.
 *   Warm-ups are included, because Previous lines them up with warm-up rows.
 * - `stats_rollups`, every week of the lift (`fetchLiftWeeks`, the read Lift
 *   Detail already makes, on `idx_athlete_exercise_week`).
 *
 * Every page, not the newest one, because the rep record ("most reps at this
 * load or heavier", lib/strength/pr.ts) has no rollup to lean on: a rep max
 * from two years ago is still the one to beat. What keeps that affordable:
 *
 * - only the columns the Log uses (`Query.select`), no count (`total:
 *   false`), PAGE rows a round trip, so a lift's first 500 sets are the one
 *   request F6 already made;
 * - once per exercise per session, in the background, and the answer is kept
 *   on the device as a few dozen frontier points, not the raw sets
 *   (exercise-history-cache.ts);
 * - capped at MAX_PAGES. A history longer than that is read no further: the
 *   newest sets still give Previous and this week's bests (the rollups give
 *   the rest), and the rep frontier is left unknown rather than built from
 *   half of it, which would call old rep maxes new.
 */

const PAGE = 500;
/** Twenty pages is ten thousand sets of one lift, a decade of squatting three times a week. Past that, stop. */
const MAX_PAGES = 20;

// athlete_id so each row can prove its athlete wrote it
// (appwrite/documents/provenance.ts); the rest is what Previous and the
// bests read. Not notes, prescribed or the video id.
const COLUMNS = [
  "athlete_id",
  "session_id",
  "client_set_id",
  "set_index",
  "load_kg",
  "reps",
  "rpe",
  "is_warmup",
  // v19 (F19): a failed set lines up in Previous with its marker, and is
  // never a best. Selecting it needs the v19 schema on the instance.
  "failed",
  "e1rm_kg",
  "logged_at",
];

export interface ExerciseHistory {
  /** Last session's sets of this exercise, in order. Empty when there is none. */
  previous: PreviousSet[];
  /** Null when the athlete has never logged a working set of it. */
  bests: PriorBests | null;
}

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function toHistorySet(row: Record<string, unknown> & { $id: string }): HistorySet | null {
  const loggedAt = new Date(String(row.logged_at));
  if (Number.isNaN(loggedAt.getTime())) return null;
  if (typeof row.session_id !== "string" || !row.session_id) return null;
  return {
    sessionId: row.session_id,
    clientSetId: typeof row.client_set_id === "string" ? row.client_set_id : row.$id,
    setIndex: num(row.set_index),
    loadKg: num(row.load_kg) ?? 0,
    reps: num(row.reps) ?? 0,
    rpe: num(row.rpe),
    isWarmup: row.is_warmup === true,
    ...(row.failed === true ? { failed: true } : {}),
    loggedAt,
    e1rmKg: num(row.e1rm_kg),
  };
}

export interface SetsBefore {
  /** Newest first. */
  sets: HistorySet[];
  /** Whether that is every set of the lift, back to the first. */
  complete: boolean;
}

/** Every set of this exercise logged before `before`, newest first, up to MAX_PAGES pages. */
export async function fetchSetsBefore(athleteId: string, exerciseId: string, before: Date): Promise<SetsBefore> {
  const { tables, databaseId } = browserAppwrite();
  const sets: HistorySet[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const queries = [
      Query.equal("athlete_id", athleteId),
      Query.equal("exercise_id", exerciseId),
      Query.lessThan("logged_at", before.toISOString()),
      Query.orderDesc("logged_at"),
      Query.select(COLUMNS),
      Query.limit(PAGE),
    ];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const result = await tables.listRows({ databaseId, tableId: "sets", queries, total: false });
    const rows = result.rows as unknown as Array<Record<string, unknown> & { $id: string }>;
    // A row anyone could have written is not a set this athlete lifted.
    for (const row of authenticRows("sets", rows)) {
      const set = toHistorySet(row);
      if (set) sets.push(set);
    }
    if (rows.length < PAGE) return { sets, complete: true };
    cursor = rows[rows.length - 1].$id;
  }
  return { sets, complete: false };
}

/**
 * Both reads, together. Throws if either fails: half an answer would show a
 * Previous line with no badges, then badges appearing later for sets
 * already logged, which reads as the app changing its mind.
 */
export async function fetchExerciseHistory(
  athleteId: string,
  exerciseId: string,
  sessionId: string,
  sessionStart: Date,
): Promise<ExerciseHistory> {
  const [{ sets, complete }, weeks] = await Promise.all([
    fetchSetsBefore(athleteId, exerciseId, sessionStart),
    fetchLiftWeeks(athleteId, exerciseId),
  ]);
  const earlier = sets.filter((set) => set.sessionId !== sessionId);
  const bests = priorBests(weeks, earlier, sessionStart);
  return {
    previous: previousSessionSets(earlier, sessionId),
    bests: bests && { ...bests, repsAt: complete ? repBests(earlier, sessionStart) : null },
  };
}
