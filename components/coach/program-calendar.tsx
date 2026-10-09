"use client";

import { useState, type FocusEvent, type KeyboardEvent } from "react";
import { StateMark, STATE_LABEL } from "@/components/coach/program-outline";
import { cn } from "@/lib/cn";
import { blockRange, placeDay, rangeLabel, scheduledOnFor, weekRange, WEEKDAYS } from "@/lib/programming/calendar";
import { dayDateLabel, weekState } from "@/lib/programming/editor";
import type { DayTree, Prescription, ProgramTree } from "@/lib/programming/program";

/**
 * The program on a calendar: the RTS / TrueCoach / TrainHeroic view, one row
 * per program week, Monday first, a column per weekday, each block a band of
 * rows. The week view edits; this one reads the cycle at a glance and
 * navigates -- a day opens in the week view, an empty cell takes "+ Day".
 *
 * Every date comes from the same helpers the week view uses
 * (lib/programming/calendar.ts): week N is the Nth Monday-to-Sunday row from
 * the anchor, and "+ Day" stores anchor + whole weeks + weekday, exactly what
 * a weekday chip would. Nothing here moves a day, so nothing logged can move.
 *
 * A day dated outside its week (or not dated) is not dropped: it is listed
 * under its week's label, where the coach can open it and pick a weekday.
 *
 * Keyboard: one tab stop for the grid; arrows walk the cells, Home and End go
 * to the ends of a row, Enter opens a day or adds one.
 */

/** Exercise names shown in a cell before "+N more". */
const SHOWN = 3;

export interface ProgramCalendarProps {
  tree: ProgramTree;
  /** Week 1's Monday. The editor shows the start-date prompt instead when there is none. */
  anchor: string;
  /** Null when the sessions could not be read: nothing is marked logged by guess. */
  logged: ReadonlySet<string> | null;
  names: ReadonlyMap<string, string>;
  weekName: (weekId: string) => string;
  editable: boolean;
  busy: boolean;
  onOpenDay: (weekId: string, dayId: string) => void;
  onAddDay: (weekId: string, scheduledOn: string) => void;
}

/**
 * What a cell says about a day's lines: distinct exercises in order, the
 * first three, and how many more. A top set and its backoffs are one lift.
 */
export function daySummary(
  lines: readonly Pick<Prescription, "exerciseId">[],
  names: ReadonlyMap<string, string>,
): { shown: string[]; more: number } {
  const ids = [...new Set(lines.map((l) => l.exerciseId))];
  return {
    shown: ids.slice(0, SHOWN).map((id) => names.get(id) ?? "Exercise"),
    more: Math.max(0, ids.length - SHOWN),
  };
}

const shortDate = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

const dayTitle = (day: DayTree, index: number) => day.label ?? `Day ${index + 1}`;

