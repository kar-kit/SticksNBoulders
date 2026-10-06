import { z } from "zod";
import type { PrescriptionKind } from "./prescription";

/**
 * The program model: what a coach writes, as data.
 *
 * Order 19. A program holds blocks, a block holds weeks, a week holds days, a
 * day holds prescription lines. Each level is its own Appwrite table (see
 * appwrite/schema), and this file is the typed, validated boundary around them:
 *
 *   - Zod schemas for every write the repository accepts, so the route and the
 *     seed script reject the same bad input the same way.
 *   - Row parsers that turn an Appwrite row into a typed value, skipping a row
 *     that does not parse rather than crashing a screen over it.
 *   - Pure helpers: ordering, tree assembly, and picking today's day.
 *
 * Pure. No client, no network, no clock of its own.
 *
 * ## Why this shape survives Ruairi's answer
 *
 * The editor is blocked on whether he writes a block up front, a week at a
 * time, or session by session (question 1), and whether he reuses templates
 * (question 7). The tables are shaped so every answer is a UI decision, not a
 * migration:
 *
 *   - Days carry their own calendar date. Up front, week by week and session by
 *     session all end in the same row; only when it gets written differs.
 *   - Weeks carry their own status, so publishing week 3 while week 4 is a
 *     draft is already expressible.
 *   - A program with no athlete is a template. Assigning one is a copy.
 */

/* -------------------------------------------------------------------------
 * Primitives
 * ---------------------------------------------------------------------- */

/** Appwrite ids: a-z A-Z 0-9 . - _ up to 36, no leading special character. */
export const rowId = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/, "must be an Appwrite row id");

/** A calendar day, YYYY-MM-DD, that actually exists. */
export const calendarDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "must be a real date");

export const PROGRAM_STATUSES = ["draft", "published", "archived"] as const;
export const WEEK_STATUSES = ["draft", "published"] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];
export type WeekStatus = (typeof WEEK_STATUSES)[number];

const LOAD_KINDS = ["fixed", "percent", "rpe", "capped", "freeform"] as const satisfies readonly PrescriptionKind[];

/** Trimmed, with empty meaning "not set". */
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => value.trim() || null)
    .nullable()
    .optional();

const name = (max: number) => z.string().trim().min(1, "is required").max(max);

/* -------------------------------------------------------------------------
 * Values, as the app sees them
 * ---------------------------------------------------------------------- */

