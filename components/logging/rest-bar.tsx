"use client";

import { formatRest, restRemainingMs, type RestTimer } from "@/lib/logging/rest-timer";

/**
 * The rest timer, in the Log screen's bottom sheet.
 *
 * It used to sit at the end of the page, under End session. On a prescribed
 * day with every set laid out, that is a long scroll below the row just
 * logged, so the timer the athlete wants to glance at was off screen. It now
 * takes its turn in the same sticky sheet as the pad and the RPE chips
 * (`inSheet`), pinned above the tab bar, and still only when it wins the
 * screen's `bottom` arbiter: entering a number outranks it.
 *
 * It appears when a set is logged and stays until it is skipped, another set
 * replaces it, or it reaches zero -- the screen takes it down then, with a
 * short buzz where the phone supports one. It is the only thing on this screen that is not about entering a
 * number, so it is deliberately the quietest: one line, no progress ring, no
 * colour that reads as a warning. An athlete glances at it between sets and
 * otherwise ignores it.
 *
 * No configuration, per the feature list -- two minutes and a +30s button.
 * Strong cut per-exercise rest defaults on purpose and this follows.
 */

export interface RestBarProps {
  timer: RestTimer;
  /** Ticked by the screen's existing clock, so there is only ever one interval. */
  now: Date;
  onExtend: () => void;
  onSkip: () => void;
  /** Inside the LogSheet, which already draws the surface and the top edge. */
  inSheet?: boolean;
}

export function RestBar({ timer, now, onExtend, onSkip, inSheet = false }: RestBarProps) {
  const remaining = restRemainingMs(timer, now);

  return (
    <section
      // Not aria-live: a value that changes every second would talk over
      // everything else. A screen reader reads it when asked, like a clock.
      role="timer"
      aria-label="Rest timer"
      className={
        inSheet
          ? "flex flex-none items-center gap-3 px-4 py-3"
          : "flex flex-none items-center gap-3 border-t border-border bg-surface px-3 pt-3 pb-[22px]"
      }
    >
      <span className="font-mono text-label uppercase text-muted-2">Rest</span>
      <span className="font-mono text-title font-semibold tabular-nums text-foreground">
        {formatRest(remaining)}
      </span>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onExtend}
          aria-label="Add 30 seconds to the rest"
          className="flex h-11 items-center rounded-chip border border-border bg-surface-2 px-3.5 text-action font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line"
        >
          +30s
        </button>
        <button
          type="button"
          onClick={onSkip}
          aria-label="Skip rest"
          className="flex h-11 items-center px-2 text-action text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line"
        >
          Skip
        </button>
      </div>
    </section>
  );
}
