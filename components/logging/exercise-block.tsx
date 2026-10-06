"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { SetRow, SetRowHeader } from "./set-row";
import type { LoggableSet, RpeValue } from "@/lib/logging/set";
import { plannedIndex } from "@/lib/logging/plan";

/**
 * One exercise inside a running session: its logged sets, then the rows not
 * logged yet.
 *
 * Presentational. The pad and the RPE sheet live at screen level because only
 * one row is ever being typed into across the whole session, and two sheets
 * fighting over the bottom of the screen is the kind of bug that only shows up
 * mid-set.
 */

export interface LoggedSet extends LoggableSet {
  clientSetId: string;
  /** Written down here, not yet at Appwrite. A quiet dot, never an error. */
  pendingSync?: boolean;
  /** Why this set cannot be deleted, if it cannot. */
  deleteBlocked?: string | null;
}

export interface PlannedSet extends LoggableSet {
  clientSetId: string;
}

export interface ExerciseBlockProps {
  name: string;
  sets: readonly LoggedSet[];
  /**
   * Rows not logged yet, in the order they will be done. The first is the one
   * the confirm square logs; the rest wait behind it.
   */
  planned?: readonly PlannedSet[];
  /** The row the pad is editing, if it is in this exercise. */
  focusedId?: string | null;
  onFocus?: (clientSetId: string, field: "load" | "reps" | "rpe") => void;
  onConfirm?: (clientSetId: string) => void;
  onDiscard?: (clientSetId: string) => void;
  /** Writes down another set for later, prefilled from the one above it. */
  onAddSet?: () => void;
  /** Makes this the exercise being logged into. */
  onActivate?: () => void;
  /** The logged set whose actions are open. */
  selectedId?: string | null;
  onSelect?: (clientSetId: string) => void;
  onDelete?: (clientSetId: string) => void;
  /**
   * The camera for this exercise, composed in rather than built here so this
   * component stays presentational. Absent when nothing has been logged yet:
   * a camera with nowhere to attach produces a clip the product then has to
   * explain away.
   */
  camera?: ReactNode;
  /**
   * What the coach prescribed, one line each, above the set rows (Order 22).
   * Absent for an exercise nobody prescribed.
   */
  target?: readonly string[] | null;
}

/**
 * Working sets are numbered; warm-ups show W.
 *
 * Numbering counts working sets only, so a session that warmed up four times
 * still calls the first working set 1 -- which is what the athlete and the
 * coach both mean by "set 1". It is derived from order every render, so
 * deleting set 2 of 4 renumbers the rest rather than leaving a gap.
 */
function displayIndex(sets: readonly LoggableSet[], at: number): number | "W" {
  if (sets[at].isWarmup) return "W";
  return sets.slice(0, at + 1).filter((s) => !s.isWarmup).length;
}

export function ExerciseBlock({
  name,
  sets,
  planned = [],
  focusedId = null,
  onFocus,
  onConfirm,
  onDiscard,
  onAddSet,
  onActivate,
  selectedId = null,
  onSelect,
  onDelete,
  camera,
  target = null,
}: ExerciseBlockProps) {
  const working = sets.filter((s) => !s.isWarmup).length;
  const open = planned.length > 0;

  return (
    <section aria-label={name} className="flex flex-col gap-2">
      <header className="flex items-baseline justify-between gap-3">
        {open ? (
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
      </header>

      {target && target.length > 0 ? (
        <ul aria-label={`${name} prescribed`} className="m-0 flex list-none flex-col gap-0.5 p-0">
          {target.map((line, at) => (
            <li key={at} className="text-ui text-muted">
              {line}
            </li>
          ))}
        </ul>
      ) : null}

      {sets.length > 0 || open ? <SetRowHeader /> : null}

      <div className="flex flex-col gap-1.5">
        {sets.map((set, at) => (
          <SetRow
            key={set.clientSetId}
            index={displayIndex(sets, at)}
            set={set}
            state="logged"
            pendingSync={set.pendingSync}
            selected={selectedId === set.clientSetId}
            onSelect={onSelect ? () => onSelect(set.clientSetId) : undefined}
            onDelete={onDelete ? () => onDelete(set.clientSetId) : undefined}
            deleteBlocked={set.deleteBlocked ?? null}
          />
        ))}

        {planned.map((row, at) => (
          <SetRow
            key={row.clientSetId}
            index={plannedIndex(working, planned, at)}
            set={row}
            state={at === 0 ? "active" : "planned"}
            focused={focusedId === row.clientSetId}
            onPressLoad={() => onFocus?.(row.clientSetId, "load")}
            onPressReps={() => onFocus?.(row.clientSetId, "reps")}
            onPressRpe={() => onFocus?.(row.clientSetId, "rpe")}
            onConfirm={() => onConfirm?.(row.clientSetId)}
            onDiscard={() => onDiscard?.(row.clientSetId)}
          />
        ))}
      </div>

      {!open && sets.length === 0 ? (
        <p className="m-0 text-ui text-muted">No sets yet — tap the name to start.</p>
      ) : null}

      {/*
        Add set and the camera sit together under the rows, per the Set Row
        spec (decided 14 Sep: one camera per exercise, beside Add set), and in
        reach of the thumb that just confirmed the row above.
      */}
      {open || sets.length > 0 ? (
        <div className="flex items-start justify-between gap-2">
          {onAddSet ? (
            <Button variant="secondary" onClick={onAddSet} aria-label={`Add a set to ${name}`}>
              + Add set
            </Button>
          ) : (
            <span />
          )}
          {sets.length > 0 ? camera : null}
        </div>
      ) : null}
    </section>
  );
}

export type { RpeValue };
