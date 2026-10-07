import { Client, Query, TablesDB } from "node-appwrite";
import {
  assembleProgram,
  byPosition,
  checkReorder,
  nextPosition,
  parseBlock,
  parseDay,
  parsePrescriptionRow,
  parseProgram,
  parseRows,
  parseWeek,
  readProgramOp,
  type ProgramOp,
  type ProgramOpOf,
  type ProgramTree,
  type ReorderLevel,
} from "@/lib/programming/program";
import { copyCalendar, duplicateShift, shiftDay } from "@/lib/programming/copy";
import {
  copyPrescription,
  createExerciseFor,
  createPrescription,
  createProgram,
  createProgramBlock,
  createProgramDay,
  createProgramWeek,
  deletePrescription,
  deleteProgramRow,
  updatePrescription,
  updateProgram,
  updateProgramBlock,
  updateProgramDay,
  updateProgramWeek,
  type ProgramScope,
} from "./program-write";
import { normaliseExerciseName, type WriteDeps } from "./write";
import type { ProgramTable } from "./policy";
import type { RowWriter } from "./row-writer";

/**
 * The program repository, server side. Order 19.
 *
 * Every program write runs here, with the API key, for the reason
 * reference-max-admin.ts gives: Appwrite polices who may read a row, never
 * what a row claims. `athlete_id` on a day is data, so a client able to create
 * one could create it naming any athlete and put it on their Today.
 *
 * So this module owns the three checks that matter, and nothing else does:
 *
 *   1. The input is valid -- one Zod schema, `programOp`, shared with the seed.
 *   2. The caller may write this program -- they are its coach, and if it is
 *      assigned, they still actively coach the athlete.
 *   3. A child is attached to a parent in the same program. The program,
 *      coach and athlete of any child are READ from its parent row, never
 *      taken from the request, so a request cannot graft a day onto somebody
 *      else's week.
 *
 * It never writes `sessions` or `sets`. That is constraint 5 -- a coach editing
 * a block never rewrites what an athlete did -- and it is tested by asserting
 * which tables the fake writer saw.
 */

export interface ProgramTables {
  listRows(params: {
    databaseId: string;
    tableId: string;
    queries: string[];
  }): Promise<{ rows: Array<Record<string, unknown>> }>;
  getRow(params: {
    databaseId: string;
    tableId: string;
    rowId: string;
  }): Promise<{ $id: string } & Record<string, unknown>>;
  writer: RowWriter;
}

export function adminProgramTables(client: Client): ProgramTables {
  const db = new TablesDB(client);
  return {
    listRows: (params) =>
      db.listRows(params) as unknown as Promise<{ rows: Array<Record<string, unknown>> }>,
    getRow: (params) =>
      db.getRow(params) as unknown as Promise<{ $id: string } & Record<string, unknown>>,
    writer: {
      createRow: (params) => db.createRow(params),
      updateRow: (params) => db.updateRow(params),
      deleteRow: (params) => db.deleteRow(params),
    },
  };
}

export type ProgramOpResult =
  | { status: "ok"; rowId: string }
  | { status: "invalid"; reason: string }
  | { status: "not-found" }
  | { status: "not-allowed" };

type Deps = Pick<WriteDeps, "newId" | "now">;

interface Ctx {
  tables: ProgramTables;
  databaseId: string;
  callerId: string;
  deps: WriteDeps;
}

/** A refusal, thrown inside an op and turned into a result at the edge. */
class Refusal extends Error {
  constructor(readonly result: Exclude<ProgramOpResult, { status: "ok" }>) {
    super(result.status);
  }
}
const refuse = (result: Exclude<ProgramOpResult, { status: "ok" }>): never => {
  throw new Refusal(result);
};

/* -------------------------------------------------------------------------
 * Authorisation
 * ---------------------------------------------------------------------- */

/**
 * May this caller write programming for this athlete?
 *
 * A template (no athlete) is the caller's own. A self-coached athlete may
 * write for themselves -- a coach is usually also an athlete, and Joey logs
 * his own training. Anyone else needs an ACTIVE row in coach_athlete_links:
 * the record, not circle membership, so a membership left behind by a
 * half-failed revoke is never mistaken for an authorisation.
 */
