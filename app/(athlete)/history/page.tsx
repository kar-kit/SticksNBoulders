import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "History — Sticks N Boulders" };

export default function HistoryPage() {
  return (
    <div className="pt-safe-8 flex flex-col gap-5 pb-6">
      <h1 className="m-0 text-display font-semibold">History</h1>
      <EmptyState
        title="Nothing logged yet"
        body="Every session you finish lands here, newest first, and this is where you correct a set you got wrong."
      />
    </div>
  );
}
