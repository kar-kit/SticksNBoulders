import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BACKUP_FORMAT_VERSION, type Backup, type BackupTable } from "./types";

/**
 * A backup on disk.
 *
 * One directory per dump, one JSON file per table, so a human can open the one
 * table they care about without loading the lot, and so a diff between two
 * dumps is readable. Pretty-printed for the same reason: this file is read by
 * someone having a bad day.
 */

export const MANIFEST = "manifest.json";

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

  const tables: BackupTable[] = [];
  for (const entry of manifest.tables) {
    tables.push(await read<BackupTable>(join("tables", `${entry.id}.json`)));
  }

  return {
    manifest,
    tables,
    users: await read<Backup["users"]>("users.json"),
    teams: await read<Backup["teams"]>("teams.json"),
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

export { BACKUP_FORMAT_VERSION };
