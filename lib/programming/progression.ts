import { byPosition, type BlockTree, type DayTree, type Prescription, type WeekTree } from "./program";

/**
 * The progression view: one block as a grid, a row per exercise slot and a
 * column per week, so the coach reads the same lift across the whole block --
 * "Squat backoff: 75%, 77.5%, 80%, 65%" -- instead of paging week by week.
 * TeamBuildr has it; Trainerize has had it requested since 2018 (the research
 * brief, Oct 2026).
 *
 * Pure. The component (components/coach/program-progression.tsx) renders it
 * and sends the same ops the week view does.
 */

/**
 * Which line in each week is "the same" line.
 *
 * `(day position in the week, exercise, how many lines of that exercise came
 * before it in the day)`: "Day 1, Squat, 2nd squat line" is the squat backoff
 * in every week. [Inference] Position alone breaks the first time a coach
 * inserts a line in week 3 (everything below it shifts a row); the exercise
 * alone merges a top set and its backoffs into one row. Weeks are mostly
 * duplicated from the week before (docs/programs.md, "+ Week"), so the
 * occurrence count lines up in the common case and degrades to an extra row,
 * never a wrong cell, in the rest.
 */
export interface SlotKey {
  dayIndex: number;
  exerciseId: string;
  occurrence: number;
}

export const slotId = (slot: SlotKey): string => `${slot.dayIndex}:${slot.exerciseId}:${slot.occurrence}`;

/** One week's cell for a slot. */
export type ProgressionCell =
  /** The week has the line. */
  | { kind: "line"; weekId: string; day: DayTree; line: Prescription }
  /**
   * The week has the day but not the line, and a line added to the end of
   * that day would land in this very slot -- the day holds exactly
   * `occurrence` lines of the exercise already. Typing here adds it.
   */
  | { kind: "empty"; weekId: string; day: DayTree }
  /** No such day that week, or adding would land in another slot: a dash. */
  | { kind: "none"; weekId: string };

export interface ProgressionRow extends SlotKey {
  id: string;
  cells: ProgressionCell[];
}

export interface ProgressionDay {
  dayIndex: number;
  /** The first label any week gives the day at this position, else "Day N". */
  title: string;
  rows: ProgressionRow[];
}

export interface ProgressionGrid {
  weeks: WeekTree[];
  days: ProgressionDay[];
}

/** Each line of a day with its slot. */
function slotsOf(day: DayTree, dayIndex: number): Array<{ key: SlotKey; line: Prescription }> {
  const seen = new Map<string, number>();
  return byPosition(day.prescriptions).map((line) => {
    const occurrence = seen.get(line.exerciseId) ?? 0;
    seen.set(line.exerciseId, occurrence + 1);
    return { key: { dayIndex, exerciseId: line.exerciseId, occurrence }, line };
  });
}

/**
 * The block as rows of slots across its weeks.
 *
 * Rows come in the order slots are first met, week by week, day by day, line
 * by line, so week 1's order leads and a slot that only appears in week 3
 * sits under the rows week 1 already had. Days are grouped by their position
 * in the week, the same rule the slot key uses.
 */
export function progressionGrid(block: Pick<BlockTree, "weeks">): ProgressionGrid {
  const weeks = block.weeks;
  const order: SlotKey[] = [];
  const known = new Set<string>();
  const titles = new Map<number, string>();
  const found = new Map<string, Prescription>(); // `${weekId}|${slotId}` -> line

  for (const week of weeks) {
    byPosition(week.days).forEach((day, dayIndex) => {
      if (day.label && !titles.has(dayIndex)) titles.set(dayIndex, day.label);
      for (const { key, line } of slotsOf(day, dayIndex)) {
        const id = slotId(key);
        found.set(`${week.id}|${id}`, line);
        if (!known.has(id)) {
          known.add(id);
          order.push(key);
        }
      }
    });
  }

  const daysOfWeek = new Map(weeks.map((w) => [w.id, byPosition(w.days)]));
  const groups = new Map<number, ProgressionDay>();
  for (const key of order) {
    const id = slotId(key);
    const cells = weeks.map((week): ProgressionCell => {
      const line = found.get(`${week.id}|${id}`);
      const day = daysOfWeek.get(week.id)?.[key.dayIndex];
      if (line && day) return { kind: "line", weekId: week.id, day, line };
      if (!day) return { kind: "none", weekId: week.id };
      const already = day.prescriptions.filter((l) => l.exerciseId === key.exerciseId).length;
      return already === key.occurrence ? { kind: "empty", weekId: week.id, day } : { kind: "none", weekId: week.id };
    });
    let group = groups.get(key.dayIndex);
    if (!group) {
      group = { dayIndex: key.dayIndex, title: titles.get(key.dayIndex) ?? `Day ${key.dayIndex + 1}`, rows: [] };
      groups.set(key.dayIndex, group);
    }
    group.rows.push({ ...key, id, cells });
  }

  return { weeks, days: [...groups.values()].sort((a, b) => a.dayIndex - b.dayIndex) };
}
