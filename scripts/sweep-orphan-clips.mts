/**
 * Finds clips no set points at, and deletes them only when told to.
 *
 *   npm run clips:sweep                          # lists orphans, deletes nothing
 *   npm run clips:sweep -- --min-age-days 21     # a longer grace period
 *   npm run clips:sweep -- --delete              # deletes them
 *
 * A dry run by default, the same contract as appwrite:reset and
 * appwrite:restore. `--delete` additionally refuses unless the newest dump
 * under SNB_BACKUP_DIR is fresh and holds every orphan byte for byte -- so a
 * clip this deletes is always one appwrite:restore can bring back, for as long
 * as the backup retention keeps that dump.
 *
 * What counts as an orphan, and every case that does not, is in
 * appwrite/backup/orphans.ts. docs/backups.md has the operator's version.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AppwriteException, Storage, TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { pageThrough, PAGE_SIZE, reconcile } from "../appwrite/backup/dump";
import { listBucket, type SourceFile } from "../appwrite/backup/bucket";
import { FILE_STORE, MANIFEST, listBackups, readFileList, verifyBlobs } from "../appwrite/backup/files";
import {
  CLIP_REFERENCES,
  DAY_MS,
  DEFAULT_MIN_AGE_DAYS,
  MIN_AGE_FLOOR_DAYS,
  classify,
  clearForDeletion,
  referencesIn,
  stillOrphaned,
  type ClipReference,
  type CoveringDump,
} from "../appwrite/backup/orphans";
import { deleteOrphanClip } from "../appwrite/documents/clip-admin";
import { appwriteBucketSource, appwriteClipStore, appwriteSource } from "./backup-driver";

dedupeSdkWarnings();

const args = process.argv.slice(2);
const KNOWN = new Set(["--delete", "--min-age-days"]);
for (const [i, arg] of args.entries()) {
  // A mistyped --delete must not quietly become a dry run that looks like a
  // run, and a mistyped age must not quietly become the default.
  if (arg.startsWith("--") && !KNOWN.has(arg)) {
    console.error(`Unknown option ${arg}.`);
    process.exit(1);
  }
  if (!arg.startsWith("--") && args[i - 1] !== "--min-age-days") {
    console.error(`Unexpected argument ${arg}.`);
    process.exit(1);
  }
}

const deleting = args.includes("--delete");
const ageAt = args.indexOf("--min-age-days");
const minAgeDays = ageAt === -1 ? DEFAULT_MIN_AGE_DAYS : Number(args[ageAt + 1]);
if (!Number.isInteger(minAgeDays) || minAgeDays < MIN_AGE_FLOOR_DAYS) {
  console.error(
    `--min-age-days needs a whole number of days, at least ${MIN_AGE_FLOOR_DAYS}. ` +
      `Below that, an athlete who resumes an upload after a few days away can lose the clip.`,
  );
  process.exit(1);
}

const root = process.env.SNB_BACKUP_DIR ?? ".appwrite-backup";
const config = serverAppwriteConfig();
const client = createServerClient(config);
const storage = new Storage(client);

const rows = appwriteSource(new TablesDB(client), new Users(client), new Teams(client), {
  databaseId: config.databaseId,
  tableIds: [...new Set(CLIP_REFERENCES.map((r) => r.tableId))],
});
const buckets = appwriteBucketSource(storage, {
  endpoint: config.endpoint,
  projectId: config.projectId,
  apiKey: config.apiKey,
  bucketIds: [...new Set(CLIP_REFERENCES.map((r) => r.bucketId))],
});

/**
 * Every clip reference in the instance, paged and reconciled like a dump. A
 * short read here is the one failure that turns a referenced clip into an
 * "orphan", so it throws rather than returns what it has.
 */
async function allReferences(): Promise<ClipReference[]> {
  const found: ClipReference[] = [];
  for (const tableId of rows.tableIds()) {
    const { items, expected } = await pageThrough(
      async (cursor) => {
        const page = await rows.rowPage(tableId, cursor, PAGE_SIZE);
        return { total: page.total, items: page.rows };
      },
      (row) => row.$id,
      `table ${tableId}`,
    );
    reconcile(`table ${tableId}`, items.length, expected);
    found.push(...referencesIn(tableId, items));
  }
  return found;
}

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;
const days = (file: SourceFile, now: Date) =>
  `${Math.floor((now.getTime() - Math.max(Date.parse(file.$createdAt), Date.parse(file.$updatedAt))) / DAY_MS)}d`;

