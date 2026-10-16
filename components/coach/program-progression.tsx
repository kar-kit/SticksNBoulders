"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { Tabs } from "@/components/ui/tabs";
import { StateMark } from "@/components/coach/program-outline";
import { CellInput } from "@/components/coach/program-editor-parts";
import { LoadPreviewLine } from "@/components/coach/load-preview";
import { cn } from "@/lib/cn";
import type { Exercise } from "@/lib/exercises/match";
import { rangeLabel, weekIndexOf, weekRange } from "@/lib/programming/calendar";
import {
  commitProgression,
  moveCell,
  parseShorthand,
  progressionText,
  splitReference,
  weekState,
  type LoadPreview,
} from "@/lib/programming/editor";
import type { BlockTree, DayTree, Prescription, ProgramOpInput, ProgramTree } from "@/lib/programming/program";
import { progressionGrid, type ProgressionCell } from "@/lib/programming/progression";

/**
 * The progression view: one block, a row per exercise slot, a column per
 * week, every cell editable. The same lift down the whole block in one line
 * -- the view coaching apps' users ask for most and few have (TeamBuildr has
 * it). docs/program-layout.md §2.
 *
 * A cell is the line's sets, reps and load as one shorthand (`3x5 75%`); text
 * without `NxM` is the load alone, so stepping 75% to 77.5% to 80% across a
 * row is three edits of a number. Under each cell, the kilos it resolves to.
 * Rest, notes, backoff and video stay in the week view: they are not what
 * progresses from week to week.
 *
 * Writes are the week view's own: one-field `updatePrescription`s through
 * `editLine` (shown at once, put back on refusal), and `addPrescription`
 * through `run` for an empty cell, which adds the line to the end of that
 * week's day. A dash is a week without the day, or one where an added line
 * would land in a different slot (lib/programming/progression.ts).
 *
 * Keyboard: arrows walk the grid (sideways from a cell's edge), Enter commits
 * and moves down, Tab walks the row, Escape puts a cell back.
 */

export interface ProgramProgressionProps {
  tree: ProgramTree;
  block: BlockTree;
  onSelectBlock: (blockId: string) => void;
  /** The week's column heading, which opens it in the week view. */
  onOpenWeek: (weekId: string) => void;
  anchor: string | null;
  logged: ReadonlySet<string> | null;
  weekName: (weekId: string) => string;
  names: ReadonlyMap<string, string>;
  exercises: readonly Exercise[];
  editable: boolean;
  busy: boolean;
  previewFor: (line: Prescription, day: DayTree) => LoadPreview | null;
  referenceFor: (exerciseId: string) => string | null;
  editLine: (line: Prescription, op: ProgramOpInput) => Promise<string | null>;
  run: (op: ProgramOpInput) => Promise<string | null>;
}

const ORDINAL = ["", "2nd", "3rd", "4th", "5th", "6th"];

