/**
 * Dumps the instance to disk.
 *
 *   npm run appwrite:backup                 # writes a new dump
 *   npm run appwrite:backup -- --keep 14    # and prunes to the newest 14
 *
 * Rows with their ids and permissions, users as identities, teams and
 * memberships. Not password hashes, not project settings, not storage files --
 * the manifest says so in the file itself, and docs/backups.md says why.
 *
 * This is not a replacement for a volume-level backup of the Appwrite host.
 * It is the dump that survives a bad migration and can be replayed into any
 * instance, including Cloud in January.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { schema } from "../appwrite/schema";
import { dumpInstance } from "../appwrite/backup/dump";
import { validateBackup } from "../appwrite/backup/restore";
import { backupDirName, listBackups, writeBackup } from "../appwrite/backup/files";
import { appwriteSource } from "./backup-driver";

dedupeSdkWarnings();

const args = process.argv.slice(2);
const keepAt = args.indexOf("--keep");
const keep = keepAt === -1 ? null : Number(args[keepAt + 1]);
if (keepAt !== -1 && (!Number.isInteger(keep) || (keep as number) < 1)) {
  console.error("--keep needs a whole number of dumps to keep, at least 1.");
  process.exit(1);
}

const root = process.env.SNB_BACKUP_DIR ?? ".appwrite-backup";
const config = serverAppwriteConfig();
const client = createServerClient(config);

const source = appwriteSource(new TablesDB(client), new Users(client), new Teams(client), {
  databaseId: config.databaseId,
  tableIds: schema.tables.map((t) => t.id),
});

console.log(`Backing up ${config.endpoint}`);
console.log(`  project ${config.projectId}, database ${config.databaseId}\n`);

const backup = await dumpInstance(source, {
  endpoint: config.endpoint,
  projectId: config.projectId,
  databaseId: config.databaseId,
  schemaVersion: schema.version,
});

const dirName = backupDirName(backup.manifest.takenAt);
const dir = join(root, dirName);
await writeBackup(dir, backup);

for (const table of backup.manifest.tables) {
  console.log(`  table    ${table.id.padEnd(22)} ${table.rows} row(s)`);
}
console.log(`  users    ${backup.manifest.users}`);
console.log(`  teams    ${backup.manifest.teams} (${backup.manifest.memberships} membership(s))`);

// Run the restore's own checks now, while someone is watching, rather than
// during the emergency this dump exists for.
const problems = validateBackup(backup);
if (problems.length > 0) {
  console.log("");
  for (const problem of problems) {
    console.log(`  ${problem.severity === "blocking" ? "BLOCKING" : "warning "}  ${problem.message}`);
  }
}
console.log(`\nWrote ${dir}/`);

// Before pruning, not after. A dump that fails its own validation must never
// be the reason an older, good one is deleted.
const blocking = problems.filter((p) => p.severity === "blocking");
if (blocking.length > 0) {
  console.error(
    `\n${blocking.length} blocking problem(s). This dump would be refused by a restore.`,
  );
  console.error("Nothing was pruned.");
  process.exit(1);
}

if (keep) {
  // listBackups returns only directories with a readable manifest, and the
  // dump just written is excluded outright. Both guards exist because this is
  // the one code path here that deletes data.
  const older = (await listBackups(root)).filter((name) => name !== dirName);
  for (const name of older.slice(0, Math.max(0, older.length + 1 - keep))) {
    await rm(join(root, name), { recursive: true, force: true });
    console.log(`  pruned   ${name}`);
  }
}
console.log("This dump is on the same machine as Appwrite. See docs/backups.md — step 3 is yours.");
