import { fileKey, isComplete, type SourceFile } from "./bucket";
import type { BackupFile } from "./types";

/**
 * Finding clips no set points at, and deciding whether one may be deleted.
 *
 * Detaching a clip clears the set and leaves the file, on purpose (see
 * lib/video/upload.ts `detachClipFromSet`): an orphan is a storage bill, a
 * broken player is a coach losing trust in the review queue. So are deleting
 * a set, and an attach that never lands because the set went first. This is
 * the sweep docs/video.md promised for all three.
 *
 * Pure, like the rest of appwrite/backup, because deletion is the one thing
 * here that cannot be taken back and every edge of it wants a test that runs
 * without a network.
 */

/**
 * Every column that holds a storage file id, and the bucket it points into.
 *
 * A test checks the schema for any other column named like a file id, so a
 * new one cannot be added without the sweep learning about it -- the failure
 * would be files deleted from under a row the sweep never read.
 *
 * Profile pictures joined at schema v13. Replacing or removing one deletes the
 * old file from the browser, best effort; when that delete fails, the file is
 * an orphan exactly like a detached clip, and this sweep is what reclaims it.
 * The 14-day grace below is far longer than the picture's own race (upload,
 * then repoint, seconds apart), which only makes it safer.
 */
export const CLIP_REFERENCES = [
  { tableId: "sets", column: "video_file_id", bucketId: "set_videos" },
  { tableId: "profiles", column: "avatar_file_id", bucketId: "avatars" },
] as const;

export interface ClipReference {
  bucketId: string;
  tableId: string;
  rowId: string;
  fileId: string;
}

