"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  authorLabel,
  checkComment,
  MAX_COMMENT_LENGTH,
  rejectionMessage,
  threadComments,
  type Comment,
} from "@/lib/review/comments";

/**
 * What the coach says, and what has already been said.
 *
 * The blueprint's one action is "Comment & next": posting and advancing are the
 * same keystroke, because a coach clearing twenty clips should barely touch the
 * mouse. Skip is still there for a clip that is simply fine.
 *
 * Cmd/Ctrl+Enter rather than plain Enter, and the reason is the textarea. The
 * queue and the player both listen for bare keys -- space to play, Enter to
 * clear -- and both deliberately ignore them while a field has focus, or a
 * coach could not type the word "space". So the posting shortcut has to be one
 * a text field does not already own.
 */

export interface CommentBoxProps {
  /** Cleared and refocused when this changes. */
  clipId: string;
  /** Already said about this clip, by either party. */
  comments: readonly Comment[];
  /** Names for whoever else is in the thread. */
  names: ReadonlyMap<string, string>;
  viewerId: string;
  /** Resolves false when the post was refused, so the draft is kept. */
  onPost: (body: string) => Promise<boolean>;
  onSkip: () => void;
  busy?: boolean;
}

const timeLabel = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

export function CommentBox({
  clipId,
  comments,
  names,
  viewerId,
  onPost,
  onSkip,
  busy = false,
}: CommentBoxProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [draftFor, setDraftFor] = useState(clipId);
  const box = useRef<HTMLTextAreaElement>(null);

  // A new clip is a new draft. Done during render rather than in an effect so
  // the coach never sees the previous clip's words under this one's video --
  // by the time an effect cleared them, the wrong text has already painted.
  if (draftFor !== clipId) {
    setDraftFor(clipId);
    setDraft("");
    setError(null);
  }

  useEffect(() => {
    // Focused on arrival: the coach's hands are already on the keyboard, and
    // the blueprint's whole ask is that they stay there.
    box.current?.focus();
  }, [clipId]);

  const post = async () => {
    const checked = checkComment(draft);
    if (!checked.ok) {
      setError(rejectionMessage(checked));
      return;
    }
    setError(null);
    const posted = await onPost(checked.body);
    // The draft survives a failure. A coach retyping their own feedback because
    // the network blinked is the worst outcome this screen has.
    if (!posted) setError("That didn't send. Your words are still here — try again.");
  };

  const threads = threadComments(comments);
  const remaining = MAX_COMMENT_LENGTH - draft.trim().length;

  return (
    <div className="flex flex-col gap-4">
      {threads.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h3 className="m-0 text-ui font-semibold text-muted">Already said</h3>
          {threads.map(({ comment, replies }) => (
            <div key={comment.id} className="flex flex-col gap-2">
              <Said comment={comment} names={names} viewerId={viewerId} />
              {replies.map((reply) => (
                <div key={reply.id} className="pl-5">
                  <Said comment={reply} names={names} viewerId={viewerId} />
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <label htmlFor="comment" className="sr-only">
          Your comment
        </label>
        <textarea
          id="comment"
          ref={box}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void post();
            }
          }}
          rows={3}
          placeholder="What did you see?"
          aria-invalid={error ? true : undefined}
          className={cn(
            "w-full resize-y rounded-control border bg-surface-2 p-3 text-body text-foreground",
            "placeholder:text-muted-2 focus:outline-none focus:ring-2 focus:ring-accent-line",
            error ? "border-danger-line" : "border-border",
          )}
        />

        <div className="flex items-center justify-between gap-3">
          <p className={cn("m-0 text-ui", error ? "text-foreground" : "text-muted-2")}>
            {error ?? "⌘/Ctrl + Enter posts and moves on."}
          </p>
          {remaining < 200 ? (
            <p className={cn("m-0 shrink-0 text-ui tabular-nums", remaining < 0 ? "text-foreground" : "text-muted-2")}>
              {remaining}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={() => void post()} disabled={busy}>
          Comment &amp; next
        </Button>
        <Button variant="secondary" onClick={onSkip} disabled={busy}>
          Skip
        </Button>
      </div>
    </div>
  );
}

function Said({
  comment,
  names,
  viewerId,
}: {
  comment: Comment;
  names: ReadonlyMap<string, string>;
  viewerId: string;
}) {
  return (
    <div className="rounded-control border border-border p-3">
      <p className="m-0 text-ui font-semibold text-muted">
        {/* The coach is reading an athlete here. Order 34 reads the other way
            and passes its own fallback. */}
        {authorLabel(comment, names, viewerId, "Your athlete")}
        <span className="font-medium text-muted-2"> · {timeLabel(comment.createdAt)}</span>
      </p>
      <p className="m-0 whitespace-pre-wrap text-body">{comment.body}</p>
    </div>
  );
}
