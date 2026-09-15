import { CurrentMaxes } from "@/components/coach/current-maxes";
import { RecentFeedback } from "@/components/coach/recent-feedback";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Athlete — Sticks N Boulders" };

/**
 * Athlete View is Order 25, and this page is still mostly its placeholder.
 *
 * RECENT FEEDBACK joins it at Order 33 for the same reason: the comments are
 * written in the Review Queue, which is organised around clearing, so a clip
 * leaves it the moment it is dealt with. This is the only place a coach can
 * read back everything they have said to one person.
 *
 * CURRENT MAXES lands early because Order 18's prescriptions need somewhere to
 * point: a percentage is a percentage of one of these numbers, so the panel
 * has to exist before a coach can write one. The rest of the screen -- the
 * block, recent sessions, bodyweight, and the inline editing this panel will
 * grow -- stays deferred rather than half-built.
 */
export default async function AthleteViewPage({
  params,
}: {
  params: Promise<{ athleteId: string }>;
}) {
  const { athleteId } = await params;

  return (
    <div className="flex h-full flex-col gap-8 p-8">
      <CurrentMaxes athleteId={athleteId} />
      <RecentFeedback athleteId={athleteId} />
      <EmptyState
        title="The rest of this screen is coming"
        body="Their current block, recent sessions and bodyweight will be here once Athlete View is built."
      />
    </div>
  );
}
