/**
 * The athlete's side of the review loop: what the coach said, arranged by the
 * set it was said about, and what is new since they last looked.
 *
 * Pure, so the rules that decide whether a correction gets noticed can be
 * tested without a browser. The one with teeth is "new": a stale dot costs a
 * tap, a missing one costs a correction the athlete never reads before their
 * next session.
 */

import { threadComments, type Comment, type Thread } from "./comments";

/** The set a comment is about, with the numbers nobody has to type. */
export interface FeedbackSet {
  id: string;
  sessionId: string;
  exerciseId: string;
  setIndex: number;
  loadKg: number;
  reps: number;
  rpe: number | null;
  isWarmup: boolean;
  /** ISO 8601. */
  loggedAt: string;
  videoFileId: string | null;
  notes: string | null;
}

export interface FeedbackCard {
  setId: string;
  /** Null when the set could not be read -- deleted, or outside the page. */
  set: FeedbackSet | null;
  threads: Thread[];
  /** Newest comment on the set, by anyone. What the list is ordered by. */
  lastActivityAt: string;
  /** Comments from somebody else, newer than the athlete last looked. */
  unread: number;
}

const time = (iso: string | null | undefined): number => {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
};

/**
 * Whether a comment is something the athlete has not seen.
 *
 * Their own words are never new to them. With no watermark at all -- first
 * visit, or a new device -- everything the coach said counts: showing old
 * feedback as new costs one tap, hiding new feedback as old costs the
 * correction.
 */
export function isUnread(comment: Comment, viewerId: string, seenAt: string | null): boolean {
  if (comment.authorId === viewerId) return false;
  if (seenAt === null) return true;
  return time(comment.createdAt) > time(seenAt);
}

export function countUnread(
  comments: readonly Comment[],
  viewerId: string,
  seenAt: string | null,
): number {
  return comments.filter((comment) => isUnread(comment, viewerId, seenAt)).length;
}

/**
 * Comments grouped onto their sets, most recent conversation first.
 *
 * One card per set rather than per comment, because the set is what the
 * athlete recognises -- "Tuesday's second squat" -- and a coach who comments
 * twice on one clip is still talking about one clip.
 *
 * A comment whose set cannot be read still gets a card, with no numbers. The
 * set may have been deleted by the athlete after the coach spoke; the coach's
 * words are still worth reading.
 */
export function buildFeedback(
  comments: readonly Comment[],
  sets: ReadonlyMap<string, FeedbackSet>,
  viewerId: string,
  seenAt: string | null,
): FeedbackCard[] {
  const bySet = new Map<string, Comment[]>();
  for (const comment of comments) {
    const list = bySet.get(comment.setId);
    if (list) list.push(comment);
    else bySet.set(comment.setId, [comment]);
  }

  const cards: FeedbackCard[] = [];
  for (const [setId, onSet] of bySet) {
    const lastActivityAt = onSet.reduce(
      (latest, comment) => (time(comment.createdAt) > time(latest) ? comment.createdAt : latest),
      onSet[0].createdAt,
    );
    cards.push({
      setId,
      set: sets.get(setId) ?? null,
      threads: threadComments(onSet),
      lastActivityAt,
      unread: countUnread(onSet, viewerId, seenAt),
    });
  }

  // Newest conversation first. Ties break on set id so the list does not
  // reshuffle between renders under the athlete's thumb.
  return cards.sort(
    (a, b) => time(b.lastActivityAt) - time(a.lastActivityAt) || a.setId.localeCompare(b.setId),
  );
}

/**
 * The watermark to store once the athlete has seen these comments.
 *
 * The newest `created_at` among what was actually on screen, not the device's
 * clock. `created_at` is stamped by the author's device, so comparing it with
 * the athlete's clock mixes two clocks: a phone five minutes slow would mark
 * the coach's next comment as already seen. Comparing coach time with coach
 * time avoids that.
 *
 * Never moves backwards, so a screen that loaded a shorter page than last
 * time cannot resurrect old comments as new.
 */
export function nextSeenAt(
  comments: readonly Comment[],
  viewerId: string,
  previous: string | null,
): string | null {
  let latest = previous;
  for (const comment of comments) {
    if (comment.authorId === viewerId) continue;
    if (time(comment.createdAt) === Number.NEGATIVE_INFINITY) continue;
    if (time(comment.createdAt) > time(latest)) latest = comment.createdAt;
  }
  return latest;
}

/**
 * What a reply on this card answers.
 *
 * The most recent thread's opening comment. Threads are one level deep, so a
 * reply attaches to the root rather than to the last reply -- threadComments
 * would flatten it there anyway, and pointing at the root means the reply
 * survives the coach withdrawing a later message.
 */
export function replyParentId(card: FeedbackCard): string | null {
  if (card.threads.length === 0) return null;
  return card.threads[card.threads.length - 1].comment.id;
}

/**
 * Set ids the screen needs numbers for: every set spoken about, plus any set
 * with a clip still uploading from this device. One list, so it is one query.
 */
export function setIdsToFetch(
  comments: readonly Comment[],
  uploadingSetIds: readonly string[],
): string[] {
  return [...new Set([...comments.map((c) => c.setId), ...uploadingSetIds].filter(Boolean))];
}

/** "3 new", or "9+ new" once the count stops being information. */
export function unreadLabel(count: number): string {
  if (count <= 0) return "";
  return count > 9 ? "9+ new" : `${count} new`;
}
