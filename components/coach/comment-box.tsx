"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { CommentThread } from "@/components/video/comment-thread";
import { checkComment, MAX_COMMENT_LENGTH, rejectionMessage, type Comment } from "@/lib/review/comments";
import type { ReactionControls } from "@/lib/review/use-reactions";

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
 *
 * Also the reply box in Athlete View's clip dialog (F26 follow-up), so a coach
 * can answer a thread on a clip he has already cleared. Same component, same
 * checks, same write: the dialog passes no `onSkip`, its own button label and
 * hint, and no autofocus, since there the player owns the keyboard on open.
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
  /** The queue's Skip. Omitted where there is nothing to skip to (the clip dialog). */
  onSkip?: () => void;
  busy?: boolean;
  /** The post button. The queue's is "Comment & next". */
  postLabel?: string;
  /** Under the box, on a desktop. */
  hint?: string;
  /** Focus the box on arrival. The queue does; the clip dialog does not. */
  autoFocus?: boolean;
  /**
   * F25: reactions on what was already said. A 👍 on the athlete's reply is
   * how a coach clearing twenty clips says "seen" without writing a word.
   */
  reactions?: ReactionControls;
}

export function CommentBox({
  clipId,
  comments,
  names,
  viewerId,
  onPost,
  onSkip,
  busy = false,
  reactions,
  postLabel = "Comment & next",
  hint = "⌘/Ctrl + Enter posts and moves on.",
  autoFocus = true,
}: CommentBoxProps) {
  const fieldId = useId();
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
    // the blueprint's whole ask is that they stay there. Not on a phone, where
    // focusing would scroll past the video and can raise the keyboard over it.
    if (!autoFocus) return;
    if (window.matchMedia?.("(max-width: 47.98rem)").matches) return;
    box.current?.focus();
  }, [clipId, autoFocus]);

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
    // Sent: the box empties. The queue moves to the next clip anyway; the
    // clip dialog stays on this one, under the comment just posted.
    else setDraft("");
  };

  const remaining = MAX_COMMENT_LENGTH - draft.trim().length;

  return (
    <div className="flex flex-col gap-4">
      <CommentThread comments={comments} names={names} viewerId={viewerId} reactions={reactions} />

      <div className="flex flex-col gap-2">
        <label htmlFor={fieldId} className="sr-only">
          Your comment
        </label>
        <textarea
          id={fieldId}
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
            // 16px below md: iOS Safari zooms the page on focus under that.
            "w-full resize-y rounded-control border bg-surface-2 p-3 text-[16px]/[1.6] text-foreground transition-control md:text-body",
            "placeholder:text-muted-2 focus:outline-none focus:ring-2 focus:ring-accent-line",
            error ? "border-danger-line" : "border-border",
          )}
        />

        <div className="flex items-center justify-between gap-3">
          <p className={cn("m-0 text-ui", error ? "text-foreground" : "text-muted-2")}>
            {error ?? <span className="hidden md:inline">{hint}</span>}
          </p>
          {remaining < 200 ? (
            <p className={cn("m-0 shrink-0 text-ui tabular-nums", remaining < 0 ? "text-foreground" : "text-muted-2")}>
              {remaining}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void post()} disabled={busy} className="flex-1 md:flex-none">
          {postLabel}
        </Button>
        {onSkip ? (
          <Button variant="secondary" onClick={onSkip} disabled={busy}>
            Skip
          </Button>
        ) : null}
      </div>
    </div>
  );
}
