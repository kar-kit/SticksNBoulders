"use client";

import { authorLabel, threadComments, type Comment } from "@/lib/review/comments";
import type { ReactionControls } from "@/lib/review/use-reactions";
import { Reactable } from "./comment-reactions";

const timeLabel = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

/**
 * What has already been said about one clip, threaded one level deep.
 *
 * Its own export so the Athlete View's clip dialog draws a thread with these
 * exact words and this exact layout rather than a second rendering of the
 * same rows (Joey, 16 Oct 2026: reuse the queue's components). Its own file
 * since F13, when the athlete's Clips gallery started drawing it too; the
 * athlete passes "Your coach" as the fallback for an unnamed other party. Renders
 * nothing for a clip nobody has spoken about; the caller says so in its own
 * words, since "nothing yet" means different things in the queue and on the
 * athlete's page.
 *
 * Reactions (F25) hang under each message when the caller passes `reactions`,
 * on all three screens at once because they all draw this. Without it the
 * thread is exactly as it was.
 */
export function CommentThread({
  comments,
  names,
  viewerId,
  fallbackName = "Your athlete",
  reactions,
}: {
  comments: readonly Comment[];
  names: ReadonlyMap<string, string>;
  viewerId: string;
  /** Who an unnamed other author is: the coach reads "Your athlete", the athlete "Your coach". */
  fallbackName?: string;
  /** The screen's reaction state (lib/review/use-reactions.ts), or none to draw no reactions. */
  reactions?: ReactionControls;
}) {
  const threads = threadComments(comments);
  if (threads.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      <h3 className="m-0 text-ui font-semibold text-muted">Already said</h3>
      {threads.map(({ comment, replies }) => (
        <div key={comment.id} className="flex flex-col gap-2">
          <Said comment={comment} names={names} viewerId={viewerId} fallbackName={fallbackName} reactions={reactions} />
          {replies.map((reply) => (
            <div key={reply.id} className="pl-5">
              <Said comment={reply} names={names} viewerId={viewerId} fallbackName={fallbackName} reactions={reactions} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Said({
  comment,
  names,
  viewerId,
  fallbackName,
  reactions,
}: {
  comment: Comment;
  names: ReadonlyMap<string, string>;
  viewerId: string;
  fallbackName: string;
  reactions?: ReactionControls;
}) {
  const author = authorLabel(comment, names, viewerId, fallbackName);
  return (
    <Reactable comment={comment} controls={reactions} authorName={author}>
      <div className="rounded-control border border-border p-3">
        <p className="m-0 text-ui font-semibold text-muted">
          {author}
          <span className="font-medium text-muted-2"> · {timeLabel(comment.createdAt)}</span>
        </p>
        <p className="m-0 whitespace-pre-wrap text-body">{comment.body}</p>
      </div>
    </Reactable>
  );
}
