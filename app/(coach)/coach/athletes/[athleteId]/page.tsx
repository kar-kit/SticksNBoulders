import { Suspense } from "react";
import { AthleteView } from "@/components/coach/athlete-view";
import { AthleteLinkGate } from "@/components/coach/athlete-link-gate";

export const metadata = { title: "Athlete — Sticks N Boulders" };

/**
 * Athlete View, Order 25. Everything about one person on one screen: current
 * maxes and DOTS (editable inline), the current block's week, bodyweight,
 * their videos with the feedback on each, per-lift e1RM and records, and
 * recent sessions. Laid out per Joey's review of 16 Oct 2026; see
 * components/coach/athlete-view.tsx.
 *
 * The screen is a client component because every read goes through the
 * coach's own Appwrite session -- the circle team is the permission, so a
 * server render with the API key would be reading past it. What it shows is
 * gated on `coach_athlete_links`; see components/coach/athlete-view.tsx.
 *
 * `?view=bodyweight` and `?clip=<setId>` open a dialog over the page. They
 * are read on the client (useSearchParams), hence the Suspense boundary, and
 * grant nothing: a clip id that is not one of this athlete's opens nothing.
 *
 * Still absent, on purpose: progress against the block beyond which days
 * were started (nothing is inferred from what was lifted), the personal RPE
 * curve (no `personal_rpe_curves` yet), and the attempt board (February, not
 * the MVP).
 */
export default async function AthleteViewPage({
  params,
}: {
  params: Promise<{ athleteId: string }>;
}) {
  const { athleteId } = await params;

  // Order 16.6: the gate watches the link live, so a revoke mid-visit swaps to
  // the same "no longer linked" screen the rest of the coach side uses.
  return (
    <AthleteLinkGate athleteId={athleteId}>
      <Suspense fallback={<p className="m-0 p-8 text-ui text-muted">Loading…</p>}>
        <AthleteView athleteId={athleteId} />
      </Suspense>
    </AthleteLinkGate>
  );
}
