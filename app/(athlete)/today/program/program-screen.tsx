"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useSession } from "@/lib/auth/session-context";
import { useExerciseLibrary } from "@/lib/exercises/library-context";
import { useTrainingSessions } from "@/lib/logging/session-context";
import { sessionDateLabel } from "@/lib/logging/session";
import { useFeedbackBadge } from "@/lib/review/feedback-context";
import { localDay, type ProgramTree } from "@/lib/programming/program";
import {
  allWeeks,
  blockProgress,
  currentWeekId,
  dayStates,
  sessionsCoverFrom,
  type DayState,
} from "@/lib/programming/my-program";
import { basisMaxesFor, lineSummaries, planDay, targetsFor } from "@/lib/programming/session-plan";
import { useMyProgram } from "@/lib/programming/use-my-program";
import type { AthleteMaxes } from "@/lib/programming/use-prescribed";

/** Matches fetchRecentSessions: past this many, "missed" stops being a safe claim. */
const SESSION_WINDOW = 25;

const STATE_LABEL: Record<DayState["kind"], string> = {
  done: "Done",
  active: "In progress",
  today: "Today",
  upcoming: "",
  missed: "Missed",
  earlier: "",
};

const dateLabel = (day: string | null) => (day ? sessionDateLabel(new Date(`${day}T12:00:00`)) : "");

/**
 * My Program. The athlete's block, read-only.
 *
 * Weeks collapse with the current one open; a day opens to its prescription,
 * percentages already in kilos against the current max -- the same lines Today
 * shows -- and Start. Done days link to the session that was logged. Nothing on
 * this screen edits the program or writes anything but the session Start
 * creates, through the same path Today uses.
 *
 * Offline is the ordinary case: the last program loaded paints from the device
 * and a failed refresh says nothing (docs/offline.md).
 */
export function ProgramScreen() {
  const { state: auth } = useSession();
  const athleteId = auth.status === "signed-in" ? auth.user.id : null;
  const { hasCoach } = useFeedbackBadge();
  const loaded = useMyProgram(athleteId);

  return (
    <div className="pt-safe-8 flex flex-1 flex-col gap-5 pb-6">
      <header className="flex flex-col gap-1">
        <Link href="/today" className="text-ui text-muted">
          ← Today
        </Link>
        <h1 className="m-0 text-display font-semibold">My program</h1>
        {loaded.program ? <p className="m-0 text-body text-muted">{loaded.program.name}</p> : null}
      </header>

      {hasCoach === false ? (
        // Today never links here without a coach; this is a typed URL or a stale tab.
        <EmptyState title="No coach linked" body="Your program shows here once a coach links to you." />
      ) : loaded.status === "ready" ? (
        <ProgramBody program={loaded.program} maxes={loaded.maxes} />
      ) : loaded.status === "none" ? (
        <EmptyState
          title="No program yet"
          body="Your coach has not published one. It shows here as soon as they do."
        />
      ) : loaded.status === "failed" ? (
        <EmptyState title="Program not loaded" body="Open this once with signal and it stays on your phone." />
      ) : null}
    </div>
  );
}

