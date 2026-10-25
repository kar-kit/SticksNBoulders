import { cn } from "@/lib/cn";

/**
 * "Failed" beside a set's numbers (F19): the athlete missed it, and the reps
 * shown are the ones they completed.
 *
 * One component for every surface that shows a set -- the Log, History, the
 * coach's session list and the clip panel -- so the marker reads the same
 * everywhere a coach or athlete meets it. Words, not a colour alone: a red
 * dot says nothing to a screen reader or to someone who cannot tell red from
 * the warm palette around it. The danger line is the colour the product
 * already uses for "this went wrong", in outline so it never competes with
 * the accent-filled PR badge.
 *
 * Static. Nothing about a miss is worth animating, and a still marker needs
 * no motion gate on the shared side (docs/athlete-motion.md).
 */
export function FailedMark({ className, label }: { className?: string; label?: string }) {
  return (
    <span
      data-failed=""
      // The visible word is the name, unless the caller has a fuller one
      // ("Set 2: failed") for a mark that sits apart from its row's label.
      {...(label ? { role: "img", "aria-label": label } : {})}
      className={cn(
        "inline-flex h-4 flex-none items-center rounded-full border border-danger-line bg-surface px-1.5",
        "font-mono text-label font-semibold uppercase text-danger-line",
        className,
      )}
    >
      {label ? <span aria-hidden="true">Failed</span> : "Failed"}
    </span>
  );
}
