"use client";

import { useEffect, useState } from "react";
import { CoachShell, type CoachAthlete } from "@/components/shell/coach-shell";
import { fetchAthleteNames } from "@/lib/auth/athletes";
import { useSession } from "@/lib/auth/session-context";

/**
 * Loads the athlete rail for the coach shell.
 *
 * The rail is the same on every coach screen, so it is fetched here once rather
 * than by each page.
 */
export function CoachLayoutShell({ children }: { children: React.ReactNode }) {
  const { state } = useSession();
  const [athletes, setAthletes] = useState<CoachAthlete[]>([]);

  const athleteIds = state.status === "signed-in" ? state.coach.athleteIds : null;

  useEffect(() => {
    if (!athleteIds || athleteIds.length === 0) return;
    let cancelled = false;
    // An empty rail is a worse outcome than a stale one, but a failed lookup
    // must not blank the whole coach side.
    void fetchAthleteNames(athleteIds)
      .then((found) => {
        if (!cancelled) setAthletes(found);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [athleteIds]);

  return <CoachShell athletes={athletes}>{children}</CoachShell>;
}
