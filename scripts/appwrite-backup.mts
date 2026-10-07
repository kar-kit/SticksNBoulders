/**
 * Dumps the instance to disk, and copies it off the machine.
 *
 *   npm run appwrite:backup                 # writes a new dump
 *   npm run appwrite:backup -- --keep 14    # and prunes to the newest 14
 *
 * Rows with their ids and permissions, users as identities, teams and
 * memberships, and every finished file in every bucket. Not password hashes,
 * not project settings, not uploads still in flight -- the manifest says so in
 * the file itself, and docs/backups.md says why.
 *
 * With SNB_BACKUP_OFFSITE set, the dump and any new clips are then rsynced
 * there. Without it, the dump stays on this machine and the script says so.
 *
 * This is not a replacement for a volume-level backup of the Appwrite host.
 * It is the dump that survives a bad migration and can be replayed into any
 * instance, including Cloud in January.
 */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { Storage, TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { schema } from "../appwrite/schema";
import { dumpInstance } from "../appwrite/backup/dump";
import { dumpBuckets, fileKey } from "../appwrite/backup/bucket";
import { validateBackup } from "../appwrite/backup/restore";
import {
  FILE_STORE,
  backupDirName,
  diskBlobStore,
  listBackups,
  pruneBlobs,
  readFileList,
  writeBackup,
} from "../appwrite/backup/files";
import { OFFSITE_ENV, copyOffsite, type Rsync } from "../appwrite/backup/offsite";
import type { BackupFile } from "../appwrite/backup/types";
import { appwriteBucketSource, appwriteSource } from "./backup-driver";

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

// The newest earlier dump says which clips the store already holds and what
// they hashed to, so only new clips cross the network. If it cannot be read,
// everything is fetched again: slower, never wrong.
const previous = new Map<string, BackupFile>();
const earlier = await listBackups(root);
if (earlier.length > 0) {
  try {
    for (const file of await readFileList(join(root, earlier[earlier.length - 1]))) {
      previous.set(fileKey(file.bucketId, file.$id), file);
    }
  } catch {
    console.log("  note: could not read the previous dump's file list; fetching every clip.\n");
  }
}

const buckets = await dumpBuckets(
  appwriteBucketSource(new Storage(client), {
    endpoint: config.endpoint,
    projectId: config.projectId,
    apiKey: config.apiKey,
    bucketIds: schema.buckets.map((b) => b.id),
  }),
  diskBlobStore(join(root, FILE_STORE)),
  previous,
  (message) => console.log(`  ${message}`),
);
backup.files = buckets.files;
backup.manifest.buckets = buckets.buckets;

const dirName = backupDirName(backup.manifest.takenAt);
const dir = join(root, dirName);
await writeBackup(dir, backup);

for (const table of backup.manifest.tables) {
  console.log(`  table    ${table.id.padEnd(22)} ${table.rows} row(s)`);
}
console.log(`  users    ${backup.manifest.users}`);
console.log(`  teams    ${backup.manifest.teams} (${backup.manifest.memberships} membership(s))`);
for (const bucket of backup.manifest.buckets) {
  console.log(
    `  bucket   ${bucket.id.padEnd(22)} ${bucket.files} file(s), ${(bucket.bytes / 1e6).toFixed(1)} MB` +
      (bucket.incomplete.length > 0 ? `, ${bucket.incomplete.length} still uploading (not copied)` : ""),
  );
}
console.log(`  clips    ${buckets.downloaded} copied, ${buckets.reused} already held`);
if (buckets.vanished.length > 0) {
  console.log(`  clips    ${buckets.vanished.length} deleted while the dump ran: ${buckets.vanished.join(", ")}`);
}

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

  // Clips are shared between dumps, so they go only when no kept dump names
  // them. After the dumps are pruned, never before.
  const blobs = await pruneBlobs(root, await listBackups(root));
  if ("refused" in blobs) console.log(`  note: ${blobs.refused}`);
  else if (blobs.removed.length > 0) console.log(`  pruned   ${blobs.removed.length} clip(s) no kept dump covers`);
}

const destination = process.env[OFFSITE_ENV];
if (!destination) {
  console.log(`\nThis dump is on this machine only. Set ${OFFSITE_ENV} to copy it off; see docs/backups.md.`);
  process.exit(0);
}

/** rsync with no shell, so nothing in a path is ever interpreted. */
const rsync: Rsync = (rsyncArgs) =>
  new Promise((resolve) => {
    const child = spawn("rsync", rsyncArgs, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", (error) => {
      console.error(`  could not run rsync: ${error.message}`);
      resolve(127);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });

// The destination is not printed. It is a place, not a secret, but a log is
// the wrong home for a host name either way.
console.log(`\nCopying to ${OFFSITE_ENV}...`);
const offsite = await copyOffsite(rsync, root, dirName, destination);
if (!offsite.ok) {
  console.error(`Offsite copy FAILED: ${offsite.message}`);
  console.error("The dump above is complete on this machine and nowhere else.");
  process.exit(1);
}
console.log("Copied off the machine.");
