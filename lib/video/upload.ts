"use client";

import { ID, type UploadProgress } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import { videoPermissions } from "@/appwrite/documents/policy";
import { enqueue } from "@/lib/offline/client";
import { checkClip, type ClipRejection } from "./clip";

/**
 * Getting a clip off a phone and onto a set.
 *
 * The order matters and it is the Set Row spec's: the set is already logged
 * before any of this runs, and the upload is incidental -- "a thin progress
 * line under the row", never a spinner that blocks the athlete from starting
 * the next set.
 *
 * So this is not an offline-queue operation. The queue is a write-ahead log
 * for row mutations, and replaying a 30MB binary through it would mean holding
 * the video in IndexedDB and re-sending it on every retry. The upload either
 * finishes or it does not; what goes through the queue is the small durable
 * fact that follows -- which set now has which file -- so a clip that landed on
 * gym wifi is never lost to a dropped response on the row write.
 *
 * Resume after a dropped connection is Order 31. The groundwork is real: the
 * upload id IS the file id we choose, so a half-finished upload can be found
 * again from state we already hold. See docs/video.md.
 */

export const VIDEO_BUCKET = "set_videos";

export type UploadResult =
  | { ok: true; fileId: string }
  | ClipRejection
  | { ok: false; reason: "failed"; message: string };

export interface UploadOptions {
  /** 0-100, for the progress line under the row. */
  onProgress?: (percent: number) => void;
}

/**
 * Uploads a clip and records it against the set.
 *
 * Rejected before the upload starts wherever possible: an athlete on gym wifi
 * should not wait two minutes to be told the file was the wrong type.
 */
export async function attachClipToSet(
  setId: string,
  athleteId: string,
  file: File,
  { onProgress }: UploadOptions = {},
): Promise<UploadResult> {
  const check = checkClip(file);
  if (!check.ok) return check;

  const { storage } = browserAppwrite();
  // We choose the id rather than letting Appwrite mint one. It is what makes
  // an interrupted upload findable later, because Appwrite uses the file id as
  // the upload id -- verified against the live instance, see docs/video.md.
  const fileId = ID.unique();

  try {
    await storage.createFile({
      bucketId: VIDEO_BUCKET,
      fileId,
      file,
      // Stamped for the athlete and their circle, exactly like the set it
      // belongs to. A video is more revealing than a row of numbers and gets
      // no wider audience than the numbers do.
      permissions: videoPermissions({ athleteId }),
      onProgress: (progress: UploadProgress) => onProgress?.(progress.progress),
    });
  } catch (error) {
    console.error("[video] upload failed", error);
    return {
      ok: false,
      reason: "failed",
      message: "That clip didn't upload. Your set is saved — try attaching it again.",
    };
  }

  // Through the queue, like every other row write: the upload is done and must
  // not be repeated just because this one small write did not land.
  await enqueue("set.attachVideo", { setId, videoFileId: fileId });
  return { ok: true, fileId };
}

/**
 * Removes a clip from a set, and the file with it.
 *
 * The row is cleared first. An orphaned file is a storage bill nobody notices;
 * a row pointing at a file that is gone is a broken player in the coach's
 * review queue, which is worse, so the dangling direction is chosen
 * deliberately rather than by accident of ordering.
 */
export async function detachClipFromSet(setId: string, fileId: string): Promise<void> {
  await enqueue("set.attachVideo", { setId, videoFileId: null });
  try {
    await browserAppwrite().storage.deleteFile({ bucketId: VIDEO_BUCKET, fileId });
  } catch (error) {
    // The row no longer points at it, so the athlete sees the right thing. A
    // file left behind is a cleanup job, not a user-facing failure.
    console.error("[video] could not delete file", error);
  }
}
