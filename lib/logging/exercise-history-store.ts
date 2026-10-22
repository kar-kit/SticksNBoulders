import { Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import { authenticRows } from "@/appwrite/documents";
import { fetchLiftWeeks } from "@/lib/strength/lift-store";
import { priorBests, type PriorBests } from "@/lib/strength/pr";
import { weekStart } from "@/lib/strength/rollup";
import { previousSessionSets, type HistorySet, type PreviousSet } from "./previous";

/**
 * What the Log needs to know about one exercise's past: last time's sets
 * (the Previous line) and the bests to beat (PR badges).
 *
 * Two reads, both on existing indexes, and nothing written:
 *
 * - `sets`: this athlete, this exercise, logged before the session started,
 *   newest first. `idx_athlete_exercise` is (athlete_id, exercise_id,
 *   logged_at desc), which is exactly this filter and order. Warm-ups are
 *   included, because Previous lines them up with warm-up rows.
 * - `stats_rollups`, every week of the lift (`fetchLiftWeeks`, the read Lift
 *   Detail already makes, on `idx_athlete_exercise_week`).
 *
 * The raw page has to reach back past the start of the session's week, or a
 * set from earlier this week would be missing from the bests (that week's
 * rollup is left out on purpose; see lib/strength/pr.ts). One page of
 * PAGE sets nearly always does. If it does not -- more than PAGE sets of one
 * lift earlier this week -- it pages on, capped, rather than guess.
 */

const PAGE = 100;
/** Ten pages is a thousand sets of one lift in one week. Past that, stop. */
const MAX_PAGES = 10;

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
    loggedAt,
    e1rmKg: num(row.e1rm_kg),
  };
}

/** Sets of this exercise logged before `before`, newest first, reaching back past its week's start. */
export async function fetchSetsBefore(athleteId: string, exerciseId: string, before: Date): Promise<HistorySet[]> {
  const { tables, databaseId } = browserAppwrite();
  const thisWeek = weekStart(before).getTime();
  const sets: HistorySet[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const queries = [
      Query.equal("athlete_id", athleteId),
      Query.equal("exercise_id", exerciseId),
      Query.lessThan("logged_at", before.toISOString()),
      Query.orderDesc("logged_at"),
      Query.limit(PAGE),
    ];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const result = await tables.listRows({ databaseId, tableId: "sets", queries });
    const rows = result.rows as unknown as Array<Record<string, unknown> & { $id: string }>;
    // A row anyone could have written is not a set this athlete lifted.
    for (const row of authenticRows("sets", rows)) {
      const set = toHistorySet(row);
      if (set) sets.push(set);
    }
    if (rows.length < PAGE) break;
    // Newest first, so once the page's oldest set is from an earlier week,
    // everything from this week before the session is in hand.
    const oldest = new Date(String(rows[rows.length - 1].logged_at));
    if (Number.isNaN(oldest.getTime()) || weekStart(oldest).getTime() < thisWeek) break;
    cursor = rows[rows.length - 1].$id;
  }
  return sets;
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
  const [sets, weeks] = await Promise.all([
    fetchSetsBefore(athleteId, exerciseId, sessionStart),
    fetchLiftWeeks(athleteId, exerciseId),
  ]);
  const earlier = sets.filter((set) => set.sessionId !== sessionId);
  return {
    previous: previousSessionSets(earlier, sessionId),
    bests: priorBests(weeks, earlier, sessionStart),
  };
}
