"use client";

import { Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import { authenticRows } from "@/appwrite/documents";
import { enqueue } from "@/lib/offline/client";
import type { ClipSet } from "@/lib/review/queue";
import { toClip, type SetRow } from "@/lib/review/queue-store";
import { forgetUpload, pendingUploads } from "./pending-store";
import { detachClipFromSet } from "./upload";

/**
 * Reading and changing the athlete's own clips (F13).
 *
 * **Own clips only, on every path.** The athlete reads `sets` through their
 * own session, and that session can read more than their own rows: a coach
 * who also trains is a member of every athlete's circle team, so Appwrite
 * would hand them their athletes' sets too. So every read filters on
 * `athlete_id`, keeps only rows the athlete authored (`authenticRows`), and
 * checks the owner again after parsing. The playback ticket carries identity,
 * not authority (lib/video/ticket.ts), so this filter, not the clip route, is
 * what keeps somebody else's clip out of this screen.
 *
 * **Paged on the server.** Newest first on `logged_at`, which
 * `idx_athlete_logged` serves; with a lift chosen, `idx_athlete_exercise`
 * serves the same order. A cursor walks back from there, a page at a time, so
 * an athlete with a year of clips downloads one page of rows, and the
 * thumbnails only as they come near the screen (ClipThumb).
 */

/** Three rows of a three-column grid, four times over: a fortnight of top sets. */
export const CLIP_PAGE = 36;

export interface ClipPage {
  clips: ClipSet[];
  /** Pass back for the next, older page. Null when this was the last. */
  cursor: string | null;
}

export interface ClipPageRequest {
  athleteId: string;
  /** Only this lift's clips. Null or absent for every lift. */
  exerciseId?: string | null;
  cursor?: string | null;
  limit?: number;
}

function ownClips(rows: Array<{ $id: string }>, athleteId: string): ClipSet[] {
  return authenticRows("sets", rows)
    .map((row) => toClip(row as unknown as SetRow))
    .filter((clip): clip is ClipSet => clip !== null && clip.athleteId === athleteId);
}

export async function fetchMyClips({
  athleteId,
  exerciseId = null,
  cursor = null,
  limit = CLIP_PAGE,
}: ClipPageRequest): Promise<ClipPage> {
  if (!athleteId) return { clips: [], cursor: null };
  const { tables, databaseId } = browserAppwrite();
  const queries = [
    Query.equal("athlete_id", athleteId),
    Query.isNotNull("video_file_id"),
    Query.orderDesc("logged_at"),
    Query.limit(limit),
  ];
  if (exerciseId) queries.push(Query.equal("exercise_id", exerciseId));
  if (cursor) queries.push(Query.cursorAfter(cursor));

  const page = await tables.listRows({ databaseId, tableId: "sets", queries });
  const rows = page.rows as Array<{ $id: string }>;
  // The cursor is the last row READ, not the last one kept: a page whose
  // tail was a forged or unplaceable row must still move on past it.
  const next = rows.length === limit ? rows[rows.length - 1].$id : null;
  return { clips: ownClips(rows, athleteId), cursor: next };
}

/**
 * One clip by its set id, or null when it is not this athlete's, has no clip,
 * or does not exist. The three read the same on purpose: a deep link to
 * somebody else's set learns nothing about it.
 */
export async function fetchMyClip(athleteId: string, setId: string): Promise<ClipSet | null> {
  if (!athleteId || !setId) return null;
  const { tables, databaseId } = browserAppwrite();
  const page = await tables.listRows({
    databaseId,
    tableId: "sets",
    queries: [Query.equal("$id", setId), Query.equal("athlete_id", athleteId), Query.limit(1)],
  });
  return ownClips(page.rows as Array<{ $id: string }>, athleteId).find((clip) => clip.id === setId) ?? null;
}

/**
 * Deletes a clip from a set, and the file with it.
 *
 * Two queued ops, in this order. The detach clears the set's clip columns,
 * which is what takes the clip out of the coach's queue and Athlete View.
 * Then `clip.delete` removes the file and its poster, but only once the set
 * no longer names it (lib/video/clip-cleanup.ts): the queue is strictly
 * ordered, so the file is never gone while a row still points at it. A
 * detach alone would leave the file readable to anyone already holding its
 * id, which is not what "delete" promises somebody who would rather not
 * share a clip (docs/video.md, Permissions).
 *
 * A replacement still uploading for this set (kept in IndexedDB on gym wifi)
 * is forgotten first: left, `resumeInterruptedUploads` would finish it on
 * the next app start and attach it, putting a clip back in front of the
 * coach after the athlete deleted it.
 *
 * The set, its numbers, its note and any coach comments stay.
 */
export async function deleteMyClip(setId: string, fileId: string): Promise<void> {
  const waiting = (await pendingUploads().catch(() => [])).filter((upload) => upload.setId === setId);
  for (const upload of waiting) await forgetUpload(upload.fileId);
  await detachClipFromSet(setId);
  await enqueue("clip.delete", { setId, fileId });
}

/**
 * After a replacement clip's attach has been queued, the old file goes the
 * same way as a deleted one. Only called once the new clip's attach is in
 * the queue; queued earlier, the cleanup would find the set still naming the
 * old file, keep it, and never be asked again.
 */
export async function retireReplacedClip(setId: string, oldFileId: string): Promise<void> {
  await enqueue("clip.delete", { setId, fileId: oldFileId });
}