export interface Program {
  id: string;
  coachId: string;
  /** Null for a template. */
  athleteId: string | null;
  name: string;
  status: ProgramStatus;
  startOn: string | null;
  notes: string | null;
  templateId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProgramBlock {
  id: string;
  programId: string;
  position: number;
  name: string;
  notes: string | null;
}

export interface ProgramWeek {
  id: string;
  programId: string;
  blockId: string;
  position: number;
  label: string | null;
  status: WeekStatus;
  notes: string | null;
}

export interface ProgramDay {
  id: string;
  programId: string;
  blockId: string;
  weekId: string;
  position: number;
  label: string | null;
  scheduledOn: string | null;
  notes: string | null;
}

export interface Prescription {
  id: string;
  programId: string;
  weekId: string;
  dayId: string;
  exerciseId: string;
  position: number;
  setCount: number;
  reps: number | null;
  repMax: number | null;
  /** The load cell exactly as typed. Null for a line with no load at all. */
  load: string | null;
  loadKind: PrescriptionKind | null;
  restSeconds: number | null;
  notes: string | null;
  /**
   * The coach asks for a clip of this line. A nudge in the logger, never a
   * gate. Absent means false; optional so a fixture need not spell it out.
   */
  videoRequired?: boolean;
  updatedAt: string;
}

/* -------------------------------------------------------------------------
 * Row parsing
 *
 * Appwrite hands back loosely typed rows. Each parser is a Zod schema over the
 * stored column names, so a row missing a required column is skipped rather
 * than turned into a value with `undefined` where a number should be -- the
 * same rule reference-max-store applies to a max with no number.
 * ---------------------------------------------------------------------- */

const nullableString = z.string().nullish().transform((v) => v ?? null);
const nullableInt = z.number().int().nullish().transform((v) => v ?? null);
const scopeColumns = {
  program_id: z.string(),
  athlete_id: nullableString,
};

const programRow = z
  .object({
    $id: z.string(),
    coach_id: z.string(),
    athlete_id: nullableString,
    name: z.string(),
    status: z.enum(PROGRAM_STATUSES),
    start_on: nullableString,
    notes: nullableString,
    template_id: nullableString,
    created_at: z.string(),
    updated_at: z.string(),
  })
  .transform(
    (r): Program => ({
      id: r.$id,
      coachId: r.coach_id,
      athleteId: r.athlete_id,
      name: r.name,
      status: r.status,
      startOn: r.start_on,
      notes: r.notes,
      templateId: r.template_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }),
  );

const blockRow = z
  .object({ $id: z.string(), ...scopeColumns, position: z.number().int(), name: z.string(), notes: nullableString })
  .transform(
    (r): ProgramBlock => ({ id: r.$id, programId: r.program_id, position: r.position, name: r.name, notes: r.notes }),
  );

const weekRow = z
  .object({
    $id: z.string(),
    ...scopeColumns,
    block_id: z.string(),
    position: z.number().int(),
    label: nullableString,
    status: z.enum(WEEK_STATUSES),
    notes: nullableString,
  })
  .transform(
    (r): ProgramWeek => ({
      id: r.$id,
      programId: r.program_id,
      blockId: r.block_id,
      position: r.position,
      label: r.label,
      status: r.status,
      notes: r.notes,
    }),
  );

const dayRow = z
  .object({
    $id: z.string(),
    ...scopeColumns,
    block_id: z.string(),
    week_id: z.string(),
    position: z.number().int(),
    label: nullableString,
    scheduled_on: nullableString,
    notes: nullableString,
  })
  .transform(
    (r): ProgramDay => ({
      id: r.$id,
      programId: r.program_id,
      blockId: r.block_id,
      weekId: r.week_id,
      position: r.position,
      label: r.label,
      scheduledOn: r.scheduled_on,
      notes: r.notes,
    }),
  );

const prescriptionRow = z
  .object({
    $id: z.string(),
    ...scopeColumns,
    week_id: z.string(),
    day_id: z.string(),
    exercise_id: z.string(),
    position: z.number().int(),
    set_count: z.number().int().min(1),
    reps: nullableInt,
    rep_max: nullableInt,
    load: nullableString,
    load_kind: z.enum(LOAD_KINDS).nullish().transform((v) => v ?? null),
    rest_seconds: nullableInt,
    notes: nullableString,
    video_required: z.boolean().nullish().transform((v) => v ?? false),
    updated_at: z.string(),
  })
  .transform(
    (r): Prescription => ({
      id: r.$id,
      programId: r.program_id,
      weekId: r.week_id,
      dayId: r.day_id,
      exerciseId: r.exercise_id,
      position: r.position,
      setCount: r.set_count,
      reps: r.reps,
      repMax: r.rep_max,
      load: r.load,
      loadKind: r.load_kind,
      restSeconds: r.rest_seconds,
      notes: r.notes,
      videoRequired: r.video_required,
      updatedAt: r.updated_at,
    }),
  );

const parser =
  <T>(schema: z.ZodType<T>) =>
  (row: unknown): T | null => {
    const parsed = schema.safeParse(row);
    return parsed.success ? parsed.data : null;
  };

export const parseProgram = parser(programRow);
export const parseBlock = parser(blockRow);
export const parseWeek = parser(weekRow);
export const parseDay = parser(dayRow);
export const parsePrescriptionRow = parser(prescriptionRow);

/** Parses every row, dropping the ones that do not parse. */
export function parseRows<T>(rows: readonly unknown[], parse: (row: unknown) => T | null): T[] {
  return rows.map(parse).filter((value): value is T => value !== null);
}

/* -------------------------------------------------------------------------
 * Write inputs
 *
 * Every write the repository accepts, as a discriminated union on `op`. The
 * route parses a request body with `programOp`; the seed script builds the
 * same values in code. One schema, so there is one definition of "valid".
 *
 * Ids of the program, coach and athlete are never inputs to a child write.
 * They are read from the parent row by the server, because a caller able to
 * name the athlete on a day is a caller able to put a day on anyone's Today.
 * ---------------------------------------------------------------------- */

const createProgram = z.object({
  op: z.literal("createProgram"),
  /** Null for a template. */
  athleteId: rowId.nullable(),
  name: name(120),
  status: z.enum(PROGRAM_STATUSES).optional(),
  startOn: calendarDay.nullable().optional(),
  notes: optionalText(2000),
  templateId: rowId.nullable().optional(),
});

const updateProgram = z.object({
  op: z.literal("updateProgram"),
  programId: rowId,
  name: name(120).optional(),
  status: z.enum(PROGRAM_STATUSES).optional(),
  startOn: calendarDay.nullable().optional(),
  notes: optionalText(2000),
});

const addBlock = z.object({
  op: z.literal("addBlock"),
  programId: rowId,
  name: name(80),
  notes: optionalText(2000),
});

const updateBlock = z.object({
  op: z.literal("updateBlock"),
  blockId: rowId,
  name: name(80).optional(),
  notes: optionalText(2000),
});

const addWeek = z.object({
  op: z.literal("addWeek"),
  blockId: rowId,
  label: optionalText(80),
  status: z.enum(WEEK_STATUSES).optional(),
  notes: optionalText(2000),
});

const updateWeek = z.object({
  op: z.literal("updateWeek"),
  weekId: rowId,
  label: optionalText(80),
  status: z.enum(WEEK_STATUSES).optional(),
  notes: optionalText(2000),
});

const addDay = z.object({
  op: z.literal("addDay"),
  weekId: rowId,
  label: optionalText(80),
  scheduledOn: calendarDay.nullable().optional(),
  notes: optionalText(2000),
});

const updateDay = z.object({
  op: z.literal("updateDay"),
  dayId: rowId,
  label: optionalText(80),
  scheduledOn: calendarDay.nullable().optional(),
  notes: optionalText(2000),
});

const lineFields = {
  setCount: z.number().int().min(1).max(50),
  reps: z.number().int().min(1).max(100).nullable().optional(),
  repMax: z.number().int().min(1).max(100).nullable().optional(),
  /** The load cell as typed. Anything goes -- freeform is the escape hatch. */
  load: optionalText(120),
  restSeconds: z.number().int().min(0).max(3600).nullable().optional(),
  notes: optionalText(500),
  videoRequired: z.boolean().optional(),
};

/** A range must run upwards. "8-6 reps" is a typo, not a prescription. */
const rangeRunsUp = (line: { reps?: number | null; repMax?: number | null }) =>
  line.repMax == null || (line.reps != null && line.repMax >= line.reps);
const RANGE_MESSAGE = { message: "a rep range needs a bottom, and its top cannot be below it", path: ["repMax"] };

const addPrescription = z
  .object({ op: z.literal("addPrescription"), dayId: rowId, exerciseId: rowId, ...lineFields })
  .refine(rangeRunsUp, RANGE_MESSAGE);

const updatePrescription = z.object({
  op: z.literal("updatePrescription"),
  prescriptionId: rowId,
  exerciseId: rowId.optional(),
  setCount: lineFields.setCount.optional(),
  reps: lineFields.reps,
  repMax: lineFields.repMax,
  load: lineFields.load,
  restSeconds: lineFields.restSeconds,
  notes: lineFields.notes,
  videoRequired: lineFields.videoRequired,
});

const removePrescription = z.object({ op: z.literal("removePrescription"), prescriptionId: rowId });

/**
 * Puts a program on the athlete's Today: the program and every week in it go
 * to published in one request. This is the block-up-front button. Week-by-week
 * writing publishes a single week with `updateWeek` instead -- both are the
 * same two status columns, so neither shape needs the other's migration.
 */
const publishProgram = z.object({ op: z.literal("publishProgram"), programId: rowId });

/**
 * Structural removals. Each cascades to the rows beneath it, children first,
 * so a removal that fails halfway leaves orphans `assembleProgram` already
 * drops rather than a parent pointing at nothing. None of them can reach a
 * logged set: a session started from a removed day keeps its sets and their
 * snapshots, and simply stops resolving its day.
 */
const removeBlock = z.object({ op: z.literal("removeBlock"), blockId: rowId });
const removeWeek = z.object({ op: z.literal("removeWeek"), weekId: rowId });
const removeDay = z.object({ op: z.literal("removeDay"), dayId: rowId });

/**
 * A variation the library does not hold yet, typed into the editor.
 *
 * Created in the ATHLETE's library, not the coach's: a variation is its own
 * exercise with its own reference max (Order 18), and the athlete has to be
 * able to read it, log it and see its maxes. A coach-owned row would show up
 * on their Today as an exercise they cannot name. On a template it belongs to
 * the coach, who is the only reader.
 */
const createExercise = z.object({
  op: z.literal("createExercise"),
  programId: rowId,
  name: z.string().trim().min(1, "is required").max(64),
});

export const REORDER_LEVELS = ["blocks", "weeks", "days", "prescriptions"] as const;
export type ReorderLevel = (typeof REORDER_LEVELS)[number];

const reorder = z.object({
  op: z.literal("reorder"),
  level: z.enum(REORDER_LEVELS),
  /** The program for blocks, the block for weeks, the week for days, the day for lines. */
  parentId: rowId,
  /** Every child of the parent, in the new order. Not a subset -- see `checkReorder`. */
  orderedIds: z
    .array(rowId)
    .min(1)
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length, "lists a row twice"),
});

