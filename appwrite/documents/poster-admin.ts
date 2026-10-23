import { posterIdFor } from "./poster";
import { setPermissions } from "./policy";
import type { RowWriter } from "./row-writer";

/**
 * Pointing an existing set at its clip's poster, server-side (F12 backfill).
 *
 * The one server-side write of `video_poster_id`, and it lives in the write
 * helper for the reason every row write does: one place to review. Used only
 * by `npm run clips:posters` (scripts/clip-posters.ts), with the admin key,
 * for clips filmed before v17 or whose phone could not grab a frame.
 *
 * Writes only the poster column. The clip id is passed so the pair can be
 * checked -- the poster must be THIS clip's (`posterIdFor`) -- but it is not
 * written: the backfill re-reads the row right before calling this and skips a
 * set whose clip changed meanwhile, and rewriting the clip id from a stale
 * read is how a replaced clip would come back.
 *
 * Stamped with `setPermissions` for the athlete, exactly as `attachVideo` and
 * every set write stamps it, so the row's audience is unchanged. A narrow
 * RowWriter rather than the SDK, like circle-admin.ts, so nothing here pulls
 * node-appwrite into a browser bundle.
 */
export interface SetPosterInput {
  rowId: string;
  /** The set's athlete, from its own `athlete_id`. */
  athleteId: string;
  /** The set's clip as just re-read. */
  videoFileId: string;
  videoPosterId: string;
}

export async function setPosterOnSet(writer: RowWriter, databaseId: string, input: SetPosterInput) {
  if (!input.rowId || !input.athleteId) throw new Error("setPosterOnSet: rowId and athleteId are required");
  if (input.videoPosterId !== posterIdFor(input.videoFileId)) {
    throw new Error(`setPosterOnSet: ${input.videoPosterId} is not the poster of clip ${input.videoFileId}`);
  }
  return writer.updateRow({
    databaseId,
    tableId: "sets",
    rowId: input.rowId,
    data: { video_poster_id: input.videoPosterId },
    permissions: setPermissions({ athleteId: input.athleteId }),
  });
}
