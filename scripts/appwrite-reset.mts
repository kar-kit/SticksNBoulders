/**
 * Deletes the previous product's Appwrite resources so the schema can be
 * applied clean.
 *
 *   npm run appwrite:reset              # lists what would go, deletes nothing
 *   npm run appwrite:reset -- --yes     # actually deletes
 *
 * Auth users are never touched. They are identities, not product data, and
 * deleting them would take Joey's own login with them.
 *
 * Every table is dumped to .appwrite-backup/ before anything is deleted. The
 * data being dropped here belongs to a product that no longer exists, but
 * "irreversible" and "worthless" are different claims and only one of them is
 * ours to make.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Functions, Storage, TablesDB } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { schema } from "../appwrite/schema";

dedupeSdkWarnings();

const confirmed = process.argv.includes("--yes");
dedupeSdkWarnings();

const config = serverAppwriteConfig();
const client = createServerClient(config);
const db = new TablesDB(client);
const storage = new Storage(client);
const functions = new Functions(client);

console.log(`${confirmed ? "Resetting" : "Planning reset of"} ${config.endpoint}`);
console.log(`  project ${config.projectId}, database ${schema.id}\n`);

const databases = await db.list();
const exists = databases.databases.some((d) => d.$id === schema.id);

const tables = exists ? (await db.listTables({ databaseId: schema.id })).tables : [];
const buckets = (await storage.listBuckets()).buckets;
const fns = (await functions.list()).functions;

if (tables.length === 0 && buckets.length === 0 && fns.length === 0) {
  console.log("Nothing to reset.");
  process.exit(0);
}

for (const table of tables) {
  // Row counts make the cost of the delete visible before it happens.
  let rows = "?";
  try {
    rows = String((await db.listRows({ databaseId: schema.id, tableId: table.$id })).total);
  } catch {
    rows = "unreadable";
  }
  console.log(`  table    ${table.$id.padEnd(24)} ${rows} row(s)`);
}
for (const bucket of buckets) console.log(`  bucket   ${bucket.$id}`);
for (const fn of fns) console.log(`  function ${fn.$id}`);

if (!confirmed) {
  console.log(`\n${tables.length} table(s), ${buckets.length} bucket(s), ${fns.length} function(s).`);
  console.log("Nothing deleted. Re-run with --yes to delete.");
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = join(".appwrite-backup", stamp);
await mkdir(backupDir, { recursive: true });
console.log(`\n  dumping to ${backupDir}/`);
for (const table of tables) {
  try {
    const rows = await db.listRows({ databaseId: schema.id, tableId: table.$id });
    await writeFile(
      join(backupDir, `${table.$id}.json`),
      JSON.stringify({ table: table.$id, total: rows.total, rows: rows.rows }, null, 2),
    );
  } catch (error) {
    // A table we cannot read is a table we must not silently destroy.
    throw new Error(`Refusing to delete ${table.$id}: could not dump it (${String(error)})`);
  }
}
await writeFile(
  join(backupDir, "_manifest.json"),
  JSON.stringify(
    {
      endpoint: config.endpoint,
      project: config.projectId,
      database: schema.id,
      takenAt: new Date().toISOString(),
      tables: tables.map((t) => t.$id),
      buckets: buckets.map((b) => b.$id),
      functions: fns.map((f) => f.$id),
    },
    null,
    2,
  ),
);

console.log("");
for (const table of tables) {
  await db.deleteTable({ databaseId: schema.id, tableId: table.$id });
  console.log(`  deleted table ${table.$id}`);
}
for (const bucket of buckets) {
  await storage.deleteBucket({ bucketId: bucket.$id });
  console.log(`  deleted bucket ${bucket.$id}`);
}
for (const fn of fns) {
  await functions.delete({ functionId: fn.$id });
  console.log(`  deleted function ${fn.$id}`);
}
console.log(`\nDone. Dump kept at ${backupDir}/. Auth users were not touched.`);
console.log("Run npm run appwrite:setup next.");
