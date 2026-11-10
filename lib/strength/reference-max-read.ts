import { Query } from "appwrite";
import type { EstimatedInput, ReferenceMaxEntry, StoredKind } from "./reference-max";

/**
 * The two reads behind every athlete's maxes, against any reader.
 *
 * Moved out of reference-max-store.ts (F29) so the read API runs the exact
 * loops the app runs, through a reader built on the athlete's own JWT, rather
 * than a second copy that could drift. The browser store passes its session's
 * tables; the API passes a server-side TablesDB on a minted JWT. Neither ever
 * holds the API key.
 *
 * Two sources by design, and the split is the point. The tested and training
 * maxes are rows somebody entered, so they come from `reference_maxes`. The
 * estimate is an aggregate, so it comes from `stats_rollups` like every other
 * aggregate in this product -- never recomputed here from raw sets, which
 * would be a second implementation of the number the rebuild script repairs.
 */

export interface MaxReader {
  listRows(params: {
    databaseId: string;
    tableId: string;
    queries?: string[];
  }): Promise<{ rows: Array<{ $id: string } & Record<string, unknown>> }>;
}

const PAGE = 100;
/** Enough history for the panel and its "previous" line without paging. */
const MAX_ENTRIES = 200;

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function isStoredKind(value: unknown): value is StoredKind {
  return value === "tested" || value === "training";
}

/**
 * The most recent maxes entered for this athlete, across every exercise.
 *
 * Deliberately not filtered by exercise: the panel shows several lifts at once,
 * and one query per lift is several round trips on a screen the build plan
 * holds to 2.5s.
 *
 * Ordered newest first, which matters more than it looks. Appwrite's ids are
 * time-prefixed, so ascending is creation order -- and a cap on an ascending
 * read keeps the OLDEST rows and throws away the newest. A coach setting
 * weekly training maxes across six lifts passes 200 entries inside a year, and
 * the panel would then freeze on stale numbers with no error, taking every
 * percentage resolved against them with it. Descending keeps the end
 * `currentMax` actually reads from.
 */
export async function readReferenceMaxes(
  tables: MaxReader,
  databaseId: string,
  athleteId: string,
): Promise<ReferenceMaxEntry[]> {
  const entries: ReferenceMaxEntry[] = [];
  let cursor: string | null = null;

  while (entries.length < MAX_ENTRIES) {
    const queries = [
      Query.equal("athlete_id", athleteId),
      Query.orderDesc("$id"),
      Query.limit(PAGE),
    ];
    if (cursor) queries.push(Query.cursorAfter(cursor));

    const page = await tables.listRows({ databaseId, tableId: "reference_maxes", queries });
    if (page.rows.length === 0) break;

    for (const row of page.rows) {
      const valueKg = num(row.value_kg);
      // A row missing its number or its kind cannot be placed against a
      // percentage. Skipped rather than defaulted: a guessed max is a wrong
      // weight on a bar.
      if (valueKg === null || !isStoredKind(row.kind)) continue;
      entries.push({
        id: row.$id,
        exerciseId: String(row.exercise_id),
        kind: row.kind,
        valueKg,
        effectiveFrom: String(row.effective_from),
        recordedBy: String(row.recorded_by),
      });
    }

    if (page.rows.length < PAGE) break;
    cursor = page.rows[page.rows.length - 1].$id;
  }

  return entries;
}

/**
 * The best e1RM this athlete has produced on each lift, and the week it came
 * from. Keyed by exercise id.
 *
 * Straight off the rollups, one query for every lift rather than one per lift:
 * the panel shows several at once and the build plan holds coach screens to
 * 2.5s. The best is a maximum across weeks, not the latest week -- a deload
 * does not lower an athlete's estimated max.
 */
export async function readEstimatedMaxes(
  tables: MaxReader,
  databaseId: string,
  athleteId: string,
): Promise<Map<string, EstimatedInput>> {
  const best = new Map<string, EstimatedInput>();
  let cursor: string | null = null;

  for (;;) {
    const queries = [
      Query.equal("athlete_id", athleteId),
      Query.orderAsc("$id"),
      Query.limit(PAGE),
    ];
    if (cursor) queries.push(Query.cursorAfter(cursor));

    const page = await tables.listRows({ databaseId, tableId: "stats_rollups", queries });
    if (page.rows.length === 0) break;

    for (const row of page.rows) {
      const valueKg = num(row.best_e1rm_kg);
      if (valueKg === null || valueKg <= 0) continue;
      const exerciseId = String(row.exercise_id);
      const current = best.get(exerciseId);
      if (!current || valueKg > current.valueKg) {
        best.set(exerciseId, { valueKg, asOf: String(row.week_start) });
      }
    }

    if (page.rows.length < PAGE) break;
    cursor = page.rows[page.rows.length - 1].$id;
  }

  return best;
}
