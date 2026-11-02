/**
 * Reactions on comments (F25): which ones to believe, what to draw, and what
 * a tap means.
 *
 * Pure, so the three rules with teeth are testable without a browser:
 *
 *   1. One per person per message. Tapping a different emoji replaces yours;
 *      tapping the one you left takes it back. Never two, never a stack.
 *   2. Never on your own message. "I agree with myself" is noise on a screen
 *      whose whole job is a short exchange between two people.
 *   3. Quiet. Nothing here feeds an unread count, a "New" mark, a watermark
 *      or a notification -- those read comments, and a reaction is not one.
 *      Nothing in feedback.ts imports this file, and the test of rule 3 is
 *      that adding reactions to a thread changes none of those numbers.
 *
 * Joey's decisions, 2 Nov 2026. The emoji set itself lives in
 * appwrite/documents/reaction.ts, where the validator can reach it.
 */

import { isReactionEmoji, REACTION_EMOJIS, type ReactionEmoji } from "@/appwrite/documents/reaction";
import type { Comment } from "./comments";

export { REACTION_EMOJIS, REACTION_NAMES, isReactionEmoji, type ReactionEmoji } from "@/appwrite/documents/reaction";

export interface Reaction {
  id: string;
  commentId: string;
  /** Denormalised from the comment, and checked against it on read. */
  setId: string;
  athleteId: string;
  authorId: string;
  emoji: ReactionEmoji;
  /** ISO 8601, as Appwrite stores it. */
  createdAt: string;
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * A stored row as a reaction, or null when it cannot be one.
 *
 * An emoji outside the six is dropped here as well as deleted by validate-row
 * (provenance.ts, `contentProblem`): the Function is seconds behind a write,
 * and a reader that showed 🍆 for those seconds would have shown it.
 */
export function toReaction(raw: Record<string, unknown> & { $id: string }): Reaction | null {
  const commentId = str(raw.comment_id);
  const authorId = str(raw.author_id);
  if (!commentId || !authorId || !isReactionEmoji(raw.emoji)) return null;
  return {
    id: raw.$id,
    commentId,
    setId: str(raw.set_id),
    athleteId: str(raw.athlete_id),
    authorId,
    emoji: raw.emoji,
    createdAt: str(raw.created_at),
  };
}

const time = (iso: string): number => {
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
};

/**
 * The reactions a screen may draw, given the comments it is drawing.
 *
 * Provenance has already proved who wrote each row (`authenticRows`). What it
 * cannot prove is that the row is about what it says, because a reaction's
 * `set_id` and `athlete_id` are claims copied from the comment by whoever
 * wrote the reaction. So each one is held against the comment actually on
 * screen, and dropped when:
 *
 *   - its comment is not there. Withdrawn (validate-row removes these, but
 *     seconds later, and never if the Function is down), or simply not in
 *     the page that was read. A reaction to nothing is nothing to show.
 *   - it names another set or another athlete than its comment does.
 *   - its author wrote the comment. The helper refuses this; the row cannot,
 *     because Appwrite has no constraint across two tables.
 *
 * And if one person somehow has two on one message -- the unique index makes
 * that impossible on the instance, but optimistic state and a racing reload
 * could briefly disagree -- the newer one wins, so a screen never shows a
 * person twice.
 */
export function trustedReactions(
  reactions: readonly Reaction[],
  comments: readonly Comment[],
): Reaction[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const kept = new Map<string, Reaction>();
  for (const reaction of reactions) {
    const comment = byId.get(reaction.commentId);
    if (!comment) continue;
    if (reaction.setId !== comment.setId || reaction.athleteId !== comment.athleteId) continue;
    if (reaction.authorId === comment.authorId) continue;
    const key = `${reaction.commentId}\u0000${reaction.authorId}`;
    const already = kept.get(key);
    if (!already || time(reaction.createdAt) > time(already.createdAt)) kept.set(key, reaction);
  }
  return [...kept.values()];
}

/** Reactions grouped by the comment they are on. */
export function reactionsByComment(reactions: readonly Reaction[]): Map<string, Reaction[]> {
  const grouped = new Map<string, Reaction[]>();
  for (const reaction of reactions) {
    const list = grouped.get(reaction.commentId);
    if (list) list.push(reaction);
    else grouped.set(reaction.commentId, [reaction]);
  }
  return grouped;
}

/** This viewer's reaction on one message, or null. */
export function myReaction(
  reactions: readonly Reaction[],
  commentId: string,
  viewerId: string,
): Reaction | null {
  return reactions.find((r) => r.commentId === commentId && r.authorId === viewerId) ?? null;
}

export interface ReactionChip {
  emoji: ReactionEmoji;
  count: number;
  /** The viewer's own, drawn highlighted. */
  mine: boolean;
}

/**
 * The chips under one message: one per emoji anyone used, in Joey's order
 * rather than by count, so a chip does not jump sideways under a thumb when
 * somebody else's reaction lands. With two people in a thread a count is
 * almost always 1; it is still shown, because a circle can hold two coaches.
 */
export function reactionChips(onComment: readonly Reaction[], viewerId: string): ReactionChip[] {
  return REACTION_EMOJIS.flatMap((emoji) => {
    const those = onComment.filter((r) => r.emoji === emoji);
    if (those.length === 0) return [];
    return [{ emoji, count: those.length, mine: those.some((r) => r.authorId === viewerId) }];
  });
}

/** Who may react to a message: anyone but the person who wrote it. */
export function canReactTo(comment: Comment, viewerId: string): boolean {
  return Boolean(viewerId) && comment.authorId !== viewerId;
}

/**
 * What a tap on an emoji means, given what the viewer already left.
 *
 * - nothing there: create one
 * - the same emoji: take it back (the toggle)
 * - a different one: replace it, as an update of the same row
 */
export type ReactionPlan =
  | { kind: "create"; emoji: ReactionEmoji }
  | { kind: "change"; rowId: string; emoji: ReactionEmoji }
  | { kind: "remove"; rowId: string };

export function planReaction(current: Reaction | null, tapped: ReactionEmoji): ReactionPlan {
  if (!current) return { kind: "create", emoji: tapped };
  if (current.emoji === tapped) return { kind: "remove", rowId: current.id };
  return { kind: "change", rowId: current.id, emoji: tapped };
}

/**
 * The list with the viewer's reaction on one message set to `next` (or
 * removed, for null), everything else untouched.
 *
 * The optimistic step and its undo are both this: apply the planned reaction
 * before the round trip, and on a refusal put back exactly what was there.
 */
export function replaceMine(
  reactions: readonly Reaction[],
  commentId: string,
  viewerId: string,
  next: Reaction | null,
): Reaction[] {
  const others = reactions.filter((r) => !(r.commentId === commentId && r.authorId === viewerId));
  return next ? [...others, next] : others;
}

/**
 * The reaction a plan leaves behind, for the optimistic draw. `newId` is the
 * client id a create will be written at, so the row on screen and the row on
 * the instance are the same row and a later tap can change or remove it.
 */
export function reactionAfter(
  plan: ReactionPlan,
  current: Reaction | null,
  comment: Comment,
  viewerId: string,
  newId: string,
  now: Date,
): Reaction | null {
  switch (plan.kind) {
    case "remove":
      return null;
    case "change":
      // Keeps its id and when it was first left; only the emoji moves, as
      // `changeReaction` writes it.
      return current ? { ...current, emoji: plan.emoji } : null;
    case "create":
      return {
        id: newId,
        commentId: comment.id,
        setId: comment.setId,
        athleteId: comment.athleteId,
        authorId: viewerId,
        emoji: plan.emoji,
        createdAt: now.toISOString(),
      };
  }
}

/** What a screen reader hears for a chip: "fire, 1", "fire, yours", "fire, 2 including yours". */
export function chipLabel(chip: ReactionChip, name: string): string {
  if (!chip.mine) return `${name}, ${chip.count}`;
  return chip.count === 1 ? `${name}, yours` : `${name}, ${chip.count} including yours`;
}
