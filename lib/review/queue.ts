/**
 * The Review Queue's arithmetic.
 *
 * Pure, and separate from the Appwrite reads for the usual reason: what belongs
 * in the queue, what order it comes in, and what the next clip is after a skip
 * are all cheap to test and expensive to debug on a Sunday afternoon with a
 * coach watching.
 *
 * The blueprint's metric is time to clear the queue, and every decision here
 * follows from it. One list across every athlete rather than a folder per
 * person. Oldest first, because a clip waiting since Tuesday is the one the
 * athlete is still wondering about. Advancing never sends the coach back to a
 * list -- the next clip is already decided before they press the key.
 */

/** A logged set that has a clip on it. */
export interface ClipSet {
  id: string;
  athleteId: string;
  exerciseId: string;
  sessionId: string;
  setIndex: number;
  loadKg: number;
  reps: number;
  rpe: number | null;
  e1rmKg: number | null;
  /** ISO 8601, as Appwrite stores it. */
  loggedAt: string;
  videoFileId: string;
  /**
   * The clip's poster for its thumbnail (F12), or null for the placeholder.
   * Optional so a fixture need not spell it out.
   */
  videoPosterId?: string | null;
  notes: string | null;
  /**
   * The set's warm-up flag. Read so a write that restates the set's values
   * (the athlete's note edit from the Clips gallery, F13) cannot turn a
   * filmed warm-up into a working set. Optional so a fixture need not spell
   * it out; absent reads as a working set, as before.
   */
  isWarmup?: boolean;
  /**
   * The athlete missed the set (F19). Shown to the coach beside the numbers,
   * and restated by the athlete's note edit for the same reason as
   * `isWarmup`. Optional; absent reads as not failed.
   */
  failed?: boolean;
  /**
   * The line the set was logged against, and the target as it read on the
   * athlete's screen when they logged it -- a snapshot, stored on the set and
   * never recomputed, because logged work is immutable and a coach editing the
   * line since must not change what this set was asked to be. Null for a set
   * logged freely. Optional so a fixture need not spell them out.
   */
  prescriptionId?: string | null;
  prescribed?: string | null;
}

export interface QueueItem extends ClipSet {
  athleteName: string;
  exerciseName: string;
}

export interface QueueNames {
  /** Athlete id to display name. A missing name is not a missing clip. */
  athletes: ReadonlyMap<string, string>;
  exercises: ReadonlyMap<string, string>;
}

/**
 * An athlete with no profile row yet, or a clip on an exercise the library
 * lookup missed. Shown rather than hidden: a coach seeing an unnamed clip can
 * still watch it and say something, where a coach seeing nothing assumes the
 * athlete did not train.
 */
const UNKNOWN_ATHLETE = "Unnamed athlete";
const UNKNOWN_EXERCISE = "Unknown lift";

const time = (iso: string): number => {
  const ms = new Date(iso).getTime();
  // A malformed date sorts last rather than throwing the queue away. It is one
  // clip out of order; an exception is a blank screen.
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
};

/**
 * This coach's reviews: set id to the clip it cleared (v18), or null for a
 * review written before v18 recorded one.
 */
export type ReviewedClips = ReadonlyMap<string, string | null>;

/**
 * The sets whose CURRENT clip this coach has cleared.
 *
 * A review counts only while the set still carries the file it was written
 * for, so an athlete replacing a clip the coach already cleared (the Log's
 * Replace, or the Clips gallery's) puts it back in the queue. A review from
 * before v18 names no file and counts for whatever clip the set has: that is
 * what it meant when it was written, and treating it as stale would refill
 * every coach's queue with clips they have already watched.
 *
 * Every reader of reviews goes through this one function -- the queue, the
 * Review badge, the Roster, Athlete View, the Program Editor's context -- so
 * the number beside "Review" and the clips on screen cannot disagree.
 */
export function stillReviewed(clips: readonly ClipSet[], reviews: ReviewedClips): Set<string> {
  const reviewed = new Set<string>();
  for (const clip of clips) {
    if (!reviews.has(clip.id)) continue;
    const fileId = reviews.get(clip.id);
    if (fileId === null || fileId === undefined || fileId === clip.videoFileId) reviewed.add(clip.id);
  }
  return reviewed;
}

