import { browserAppwrite } from "@/appwrite/browser-client";
import { POSTER_BUCKET, posterIdFor } from "@/appwrite/documents/poster";
import { VIDEO_BUCKET } from "./bucket";

/**
 * Deleting a clip no set points at any more: the clip of a deleted set, or
 * (F13) a clip the athlete deleted or replaced from their Clips gallery.
 *
 * Run by the queue, behind the set's own delete, which is what makes it safe
 * where `detachClipFromSet` is not: the queue is strictly ordered and stops on
 * a retryable failure, so this only ever runs once that delete has either
 * landed or been refused for good. It checks which before touching the file.
 *
 * - The set is gone: the file is an orphan and goes now, rather than waiting
 *   for `npm run clips:sweep`.
 * - The set is still there and still names this file: its delete was refused
 *   because a coach commented, or the detach behind which this was queued has
 *   not landed, and deleting the file would leave a broken player in front of
 *   the coach. It stays.
 * - The set is still there and names another file, or none (F13): the
 *   athlete deleted this clip or replaced it, and the set's own write -- the
 *   `set.attachVideo` queued in front of this -- has landed. Nothing points
 *   at the file, so it goes, with its poster. A row whose clip column cannot
 *   be read at all is treated as still naming it: unsure keeps the file.
 *
 * A file already gone is what this wanted, so a 404 on the delete is success.
 */

const isNotFound = (error: unknown): boolean => (error as { code?: unknown })?.code === 404;

export async function deleteClipIfUnused(setId: string, fileId: string): Promise<void> {
  if (!setId || !fileId) return;
  const { tables, storage, databaseId } = browserAppwrite();
  try {
    const row = (await tables.getRow({ databaseId, tableId: "sets", rowId: setId })) as {
      video_file_id?: unknown;
    };
    const current = row?.video_file_id;
    // Still this clip, or a row that does not say: keep it.
    if (current === undefined || current === fileId) return;
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
