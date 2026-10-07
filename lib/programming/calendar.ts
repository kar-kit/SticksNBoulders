import { daysBetween } from "./copy";
import { addDays, type DayTree, type ProgramTree } from "./program";

/**
 * Where a program's days fall on the calendar, derived from its start date.
 *
 * The editor no longer asks for a date per day. A week is a Monday-to-Sunday
 * row, week N of the program is the Nth row from the start date's Monday, and
 * a day is a weekday in its week. `scheduled_on` is still what is stored --
 * Today and the logger read nothing else -- but it is computed here from
 * (start, week, weekday) instead of typed.
 *
 * Monday-aligned on purpose. [Inference] A program starting on a Wednesday
 * still has a week 1 that runs Monday to Sunday, so a Monday in week 1 is
 * dated before the start. The alternative, weeks that run Wednesday to
 * Tuesday, puts the coach's "Monday squat" in a different column every
 * program, and would not line up with a month view of the calendar later.
 *
 * A date already stored is never rewritten here. A day whose date is not in
 * its week (typed under the old per-day picker, or moved by hand) is reported
 * as `off`, shown as such, and only moved when the coach picks a weekday.
 *
 * Pure. No clock: weeks count from the start date, never from today.
 */

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** 0 for Monday through 6 for Sunday, read as a calendar day, not an instant. */
export function weekdayOf(day: string): number {
  return (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
}

/** The Monday of the week a calendar day is in. */
export function mondayOf(day: string): string {
  return addDays(day, -weekdayOf(day));
}

/** A week's position in the whole program, counted across blocks. -1 when it is not in it. */
export function weekIndexOf(tree: ProgramTree, weekId: string): number {
  return tree.blocks.flatMap((b) => b.weeks).findIndex((w) => w.id === weekId);
}

/**
 * The Monday of week 1: what every derived date counts from.
 *
 * The start date's Monday when there is one. A program written before the
 * start date mattered may have dated days and no start date; then the first
 * dated day, counted back to week 1, is the anchor, so those days read as
 * being where they are rather than as all off-week. Null for a template (it
 * has no calendar) and for a program with nothing to count from.
 */
export function programAnchor(tree: ProgramTree): string | null {
  if (tree.athleteId === null) return null;
  if (tree.startOn) return mondayOf(tree.startOn);
  const weeks = tree.blocks.flatMap((b) => b.weeks);
  for (let at = 0; at < weeks.length; at++) {
    const first = weeks[at].days.map((d) => d.scheduledOn).filter((d): d is string => d !== null).sort()[0];
    if (first) return addDays(mondayOf(first), -7 * at);
  }
  return null;
}

/** Monday and Sunday of week `index` (0-based). */
export function weekRange(anchor: string, index: number): { from: string; to: string } {
  const from = addDays(anchor, 7 * index);
  return { from, to: addDays(from, 6) };
}

/** The date a weekday chip stores: anchor + whole weeks + the weekday. */
export function scheduledOnFor(anchor: string, weekIndex: number, weekday: number): string {
  return addDays(anchor, 7 * weekIndex + weekday);
}

export type Placement =
  | { kind: "undated" }
  /** In its week: the chip for `weekday` is the selected one. */
  | { kind: "on"; weekday: number }
  /** Dated, but not inside its week. Shown, never moved without the coach. */
  | { kind: "off"; weekday: number };

/** Where a day's stored date sits relative to its week. */
export function placeDay(anchor: string | null, weekIndex: number, scheduledOn: string | null): Placement {
  if (!scheduledOn) return { kind: "undated" };
  const weekday = weekdayOf(scheduledOn);
  if (!anchor) return { kind: "on", weekday };
  const { from, to } = weekRange(anchor, weekIndex);
  return scheduledOn >= from && scheduledOn <= to ? { kind: "on", weekday } : { kind: "off", weekday };
}

/**
 * The date "+ Day" gives a new day. An empty week starts on the program's
 * start weekday (Monday when there is none); after that, the first free
 * weekday after the last one used, then the first free one at all. Null for a
 * template, a program with nothing to count from, or a full week.
 */
export function newDayDate(tree: ProgramTree, weekId: string): string | null {
  const anchor = programAnchor(tree);
  const at = weekIndexOf(tree, weekId);
  if (!anchor || at < 0) return null;
  const week = tree.blocks.flatMap((b) => b.weeks)[at];
  const taken = new Set(
    week.days
      .map((d) => placeDay(anchor, at, d.scheduledOn))
      .flatMap((p) => (p.kind === "on" ? [p.weekday] : [])),
  );
  if (taken.size === 0) return scheduledOnFor(anchor, at, tree.startOn ? weekdayOf(tree.startOn) : 0);
  const last = Math.max(...taken);
  const free = [0, 1, 2, 3, 4, 5, 6].filter((d) => !taken.has(d));
  const next = free.find((d) => d > last) ?? free[0];
  return next === undefined ? null : scheduledOnFor(anchor, at, next);
}

/** First Monday to last Sunday of a block's weeks. Null with no anchor or no weeks. */
export function blockRange(tree: ProgramTree, blockId: string): { from: string; to: string } | null {
  const anchor = programAnchor(tree);
  const block = tree.blocks.find((b) => b.id === blockId);
  if (!anchor || !block || block.weeks.length === 0) return null;
  const first = weekIndexOf(tree, block.weeks[0].id);
  return { from: weekRange(anchor, first).from, to: weekRange(anchor, first + block.weeks.length - 1).to };
}

const dayMonth = (day: string, withMonth: boolean) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    ...(withMonth ? { month: "short" } : {}),
    timeZone: "UTC",
  });

/** "5–11 Oct", or "28 Sep – 4 Oct" across a month. */
export function rangeLabel(range: { from: string; to: string }): string {
  const sameMonth = range.from.slice(0, 7) === range.to.slice(0, 7);
  return sameMonth
    ? `${dayMonth(range.from, false)}–${dayMonth(range.to, true)}`
    : `${dayMonth(range.from, true)} – ${dayMonth(range.to, true)}`;
}

/**
 * What changing the start date does to the days: every day that sits in its
 * week moves by the same whole weeks, keeping its weekday -- unless an athlete
 * has logged a session from it. Logged days and off-week days stay exactly
 * where they are; they show as off-week afterwards and the coach decides.
 *
 * `logged` must be known. The caller passes nothing in when it could not read
 * the sessions, rather than an empty set, so unknown is never taken for none.
 */
export function redatePlan(
  tree: ProgramTree,
  startOn: string | null,
  logged: ReadonlySet<string>,
): { dayId: string; scheduledOn: string }[] {
  const from = programAnchor(tree);
  const to = startOn && tree.athleteId !== null ? mondayOf(startOn) : null;
  if (!from || !to || from === to) return [];
  const shift = daysBetween(from, to);
  return tree.blocks
    .flatMap((b) => b.weeks)
    .flatMap((week, at) =>
      week.days.flatMap((day: DayTree) => {
        if (logged.has(day.id) || !day.scheduledOn) return [];
        if (placeDay(from, at, day.scheduledOn).kind !== "on") return [];
        return [{ dayId: day.id, scheduledOn: addDays(day.scheduledOn, shift) }];
      }),
    );
}
