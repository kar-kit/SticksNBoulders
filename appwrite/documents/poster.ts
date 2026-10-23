/**
 * Which poster belongs to which clip, from the ids alone.
 *
 * A clip's poster is a small still of it (F12, schema v17): one frame, ~320px
 * wide, in its own bucket because Appwrite's file previews are image-only and
 * a video file has none. It lives at an id derived from the clip's, never a
 * fresh random one, and that single decision does three jobs:
 *
 *   - **Cleanup needs nothing extra.** Every path that already knows a clip's
 *     id -- deleting a set, replacing a clip, the orphan sweep's backstop --
 *     knows its poster's id too. Nothing had to be threaded through History,
 *     the queue payloads or the logger to delete a poster alongside its clip.
 *   - **Upload is idempotent.** A poster upload retried after a lost response,
 *     a resumed clip, or the backfill run twice all aim at the same id, so the
 *     second attempt is a 409 rather than a second file.
 *   - **A reader can tell a poster that belongs from one that does not.** The
 *     set row names both files, and a reader accepts `video_poster_id` only if
 *     it is the poster of the row's own `video_file_id` (`posterOf`). A poster
 *     left over from a clip that has since been replaced reads as no poster,
 *     rather than showing the coach a frame of the wrong rep. Same idea as the
 *     avatar namespace (appwrite/documents/avatar.ts): a pure check, no request
 *     per thumbnail, which matters on a queue of sixty.
 *
 * Why the column exists at all, if the id is derivable: it says a poster was
 * actually made. Old clips, a frame grab the phone could not do (HEVC on
 * Android, a codec the browser cannot decode) and a poster still in flight all
 * have none, and asking storage per row to find out would be a request per
 * thumbnail on exactly the screens that show many.
 *
 * Squatting. The bucket grants create to every signed-in user, as the clip
 * bucket does, so someone could upload a file at another clip's poster id --
 * but only if they know a clip id, which only the athlete's circle can read
 * (by listing the clip bucket while the clip uploads). The phone starts its
 * poster upload as soon as the clip is picked, and both the phone and the
 * backfill trust a file already at the id only if its permissions are exactly
 * this athlete's poster stamp (lib/video/poster-upload.ts,
 * scripts/clip-posters.ts). A squatted id costs that clip its thumbnail, never
 * shows the squatter's file.
 *
 * Pure. No client, no network.
 */

export const POSTER_BUCKET = "set_video_posters";

/** Appwrite ids stop at 36 characters. */
const MAX_FILE_ID = 36;
const SUFFIX = "_poster";

/**
 * The poster id for a clip, or null when none fits.
 *
 * A clip id from `ID.unique()` is 20 characters, so the poster id is 27. Only a
 * hand-made clip id over 29 characters (some e2e fixtures) leaves no room, and
 * that clip simply goes without a poster -- the placeholder is a correct thing
 * to show, and a thrown error in the upload path would cost the clip.
 */
export function posterIdFor(clipFileId: unknown): string | null {
  if (typeof clipFileId !== "string" || clipFileId.trim() === "") return null;
  const id = `${clipFileId}${SUFFIX}`;
  return id.length <= MAX_FILE_ID ? id : null;
}

/**
 * The poster a set row may be shown with, or null.
 *
 * The one place a reader turns `video_poster_id` into something to display.
 * Absent, blank, or not the poster of this row's own clip all read as no
 * poster: the neutral placeholder is always safe to show, and a still of a
 * different clip is not.
 */
export function posterOf(row: Record<string, unknown>): string | null {
  const poster = row.video_poster_id;
  if (typeof poster !== "string" || poster === "") return null;
  return poster === posterIdFor(row.video_file_id) ? poster : null;
}
