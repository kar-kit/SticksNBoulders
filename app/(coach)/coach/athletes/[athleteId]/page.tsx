import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Athlete — Sticks N Boulders" };

/**
 * Athlete View is Order 25. The rail links to it from every coach screen, so a
 * 404 here would be reachable in one click from the roster.
 */
export default function AthleteViewPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <EmptyState
        title="Nothing logged yet"
        body="Their current block, recent sessions, maxes and bodyweight will be here once they start training."
      />
    </div>
  );
}