export async function mayProgramFor(
  tables: ProgramTables,
  databaseId: string,
  callerId: string,
  athleteId: string | null,
): Promise<boolean> {
  if (!callerId) return false;
  if (athleteId === null || athleteId === callerId) return true;
  const links = await tables.listRows({
    databaseId,
    tableId: "coach_athlete_links",
    queries: [
      Query.equal("athlete_id", athleteId),
      Query.equal("coach_id", callerId),
      Query.equal("status", "active"),
      Query.limit(1),
    ],
  });
  return links.rows.length > 0;
}

async function rowOf(ctx: Ctx, tableId: ProgramTable | "exercises", rowId: string) {
  return ctx.tables.getRow({ databaseId: ctx.databaseId, tableId, rowId }).catch(() => null);
}

/**
 * The scope of a program the caller may edit, or a refusal.
 *
 * Only the coach who wrote a program edits it. A second coach at the same gym
 * reads it through the athlete's circle and does not write it -- [Inference],
 * see docs/programs.md. And an assigned program stops being editable the
 * moment the link is revoked, even though the coach can still read it.
 */
async function scopeOf(ctx: Ctx, programId: string): Promise<ProgramScope> {
  const program = parseProgram(await rowOf(ctx, "programs", programId));
  if (!program) return refuse({ status: "not-found" });
  if (program.coachId !== ctx.callerId) return refuse({ status: "not-allowed" });
  if (!(await mayProgramFor(ctx.tables, ctx.databaseId, ctx.callerId, program.athleteId))) {
    return refuse({ status: "not-allowed" });
  }
  return { programId: program.id, coachId: program.coachId, athleteId: program.athleteId };
}

/** A child row, parsed, plus the scope of the program it belongs to. */
async function childOf<T extends { programId: string }>(
  ctx: Ctx,
  tableId: ProgramTable,
  rowId: string,
  parse: (row: unknown) => T | null,
): Promise<{ row: T; scope: ProgramScope }> {
  const row = parse(await rowOf(ctx, tableId, rowId));
  if (!row) return refuse({ status: "not-found" });
  return { row, scope: await scopeOf(ctx, row.programId) };
}

const PAGE = 100;

/**
 * Every row matching a filter, paged by cursor.
 *
 * Paged rather than one large limit because a single read that silently caps
 * is how a reorder ends up refusing a day that really has 101 lines, or a tree
 * that quietly loses its last week.
 */
