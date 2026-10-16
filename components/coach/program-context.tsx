"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchRecentSessions } from "@/lib/logging/session-store";
import { fetchSetsForSessions } from "@/lib/logging/history-store";
import { fetchClips, fetchReviewedSetIds } from "@/lib/review/queue-store";
import { shortDate } from "@/lib/coach/athlete-view";
import { dayDateLabel } from "@/lib/programming/editor";
import { lastLoggedWeeks, waitingClips, type ContextSet } from "@/lib/programming/editor-context";
import type { ClipSet } from "@/lib/review/queue";

/**
 * The context drawer beside the week being written: the athlete's last
 * logged week of each exercise on screen, and the clips this coach has not
 * watched yet. Ruairi writes next week after watching last week's videos;
 * this is that evidence, beside the page rather than in another tab.
 *
 * Read-only, from the reads Athlete View and the Review Queue already make
 * (`fetchRecentSessions` + `fetchSetsForSessions`; `fetchClips` minus
 * `fetchReviewedSetIds`). Read once per athlete when the drawer first opens,
 * not on every week switch: the week changes which exercises are shown, not
 * what was logged. Each half fails on its own, and says so.
 */

type Read<T> = { status: "loading" } | { status: "failed" } | { status: "ready"; value: T };

const KEY = "snb.editor.context";

/** Whether the drawer is open, remembered per browser. Closed by default: see docs/program-layout.md §4. */
export function useContextDrawer(): [boolean, (open: boolean) => void] {
  // The server has no localStorage and renders closed. That cannot mismatch:
  // the editor's first paint is its loading state, which has no drawer.
  const [open, setOpen] = useState(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(KEY) === "open";
    } catch {
      return false; // private mode: closed it is
    }
  });
  const change = (next: boolean) => {
    setOpen(next);
    try {
      window.localStorage.setItem(KEY, next ? "open" : "closed");
    } catch {
      /* not remembered, still toggled */
    }
  };
  return [open, change];
}

export function ProgramContext({
  athleteId,
  coachId,
  athleteName,
  exerciseIds,
  names,
  onClose,
}: {
  athleteId: string;
  coachId: string;
  athleteName: string | null;
  /** The exercises on screen, in the order they appear. */
  exerciseIds: readonly string[];
  names: ReadonlyMap<string, string>;
  onClose: () => void;
}) {
  const [sets, setSets] = useState<Read<ContextSet[]>>({ status: "loading" });
  const [clips, setClips] = useState<Read<{ clips: ClipSet[]; reviewed: Set<string> }>>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const sessions = await fetchRecentSessions(athleteId);
        const found = await fetchSetsForSessions(sessions.map((s) => s.id));
        if (!cancelled) setSets({ status: "ready", value: found });
      } catch {
        if (!cancelled) setSets({ status: "failed" });
      }
    })();
    void (async () => {
      try {
        const [found, reviewed] = await Promise.all([fetchClips([athleteId]), fetchReviewedSetIds(coachId)]);
        if (!cancelled) setClips({ status: "ready", value: { clips: found, reviewed } });
      } catch {
        if (!cancelled) setClips({ status: "failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId, coachId]);

  const who = athleteName ?? "they";
  const nameOf = (id: string) => names.get(id) ?? "Exercise";
  const weeks = sets.status === "ready" ? lastLoggedWeeks(sets.value, exerciseIds) : [];
  const unseen = exerciseIds.filter((id) => !weeks.some((w) => w.exerciseId === id));
  const waiting = clips.status === "ready" ? waitingClips(clips.value.clips, clips.value.reviewed, (id) => names.get(id)) : null;

  return (
    <aside
      aria-label="Context"
      className="flex w-72 shrink-0 flex-col gap-5 border-l border-border bg-surface px-4 py-5 text-ui"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-title font-semibold">Context</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </header>

      <section aria-label="Last logged week" className="flex flex-col gap-3">
        <h3 className="m-0 font-mono text-label font-normal uppercase text-muted-2">Last logged week</h3>
        {exerciseIds.length === 0 ? (
          <p className="m-0 text-muted">Add a line and the last week {who} logged it shows here.</p>
        ) : sets.status === "loading" ? (
          <p className="m-0 text-muted" aria-busy>
            Reading their sessions…
          </p>
        ) : sets.status === "failed" ? (
          <p className="m-0 text-muted">Their sessions did not load. Nothing here is missing; it is unknown.</p>
        ) : (
          <>
            {weeks.map((week) => (
              <div key={week.exerciseId} className="flex flex-col gap-0.5">
                <p className="m-0 font-semibold text-foreground">
                  {nameOf(week.exerciseId)}{" "}
                  <span className="font-normal text-muted-2">· week of {shortDate(new Date(`${week.weekOf}T12:00:00`))}</span>
                </p>
                {week.sessions.map((session, at) => (
                  <p key={`${session.day}-${at}`} className="m-0 text-caption text-muted tabular-nums">
                    <span className="text-muted-2">{dayDateLabel(session.day)}:</span> {session.sets}
                  </p>
                ))}
              </div>
            ))}
            {unseen.length > 0 ? (
              <p className="m-0 text-caption text-muted-2">
                Not in their last 25 sessions: {unseen.map(nameOf).join(", ")}.
              </p>
            ) : null}
          </>
        )}
      </section>

      <section aria-label="Videos waiting" className="flex flex-col gap-2">
        <h3 className="m-0 font-mono text-label font-normal uppercase text-muted-2">
          Videos waiting{waiting ? ` · ${waiting.total}` : ""}
        </h3>
        {clips.status === "loading" ? (
          <p className="m-0 text-muted" aria-busy>
            Reading their clips…
          </p>
        ) : clips.status === "failed" || !waiting ? (
          <p className="m-0 text-muted">Their clips did not load.</p>
        ) : waiting.total === 0 ? (
          <p className="m-0 text-muted">Nothing waiting. Every clip of theirs has been reviewed by you.</p>
        ) : (
          <>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {waiting.rows.map((clip) => (
                <li key={clip.id} className="text-caption text-muted tabular-nums">
                  <span className="font-semibold text-foreground">{clip.exerciseName}</span> · {clip.loadKg} × {clip.reps}
                  {clip.rpe === null ? "" : ` @${clip.rpe}`} · {shortDate(new Date(clip.loggedAt))}
                </li>
              ))}
            </ul>
            <Link href="/coach/review" className="text-caption font-semibold text-accent-fill">
              Open the Review Queue
            </Link>
          </>
        )}
      </section>
    </aside>
  );
}
