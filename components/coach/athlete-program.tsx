"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchExerciseLibrary } from "@/lib/exercises/library";
import { adjustProgramHref } from "@/lib/coach/adjust-program";
import { glanceDate, programToShow, weekGlance, type ShownProgram, type WeekGlance } from "@/lib/coach/athlete-program";
import { localDay } from "@/lib/programming/program";
import { fetchLoggedDayIds, fetchProgramTree, fetchPrograms } from "@/lib/programming/program-store";
import { fetchEstimatedMaxes, fetchReferenceMaxes } from "@/lib/strength/reference-max-store";
import { cn } from "@/lib/cn";

/**
 * THIS BLOCK, from the blueprint, now with the block in it.
 *
 * Joey's review (16 Oct 2026) made the current program the prominent thing on
 * the page: this block's current week at a glance -- its days, their
 * exercises, loads already in kilos where they resolve -- and whether the
 * athlete can see it yet. The block itself is still written in the Program
 * Editor (Order 19); "Adjust program" opens it for this athlete. Same tab:
 * nothing on this screen is lost by leaving it.
 *
 * Read-only. Every read is one the editor or My Program already makes,
 * through the coach's own session. The one thing added about the athlete is
 * whether they started a session from a day (`sessions.program_day_id`, the
 * column the editor's "logged" mark reads). Nothing is inferred from what was
 * lifted -- a progress number nobody prescribed is worse than no number.
 */

type Loaded =
  | { status: "none" }
  | { status: "ready"; shown: ShownProgram; week: WeekGlance | null };

type State = { status: "loading" } | Loaded | { status: "failed" };

export function AthleteProgram({ athleteId }: { athleteId: string }) {
  const [state, setState] = useState<State & { for?: string }>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Maxes and names alongside the program list rather than after it:
        // they are needed for any program, and waiting on the tree first
        // would be a second round trip on a screen held to 2.5s.
        const [programs, entries, estimated, library] = await Promise.all([
          fetchPrograms({ athleteId }),
          fetchReferenceMaxes(athleteId).catch(() => []),
          fetchEstimatedMaxes(athleteId).catch(() => new Map()),
          fetchExerciseLibrary(athleteId).catch(() => []),
        ]);
        const shown = programToShow(programs, athleteId);
        if (!shown) {
          if (!cancelled) setState({ status: "none", for: athleteId });
          return;
        }
        const tree = await fetchProgramTree(shown.program.id);
        if (!tree) throw new Error("program not readable");
        const names = new Map(library.map((e) => [e.id, e.name]));
        const today = localDay();
        const maxes = { entries, estimated };
        const draft = weekGlance({ tree, today, maxes, nameOf: (id) => names.get(id), logged: null, asOf: new Date() });
        // Unknown is not "not logged": a failed read leaves the marks off
        // rather than painting every past day as untouched.
        const logged = draft
          ? await fetchLoggedDayIds(athleteId, draft.days.map((d) => d.id)).catch(() => null)
          : null;
        const week = draft ? { ...draft, days: draft.days.map((d) => ({ ...d, logged: logged ? logged.has(d.id) : null })) } : null;
        if (!cancelled) setState({ status: "ready", shown, week, for: athleteId });
      } catch {
        if (!cancelled) setState({ status: "failed", for: athleteId });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  const current: State = state.for === athleteId ? state : { status: "loading" };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="athlete-program-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="athlete-program-heading" className="m-0 text-label uppercase tracking-wide text-muted">
          This block
        </h2>
        <Link
          href={adjustProgramHref(athleteId)}
          className="inline-flex h-10 shrink-0 items-center rounded-chip border border-border bg-surface px-[14px] text-ui font-medium text-foreground transition-control press hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line md:h-9"
        >
          Adjust program
        </Link>
      </div>

      {current.status === "loading" ? <p className="m-0 text-ui text-muted">Loading…</p> : null}
      {current.status === "failed" ? (
        <p className="m-0 text-ui text-muted">Couldn’t load their program. Refresh to try again.</p>
      ) : null}
      {current.status === "none" ? (
        <p className="m-0 text-ui text-muted-2">
          Nobody has written them a block yet. Adjust program starts one, and its current week shows here.
        </p>
      ) : null}
      {current.status === "ready" ? <Glance shown={current.shown} week={current.week} /> : null}
    </section>
  );
}

/** Fades in over "Loading…" when the block arrives: the panel filled, not the page jumped. */
function Glance({ shown, week }: { shown: ShownProgram; week: WeekGlance | null }) {
  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="flex flex-col gap-1">
        <p className="m-0 flex flex-wrap items-center gap-2">
          <span className="text-title font-semibold">{shown.program.name}</span>
          <StatusPill published={shown.live} />
        </p>
        {week ? (
          <p className="m-0 flex flex-wrap items-center gap-2 text-ui text-muted">
            <span>
              Week {week.number} of {week.of}
              {week.label ? ` · ${week.label}` : ""}
              {week.range ? ` · ${week.range}` : ""}
            </span>
            {/* A draft week inside a published program: the case most likely
                to surprise a coach, since the program says Published. */}
            {shown.live && week.status === "draft" ? <StatusPill published={false} label="Draft week" /> : null}
          </p>
        ) : null}
        {week && !week.visibleToAthlete ? (
          <p className="m-0 text-caption text-muted-2">Not published, so they can’t see this week yet.</p>
        ) : null}
      </div>

      {!week ? <p className="m-0 text-ui text-muted">This block has no weeks yet.</p> : null}
      {week && week.days.length === 0 ? <p className="m-0 text-ui text-muted">Nothing written in this week yet.</p> : null}

      {week && week.days.length > 0 ? (
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {week.days.map((day) => (
            <li key={day.id} className="flex flex-col gap-2 rounded-control border border-border bg-surface p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="text-ui font-semibold">{day.label}</span>
                <span className="flex items-baseline gap-2 font-mono text-meta text-muted">
                  {day.isToday ? <span className="text-accent-fill">Today</span> : null}
                  <span>{glanceDate(day.scheduledOn)}</span>
                  {day.logged ? <span className="text-success">Logged</span> : null}
                </span>
              </div>
              {day.exercises.length === 0 ? (
                <p className="m-0 text-caption text-muted">No exercises on this day yet.</p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {day.exercises.map((exercise) => (
                    <li key={exercise.exerciseId} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 text-ui">
                      <span className="font-medium">{exercise.name}</span>
                      <span className="flex flex-col text-muted tabular-nums">
                        {exercise.lines.map((line, at) => (
                          <span key={at}>{line}</span>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {day.notes ? <p className="m-0 border-t border-border pt-2 text-caption text-muted">{day.notes}</p> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function StatusPill({ published, label }: { published: boolean; label?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-chip border px-2 text-caption font-semibold",
        published ? "border-success text-success" : "border-accent-line text-foreground",
      )}
    >
      {label ?? (published ? "Published" : "Draft")}
    </span>
  );
}
