import type { Comment } from "./comments";

/**
 * The coach's Replies inbox: which athlete replies he has not read yet (F26).
 *
 * Pure, like the queue's arithmetic, because every rule here is a boundary
 * that is cheap to test and miserable to debug live: whose words count, which
 * clock they are compared on, and what "read" means when the coach has two
 * devices.
 *
 * The model, in one line: a thread is a set's comments; an athlete comment in
 * it is unread when it reached the server after the coach's watermark for that
 * thread, and the watermark is the later of his read mark (`thread_reads`,
 * server-side so the phone and the laptop agree) and his own last comment
 * there -- answering a reply is reading it.
 *
 * What counts, and why:
 *
 *   - Only the athlete's own words in their own set's thread
 *     (`author_id === athlete_id`). The coach's comments never count, and nor
 *     does a second coach's: Ruairi and Louis may share an athlete, and Louis
 *     talking is not the athlete answering.
 *   - Only athletes linked to this coach now. A revoked link takes the thread
 *     with it -- the circle stops returning the rows anyway; this covers
 *     the moment between a revoke and the next read.
 *   - Never reactions (F25). They live in their own table, which nothing here
 *     reads; a 👍 is "seen", not something to answer.
 *
 * One row per thread rather than per message, and the badge counts threads
 * with something unread. The number beside "Replies" is then the number of
 * rows on the screen that are marked, the same promise the Review badge makes
 * about clips (app/(coach)/coach-layout-shell.tsx).
 */

/** Set id to the server time the coach has read that thread through. */
export type ThreadReads = ReadonlyMap<string, string>;

export interface ReplyThread {
  setId: string;
  athleteId: string;
  /** The athlete's newest comment in the thread: the snippet the list shows. */
  latest: Comment;
  /** Athlete comments after the coach's watermark. Zero is a read thread. */
  unread: number;
  /** Every athlete comment in the thread that was read. */
  replies: number;
  /**
   * The newest comment in the thread by anyone, as an ISO server time: what a
   * mark written now would read the thread through. Null only when no comment
   * in it carries a readable time.
   */
  readThrough: string | null;
}

export interface ReplyScope {
  coachId: string;
  /** Athletes linked to this coach now. */
  athleteIds: readonly string[];
}

/** One clock for both parties: the server's when it is known. */
export const postedAt = (comment: Comment): string => comment.postedAt || comment.createdAt;

const ms = (iso: string | null | undefined): number => {
  if (!iso) return Number.NaN;
  return new Date(iso).getTime();
};

/** The athlete talking in their own thread, to a coach who still coaches them. */
export function isAthleteReply(comment: Comment, scope: ReplyScope, linked?: ReadonlySet<string>): boolean {
  const athletes = linked ?? new Set(scope.athleteIds);
  return (
    comment.authorId !== "" &&
    comment.authorId === comment.athleteId &&
    comment.authorId !== scope.coachId &&
    athletes.has(comment.athleteId)
  );
}

/**
 * Where the coach has read this thread through, in ms: the later of his mark
 * and his own newest comment in it. -Infinity when he has done neither.
 */
export function watermark(setComments: readonly Comment[], mark: string | undefined, coachId: string): number {
  let at = Number.NEGATIVE_INFINITY;
  const marked = ms(mark);
  if (!Number.isNaN(marked)) at = marked;
  for (const comment of setComments) {
    if (comment.authorId !== coachId) continue;
    const said = ms(postedAt(comment));
    if (!Number.isNaN(said) && said > at) at = said;
  }
  return at;
}

/**
 * Whether one athlete comment is past the watermark.
 *
 * A comment with no readable time is unread only while the coach has never
 * read or answered the thread at all. Counting it unread for good would light
 * a badge no mark could clear; never counting it would lose the reply. It
 * cannot come from Appwrite, which always stamps `$createdAt`.
 */
const isUnread = (comment: Comment, mark: number): boolean => {
  const at = ms(postedAt(comment));
  if (Number.isNaN(at)) return mark === Number.NEGATIVE_INFINITY;
  return at > mark;
};

