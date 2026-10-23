/**
 * Which clip each pre-v18 review cleared -- the logic of `npm run reviews:clips`.
 *
 * v18 records the clip's file id on every new review, and a review only
 * clears the clip it names (lib/review/queue.ts `stillReviewed`). Reviews
 * written before v18 name none and keep counting for whatever clip the set
 * has, so a clip cleared before v18 and replaced afterwards would never come
 * back. This closes that, review by review:
 *
 *   - "stamp": the set's clip was uploaded before the review was written, so
 *     it is the clip the coach watched. The review is stamped with it, and a
 *     later replacement re-queues like any v18 review.
 *   - "requeue": the set's clip was uploaded AFTER the review -- the athlete
 *     replaced the clip the coach had cleared. The review is deleted, which
 *     is what the coach's own Undo does, and the clip returns to the queue.
 *   - "skip": the set is gone, has no clip, is not authentic, or the clip's
 *     upload time cannot be read. Left as it is (null keeps it valid).
 *
 * Both times are Appwrite's own `$createdAt`, the file's and the review row's,
 * so there is no device clock in the comparison. `reviewed_at` is the coach's
 * browser clock and is not used.
 *
 * Idempotent: a stamped review is no longer null and is not read again, and a
 * requeued one is gone. Races: the review and the set are re-read right
 * before each write, and the entry is skipped if either changed -- the coach
 * re-cleared it (it now names a clip) or the athlete replaced the clip again.
 *
 * Pure orchestration over injected deps, tested without a server;
 * scripts/backfill-review-clips.mts wires the real ones.
 */
export type Row = Record<string, unknown> & { $id: string };

export interface ReviewClipsDeps {
  /** Authentic reviews with no `video_file_id`, every one, in a stable order. */
  legacyReviews(): Promise<Row[]>;
  /** The review as it is now, or null if it is gone. */
  getReview(rowId: string): Promise<Row | null>;
  /** The set as it is now, or null if it is gone or not authentic. */
  getSet(rowId: string): Promise<Row | null>;
  /** The clip file's `$createdAt`, or null if there is no such file. */
  clipCreatedAt(fileId: string): Promise<string | null>;
  stamp(input: { rowId: string; athleteId: string; coachId: string; videoFileId: string }): Promise<void>;
  requeue(rowId: string): Promise<void>;
  log(line: string): void;
}

export type PlanKind = "stamp" | "requeue" | "skip";

export interface PlanEntry {
  kind: PlanKind;
  rowId: string;
  setId: string;
  coachId: string;
  athleteId: string;
  /** The set's clip at plan time; empty on a skip with no clip. */
  videoFileId: string;
  /** Why a skip is a skip. */
  reason?: string;
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const ms = (iso: string) => {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
};

/** Reads only. What `--yes` would do, review by review. */
export async function planReviewClips(
  deps: Pick<ReviewClipsDeps, "legacyReviews" | "getSet" | "clipCreatedAt">,
): Promise<PlanEntry[]> {
  const entries: PlanEntry[] = [];
  for (const review of await deps.legacyReviews()) {
    if (str(review.video_file_id)) continue;
    const base = {
      rowId: review.$id,
      setId: str(review.set_id),
      coachId: str(review.coach_id),
      athleteId: str(review.athlete_id),
      videoFileId: "",
    };
    const skip = (reason: string, videoFileId = "") => entries.push({ ...base, videoFileId, kind: "skip", reason });

    if (!base.setId || !base.coachId || !base.athleteId) {
      skip("review names no set, coach or athlete");
      continue;
    }
    const set = await deps.getSet(base.setId);
    if (!set) {
      skip("set is gone");
      continue;
    }
    const videoFileId = str(set.video_file_id);
    if (!videoFileId) {
      skip("set has no clip");
      continue;
    }
    if (str(set.athlete_id) !== base.athleteId) {
      skip("set belongs to someone else", videoFileId);
      continue;
    }
    const fileAt = ms(str(await deps.clipCreatedAt(videoFileId)));
    const reviewAt = ms(str(review.$createdAt));
    if (fileAt === null || reviewAt === null) {
      skip(fileAt === null ? "clip file not found" : "review has no creation time", videoFileId);
      continue;
    }
    entries.push({ ...base, videoFileId, kind: fileAt > reviewAt ? "requeue" : "stamp" });
  }
  return entries;
}

export interface ApplyResult {
  stamped: number;
  requeued: number;
  /** The review or the set changed between plan and write. */
  changed: number;
  failed: number;
}

/** Writes. One review's failure is logged and the rest carry on. */
export async function applyReviewClips(entries: readonly PlanEntry[], deps: ReviewClipsDeps): Promise<ApplyResult> {
  const result: ApplyResult = { stamped: 0, requeued: 0, changed: 0, failed: 0 };
  for (const entry of entries) {
    if (entry.kind === "skip") continue;
    try {
      const [review, set] = await Promise.all([deps.getReview(entry.rowId), deps.getSet(entry.setId)]);
      if (!review || str(review.video_file_id) || !set || str(set.video_file_id) !== entry.videoFileId) {
        deps.log(`  ${entry.rowId}: changed since the plan; left alone`);
        result.changed += 1;
        continue;
      }
      if (entry.kind === "stamp") {
        await deps.stamp({
          rowId: entry.rowId,
          athleteId: entry.athleteId,
          coachId: entry.coachId,
          videoFileId: entry.videoFileId,
        });
        result.stamped += 1;
      } else {
        await deps.requeue(entry.rowId);
        result.requeued += 1;
      }
    } catch (error) {
      deps.log(`  ${entry.rowId}: failed -- ${error instanceof Error ? error.message : String(error)}`);
      result.failed += 1;
    }
  }
  return result;
}
