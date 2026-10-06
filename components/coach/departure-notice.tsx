"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/auth/session-context";
import { fetchCoachLinks } from "@/lib/coach/coach-links-store";
import { departureNotice, recentDepartures } from "@/lib/coach/link-status";

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
 */
export function DepartureNotice() {
  const { state } = useSession();
  const coachId = state.status === "signed-in" ? state.user.id : null;
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!coachId) return;
    let cancelled = false;
    void fetchCoachLinks(coachId)
      .then((records) => {
        if (!cancelled) setText(departureNotice(recentDepartures(records, new Date())));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [coachId]);

  if (!text) return null;
  return (
    <p role="status" className="m-0 max-w-[480px] text-center text-ui text-muted">
      {text}
    </p>
  );
}
