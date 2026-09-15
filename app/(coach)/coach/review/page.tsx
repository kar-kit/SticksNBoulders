import { ReviewQueue } from "@/components/coach/review-queue";

export const metadata = { title: "Review — Sticks N Boulders" };

/**
 * Order 32. The queue owns its own empty, loading and failed states, because
 * all three are real screens a coach sees rather than edge cases -- "Nothing to
 * review" is the outcome Ruairi is working toward, not an error.
 */
export default function ReviewPage() {
  return <ReviewQueue />;
}
