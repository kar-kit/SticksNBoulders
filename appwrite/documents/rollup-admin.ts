import { ID, Query, TablesDB, type Client } from "node-appwrite";
import { rollupFrom, weekStart, type Rollup, type RollupSet } from "@/lib/strength/rollup";
import { writeRollup } from "./write";
import type { RowWriter } from "./row-writer";

/**
 * Rebuilding one weekly rollup, server-side.
 *
 * Here rather than in the route handler for the same reason circle-admin.ts
 * exists: `stats_rollups` is a server-only table, this is the only code that
 * touches it live, and the write helper is the only thing allowed to stamp
 * permissions. A route that reached for TablesDB itself would be a write path
 * outside the helper, which the guard test rejects and should.
 *
 * The arithmetic is not here either -- it is in lib/strength/rollup.ts, shared
 * with the rebuild script, so the live path and the repair path cannot drift
 * apart. This file is only the part that talks to Appwrite.
 *
 * Deliberately NOT re-exported from ./index. It constructs node-appwrite, and
 * the barrel is imported by client code -- the offline queue's runner reaches
 * createSet through it -- so re-exporting this pulls the server SDK into the
 * browser bundle and breaks every athlete screen. circle-admin.ts avoids the
 * same trap by taking a narrow interface instead; this one needs the real
 * client, so it stays off the barrel and the route imports it by path.
 */

/** Sets never reach this in a week for one lift; the cap is a guard, not a page. */
const MAX_SETS_IN_WEEK = 200;

/**
 * A day either side of the week, narrowed exactly in code.
 *
 * week_start is a label -- "the week beginning Monday the 14th" -- while
 * logged_at is an instant, and under BST the London week actually begins at
 * 23:00 UTC the evening before. Rather than invert a timezone offset, this
 * over-fetches by a day and filters with the same weekStart() everything else
 * uses. Correct at any offset, and still one query.
 */
const MARGIN_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * MARGIN_MS;

export interface RollupTables {
  listRows(params: {
    databaseId: string;
    tableId: string;
    queries: string[];
    ttl?: number;
  }): Promise<{ rows: Array<Record<string, unknown>> }>;
  deleteRow(params: { databaseId: string; tableId: string; rowId: string }): Promise<unknown>;
  writer: RowWriter;
}

/** The admin view of the two tables this needs. Constructed here, not by callers. */
export function adminRollupTables(client: Client): RollupTables {
  const db = new TablesDB(client);
  return {
    listRows: (params) => db.listRows(params) as unknown as Promise<{ rows: Array<Record<string, unknown>> }>,
    deleteRow: (params) => db.deleteRow(params),
    writer: {
      createRow: (params) => db.createRow(params),
      updateRow: (params) => db.updateRow(params),
      deleteRow: (params) => db.deleteRow(params),
    },
  };
}

export interface RebuildRollupInput {
  athleteId: string;
  exerciseId: string;
  /** Any instant inside the week to rebuild. */
  loggedAt: Date;
}

export type RebuildResult =
  | { status: "written"; weekStart: Date; rollup: Rollup }
  | { status: "removed"; weekStart: Date }
  | { status: "absent"; weekStart: Date };

/**
 * Recomputes the bucket from its sets and makes the stored row agree.
 *
 * Recomputed rather than adjusted, so it is safe to run twice, safe after an
 * undo, and safe when a retried queue delivers the same set again.
 */
export async function rebuildRollup(
  tables: RollupTables,
  databaseId: string,
  input: RebuildRollupInput,
  now: () => Date = () => new Date(),
): Promise<RebuildResult> {
  const week = weekStart(input.loggedAt);

  const page = await tables.listRows({
    databaseId,
    tableId: "sets",
    queries: [
      Query.equal("athlete_id", input.athleteId),
      Query.equal("exercise_id", input.exerciseId),
      Query.greaterThanEqual("logged_at", new Date(week.getTime() - MARGIN_MS).toISOString()),
      Query.lessThan("logged_at", new Date(week.getTime() + WEEK_MS + MARGIN_MS).toISOString()),
      Query.limit(MAX_SETS_IN_WEEK),
    ],
    // Never a cached read: this recomputes a number from a set written a
    // moment ago, and a stale page would store the total from before it.
    ttl: 0,
  });

  const sets: RollupSet[] = page.rows
    .filter((row) => {
      const at = new Date(String(row.logged_at));
      return !Number.isNaN(at.getTime()) && weekStart(at).getTime() === week.getTime();
    })
    .map((row) => ({
      loadKg: Number(row.load_kg) || 0,
      reps: Number(row.reps) || 0,
      isWarmup: row.is_warmup === true,
      e1rmKg: typeof row.e1rm_kg === "number" ? row.e1rm_kg : null,
    }));

  const computed = rollupFrom(sets);

  const existing = await tables.listRows({
    databaseId,
    tableId: "stats_rollups",
    queries: [
      Query.equal("athlete_id", input.athleteId),
      Query.equal("exercise_id", input.exerciseId),
      Query.equal("week_start", week.toISOString()),
      Query.limit(1),
    ],
    ttl: 0,
  });
  const rowId = typeof existing.rows[0]?.$id === "string" ? (existing.rows[0].$id as string) : undefined;

  // Every working set of the week gone. The rollup goes with them rather than
  // sitting in the chart claiming a week happened: a row of zeroes is not the
  // same statement as no row.
  if (computed.setCount === 0) {
    if (rowId) {
      await tables.deleteRow({ databaseId, tableId: "stats_rollups", rowId });
      return { status: "removed", weekStart: week };
    }
    return { status: "absent", weekStart: week };
  }

  await writeRollup(
    { writer: tables.writer, databaseId, newId: () => ID.unique(), now },
    { athleteId: input.athleteId, exerciseId: input.exerciseId, weekStart: week, ...computed, rowId },
  );
  return { status: "written", weekStart: week, rollup: computed };
}
