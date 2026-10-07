import { AthleteView } from "@/components/coach/athlete-view";
import { AthleteLinkGate } from "@/components/coach/athlete-link-gate";

export const metadata = { title: "Athlete — Sticks N Boulders" };

/**
 * Athlete View, Order 25. Everything about one person on one screen: current
 * maxes (editable inline), per-lift e1RM and records, recent sessions,
 * bodyweight, DOTS, their videos and the feedback they have had.
 *
 * The screen is a client component because every read goes through the
 * coach's own Appwrite session -- the circle team is the permission, so a
 * server render with the API key would be reading past it. What it shows is
 * gated on `coach_athlete_links`; see components/coach/athlete-view.tsx.
 *
 * Still absent, on purpose: progress against the current block ("Adjust
 * program" opens the block itself in the Program Editor), the personal RPE
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
      <AthleteView athleteId={athleteId} />
    </AthleteLinkGate>
  );
}
