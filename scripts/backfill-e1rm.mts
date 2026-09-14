/**
 * Recomputes e1rm_kg on every set from what the set actually says.
 *
 *   npm run e1rm:backfill              # plans, writes nothing
 *   npm run e1rm:backfill -- --yes     # applies
 *
 * This exists because the formula is not settled. Order 26 revisits it against
 * the RTS chart, and the honest way to ship an unconfirmed number into an
 * athlete's log is to ship the thing that can take it back out again in the
 * same PR. Changing lib/strength/e1rm.ts and re-running this is the whole
 * migration path.
 *
 * It reconciles rather than fills blanks. A set whose estimate has changed is
 * corrected, and a set that is no longer owed one -- a warm-up, an RPE cleared
 * to "not sure", reps edited past the cutoff -- has it cleared. Converging to
 * the current rule is the point; leaving a stale number behind would be the
 * drift this is meant to remove.
 *
 * Safe to re-run forever. It writes only the sets whose value is wrong, so a
 * second run with nothing to do reports nothing to do.
 */
import { Query, TablesDB } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { estimateOneRepMax } from "../lib/strength/e1rm";

dedupeSdkWarnings();

const confirmed = process.argv.includes("--yes");
const config = serverAppwriteConfig();
const db = new TablesDB(createServerClient(config));
const PAGE = 100;

interface SetRow {
  $id: string;
  athlete_id?: unknown;
  load_kg?: unknown;
  reps?: unknown;
  rpe?: unknown;
  is_warmup?: unknown;
  e1rm_kg?: unknown;
}

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

console.log(`${confirmed ? "Backfilling" : "Planning backfill of"} ${config.endpoint}`);
console.log(`  project ${config.projectId}, database ${config.databaseId}\n`);

/**
 * Every set, paged by id.
 *
 * Ordered by $id and cursored rather than offset, because sets are being
 * written while this runs and an offset page would skip rows as the table
 * grows underneath it. Stops on an empty page, never a short one.
 */
const rows: SetRow[] = [];
let cursor: string | null = null;
for (;;) {
  const queries = [Query.orderAsc("$id"), Query.limit(PAGE)];
  if (cursor) queries.push(Query.cursorAfter(cursor));
  const page = await db.listRows({ databaseId: config.databaseId, tableId: "sets", queries, ttl: 0 });
  if (page.rows.length === 0) break;
  for (const row of page.rows) rows.push(row as unknown as SetRow);
  cursor = page.rows[page.rows.length - 1].$id;
}

interface Change {
  row: SetRow;
  from: number | null;
  to: number | null;
}

const changes: Change[] = [];
let agreed = 0;

for (const row of rows) {
  const loadKg = num(row.load_kg);
  const reps = num(row.reps);
  const stored = num(row.e1rm_kg);

  const to =
    loadKg === null || reps === null
      ? null
      : estimateOneRepMax({
          loadKg,
          reps,
          rpe: num(row.rpe),
          isWarmup: row.is_warmup === true,
        });

  if (stored === to) agreed += 1;
  else changes.push({ row, from: stored, to });
}

const added = changes.filter((c) => c.from === null && c.to !== null);
const cleared = changes.filter((c) => c.from !== null && c.to === null);
const corrected = changes.filter((c) => c.from !== null && c.to !== null);

console.log(`${rows.length} sets, ${agreed} already correct`);
console.log(`  ${added.length} to estimate for the first time`);
console.log(`  ${corrected.length} to correct`);
console.log(`  ${cleared.length} to clear, because no estimate is owed\n`);

for (const change of corrected.slice(0, 10)) {
  console.log(`  ${change.row.$id}  ${change.from} -> ${change.to}`);
}
if (corrected.length > 10) console.log(`  ... and ${corrected.length - 10} more`);

if (changes.length === 0) {
  console.log("Nothing to do.");
  process.exit(0);
}

if (!confirmed) {
  console.log("\nNothing written. Re-run with --yes to apply.");
  process.exit(0);
}

/**
 * Written with the admin key and without touching permissions.
 *
 * e1rm_kg is derived from columns already on the row, so this reveals nothing
 * the athlete's own coach could not already read, and passing no permissions
 * leaves the ones stamped at write time exactly as they are.
 */
let written = 0;
for (const change of changes) {
  await db.updateRow({
    databaseId: config.databaseId,
    tableId: "sets",
    rowId: change.row.$id,
    data: { e1rm_kg: change.to },
  });
  written += 1;
  if (written % 100 === 0) console.log(`  ${written}/${changes.length}`);
}

console.log(`\n${written} sets updated.`);
