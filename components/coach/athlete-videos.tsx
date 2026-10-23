"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { ClipPlayer } from "@/components/coach/clip-player";
import { ClipThumb } from "@/components/video/clip-thumb";
import { CommentThread } from "@/components/coach/comment-box";
import { Dialog } from "@/components/ui/dialog";
import { useArrivals, usePresence } from "@/components/ui/motion";
import { useSession } from "@/lib/auth/session-context";
import { fetchExerciseLibrary } from "@/lib/exercises/library";
import { fetchClips, fetchClipUrls, fetchReviewedSetIds } from "@/lib/review/queue-store";
import { fetchCommentsForSets } from "@/lib/review/comment-store";
import type { Comment } from "@/lib/review/comments";
import { shortDate, videoRows, type VideoRow } from "@/lib/coach/athlete-view";
import { formatNumber } from "@/lib/logging/prefill";
import { cn } from "@/lib/cn";

/**
 * Every clip this athlete has filmed, newest first, as a compact button each.
 *
 * The Review Queue is organised around clearing, so a clip leaves it the
 * moment it is dealt with. This is the other reading of the same rows: what
 * this person has been filming lately, reviewed or not, and the latest thing
 * said about each one, against the clip it is about.
 *
 * No players on the page (Joey's review, 16 Oct 2026). A button opens the
 * clip and its whole thread together, over the page, with the Review Queue's
 * own player and thread components -- the same speeds, loop and frame steps,
 * the same words in the same layout. In the URL (`?clip=<setId>`), so Back
 * closes it. Recent feedback used to be a separate list beside this one, and
 * every comment in it was about one of these clips; it now sits on the clip.
 *
 * Read-only, deliberately. Commenting belongs in the queue, where the context
 * panel carries the prescription, the RPE and recent weeks; a second composer
 * here would be a second place to say the same thing with less attached. A
 * clip still waiting says so and points there.
 */

type Loaded = { rows: VideoRow[]; comments: Comment[] };
type State = { status: "loading" } | { status: "ready"; athleteId: string; data: Loaded } | { status: "failed"; athleteId: string };

/** Enough to cover a fortnight of filmed top sets without a scroll wall. */
const FIRST_PAGE = 8;

export interface AthleteVideosProps {
  athleteId: string;
  /** For the thread: their replies are shown under their name. */
  athleteName: string | null;
  /** The clip open over the page, from the URL. Ignored unless it is one of this athlete's. */
  openClipId: string | null;
  onOpen: (clipId: string) => void;
  onClose: () => void;
}

const loadLabel = (row: VideoRow) =>
  `${formatNumber(row.loadKg)} × ${row.reps}${row.rpe === null ? "" : ` @${formatNumber(row.rpe)}`}`;