export const programOp = z.discriminatedUnion("op", [
  createProgram,
  updateProgram,
  addBlock,
  updateBlock,
  addWeek,
  updateWeek,
  addDay,
  updateDay,
  addPrescription,
  updatePrescription,
  removePrescription,
  reorder,
  publishProgram,
  removeBlock,
  removeWeek,
  removeDay,
  createExercise,
]);

/** What a caller writes -- before defaults and trimming. */
export type ProgramOpInput = z.input<typeof programOp>;
/** What the repository acts on -- after them. */
export type ProgramOp = z.output<typeof programOp>;
export type ProgramOpOf<K extends ProgramOp["op"]> = Extract<ProgramOp, { op: K }>;

/** Parses an op, answering with the first problem in words rather than a Zod dump. */
export function readProgramOp(
  input: unknown,
): { ok: true; op: ProgramOp } | { ok: false; reason: string } {
  const parsed = programOp.safeParse(input);
  if (parsed.success) return { ok: true, op: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
  return { ok: false, reason: `${where}${issue?.message ?? "invalid"}` };
}

/* -------------------------------------------------------------------------
 * Ordering
 * ---------------------------------------------------------------------- */

/** Position order, with the row id breaking ties so the order is total. */
export function byPosition<T extends { position: number; id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

/** The next free position among siblings: one past the highest, or 0. */
export function nextPosition(siblings: readonly { position: number }[]): number {
  return siblings.reduce((max, row) => Math.max(max, row.position + 1), 0);
}

/**
 * Validates a reorder against the rows that actually exist, and says which
 * positions have to change.
 *
 * The list must name every child and nothing else. A subset would leave the
 * unnamed rows colliding with renumbered ones; an extra id is either a row
 * from another day or a row that no longer exists -- both a stale editor, and
 * both better refused than half-applied.
 *
 * Returns only the moves, so reordering two lines of eight is two writes.
 */
export function checkReorder(
  existing: readonly { id: string; position: number }[],
  orderedIds: readonly string[],
): { ok: true; moves: { id: string; position: number }[] } | { ok: false; reason: string } {
  const known = new Set(existing.map((row) => row.id));
  if (orderedIds.length !== known.size || orderedIds.some((id) => !known.has(id))) {
    return { ok: false, reason: "the new order has to list every row exactly once, and nothing else" };
  }
  const current = new Map(existing.map((row) => [row.id, row.position]));
  const moves = orderedIds
    .map((id, position) => ({ id, position }))
    .filter(({ id, position }) => current.get(id) !== position);
  return { ok: true, moves };
}

/* -------------------------------------------------------------------------
 * Assembly
 * ---------------------------------------------------------------------- */

export interface DayTree extends ProgramDay {
  prescriptions: Prescription[];
}
export interface WeekTree extends ProgramWeek {
  days: DayTree[];
}
export interface BlockTree extends ProgramBlock {
  weeks: WeekTree[];
}
export interface ProgramTree extends Program {
  blocks: BlockTree[];
}

/**
 * Four flat reads into one nested, ordered tree.
 *
 * Appwrite cannot join, so a program is read as one query per table, filtered
 * on the denormalised program_id, and put back together here. A child whose
 * parent is missing is dropped rather than floated to the top level: it can
 * only be the residue of a half-finished write, and showing it would put a day
 * in no week on an athlete's screen.
 */
export function assembleProgram(
  program: Program,
  rows: {
    blocks: readonly ProgramBlock[];
    weeks: readonly ProgramWeek[];
    days: readonly ProgramDay[];
    prescriptions: readonly Prescription[];
  },
): ProgramTree {
  const linesByDay = groupBy(rows.prescriptions, (p) => p.dayId);
  const daysByWeek = groupBy(rows.days, (d) => d.weekId);
  const weeksByBlock = groupBy(rows.weeks, (w) => w.blockId);

  return {
    ...program,
    blocks: byPosition(rows.blocks.filter((b) => b.programId === program.id)).map((block) => ({
      ...block,
      weeks: byPosition(weeksByBlock.get(block.id) ?? []).map((week) => ({
        ...week,
        days: byPosition(daysByWeek.get(week.id) ?? []).map((day) => ({
          ...day,
          prescriptions: byPosition(linesByDay.get(day.id) ?? []),
        })),
      })),
    })),
  };
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = groups.get(k);
    if (list) list.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}

/* -------------------------------------------------------------------------
 * Today
 * ---------------------------------------------------------------------- */

/**
 * The athlete's calendar day, from their own clock.
 *
 * Local, not UTC. A session at 7am in London on the 28th is the 28th, and a
 * UTC date would put a late-evening session on tomorrow's card.
 */
export function localDay(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** A calendar day moved by whole days, staying a calendar day. */
export function addDays(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

/**
 * Whether a day is live for the athlete: its program and its week are both
 * published. Draft is filtered here rather than hidden by permissions -- see
 * programPermissions for why.
 */
export function isLiveDay(day: ProgramDay, program: Program | null, week: ProgramWeek | null): boolean {
  return (
    program !== null &&
    week !== null &&
    program.id === day.programId &&
    week.id === day.weekId &&
    program.status === "published" &&
    week.status === "published"
  );
}

/**
 * Which of the days scheduled on a date is the one to show.
 *
 * Normally there is one. Two happen when a coach publishes a new program
 * before archiving the old one; the most recently updated program wins,
 * because that is the one the coach touched last and therefore means. Days
 * that are not live are never candidates.
 */
export function pickTodaysDay(
  days: readonly ProgramDay[],
  programs: ReadonlyMap<string, Program>,
  weeks: ReadonlyMap<string, ProgramWeek>,
): ProgramDay | null {
  const live = days.filter((day) =>
    isLiveDay(day, programs.get(day.programId) ?? null, weeks.get(day.weekId) ?? null),
  );
  if (live.length === 0) return null;
  return [...live].sort((a, b) => {
    const pa = programs.get(a.programId)!.updatedAt;
    const pb = programs.get(b.programId)!.updatedAt;
    return pb.localeCompare(pa) || a.position - b.position;
  })[0];
}
