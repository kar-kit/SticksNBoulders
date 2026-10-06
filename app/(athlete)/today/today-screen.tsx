"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth/session-context";
import { useExerciseLibrary } from "@/lib/exercises/library-context";
import { useTrainingSessions } from "@/lib/logging/session-context";
import { elapsedMs, formatElapsed, lastSessionLabel, sessionDateLabel } from "@/lib/logging/session";
import { usePrescribedToday, type PrescribedState } from "@/lib/programming/use-prescribed";
import { basisMaxesFor, lineSummaries, planDay, targetsFor } from "@/lib/programming/session-plan";

/**
 * Today. One question, answered in under a second: what am I doing, and how do
 * I start it.
 *
 * With a prescribed day (Order 22): a preview of it, the coach's note for the
 * day underneath, and Start in the thumb zone with "Log something else" beside
 * it. Without one, free logging -- which is first-class, not a fallback for
 * athletes without a coach.
 */
export function TodayScreen() {
  const router = useRouter();
  const { state: auth } = useSession();
  const athleteId = auth.status === "signed-in" ? auth.user.id : null;
  const { state, active, lastFinished, start } = useTrainingSessions();
  const prescribed = usePrescribedToday(athleteId);
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState(false);

  const day = prescribed.status === "ready" ? prescribed.day.day : null;

  const go = async (programDayId: string | null) => {
    setStarting(true);
    setFailed(false);
    try {
      await start(programDayId ? { programDayId } : undefined);
      router.push("/log");
    } catch {
      // Nothing is lost -- no session was created -- so this states the fact
      // and leaves the button ready. No toast, no error screen.
      setFailed(true);
      setStarting(false);
    }
  };

  return (
    <div className="pt-safe-8 flex flex-1 flex-col gap-5 pb-6">
      <header className="flex flex-col gap-1">
        <h1 className="m-0 text-display font-semibold">{sessionDateLabel(new Date())}</h1>
        {day ? (
          <p className="m-0 text-body text-muted">{day.label ?? "Today's session"}</p>
        ) : (
          <p className="m-0 text-body text-muted">Nothing prescribed today.</p>
        )}
      </header>

      {prescribed.status === "ready" ? <PrescribedPreview state={prescribed} /> : null}

      {active ? (
        <p className="m-0 text-body text-muted">
          Session running · {formatElapsed(elapsedMs(active.startedAt))}
        </p>
      ) : lastFinished ? (
        <p className="m-0 text-body text-muted">Last session: {lastSessionLabel(lastFinished, null)}</p>
      ) : state.status === "ready" ? (
        // Ruairi's first morning is an entirely empty account, and this is the
        // line he reads. It states the fact and offers the one action.
        <p className="m-0 text-body text-muted">No sessions logged yet.</p>
      ) : null}

      {/* Primary action in the thumb zone, per 00 Conventions. */}
      <div className="mt-auto flex flex-col gap-3">
        {failed ? (
          <p className="m-0 text-ui text-muted" role="status">
            Could not start that session. Nothing was lost — try again.
          </p>
        ) : null}
        {active ? (
          <Button size="xl" block onClick={() => go(null)} disabled={starting}>
            Resume session
          </Button>
        ) : day ? (
          <>
            <Button size="xl" block onClick={() => go(day.id)} disabled={starting}>
              {starting ? "Starting…" : "Start today's session"}
            </Button>
            <Button variant="secondary" block onClick={() => go(null)} disabled={starting}>
              Log something else
            </Button>
          </>
        ) : (
          <Button size="xl" block onClick={() => go(null)} disabled={starting}>
            {starting ? "Starting…" : "Start a session"}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The day at a glance: each exercise with its lines, percentages already
 * turned into kilos against the athlete's current maxes. Nobody should do
 * arithmetic between sets, or before them.
 */
function PrescribedPreview({ state }: { state: Extract<PrescribedState, { status: "ready" }> }) {
  const { state: library } = useExerciseLibrary();
  const names = useMemo(() => new Map(library.exercises.map((e) => [e.id, e.name])), [library.exercises]);
  const { day, prescriptions } = state.day;

  const exercises = useMemo(() => {
    const now = new Date();
    return planDay(prescriptions).map((planned) => {
      const maxes = basisMaxesFor(planned.exerciseId, state.maxes.entries, state.maxes.estimated, now);
      return {
        id: planned.exerciseId,
        lines: lineSummaries(planned, targetsFor(planned, maxes)),
      };
    });
  }, [prescriptions, state.maxes]);

  return (
    <section aria-label="Today's session" className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
      {exercises.length === 0 ? (
        <p className="m-0 text-body text-muted">Your coach has not added exercises to today yet.</p>
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
        // The closest the app gets to the coach being in the room.
        <p className="m-0 border-t border-border pt-3 text-ui" aria-label="Coach's note">
          {day.notes}
        </p>
      ) : null}
    </section>
  );
}