/** The newest readable time among these comments, as ISO, or null. */
export function newestPosted(comments: readonly Comment[]): string | null {
  let best = Number.NEGATIVE_INFINITY;
  for (const comment of comments) {
    const at = ms(postedAt(comment));
    if (!Number.isNaN(at) && at > best) best = at;
  }
  return best === Number.NEGATIVE_INFINITY ? null : new Date(best).toISOString();
}

/**
 * Every thread an athlete has said something in, newest reply first.
 *
 * Read threads stay in the list, unmarked: the inbox is also where a coach
 * goes back to what Joey said on Tuesday. Only the badge is about unread.
 */
export function replyThreads(comments: readonly Comment[], reads: ThreadReads, scope: ReplyScope): ReplyThread[] {
  const linked = new Set(scope.athleteIds);
  const bySet = new Map<string, Comment[]>();
  for (const comment of comments) {
    if (!comment.setId || !linked.has(comment.athleteId)) continue;
    const list = bySet.get(comment.setId);
    if (list) list.push(comment);
    else bySet.set(comment.setId, [comment]);
  }

  const threads: ReplyThread[] = [];
  for (const [setId, setComments] of bySet) {
    const replies = setComments.filter((comment) => isAthleteReply(comment, scope, linked));
    if (replies.length === 0) continue;
    const mark = watermark(setComments, reads.get(setId), scope.coachId);
    const latest = replies.reduce((a, b) => (newer(b, a) ? b : a));
    threads.push({
      setId,
      athleteId: latest.athleteId,
      latest,
      unread: replies.filter((reply) => isUnread(reply, mark)).length,
      replies: replies.length,
      readThrough: newestPosted(setComments),
    });
  }

  return threads.sort((a, b) => (newer(a.latest, b.latest) ? -1 : newer(b.latest, a.latest) ? 1 : 0));
}

/** Whether a came after b. Unreadable times sort oldest; ids break ties so the order is stable. */
function newer(a: Comment, b: Comment): boolean {
  const ta = ms(postedAt(a));
  const tb = ms(postedAt(b));
  const va = Number.isNaN(ta) ? Number.NEGATIVE_INFINITY : ta;
  const vb = Number.isNaN(tb) ? Number.NEGATIVE_INFINITY : tb;
  if (va !== vb) return va > vb;
  return a.id > b.id;
}

/** The badge: threads with anything unread. */
export const unreadThreadCount = (threads: readonly ReplyThread[]): number =>
  threads.reduce((n, thread) => (thread.unread > 0 ? n + 1 : n), 0);

/**
 * The mark to write for a thread the coach is looking at, or null for none.
 *
 * `shown` is what the screen actually has on it. A reply that arrived live
 * after the screen loaded its comments has not been seen, so the mark goes
 * only as far as the newest comment shown -- never to the thread's newest by
 * default -- and nothing is written when that would not clear anything.
 * Without `shown` (a tap on the Replies row, whose snippet IS the newest
 * reply) the mark goes through the whole thread.
 */
export function markFor(
  thread: ReplyThread | undefined,
  current: string | undefined,
  coachId: string,
  allSetComments: readonly Comment[],
  shown?: readonly Comment[],
): string | null {
  if (!thread || thread.unread === 0) return null;
  const through = shown ? newestPosted(shown.filter((c) => c.setId === thread.setId)) : thread.readThrough;
  if (!through) return null;
  if (ms(through) <= watermark(allSetComments, current, coachId)) return null;
  return through;
}

/**
 * The stable link to one set's thread, for the coach (F26).
 *
 * Push notifications (F27) link here. It names only the set, so it survives
 * the Athlete View's own URL changing: the page behind it finds whose set it
 * is and hands over to the clip dialog (app/(coach)/coach/replies/[setId]).
 */
export const threadHref = (setId: string): string => `/coach/replies/${encodeURIComponent(setId)}`;

/** Where a thread is actually read today: the clip dialog over Athlete View. */
export const threadViewHref = (athleteId: string, setId: string): string =>
  `/coach/athletes/${encodeURIComponent(athleteId)}?clip=${encodeURIComponent(setId)}`;

/** One line of the reply, for the list: whitespace folded, cut on a word. */
export function snippet(body: string, max = 120): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