async function listAll(
  tables: ProgramTables,
  databaseId: string,
  tableId: ProgramTable,
  column: string,
  value: string,
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  for (;;) {
    const queries = [Query.equal(column, value), Query.orderAsc("$id"), Query.limit(PAGE)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const page = await tables.listRows({ databaseId, tableId, queries });
    rows.push(...page.rows);
    if (page.rows.length < PAGE) return rows;
    cursor = String(page.rows[page.rows.length - 1].$id);
  }
}

async function siblings(ctx: Ctx, tableId: ProgramTable, parentColumn: string, parentId: string) {
  return (await listAll(ctx.tables, ctx.databaseId, tableId, parentColumn, parentId))
    .map((row) => ({ id: String(row.$id), position: typeof row.position === "number" ? row.position : 0 }))
    .filter((row) => row.id);
}

/* -------------------------------------------------------------------------
 * Ops
 * ---------------------------------------------------------------------- */

/**
 * Runs one validated write for a caller. The only entry point the route and
 * the seed script use.
 *
 * `callerId` comes from a verified JWT or, in a script, is the fixture coach
 * the script is acting as. It is never read from the op.
 */
export async function runProgramOp(
  tables: ProgramTables,
  databaseId: string,
  callerId: string,
  input: unknown,
  deps: Deps,
): Promise<ProgramOpResult> {
  if (!callerId) return { status: "not-allowed" };
  const parsed = readProgramOp(input);
  if (!parsed.ok) return { status: "invalid", reason: parsed.reason };

  const ctx: Ctx = {
    tables,
    databaseId,
    callerId,
    deps: { writer: tables.writer, databaseId, newId: deps.newId, now: deps.now },
  };
  try {
    return { status: "ok", rowId: await apply(ctx, parsed.op) };
  } catch (error) {
    if (error instanceof Refusal) return error.result;
    throw error;
  }
}

async function apply(ctx: Ctx, op: ProgramOp): Promise<string> {
  switch (op.op) {
    case "createProgram":
      return createProgramOp(ctx, op);
    case "updateProgram": {
      const scope = await scopeOf(ctx, op.programId);
      await updateProgram(ctx.deps, scope, op);
      return scope.programId;
    }
    case "addBlock": {
      const scope = await scopeOf(ctx, op.programId);
      const position = nextPosition(await siblings(ctx, "program_blocks", "program_id", scope.programId));
      const row = await createProgramBlock(ctx.deps, scope, { position, name: op.name, notes: op.notes });
      return row.$id;
    }
    case "updateBlock": {
      const { scope } = await childOf(ctx, "program_blocks", op.blockId, parseBlock);
      await updateProgramBlock(ctx.deps, scope, op.blockId, op);
      return op.blockId;
    }
    case "addWeek": {
      const { row: block, scope } = await childOf(ctx, "program_blocks", op.blockId, parseBlock);
      const position = nextPosition(await siblings(ctx, "program_weeks", "block_id", block.id));
      const row = await createProgramWeek(ctx.deps, scope, { ...op, blockId: block.id, position });
      return row.$id;
    }
    case "updateWeek": {
      const { scope } = await childOf(ctx, "program_weeks", op.weekId, parseWeek);
      await updateProgramWeek(ctx.deps, scope, op.weekId, op);
      return op.weekId;
    }
    case "addDay": {
      const { row: week, scope } = await childOf(ctx, "program_weeks", op.weekId, parseWeek);
      requireCalendarFits(scope, op.scheduledOn);
      const position = nextPosition(await siblings(ctx, "program_days", "week_id", week.id));
      const row = await createProgramDay(ctx.deps, scope, {
        ...op,
        blockId: week.blockId,
        weekId: week.id,
        position,
      });
      return row.$id;
    }
    case "updateDay": {
      const { scope } = await childOf(ctx, "program_days", op.dayId, parseDay);
      requireCalendarFits(scope, op.scheduledOn);
      await updateProgramDay(ctx.deps, scope, op.dayId, op);
      return op.dayId;
    }
    case "addPrescription": {
      const { row: day, scope } = await childOf(ctx, "program_days", op.dayId, parseDay);
      await requireExercise(ctx, scope, op.exerciseId);
      const position = nextPosition(await siblings(ctx, "prescriptions", "day_id", day.id));
      const row = await createPrescription(ctx.deps, scope, {
        ...op,
        weekId: day.weekId,
        dayId: day.id,
        position,
      });
      return row.$id;
    }
    case "updatePrescription": {
      const { row: line, scope } = await childOf(ctx, "prescriptions", op.prescriptionId, parsePrescriptionRow);
      if (op.exerciseId) await requireExercise(ctx, scope, op.exerciseId);
      // The range is checked against what the row will hold afterwards, not
      // just the fields in this request: changing reps alone can invert it.
      const reps = op.reps === undefined ? line.reps : op.reps;
      const repMax = op.repMax === undefined ? line.repMax : op.repMax;
      if (repMax != null && (reps == null || repMax < reps)) {
        refuse({ status: "invalid", reason: "repMax: a rep range needs a bottom, and its top cannot be below it" });
      }
      await updatePrescription(ctx.deps, scope, line.id, op);
      return line.id;
    }
    case "removePrescription": {
      const { row: line } = await childOf(ctx, "prescriptions", op.prescriptionId, parsePrescriptionRow);
      await deletePrescription(ctx.deps, line.id);
      return line.id;
    }
    case "reorder":
      return reorderOp(ctx, op);
    case "publishProgram":
      return publishOp(ctx, op.programId);
    case "publishWeek":
      return publishWeekOp(ctx, op.weekId);
    case "removeBlock": {
      const { row: block } = await childOf(ctx, "program_blocks", op.blockId, parseBlock);
      for (const week of await listAll(ctx.tables, ctx.databaseId, "program_weeks", "block_id", block.id)) {
        await removeWeek(ctx, String(week.$id));
      }
      await deleteProgramRow(ctx.deps, "program_blocks", block.id);
      return block.id;
    }
    case "removeWeek": {
      await childOf(ctx, "program_weeks", op.weekId, parseWeek);
      await removeWeek(ctx, op.weekId);
      return op.weekId;
    }
    case "removeDay": {
      await childOf(ctx, "program_days", op.dayId, parseDay);
      await removeDay(ctx, op.dayId);
      return op.dayId;
    }
    case "createExercise":
      return createExerciseOp(ctx, op);
    case "duplicateWeek":
      return duplicateWeekOp(ctx, op.weekId);
    case "copyProgram":
      return copyProgramOp(ctx, op);
  }
}

/**
 * Publishes a program and every week in it -- the block-up-front button.
 *
 * The program goes last. Until it is published nothing reaches Today however
 * many weeks are, so a publish that fails partway leaves the athlete seeing
 * nothing new rather than half a block; pressing it again finishes the job.
 */
async function publishOp(ctx: Ctx, programId: string): Promise<string> {
  const scope = await scopeOf(ctx, programId);
  if (scope.athleteId === null) {
    return refuse({ status: "invalid", reason: "programId: a template is never published; assign it first" });
  }
  const weeks = parseRows(
    await listAll(ctx.tables, ctx.databaseId, "program_weeks", "program_id", programId),
    parseWeek,
  );
  for (const week of weeks) {
    if (week.status !== "published") await updateProgramWeek(ctx.deps, scope, week.id, { status: "published" });
  }
  await updateProgram(ctx.deps, scope, { status: "published" });
  return programId;
}

/**
 * Publishes one week -- the week-at-a-time button -- and the program with it
 * if it is not live yet. Week first, program second, as above: a failure
 * between the two leaves the athlete seeing nothing new, and pressing again
 * finishes it. Unpublishing a week is `updateWeek {status: "draft"}`; the
 * program is left published, so the other weeks stay where they are.
 */
async function publishWeekOp(ctx: Ctx, weekId: string): Promise<string> {
  const { row: week, scope } = await childOf(ctx, "program_weeks", weekId, parseWeek);
  if (scope.athleteId === null) {
    return refuse({ status: "invalid", reason: "weekId: a template is never published; assign it first" });
  }
  if (week.status !== "published") await updateProgramWeek(ctx.deps, scope, week.id, { status: "published" });
  const program = parseProgram(await rowOf(ctx, "programs", scope.programId));
  if (program && program.status !== "published") await updateProgram(ctx.deps, scope, { status: "published" });
  return week.id;
}

/** Children first, so a failure halfway leaves orphans the tree drops, never a dangling parent. */
async function removeDay(ctx: Ctx, dayId: string) {
  for (const line of await listAll(ctx.tables, ctx.databaseId, "prescriptions", "day_id", dayId)) {
    await deletePrescription(ctx.deps, String(line.$id));
  }
  await deleteProgramRow(ctx.deps, "program_days", dayId);
}

async function removeWeek(ctx: Ctx, weekId: string) {
  for (const day of await listAll(ctx.tables, ctx.databaseId, "program_days", "week_id", weekId)) {
    await removeDay(ctx, String(day.$id));
  }
  await deleteProgramRow(ctx.deps, "program_weeks", weekId);
}

/** Whose library an exercise on this program has to live in to be readable by the person doing it. */
const libraryOwner = (scope: ProgramScope) => scope.athleteId ?? scope.coachId;

/**
 * Creates a variation in the athlete's library, or hands back the one already
 * there under the same name -- global first, then theirs -- so typing "Paused
 * Bench" twice does not make two.
 */
async function createExerciseOp(ctx: Ctx, op: ProgramOpOf<"createExercise">): Promise<string> {
  const scope = await scopeOf(ctx, op.programId);
  return exerciseInLibrary(ctx, libraryOwner(scope), op.name);
}

/** The exercise of this name the owner can read -- global first, then theirs -- created in their library if neither exists. */
async function exerciseInLibrary(ctx: Ctx, owner: string, name: string): Promise<string> {
  const normalised = normaliseExerciseName(name);
  if (!normalised) return refuse({ status: "invalid", reason: "name: needs a letter or number in it" });
  const same = await ctx.tables.listRows({
    databaseId: ctx.databaseId,
    tableId: "exercises",
    queries: [Query.equal("normalised_name", normalised), Query.limit(25)],
  });
  const existing =
    same.rows.find((row) => row.is_global === true) ?? same.rows.find((row) => row.owner_id === owner);
  if (existing) return String(existing.$id);
  const row = await createExerciseFor(ctx.deps, owner, name);
  return row.$id;
}

async function createProgramOp(ctx: Ctx, op: ProgramOpOf<"createProgram">): Promise<string> {
  if (!(await mayProgramFor(ctx.tables, ctx.databaseId, ctx.callerId, op.athleteId))) {
    return refuse({ status: "not-allowed" });
  }
  if (op.templateId) {
    // Lineage may only point at the caller's own template. Pointing at
    // somebody else's would leak its existence and nothing more, but a
    // reference nobody can follow is noise in the record.
    const template = parseProgram(await rowOf(ctx, "programs", op.templateId));
    if (!template || template.coachId !== ctx.callerId || template.athleteId !== null) {
      return refuse({ status: "invalid", reason: "templateId: not one of your templates" });
    }
  }
  const row = await createProgram(ctx.deps, { userId: ctx.callerId }, op);
  return row.$id;
}

/** A template has no calendar. It gets dates when it is copied onto somebody. */
function requireCalendarFits(scope: ProgramScope, scheduledOn: string | null | undefined) {
  if (scope.athleteId === null && scheduledOn) {
    refuse({ status: "invalid", reason: "scheduledOn: a template has no calendar; date it when it is assigned" });
  }
}

/**
 * The exercise exists AND the person doing the program can read it: a global
 * row, or one in their own library. A coach's private custom exercise would
 * reach the athlete's Today as a line with no name -- they cannot read it --
 * so it is refused here and `createExercise` puts it where it belongs.
 */
async function requireExercise(ctx: Ctx, scope: ProgramScope, exerciseId: string) {
  const row = await rowOf(ctx, "exercises", exerciseId);
  if (!row) return refuse({ status: "invalid", reason: "exerciseId: no such exercise" });
  if (row.is_global !== true && row.owner_id !== libraryOwner(scope)) {
    refuse({ status: "invalid", reason: "exerciseId: not in the athlete's library" });
  }
}

const REORDER: Record<ReorderLevel, { table: ProgramTable; parentColumn: string }> = {
  blocks: { table: "program_blocks", parentColumn: "program_id" },
  weeks: { table: "program_weeks", parentColumn: "block_id" },
  days: { table: "program_days", parentColumn: "week_id" },
  prescriptions: { table: "prescriptions", parentColumn: "day_id" },
};

async function reorderOp(ctx: Ctx, op: ProgramOpOf<"reorder">): Promise<string> {
  // The parent decides the scope; the children are then listed by that parent,
  // so an id from another day cannot be smuggled into this one's order.
  const scope =
    op.level === "blocks"
      ? await scopeOf(ctx, op.parentId)
      : op.level === "weeks"
        ? (await childOf(ctx, "program_blocks", op.parentId, parseBlock)).scope
        : op.level === "days"
          ? (await childOf(ctx, "program_weeks", op.parentId, parseWeek)).scope
          : (await childOf(ctx, "program_days", op.parentId, parseDay)).scope;

  const { table, parentColumn } = REORDER[op.level];
  const checked = checkReorder(await siblings(ctx, table, parentColumn, op.parentId), op.orderedIds);
  if (!checked.ok) return refuse({ status: "invalid", reason: `orderedIds: ${checked.reason}` });

  for (const move of checked.moves) {
    const fields = { position: move.position };
    if (table === "program_blocks") await updateProgramBlock(ctx.deps, scope, move.id, fields);
    else if (table === "program_weeks") await updateProgramWeek(ctx.deps, scope, move.id, fields);
    else if (table === "program_days") await updateProgramDay(ctx.deps, scope, move.id, fields);
    else await updatePrescription(ctx.deps, scope, move.id, fields);
  }
  return op.parentId;
}

/* -------------------------------------------------------------------------
 * Copies (Order 20)
 *
 * Both copies read everything first and write second, so a refusal -- an
 * exercise that no longer exists, a target the caller does not coach -- is
 * found before a single row is written. Both write drafts: a half-finished
 * copy is a draft week the athlete cannot see, or a draft program only the
 * coach can, never half a block on somebody's Today. Neither reads or writes
 * `sessions` or `sets`.
 * ---------------------------------------------------------------------- */

type RawRow = Record<string, unknown>;

/** Raw lines grouped by day, in order, dropping any that do not parse. */
function linesByDay(rows: readonly RawRow[]): Map<string, RawRow[]> {
  const parsed = rows.flatMap((raw) => {
    const line = parsePrescriptionRow(raw);
    return line ? [{ ...line, raw }] : [];
  });
  const byDay = new Map<string, RawRow[]>();
  for (const line of byPosition(parsed)) {
    const list = byDay.get(line.dayId) ?? [];
    list.push(line.raw);
    byDay.set(line.dayId, list);
  }
  return byDay;
}

/** Copies a day's lines under a new day, in parallel: they share nothing but the parent. */
async function copyLines(
  ctx: Ctx,
  scope: ProgramScope,
  to: { weekId: string; dayId: string },
  lines: readonly RawRow[],
  exerciseFor: (sourceExerciseId: string) => string,
) {
  await Promise.all(
    lines.map((raw, position) =>
      copyPrescription(
        ctx.deps,
        scope,
        { ...to, exerciseId: exerciseFor(String(raw.exercise_id)), position },
        raw,
      ),
    ),
  );
}

/**
 * Appends a draft copy of a week to its own block -- the "most blocks are one
 * week repeated with load changes" button. Same program, same athlete, so
 * every exercise is already one they can read and is kept as is.
 */
async function duplicateWeekOp(ctx: Ctx, weekId: string): Promise<string> {
  const { row: source, scope } = await childOf(ctx, "program_weeks", weekId, parseWeek);
  const [siblingRows, dayRows, lineRows] = await Promise.all([
    listAll(ctx.tables, ctx.databaseId, "program_weeks", "block_id", source.blockId),
    listAll(ctx.tables, ctx.databaseId, "program_days", "week_id", source.id),
    listAll(ctx.tables, ctx.databaseId, "prescriptions", "week_id", source.id),
  ]);
  const weeks = byPosition(parseRows(siblingRows, parseWeek));
  const shift = duplicateShift(
    weeks.map((w) => w.id),
    source.id,
  );
  const days = byPosition(parseRows(dayRows, parseDay));
  const lines = linesByDay(lineRows);

  // The label is not copied: two tabs both called "Heavy" are worse than
  // "Week 5". [Inference]
  const week = await createProgramWeek(ctx.deps, scope, {
    blockId: source.blockId,
    position: nextPosition(weeks),
    label: null,
    status: "draft",
    notes: source.notes,
  });
  for (const day of days) {
    const copy = await createProgramDay(ctx.deps, scope, {
      blockId: source.blockId,
      weekId: week.$id,
      position: day.position,
      label: day.label,
      scheduledOn: shiftDay(day.scheduledOn, shift),
      notes: day.notes,
    });
    await copyLines(ctx, scope, { weekId: week.$id, dayId: copy.$id }, lines.get(day.id) ?? [], (id) => id);
  }
  return week.$id;
}

/**
 * Copies a program, or one of its blocks, to an athlete as a new draft program.
 *
 * Authorised on both ends: the caller must be allowed to edit the SOURCE (its
 * coach, still linked to its athlete) and to program for the TARGET (an active
 * link, or themselves). Copying from a former athlete's program is refused for
 * the same reason editing it is.
 *
 * Lines are copied as typed. `75%` on the copy is 75% of the target's own
 * training max for that exercise, resolved when they log it -- never the
 * source athlete's kilos. Fixed kilos (`142.5`) stay the kilos the coach
 * typed. [Inference] Those were written for someone else; the copy is a draft
 * so the coach reads it before it is published.
 */
async function copyProgramOp(ctx: Ctx, op: ProgramOpOf<"copyProgram">): Promise<string> {
  await scopeOf(ctx, op.programId);
  if (!(await mayProgramFor(ctx.tables, ctx.databaseId, ctx.callerId, op.athleteId))) {
    return refuse({ status: "not-allowed" });
  }
  const source = parseProgram(await rowOf(ctx, "programs", op.programId));
  if (!source) return refuse({ status: "not-found" });

  const all = (tableId: ProgramTable) => listAll(ctx.tables, ctx.databaseId, tableId, "program_id", source.id);
  const [blockRows, weekRows, dayRows, lineRows] = await Promise.all([
    all("program_blocks"),
    all("program_weeks"),
    all("program_days"),
    all("prescriptions"),
  ]);
  let blocks = byPosition(parseRows(blockRows, parseBlock));
  if (op.blockId) {
    blocks = blocks.filter((b) => b.id === op.blockId);
    if (blocks.length === 0) return refuse({ status: "not-found" });
  }
  const keptBlocks = new Set(blocks.map((b) => b.id));
  const weeks = byPosition(parseRows(weekRows, parseWeek).filter((w) => keptBlocks.has(w.blockId)));
  const keptWeeks = new Set(weeks.map((w) => w.id));
  const days = byPosition(parseRows(dayRows, parseDay).filter((d) => keptWeeks.has(d.weekId)));
  const keptDays = new Set(days.map((d) => d.id));
  const lines = linesByDay(lineRows.filter((row) => keptDays.has(String(row.day_id))));

  // Every exercise, resolved in the target's library before anything is
  // written. A variation is its own exercise with its own max, so the source
  // athlete's "Paused Bench" becomes the target's "Paused Bench" -- found by
  // name, or created there by the same path the editor uses.
  const target = op.athleteId;
  const exercises = new Map<string, string>();
  const missing: Array<{ id: string; name: string }> = [];
  for (const id of new Set([...lines.values()].flat().map((row) => String(row.exercise_id)))) {
    const row = await rowOf(ctx, "exercises", id);
    if (!row) return refuse({ status: "invalid", reason: "exerciseId: a line's exercise no longer exists" });
    if (row.is_global === true || row.owner_id === target) exercises.set(id, id);
    else missing.push({ id, name: String(row.name ?? "") });
  }
  // The only writes before the program row, and find-or-create: a copy that
  // fails after this leaves at most a variation the athlete was getting anyway.
  for (const { id, name } of missing) exercises.set(id, await exerciseInLibrary(ctx, target, name));

  const calendar = copyCalendar({
    wholeProgram: !op.blockId,
    sourceStartOn: source.startOn,
    days: days.map((d) => d.scheduledOn),
    startOn: op.startOn,
  });
  const programRow = await createProgram(
    ctx.deps,
    { userId: ctx.callerId },
    {
      athleteId: target,
      name: op.name ?? (op.blockId ? `${source.name} · ${blocks[0].name}` : source.name),
      status: "draft",
      startOn: calendar.startOn,
      notes: source.notes,
      // Lineage only when the source is the caller's own template, as createProgram requires.
      templateId: source.athleteId === null ? source.id : null,
    },
  );
  const to: ProgramScope = { programId: programRow.$id, coachId: ctx.callerId, athleteId: target };

  for (const [blockAt, block] of blocks.entries()) {
    const newBlock = await createProgramBlock(ctx.deps, to, {
      position: blockAt,
      name: block.name,
      notes: block.notes,
    });
    for (const [weekAt, week] of weeks.filter((w) => w.blockId === block.id).entries()) {
      const newWeek = await createProgramWeek(ctx.deps, to, {
        blockId: newBlock.$id,
        position: weekAt,
        label: week.label,
        status: "draft",
        notes: week.notes,
      });
      for (const day of days.filter((d) => d.weekId === week.id)) {
        const newDay = await createProgramDay(ctx.deps, to, {
          blockId: newBlock.$id,
          weekId: newWeek.$id,
          position: day.position,
          label: day.label,
          scheduledOn: shiftDay(day.scheduledOn, calendar.shift),
          notes: day.notes,
        });
        await copyLines(ctx, to, { weekId: newWeek.$id, dayId: newDay.$id }, lines.get(day.id) ?? [], (id) =>
          exercises.get(id)!,
        );
      }
    }
  }
  return programRow.$id;
}

/* -------------------------------------------------------------------------
 * Reads, for scripts and server code
 * ---------------------------------------------------------------------- */

/**
 * A whole program, assembled. The API key bypasses permissions, so this is
 * for scripts and server code only; the app reads through the browser client
 * in lib/programming/program-store.ts, where Appwrite applies the athlete's
 * or coach's own permissions.
 */
export async function readProgramTree(
  tables: ProgramTables,
  databaseId: string,
  programId: string,
): Promise<ProgramTree | null> {
  const program = parseProgram(
    await tables.getRow({ databaseId, tableId: "programs", rowId: programId }).catch(() => null),
  );
  if (!program) return null;
  const all = (tableId: ProgramTable) => listAll(tables, databaseId, tableId, "program_id", programId);
  const [blocks, weeks, days, prescriptions] = await Promise.all([
    all("program_blocks"),
    all("program_weeks"),
    all("program_days"),
    all("prescriptions"),
  ]);
  return assembleProgram(program, {
    blocks: parseRows(blocks, parseBlock),
    weeks: parseRows(weeks, parseWeek),
    days: parseRows(days, parseDay),
    prescriptions: byPosition(parseRows(prescriptions, parsePrescriptionRow)),
  });
}
