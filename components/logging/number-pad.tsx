"use client";

import { cn } from "@/lib/cn";
import { FailedSwitch } from "./failed-switch";
import { haptic } from "@/lib/ui/haptics";
import {
  canStepDown,
  DURATION_SEPARATOR,
  padDisplay,
  press,
  step,
  stepSize,
  type PadKey,
  type PadState,
} from "@/lib/logging/number-pad";

/**
 * The number pad. Every number in this product is typed here, because no
 * keyboard ever appears on the logging screen.
 *
 * Keys are 56px and the grid is three wide: an athlete hits these one-handed,
 * breathing hard, without looking. The warm-up toggle sits in the sheet rather
 * than behind a long press -- the component spec's own objection to hidden
 * gestures on the most-used screen in the app is that they are a support
 * burden, and it applies to the flag as much as to anything else.
 *
 * The Failed switch (F19) sits beside it for the same reason, when the
 * screen offers one: a missed set is logged with the reps actually
 * completed -- typed on this pad, 0 included -- and the flag says the rest.
 *
 * A cardio row (F23) types its time and level here too, the same keys in
 * the same places. Time is minutes, so "20" is the whole entry for twenty
 * minutes, and the decimal key turns into ":" for the athlete who wants the
 * seconds -- a sweaty thumb never has to find a colon on a keyboard. The −
 * and + step a minute. Neither switch applies to cardio, so the screen
 * passes no `onToggleWarmup` and no `onToggleFailed` and the row under the
 * keys is Done and Next alone.
 */

export interface NumberPadProps {
  state: PadState;
  onChange: (next: PadState) => void;
  /** Moves to the next field, or logs the set when there is no next field. */
  onNext: () => void;
  nextLabel: string;
  isWarmup?: boolean;
  /** The Warm-up switch. Absent hides it: a cardio row (F23) is never a warm-up. */
  onToggleWarmup?: (isWarmup: boolean) => void;
  /**
   * The set was missed (F19). With `onToggleFailed`, a Failed switch beside
   * Warm-up; without it, none (a screen that does not record failure).
   */
  failed?: boolean;
  onToggleFailed?: (failed: boolean) => void;
  /**
   * Closes the pad, keeping what was typed. Absent hides Done: the Log's
   * edit sheet for a logged set has its own Cancel and Save, and a third
   * way out whose meaning sits somewhere between them is one too many.
   */
  onDismiss?: () => void;
  /**
   * Drawn inside a sheet that owns the edge and the fill (the Log screen's
   * LogSheet). Without it the pad draws its own top border, as History's
   * in-flow pad does.
   */
  inSheet?: boolean;
}

const KEYS: PadKey[][] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [".", "0", "back"],
];

/** The load is labelled in the unit it is being typed in, which is the athlete's. */
const FIELD_LABELS: Record<PadState["field"], (state: PadState) => string> = {
  load: (state) => `Weight, ${state.unit ?? "kg"}`,
  reps: () => "Reps",
  duration: () => "Time, min",
  level: () => "Level",
};
const fieldLabel = (state: PadState): string => FIELD_LABELS[state.field](state);

/** "weight by 2.5 kg", "reps by 1": what a screen reader says a stepper does. */
const STEP_LABELS: Record<PadState["field"], (state: PadState) => string> = {
  load: (state) => `weight by ${stepSize(state)} ${state.unit ?? "kg"}`,
  reps: () => "reps by 1",
  duration: () => "time by 1 minute",
  level: () => "level by 1",
};
const stepLabel = (state: PadState): string => STEP_LABELS[state.field](state);

const STEPPER =
  "tap flex h-12 w-14 flex-none items-center justify-center rounded-control border border-border bg-surface-2 " +
  "text-value-sm font-semibold text-foreground active:bg-accent-pressed active:text-on-accent-pressed " +
  "disabled:bg-surface disabled:text-muted-2 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line";

export function NumberPad({
  state,
  onChange,
  onNext,
  nextLabel,
  isWarmup = false,
  onToggleWarmup,
  failed = false,
  onToggleFailed,
  onDismiss,
  inSheet = false,
}: NumberPadProps) {
  const disabled = (key: PadKey) => key === "." && state.field === "reps";
  // On a duration the decimal key is the minutes-seconds separator (F23).
  const separator = state.field === "duration";
  /**
   * Every key and stepper answers with the lightest tick, like a phone
   * keyboard. Android only; iOS has no API and the key's own press carries it
   * (lib/ui/haptics.ts). The value lands either way.
   */
  const change = (next: PadState) => {
    haptic("light");
    onChange(next);
  };

  return (
    <section
      aria-label={`${fieldLabel(state)} keypad`}
      className={cn(
        "flex flex-none flex-col gap-3 px-3 pt-3.5 pb-[22px]",
        !inSheet && "border-t border-border bg-surface",
      )}
    >
      {/*
        − and + either side of the value: the next plate pair on, or one rep
        more, without retyping the number. Beside the value rather than in the
        key grid, so the 3×4 digits stay where a thumb already knows them.
      */}
      <div className="flex items-center gap-2 px-1">
        <span className="flex-1 font-mono text-label uppercase text-muted-2">{fieldLabel(state)}</span>
        <button
          type="button"
          onClick={() => change(step(state, -1))}
          disabled={!canStepDown(state)}
          aria-label={`Decrease ${stepLabel(state)}`}
          className={STEPPER}
        >
          −
        </button>
        <output className="min-w-[4.5ch] text-center text-value-lg font-semibold tabular-nums text-foreground">
          {padDisplay(state)}
        </output>
        <button
          type="button"
          onClick={() => change(step(state, 1))}
          aria-label={`Increase ${stepLabel(state)}`}
          className={STEPPER}
        >
          +
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {KEYS.flat().map((key) => (
          <button
            key={key}
            type="button"
            disabled={disabled(key)}
            onClick={() => change(press(state, key))}
            // "Backspace", not "Delete": History puts this pad on screen
            // beside a "Delete set" button, and a screen reader announcing two
            // adjacent controls as Delete is a genuinely destructive confusion.
            aria-label={
              key === "back" ? "Backspace" : key === "." ? (separator ? "Seconds" : "Decimal point") : key
            }
            className={cn(
              "tap flex h-14 items-center justify-center rounded-control text-value-sm font-semibold",
              "bg-surface-2 text-foreground active:bg-accent-pressed active:text-on-accent-pressed",
              "disabled:bg-surface disabled:text-muted-2",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
            )}
          >
            {key === "back" ? "⌫" : key === "." && separator ? DURATION_SEPARATOR : key}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        {onToggleWarmup ? (
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
        ) : null}
        {onToggleFailed ? <FailedSwitch failed={failed} onToggle={onToggleFailed} /> : null}
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="flex h-12 flex-1 items-center justify-center rounded-control border border-border bg-surface text-ui font-medium text-muted"
          >
            Done
          </button>
        ) : null}
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
