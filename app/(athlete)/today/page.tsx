import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Today — Sticks N Boulders" };

export default function TodayPage() {
  return (
    <div className="pt-safe-8 flex flex-col gap-5 pb-6">
      <h1 className="m-0 text-display font-semibold">Today</h1>
      {/* The real screen is Order 7. This is the empty state it will show on an
          account with no program and no session, which is what Ruairi sees on
          his first morning either way. */}
      <EmptyState
        title="Nothing scheduled"
        body="Start a session whenever you're ready. Once a coach writes you a program, it turns up here."
      />
    </div>
  );
}
