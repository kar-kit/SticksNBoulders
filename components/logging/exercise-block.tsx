"use client";

import type { ReactNode } from "react";
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
  /** Written down here, not yet at Appwrite. A quiet dot, never an error. */
  pendingSync?: boolean;
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
  /**
   * The camera for this exercise, composed in rather than built here so this
   * component stays presentational. Absent when nothing has been logged yet:
   * a camera with nowhere to attach produces a clip the product then has to
   * explain away.
   */
  camera?: ReactNode;
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
  camera,
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
        <div className="flex items-center gap-1">
          {sets.length > 0 ? camera : null}
          {sets.length > 0 && onUndo ? (
            <Button variant="ghost" size="sm" onClick={onUndo}>
              Undo last set
            </Button>
          ) : null}
        </div>
      </header>

      {sets.length > 0 || draft ? <SetRowHeader /> : null}

      <div className="flex flex-col gap-1.5">
        {sets.map((set, at) => (
          <SetRow
            key={set.clientSetId}
            index={displayIndex(sets, at)}
            set={set}
            state="logged"
            pendingSync={set.pendingSync}
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
