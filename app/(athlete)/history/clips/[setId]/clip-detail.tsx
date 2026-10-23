"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PendingDot } from "@/components/ui/sync-mark";
import { ClipPlayer } from "@/components/video/clip-player";
import { CommentThread } from "@/components/video/comment-thread";
import { ReplyBox, SetContext } from "@/components/feedback/feedback-card";
import { AttachVideo } from "@/components/logging/attach-video";
import { SetNoteField } from "@/components/logging/set-note-field";
import { useSession } from "@/lib/auth/session-context";
import { fetchMyCoach, type MyCoach } from "@/lib/coach/link-store";
import { useExerciseLibrary } from "@/lib/exercises/library-context";
import { editSet } from "@/lib/logging/set-store";
import { noteOf } from "@/lib/logging/set-note";
import type { RpeValue } from "@/lib/logging/set";
import { subscribeToQueue } from "@/lib/offline/client";
import type { QueuedOp } from "@/lib/offline/queue";
import { fetchCommentsForSets, submitComment } from "@/lib/review/comment-store";
import type { Comment } from "@/lib/review/comments";
import { nextSeenAt, type FeedbackSet } from "@/lib/review/feedback";
import { useFeedbackBadge } from "@/lib/review/feedback-context";
import type { ClipSet } from "@/lib/review/queue";
import { fetchClipUrls } from "@/lib/review/queue-store";
import { haptic } from "@/lib/ui/haptics";
import { deleteMyClip, fetchMyClip, retireReplacedClip } from "@/lib/video/my-clips-store";
import { pendingClipIds, replyParentFor, withQueuedClipState } from "@/lib/video/my-clips";
import type { UploadResult } from "@/lib/video/upload";

/**
 * One of the athlete's own clips (F13): the player, the set it is on, their
 * note, and what the coach said, with a way to answer.
 *
 * Built from the coach's own parts, so a clip plays and a thread reads the
 * same on both sides: `ClipPlayer` (speeds, loop, frame steps, the ticket
 * refresh) and `CommentThread`. The reply is the Feedback screen's
 * `ReplyBox`, posting through the same `submitComment` with the same parent
 * rule; the note is the History row edit's `SetNoteField`, saved through
 * `editSet`; Replace is the Log's `AttachVideo`, poster capture and all.
 *
 * Delete and Replace both take the old file away, through the queue, only
 * once the set no longer names it (lib/video/my-clips-store.ts). The set, its
 * numbers, the note and the coach's comments stay either way.
 *
 * Reading the thread here counts as reading it (F15): the coach's comments on
 * THIS clip stop lighting the Coach Feedback dot, through the same
 * device-local read marks the Feedback screen keeps. Other clips' unread
 * comments are untouched.
 */

type Load =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "failed" }
  | { status: "ready"; clip: ClipSet; comments: Comment[] };

const BACK = "/history?view=clips";

const ATHLETE_FAILED =
  "This clip would not play. If you filmed it just now it may still be uploading, or you may be offline.";

