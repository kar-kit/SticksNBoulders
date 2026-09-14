"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useTrainingSessions } from "@/lib/logging/session-context";
import { elapsedMs, formatElapsed, lastSessionLabel, sessionDateLabel } from "@/lib/logging/session";

/**
 * Today. One question, answered in under a second: what am I doing, and how do
 * I start it.
 *
 * This is the no-program layout. The prescribed-session card, the coach's note
 * for the day and the rest-day state all need a program to exist, which is
 * Order 22 -- and free logging is a first-class path regardless, not a fallback
 * for athletes without a coach.
 */
export function TodayScreen() {
  const router = useRouter();
  const { state, active, lastFinished, start } = useTrainingSessions();
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState(false);

  const go = async () => {
    setStarting(true);
    setFailed(false);
    try {
      await start();
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
        <p className="m-0 text-body text-muted">Nothing prescribed today.</p>
      </header>

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
        <Button size="xl" block onClick={go} disabled={starting}>
          {active ? "Resume session" : starting ? "Starting…" : "Start a session"}
        </Button>
      </div>
    </div>
  );
}