export function ProgramCalendar({
  tree,
  anchor,
  logged,
  names,
  weekName,
  editable,
  busy,
  onOpenDay,
  onAddDay,
}: ProgramCalendarProps) {
  // The one cell in the tab order (roving tabindex).
  const [active, setActive] = useState({ row: 0, col: 0 });
  const allWeeks = tree.blocks.flatMap((b) => b.weeks);
  const rows = allWeeks.length;
  const rowOf = new Map(allWeeks.map((w, at) => [w.id, at]));

  const cellOf = (el: Element | null) => {
    const at = el?.closest<HTMLElement>("[data-cal-cell]")?.dataset.calCell;
    if (!at) return null;
    const [row, col] = at.split("-").map(Number);
    return { row, col };
  };

  const onFocus = (event: FocusEvent<HTMLElement>) => {
    const at = cellOf(event.target);
    if (at && (at.row !== active.row || at.col !== active.col)) setActive(at);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const at = cellOf(event.target as Element);
    if (!at) return;
    const to = { ...at };
    if (event.key === "ArrowRight") to.col = Math.min(6, at.col + 1);
    else if (event.key === "ArrowLeft") to.col = Math.max(0, at.col - 1);
    else if (event.key === "ArrowDown") to.row = Math.min(rows - 1, at.row + 1);
    else if (event.key === "ArrowUp") to.row = Math.max(0, at.row - 1);
    else if (event.key === "Home") to.col = 0;
    else if (event.key === "End") to.col = 6;
    else return;
    event.preventDefault();
    event.currentTarget.querySelector<HTMLElement>(`[data-cal-cell="${to.row}-${to.col}"]`)?.focus();
    setActive(to);
  };

  // A removed week can leave the stop past the last row; it falls back onto it.
  const stopRow = Math.min(active.row, Math.max(0, rows - 1));
  const stop = (row: number, col: number) => (stopRow === row && active.col === col ? 0 : -1);

  return (
    <table
      role="grid"
      aria-label="Program calendar"
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      className="w-full table-fixed border-collapse text-ui"
    >
      <colgroup>
        <col className="w-36" />
        {WEEKDAYS.map((name) => (
          <col key={name} />
        ))}
      </colgroup>
      <thead>
        <tr className="text-left font-mono text-label uppercase text-muted-2">
          <th scope="col" className="px-2 pb-2 font-normal">
            Week
          </th>
          {WEEKDAYS.map((name) => (
            <th key={name} scope="col" className="px-2 pb-2 font-normal">
              {name}
            </th>
          ))}
        </tr>
      </thead>
      {tree.blocks.map((block) => {
        const range = blockRange(tree, block.id);
        return (
          <tbody key={block.id} aria-label={block.name}>
            <tr>
              <th
                scope="rowgroup"
                aria-label={`${block.name}, ${range ? rangeLabel(range) : "no weeks yet"}`}
                colSpan={8}
                className="border-t-2 border-border px-2 pt-4 pb-2 text-left font-normal"
              >
                <span className="text-ui font-semibold text-foreground">{block.name}</span>
                <span className="ml-3 font-mono text-label uppercase text-muted-2">
                  {range ? rangeLabel(range) : "No weeks yet"}
                </span>
              </th>
            </tr>
            {block.weeks.map((week) => {
              const row = rowOf.get(week.id) ?? 0;
              const state = weekState(tree, week, logged);
              const name = weekName(week.id);
              const placed = week.days.map((day, index) => ({
                day,
                index,
                place: placeDay(anchor, row, day.scheduledOn),
              }));
              const unplaced = placed.filter((p) => p.place.kind !== "on");
              return (
                <tr key={week.id} className="align-top">
                  <th
                    scope="row"
                    aria-label={`${block.name} · ${name}, ${STATE_LABEL[state].toLowerCase()}`}
                    className="border border-border px-2 py-2 text-left font-normal"
                  >
                    <span className="block truncate text-ui font-semibold text-foreground">{name}</span>
                    <span className="block text-caption text-muted-2">{rangeLabel(weekRange(anchor, row))}</span>
                    <span className="mt-1 block">
                      <StateMark state={state} />
                    </span>
                    {unplaced.map(({ day, index, place }) => {
                      const title = dayTitle(day, index);
                      const where =
                        place.kind === "off" && day.scheduledOn
                          ? `${shortDate(day.scheduledOn)}, outside this week`
                          : "no date";
                      return (
                        <button
                          key={day.id}
                          type="button"
                          aria-label={`${title}, ${where}`}
                          onClick={() => onOpenDay(week.id, day.id)}
                          className="mt-1 block w-full truncate rounded-chip px-1 text-left text-caption text-danger-line hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent-line"
                        >
                          {title} · {where}
                        </button>
                      );
                    })}
                  </th>
                  {WEEKDAYS.map((_, col) => {
                    const date = scheduledOnFor(anchor, row, col);
                    const label = dayDateLabel(date);
                    const days = placed.filter((p) => p.place.kind === "on" && p.place.weekday === col);
                    const tabIndex = stop(row, col);
                    const empty = days.length === 0;
                    return (
                      <td
                        key={col}
                        role="gridcell"
                        data-date={date}
                        // An empty read-only cell is the focus stop itself.
                        {...(empty && !editable
                          ? {
                              "data-cal-cell": `${row}-${col}`,
                              tabIndex,
                              "aria-label": `${label}, no session`,
                            }
                          : {})}
                        className={cn(
                          "group h-28 border border-border p-1 align-top",
                          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-line",
                        )}
                      >
                        <span aria-hidden="true" className="block px-1.5 text-caption text-muted-2">
                          {shortDate(date)}
                        </span>
                        {days.map(({ day, index }) => {
                          const title = dayTitle(day, index);
                          const { shown, more } = daySummary(day.prescriptions, names);
                          const done = logged?.has(day.id) ?? false;
                          const spoken =
                            shown.length > 0
                              ? [...shown, ...(more > 0 ? [`+${more}`] : [])].join(", ")
                              : "no exercises";
                          return (
                            <button
                              key={day.id}
                              type="button"
                              data-cal-cell={`${row}-${col}`}
                              tabIndex={tabIndex}
                              aria-label={`${label}, ${title}: ${spoken}${done ? ", logged" : ""}`}
                              onClick={() => onOpenDay(week.id, day.id)}
                              className={cn(
                                "mt-0.5 flex w-full min-w-0 flex-col rounded-chip border-l-2 bg-surface-2 px-1.5 py-1 text-left",
                                "hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:outline-accent-line",
                                done ? "border-success" : state === "draft" ? "border-muted-2" : "border-accent-fill",
                              )}
                            >
                              <span className="flex w-full items-center gap-1">
                                <span className="min-w-0 flex-1 truncate text-ui font-semibold text-foreground">
                                  {title}
                                </span>
                                {done ? <span className="flex-none text-caption text-success">✓</span> : null}
                              </span>
                              {shown.map((exercise, at) => (
                                <span
                                  key={`${exercise}-${at}`}
                                  className="block w-full truncate text-caption text-muted"
                                >
                                  {exercise}
                                </span>
                              ))}
                              {more > 0 ? <span className="block text-caption text-muted-2">+{more} more</span> : null}
                            </button>
                          );
                        })}
                        {empty && editable ? (
                          <button
                            type="button"
                            data-cal-cell={`${row}-${col}`}
                            tabIndex={tabIndex}
                            aria-label={`+ Day on ${label}`}
                            aria-disabled={busy || undefined}
                            onClick={() => {
                              if (!busy) onAddDay(week.id, date);
                            }}
                            className={cn(
                              "mt-1 w-full rounded-chip px-1.5 py-1 text-left text-caption text-muted",
                              "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-surface-2 hover:text-foreground",
                              "focus-visible:outline-2 focus-visible:outline-accent-line aria-disabled:text-muted-2",
                            )}
                          >
                            + Day
                          </button>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        );
      })}
    </table>
  );
}