function ProgramBody({ program, maxes }: { program: ProgramTree; maxes: AthleteMaxes }) {
  const router = useRouter();
  const { state, active, start } = useTrainingSessions();
  const { state: library } = useExerciseLibrary();
  const names = useMemo(() => new Map(library.exercises.map((e) => [e.id, e.name])), [library.exercises]);

  const today = localDay();
  const states = useMemo(
    () => dayStates(program, state.sessions, today, sessionsCoverFrom(state.sessions, SESSION_WINDOW, localDay)),
    [program, state.sessions, today],
  );
  const progress = blockProgress(program, states, today);
  const weeks = allWeeks(program);
  const currentId = currentWeekId(program, today);

  const [openWeeks, setOpenWeeks] = useState<Set<string>>(() => new Set(currentId ? [currentId] : []));
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState(false);

  const toggleWeek = (id: string) =>
    setOpenWeeks((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const go = async (programDayId: string | null) => {
    setStarting(true);
    setFailed(false);
    try {
      await start(programDayId ? { programDayId } : undefined);
      router.push("/log");
    } catch {
      setFailed(true);
      setStarting(false);
    }
  };

  const weekNumber = new Map(weeks.map((w, at) => [w.id, at + 1]));

  return (
    <div className="flex flex-col gap-4">
      {progress.finished ? (
        <p className="m-0 text-body" role="status">
          Block finished · {progress.done} of {progress.total} sessions logged
        </p>
      ) : (
        <p className="m-0 text-body text-muted">
          {progress.done} of {progress.total} sessions logged
        </p>
      )}
      {program.notes ? (
        <p className="m-0 text-ui" aria-label="Coach's note on the program">
          {program.notes}
        </p>
      ) : null}
      {failed ? (
        <p className="m-0 text-ui text-muted" role="status">
          Could not start that session. Nothing was lost — try again.
        </p>
      ) : null}

      {program.blocks.map((block) => (
        <section key={block.id} aria-label={block.name} className="flex flex-col gap-2">
          {program.blocks.length > 1 ? <h2 className="m-0 text-title font-semibold">{block.name}</h2> : null}
          {block.weeks.map((week) => {
            const open = openWeeks.has(week.id);
            return (
              <div key={week.id} className="rounded-card border border-border bg-surface">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => toggleWeek(week.id)}
                  className="flex min-h-[44px] w-full items-center justify-between px-4 py-2 text-left text-body font-semibold"
                >
                  <span>{week.label ?? `Week ${weekNumber.get(week.id)}`}</span>
                  {week.id === currentId ? <span className="text-ui text-accent-fill">Current</span> : null}
                </button>
                {open ? (
                  <ul className="m-0 flex list-none flex-col gap-1 border-t border-border p-2">
                    {week.notes ? <li className="px-2 py-1 text-ui text-muted">{week.notes}</li> : null}
                    {week.days.map((day) => {
                      const dayState = states.get(day.id) ?? { kind: "upcoming" as const };
                      const expanded = openDay === day.id;
                      return (
                        <li key={day.id} className="flex flex-col">
                          <button
                            type="button"
                            aria-expanded={expanded}
                            onClick={() => setOpenDay(expanded ? null : day.id)}
                            className="flex min-h-[44px] items-center justify-between gap-3 rounded-control px-2 text-left text-body active:bg-surface-2"
                          >
                            <span className="flex flex-col">
                              <span className="font-semibold">{day.label ?? "Session"}</span>
                              <span className="text-ui text-muted">{dateLabel(day.scheduledOn)}</span>
                            </span>
                            <span className="text-ui text-muted-2">{STATE_LABEL[dayState.kind]}</span>
                          </button>
                          {expanded ? (
                            <DayDetail
                              day={day}
                              dayState={dayState}
                              names={names}
                              maxes={maxes}
                              busy={starting}
                              resuming={active !== null}
                              onStart={() => go(active ? null : day.id)}
                            />
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

function DayDetail({
  day,
  dayState,
  names,
  maxes,
  busy,
  resuming,
  onStart,
}: {
  day: ProgramTree["blocks"][number]["weeks"][number]["days"][number];
  dayState: DayState;
  names: ReadonlyMap<string, string>;
  maxes: AthleteMaxes;
  busy: boolean;
  resuming: boolean;
  onStart: () => void;
}) {
  const exercises = useMemo(() => {
    const now = new Date();
    return planDay(day.prescriptions).map((planned) => ({
      id: planned.exerciseId,
      lines: lineSummaries(planned, targetsFor(planned, basisMaxesFor(planned.exerciseId, maxes.entries, maxes.estimated, now))),
    }));
  }, [day.prescriptions, maxes]);

  return (
    <div className="mx-2 mb-2 flex flex-col gap-3 rounded-control bg-surface-2 p-3">
      {exercises.length === 0 ? (
        <p className="m-0 text-ui text-muted">Your coach has not added exercises to this day yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {exercises.map((exercise) => (
            <li key={exercise.id} className="flex flex-col gap-0.5">
              <span className="text-body font-semibold">{names.get(exercise.id) ?? "Exercise"}</span>
              {exercise.lines.map((line, at) => (
                <span key={at} className="text-ui text-muted">
                  {line}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
      {day.notes ? (
        <p className="m-0 border-t border-border pt-3 text-ui" aria-label="Coach's note">
          {day.notes}
        </p>
      ) : null}
      {dayState.kind === "done" ? (
        <>
          <p className="m-0 text-ui text-muted">
            Shown as the coach has it now. What you logged is unchanged.
          </p>
          <Link
            href={`/history/${dayState.sessionId}`}
            className="flex min-h-[44px] items-center justify-center rounded-control border border-border bg-surface text-body font-medium"
          >
            View logged session
          </Link>
        </>
      ) : (
        <Button size="lg" block onClick={onStart} disabled={busy}>
          {busy ? "Starting…" : resuming ? "Resume session" : "Start this session"}
        </Button>
      )}
    </div>
  );
}
