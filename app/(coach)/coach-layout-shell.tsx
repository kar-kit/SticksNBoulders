"use client";

import { useEffect, useState } from "react";
import { CoachShell, type CoachAthlete } from "@/components/shell/coach-shell";
import { fetchAthleteNames } from "@/lib/auth/athletes";
import { useSession } from "@/lib/auth/session-context";
import { fetchClips, fetchReviewedSetIds, subscribeToClips } from "@/lib/review/queue-store";
import { browserAppwrite } from "@/appwrite/browser-client";

/**
 * Loads the athlete rail for the coach shell.
 *
 * The rail is the same on every coach screen, so it is fetched here once rather
 * than by each page.
 *
 * The Review badge is counted from the same two reads the queue itself uses, so
 * the number beside the nav and the number of clips on the screen cannot
 * disagree. A badge that says seven over a queue of four is worse than no badge:
 * it sends a coach looking for work that is not there.
 */
export function CoachLayoutShell({ children }: { children: React.ReactNode }) {
  const { state } = useSession();
  const [athletes, setAthletes] = useState<CoachAthlete[]>([]);
  const [reviewCount, setReviewCount] = useState(0);

  const athleteIds = state.status === "signed-in" ? state.coach.athleteIds : null;
  const coachId = state.status === "signed-in" ? state.user.id : null;

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

  useEffect(() => {
    if (!coachId || !athleteIds || athleteIds.length === 0) return;
    let cancelled = false;

    const count = async () => {
      const [clips, reviewed] = await Promise.all([
        fetchClips(athleteIds),
        fetchReviewedSetIds(coachId),
      ]);
      if (!cancelled) setReviewCount(clips.filter((clip) => !reviewed.has(clip.id)).length);
    };

    void count().catch(() => {});
    // Live, like the queue: a clip arriving while the coach is on the Roster
    // should change the badge, which is the whole reason the badge is in the
    // nav rather than on the Review screen.
    try {
      const { databaseId } = browserAppwrite();
      const stop = subscribeToClips(databaseId, () => {
        void count().catch(() => {});
      });
      return () => {
        cancelled = true;
        stop();
      };
    } catch {
      return () => {
        cancelled = true;
      };
    }
  }, [athleteIds, coachId]);

  return (
    <CoachShell athletes={athletes} reviewCount={reviewCount}>
      {children}
    </CoachShell>
  );
}
