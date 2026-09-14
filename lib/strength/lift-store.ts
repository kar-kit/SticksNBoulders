import { Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import type { WeekPoint } from "./lift";

/**
 * Reading one lift.
 *
 * Two queries, and they are different in kind. The weekly points come from
 * `stats_rollups`, because every aggregate on this screen does -- Appwrite
 * cannot compute one on read, and a second derivation beside the stored one is
 * how the two start disagreeing. The recent-sets list comes from raw sets,
 * which is not an aggregate but a page of rows.
 */

const PAGE = 100;
/** Enough to fill the list several screens deep without paging on open. */
const RECENT_SETS = 40;

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Every week this athlete has trained this lift, oldest first by the caller. */
export async function fetchLiftWeeks(athleteId: string, exerciseId: string): Promise<WeekPoint[]> {
  const { tables, databaseId } = browserAppwrite();
  const points: WeekPoint[] = [];
  let cursor: string | null = null;

  for (;;) {
    const queries = [
      Query.equal("athlete_id", athleteId),
      Query.equal("exercise_id", exerciseId),
      Query.orderAsc("$id"),
      Query.limit(PAGE),
    ];
    if (cursor) queries.push(Query.cursorAfter(cursor));

    const page = await tables.listRows({ databaseId, tableId: "stats_rollups", queries });
    if (page.rows.length === 0) break;

    for (const row of page.rows) {
      const weekStart = new Date(String(row.week_start));
      // A row without a readable week cannot be placed on a chart. Skipped
      // rather than guessed at: one bad row must not move the whole line.
      if (Number.isNaN(weekStart.getTime())) continue;
      points.push({
        weekStart,
        bestE1rmKg: num(row.best_e1rm_kg),
        bestSingleKg: num(row.best_single_kg),
        bestSingleReps: num(row.best_single_reps),
        bestReps: num(row.best_reps),
        bestRepsLoadKg: num(row.best_reps_load_kg),
      });
    }
    cursor = page.rows[page.rows.length - 1].$id;
  }

  return points;
}

export interface LiftSet {
  clientSetId: string;
  loadKg: number;
  reps: number;
  rpe: number | null;
  isWarmup: boolean;
  loggedAt: Date;
}

/**
 * The most recent working sets of this lift, newest first.
 *
 * Warm-ups excluded, which is the rule everywhere else in the product -- they
 * count toward no total, no record and no rollup. Including them here looked
 * defensible until the screen was full: an athlete who warms up twice a session
 * gets a list that is half 60 x 5, and the question this list answers is what
 * they have actually been working at.
 */
export async function fetchRecentSetsFor(athleteId: string, exerciseId: string): Promise<LiftSet[]> {
  const { tables, databaseId } = browserAppwrite();
  const rows = await tables.listRows({
    databaseId,
    tableId: "sets",
    queries: [
      Query.equal("athlete_id", athleteId),
      Query.equal("exercise_id", exerciseId),
      Query.equal("is_warmup", false),
      Query.orderDesc("logged_at"),
      Query.limit(RECENT_SETS),
    ],
  });

  return rows.rows
    .map((row) => {
      const loggedAt = new Date(String(row.logged_at));
      if (Number.isNaN(loggedAt.getTime())) return null;
      return {
        clientSetId: typeof row.client_set_id === "string" ? row.client_set_id : row.$id,
        loadKg: num(row.load_kg) ?? 0,
        reps: num(row.reps) ?? 0,
        rpe: num(row.rpe),
        isWarmup: row.is_warmup === true,
        loggedAt,
      } satisfies LiftSet;
    })
    .filter((set): set is LiftSet => set !== null);
}
