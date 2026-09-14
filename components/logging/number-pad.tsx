"use client";

import { cn } from "@/lib/cn";
import { padDisplay, press, type PadKey, type PadState } from "@/lib/logging/number-pad";

/**
 * The number pad. Every number in this product is typed here, because no
 * keyboard ever appears on the logging screen.
 *
 * Keys are 56px and the grid is three wide: an athlete hits these one-handed,
 * breathing hard, without looking. The warm-up toggle sits in the sheet rather
 * than behind a long press -- the component spec's own objection to hidden
 * gestures on the most-used screen in the app is that they are a support
 * burden, and it applies to the flag as much as to anything else.
 */

export interface NumberPadProps {
  state: PadState;
  onChange: (next: PadState) => void;
  /** Moves to the next field, or logs the set when there is no next field. */
  onNext: () => void;
  nextLabel: string;
  isWarmup: boolean;
  onToggleWarmup: (isWarmup: boolean) => void;
  onDismiss: () => void;
}

const KEYS: PadKey[][] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [".", "0", "back"],
];

const FIELD_LABEL = { load: "Weight, kg", reps: "Reps" } as const;

export function NumberPad({
  state,
  onChange,
  onNext,
  nextLabel,
  isWarmup,
  onToggleWarmup,
  onDismiss,
}: NumberPadProps) {
  const disabled = (key: PadKey) => key === "." && state.field === "reps";

  return (
    <section
      aria-label={`${FIELD_LABEL[state.field]} keypad`}
      className="flex flex-none flex-col gap-3 border-t border-border bg-surface px-3 pt-3.5 pb-[22px]"
    >
      <div className="flex items-center justify-between px-1">
        <span className="font-mono text-label uppercase text-muted-2">{FIELD_LABEL[state.field]}</span>
        <output className="text-value-lg font-semibold tabular-nums text-foreground">
          {padDisplay(state)}
        </output>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {KEYS.flat().map((key) => (
          <button
            key={key}
            type="button"
            disabled={disabled(key)}
            onClick={() => onChange(press(state, key))}
            // "Backspace", not "Delete": History puts this pad on screen
            // beside a "Delete set" button, and a screen reader announcing two
            // adjacent controls as Delete is a genuinely destructive confusion.
            aria-label={key === "back" ? "Backspace" : key === "." ? "Decimal point" : key}
            className={cn(
              "flex h-14 items-center justify-center rounded-control text-value-sm font-semibold",
              "bg-surface-2 text-foreground active:bg-accent-pressed active:text-on-accent-pressed",
              "disabled:bg-surface disabled:text-muted-2",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
            )}
          >
            {key === "back" ? "⌫" : key}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={isWarmup}
          onClick={() => onToggleWarmup(!isWarmup)}
          className={cn(
            "flex h-12 flex-1 items-center justify-center rounded-control text-ui font-semibold",
            isWarmup
              ? "bg-accent-fill text-on-accent"
              : "border border-border bg-surface text-muted",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
          )}
        >
          Warm-up
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="flex h-12 flex-1 items-center justify-center rounded-control border border-border bg-surface text-ui font-medium text-muted"
        >
          Done
        </button>
        <button
          type="button"
          onClick={onNext}
          className="flex h-12 flex-1 items-center justify-center rounded-control bg-accent-fill text-ui font-bold text-on-accent active:bg-accent-pressed active:text-on-accent-pressed"
        >
          {nextLabel}
        </button>
      </div>
    </section>
  );
}
