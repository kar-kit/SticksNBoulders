"use client";

import { Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import { browserWriteDeps } from "@/appwrite/documents/browser-writer";
import { authenticRows, markThreadRead } from "@/appwrite/documents";
import { toComment } from "./comment-store";
import type { Comment } from "./comments";

/**
 * Reading and writing the coach's Replies inbox (F26).
 *
 * Two reads and a comparison, like the Review Queue: the recent comments on
 * every linked athlete's sets, and this coach's read marks. The arithmetic is
 * lib/review/replies.ts. The coach reads comments through the circle team, as
 * everywhere else; the marks are stamped for him alone (policy.ts
 * `threadReadPermissions`), so the same query from anyone else returns none.
 */

const PAGE = 100;
/**
 * A few weeks of conversation across a whole roster, the coach's words
 * included. Past this a reply is still in its thread -- Athlete View and the
 * athlete's Feedback read by set -- it just no longer lights the badge. The
 * fix when that bites is a time floor on the query, not a bigger cap.
 */
const MAX_COMMENTS = 500;
/** One mark per thread he has opened. A season of threads. */
const MAX_READS = 1000;

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * The newest comments on these athletes' sets, newest first, everyone's.
 *
 * The coach's own come too, on purpose: answering a reply is reading it, so
 * his last word in a thread is half of its watermark. Filtering authors here
 * would also spend the cap on nothing -- one IN query on `athlete_id`, ordered
 * by the index the athlete's Feedback screen already uses.
 */
export async function fetchThreadComments(athleteIds: readonly string[]): Promise<Comment[]> {
  if (athleteIds.length === 0) return [];
  const { tables, databaseId } = browserAppwrite();
  const comments: Comment[] = [];
  let cursor: string | null = null;

  while (comments.length < MAX_COMMENTS) {
    const queries = [Query.equal("athlete_id", [...athleteIds]), Query.orderDesc("created_at"), Query.limit(PAGE)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const page = await tables.listRows({ databaseId, tableId: "set_comments", queries });
    if (page.rows.length === 0) break;
    // Only comments their author wrote (provenance.ts). A reply forged in the
    // athlete's name must not light the coach's badge.
    for (const row of authenticRows("set_comments", page.rows)) {
      const comment = toComment(row as unknown as Record<string, unknown> & { $id: string });
      if (comment) comments.push(comment);
    }
    if (page.rows.length < PAGE) break;
    cursor = page.rows[page.rows.length - 1].$id;
  }
  return comments;
}

export interface ThreadMark {
  athleteId: string;
  lastReadAt: string;
}

/**
 * This coach's read marks, by set.
 *
 * Only marks he wrote: a mark planted in his name is how a stranger would
 * silence his badge, and the update stamp naming his user is the proof only
 * he can make (provenance.ts).
 */
export async function fetchThreadReads(coachId: string): Promise<Map<string, ThreadMark>> {
  const marks = new Map<string, ThreadMark>();
  if (!coachId) return marks;
  const { tables, databaseId } = browserAppwrite();
  let cursor: string | null = null;

  while (marks.size < MAX_READS) {
    const queries = [
      Query.equal("coach_id", coachId),
      Query.orderDesc("$id"),
      Query.limit(PAGE),
      // coach_id is selected so the row can prove the coach wrote it.
      Query.select(["set_id", "coach_id", "athlete_id", "last_read_at"]),
    ];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const page = await tables.listRows({ databaseId, tableId: "thread_reads", queries });
    if (page.rows.length === 0) break;
    for (const row of authenticRows("thread_reads", page.rows)) {
      const raw = row as unknown as Record<string, unknown>;
      const setId = str(raw.set_id);
      const lastReadAt = str(raw.last_read_at);
      if (setId && lastReadAt) marks.set(setId, { athleteId: str(raw.athlete_id), lastReadAt });
    }
    if (page.rows.length < PAGE) break;
    cursor = page.rows[page.rows.length - 1].$id;
  }
  return marks;
}

/** Writes the coach's mark on one thread, through the helper. */
export async function saveThreadRead(
  coachId: string,
  mark: { athleteId: string; setId: string; lastReadAt: string },
): Promise<void> {
  await markThreadRead(browserWriteDeps(() => ""), { userId: coachId }, mark);
}

/**
 * Live replies, and live marks.
 *
 * Comments: a reply landing while the coach is on the Roster lights the badge
 * without a refresh, which is why it is in the nav at all. Creates, updates
 * and deletes alike -- an athlete withdrawing a reply should take it back off
 * the badge. Realtime delivers only rows the coach can read, so the circle
 * does the filtering, as for the queue.
 *
 * Marks: his own, from his other device. Reading a thread on the laptop
 * clears the phone's badge, which is the whole reason the mark is a row and
 * not localStorage.
 *
 * Not `comment_reactions`, by construction: a reaction is quiet (F25), and
 * the cheapest way to keep it from ever waking the badge is never to listen.
 */
export function subscribeToThreads(databaseId: string, onChange: () => void): () => void {
  const { client } = browserAppwrite();
  return client.subscribe(
    [`databases.${databaseId}.tables.set_comments.rows`, `databases.${databaseId}.tables.thread_reads.rows`],
    (message) => {
      const events = message.events ?? [];
      const touched = events.some(
        (event) => event.endsWith(".create") || event.endsWith(".update") || event.endsWith(".delete"),
      );
      if (touched) onChange();
    },
  );
}

export interface ThreadSet {
  athleteId: string;
  exerciseId: string;
  loadKg: number;
  reps: number;
  rpe: number | null;
  loggedAt: string;
  failed: boolean;
}

/**
 * The sets these threads hang off, for the Replies list's "Squat 180 × 3 @8".
 *
 * By id, in batches of a page, and only sets their athlete wrote. A set that
 * has gone -- deleted, or an athlete who has since unlinked -- is simply not
 * in the map, and the list says less rather than nothing.
 */
export async function fetchThreadSets(setIds: readonly string[]): Promise<Map<string, ThreadSet>> {
  const sets = new Map<string, ThreadSet>();
  const unique = [...new Set(setIds.filter(Boolean))];
  if (unique.length === 0) return sets;
  const { tables, databaseId } = browserAppwrite();
  for (let i = 0; i < unique.length; i += PAGE) {
    const page = await tables.listRows({
      databaseId,
      tableId: "sets",
      queries: [
        Query.equal("$id", unique.slice(i, i + PAGE)),
        Query.limit(PAGE),
        Query.select(["athlete_id", "exercise_id", "load_kg", "reps", "rpe", "logged_at", "failed"]),
      ],
    });
    for (const row of authenticRows("sets", page.rows)) {
      const raw = row as unknown as Record<string, unknown>;
      sets.set(row.$id, {
        athleteId: str(raw.athlete_id),
        exerciseId: str(raw.exercise_id),
        loadKg: typeof raw.load_kg === "number" ? raw.load_kg : 0,
        reps: typeof raw.reps === "number" ? raw.reps : 0,
        rpe: typeof raw.rpe === "number" ? raw.rpe : null,
        loggedAt: str(raw.logged_at),
        failed: raw.failed === true,
      });
    }
  }
  return sets;
}

/**
 * Whose set this is, for the deep link (`/coach/replies/<setId>`), or null
 * when the coach cannot read it -- deleted, never his athlete's, or an
 * athlete who has unlinked. Appwrite answers all three with a 404, and the
 * page says the same thing for each.
 */
export async function fetchSetOwner(setId: string): Promise<string | null> {
  if (!setId) return null;
  const { tables, databaseId } = browserAppwrite();
  try {
    const row = await tables.getRow({ databaseId, tableId: "sets", rowId: setId });
    const [authentic] = authenticRows("sets", [row as unknown as Record<string, unknown>]);
    return authentic ? str(authentic.athlete_id) || null : null;
  } catch {
    return null;
  }
}
