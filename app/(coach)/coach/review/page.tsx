import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Review — Sticks N Boulders" };

/**
 * The Review Queue is Order 32. The shell's nav links here, so this exists
 * rather than a 404 -- and what it shows is the queue's real empty state, which
 * is what Ruairi sees on any day he has already cleared it.
 */
export default function ReviewPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <EmptyState
        title="Nothing to review"
        body="Clips your athletes attach to their sets land here, newest first, with the load and reps beside them."
      />
    </div>
  );
}
