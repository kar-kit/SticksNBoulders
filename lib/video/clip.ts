/**
 * Rules about a clip attached to a set.
 *
 * Pure, and separate from the upload for the same reason the set rules are
 * separate from the logger: the coach's review queue, the athlete's logger and
 * the upload path all have to agree on what a clip is and which set it belongs
 * to, and an answer that lives in a component is an answer three screens get
 * to disagree about.
 */

/**
 * What a phone camera produces, matching the bucket's own list.
 *
 * Kept deliberately narrow. An athlete who manages to attach a PDF has found
 * a bug rather than a feature, and the check happens here so the failure is a
 * sentence on screen instead of a 400 from storage after a two-minute upload.
 */
export const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "webm"] as const;
export type VideoExtension = (typeof VIDEO_EXTENSIONS)[number];

/**
 * The hard ceiling, from the Appwrite instance rather than from a preference:
 * `_APP_STORAGE_LIMIT` is 30,000,000 bytes and storage rejects anything above
 * it outright. A 60-second 1080p clip off a modern phone is several times
 * this, so most real videos must be compressed before they get here -- which
 * is Order 31's job, and why this refusal names compression rather than just
 * saying no.
 */
export const MAX_VIDEO_BYTES = 30_000_000;

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

export const isVideoExtension = (value: string): value is VideoExtension =>
  (VIDEO_EXTENSIONS as readonly string[]).includes(value);

export type ClipRejection =
  | { ok: false; reason: "empty"; message: string }
  | { ok: false; reason: "type"; message: string }
  | { ok: false; reason: "too-big"; message: string };

export type ClipCheck = { ok: true } | ClipRejection;

/** A megabyte, to one decimal, for a message an athlete has to act on. */
const mb = (bytes: number): string => `${Math.round((bytes / 1_000_000) * 10) / 10}MB`;

/**
 * Whether this file can be attached at all, checked before the upload starts.
 *
 * Every message says what to do rather than what went wrong. "Too big" on a
 * gym floor with one bar free is not a useful sentence.
 */
export function checkClip(file: { name: string; size: number }): ClipCheck {
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, reason: "empty", message: "That file is empty. Try filming again." };
  }
  const extension = extensionOf(file.name);
  if (!isVideoExtension(extension)) {
    return {
      ok: false,
      reason: "type",
      message: "That is not a video. Attach an mp4, mov, m4v or webm.",
    };
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return {
      ok: false,
      reason: "too-big",
      message: `That clip is ${mb(file.size)}. The limit is ${mb(MAX_VIDEO_BYTES)} — film a shorter one, or trim it before attaching.`,
    };
  }
  return { ok: true };
}

/**
 * A logged set a clip could attach to.
 *
 * Only what choosing a target actually needs, rather than the full set. A
 * caller should not have to narrow an RPE to a half-point union to ask which
 * row a video belongs on.
 */
export interface AttachableSet {
  clientSetId: string;
  exerciseId: string;
  loggedAt: Date;
  /** Attaching again replaces what is there. */
  hasVideo?: boolean;
}

/**
 * Which set a clip belongs to.
 *
 * The Set Row spec is explicit and the reasoning is worth keeping: there is
 * one camera button per exercise, not one per row, and it attaches to the most
 * recently logged set of that exercise. A per-row camera bought nothing and
 * cost the confirm target its column -- and confirm is the control an athlete
 * hits twenty to forty times a session.
 *
 * Warm-ups are eligible. A coach asking to see a warm-up is asking about
 * setup, which is a real coaching question, and the rule that excludes
 * warm-ups from PRs and rollups is about numbers rather than about video.
 *
 * Null when nothing has been logged for that exercise yet: the clip has
 * nowhere to go, and the camera button should not be offered.
 */
export function setForNewClip(
  sets: readonly AttachableSet[],
  exerciseId: string,
): AttachableSet | null {
  let best: AttachableSet | null = null;
  for (const set of sets) {
    if (set.exerciseId !== exerciseId) continue;
    const at = set.loggedAt.getTime();
    if (!Number.isFinite(at)) continue;
    if (!best || at > best.loggedAt.getTime()) best = set;
  }
  return best;
}

/**
 * Whether the camera should be offered for this exercise at all.
 *
 * Offering it with nothing to attach to produces a clip the product then has
 * to explain away, so the button is absent rather than disabled-with-a-reason.
 */
export const canAttachClip = (sets: readonly AttachableSet[], exerciseId: string): boolean =>
  setForNewClip(sets, exerciseId) !== null;

/**
 * Replacing an existing clip is allowed, and says so.
 *
 * An athlete who films the wrong rep should be able to fix it, and the set
 * carries exactly one `video_file_id`, so attaching a second clip replaces the
 * first. The old file is deleted by the caller -- an orphan in storage is a
 * bill nobody notices.
 */
export const isReplacement = (set: Pick<AttachableSet, "hasVideo">): boolean =>
  set.hasVideo === true;
