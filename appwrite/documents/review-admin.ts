import { reviewPermissions } from "./policy";
import type { RowWriter } from "./row-writer";

/**
 * Server-side writes to a coach's review, for the v18 backfill only
 * (`npm run reviews:clips`, scripts/review-clips.ts).
 *
 * Here rather than in the script for the reason every row write is: one place
 * to review. A narrow RowWriter, like poster-admin.ts, so nothing here pulls
 * node-appwrite into a browser bundle.
 */
export interface StampReviewInput {
  rowId: string;
  /** From the review's own columns, so the restated stamp is the one it has. */
  athleteId: string;
  coachId: string;
  /** The reviewed set's clip, as just re-read. */
  videoFileId: string;
}

/**
 * Records which clip a pre-v18 review cleared: the set's current one. Writes
 * only `video_file_id`; the permissions restated are `reviewPermissions` for
 * the row's own coach and athlete, which the backfill has already checked the
 * row carries (`isAuthentic`), so its audience does not move.
 */
export async function stampReviewClip(writer: RowWriter, databaseId: string, input: StampReviewInput) {
  if (!input.rowId || !input.athleteId || !input.coachId || !input.videoFileId) {
    throw new Error("stampReviewClip: rowId, athleteId, coachId and videoFileId are required");
  }
  return writer.updateRow({
    databaseId,
    tableId: "set_reviews",
    rowId: input.rowId,
    data: { video_file_id: input.videoFileId },
    permissions: reviewPermissions({ athleteId: input.athleteId, coachId: input.coachId }),
  });
}

/**
 * Puts a clip back in its coach's queue by deleting a pre-v18 review that
 * cleared an EARLIER take: the athlete replaced the clip after the coach
 * watched it, which is exactly the clip v18 exists to bring back. The same
 * row delete as the coach's own Undo (`unmarkSetReviewed`).
 */
export async function requeueReview(writer: RowWriter, databaseId: string, rowId: string) {
  if (!rowId) throw new Error("requeueReview: rowId is required");
  return writer.deleteRow({ databaseId, tableId: "set_reviews", rowId });
}
