"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/auth/session-context";
import { fetchCoachLinks } from "@/lib/coach/coach-links-store";
import { departureNotice, recentDepartures, type CoachLinkRecord } from "@/lib/coach/link-status";

/**
 * The Roster's line for athletes who left.
 *
 * A quiet notice, not an alarm: an athlete withdrawing is a normal event in a
 * coaching business, and the Roster's job is to stop a coach wondering where
 * somebody went -- not to make them feel they did something wrong. So it is a
 * muted sentence, no colour, no icon, no action, and it goes away on its own
 * after a fortnight or the moment the athlete links again.
 *
 * Renders nothing at all when nobody left, and nothing when the read fails --
 * a notice that is sometimes an error box is worse than no notice.
 *
 * The Roster already holds a fresh, live read of the coach's links and passes
 * it in as `records`, so the screen does not read the same table twice. Null
 * means that read has not landed yet. Omitted, the notice reads for itself.
 */
export function DepartureNotice({ records }: { records?: readonly CoachLinkRecord[] | null } = {}) {
  const { state } = useSession();
  const coachId = state.status === "signed-in" ? state.user.id : null;
  const [fetched, setText] = useState<string | null>(null);
  const given = records !== undefined;
  const text = given ? (records ? departureNotice(recentDepartures(records, new Date())) : null) : fetched;

  useEffect(() => {
    if (!coachId || given) return;
    let cancelled = false;
    void fetchCoachLinks(coachId)
      .then((records) => {
        if (!cancelled) setText(departureNotice(recentDepartures(records, new Date())));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [coachId, given]);

  if (!text) return null;
  return (
    <p role="status" className="m-0 max-w-[480px] text-center text-ui text-muted">
      {text}
    </p>
  );
}
