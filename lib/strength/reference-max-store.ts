import { Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import type { EstimatedInput, ReferenceMaxEntry, StoredKind } from "./reference-max";

/**
 * Reading an athlete's reference maxes.
 *
 * Two sources by design, and the split is the point. The tested and training
 * maxes are rows somebody entered, so they come from `reference_maxes`. The
 * estimate is an aggregate, so it comes from `stats_rollups` like every other
 * aggregate in this product -- never recomputed here from raw sets, which
 * would be a second implementation of the number the rebuild script repairs.
 *
 * The coach reads through the circle team, so this works unchanged whether the
 * caller is the athlete or their coach, and stops working the moment a link is
 * revoked. There is no branch on who is asking.
 */

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
export async function fetchReferenceMaxes(athleteId: string): Promise<ReferenceMaxEntry[]> {
  const { tables, databaseId } = browserAppwrite();
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
export async function fetchEstimatedMaxes(
  athleteId: string,
): Promise<Map<string, EstimatedInput>> {
  const { tables, databaseId } = browserAppwrite();
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

export interface SetMaxRequest {
  athleteId: string;
  exerciseId: string;
  kind: StoredKind;
  valueKg: number;
  /** Omitted means "from now". */
  effectiveFrom?: Date;
}

/**
 * Sets a max, through the server.
 *
 * Not a browser write, and that is the design rather than an inconvenience:
 * Appwrite constrains who may read a row but not what the row claims, so a
 * client able to create one could create it carrying another athlete's id.
 * The route checks the caller is the athlete or actively coaches them.
 *
 * No UI calls this yet -- the blueprint's "edit / set training max" control
 * belongs with the rest of Athlete View at Order 25. It exists now because the
 * panel and Order 18's prescriptions are meaningless without a way to put a
 * number in, and because the boundary is worth having tested before a screen
 * leans on it.
 */
export async function setReferenceMax(input: SetMaxRequest): Promise<string> {
  const { account } = browserAppwrite();
  const { jwt } = await account.createJWT();

  const response = await fetch("/api/reference-max", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
    body: JSON.stringify({
      athleteId: input.athleteId,
      exerciseId: input.exerciseId,
      kind: input.kind,
      valueKg: input.valueKg,
      effectiveFrom: input.effectiveFrom?.toISOString(),
    }),
  });

  const body = (await response.json().catch(() => ({}))) as { rowId?: string; reason?: string };
  if (!response.ok) {
    // The server's reason when it has one -- "A max over 600kg is a typo" is
    // worth showing; "failed" is not.
    throw new Error(body.reason ?? `could not set max: ${response.status}`);
  }
  return body.rowId ?? "";
}

/** Removes a max. The undo for a typo, and the table's only edit. */
export async function removeReferenceMax(rowId: string): Promise<void> {
  const { account } = browserAppwrite();
  const { jwt } = await account.createJWT();

  const response = await fetch(`/api/reference-max?id=${encodeURIComponent(rowId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${jwt}` },
  });
  if (!response.ok) throw new Error(`could not remove max: ${response.status}`);
}
