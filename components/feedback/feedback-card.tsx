"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  authorLabel,
  checkComment,
  MAX_COMMENT_LENGTH,
  rejectionMessage,
  type Comment,
} from "@/lib/review/comments";
import { isUnread, type FeedbackCard as Card, type FeedbackSet } from "@/lib/review/feedback";
import { formatWeight } from "@/lib/units";

/**
 * One set, what was said about it, and a way to answer.
 *
 * The numbers sit above the words because they are the context the coach was
 * reacting to -- "hips shot up on the second rep" means nothing without
 * "180 x 3 @ 8" beside it, and that pairing is the whole reason feedback is
 * anchored to the set rather than sent as a message.
 *
 * The reply box is small on purpose. The blueprint: "not a chat product, no
 * typing indicators, no read receipts". A real conversation still has
 * WhatsApp.
 */

export interface FeedbackCardProps {
  card: Card;
  exerciseName: string;
  clipUrl: string | null;
  names: ReadonlyMap<string, string>;
  viewerId: string;
  /** The watermark from before this visit, so this visit's new comments stay marked. */
  seenAt: string | null;
  /** False once the athlete has no coach: nobody would read the reply. */
  canReply: boolean;
  onReply: (card: Card, body: string) => Promise<boolean>;
  onClipError: (fileId: string) => void;
}

const dateLabel = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
};

const shortDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

export function SetContext({ set, exerciseName }: { set: FeedbackSet; exerciseName: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="m-0 text-ui text-muted">
        {exerciseName} · {dateLabel(set.loggedAt)} · {set.isWarmup ? "Warm-up" : `Set ${set.setIndex}`}
      </p>
      <p className="m-0 text-title font-bold tabular-nums">
        {formatWeight(set.loadKg, "kg")} × {set.reps}{" "}
        <span className="text-body font-semibold text-muted">
          {set.rpe === null ? "RPE —" : `RPE ${set.rpe}`}
        </span>
      </p>
    </div>
  );
}

export function FeedbackCard({
  card,
  exerciseName,
  clipUrl,
  names,
  viewerId,
  seenAt,
  canReply,
  onReply,
  onClipError,
}: FeedbackCardProps) {
  const { set } = card;
  const label = set ? `${exerciseName}, ${dateLabel(set.loggedAt)}` : "A set that has since been deleted";

  return (
    <article
      aria-label={label}
      className="flex flex-col gap-3 rounded-control border border-border bg-surface p-[14px]"
    >
      <div className="flex items-start justify-between gap-3">
        {set ? (
          <Link href={`/history/${set.sessionId}`} className="min-w-0 flex-1" aria-label={`Open ${label} in its session`}>
            <SetContext set={set} exerciseName={exerciseName} />
          </Link>
        ) : (
          // The athlete deleted the set after the coach spoke. The words are
          // still worth reading; there is just nothing to hang them on.
          <p className="m-0 text-ui text-muted">This set was deleted from your log.</p>
        )}
        {card.unread > 0 ? (
          <span className="flex flex-none items-center gap-1.5 text-ui font-semibold text-accent-fill">
            <span aria-hidden className="size-2 rounded-full bg-accent-fill" />
            New
          </span>
        ) : null}
      </div>

      {set?.notes ? <p className="m-0 text-ui text-muted">Your note: “{set.notes}”</p> : null}

      {set?.videoFileId ? (
        clipUrl ? (
          <video
            src={clipUrl}
            controls
            playsInline
            preload="metadata"
            aria-label={`Clip of ${label}`}
            onError={() => onClipError(set.videoFileId!)}
            className="aspect-video w-full rounded-control bg-black"
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center rounded-control bg-surface-2 text-ui text-muted-2">
            Loading clip…
          </div>
        )
      ) : null}

      <div className="flex flex-col gap-2">
        {card.threads.map(({ comment, replies }) => (
          <div key={comment.id} className="flex flex-col gap-2">
            <Said comment={comment} names={names} viewerId={viewerId} seenAt={seenAt} />
            {replies.map((reply) => (
              <div key={reply.id} className="pl-5">
                <Said comment={reply} names={names} viewerId={viewerId} seenAt={seenAt} />
              </div>
            ))}
          </div>
        ))}
      </div>

      {canReply ? <ReplyBox label={label} onSend={(body) => onReply(card, body)} /> : null}
    </article>
  );
}

function Said({
  comment,
  names,
  viewerId,
  seenAt,
}: {
  comment: Comment;
  names: ReadonlyMap<string, string>;
  viewerId: string;
  seenAt: string | null;
}) {
  const fresh = isUnread(comment, viewerId, seenAt);
  return (
    <div className={cn("rounded-control border p-3", fresh ? "border-accent-line" : "border-border")}>
      <p className="m-0 text-ui font-semibold text-muted">
        {/* The athlete is reading their coach here -- the other direction
            from the Review Queue, so the fallback is the coach. */}
        {authorLabel(comment, names, viewerId, "Your coach")}
        <span className="font-medium text-muted-2"> · {shortDate(comment.createdAt)}</span>
      </p>
      <p className="m-0 whitespace-pre-wrap text-body">{comment.body}</p>
    </div>
  );
}

function ReplyBox({ label, onSend }: { label: string; onSend: (body: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const send = async () => {
    const checked = checkComment(draft);
    if (!checked.ok) {
      setError(rejectionMessage(checked));
      return;
    }
    setError(null);
    setSending(true);
    const sent = await onSend(checked.body);
    setSending(false);
    // The draft survives a failure. Retyping a reply because the gym wifi
    // blinked is the thing this box must never make anyone do.
    if (sent) setDraft("");
    else setError("That didn't send. Your reply is still here — try again.");
  };

  const remaining = MAX_COMMENT_LENGTH - draft.trim().length;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={1}
          placeholder="Reply"
          aria-label={`Reply about ${label}`}
          aria-invalid={error ? true : undefined}
          className={cn(
            "min-h-[44px] flex-1 resize-none rounded-control border bg-surface-2 px-3 py-2.5 text-body text-foreground",
            "placeholder:text-muted-2 focus:outline-none focus:ring-2 focus:ring-accent-line",
            error ? "border-danger-line" : "border-border",
          )}
        />
        <Button onClick={() => void send()} disabled={sending || draft.trim().length === 0}>
          {sending ? "Sending…" : "Send"}
        </Button>
      </div>
      {error ? (
        <p className="m-0 text-ui text-foreground" role="status">
          {error}
        </p>
      ) : remaining < 200 ? (
        <p className={cn("m-0 text-ui tabular-nums", remaining < 0 ? "text-foreground" : "text-muted-2")}>
          {remaining} characters left
        </p>
      ) : null}
    </div>
  );
}