export function AthleteVideos({ athleteId, athleteName, openClipId, onOpen, onClose }: AthleteVideosProps) {
  const { state: session } = useSession();
  const coachId = session.status === "signed-in" ? session.user.id : "";
  const [state, setState] = useState<State>({ status: "loading" });
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!coachId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [clips, reviewed, library] = await Promise.all([
          fetchClips([athleteId]),
          fetchReviewedSetIds(coachId),
          fetchExerciseLibrary(athleteId),
        ]);
        const comments = await fetchCommentsForSets(clips.map((clip) => clip.id));
        const names = new Map(library.map((e) => [e.id, e.name]));
        if (!cancelled) {
          setState({
            status: "ready",
            athleteId,
            data: { rows: videoRows(clips, reviewed, comments, (id) => names.get(id)), comments },
          });
        }
      } catch {
        if (!cancelled) setState({ status: "failed", athleteId });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId, coachId]);

  const data = state.status === "ready" && state.athleteId === athleteId ? state.data : null;
  const rows = data?.rows ?? null;
  const failed = state.status === "failed" && state.athleteId === athleteId;
  // A clip deep-linked further down the list than the first page still opens.
  const opened = rows?.find((row) => row.id === openClipId) ?? null;
  const visible = rows ? (showAll ? rows : rows.slice(0, FIRST_PAGE)) : [];
  const waiting = rows?.filter((row) => !row.reviewed).length ?? 0;
  const names = useMemo(
    () => new Map(athleteName ? [[athleteId, athleteName] as const] : []),
    [athleteId, athleteName],
  );
  // The dialog outlives the URL by its fade-out; "Show all" rows rise in.
  const dialog = usePresence(data ? opened : null);
  const isNew = useArrivals(
    visible.map((row) => row.id),
    athleteId,
  );

  return (
    <section className="flex flex-col gap-3" aria-labelledby="athlete-videos-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="athlete-videos-heading" className="m-0 text-label uppercase tracking-wide text-muted">
          Videos
        </h2>
        {waiting > 0 ? (
          <Link href="/coach/review" className="text-ui text-accent-fill underline">
            {waiting} waiting in Review
          </Link>
        ) : null}
      </div>

      {!rows && !failed ? <p className="m-0 text-ui text-muted">Loading…</p> : null}
      {failed ? <p className="m-0 text-ui text-muted">Couldn’t load their videos. Refresh to try again.</p> : null}
      {rows && rows.length === 0 ? (
        <p className="m-0 text-ui text-muted-2">
          No videos yet. A set they film shows up here and in your Review queue, with the numbers already attached.
        </p>
      ) : null}

      {visible.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {visible.map((row) => (
            <li key={row.id} className={cn(isNew(row.id) && "motion-safe:animate-rise-in")}>
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => onOpen(row.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-control border border-border bg-surface px-3 py-2 text-left",
                  "transition-control press-wide hover:bg-surface-2 focus-visible:bg-surface-2",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
                )}
              >
                {/* The clip's poster (F12), or the camera placeholder. */}
                <ClipThumb posterId={row.videoPosterId ?? null} className="h-12 w-12" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="grid w-full grid-cols-[52px_minmax(0,1fr)] items-baseline gap-x-3 md:grid-cols-[52px_minmax(0,1fr)_auto]">
                  <span className="font-mono text-meta text-muted-2">{shortDate(new Date(row.loggedAt))}</span>
                  <span className="min-w-0 truncate text-ui">
                    <span className="font-semibold">{row.exerciseName}</span>{" "}
                    <span className="tabular-nums">{loadLabel(row)}</span>
                  </span>
                  {/* Under the name on a phone, so the load is never what truncates. */}
                  <span
                    className={cn(
                      "col-start-2 text-caption md:col-start-auto",
                      row.reviewed ? "text-muted-2" : "text-accent-fill",
                    )}
                  >
                    {row.reviewed ? "reviewed" : "waiting"}
                    {row.commentCount > 0 ? ` · ${row.commentCount} comment${row.commentCount === 1 ? "" : "s"}` : ""}
                    {/* The athlete said something about this set (F11); the
                        dialog shows what. */}
                    {row.notes ? " · their note" : ""}
                  </span>
                </span>
                {row.latestComment ? (
                  // The latest word on it, on one line. The whole thread is
                  // one click away, with the clip.
                  <span className="truncate pl-[64px] text-caption text-muted">
                    <span className="text-muted-2">
                      {row.latestComment.authorId === coachId ? "You" : (athleteName ?? "Your athlete")}:
                    </span>{" "}
                    {row.latestComment.body}
                  </span>
                ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {rows && rows.length > FIRST_PAGE && !showAll ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="self-start text-ui text-muted underline transition-control hover:text-foreground focus-visible:text-foreground"
        >
          Show all {rows.length}
        </button>
      ) : null}

      {dialog.shown && data ? (
        <ClipDialog
          row={dialog.shown}
          comments={data.comments.filter((comment) => comment.setId === dialog.shown?.id)}
          names={names}
          viewerId={coachId}
          onClose={onClose}
          leaving={dialog.leaving}
          onExited={dialog.exited}
        />
      ) : null}
    </section>
  );
}

function ClipDialog({
  row,
  comments,
  names,
  viewerId,
  onClose,
  leaving,
  onExited,
}: {
  row: VideoRow;
  comments: Comment[];
  names: ReadonlyMap<string, string>;
  viewerId: string;
  onClose: () => void;
  leaving: boolean;
  onExited: () => void;
}) {
  const heading = useId();
  const [src, setSrc] = useState<{ clipId: string; url: string | null } | null>(null);

  // Minted per clip on open, not for the whole list: most of the list is read,
  // not watched, and each URL is a signed ticket with a short life.
  useEffect(() => {
    let cancelled = false;
    void fetchClipUrls([row.videoFileId])
      .catch(() => new Map<string, string>())
      .then((urls) => {
        if (!cancelled) setSrc({ clipId: row.id, url: urls.get(row.videoFileId) ?? null });
      });
    return () => {
      cancelled = true;
    };
  }, [row.id, row.videoFileId]);

  // The ticket lasts five minutes; ClipPlayer asks for a new one when a seek
  // past that fails.
  const refreshSrc = async (): Promise<boolean> => {
    const urls = await fetchClipUrls([row.videoFileId]).catch(() => new Map<string, string>());
    const url = urls.get(row.videoFileId);
    if (!url) return false;
    setSrc({ clipId: row.id, url });
    return true;
  };

  const current = src?.clipId === row.id ? src : null;

  return (
    <Dialog labelledBy={heading} onClose={onClose} leaving={leaving} onExited={onExited}>
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id={heading} className="m-0 text-title font-semibold">
              {row.exerciseName} <span className="tabular-nums">{loadLabel(row)}</span>
              <span className="font-normal text-muted"> · {shortDate(new Date(row.loggedAt))}</span>
            </h2>
            <p className={cn("m-0 text-caption", row.reviewed ? "text-muted-2" : "text-accent-fill")}>
              {row.reviewed ? "Reviewed" : "Waiting in your Review queue"}
              {row.prescribed ? <span className="text-muted"> · prescribed {row.prescribed}</span> : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-10 shrink-0 rounded-chip border border-border px-3 text-ui text-muted transition-control press hover:text-foreground focus-visible:text-foreground md:h-9 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line"
          >
            Close
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <ClipPlayer
            src={current?.url ?? null}
            clipId={row.id}
            hint="Space plays, arrows step a frame."
            refreshSrc={refreshSrc}
            unavailable={current && current.url === null ? "The video for this clip could not be loaded." : undefined}
          />
          <div className="flex min-w-0 flex-col gap-4">
            {row.notes ? (
              // The athlete's own note on the set (F11), above the thread so it
              // reads as the context the comments answer.
              <div>
                <h3 className="m-0 text-ui font-semibold text-muted">Athlete note</h3>
                <p className="m-0 whitespace-pre-line text-ui">“{row.notes}”</p>
              </div>
            ) : null}
            <CommentThread comments={comments} names={names} viewerId={viewerId} />
            {comments.length === 0 ? (
              <p className="m-0 text-ui text-muted-2">Nothing said on this clip yet.</p>
            ) : null}
            {!row.reviewed ? (
              <Link href="/coach/review" className="self-start text-ui text-accent-fill underline">
                Comment on it in Review
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
