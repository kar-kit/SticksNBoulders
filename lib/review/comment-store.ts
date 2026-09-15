"use client";

import { ID, Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import { browserWriteDeps } from "@/appwrite/documents/browser-writer";
import { deleteComment, postComment, type Actor } from "@/appwrite/documents";
import { checkComment, type Comment, type CommentRejection } from "./comments";

/**
 * Reading and writing comments.
 *
 * Both parties read through the circle team and write stamped with it, so there
 * is no branch here for who is asking -- the coach opening a thread and the
 * athlete replying at Order 34 use the same two functions.
 */

const PAGE = 100;
/** A season of feedback on one lift. Past this the thread wants paging, not a cap. */
const MAX_COMMENTS = 500;

const str = (value: unknown): string => (typeof value === "string" ? value : "");

function toComment(raw: Record<string, unknown> & { $id: string }): Comment | null {
  const setId = str(raw.set_id);
  const body = str(raw.body);
  // A comment with no set to hang on, or nothing said, cannot be rendered
  // anywhere useful. Dropped rather than shown as an empty bubble.
  if (!setId || !body) return null;
  return {
    id: raw.$id,
    setId,
    athleteId: str(raw.athlete_id),
    authorId: str(raw.author_id),
    body,
    parentId: str(raw.parent_id) || null,
    createdAt: str(raw.created_at),
  };
}

/**
 * Every comment on these sets, in one query.
 *
 * Takes a batch because the Review Queue needs to know which clips have already
 * been spoken about before the coach opens any of them -- a clip they commented
 * on last Sunday should say so rather than presenting an empty box.
 */
export async function fetchCommentsForSets(setIds: readonly string[]): Promise<Comment[]> {
  const unique = [...new Set(setIds.filter(Boolean))];
  if (unique.length === 0) return [];

  const { tables, databaseId } = browserAppwrite();
  const comments: Comment[] = [];

  for (let i = 0; i < unique.length && comments.length < MAX_COMMENTS; i += PAGE) {
    const page = await tables.listRows({
      databaseId,
      tableId: "set_comments",
      queries: [
        Query.equal("set_id", unique.slice(i, i + PAGE)),
        Query.orderAsc("created_at"),
        Query.limit(MAX_COMMENTS),
      ],
    });
    for (const row of page.rows) {
      const comment = toComment(row as unknown as Record<string, unknown> & { $id: string });
      if (comment) comments.push(comment);
    }
  }

  return comments;
}

/**
 * This athlete's feedback, newest first, across every set.
 *
 * Its own query rather than a filter over the queue's, because the coach's
 * Athlete View shows an athlete they may have cleared everything for -- the
 * thread outlives the clip's time in the queue, which is the point of anchoring
 * it to the set rather than to a review.
 *
 * Ordered on `created_at` rather than on `$id`: unlike the rest of this
 * product, a comment's useful order is when it was said, and both parties
 * write here so id order and time order can genuinely disagree.
 */
export async function fetchCommentsForAthlete(
  athleteId: string,
  limit = 20,
): Promise<Comment[]> {
  if (!athleteId) return [];
  const { tables, databaseId } = browserAppwrite();
  const page = await tables.listRows({
    databaseId,
    tableId: "set_comments",
    queries: [
      Query.equal("athlete_id", athleteId),
      Query.orderDesc("created_at"),
      Query.limit(limit),
    ],
  });
  return page.rows
    .map((row) => toComment(row as unknown as Record<string, unknown> & { $id: string }))
    .filter((comment): comment is Comment => comment !== null);
}

export type PostOutcome = { ok: true; comment: Comment } | CommentRejection | { ok: false; reason: "failed" };

export interface PostCommentRequest {
  athleteId: string;
  setId: string;
  authorId: string;
  body: string;
  parentId?: string | null;
}

/**
 * Posts a comment, checking it first.
 *
 * Validated before the round trip so an over-long paragraph is refused while
 * the coach still has it in front of them, rather than after Appwrite has said
 * no and they have moved to the next clip.
 *
 * The returned comment is built locally rather than re-read. The row that
 * matters is already written; a second query to see what we just sent is a
 * round trip on a screen measured by how fast it clears.
 */
export async function submitComment(request: PostCommentRequest): Promise<PostOutcome> {
  const checked = checkComment(request.body);
  if (!checked.ok) return checked;

  const clientCommentId = ID.unique();
  const actor: Actor = { userId: request.authorId };
  const createdAt = new Date();

  try {
    await postComment(browserWriteDeps(() => clientCommentId, () => createdAt), actor, {
      athleteId: request.athleteId,
      setId: request.setId,
      body: checked.body,
      parentId: request.parentId ?? null,
      clientCommentId,
    });
  } catch {
    return { ok: false, reason: "failed" };
  }

  return {
    ok: true,
    comment: {
      id: clientCommentId,
      setId: request.setId,
      athleteId: request.athleteId,
      authorId: request.authorId,
      body: checked.body,
      parentId: request.parentId ?? null,
      createdAt: createdAt.toISOString(),
    },
  };
}

/** Withdraws a comment. Appwrite refuses unless the caller wrote it. */
export async function withdrawComment(authorId: string, commentId: string): Promise<void> {
  await deleteComment(browserWriteDeps(() => ""), { userId: authorId }, commentId);
}
