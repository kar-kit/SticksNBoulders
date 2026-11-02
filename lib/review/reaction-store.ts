"use client";

import { ID, Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import { browserWriteDeps } from "@/appwrite/documents/browser-writer";
import { authenticRows, changeReaction, reactToComment, removeReaction, type Actor } from "@/appwrite/documents";
import type { Comment } from "./comments";
import { toReaction, type Reaction, type ReactionPlan } from "./reactions";

/**
 * Reading and writing reactions (F25).
 *
 * Read by set id, in the same batch as the comments each screen already
 * loads, so a thread costs one more query however many messages and
 * reactions it has -- never one per comment. Written through the helper,
 * stamped like a comment, by whoever tapped.
 */

const PAGE = 100;
/** Six emoji, two or three people, a season of messages. Past this it wants paging, not a cap. */
const MAX_REACTIONS = 1000;

/**
 * Every reaction on these sets' messages, one query per hundred sets.
 *
 * Filtered for authorship here (`authenticRows`) and for consistency with the
 * comments on screen by the caller (`trustedReactions`), because only the
 * caller holds the comments.
 */
export async function fetchReactionsForSets(setIds: readonly string[]): Promise<Reaction[]> {
  const unique = [...new Set(setIds.filter(Boolean))];
  if (unique.length === 0) return [];

  const { tables, databaseId } = browserAppwrite();
  const reactions: Reaction[] = [];
  for (let i = 0; i < unique.length && reactions.length < MAX_REACTIONS; i += PAGE) {
    const page = await tables.listRows({
      databaseId,
      tableId: "comment_reactions",
      queries: [Query.equal("set_id", unique.slice(i, i + PAGE)), Query.limit(MAX_REACTIONS)],
    });
    // `author_id` is a claim; the stamp is the proof (provenance.ts).
    for (const row of authenticRows("comment_reactions", page.rows)) {
      const reaction = toReaction(row as unknown as Record<string, unknown> & { $id: string });
      if (reaction) reactions.push(reaction);
    }
  }
  return reactions;
}

/**
 * Reactions alongside comments: the empty list rather than a thrown error.
 *
 * A thread is the point of every screen that shows one; the chips under it
 * are not. A failed reaction read -- or an instance that has not had schema
 * v23 applied yet -- shows the words without chips rather than no words.
 */
export function fetchReactionsQuietly(setIds: readonly string[]): Promise<Reaction[]> {
  return fetchReactionsForSets(setIds).catch(() => [] as Reaction[]);
}

export type ReactOutcome = { ok: true; reaction: Reaction | null } | { ok: false };

export interface SendReactionRequest {
  plan: ReactionPlan;
  comment: Comment;
  viewerId: string;
  /** The client id a create is written at; the optimistic row already carries it. */
  newId: string;
}

const is409 = (error: unknown) => (error as { code?: unknown } | null)?.code === 409;

/**
 * Carries out one tap: create, change or remove.
 *
 * One recovery, for the one conflict that is not a failure. A create meets
 * the unique index on (comment_id, author_id) when this person already
 * reacted from another tab or device that this screen has not heard about.
 * They meant "make it this emoji", so the row that won is found and changed.
 * Anything else is a failure the screen reverts quietly.
 *
 * A remove that finds the row already gone is the outcome that was asked for.
 */
export async function sendReaction({ plan, comment, viewerId, newId }: SendReactionRequest): Promise<ReactOutcome> {
  const actor: Actor = { userId: viewerId };
  const createdAt = new Date();
  const deps = browserWriteDeps(() => newId, () => createdAt);
  try {
    switch (plan.kind) {
      case "remove":
        await removeReaction(deps, actor, plan.rowId).catch((error: unknown) => {
          if ((error as { code?: unknown } | null)?.code !== 404) throw error;
        });
        return { ok: true, reaction: null };
      case "change": {
        await changeReaction(deps, actor, { rowId: plan.rowId, athleteId: comment.athleteId, emoji: plan.emoji });
        return { ok: true, reaction: null };
      }
      case "create":
        try {
          await reactToComment(deps, actor, {
            commentId: comment.id,
            commentAuthorId: comment.authorId,
            setId: comment.setId,
            athleteId: comment.athleteId,
            emoji: plan.emoji,
            clientReactionId: newId,
          });
          return {
            ok: true,
            reaction: {
              id: newId,
              commentId: comment.id,
              setId: comment.setId,
              athleteId: comment.athleteId,
              authorId: viewerId,
              emoji: plan.emoji,
              createdAt: createdAt.toISOString(),
            },
          };
        } catch (error) {
          if (!is409(error)) throw error;
          const winner = await findMine(comment.id, viewerId);
          if (!winner) throw error;
          await changeReaction(deps, actor, { rowId: winner.id, athleteId: comment.athleteId, emoji: plan.emoji });
          return { ok: true, reaction: { ...winner, emoji: plan.emoji } };
        }
    }
  } catch {
    return { ok: false };
  }
}

/** This person's reaction on one message, read fresh. */
async function findMine(commentId: string, viewerId: string): Promise<Reaction | null> {
  const { tables, databaseId } = browserAppwrite();
  const page = await tables.listRows({
    databaseId,
    tableId: "comment_reactions",
    queries: [Query.equal("comment_id", commentId), Query.equal("author_id", viewerId), Query.limit(1)],
  });
  const row = authenticRows("comment_reactions", page.rows)[0];
  return row ? toReaction(row as unknown as Record<string, unknown> & { $id: string }) : null;
}

/** A fresh client id for a reaction about to be created. */
export const newReactionId = (): string => ID.unique();

