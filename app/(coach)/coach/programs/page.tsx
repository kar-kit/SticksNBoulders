import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Programs — Sticks N Boulders" };

/** The Program Editor is Order 19, and its shape is still open with Ruairi. */
export default function ProgramsPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <EmptyState
        title="No programs yet"
        body="Blocks you write for your athletes live here. Building this screen is waiting on how you actually write a block."
      />
    </div>
  );
}
