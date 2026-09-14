/**
 * Reconciles the shared exercise library with lib/exercises/seed.ts.
 *
 *   npm run exercises:seed              # plans, writes nothing
 *   npm run exercises:seed -- --yes     # applies
 *
 * Reconciles rather than inserts, because a global exercise is readable by
 * everyone and writable by nobody -- once seeded, nothing in the app can fix a
 * typo in one. Re-running is how the library gets corrected, so this must stay
 * safe to re-run forever.
 *
 * It never deletes. A library row an athlete has already logged sets against
 * is referenced by exercise_id on every one of those sets, and removing it
 * would leave their history pointing at nothing. Rows no longer in the seed
 * list are reported and left alone.
 */
import { ID, Query, TablesDB } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import {
  createGlobalExercise,
  normaliseExerciseName,
  renameGlobalExercise,
  type RowWriter,
  type WriteDeps,
} from "../appwrite/documents";
import { SEED_EXERCISES } from "../lib/exercises/seed";

dedupeSdkWarnings();

const confirmed = process.argv.includes("--yes");
const config = serverAppwriteConfig();
const client = createServerClient(config);
const db = new TablesDB(client);

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

console.log(`${confirmed ? "Seeding" : "Planning seed of"} ${config.endpoint}`);
console.log(`  project ${config.projectId}, database ${config.databaseId}\n`);

/** Every global row, paged. The library outgrows one page at about 25 entries. */
const existing: Array<{ $id: string; name: string; normalised_name: string }> = [];
let cursor: string | null = null;
for (;;) {
  const queries = [Query.equal("is_global", true), Query.orderAsc("$id"), Query.limit(100)];
  if (cursor) queries.push(Query.cursorAfter(cursor));
  const page = await db.listRows({ databaseId: config.databaseId, tableId: "exercises", queries, ttl: 0 });
  if (page.rows.length === 0) break;
  for (const row of page.rows) {
    existing.push({ $id: row.$id, name: row.name, normalised_name: row.normalised_name });
  }
  cursor = page.rows[page.rows.length - 1].$id;
}

const byNormalised = new Map(existing.map((row) => [row.normalised_name, row]));
const seedKeys = new Set(SEED_EXERCISES.map(normaliseExerciseName));

const toCreate = SEED_EXERCISES.filter((name) => !byNormalised.has(normaliseExerciseName(name)));
const toRename = SEED_EXERCISES.map((name) => ({ name, row: byNormalised.get(normaliseExerciseName(name)) }))
  .filter((pair): pair is { name: string; row: { $id: string; name: string; normalised_name: string } } =>
    Boolean(pair.row) && pair.row!.name !== pair.name,
  );
const orphans = existing.filter((row) => !seedKeys.has(row.normalised_name));

// A duplicate here means two library rows an athlete must choose between
// mid-set, with one lift's history split across both.
const duplicates = existing.filter(
  (row, index) => existing.findIndex((other) => other.normalised_name === row.normalised_name) !== index,
);

for (const name of toCreate) console.log(`  create   ${name}`);
for (const { name, row } of toRename) console.log(`  rename   ${row.name}  ->  ${name}`);
for (const row of orphans) console.log(`  orphan   ${row.name} (not in the seed list, left alone)`);
for (const row of duplicates) console.log(`  DUPLICATE ${row.name} (${row.$id}) shares a normalised name`);

if (toCreate.length === 0 && toRename.length === 0) {
  console.log(`  nothing to do: all ${SEED_EXERCISES.length} seed entries are present and correct`);
}

if (!confirmed) {
  console.log(
    `\n${toCreate.length} to create, ${toRename.length} to rename, ` +
      `${orphans.length} orphan(s), ${existing.length} global row(s) now.`,
  );
  console.log("Nothing written. Re-run with --yes to apply.");
  process.exit(0);
}

console.log("");
for (const name of toCreate) {
  await createGlobalExercise(deps, { name });
  console.log(`  created  ${name}`);
}
for (const { name, row } of toRename) {
  await renameGlobalExercise(deps, { rowId: row.$id, name });
  console.log(`  renamed  ${row.name} -> ${name}`);
}

console.log(`\nDone. ${existing.length + toCreate.length} global exercise(s).`);
if (duplicates.length > 0) {
  console.error(`${duplicates.length} duplicate normalised name(s) need a human. Nothing was deleted.`);
  process.exitCode = 1;
}
