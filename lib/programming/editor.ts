import { parsePrescription, type PrescriptionKind } from "./prescription";
import { addDays, type Prescription, type ProgramOpInput, type ProgramTree } from "./program";
import type { MaxKind } from "@/lib/strength/reference-max";

/**
 * The Program Editor's rules, as pure functions. Order 19.
 *
 * The grid is the screen that has to beat Excel, so the behaviour that decides
 * whether it does -- what a typed cell turns into, where an arrow key goes,
 * which date a new day lands on -- lives here, where it is tested, rather than
 * in event handlers where it is only ever discovered mid-block.
 *
 * Pure. No client, no network, no clock of its own.
 */

/** The grid's editable columns, left to right. Video-required (Order 30) slots in after notes. */
export const COLUMNS = ["exercise", "sets", "reps", "load", "rest", "notes"] as const;
export type Column = (typeof COLUMNS)[number];

/* -------------------------------------------------------------------------
 * The load cell's indicator
 * ---------------------------------------------------------------------- */

const BASIS_WORDS: Record<MaxKind, string> = {
  training: "training max",
  tested: "tested max",
  estimated: "e1RM",
};

const trim = (value: number) => (Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2))));

/**
 * What the coach's typing landed as, in words, shown beside the load cell.
 *
 * This is the indicator Order 18 owes the coach: parsing never fails, so a
 * mistyped `75%%` or a bare `8` meant as RPE becomes something else silently
 * unless the screen says so. The kind leads, because the kind is the mistake.
 */
export function describeLoad(text: string | null): { kind: PrescriptionKind | null; label: string } {
  const spec = text ? parsePrescription(text) : null;
  if (!spec) return { kind: null, label: "No load" };
  switch (spec.kind) {
    case "fixed":
      return { kind: "fixed", label: `Fixed · ${trim(spec.loadKg)} kg` };
    case "percent":
      return { kind: "percent", label: `Percent · ${trim(spec.percent)}% of ${BASIS_WORDS[spec.basis]}` };
    case "rpe":
      return { kind: "rpe", label: `RPE ${trim(spec.rpe)} · athlete picks the weight` };
    case "capped":
      return {
        kind: "capped",
        label: `Capped · ${trim(spec.percent)}% of ${BASIS_WORDS[spec.basis]}, stop at RPE ${trim(spec.rpe)}`,
      };
    case "freeform":
      return { kind: "freeform", label: "Freeform · shown as written" };
  }
}

/* -------------------------------------------------------------------------
 * Cells: text in, fields out
 * ---------------------------------------------------------------------- */

type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

export function parseSetsCell(text: string): Parsed<number> {
  const value = Number(text.trim());
  if (!Number.isInteger(value) || value < 1 || value > 50) return { ok: false, reason: "Sets is a whole number, 1 to 50" };
  return { ok: true, value };
}

/** `5`, `8-10` or `8–10`, or empty for a line whose load cell says it all. */
export function parseRepsCell(text: string): Parsed<{ reps: number | null; repMax: number | null }> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: { reps: null, repMax: null } };
  const match = /^(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?$/.exec(trimmed);
  const reps = match ? Number(match[1]) : NaN;
  const top = match?.[2] ? Number(match[2]) : null;
  if (!match || reps < 1 || reps > 100 || (top !== null && (top > 100 || top < reps))) {
    return { ok: false, reason: "Reps is a number like 5, or a range like 8-10" };
  }
  return { ok: true, value: { reps, repMax: top === reps ? null : top } };
}

export function formatRepsCell(reps: number | null, repMax: number | null): string {
  if (reps === null) return "";
  return repMax !== null && repMax !== reps ? `${reps}-${repMax}` : String(reps);
}

/** `90` (seconds), `90s`, `3m`, `2:30`, or empty for no rest prescribed. */
export function parseRestCell(text: string): Parsed<number | null> {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return { ok: true, value: null };
  let seconds: number | null = null;
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(trimmed);
  const minutes = /^(\d{1,2}(?:\.\d+)?)\s*m(?:in)?$/.exec(trimmed);
  const plain = /^(\d{1,4})\s*s?$/.exec(trimmed);
  if (clock) seconds = Number(clock[1]) * 60 + Number(clock[2]);
  else if (minutes) seconds = Math.round(Number(minutes[1]) * 60);
  else if (plain) seconds = Number(plain[1]);
  if (seconds === null || seconds > 3600) return { ok: false, reason: "Rest is like 90, 3m or 2:30 -- up to an hour" };
  return { ok: true, value: seconds };
}

