"use client";

import { useState, type ReactNode } from "react";
import { useArrivals } from "@/components/ui/motion";
import { Button } from "@/components/ui/button";
import { TrashIcon } from "@/components/ui/icons";
import { SetRow, SetRowHeader } from "./set-row";
import type { LoggableSet, RpeValue } from "@/lib/logging/set";
import { plannedIndex } from "@/lib/logging/plan";
import type { UnitPreference } from "@/lib/units";

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
  /** "suggested from RPE 7 @ 170", when the load came from the RPE engine. */
  note?: string | null;
  /** The load is the app's suggestion, untouched. Marked "Suggested" on the row. */
  suggested?: boolean;
}

// `videoRequired` (from LoggableSet) on a planned row is the coach's ask: a
// camera badge before it is logged, never a block on the confirm. On a
// logged set it is the same ask, badged until `hasVideo`.

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
  /**
   * Another row, prefilled from the one above it. Confirming a set adds none,
   * so this is the only way to the next one: it shows whenever the exercise
   * has a logged set or a row, including once every row is confirmed.
   */
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
  /** The athlete's unit, for every load in the block. Kilos when absent. */
  unit?: UnitPreference;
  /**
   * Takes the whole exercise out of the session: its rows, and every set
   * logged into it. The screen holds the undo; this only asks first when there
   * is logged work to lose.
   */
  onRemove?: () => void;
  /** Why the exercise cannot be removed, if it cannot. Shown in place of the button. */
  removeBlocked?: string | null;
  /**
   * Flips one set between warm-up and working: a logged set by its id, or a
   * row not logged yet by its id. The set number on each row is the switch.
   */
  onToggleWarmup?: (clientSetId: string) => void;
  /**
   * Opens the variant picker: the same movement on another implement. Absent
   * when the library holds no sibling, so the button is never a dead end.
   */
  onSwap?: () => void;
  /**
   * The exercise the coach prescribed, when the athlete has swapped this
   * block to another variant. Shown under the name so the swap is visible
   * on the athlete's side too.
   */
  prescribedAs?: string | null;
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
  unit = "kg",
  onRemove,
  removeBlocked = null,
  onToggleWarmup,
  onSwap,
  prescribedAs = null,
}: ExerciseBlockProps) {
  const working = sets.filter((s) => !s.isWarmup).length;
  const open = planned.length > 0;
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  // Planned rows only: a logged set read back after a reload was there all
  // along, and must not rise in on every load (docs/athlete-motion.md).
  const arrived = useArrivals(planned.map((row) => row.clientSetId));

  // Nothing logged means nothing to lose: it goes straight to the undo toast.
  // Logged work asks once, inline, because the toast alone is five seconds
  // between an athlete and a whole exercise of sets.
  const askRemove = () => {
    if (sets.length === 0 && !removeBlocked) onRemove?.();
    else setConfirmingRemove(true);
  };

  return (
    <section aria-label={name} className="flex flex-col gap-2">
      <header className="flex items-center justify-between gap-3">
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
        <span className="flex flex-none items-center">
        {onSwap ? (
          <button
            type="button"
            onClick={onSwap}
            aria-label={`Swap variant of ${name}`}
            className="flex h-11 flex-none items-center rounded-chip px-2 text-action text-muted tap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line"
          >
            Swap
          </button>
        ) : null}
        {onRemove && !confirmingRemove ? (
          // An icon, quiet, and a long way from the confirm square and Add
          // set. It looks like neither, so a thumb mid-set does not hit it by
          // accident, and it no longer repeats the word "Remove" down the
          // screen once per exercise. The confirm below still asks first
          // whenever there is logged work to lose.
          <button
            type="button"
            onClick={askRemove}
            aria-label={`Remove ${name} from this session`}
            className="-mr-2 flex size-11 flex-none items-center justify-center rounded-chip text-muted tap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line"
          >
            <TrashIcon />
          </button>
        ) : null}
        </span>
      </header>

      {prescribedAs ? <p className="m-0 -mt-2 text-caption text-muted-2">Coach&rsquo;s pick: {prescribedAs}</p> : null}

      {confirmingRemove ? (
        <div
          role="group"
          aria-label={`Remove ${name}?`}
          className="flex flex-col gap-3 rounded-card border border-border bg-surface p-3"
        >
          {removeBlocked ? (
            <p className="m-0 text-caption text-muted">{removeBlocked}</p>
          ) : (
            <p className="m-0 text-body">
              Remove {name}? Its {sets.length} logged set{sets.length === 1 ? "" : "s"} will be deleted.
            </p>
          )}
          <div className="flex gap-3">
            {removeBlocked ? null : (
              <Button
                variant="danger"
                block
                onClick={() => {
                  setConfirmingRemove(false);
                  onRemove?.();
                }}
              >
                Remove exercise
              </Button>
            )}
            <Button variant="secondary" block onClick={() => setConfirmingRemove(false)}>
              Keep
            </Button>
          </div>
        </div>
      ) : null}

      {target && target.length > 0 ? (
        <ul aria-label={`${name} prescribed`} className="m-0 flex list-none flex-col gap-0.5 p-0">
          {target.map((line, at) => (
            <li key={at} className="text-ui text-muted">
              {line}
            </li>
          ))}
        </ul>
      ) : null}

      {sets.length > 0 || open ? <SetRowHeader unit={unit} /> : null}

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
            onToggleWarmup={onToggleWarmup ? () => onToggleWarmup(set.clientSetId) : undefined}
            unit={unit}
          />
        ))}

        {planned.map((row, at) => (
          <SetRow
            key={row.clientSetId}
            index={plannedIndex(working, planned, at)}
            set={row}
            state={at === 0 ? "active" : "planned"}
            focused={focusedId === row.clientSetId}
            note={row.note ?? null}
            suggested={row.suggested}
            onPressLoad={() => onFocus?.(row.clientSetId, "load")}
            onPressReps={() => onFocus?.(row.clientSetId, "reps")}
            onPressRpe={() => onFocus?.(row.clientSetId, "rpe")}
            onConfirm={() => onConfirm?.(row.clientSetId)}
            onDiscard={onDiscard ? () => onDiscard(row.clientSetId) : undefined}
            onToggleWarmup={onToggleWarmup ? () => onToggleWarmup(row.clientSetId) : undefined}
            unit={unit}
            arrived={arrived(row.clientSetId)}
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
