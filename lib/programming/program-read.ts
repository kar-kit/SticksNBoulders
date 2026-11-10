import { Query } from "appwrite";
import { livePrograms, visibleProgram } from "./my-program";
import {
  parseBlock,
  parseDay,
  parsePrescriptionRow,
  parseProgram,
  parseRows,
  parseWeek,
  type Program,
  type ProgramTree,
} from "./program";

/**
 * Program reads, against any reader. Order 19 and 23.
 *
 * Moved out of program-store.ts (F29) so the read API's /program/current is
 * the same read My Program does, through a reader on the athlete's own JWT,
 * rather than a second copy of the draft rule. The browser passes its
 * session's tables; the API passes a TablesDB on a minted JWT.
 *
 * Reads go straight to Appwrite as whoever the reader is, so the permissions
 * stamped on each row decide what comes back: an athlete sees their own
 * programs, a coach sees what they wrote, a stranger sees nothing.
 */

export interface ProgramSource {
  tables: {
    listRows(params: {
      databaseId: string;
      tableId: string;
      queries?: string[];
    }): Promise<{ rows: Array<{ $id: string }> }>;
  };
  databaseId: string;
}

const PAGE = 100;

export type ProgramTableId = "programs" | "program_blocks" | "program_weeks" | "program_days" | "prescriptions" | "sessions";

export async function listAllFrom(source: ProgramSource, tableId: ProgramTableId, queries: string[]): Promise<unknown[]> {
  const { tables, databaseId } = source;
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

/**
 * The coach's label for each of these program days, for naming the sessions
 * started from them in History. One query on the ids, two columns.
 *
 * A day the athlete can no longer read (unlinked coach, deleted program) is
 * simply absent, and its session falls back to the date.
 */
export async function readDayLabels(source: ProgramSource, dayIds: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(dayIds.filter(Boolean))];
  const labels = new Map<string, string>();
  if (unique.length === 0) return labels;
  const rows = await listAllFrom(source, "program_days", [Query.equal("$id", unique), Query.select(["$id", "label"])]);
  for (const row of rows as Array<{ $id?: unknown; label?: unknown }>) {
    if (typeof row.$id === "string" && typeof row.label === "string" && row.label.trim()) {
      labels.set(row.$id, row.label.trim());
    }
  }
  return labels;
}

/** Programs for an athlete, or written by a coach, newest first. Templates are `{ coachId, athleteId: null }`. */
export async function readPrograms(
  source: ProgramSource,
  filter: { athleteId: string } | { coachId: string },
): Promise<Program[]> {
  const query =
    "athleteId" in filter ? Query.equal("athlete_id", filter.athleteId) : Query.equal("coach_id", filter.coachId);
  const rows = parseRows(await listAllFrom(source, "programs", [query]), parseProgram);
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * The athlete's current block, as the athlete may see it. Order 23.
 *
 * The draft rule is enforced here, in the read, and not left to the screen:
 * weeks are read first and only the published ones' days and lines are asked
 * for, so a draft week's rows never leave Appwrite for this caller, let alone
 * reach the cache. `visibleProgram` filters again on the way out, so a change
 * to the queries cannot quietly start leaking. Raw API access by the athlete
 * can still see their own drafts -- that is the permission model, see
 * docs/programs.md -- which is why this is a filter and not a promise.
 *
 * Reads only, through the athlete's own session. Null when no published
 * program with a published week exists. Throws when Appwrite cannot be
 * reached, so the caller can fall back to its cache.
 */
export async function readMyProgram(source: ProgramSource, athleteId: string): Promise<ProgramTree | null> {
  const programs = livePrograms(await readPrograms(source, { athleteId }), athleteId);
  for (const program of programs) {
    const byProgram = [Query.equal("program_id", program.id)];
    const [blocks, weeks] = await Promise.all([
      listAllFrom(source, "program_blocks", byProgram),
      listAllFrom(source, "program_weeks", byProgram),
    ]);
    const parsedWeeks = parseRows(weeks, parseWeek).filter((w) => w.status === "published");
    if (parsedWeeks.length === 0) continue;
    const byWeek = [Query.equal("week_id", parsedWeeks.map((w) => w.id))];
    const [days, prescriptions] = await Promise.all([
      listAllFrom(source, "program_days", byWeek),
      listAllFrom(source, "prescriptions", byWeek),
    ]);
    const tree = visibleProgram(program, {
      blocks: parseRows(blocks, parseBlock),
      weeks: parsedWeeks,
      days: parseRows(days, parseDay),
      prescriptions: parseRows(prescriptions, parsePrescriptionRow),
    });
    if (tree) return tree;
  }
  return null;
}
