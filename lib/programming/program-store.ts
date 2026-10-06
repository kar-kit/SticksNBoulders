import { Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import {
  assembleProgram,
  byPosition,
  parseBlock,
  parseDay,
  parsePrescriptionRow,
  parseProgram,
  parseRows,
  parseWeek,
  pickTodaysDay,
  programOp,
  type Prescription,
  type Program,
  type ProgramDay,
  type ProgramOpInput,
  type ProgramTree,
  type ProgramWeek,
} from "./program";

/**
 * The program repository, browser side. Order 19.
 *
 * Reads go straight to Appwrite through the signed-in user's session, so the
 * permissions stamped on each row decide what comes back: an athlete sees
 * their own programs, a coach sees what they wrote, a stranger sees nothing.
 * There is no branch here on who is asking.
 *
 * Writes go to /api/program with a short-lived JWT, never to Appwrite, for the
 * reason every program table is server-only -- see program-admin.ts.
 */

const PAGE = 100;

type TableId = "programs" | "program_blocks" | "program_weeks" | "program_days" | "prescriptions";

async function listAll(tableId: TableId, queries: string[]): Promise<unknown[]> {
  const { tables, databaseId } = browserAppwrite();
  const rows: unknown[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { rows: Array<{ $id: string }> } = await tables.listRows({
      databaseId,
      tableId,
      queries: [...queries, Query.orderAsc("$id"), Query.limit(PAGE), ...(cursor ? [Query.cursorAfter(cursor)] : [])],
    });
    rows.push(...page.rows);
    if (page.rows.length < PAGE) return rows;
    cursor = page.rows[page.rows.length - 1].$id;
  }
}

async function getOne<T>(tableId: TableId, rowId: string, parse: (row: unknown) => T | null): Promise<T | null> {
  const { tables, databaseId } = browserAppwrite();
  const row = await tables.getRow({ databaseId, tableId, rowId }).catch(() => null);
  return parse(row);
}

/** A whole program, nested and ordered. Null when it does not exist or is not readable. */
export async function fetchProgramTree(programId: string): Promise<ProgramTree | null> {
  const program = await getOne("programs", programId, parseProgram);
  if (!program) return null;
  const byProgram = [Query.equal("program_id", programId)];
  const [blocks, weeks, days, prescriptions] = await Promise.all([
    listAll("program_blocks", byProgram),
    listAll("program_weeks", byProgram),
    listAll("program_days", byProgram),
    listAll("prescriptions", byProgram),
  ]);
  return assembleProgram(program, {
    blocks: parseRows(blocks, parseBlock),
    weeks: parseRows(weeks, parseWeek),
    days: parseRows(days, parseDay),
    prescriptions: parseRows(prescriptions, parsePrescriptionRow),
  });
}

/** Programs for an athlete, or written by a coach, newest first. Templates are `{ coachId, athleteId: null }`. */
export async function fetchPrograms(filter: { athleteId: string } | { coachId: string }): Promise<Program[]> {
  const query =
    "athleteId" in filter ? Query.equal("athlete_id", filter.athleteId) : Query.equal("coach_id", filter.coachId);
  const rows = parseRows(await listAll("programs", [query]), parseProgram);
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** A prescribed day with everything the athlete needs to see and start it. */
export interface PrescribedDay {
  program: Program;
  week: ProgramWeek;
  day: ProgramDay;
  prescriptions: Prescription[];
}

async function withLines(day: ProgramDay, program: Program, week: ProgramWeek): Promise<PrescribedDay> {
  const lines = parseRows(await listAll("prescriptions", [Query.equal("day_id", day.id)]), parsePrescriptionRow);
  return { program, week, day, prescriptions: byPosition(lines) };
}

/**
 * What is prescribed for this athlete on this calendar day, or null.
 *
 * One indexed query for the day, then a point read for its program and week to
 * check both are published. Drafts are filtered here rather than hidden by
 * permissions; see programPermissions.
 */
export async function fetchPrescribedDay(athleteId: string, on: string): Promise<PrescribedDay | null> {
  const days = parseRows(
    await listAll("program_days", [Query.equal("athlete_id", athleteId), Query.equal("scheduled_on", on)]),
    parseDay,
  );
  if (days.length === 0) return null;

  const programs = new Map<string, Program>();
  const weeks = new Map<string, ProgramWeek>();
  await Promise.all([
    ...[...new Set(days.map((d) => d.programId))].map(async (id) => {
      const program = await getOne("programs", id, parseProgram);
      if (program) programs.set(id, program);
    }),
    ...[...new Set(days.map((d) => d.weekId))].map(async (id) => {
      const week = await getOne("program_weeks", id, parseWeek);
      if (week) weeks.set(id, week);
    }),
  ]);

  const day = pickTodaysDay(days, programs, weeks);
  if (!day) return null;
  return withLines(day, programs.get(day.programId)!, weeks.get(day.weekId)!);
}

/**
 * A prescribed day by id, for the logger.
 *
 * The session remembers which day it was started from, so the logger asks by
 * id rather than by date: a session that runs past midnight is still the day
 * it started as. No published check here -- the athlete already started it,
 * and a coach un-publishing mid-session must not empty the screen under them.
 */
export async function fetchPrescribedDayById(dayId: string): Promise<PrescribedDay | null> {
  const day = await getOne("program_days", dayId, parseDay);
  if (!day) return null;
  const [program, week] = await Promise.all([
    getOne("programs", day.programId, parseProgram),
    getOne("program_weeks", day.weekId, parseWeek),
  ]);
  if (!program || !week) return null;
  return withLines(day, program, week);
}

export type ProgramWriteResult = { rowId: string };

/**
 * Sends one program write to the server.
 *
 * Validated here as well as there, with the same schema: a bad op is caught
 * before a round trip, and the server still refuses it if this is bypassed.
 */
export async function sendProgramOp(op: ProgramOpInput): Promise<ProgramWriteResult> {
  const parsed = programOp.safeParse(op);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "invalid program write");

  const { account } = browserAppwrite();
  const { jwt } = await account.createJWT();
  const response = await fetch("/api/program", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
    body: JSON.stringify(op),
  });
  const body = (await response.json().catch(() => ({}))) as { rowId?: string; reason?: string; error?: string };
  if (!response.ok) throw new Error(body.reason ?? body.error ?? `program write failed: ${response.status}`);
  return { rowId: body.rowId ?? "" };
}