export function ProgramProgression({
  tree,
  block,
  onSelectBlock,
  onOpenWeek,
  anchor,
  logged,
  weekName,
  names,
  exercises,
  editable,
  busy,
  previewFor,
  referenceFor,
  editLine,
  run,
}: ProgramProgressionProps) {
  const grid = useMemo(() => progressionGrid(block), [block]);
  const rows = useMemo(() => grid.days.flatMap((d) => d.rows), [grid]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const blockTabs = tree.blocks.map((b) => ({ value: b.id, label: b.name }));

  const setError = (key: string, message: string | null) =>
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });

  const focusCell = (from: HTMLElement, row: number, col: number) =>
    from.closest("table")?.querySelector<HTMLInputElement>(`[data-pcell="${row}-${col}"]`)?.focus();

  const onKey = (event: KeyboardEvent<HTMLInputElement>, row: number, col: number) => {
    const target = event.currentTarget;
    if (event.key === "Escape") {
      target.value = target.defaultValue;
      target.blur();
      return;
    }
    const caret = {
      atStart: target.selectionStart === 0,
      atEnd: target.selectionEnd === target.value.length,
    };
    // Cells are not in every row-col: a dash has no input, so a move skips
    // past it in the direction of travel.
    let next = moveCell({ row, col }, event.key, { rows: rows.length, cols: grid.weeks.length }, caret);
    while (next && !target.closest("table")?.querySelector(`[data-pcell="${next.row}-${next.col}"]`)) {
      next = moveCell(next, event.key, { rows: rows.length, cols: grid.weeks.length });
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (next) focusCell(target, next.row, next.col);
      else target.blur();
      return;
    }
    if (next) {
      event.preventDefault();
      focusCell(target, next.row, next.col);
    }
  };

  const commit = async (cell: ProgressionCell, exerciseId: string, key: string, text: string) => {
    if (cell.kind === "line") {
      const result = commitProgression(cell.line, text, exercises);
      if ("unchanged" in result) return setError(key, null);
      if ("error" in result) return setError(key, result.error);
      setError(key, null);
      const failed = await editLine(cell.line, result.op);
      if (failed) setError(key, failed);
      return;
    }
    if (cell.kind !== "empty" || !text.trim()) return;
    // A new line in that week's day: shorthand, or the load alone on one set.
    const shorthand = parseShorthand(text);
    if (shorthand && !shorthand.ok) return setError(key, shorthand.reason);
    const fields = shorthand?.value ?? { setCount: 1, reps: null, repMax: null, load: text.trim() };
    const { load, reference } = splitReference(fields.load ?? "", exercises);
    if (load.length > 120) return setError(key, "Load is 120 characters at most");
    setError(key, null);
    const referenceExerciseId = reference === undefined ? (referenceFor(exerciseId) ?? undefined) : reference;
    await run({
      op: "addPrescription",
      dayId: cell.day.id,
      exerciseId,
      setCount: fields.setCount,
      reps: fields.reps,
      repMax: fields.repMax,
      ...(load ? { load } : {}),
      ...(referenceExerciseId ? { referenceExerciseId } : {}),
    });
  };

  const empty = rows.length === 0;
  // A slot's row in the whole grid, for the keyboard: days are tbodies, but
  // Up and Down run straight through them.
  const rowOf = new Map(rows.map((r, at) => [r.id, at]));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {tree.blocks.length > 1 ? (
        <Tabs label="Block" tabs={blockTabs} value={block.id} onChange={onSelectBlock} />
      ) : null}
      {block.weeks.length === 0 ? (
        <p className="m-0 text-body text-muted">This block has no weeks yet. Add one from the week view.</p>
      ) : empty ? (
        <p className="m-0 text-body text-muted">
          No lines in {block.name} yet. Write the first week in the week view and its lines become the rows here.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label={`${block.name} progression`} className="w-full border-collapse text-ui">
            <thead>
              <tr className="text-left align-bottom">
                <th scope="col" className="w-48 px-2 pb-2 font-mono text-label font-normal uppercase text-muted-2">
                  Exercise
                </th>
                {grid.weeks.map((week) => {
                  const at = weekIndexOf(tree, week.id);
                  return (
                    <th key={week.id} scope="col" className="min-w-40 px-1 pb-2 font-normal">
                      <button
                        type="button"
                        onClick={() => onOpenWeek(week.id)}
                        aria-label={`Open ${weekName(week.id)} in the week view`}
                        className="flex w-full flex-col rounded-chip px-1 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent-line"
                      >
                        <span className="text-ui font-semibold text-foreground">{weekName(week.id)}</span>
                        <span className="text-caption text-muted-2">
                          {anchor ? rangeLabel(weekRange(anchor, at)) : "No dates yet"}
                        </span>
                        <span className="mt-0.5">
                          <StateMark state={weekState(tree, week, logged)} />
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            {grid.days.map((day) => (
              <tbody key={day.dayIndex} aria-label={day.title}>
                <tr>
                  <th
                    scope="rowgroup"
                    colSpan={grid.weeks.length + 1}
                    className="border-t-2 border-border px-2 pt-3 pb-1 text-left text-ui font-semibold text-foreground"
                  >
                    {day.title}
                  </th>
                </tr>
                {day.rows.map((slot) => {
                  const row = rowOf.get(slot.id) ?? 0;
                  const name = names.get(slot.exerciseId) ?? "Exercise";
                  const slotName = slot.occurrence > 0 ? `${name} (${ORDINAL[slot.occurrence] ?? `#${slot.occurrence + 1}`})` : name;
                  return (
                    <tr key={slot.id} aria-label={`${day.title}: ${slotName}`} className="align-top">
                      <th scope="row" className="px-2 py-1 text-left font-semibold text-foreground">
                        <span className="block truncate">{slotName}</span>
                      </th>
                      {slot.cells.map((cell, col) => {
                        const key = `${slot.id}|${cell.weekId}`;
                        // The day leads: the same lift on two days is two rows.
                        const label = `${day.title} · ${slotName}, ${weekName(cell.weekId)}`;
                        if (cell.kind === "none") {
                          return (
                            <td key={cell.weekId} className="px-1 py-1 text-muted-2" aria-label={`${label}: not in this week`}>
                              <span className="block h-9 px-2 leading-9">–</span>
                            </td>
                          );
                        }
                        const value = cell.kind === "line" ? progressionText(cell.line) : "";
                        return (
                          <td key={cell.weekId} className="px-1 py-1">
                            <CellInput
                              data-pcell={`${row}-${col}`}
                              aria-label={label}
                              aria-invalid={errors[key] ? true : undefined}
                              disabled={!editable || (cell.kind === "empty" && busy)}
                              value={value}
                              placeholder={cell.kind === "empty" ? "+ 3x5 75%" : undefined}
                              onKeyDown={(e) => onKey(e, row, col)}
                              onBlur={(e) => void commit(cell, slot.exerciseId, key, e.target.value)}
                              className={cn(
                                "h-9 w-full rounded-control border bg-surface-2 px-2 text-foreground tabular-nums placeholder:text-muted-2 focus:outline-none",
                                errors[key] ? "border-danger-line" : "border-border focus:border-accent-line",
                                cell.kind === "empty" && "border-dashed bg-transparent",
                              )}
                            />
                            {cell.kind === "line" ? (
                              <LoadPreviewLine
                                compact
                                preview={previewFor(cell.line, cell.day)}
                                athleteId={tree.athleteId}
                                editable={editable}
                              />
                            ) : null}
                            {errors[key] ? (
                              <span role="alert" className="block px-1 pt-0.5 text-caption text-danger-line">
                                {errors[key]}
                              </span>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </div>
  );
}