/**
 * Everything waiting, oldest first.
 *
 * The subtraction is done here rather than in the query because Appwrite has
 * no joins: the queue is sets-with-video MINUS this coach's reviews, and those
 * are two tables. At beta scale -- one coach, a handful of athletes, a few
 * hundred clips -- reading both and filtering in memory is one round trip each
 * and no measurable cost. It is also the first thing that stops scaling, so it
 * is chosen rather than missed: the fix, when a coach has thousands of cleared
 * clips, is a `last_reviewed_at` watermark per athlete rather than a growing
 * set of ids.
 */
export function buildQueue(
  clips: readonly ClipSet[],
  reviewedSetIds: ReadonlySet<string>,
  names: QueueNames,
): QueueItem[] {
  return clips
    .filter((clip) => !reviewedSetIds.has(clip.id))
    .map((clip) => ({
      ...clip,
      athleteName: names.athletes.get(clip.athleteId) ?? UNKNOWN_ATHLETE,
      exerciseName: names.exercises.get(clip.exerciseId) ?? UNKNOWN_EXERCISE,
    }))
    .sort((a, b) => time(a.loggedAt) - time(b.loggedAt) || a.id.localeCompare(b.id));
}

export interface AthleteGroup {
  athleteId: string;
  athleteName: string;
  items: QueueItem[];
}

/**
 * The left rail: each athlete once, their clips under them.
 *
 * Grouped in queue order rather than alphabetically, so the person who has
 * been waiting longest is at the top. The rail is for orientation -- how much
 * is left and whose -- not for choosing what to do next, which is what the
 * advance key is for.
 */
export function groupByAthlete(items: readonly QueueItem[]): AthleteGroup[] {
  const groups = new Map<string, AthleteGroup>();
  for (const item of items) {
    const existing = groups.get(item.athleteId);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(item.athleteId, {
        athleteId: item.athleteId,
        athleteName: item.athleteName,
        items: [item],
      });
    }
  }
  return [...groups.values()];
}

/**
 * What to show after this one is cleared.
 *
 * Takes the queue as it was BEFORE the clip left it, so the caller does not
 * have to decide whether to remove first and then advance or the other way
 * round -- a distinction that is invisible until the last clip, where getting
 * it wrong shows the coach the clip they just cleared.
 *
 * Falls back to the previous clip at the end of the list, so clearing the last
 * one lands on something real rather than snapping to the top.
 */
export function nextAfter(items: readonly QueueItem[], currentId: string): QueueItem | null {
  const index = items.findIndex((item) => item.id === currentId);
  if (index < 0) return items[0] ?? null;
  return items[index + 1] ?? items[index - 1] ?? null;
}

/** The clip a freshly loaded queue opens on. */
export const firstItem = (items: readonly QueueItem[]): QueueItem | null => items[0] ?? null;

/**
 * "set 3 of 4", from the set's siblings in its session.
 *
 * Counted across the same exercise in the same session, which is what a coach
 * means by "third set" -- not the third row of the whole workout. Warm-ups are
 * left in: a warm-up is a set the athlete filmed, and renumbering around it
 * would make the label disagree with the logger the athlete used.
 */
export function setPosition(
  clip: ClipSet,
  sessionSets: readonly { exerciseId: string; setIndex: number }[],
): { position: number; total: number } {
  const siblings = sessionSets
    .filter((set) => set.exerciseId === clip.exerciseId)
    .map((set) => set.setIndex)
    .sort((a, b) => a - b);
  const position = siblings.indexOf(clip.setIndex);
  return {
    position: position < 0 ? 1 : position + 1,
    total: siblings.length === 0 ? 1 : siblings.length,
  };
}

/**
 * The e1RM line: this set's estimate, and the change on the best before it.
 *
 * Null when there is nothing to compare against, which is a real state -- a
 * first session, or a lift the athlete has just picked up -- and is rendered
 * as an absence rather than a "+0.0", which would read as a plateau.
 */
export function e1rmDelta(
  clip: ClipSet,
  previousBestKg: number | null,
): { e1rmKg: number; deltaKg: number | null } | null {
  if (clip.e1rmKg === null || !Number.isFinite(clip.e1rmKg) || clip.e1rmKg <= 0) return null;
  if (previousBestKg === null || !Number.isFinite(previousBestKg) || previousBestKg <= 0) {
    return { e1rmKg: clip.e1rmKg, deltaKg: null };
  }
  return { e1rmKg: clip.e1rmKg, deltaKg: clip.e1rmKg - previousBestKg };
}
