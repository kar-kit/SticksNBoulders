import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { APPWRITE_ID, fileKey, type BlobStore } from "./bucket";
import { BACKUP_FORMAT_VERSION, type Backup, type BackupFile, type BackupTable } from "./types";

/**
 * A backup on disk.
 *
 * One directory per dump, one JSON file per table, so a human can open the one
 * table they care about without loading the lot, and so a diff between two
 * dumps is readable. Pretty-printed for the same reason: this file is read by
 * someone having a bad day.
 *
 * File bytes are the exception. They live once, in `files/` beside the dump
 * directories, and each dump's `files.json` says which of them it covers:
 *
 *   <root>/
 *     files/<bucket>/<fileId>          the bytes, shared by every dump
 *     2026-10-07T03-15-00-000Z/
 *       manifest.json  files.json  users.json  teams.json  tables/
 *
 * So copying a dump somewhere means copying `files/` too, and restoring from
 * a copy means restoring from a directory that has `files/` beside it.
 */

export const MANIFEST = "manifest.json";
export const FILE_LIST = "files.json";
export const FILE_STORE = "files";

export function backupDirName(takenAt: string): string {
  return takenAt.replace(/[:.]/g, "-");
}

export async function writeBackup(dir: string, backup: Backup): Promise<void> {
  await mkdir(join(dir, "tables"), { recursive: true });
  const write = (name: string, value: unknown) =>
    writeFile(join(dir, name), `${JSON.stringify(value, null, 2)}\n`);

  for (const table of backup.tables) await write(join("tables", `${table.id}.json`), table);
  await write("users.json", backup.users);
  await write("teams.json", backup.teams);
  await write(FILE_LIST, backup.files);
  // Written last, so a manifest present means the dump finished. A crash
  // half-way leaves a directory that cannot be mistaken for a good backup.
  await write(MANIFEST, backup.manifest);
}

export async function readBackup(dir: string): Promise<Backup> {
  const read = async <T>(name: string): Promise<T> => {
    try {
      return JSON.parse(await readFile(join(dir, name), "utf8")) as T;
    } catch (error) {
      throw new Error(`Cannot read ${join(dir, name)}: ${String(error)}`);
    }
  };

  const manifest = await read<Backup["manifest"]>(MANIFEST);
  if (typeof manifest.formatVersion !== "number") {
    throw new Error(`${join(dir, MANIFEST)} has no formatVersion; this is not a backup.`);
  }
  // A v1 dump predates file backups. Read as holding none, rather than
  // refused: it is still a good dump of everything else.
  const v1 = manifest.formatVersion < 2;
  if (v1) manifest.buckets = [];

  const tables: BackupTable[] = [];
  for (const entry of manifest.tables) {
    tables.push(await read<BackupTable>(join("tables", `${entry.id}.json`)));
  }

  return {
    manifest,
    tables,
    users: await read<Backup["users"]>("users.json"),
    teams: await read<Backup["teams"]>("teams.json"),
    files: v1 ? [] : await read<BackupFile[]>(FILE_LIST),
  };
}

/**
 * Dump directories under `root`, newest last.
 *
 * Only directories holding a readable manifest count. The manifest is written
 * last, so anything without one is a dump that crashed -- and since the caller
 * of this function deletes what it returns, a crashed dump counting toward the
 * retention window would evict a good backup to keep a corpse.
 */
export async function listBackups(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest = JSON.parse(await readFile(join(root, entry.name, MANIFEST), "utf8"));
      if (typeof manifest?.formatVersion === "number") found.push(entry.name);
    } catch {
      // Not a backup. Never ours to delete.
    }
  }
  return found.sort();
}

/**
 * The file store for a dump directory: `files/` beside it. A function rather
 * than a path stored in the manifest, so a dump copied elsewhere with its
 * store still finds it.
 */
export function fileStoreFor(dumpDir: string): string {
  return join(dirname(dumpDir), FILE_STORE);
}

export function blobPath(store: string, bucketId: string, fileId: string): string {
  // Ids reach here from a dump on disk, which anyone could have edited.
  if (!APPWRITE_ID.test(bucketId) || !APPWRITE_ID.test(fileId)) {
    throw new Error(`${JSON.stringify(fileKey(bucketId, fileId))} is not an Appwrite id pair.`);
  }
  return join(store, bucketId, fileId);
}

