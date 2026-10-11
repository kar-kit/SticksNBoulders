import { addDays, type ProgramOpInput, type WeekTree } from "./program";

/**
 * The calendar arithmetic behind duplicating a week and copying a program.
 * Order 20.
 *
 * Pure. The server (program-admin.ts) decides who may copy what and writes the
 * rows; this only decides which dates the copies land on, so that rule is
 * tested on its own rather than through a fake database.
 */

/** Whole days from one calendar day to another. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** A day moved by `shift` days. Undated stays undated -- a template has no calendar. */
export function shiftDay(day: string | null, shift: number): string | null {
  return day === null ? null : addDays(day, shift);
}

/**
 * How far a duplicated week's days move.
 *
 * The copy is appended after the block's last week, so it lands one week after
 * the last week, not one week after its source: duplicating week 4 of 4 moves
 * every day by 7, and duplicating week 1 of 4 (the copy becomes week 5) by 28.
 * [Inference] -- the brief says "shifted by 7 days", which is the same thing
 * in the case it describes, and the only reading that does not stack the new
 * week on top of week 2.
 *
 * `weekIds` is the block's weeks in order; `sourceId` must be one of them.
 */
export function duplicateShift(weekIds: readonly string[], sourceId: string): number {
  const at = weekIds.indexOf(sourceId);
  if (at < 0) throw new Error("duplicateShift: the source week is not in the block");
  return 7 * (weekIds.length - at);
}

/**
 * Where a copied program starts, and how far every day moves to get there.
 *
 * The anchor is the source's start date when the whole program is copied, so
 * a block that starts on a Tuesday after a Monday start keeps that offset. A
 * single block has no start date of its own, so its earliest dated day is the
 * anchor. Asked for no date, the copy keeps the source's dates exactly --
 * the usual case when two athletes run the same block side by side.
 */
export function copyCalendar(input: {
  wholeProgram: boolean;
  sourceStartOn: string | null;
  /** The scheduled dates of every day being copied. */
  days: readonly (string | null)[];
  /** The requested start; undefined keeps the source's dates. */
  startOn: string | null | undefined;
}): { startOn: string | null; shift: number } {
  const dated = input.days.filter((d): d is string => d !== null).sort();
  const anchor = (input.wholeProgram ? input.sourceStartOn : null) ?? dated[0] ?? input.sourceStartOn;
  if (input.startOn === undefined) return { startOn: anchor, shift: 0 };
  if (input.startOn === null || anchor === null) return { startOn: input.startOn, shift: 0 };
  return { startOn: input.startOn, shift: daysBetween(anchor, input.startOn) };
}

/**
 * The writes that copy one week into another block, as existing ops: one
 * `addDay` per day, then one `addPrescription` per line under it. "+ Block"
 * starts the new block with a copy of the last week before it -- the same
 * "write a week, repeat it, adjust" that `duplicateWeek` serves inside a block
 * -- and `duplicateWeek` only appends to its own block. Built from the ops the
 * editor already sends, so it is held to the same validation and permission
 * checks as typing it in by hand; no new server path. [Inference]
 *
 * Every field the coach typed is carried; the label of the week is not (as
 * `duplicateWeek`). Days move by `shift` days, undated stays undated.
 */
export function copyWeekPlan(
  source: WeekTree,
  shift: number,
): { day: Omit<AddDay, "op" | "weekId">; lines: Omit<AddLine, "op" | "dayId">[] }[] {
  return source.days.map((day) => ({
    day: { label: day.label, scheduledOn: shiftDay(day.scheduledOn, shift), notes: day.notes },
    lines: day.prescriptions.map((line) => ({
      exerciseId: line.exerciseId,
      setCount: line.setCount,
      reps: line.reps,
      repMax: line.repMax,
      load: line.load,
      restSeconds: line.restSeconds,
      notes: line.notes,
      backoff: line.backoff ?? null,
      videoRequired: line.videoRequired ?? false,
      referenceExerciseId: line.referenceExerciseId ?? null,
    })),
  }));
}

type AddDay = Extract<ProgramOpInput, { op: "addDay" }>;
type AddLine = Extract<ProgramOpInput, { op: "addPrescription" }>;
