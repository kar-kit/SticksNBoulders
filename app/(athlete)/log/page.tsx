import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Log — Sticks N Boulders" };

export default function LogPage() {
  return (
    <div className="pt-safe-8 flex flex-col gap-5 pb-6">
      <h1 className="m-0 text-display font-semibold">Log</h1>
      <EmptyState title="No session running" body="Starting one is Order 7. The set row it will use is already built." />
    </div>
  );
}