/** Suffix of a copy still being written. Never mistaken for a blob. */
const PARTIAL = ".partial";

async function sizeOf(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

export async function hashBlob(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * The store on disk.
 *
 * A copy is written beside its final name and renamed into place only once
 * it is whole, so a blob under its own id is always complete -- the same rule
 * as the manifest being written last.
 */
export function diskBlobStore(store: string): BlobStore {
  return {
    size: (bucketId, fileId) => sizeOf(blobPath(store, bucketId, fileId)),

    async put(bucketId, fileId, body, expectedBytes) {
      const path = blobPath(store, bucketId, fileId);
      const partial = `${path}${PARTIAL}`;
      await mkdir(dirname(path), { recursive: true });

      const hash = createHash("sha256");
      let bytes = 0;
      const handle = await open(partial, "w");
      try {
        for await (const chunk of body) {
          hash.update(chunk);
          bytes += chunk.byteLength;
          await handle.write(chunk);
        }
        // On disk before the rename makes it look finished.
        await handle.sync();
      } finally {
        await handle.close();
      }

      if (bytes !== expectedBytes) {
        await rm(partial, { force: true });
        return { ok: false, bytes };
      }
      await rename(partial, path);
      return { ok: true, sha256: hash.digest("hex") };
    },
  };
}

/** A dump's file list. Empty for a v1 dump, which has none. */
export async function readFileList(dir: string): Promise<BackupFile[]> {
  const manifest = JSON.parse(await readFile(join(dir, MANIFEST), "utf8"));
  if (manifest.formatVersion < 2) return [];
  return JSON.parse(await readFile(join(dir, FILE_LIST), "utf8")) as BackupFile[];
}

/**
 * Deletes blobs no kept dump covers, after `--keep` has pruned the dumps.
 *
 * Every kept dump's file list is read before anything goes. If one cannot be
 * read, nothing is deleted: the blobs it covers are unknown, and guessing is
 * how a restore finds its clips missing.
 */
export async function pruneBlobs(
  root: string,
  keptDumps: readonly string[],
): Promise<{ removed: string[] } | { refused: string }> {
  const covered = new Set<string>();
  for (const name of keptDumps) {
    try {
      for (const file of await readFileList(join(root, name))) covered.add(fileKey(file.bucketId, file.$id));
    } catch (error) {
      return { refused: `Cannot read the file list of ${name} (${String(error)}); no blobs were pruned.` };
    }
  }

  const store = join(root, FILE_STORE);
  const removed: string[] = [];
  let buckets;
  try {
    buckets = await readdir(store, { withFileTypes: true });
  } catch {
    return { removed };
  }
  for (const bucket of buckets) {
    if (!bucket.isDirectory()) continue;
    for (const entry of await readdir(join(store, bucket.name), { withFileTypes: true })) {
      if (!entry.isFile() || covered.has(fileKey(bucket.name, entry.name))) continue;
      await rm(join(store, bucket.name, entry.name), { force: true });
      removed.push(fileKey(bucket.name, entry.name));
    }
  }
  return { removed };
}

/**
 * Checks every blob a dump names: present, the right size, the right hash.
 *
 * Reads every byte, so it is slow on a big store, and it is meant to be: it
 * runs before a restore and before the orphan sweep deletes anything, and
 * both are rare and both are irreversible in one direction or the other.
 */
export async function verifyBlobs(store: string, files: readonly BackupFile[]): Promise<string[]> {
  const problems: string[] = [];
  for (const file of files) {
    const path = blobPath(store, file.bucketId, file.$id);
    const size = await sizeOf(path);
    if (size === null) {
      problems.push(`${fileKey(file.bucketId, file.$id)} is not in the file store.`);
    } else if (size !== file.sizeOriginal) {
      problems.push(`${fileKey(file.bucketId, file.$id)} is ${size} bytes in the store; the dump says ${file.sizeOriginal}.`);
    } else if ((await hashBlob(path)) !== file.sha256) {
      problems.push(`${fileKey(file.bucketId, file.$id)} does not match the hash the dump recorded.`);
    }
  }
  return problems;
}

export { BACKUP_FORMAT_VERSION };
