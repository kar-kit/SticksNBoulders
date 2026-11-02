"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Comment } from "./comments";
import { newReactionId, sendReaction } from "./reaction-store";
import {
  myReaction,
  planReaction,
  reactionAfter,
  reactionsByComment,
  replaceMine,
  trustedReactions,
  type Reaction,
  type ReactionEmoji,
} from "./reactions";

/** A failed tap's message, under the message it was on. */
export interface ReactionNotice {
  commentId: string;
  text: string;
}

/** Everything a thread needs to draw and take reactions. */
export interface ReactionControls {
  /** Trusted reactions, by comment id. */
  byComment: ReadonlyMap<string, readonly Reaction[]>;
  viewerId: string;
  /**
   * False where nobody would see a reaction: the athlete with no coach linked,
   * the same rule as the reply box. Chips still draw; nothing new can be left.
   */
  canReact: boolean;
  /** Comments with a tap in flight. Their picker waits, so taps cannot cross. */
  pending: ReadonlySet<string>;
  notice: ReactionNotice | null;
  onReact: (comment: Comment, emoji: ReactionEmoji) => void;
}

/** How long a failed tap's message stays. Long enough to read, short enough not to linger. */
const NOTICE_MS = 4000;
const FAILED = "That reaction didn't save. Try again.";

/**
 * The reaction state for one screen's threads, optimistic like the comment
 * patterns it sits beside.
 *
 * A tap draws at once. If the write is refused, the viewer's reaction on that
 * message goes back to exactly what it was and a small line says so -- no
 * toast, no modal, nothing blocking, because a reaction that did not land is
 * the least important failure on any of these screens.
 *
 * One tap per message at a time. A create, a change and a remove all address
 * the same row, and letting a second tap race the first could send a change
 * for a row whose create has not landed. A tap on another message is never
 * held up.
 *
 * The screen owns loading: it calls `setLoaded` with what it read alongside
 * its comments, so reactions cost no round trip of their own.
 */
export function useReactions({
  comments,
  viewerId,
  canReact = true,
}: {
  comments: readonly Comment[];
  viewerId: string;
  canReact?: boolean;
}) {
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<ReactionNotice | null>(null);
  const pendingRef = useRef(new Set<string>());
  // Read inside onReact without making it a dependency, so a thread's buttons
  // keep one stable handler while reactions change under them.
  const reactionsRef = useRef(reactions);
  useEffect(() => {
    reactionsRef.current = reactions;
  });

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const setPendingFor = useCallback((commentId: string, on: boolean) => {
    if (on) pendingRef.current.add(commentId);
    else pendingRef.current.delete(commentId);
    setPending(new Set(pendingRef.current));
  }, []);

  const onReact = useCallback(
    (comment: Comment, emoji: ReactionEmoji) => {
      if (!viewerId || comment.authorId === viewerId) return;
      if (pendingRef.current.has(comment.id)) return;

      const current = myReaction(reactionsRef.current, comment.id, viewerId);
      const plan = planReaction(current, emoji);
      const newId = newReactionId();
      const optimistic = reactionAfter(plan, current, comment, viewerId, newId, new Date());

      setNotice((was) => (was?.commentId === comment.id ? null : was));
      setPendingFor(comment.id, true);
      setReactions((all) => replaceMine(all, comment.id, viewerId, optimistic));

      void sendReaction({ plan, comment, viewerId, newId }).then((outcome) => {
        setPendingFor(comment.id, false);
        if (!outcome.ok) {
          // Back to exactly what was there before the tap, and only for this
          // message: anything else that changed meanwhile stays changed.
          setReactions((all) => replaceMine(all, comment.id, viewerId, current));
          setNotice({ commentId: comment.id, text: FAILED });
          return;
        }
        // A create that met an earlier reaction from another device comes
        // back carrying that row's id; adopt it so the next tap addresses it.
        if (outcome.reaction) {
          setReactions((all) => replaceMine(all, comment.id, viewerId, outcome.reaction));
        }
      });
    },
    [viewerId, setPendingFor],
  );

  const controls: ReactionControls = useMemo(
    () => ({
      byComment: reactionsByComment(trustedReactions(reactions, comments)),
      viewerId,
      canReact,
      pending,
      notice,
      onReact,
    }),
    [reactions, comments, viewerId, canReact, pending, notice, onReact],
  );

  return { controls, setLoaded: setReactions };
}
