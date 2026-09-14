"use client";

import { cn } from "@/lib/cn";
import { formatRest, restRemainingMs, type RestTimer } from "@/lib/logging/rest-timer";

/**
 * The rest timer, pinned under the session.
 *
 * It appears when a set is logged and stays until it is skipped or another set
 * replaces it. It is the only thing on this screen that is not about entering a
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
}

export function RestBar({ timer, now, onExtend, onSkip }: RestBarProps) {
  const remaining = restRemainingMs(timer, now);
  const over = remaining < 0;

  return (
    <section
      // Not aria-live: a value that changes every second would talk over
      // everything else. A screen reader reads it when asked, like a clock.
      role="timer"
      aria-label="Rest timer"
      className="flex flex-none items-center gap-3 border-t border-border bg-surface px-3 pt-3 pb-[22px]"
    >
      <span className="font-mono text-label uppercase text-muted-2">Rest</span>
      <span
        className={cn(
          "font-mono text-title tabular-nums",
          // The number turning negative is the whole signal. It changes weight
          // rather than colour, because every colour that reads as "over" also
          // reads as "wrong", and resting longer is not a mistake.
          over ? "text-muted" : "font-semibold text-foreground",
        )}
      >
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