export function ClipDetail({ setId }: { setId: string }) {
  const router = useRouter();
  const { state: session } = useSession();
  const { state: library } = useExerciseLibrary();
  const viewerId = session.status === "signed-in" ? session.user.id : "";
  const { markSetSeen } = useFeedbackBadge();

  const [load, setLoad] = useState<Load>({ status: "loading" });
  /** Undefined until known, or when the lookup failed; null with no coach. */
  const [coach, setCoach] = useState<MyCoach | null | undefined>(undefined);
  const [ops, setOps] = useState<QueuedOp[]>([]);
  const [src, setSrc] = useState<{ fileId: string; url: string | null } | null>(null);
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** A replacement uploading from this screen; Delete waits for it. */
  const [uploading, setUploading] = useState(false);

  useEffect(() => subscribeToQueue(setOps), []);

  const read = useCallback(async (): Promise<Load> => {
    try {
      const clip = await fetchMyClip(viewerId, setId);
      if (!clip) return { status: "missing" };
      // The thread is the context, not the point: a failed read shows the
      // clip without it rather than nothing at all.
      const comments = await fetchCommentsForSets([clip.id]).catch(() => [] as Comment[]);
      return { status: "ready", clip, comments };
    } catch {
      return { status: "failed" };
    }
  }, [viewerId, setId]);

  useEffect(() => {
    if (!viewerId) return;
    let cancelled = false;
    void read().then((next) => {
      if (!cancelled) setLoad(next);
    });
    void fetchMyCoach()
      .then((found) => {
        if (!cancelled) setCoach(found);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [viewerId, read]);

  // The thread is on screen once the clip has loaded, so that is the read.
  // Up to the newest comment from the coach, never a clock: a comment written
  // while this screen was open but not shown on it stays unread.
  const readThrough =
    load.status === "ready" && viewerId ? nextSeenAt(load.comments, viewerId, null) : null;
  const readSetId = load.status === "ready" ? load.clip.id : "";
  useEffect(() => {
    if (readSetId && readThrough) markSetSeen(readSetId, readThrough);
  }, [readSetId, readThrough, markSetSeen]);

  const retry = () => {
    setLoad({ status: "loading" });
    void read().then(setLoad);
  };

  // What the queue will make of it: a note edited, or a clip replaced, with
  // no signal shows as done. A clip deleted offline reads as gone.
  const clip = useMemo(() => {
    if (load.status !== "ready") return null;
    return withQueuedClipState([load.clip], ops)[0] ?? null;
  }, [load, ops]);
  const pending = useMemo(() => pendingClipIds(ops).has(setId), [ops, setId]);
  const fileId = clip?.videoFileId ?? null;

  // A ticket per open, for this clip only. Re-minted when Replace swaps the file.
  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    void fetchClipUrls([fileId])
      .catch(() => new Map<string, string>())
      .then((urls) => {
        if (!cancelled) setSrc({ fileId, url: urls.get(fileId) ?? null });
      });
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  const refreshSrc = async (): Promise<boolean> => {
    if (!fileId) return false;
    const urls = await fetchClipUrls([fileId]).catch(() => new Map<string, string>());
    const url = urls.get(fileId);
    if (!url) return false;
    setSrc({ fileId, url });
    return true;
  };

  const names = useMemo(
    () => new Map(coach?.coachName ? [[coach.coachId, coach.coachName] as const] : []),
    [coach],
  );

  const exerciseName = useMemo(() => {
    if (!clip) return "";
    return library.exercises.find((exercise) => exercise.id === clip.exerciseId)?.name ?? "Exercise";
  }, [clip, library.exercises]);

  if (!viewerId) return null;

  const back = (
    <Button variant="ghost" size="sm" onClick={() => router.push(BACK)} aria-label="Back to Clips">
      ← Clips
    </Button>
  );

  if (load.status === "loading") {
    return (
      <div className="pt-8 flex flex-1 flex-col gap-5 pb-6">
        <header className="flex flex-col items-start gap-1">{back}</header>
        <p className="m-0 text-ui text-muted" aria-busy>
          Loading the clip…
        </p>
      </div>
    );
  }

  if (load.status === "failed") {
    return (
      <div className="pt-8 flex flex-1 flex-col gap-5 pb-6">
        <header className="flex flex-col items-start gap-1">{back}</header>
        <EmptyState
          title="Couldn't load this clip"
          body="Nothing is lost. It will be here when you have signal."
          action={
            <Button variant="secondary" onClick={retry}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  if (load.status === "missing" || !clip) {
    return (
      <div className="pt-8 flex flex-1 flex-col gap-5 pb-6">
        <header className="flex flex-col items-start gap-1">{back}</header>
        <EmptyState
          title="This clip isn't here"
          body="It may have been deleted. Your other clips are in History."
        />
      </div>
    );
  }

  const set: FeedbackSet = {
    id: clip.id,
    sessionId: clip.sessionId,
    exerciseId: clip.exerciseId,
    setIndex: clip.setIndex,
    loadKg: clip.loadKg,
    reps: clip.reps,
    rpe: clip.rpe,
    isWarmup: clip.isWarmup === true,
    loggedAt: clip.loggedAt,
    videoFileId: clip.videoFileId,
    notes: clip.notes,
  };
  const comments = load.comments;
  const fromCoach = comments.some((comment) => comment.authorId !== viewerId);
  const parentId = replyParentFor(comments);
  const current = src?.fileId === fileId ? src : null;
  const setLabel = clip.isWarmup ? "Warm-up set" : `Set ${clip.setIndex}`;

  const saveNote = async () => {
    setBusy(true);
    setNotice(null);
    try {
      // Restates the set's values as they stand, warm-up flag included, so
      // the note edit cannot change what was lifted (lib/logging/set-store.ts).
      await editSet(
        clip.id,
        {
          loadKg: clip.loadKg,
          reps: clip.reps,
          rpe: clip.rpe as RpeValue | null,
          isWarmup: clip.isWarmup === true,
          notes: noteOf(noteDraft),
        },
        { exerciseId: clip.exerciseId, loggedAt: new Date(clip.loggedAt) },
      );
      // Kept on screen after the queue drains too, when the overlay stops
      // applying and the copy read on open would otherwise come back.
      const notes = noteOf(noteDraft);
      setLoad((was) => (was.status === "ready" ? { ...was, clip: { ...was.clip, notes } } : was));
      setEditingNote(false);
    } catch {
      setNotice("That note wasn't saved — this phone couldn't store it. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const reply = async (body: string): Promise<boolean> => {
    const outcome = await submitComment({ athleteId: viewerId, setId: clip.id, authorId: viewerId, body, parentId });
    if (!outcome.ok) return false;
    setLoad((was) => (was.status === "ready" ? { ...was, comments: [...was.comments, outcome.comment] } : was));
    return true;
  };

  const remove = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await deleteMyClip(clip.id, clip.videoFileId);
    } catch {
      setBusy(false);
      setConfirmingDelete(false);
      setNotice("That clip wasn't deleted — this phone couldn't store the change. Try again.");
      return;
    }
    router.push(BACK);
  };

  const replaced = (result: UploadResult) => {
    // Only once the new clip's attach is queued: before that the set still
    // names the old file and the cleanup would keep it for good. A clip still
    // uploading leaves the old one in place; the orphan sweep has it later.
    if (result.ok && result.fileId !== clip.videoFileId) {
      const old = clip.videoFileId;
      // The new file from here on, whether or not its attach has landed yet.
      // Its poster is unknown here, so the placeholder until the next read.
      setLoad((was) =>
        was.status === "ready"
          ? { ...was, clip: { ...was.clip, videoFileId: result.fileId, videoPosterId: null } }
          : was,
      );
      void retireReplacedClip(clip.id, old).catch(() => {});
    }
  };

  return (
    <div className="pt-8 flex flex-1 flex-col gap-5 pb-6">
      <header className="flex flex-col items-start gap-1">
        {back}
        <h1 className="m-0 flex items-center gap-2 text-display font-semibold">
          {exerciseName}
          {pending ? <PendingDot /> : null}
        </h1>
        <Link
          href={`/history/${clip.sessionId}`}
          className="min-w-0 self-stretch no-underline"
          aria-label={`Open the session for ${exerciseName}, ${setLabel.toLowerCase()}`}
        >
          <SetContext set={set} exerciseName={exerciseName} />
        </Link>
      </header>

      {notice ? (
        <div role="status" className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface p-3">
          <p className="m-0 text-caption text-foreground">{notice}</p>
          <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
            OK
          </Button>
        </div>
      ) : null}

      <ClipPlayer
        src={current?.url ?? null}
        clipId={`${clip.id}:${clip.videoFileId}`}
        // No window-wide keys here: Space must press Delete, Save or Send.
        shortcuts="none"
        refreshSrc={refreshSrc}
        failedMessage={ATHLETE_FAILED}
        unavailable={
          current && current.url === null
            ? "The video couldn't be loaded. Check your signal and open it again."
            : undefined
        }
      />

      <section aria-labelledby="clip-note" className="flex flex-col gap-2">
        <h2 id="clip-note" className="m-0 font-mono text-label uppercase text-muted-2">
          Your note
        </h2>
        {editingNote ? (
          <>
            <SetNoteField value={noteDraft} onChange={setNoteDraft} setLabel={setLabel} autoFocus />
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setEditingNote(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={() => void saveNote()} disabled={busy}>
                Save note
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-start justify-between gap-3">
            {clip.notes ? (
              <p className="m-0 min-w-0 whitespace-pre-line break-words text-body">{clip.notes}</p>
            ) : (
              <p className="m-0 text-body text-muted-2">No note on this set.</p>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="flex-none"
              onClick={() => {
                setNoteDraft(clip.notes ?? "");
                setEditingNote(true);
              }}
              aria-label={clip.notes ? "Edit your note" : "Add a note"}
            >
              {clip.notes ? "Edit" : "+ Add"}
            </Button>
          </div>
        )}
      </section>

      <section aria-labelledby="clip-coach" className="flex flex-col gap-3">
        <h2 id="clip-coach" className="m-0 font-mono text-label uppercase text-muted-2">
          {coach?.coachName ? `From ${coach.coachName}` : "From your coach"}
        </h2>
        <CommentThread comments={comments} names={names} viewerId={viewerId} fallbackName="Your coach" />
        {comments.length === 0 ? (
          <p className="m-0 text-ui text-muted-2">
            {coach === null
              ? "You're not linked to a coach, so nobody else sees this clip."
              : "Nothing on this clip yet. When your coach comments, it lands here and in Coach feedback."}
          </p>
        ) : null}
        {/* An answer needs a question and someone to read it: a thread the
            coach has spoken in, and a coach still linked. */}
        {fromCoach && coach !== null ? (
          <ReplyBox label={`${exerciseName}, ${setLabel.toLowerCase()}`} onSend={reply} />
        ) : null}
        {fromCoach && coach === null ? (
          <p className="m-0 text-ui text-muted">You&apos;re not linked to a coach any more, so replies are off.</p>
        ) : null}
      </section>

      <section aria-label="Clip actions" className="mt-auto flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <p className="m-0 text-caption text-muted">Film it again? The new clip replaces this one.</p>
          <AttachVideo
            setId={clip.id}
            athleteId={viewerId}
            hasVideo
            onAttached={replaced}
            onUploadingChange={setUploading}
          />
        </div>
        {confirmingDelete ? (
          <div role="group" aria-labelledby="delete-clip-q" className="flex flex-col gap-3 rounded-card border border-border bg-surface p-3">
            <p id="delete-clip-q" className="m-0 text-body">
              Delete this clip? The set stays in your log
              {comments.length > 0 ? ", and your coach's comments stay on it" : ""}.
            </p>
            <div className="flex gap-3">
              <Button block variant="secondary" onClick={() => setConfirmingDelete(false)} disabled={busy}>
                Keep it
              </Button>
              <Button
                block
                variant="danger"
                onClick={() => {
                  haptic("warning");
                  void remove();
                }}
                disabled={busy || uploading}
              >
                Delete clip
              </Button>
            </div>
          </div>
        ) : (
          <Button
            block
            variant="secondary"
            onClick={() => setConfirmingDelete(true)}
            // A delete mid-upload would be undone when the upload attached.
            disabled={busy || uploading}
          >
            Delete clip
          </Button>
        )}
      </section>
    </div>
  );
}
