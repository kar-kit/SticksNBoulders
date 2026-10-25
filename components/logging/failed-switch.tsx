"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";
import { haptic } from "@/lib/ui/haptics";

/**
 * "Failed": the athlete missed the set (F19).
 *
 * A switch, like Warm-up beside it on the pad: `role="switch"` with
 * `aria-checked`, and the visible word as its name, so a screen reader hears
 * "Failed, switch, off". It lives in the sheet the athlete is already
 * typing in -- the keypad and the RPE chips -- and never on the row, where a
 * stray thumb on the most-tapped surface in the app could fail a set nobody
 * missed.
 *
 * On reads in the danger colours rather than the accent: the accent is what
 * a good thing looks like here (the confirm, a PR), and a missed rep is not
 * one. The fill is paint only, so it answers under reduced motion too; the
 * press is `tap`, safe to use bare inside components/logging
 * (docs/athlete-motion.md).
 *
 * Toggling records nothing on its own. It changes the row or the draft, and
 * the set is written by the confirm square or Save, as everything else is.
 */
export function FailedSwitch({
  failed,
  onToggle,
  className,
  hint,
}: {
  failed: boolean;
  onToggle: (failed: boolean) => void;
  className?: string;
  /** A second line under the word, for the roomier RPE sheet. */
  hint?: string;
}) {
  const hintId = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={failed}
      // The name is the word alone; the hint is its description.
      aria-label="Failed"
      aria-describedby={hint ? hintId : undefined}
      data-failed-switch=""
      onClick={() => {
        haptic("light");
        onToggle(!failed);
      }}
      className={cn(
        "tap flex h-12 flex-1 flex-col items-center justify-center rounded-control text-ui font-semibold",
        failed ? "bg-danger-fill text-on-danger-fill" : "border border-border bg-surface text-muted",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
        className,
      )}
    >
      <span>Failed</span>
      {hint ? (
        // Read as the switch's description, after its name and state.
        <span id={hintId} className={cn("text-caption font-normal", failed ? "text-on-danger-fill" : "text-muted-2")}>
          {hint}
        </span>
      ) : null}
    </button>
  );
}
