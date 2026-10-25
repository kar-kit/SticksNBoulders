import type { QueuedOp } from "@/lib/offline/queue";
import { pendingOps } from "@/lib/offline/queue";
import { deletedIds, queuedSetEdits } from "@/lib/logging/offline-view";
import { threadComments, type Comment } from "@/lib/review/comments";
import type { ClipSet } from "@/lib/review/queue";
import { posterIdFor } from "@/appwrite/documents/poster";
import { formatWeight, type UnitPreference } from "@/lib/units";

/**
 * The athlete's own clips (F13), as rules with no React and no Appwrite.
 *
 * The gallery reads pages of sets from the server; the queue holds what the
 * athlete did since with no signal. These are the projections that make the
 * two agree on screen, plus the labels and the filter's options.
 */

/** The History tab's two views. Anything else in the URL reads as Sessions. */
export type HistoryView = "sessions" | "clips";

export function readHistoryView(value: string | null | undefined): HistoryView {
  return value === "clips" ? "clips" : "sessions";
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * The clip each set will carry once the queue drains, for sets with a
 * `set.attachVideo` still waiting. Latest op wins. Null is a clip deleted.
 *
 * Only pending ops: one that failed for good never reached the server, so
 * the server's copy is what is true.
 */
export function queuedClipChanges(ops: readonly QueuedOp[]): Map<string, { videoFileId: string | null; videoPosterId: string | null }> {
  const changes = new Map<string, { videoFileId: string | null; videoPosterId: string | null }>();
  for (const op of pendingOps(ops)) {
    if (op.kind !== "set.attachVideo") continue;
    const setId = str(op.payload.setId);
    if (!setId) continue;
    const videoFileId = str(op.payload.videoFileId) || null;
    // The poster is only believed when it is this clip's own (posterOf's rule).
    const poster = str(op.payload.videoPosterId);
    const videoPosterId = videoFileId && poster && poster === posterIdFor(videoFileId) ? poster : null;
    changes.set(setId, { videoFileId, videoPosterId });
  }
  return changes;
}

/**
 * Clips as the athlete will see them once the queue drains: a clip deleted
 * offline is gone, a replaced one shows its new file, a set deleted is gone,
 * and a note edited with no signal reads as edited. Without this a delete
 * made in a basement reappears on the next reload.
 *
 * Returns the same array when nothing applies, so a memo downstream holds.
 */
export function withQueuedClipState<T extends ClipSet>(clips: readonly T[], ops: readonly QueuedOp[]): readonly T[] {
  if (ops.length === 0) return clips;
  const changes = queuedClipChanges(ops);
  const deleted = deletedIds(ops);
  const edits = queuedSetEdits(ops);
  if (changes.size === 0 && deleted.size === 0 && edits.size === 0) return clips;

  const out: T[] = [];
  for (const clip of clips) {
    if (deleted.has(clip.id)) continue;
    let next = clip;
    const change = changes.get(clip.id);
    if (change) {
      if (change.videoFileId === null) continue;
      next = { ...next, videoFileId: change.videoFileId, videoPosterId: change.videoPosterId };
    }
    const edit = edits.get(clip.id);
    if (edit) {
      next = {
        ...next,
        loadKg: edit.loadKg,
        reps: edit.reps,
        rpe: edit.rpe,
        isWarmup: edit.isWarmup,
        failed: edit.failed === true,
        ...(edit.notes !== undefined && { notes: edit.notes }),
      };
    }
    out.push(next);
  }
  return out;
}

/** Set ids with a clip change still on the phone, for the pending mark. */
export function pendingClipIds(ops: readonly QueuedOp[]): Set<string> {
  const ids = new Set<string>();
  for (const op of pendingOps(ops)) {
    if (op.kind === "set.attachVideo" || op.kind === "set.update") {
      const id = str(op.payload.setId);
      if (id) ids.add(id);
    }
  }
  return ids;
}

/** Appends a page, keeping the first copy of any clip seen twice. */
export function mergeClipPages<T extends { id: string }>(current: readonly T[], page: readonly T[]): T[] {
  const seen = new Set(current.map((clip) => clip.id));
  return [...current, ...page.filter((clip) => !seen.has(clip.id))];
}

export interface LiftOption {
  exerciseId: string;
  name: string;
  count: number;
}

/**
 * The lifts the filter offers: the ones with a clip, most-filmed first, so
 * squat, bench and deadlift lead for nearly everybody. The selected lift is
 * always offered, even before a page naming it has loaded, so the athlete
 * can always see what they filtered by and clear it.
 */
export function liftOptions(
  clips: readonly Pick<ClipSet, "exerciseId">[],
  nameOf: (exerciseId: string) => string,
  selected: string | null = null,
): LiftOption[] {
  const counts = new Map<string, number>();
  for (const clip of clips) {
    if (clip.exerciseId) counts.set(clip.exerciseId, (counts.get(clip.exerciseId) ?? 0) + 1);
  }
  if (selected && !counts.has(selected)) counts.set(selected, 0);
  return [...counts]
    .map(([exerciseId, count]) => ({ exerciseId, name: nameOf(exerciseId), count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

const dayLabel = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

/** "180 kg × 3", in the athlete's unit. */
export function loadLine(clip: Pick<ClipSet, "loadKg" | "reps">, unit: UnitPreference): string {
  return `${formatWeight(clip.loadKg, unit)} × ${clip.reps}`;
}

/** What a screen reader hears for one tile: lift, numbers, RPE, day. */
export function clipLabel(
  clip: Pick<ClipSet, "loadKg" | "reps" | "rpe" | "loggedAt" | "isWarmup">,
  name: string,
  unit: UnitPreference,
): string {
  const rpe = clip.rpe === null ? "" : ` at RPE ${clip.rpe}`;
  const warmup = clip.isWarmup ? ", warm-up" : "";
  return `${name}${warmup}, ${loadLine(clip, unit)}${rpe}, ${dayLabel(clip.loggedAt)}`;
}

export const tileDate = dayLabel;

/**
 * The comment an athlete's reply hangs under: the latest thread's opening
 * comment, so a reply joins the conversation the coach most recently
 * started. Null when nothing has been said, and then there is no reply box.
 */
export function replyParentFor(comments: readonly Comment[]): string | null {
  const threads = threadComments(comments);
  return threads.length === 0 ? null : threads[threads.length - 1].comment.id;
}
