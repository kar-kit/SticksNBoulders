import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Roster — Sticks N Boulders" };

export default function RosterPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      {/* The real Roster is Order 24 and is blocked on Ruairi's review-day
          sequence. This is its empty state, which is genuinely the first thing
          he will see: an account with no athletes on it. */}
      <EmptyState
        title="No athletes yet"
        body="Share your invite code and they'll appear here as they join, with whatever needs your attention first."
      />
    </div>
  );
}
