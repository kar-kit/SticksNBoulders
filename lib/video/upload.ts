"use client";

import { ID } from "appwrite";
import { enqueue } from "@/lib/offline/client";
import {
  forgetUpload,
  pendingUploads,
  recordAttempt,
  refundAttempt,
  rememberUpload,
} from "./pending-store";
import { uploadResumable } from "./resumable-upload";
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

export { VIDEO_BUCKET } from "./bucket";

/**
 * How many times a clip is retried across app starts before it is abandoned.
 *
 * Five, because the failures this exists for are transient -- a dropped
 * connection, a locked phone -- and anything surviving five separate app
 * launches is broken in a way retrying will not fix. Left in the store
 * forever it would hold tens of megabytes of a phone's quota indefinitely.
 */
export const MAX_UPLOAD_ATTEMPTS = 5;

export type UploadResult =
  | { ok: true; fileId: string }
  | ClipRejection
  /**
   * Did not finish, but the clip is kept on the phone and goes by itself --
   * on the next app start or the next sign-in. Never deleted for this.
   */
  | { ok: false; reason: "pending"; message: string }
  | { ok: false; reason: "failed"; message: string };

const KEPT_MESSAGE = "That clip didn't finish uploading. Your set is saved — it will carry on by itself.";
const SIGNED_OUT_MESSAGE =
  "Your set is saved and the clip is kept on this phone. It will upload once you sign in again.";

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

  // We choose the id rather than letting Appwrite mint one. It is what makes
  // an interrupted upload findable later, because Appwrite uses the file id as
  // the upload id -- verified against the live instance, see docs/video.md.
  const fileId = ID.unique();

  // Remembered BEFORE the first byte moves. An upload the app does not know
  // about cannot be resumed, and the window where it is in flight but
  // unrecorded is exactly the window a phone gets locked or a tab is killed.
  await rememberUpload({
    fileId,
    setId,
    athleteId,
    name: file.name,
    type: file.type,
    size: file.size,
    blob: file,
    startedAt: Date.now(),
    attempts: 1,
  });

  const result = await uploadResumable(
    file,
    { fileId, athleteId, name: file.name },
    { onProgress },
  );

  if (!result.ok) {
    // Kept on a retryable failure so the next app start picks it up; dropped
    // only on a permanent one, because a file the server will never accept
    // should not be retried until the quota fills. An expired session is
    // retryable: the transport already tried one fresh JWT, and what is left
    // is waiting for the athlete to sign in -- which also re-runs the resume.
    if (result.retryable) {
      return {
        ok: false,
        reason: "pending",
        message: result.authExpired ? SIGNED_OUT_MESSAGE : KEPT_MESSAGE,
      };
    }
    await forgetUpload(fileId);
    return { ok: false, reason: "failed", message: result.message };
  }

  await forgetUpload(fileId);
  // Through the queue, like every other row write: the upload is done and must
  // not be repeated just because this one small write did not land.
  await enqueue("set.attachVideo", { setId, videoFileId: fileId });
  return { ok: true, fileId };
}

/**
 * Picks up clips that were mid-flight when the app last stopped.
 *
 * Called on app start. Each one asks the server how far it got and sends only
 * what is missing, so a session interrupted by a locked phone or a dead tab
 * costs seconds rather than the whole file.
 *
 * Deliberately quiet: the athlete already saw the set logged, and a clip
 * finishing in the background is not news. Failures stay in the store for the
 * next attempt rather than interrupting whatever they are doing now.
 */
export async function resumeInterruptedUploads(athleteId: string): Promise<{ resumed: number; failed: number }> {
  // Only this athlete's. On a shared phone the last athlete's clip would
  // otherwise upload under the next one's session; it waits for its owner.
  const pending = (await pendingUploads()).filter((entry) => entry.athleteId === athleteId);
  let resumed = 0;
  let failed = 0;

  for (const entry of pending) {
    if (entry.attempts >= MAX_UPLOAD_ATTEMPTS) {
      // Something about this file is wrong in a way retrying will not fix.
      // Dropped rather than left to occupy quota on a phone forever.
      await forgetUpload(entry.fileId);
      failed += 1;
      continue;
    }

    await recordAttempt(entry.fileId);
    const result = await uploadResumable(entry.blob, {
      fileId: entry.fileId,
      athleteId: entry.athleteId,
      name: entry.name,
    });

    if (result.ok) {
      await forgetUpload(entry.fileId);
      await enqueue("set.attachVideo", { setId: entry.setId, videoFileId: entry.fileId });
      resumed += 1;
    } else {
      if (!result.retryable) await forgetUpload(entry.fileId);
      // Being signed out says nothing about the file. Counted, five app starts
      // without a session would abandon a clip the server never refused.
      if (result.authExpired) await refundAttempt(entry.fileId);
      failed += 1;
    }
  }

  return { resumed, failed };
}

/**
 * Removes a clip from a set.
 *
 * The row is cleared through the queue. The file is deliberately NOT deleted
 * here, and the ordering is the reason: the clear is queued, so on a bad
 * connection it may not land for minutes. Deleting the file immediately would
 * leave the row pointing at a file that is gone -- a broken player in the
 * coach's review queue -- which is exactly the state this is meant to avoid.
 * Doing it the other way round is impossible without the queue telling us when
 * the write landed, which it does not.
 *
 * So the file is left behind, and reclaiming it is a sweep over files no set
 * references. An orphan is a storage bill; a broken player is a coach losing
 * trust in the review queue, and between the two this picks the bill.
 */
export async function detachClipFromSet(setId: string): Promise<void> {
  await enqueue("set.attachVideo", { setId, videoFileId: null });
}
