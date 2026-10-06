"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ClipPlayer } from "@/components/coach/clip-player";
import { useSession } from "@/lib/auth/session-context";
import { fetchExerciseLibrary } from "@/lib/exercises/library";
import { fetchClips, fetchClipUrls, fetchReviewedSetIds } from "@/lib/review/queue-store";
import { fetchCommentsForSets } from "@/lib/review/comment-store";
import { shortDate, videoRows, type VideoRow } from "@/lib/coach/athlete-view";
import { formatNumber } from "@/lib/logging/prefill";
import { cn } from "@/lib/cn";

/**
 * Every clip this athlete has filmed, newest first, playable in place.
 *
 * The Review Queue is organised around clearing, so a clip leaves it the
 * moment it is dealt with. This is the other reading of the same rows: what
 * this person has been filming lately, reviewed or not, and how much has been
 * said about each one. Comments themselves are in Recent feedback beside it.
 *
 * Read-only, deliberately. Commenting belongs in the queue, where the context
 * panel carries the prescription, the RPE and recent weeks; a second composer
 * here would be a second place to say the same thing with less attached. A
 * clip still waiting says so and points there.
 */

type State =
  | { status: "loading" }
  | { status: "ready"; athleteId: string; rows: VideoRow[] }
  | { status: "failed"; athleteId: string };

/** Enough to cover a fortnight of filmed top sets without a scroll wall. */
const FIRST_PAGE = 8;

export function AthleteVideos({ athleteId }: { athleteId: string }) {
  const { state: session } = useSession();
  const coachId = session.status === "signed-in" ? session.user.id : "";
  const [state, setState] = useState<State>({ status: "loading" });
  const [showAll, setShowAll] = useState(false);
  const [playing, setPlaying] = useState<{ clipId: string; src: string | null } | null>(null);

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
          setState({ status: "ready", athleteId, rows: videoRows(clips, reviewed, comments, (id) => names.get(id)) });
        }
      } catch {
        if (!cancelled) setState({ status: "failed", athleteId });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId, coachId]);

  const rows = useMemo(
    () => (state.status === "ready" && state.athleteId === athleteId ? state.rows : null),
    [state, athleteId],
  );
  const failed = state.status === "failed" && state.athleteId === athleteId;
  const visible = rows ? (showAll ? rows : rows.slice(0, FIRST_PAGE)) : [];
  const current = playing && rows?.some((row) => row.id === playing.clipId) ? playing : null;
  const waiting = rows?.filter((row) => !row.reviewed).length ?? 0;

  const play = async (row: VideoRow) => {
    if (current?.clipId === row.id) {
      setPlaying(null);
      return;
    }
    setPlaying({ clipId: row.id, src: null });
    // Minted per clip on demand, not for the whole list: most of the list is
    // read, not watched, and each URL is a signed ticket with a short life.
    const urls = await fetchClipUrls([row.videoFileId]).catch(() => new Map<string, string>());
    setPlaying((now) => (now?.clipId === row.id ? { clipId: row.id, src: urls.get(row.videoFileId) ?? null } : now));
  };

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
        <ul className="m-0 flex list-none flex-col p-0">
          {visible.map((row) => {
            const open = current?.clipId === row.id;
            return (
              <li key={row.id} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => void play(row)}
                  className={cn(
                    "grid w-full grid-cols-[52px_minmax(0,1fr)_auto] items-baseline gap-3 py-2 text-left",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
                  )}
                >
                  <span className="font-mono text-meta text-muted-2">{shortDate(new Date(row.loggedAt))}</span>
                  <span className="min-w-0 truncate text-ui">
                    <span className="font-semibold">{row.exerciseName}</span>{" "}
                    <span className="tabular-nums">
                      {formatNumber(row.loadKg)} × {row.reps}
                      {row.rpe === null ? "" : ` @${formatNumber(row.rpe)}`}
                    </span>
                  </span>
                  <span className={cn("text-caption", row.reviewed ? "text-muted-2" : "text-accent-fill")}>
                    {row.reviewed ? "reviewed" : "waiting"}
                    {row.commentCount > 0 ? ` · ${row.commentCount} comment${row.commentCount === 1 ? "" : "s"}` : ""}
                  </span>
                </button>
                {open ? (
                  <div className="flex flex-col gap-2 pb-3">
                    {row.notes ? <p className="m-0 text-ui text-muted">“{row.notes}”</p> : null}
                    <ClipPlayer src={current?.src ?? null} clipId={row.id} hint="Space plays, arrows step a frame." />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {rows && rows.length > FIRST_PAGE && !showAll ? (
        <button type="button" onClick={() => setShowAll(true)} className="self-start text-ui text-muted underline">
          Show all {rows.length}
        </button>
      ) : null}
    </section>
  );
}