/** The clip references in one table's rows. Tables with no file column yield none. */
export function referencesIn(
  tableId: string,
  rows: ReadonlyArray<{ $id: string; data: Record<string, unknown> }>,
): ClipReference[] {
  const found: ClipReference[] = [];
  for (const ref of CLIP_REFERENCES) {
    if (ref.tableId !== tableId) continue;
    for (const row of rows) {
      const value = row.data[ref.column];
      if (typeof value === "string" && value.trim() !== "") {
        found.push({ bucketId: ref.bucketId, tableId, rowId: row.$id, fileId: value });
      }
    }
  }
  return found;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long an unreferenced file is left alone before it counts as an orphan.
 *
 * The race it covers: the upload finishes, and the attach that names the
 * file is still on its way. Normally that is seconds -- the attach is queued
 * the moment the last chunk lands. The slow case is the athlete who loses
 * signal as the upload completes: the phone does not learn it finished, the
 * clip stays in its resume store, and the attach is only queued on the next
 * app start that has signal (lib/video/upload.ts `resumeInterruptedUploads`).
 * That is the next training day, or the one after a week off.
 *
 * Fourteen days covers a missed week with room over. [Inference] -- nobody has
 * measured how long athletes go between opens; it is the number to revisit.
 */
export const DEFAULT_MIN_AGE_DAYS = 14;

/**
 * The lowest `--min-age-days` the sweep accepts. Below a week, the race above
 * stops being an edge case: an athlete on a three-day split routinely goes
 * four days between opens.
 */
export const MIN_AGE_FLOOR_DAYS = 7;

/**
 * How old the covering backup may be. A nightly dump plus two hours of slack,
 * so a sweep run the afternoon after a 03:15 cron passes, and one run after
 * the cron has quietly stopped does not.
 */
export const FRESH_BACKUP_HOURS = 26;

export interface SweepPlan {
  /** Unreferenced, complete, and old enough. The only files a sweep may delete. */
  orphans: SourceFile[];
  /** Unreferenced and complete, but touched inside the minimum age. */
  tooYoung: SourceFile[];
  /** Upload not finished. Never deleted here; see `classify`. */
  uploading: SourceFile[];
  referenced: number;
  /** Rows naming a file the bucket does not hold. Reported, never acted on. */
  dangling: ClipReference[];
  reclaimableBytes: number;
}

/**
 * Matching is on a folded id: trimmed and lower-cased.
 *
 * Folding can only make a file look referenced when strictly it is not, which
 * keeps it. It can never make a referenced file look orphaned. Whether
 * Appwrite's ids compare case-sensitively depends on the database collation,
 * and a sweep is not the place to find out.
 */
const folded = (bucketId: string, fileId: string) => fileKey(bucketId, fileId.trim().toLowerCase());

/**
 * When the file was last touched, in ms, or null if it cannot be dated.
 *
 * The later of created and updated. [Unverified] that `$updatedAt` moves with
 * every chunk, which would make it the moment an upload resumed days later
 * finished -- when the attach race starts. If it does not, the age runs from
 * the first chunk instead, and the margin in DEFAULT_MIN_AGE_DAYS is what
 * absorbs the difference.
 */
function lastTouched(file: SourceFile): number | null {
  const created = Date.parse(file.$createdAt);
  const updated = Date.parse(file.$updatedAt);
  if (Number.isNaN(created) || Number.isNaN(updated)) return null;
  return Math.max(created, updated);
}

/**
 * Sorts every file in the bucket into kept and deletable.
 *
 * In order, first match wins:
 *
 * 1. Referenced by any row -- kept, however many rows and however old.
 * 2. Still uploading -- kept, always. No set can point at a partial upload
 *    yet, but the athlete's phone may still be sending it; and a partial file
 *    is not something a backup can copy, so no backup could ever cover its
 *    deletion. Uploads abandoned after five attempts stay here too, and are
 *    reported so someone can decide about them.
 * 3. Touched inside `minAgeMs`, or undatable -- kept, and listed.
 * 4. Everything else is an orphan.
 */
export function classify(
  files: readonly SourceFile[],
  references: readonly ClipReference[],
  now: Date,
  minAgeMs: number,
): SweepPlan {
  const referenced = new Set(references.map((r) => folded(r.bucketId, r.fileId)));
  const inBucket = new Set(files.map((f) => folded(f.bucketId, f.$id)));

  const plan: SweepPlan = {
    orphans: [],
    tooYoung: [],
    uploading: [],
    referenced: 0,
    dangling: references.filter((r) => !inBucket.has(folded(r.bucketId, r.fileId))),
    reclaimableBytes: 0,
  };

  for (const file of files) {
    if (referenced.has(folded(file.bucketId, file.$id))) {
      plan.referenced += 1;
      continue;
    }
    if (!isComplete(file)) {
      plan.uploading.push(file);
      continue;
    }
    const touched = lastTouched(file);
    if (touched === null || now.getTime() - touched < minAgeMs) {
      plan.tooYoung.push(file);
      continue;
    }
    plan.orphans.push(file);
    plan.reclaimableBytes += file.sizeOriginal;
  }

  return plan;
}

declare const clearedForDeletion: unique symbol;

/**
 * An orphan a fresh backup has been checked to hold, byte for byte.
 *
 * Only `clearForDeletion` makes one, and the write helper's delete takes
 * nothing else -- so "refuses unless a backup covers it" is a property of the
 * types, not a promise in a comment.
 */
export type ClearedOrphan = Readonly<{
  bucketId: string;
  $id: string;
  sizeOriginal: number;
  /** The dump directory holding the copy. */
  coveredBy: string;
}> & { readonly [clearedForDeletion]: true };

export interface CoveringDump {
  name: string;
  formatVersion: number;
  takenAt: string;
  files: readonly BackupFile[];
}

/**
 * Checks the stored copy of one file. Null when it is whole and matches;
 * otherwise what is wrong with it. Reads the bytes: see verifyBlobs.
 */
export type InspectBlob = (file: BackupFile) => Promise<string | null>;

/**
 * Whether every orphan may be deleted, all or nothing.
 *
 * All or nothing because a partial clearance invites the operator to "just
 * delete the ones that passed", and the ones that failed are failing for a
 * reason the operator has not looked at yet.
 */
export async function clearForDeletion(
  orphans: readonly SourceFile[],
  dump: CoveringDump | null,
  now: Date,
  inspect: InspectBlob,
): Promise<{ ok: true; cleared: ClearedOrphan[] } | { ok: false; reasons: string[] }> {
  if (!dump) return { ok: false, reasons: ["There is no backup to check against. Run npm run appwrite:backup first."] };
  if (dump.formatVersion < 2) {
    return { ok: false, reasons: [`The newest backup, ${dump.name}, predates file backups. Take a new one.`] };
  }
  const takenAt = Date.parse(dump.takenAt);
  const ageHours = (now.getTime() - takenAt) / (60 * 60 * 1000);
  if (Number.isNaN(takenAt) || ageHours > FRESH_BACKUP_HOURS) {
    return {
      ok: false,
      reasons: [
        `The newest backup, ${dump.name}, is ${Number.isNaN(ageHours) ? "undated" : `${Math.floor(ageHours)} hours old`}; ` +
          `the sweep needs one from the last ${FRESH_BACKUP_HOURS}. Run npm run appwrite:backup first.`,
      ],
    };
  }

  // Exact ids here, not folded: coverage has to be the same file, not one
  // that looks like it.
  const held = new Map(dump.files.map((f) => [fileKey(f.bucketId, f.$id), f]));
  const reasons: string[] = [];
  const cleared: ClearedOrphan[] = [];

  for (const file of orphans) {
    const key = fileKey(file.bucketId, file.$id);
    const copy = held.get(key);
    if (!copy) {
      reasons.push(`${key} is not in ${dump.name}.`);
      continue;
    }
    if (copy.sizeOriginal !== file.sizeOriginal) {
      reasons.push(`${key} is ${file.sizeOriginal} bytes live and ${copy.sizeOriginal} in ${dump.name}.`);
      continue;
    }
    const problem = await inspect(copy);
    if (problem) {
      reasons.push(problem);
      continue;
    }
    cleared.push({
      bucketId: file.bucketId,
      $id: file.$id,
      sizeOriginal: file.sizeOriginal,
      coveredBy: dump.name,
    } as ClearedOrphan);
  }

  return reasons.length > 0 ? { ok: false, reasons } : { ok: true, cleared };
}

/**
 * Drops anything a row has started pointing at since the plan was made.
 *
 * Checking coverage reads every byte of every orphan's copy, which takes
 * minutes on a real store. The references are read again after it, so the
 * window in which an attach can land unseen is one listing, not the whole
 * verification.
 */
export function stillOrphaned(
  cleared: readonly ClearedOrphan[],
  references: readonly ClipReference[],
): ClearedOrphan[] {
  const referenced = new Set(references.map((r) => folded(r.bucketId, r.fileId)));
  return cleared.filter((c) => !referenced.has(folded(c.bucketId, c.$id)));
}
