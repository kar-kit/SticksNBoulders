import { browserAppwrite } from "@/appwrite/browser-client";
import { POSTER_BUCKET, posterIdFor } from "@/appwrite/documents/poster";
import { VIDEO_BUCKET } from "./bucket";

/**
 * Deleting the clip of a set that has been deleted.
 *
 * Run by the queue, behind the set's own delete, which is what makes it safe
 * where `detachClipFromSet` is not: the queue is strictly ordered and stops on
 * a retryable failure, so this only ever runs once that delete has either
 * landed or been refused for good. It checks which before touching the file.
 *
 * - The set is gone: the file is an orphan and goes now, rather than waiting
 *   for `npm run clips:sweep`.
 * - The set is still there: its delete was refused because a coach commented,
 *   the clip is still attached to it, and deleting the file would leave a
 *   broken player in front of the coach. It stays.
 *
 * A file already gone is what this wanted, so a 404 on the delete is success.
 */

const isNotFound = (error: unknown): boolean => (error as { code?: unknown })?.code === 404;

export async function deleteClipIfSetGone(setId: string, fileId: string): Promise<void> {
  if (!setId || !fileId) return;
  const { tables, storage, databaseId } = browserAppwrite();
  try {
    await tables.getRow({ databaseId, tableId: "sets", rowId: setId });
    return;
  } catch (error) {
    // Anything but "not found" is a read that failed -- offline, a lapsed
    // session -- and the queue retries it rather than guessing.
    if (!isNotFound(error)) throw error;
  }
  // The poster goes with its clip (F12). Its id is derived from the clip's,
  // so nothing extra had to be queued to know it; most clips filmed before
  // v17 have none, which the 404 covers.
  const posterId = posterIdFor(fileId);
  const doomed = [
    { bucketId: VIDEO_BUCKET, fileId },
    ...(posterId ? [{ bucketId: POSTER_BUCKET, fileId: posterId }] : []),
  ];
  for (const file of doomed) {
    try {
      await storage.deleteFile(file);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
}
