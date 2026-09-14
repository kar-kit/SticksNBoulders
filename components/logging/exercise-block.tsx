"use client";

import { Button } from "@/components/ui/button";
import { SetRow, SetRowHeader } from "./set-row";
import type { LoggableSet, RpeValue } from "@/lib/logging/set";

/**
 * One exercise inside a running session: its logged sets, and the row being
 * entered.
 *
 * Presentational. The pad and the RPE sheet live at screen level because only
 * one row is ever active across the whole session, and two sheets fighting over
 * the bottom of the screen is the kind of bug that only shows up mid-set.
 */

export interface LoggedSet extends LoggableSet {
  clientSetId: string;
}

export interface ExerciseBlockProps {
  name: string;
  sets: readonly LoggedSet[];
  /** The row being entered, when this is the exercise being logged into. */
  draft?: LoggableSet | null;
  onFocus?: (field: "load" | "reps" | "rpe") => void;
  onConfirm?: () => void;
  /** Makes this the exercise being logged into. */
  onActivate?: () => void;
  /** Removes the most recently logged set. The fix for a wrong tap. */
  onUndo?: () => void;
}

/**
 * Working sets are numbered; warm-ups show W.
 *
 * Numbering counts working sets only, so a session that warmed up four times
 * still calls the first working set 1 -- which is what the athlete and the
 * coach both mean by "set 1".
 */
function displayIndex(sets: readonly LoggableSet[], at: number): number | "W" {
  if (sets[at].isWarmup) return "W";
  return sets.slice(0, at + 1).filter((s) => !s.isWarmup).length;
}

export function ExerciseBlock({
  name,
  sets,
  draft = null,
  onFocus,
  onConfirm,
  onActivate,
  onUndo,
}: ExerciseBlockProps) {
  const working = sets.filter((s) => !s.isWarmup).length;
  const nextIndex: number | "W" = draft?.isWarmup ? "W" : working + 1;

  return (
    <section aria-label={name} className="flex flex-col gap-2">
      <header className="flex items-baseline justify-between gap-3">
        {draft ? (
          <h2 className="m-0 text-title font-semibold">{name}</h2>
        ) : (
          // Tapping an exercise is how you go back to it after moving on.
          <button
            type="button"
            onClick={onActivate}
            className="m-0 text-left text-title font-semibold text-foreground"
          >
            {name}
          </button>
        )}
        {sets.length > 0 && onUndo ? (
          <Button variant="ghost" size="sm" onClick={onUndo}>
            Undo last set
          </Button>
        ) : null}
      </header>

      {sets.length > 0 || draft ? <SetRowHeader /> : null}

      <div className="flex flex-col gap-1.5">
        {sets.map((set, at) => (
          <SetRow
            key={set.clientSetId}
            index={displayIndex(sets, at)}
            set={set}
            state="logged"
          />
        ))}

        {draft ? (
          <SetRow
            index={nextIndex}
            set={draft}
            state="active"
            onPressLoad={() => onFocus?.("load")}
            onPressReps={() => onFocus?.("reps")}
            onPressRpe={() => onFocus?.("rpe")}
            onConfirm={onConfirm}
          />
        ) : null}
      </div>

      {!draft && sets.length === 0 ? (
        <p className="m-0 text-ui text-muted">No sets yet — tap the name to start.</p>
      ) : null}
    </section>
  );
}

export type { RpeValue };
