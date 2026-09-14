/**
 * Rebuilds every weekly rollup from raw sets.
 *
 *   npm run rollups:rebuild              # plans, writes nothing
 *   npm run rollups:rebuild -- --yes     # applies
 *
 * CLAUDE.md requires this to exist alongside the rollups themselves, and it
 * earns that twice over. Rollups are the only aggregates in the product, every
 * chart and PR reads them rather than raw sets, and a wrong one looks exactly
 * like a right one. So there has to be something that can say what the sets
 * actually add up to, and make the stored answer agree.
 *
 * It repairs three things:
 *   - a bucket nothing ever wrote, because the live path was not running yet;
 *   - a bucket that drifted, because a set arrived, was undone, or was fixed;
 *   - a rollup whose sets are all gone, which is left behind by an undo and
 *     would otherwise sit in the chart forever claiming a week happened.
 *
 * It recomputes from scratch rather than adjusting, so running it twice changes
 * nothing the second time. `rebuilt_at` on every row says when it last agreed.
 */
import { ID, Query, TablesDB } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { writeRollup, type RowWriter, type WriteDeps } from "../appwrite/documents";
import { rollupFrom, rollupMatches, weekStart, type RollupSet } from "../lib/strength/rollup";

dedupeSdkWarnings();

const confirmed = process.argv.includes("--yes");
const config = serverAppwriteConfig();
const db = new TablesDB(createServerClient(config));
const PAGE = 100;

// The helper stamps the permissions; this only carries the rows to Appwrite.
const writer: RowWriter = {
  createRow: (params) => db.createRow(params),
  updateRow: (params) => db.updateRow(params),
  deleteRow: (params) => db.deleteRow(params),
};
const deps: WriteDeps = {
  writer,
  databaseId: config.databaseId,
  newId: () => ID.unique(),
  now: () => new Date(),
};

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const str = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * Every row of a table, cursored by id.
 *
 * Cursored rather than offset because sets are being written while this runs,
 * and an offset page skips rows as the table grows underneath it. Stops on an
 * empty page, never a short one.
 */
async function allRows(tableId: "sets" | "stats_rollups"): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  for (;;) {
    const queries = [Query.orderAsc("$id"), Query.limit(PAGE)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const page = await db.listRows({ databaseId: config.databaseId, tableId, queries, ttl: 0 });
    if (page.rows.length === 0) break;
    for (const row of page.rows) rows.push(row as unknown as Record<string, unknown>);
    cursor = page.rows[page.rows.length - 1].$id;
  }
  return rows;
}

console.log(`${confirmed ? "Rebuilding" : "Planning rebuild of"} ${config.endpoint}`);
console.log(`  project ${config.projectId}, database ${config.databaseId}\n`);

const setRows = await allRows("sets");
const rollupRows = await allRows("stats_rollups");

interface Bucket {
  athleteId: string;
  exerciseId: string;
  weekStart: Date;
  sets: RollupSet[];
}

const buckets = new Map<string, Bucket>();
let skipped = 0;

for (const row of setRows) {
  const athleteId = str(row.athlete_id);
  const exerciseId = str(row.exercise_id);
  const loggedAt = new Date(str(row.logged_at));
  const loadKg = num(row.load_kg);
  const reps = num(row.reps);

  // A row missing any of these cannot be placed in a week or counted in one.
  // Skipped and reported rather than guessed at: a rollup is arithmetic, and
  // inventing an input is how a wrong number gets a confident look.
  if (!athleteId || !exerciseId || Number.isNaN(loggedAt.getTime()) || loadKg === null || reps === null) {
    skipped += 1;
    continue;
  }

  const week = weekStart(loggedAt);
  const key = `${athleteId}/${exerciseId}/${week.toISOString()}`;
  const bucket = buckets.get(key) ?? { athleteId, exerciseId, weekStart: week, sets: [] };
  bucket.sets.push({ loadKg, reps, isWarmup: row.is_warmup === true, e1rmKg: num(row.e1rm_kg) });
  buckets.set(key, bucket);
}

const storedByKey = new Map(
  rollupRows.map((row) => [
    `${str(row.athlete_id)}/${str(row.exercise_id)}/${new Date(str(row.week_start)).toISOString()}`,
    row,
  ]),
);

const toCreate: Bucket[] = [];
const toUpdate: Array<{ bucket: Bucket; rowId: string }> = [];
let agreed = 0;

for (const [key, bucket] of buckets) {
  const computed = rollupFrom(bucket.sets);
  const stored = storedByKey.get(key);

  // A week of nothing but warm-ups produces no rollup at all. Storing a row of
  // zeroes would put an empty week on the chart as though it were trained.
  if (computed.setCount === 0) continue;

  if (!stored) {
    toCreate.push(bucket);
    continue;
  }
  const matches = rollupMatches(
    {
      setCount: num(stored.set_count) ?? undefined,
      volumeReps: num(stored.volume_reps) ?? undefined,
      tonnageKg: num(stored.tonnage_kg) ?? undefined,
      bestE1rmKg: num(stored.best_e1rm_kg),
      bestSingleKg: num(stored.best_single_kg),
      bestSingleReps: num(stored.best_single_reps),
    },
    computed,
  );
  if (matches) agreed += 1;
  else toUpdate.push({ bucket, rowId: str(stored.$id) });
}

/** A rollup whose sets have all gone. Left behind by an undo of a whole week. */
const orphans = rollupRows.filter((row) => {
  const key = `${str(row.athlete_id)}/${str(row.exercise_id)}/${new Date(str(row.week_start)).toISOString()}`;
  const bucket = buckets.get(key);
  return !bucket || rollupFrom(bucket.sets).setCount === 0;
});

console.log(`${setRows.length} sets in ${buckets.size} athlete/exercise/week buckets`);
if (skipped) console.log(`  ${skipped} sets skipped as unusable`);
console.log(`${rollupRows.length} rollups stored, ${agreed} already correct`);
console.log(`  ${toCreate.length} to create`);
console.log(`  ${toUpdate.length} to correct`);
console.log(`  ${orphans.length} to remove, because their sets are gone\n`);

for (const { bucket, rowId } of toUpdate.slice(0, 10)) {
  const c = rollupFrom(bucket.sets);
  console.log(`  ${rowId}  ${bucket.exerciseId} ${bucket.weekStart.toISOString().slice(0, 10)} -> ${c.setCount} sets, ${c.tonnageKg} kg`);
}

if (toCreate.length + toUpdate.length + orphans.length === 0) {
  console.log("Nothing to do.");
  process.exit(0);
}
if (!confirmed) {
  console.log("\nNothing written. Re-run with --yes to apply.");
  process.exit(0);
}

let written = 0;
for (const bucket of toCreate) {
  await writeRollup(deps, { ...bucket, ...rollupFrom(bucket.sets) });
  written += 1;
}
for (const { bucket, rowId } of toUpdate) {
  await writeRollup(deps, { ...bucket, ...rollupFrom(bucket.sets), rowId });
  written += 1;
}
for (const row of orphans) {
  await db.deleteRow({ databaseId: config.databaseId, tableId: "stats_rollups", rowId: str(row.$id) });
  written += 1;
}

console.log(`\n${written} rollups written.`);
