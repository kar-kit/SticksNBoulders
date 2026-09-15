/**
 * Comments on a set: validation, threading and ordering.
 *
 * Pure, so the rules a coach's words pass through can be tested without a
 * browser. The interesting cases are all boundaries -- an empty box, a
 * paragraph one character too long, a reply whose parent has been deleted --
 * and every one of them is a coach losing something they typed if it is wrong.
 */

/**
 * Matches `set_comments.body` in the schema, and the schema is the reason for
 * the number: long enough for a paragraph of form feedback, because this
 * replaces a WhatsApp message rather than a label. Checked here as well so the
 * box can say so before the round trip, rather than Appwrite rejecting it
 * after the coach has moved on.
 */
export const MAX_COMMENT_LENGTH = 2000;

export interface Comment {
  id: string;
  setId: string;
  athleteId: string;
  authorId: string;
  body: string;
  parentId: string | null;
  /** ISO 8601, as Appwrite stores it. */
  createdAt: string;
}

export type CommentRejection =
  | { ok: false; reason: "empty" }
  | { ok: false; reason: "too-long"; over: number };

/**
 * Trims and checks a comment before it is sent.
 *
 * Trailing whitespace is stripped rather than counted: a coach who hits return
 * twice at the end of a paragraph has not written a longer comment, and
 * refusing one for a newline they cannot see is maddening.
 */
export function checkComment(raw: string): { ok: true; body: string } | CommentRejection {
  const body = raw.trim();
  if (body.length === 0) return { ok: false, reason: "empty" };
  if (body.length > MAX_COMMENT_LENGTH) {
    return { ok: false, reason: "too-long", over: body.length - MAX_COMMENT_LENGTH };
  }
  return { ok: true, body };
}

export function rejectionMessage(rejection: CommentRejection): string {
  return rejection.reason === "empty"
    ? "Nothing to post yet."
    : `That's ${rejection.over} characters too long. Trim it, or say the rest in the next one.`;
}

export interface Thread {
  comment: Comment;
  replies: Comment[];
}

const time = (iso: string): number => {
  const ms = new Date(iso).getTime();
  // Unreadable dates sort last rather than throwing the thread away. One
  // comment out of order beats a blank panel.
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
};

const oldestFirst = (a: Comment, b: Comment) =>
  time(a.createdAt) - time(b.createdAt) || a.id.localeCompare(b.id);

/**
 * Comments arranged as threads, oldest first, replies under their parent.
 *
 * Only one level deep, deliberately. The blueprint is explicit that this is not
 * a chat product -- "if a real conversation is needed they have WhatsApp" -- so
 * a reply to a reply is flattened onto the thread it belongs to rather than
 * indented further. Nesting invites the conversation the screen is trying not
 * to host.
 *
 * A reply whose parent is missing -- deleted by its author, or simply not in
 * the page that was read -- is promoted to a thread of its own rather than
 * dropped. Losing an athlete's answer because the question went away is worse
 * than showing it without its question.
 */
export function threadComments(comments: readonly Comment[]): Thread[] {
  const sorted = [...comments].sort(oldestFirst);
  const present = new Set(sorted.map((comment) => comment.id));

  const threads = new Map<string, Thread>();
  const order: string[] = [];

  for (const comment of sorted) {
    const isRoot = comment.parentId === null || !present.has(comment.parentId);
    if (isRoot) {
      threads.set(comment.id, { comment, replies: [] });
      order.push(comment.id);
    }
  }

  for (const comment of sorted) {
    if (comment.parentId === null || !present.has(comment.parentId)) continue;
    // Walk up to the thread's root, so a reply-to-a-reply lands on the thread
    // rather than creating a second level nobody asked for.
    let rootId = comment.parentId;
    const seen = new Set<string>([comment.id]);
    for (;;) {
      if (threads.has(rootId)) break;
      const parent = sorted.find((candidate) => candidate.id === rootId);
      // A cycle can only come from corrupt data, and looping forever on it
      // would hang the screen rather than lose one comment.
      if (!parent || !parent.parentId || seen.has(parent.id)) break;
      seen.add(parent.id);
      rootId = parent.parentId;
    }
    threads.get(rootId)?.replies.push(comment);
  }

  return order.map((id) => threads.get(id)!);
}

/**
 * Who to show above a comment, without ever falling back to a raw id.
 *
 * The fallback is the caller's because the other party differs by side: the
 * coach is reading an athlete, and at Order 34 the athlete is reading their
 * coach. A default here would be right on one screen and wrong on the other.
 */
export function authorLabel(
  comment: Comment,
  names: ReadonlyMap<string, string>,
  viewerId: string,
  fallback: string,
): string {
  if (comment.authorId === viewerId) return "You";
  return names.get(comment.authorId) ?? fallback;
}

/** Comment counts per set, for the queue rail and the "already said" marker. */
export function countBySet(comments: readonly Comment[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const comment of comments) {
    counts.set(comment.setId, (counts.get(comment.setId) ?? 0) + 1);
  }
  return counts;
}
