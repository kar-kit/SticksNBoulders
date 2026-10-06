"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { browserAppwrite } from "@/appwrite/browser-client";
import { EmptyState } from "@/components/ui/empty-state";
import { useSession } from "@/lib/auth/session-context";
import { canSeeCircle, fetchCoachLinks, subscribeToLinks } from "@/lib/coach/coach-links-store";
import {
  athleteLinkState,
  notLinkedCopy,
  sameAthletes,
  withAccess,
  type AthleteLinkState,
} from "@/lib/coach/link-status";

/**
 * "No longer linked", as a screen rather than an error.
 *
 * Exported on its own so any coach panel that discovers the link is gone can
 * render the same words -- the Athlete View is growing in parallel, and two
 * versions of this sentence would be two answers to one question.
 */
export function NotLinkedState({ state }: { state: Exclude<AthleteLinkState, { kind: "linked" }> }) {
  const copy = notLinkedCopy(state);
  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <EmptyState
        title={copy.title}
        body={copy.body}
        action={
          <Link href="/coach/roster" className="text-ui font-semibold text-foreground underline underline-offset-4">
            Back to your roster
          </Link>
        }
      />
    </div>
  );
}

/** How long a row-without-membership is re-checked before it is left on screen. */
const VISIBILITY_RETRIES = 10;
const VISIBILITY_RETRY_MS = 1000;

type Verdict = { athleteId: string; state: AthleteLinkState } | { athleteId: string; state: "unknown" };

/**
 * Renders an athlete's panels only while the coach is linked to them.
 *
 * Without this, an ex-athlete's URL renders every panel against reads the
 * circle no longer grants: lists come back empty and the screen says "No maxes
 * yet", which is a lie about a real person's training, and point reads fail
 * into "Couldn't load". Either way the coach is shown a broken screen for what
 * is a normal state.
 *
 * Fast path first. The session already carries the coach's active athletes, so
 * a linked athlete's panels start loading on the first render with no extra
 * round trip -- speed being Ruairi's loudest complaint. The link is checked
 * alongside, never cached, and live: if the athlete unlinks while the coach is
 * looking, the panels are swapped for the notice rather than left to fail.
 *
 * When the fresh read disagrees with the session, the session is refreshed, so
 * the rail and the Review badge catch up in the same moment. That runs both
 * ways: a re-link restores the rail without a reload.
 */
export function AthleteLinkGate({ athleteId, children }: { athleteId: string; children: ReactNode }) {
  const { state: session, refresh } = useSession();
  const coachId = session.status === "signed-in" ? session.user.id : null;
  const sessionIds = session.status === "signed-in" ? session.coach.athleteIds : [];
  const inSession = sessionIds.includes(athleteId);

  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [tick, setTick] = useState(0);
  const retries = useRef(0);

  // Read through refs so neither a session refresh nor a new refresh function
  // re-runs the check that caused it.
  const sessionIdsRef = useRef(sessionIds);
  const refreshRef = useRef(refresh);
  useEffect(() => {
    sessionIdsRef.current = sessionIds;
    refreshRef.current = refresh;
  });

  useEffect(() => {
    if (!coachId) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // Both in parallel: the row says whether a link exists, the circle says
    // whether it has reached Appwrite yet. A live re-link lands the row first
    // and the membership a moment later, and panels rendered in between would
    // read nothing and say "No maxes yet".
    void Promise.all([fetchCoachLinks(coachId), canSeeCircle(athleteId)])
      .then(([records, visible]) => {
        if (cancelled) return;
        const state = withAccess(athleteLinkState(athleteId, records), visible);
        setVerdict({ athleteId, state });
        if (state.kind === "not-visible" && retries.current < VISIBILITY_RETRIES) {
          retries.current += 1;
          retry = setTimeout(() => setTick((n) => n + 1), VISIBILITY_RETRY_MS);
        } else if (state.kind !== "not-visible") {
          retries.current = 0;
        }
        const active = records.filter((r) => r.status === "active").map((r) => r.athleteId);
        if (!sameAthletes(active, sessionIdsRef.current)) void refreshRef.current().catch(() => {});
      })
      .catch(() => {
        if (!cancelled) setVerdict({ athleteId, state: "unknown" });
      });
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
  }, [athleteId, coachId, tick]);

  useEffect(() => {
    if (!coachId) return;
    try {
      const { databaseId } = browserAppwrite();
      return subscribeToLinks(databaseId, () => {
        retries.current = 0;
        setTick((n) => n + 1);
      });
    } catch {
      // Realtime is an improvement, not a dependency. The next navigation
      // re-checks anyway.
      return;
    }
  }, [coachId]);

  if (!coachId) return null;

  const current = verdict && verdict.athleteId === athleteId ? verdict.state : null;

  if (current === null || current === "unknown") {
    // Not yet known, or the check itself failed. The session's answer stands
    // in: a coach with a flaky connection still sees an athlete they are
    // linked to, and nobody is shown panels the session never granted.
    if (inSession) return <>{children}</>;
    if (current === null) return <p className="m-0 p-8 text-ui text-muted" aria-busy>Loading…</p>;
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <EmptyState title="Couldn’t load this athlete" body="Refresh to try again." />
      </div>
    );
  }

  if (current.kind === "linked") return <>{children}</>;
  return <NotLinkedState state={current} />;
}