export function formatRestCell(seconds: number | null): string {
  if (seconds === null) return "";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** A cell's text as the grid shows it. The exercise column is named by the caller. */
export function cellText(line: Prescription, column: Exclude<Column, "exercise">): string {
  switch (column) {
    case "sets":
      return String(line.setCount);
    case "reps":
      return formatRepsCell(line.reps, line.repMax);
    case "load":
      return line.load ?? "";
    case "rest":
      return formatRestCell(line.restSeconds);
    case "notes":
      return line.notes ?? "";
  }
}

/**
 * The write a committed cell becomes: an op, nothing (unchanged), or the
 * reason it cannot be saved -- shown on the cell, never a toast.
 *
 * Only the edited field is sent. Two coaches cannot edit the same program, but
 * one coach in two tabs can, and a whole-row write would put back whatever the
 * other tab changed.
 */
export function commitCell(
  line: Prescription,
  column: Exclude<Column, "exercise">,
  text: string,
): { op: ProgramOpInput } | { unchanged: true } | { error: string } {
  if (text.trim() === cellText(line, column).trim()) return { unchanged: true };
  const base = { op: "updatePrescription" as const, prescriptionId: line.id };
  switch (column) {
    case "sets": {
      const parsed = parseSetsCell(text);
      return parsed.ok ? { op: { ...base, setCount: parsed.value } } : { error: parsed.reason };
    }
    case "reps": {
      const parsed = parseRepsCell(text);
      return parsed.ok ? { op: { ...base, ...parsed.value } } : { error: parsed.reason };
    }
    case "load":
      // Anything goes: freeform is the escape hatch, and the indicator says
      // what it landed as.
      return text.length > 120 ? { error: "Load is 120 characters at most" } : { op: { ...base, load: text } };
    case "rest": {
      const parsed = parseRestCell(text);
      return parsed.ok ? { op: { ...base, restSeconds: parsed.value } } : { error: parsed.reason };
    }
    case "notes":
      return text.length > 500 ? { error: "A note is 500 characters at most" } : { op: { ...base, notes: text } };
  }
}

/** A line's fields after an op, so the grid can show the save before the server answers. */
export function applyLineOp(line: Prescription, op: ProgramOpInput): Prescription {
  if (op.op !== "updatePrescription" || op.prescriptionId !== line.id) return line;
  const load = op.load === undefined ? line.load : op.load?.trim() || null;
  return {
    ...line,
    exerciseId: op.exerciseId ?? line.exerciseId,
    setCount: op.setCount ?? line.setCount,
    reps: op.reps === undefined ? line.reps : op.reps,
    repMax: op.repMax === undefined ? line.repMax : op.repMax,
    load,
    loadKind: op.load === undefined ? line.loadKind : load ? (parsePrescription(load)?.kind ?? null) : null,
    restSeconds: op.restSeconds === undefined ? line.restSeconds : op.restSeconds,
    notes: op.notes === undefined ? line.notes : op.notes?.trim() || null,
  };
}

/* -------------------------------------------------------------------------
 * Keyboard movement
 * ---------------------------------------------------------------------- */

export interface CellAt {
  row: number;
  col: number;
}

/**
 * Where a key sends the focus, or null to leave the key to the input.
 *
 * Up and down always move rows -- nothing in a single-line cell uses them.
 * Left and right only leave a cell from its edge, so a coach can still move
 * the caret inside `75% @8` to fix a digit. Enter commits and moves down, as
 * in a spreadsheet. Tab is left to the browser, which already walks the cells
 * in order.
 */
export function moveCell(
  at: CellAt,
  key: string,
  size: { rows: number; cols: number },
  caret: { atStart: boolean; atEnd: boolean } = { atStart: true, atEnd: true },
): CellAt | null {
  const clampRow = (row: number) => Math.max(0, Math.min(size.rows - 1, row));
  switch (key) {
    case "ArrowUp":
      return at.row > 0 ? { row: at.row - 1, col: at.col } : null;
    case "ArrowDown":
    case "Enter":
      return at.row < size.rows - 1 ? { row: clampRow(at.row + 1), col: at.col } : null;
    case "ArrowLeft":
      return caret.atStart && at.col > 0 ? { row: at.row, col: at.col - 1 } : null;
    case "ArrowRight":
      return caret.atEnd && at.col < size.cols - 1 ? { row: at.row, col: at.col + 1 } : null;
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------
 * Calendar
 * ---------------------------------------------------------------------- */

/**
 * The date a new day in a week should default to. The coach can change it;
 * this only saves typing the obvious one.
 *
 * The day after the week's last dated day. For an empty week, the program's
 * start date plus seven days per week before it -- counted across blocks, so
 * week 1 of block 2 follows the last week of block 1. Null for a template or a
 * program with no start date and nothing dated to count from.
 *
 * A suggestion and never a rule: days carry their own dates precisely so that
 * a block written up front, a week written on Sunday and a session written the
 * night before are the same row.
 */
export function suggestDayDate(tree: ProgramTree, weekId: string): string | null {
  if (tree.athleteId === null) return null;
  const weeks = tree.blocks.flatMap((block) => block.weeks);
  const at = weeks.findIndex((week) => week.id === weekId);
  if (at < 0) return null;

  const dated = weeks[at].days.map((day) => day.scheduledOn).filter((d): d is string => d !== null);
  if (dated.length > 0) return addDays([...dated].sort().at(-1)!, 1);

  if (tree.startOn) return addDays(tree.startOn, 7 * at);
  // No start date: a week after the first dated day of the nearest week above.
  for (let back = at - 1; back >= 0; back--) {
    const first = weeks[back].days.map((day) => day.scheduledOn).filter((d): d is string => d !== null).sort()[0];
    if (first) return addDays(first, 7 * (at - back));
  }
  return null;
}

/** "Mon 6 Oct", read as the athlete's calendar day rather than an instant. */
export function dayDateLabel(day: string | null): string {
  if (!day) return "No date";
  const date = new Date(`${day}T12:00:00Z`);
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** How many weeks are still drafts -- what the Publish button counts. */
export function draftWeeks(tree: ProgramTree): number {
  return tree.blocks.reduce((n, block) => n + block.weeks.filter((week) => week.status === "draft").length, 0);
}