console.log(`${deleting ? "Sweeping" : "Dry run:"} orphaned clips on ${config.endpoint}`);
console.log(`  project ${config.projectId}, minimum age ${minAgeDays} days\n`);

// Files first, then references. A clip attached while this runs is then seen
// as referenced; the other order would see the file and miss the reference.
const files: SourceFile[] = [];
for (const bucketId of buckets.bucketIds()) files.push(...(await listBucket(buckets, bucketId)));
const references = await allReferences();

const now = new Date();
const plan = classify(files, references, now, minAgeDays * DAY_MS);

console.log(`  ${files.length} file(s), ${plan.referenced} referenced by a set`);
console.log(`  ${plan.uploading.length} still uploading (never swept)`);
console.log(`  ${plan.tooYoung.length} unreferenced but younger than ${minAgeDays} days (left alone)`);
if (plan.dangling.length > 0) {
  // Not acted on: deleting is the only thing this script does, and a row
  // pointing at nothing is not a file. Worth knowing about, though.
  console.log(`  ${plan.dangling.length} set(s) point at a clip the bucket does not hold:`);
  for (const ref of plan.dangling) console.log(`    ${ref.tableId}/${ref.rowId} -> ${ref.fileId}`);
}

console.log(`\n  ${plan.orphans.length} orphan(s), ${mb(plan.reclaimableBytes)} reclaimable:`);
for (const file of plan.orphans) {
  console.log(`    ${file.bucketId}/${file.$id}  ${mb(file.sizeOriginal).padStart(9)}  ${days(file, now)} old`);
}

if (plan.orphans.length === 0) {
  console.log("\nNothing to sweep.");
  process.exit(0);
}

// The coverage check runs on a dry run too, so the answer to "would --delete
// go ahead?" is known before anyone types it.
const newest = (await listBackups(root)).at(-1);
let dump: CoveringDump | null = null;
if (newest) {
  const dir = join(root, newest);
  const manifest = JSON.parse(await readFile(join(dir, MANIFEST), "utf8"));
  dump = {
    name: newest,
    formatVersion: manifest.formatVersion,
    takenAt: manifest.takenAt,
    files: await readFileList(dir),
  };
}

const store = join(root, FILE_STORE);
const clearance = await clearForDeletion(plan.orphans, dump, now, async (file) => {
  const [problem] = await verifyBlobs(store, [file]);
  return problem ?? null;
});

if (!clearance.ok) {
  console.log(`\n${deleting ? "Refusing to delete" : "--delete would refuse"}: the backup does not cover every orphan.`);
  for (const reason of clearance.reasons) console.log(`  ${reason}`);
  if (deleting) {
    console.error("\nNothing was deleted.");
    process.exit(1);
  }
  process.exit(0);
}

console.log(`\nEvery orphan is held, hash-checked, in ${dump?.name}.`);

if (!deleting) {
  console.log("Nothing deleted. Re-run with --delete to remove the orphans above.");
  process.exit(0);
}

// References again, after the slow part. Anything attached since the first
// read is kept.
const cleared = stillOrphaned(clearance.cleared, await allReferences());
const spared = clearance.cleared.length - cleared.length;
if (spared > 0) console.log(`  ${spared} clip(s) were attached during the sweep and are kept.`);

const clips = appwriteClipStore(storage);
let deleted = 0;
let gone = 0;
for (const orphan of cleared) {
  try {
    await deleteOrphanClip(clips, orphan);
    deleted += 1;
    console.log(`  deleted  ${orphan.bucketId}/${orphan.$id}`);
  } catch (error) {
    if (error instanceof AppwriteException && error.code === 404) {
      gone += 1;
      continue;
    }
    // Stop, rather than press on through a failure nobody has looked at.
    console.error(`\nStopped at ${orphan.bucketId}/${orphan.$id}: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`${deleted} deleted before the failure.`);
    process.exit(1);
  }
}

console.log(`\nDeleted ${deleted} clip(s)${gone > 0 ? `, ${gone} already gone` : ""}.`);
console.log(`Each is recoverable from ${dump?.name} with appwrite:restore while that dump is kept.`);
