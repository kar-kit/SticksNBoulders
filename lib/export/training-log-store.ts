import { Query } from "appwrite";
import { z } from "zod";
import { chunk, fetchAllPages } from "./paginate";
import type { ExportSession, ExportSet } from "./training-log";

/**
 * Reading one athlete's whole log for export.
 *
 * Permissions are Appwrite's, not ours. Every read here runs as the signed-in
 * user, and sets and sessions carry row-level read for the athlete and their
 * circle team only (appwrite/documents/policy.ts). So an athlete gets their own
 * rows, a linked coach gets that athlete's rows, and anyone else -- including a
 * coach whose link was revoked, who has left the circle -- gets an empty list
 * from the server. Filtering on athlete_id narrows the query; it is not what
 * keeps the data private, and nothing here could widen what a user can see.
 *
 * Takes the reader as an argument so the e2e script can run the exact same
 * code as a coach, an athlete and a stranger against the live instance.
 */

export interface RowReader {
  listRows(params: {
    databaseId: string;
    tableId: string;
    queries?: string[];
    total?: boolean;
    ttl?: number;
  }): Promise<{ rows: Array<{ $id: string }> }>;
}

/** Rows per round trip. Appwrite's documented ceiling is well above this. */
const PAGE = 500;
/** Ids per IN query. Each id is 36 chars and a query string caps at 4096. */
const IDS_PER_QUERY = 100;

const SET_COLUMNS = [
  "session_id",
  "exercise_id",
  "set_index",
  "load_kg",
  "reps",
  "rpe",
  "is_warmup",
  "e1rm_kg",
  "logged_at",
  "notes",
];
const SESSION_COLUMNS = ["started_at", "notes"];

const date = z
  .string()
  .transform((value) => new Date(value))
  .refine((value) => !Number.isNaN(value.getTime()));
const optionalNumber = z.number().finite().nullish().transform((value) => value ?? null);
const optionalText = z
  .string()
  .nullish()
  .transform((value) => (value ? value : null));

const SessionRow = z.object({
  $id: z.string().min(1),
  started_at: date,
  notes: optionalText,
});

const SetRow = z.object({
  $id: z.string().min(1),
  session_id: z.string().min(1),
  exercise_id: z.string().min(1),
  set_index: z.number().int(),
  load_kg: z.number().finite(),
  reps: z.number().int(),
  rpe: optionalNumber,
  is_warmup: z.boolean().nullish().transform((value) => value === true),
  e1rm_kg: optionalNumber,
  logged_at: date,
  notes: optionalText,
});

export interface TrainingLog {
  sessions: ExportSession[];
  sets: ExportSet[];
  exerciseNames: Map<string, string>;
  /** Rows Appwrite returned that did not parse. Reported, never silently lost. */
  skipped: number;
}

/**
 * Every session and set of one athlete, plus the names of the exercises used.
 *
 * Sessions and sets are paged in parallel. Ordered by $id for the cursor --
 * the export sorts in memory anyway, and $id is the one order guaranteed
 * unique, so a page boundary can never fall between two equal timestamps.
 * ttl 0 because an export that serves a cached page is an export missing
 * yesterday's session.
 */
export async function fetchTrainingLog(
  reader: RowReader,
  databaseId: string,
  athleteId: string,
): Promise<TrainingLog> {
  const pageOf = (tableId: string, columns: string[]) => (cursor: string | null, limit: number) =>
    reader.listRows({
      databaseId,
      tableId,
      queries: [
        Query.equal("athlete_id", athleteId),
        Query.select(columns),
        Query.orderAsc("$id"),
        Query.limit(limit),
        ...(cursor ? [Query.cursorAfter(cursor)] : []),
      ],
      total: false,
      ttl: 0,
    });

  const [sessionRows, setRows] = await Promise.all([
    fetchAllPages(pageOf("sessions", SESSION_COLUMNS), { pageSize: PAGE }),
    fetchAllPages(pageOf("sets", SET_COLUMNS), { pageSize: PAGE }),
  ]);

  let skipped = 0;
  const sessions: ExportSession[] = [];
  for (const raw of sessionRows) {
    const parsed = SessionRow.safeParse(raw);
    if (!parsed.success) {
      skipped++;
      continue;
    }
    sessions.push({ id: parsed.data.$id, startedAt: parsed.data.started_at, notes: parsed.data.notes });
  }

  const sets: ExportSet[] = [];
  for (const raw of setRows) {
    const parsed = SetRow.safeParse(raw);
    if (!parsed.success) {
      skipped++;
      continue;
    }
    const row = parsed.data;
    sets.push({
      id: row.$id,
      sessionId: row.session_id,
      exerciseId: row.exercise_id,
      setIndex: row.set_index,
      loadKg: row.load_kg,
      reps: row.reps,
      rpe: row.rpe,
      isWarmup: row.is_warmup,
      e1rmKg: row.e1rm_kg,
      loggedAt: row.logged_at,
      notes: row.notes,
    });
  }

  const exerciseNames = await fetchExerciseNames(
    reader,
    databaseId,
    sets.map((set) => set.exerciseId),
  );
  return { sessions, sets, exerciseNames, skipped };
}

/**
 * Names for exactly the exercises the log mentions.
 *
 * By id rather than by loading "the athlete's library", because the library
 * query is global rows plus rows this person owns -- and a set can reference
 * an exercise that is neither, such as one a coach created. Asking by id gets
 * every name the reader is allowed to see, whoever wrote it.
 */
export async function fetchExerciseNames(
  reader: RowReader,
  databaseId: string,
  exerciseIds: readonly string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(exerciseIds.filter(Boolean))];

  const pages = await Promise.all(
    chunk(unique, IDS_PER_QUERY).map((ids) =>
      reader.listRows({
        databaseId,
        tableId: "exercises",
        queries: [Query.equal("$id", ids), Query.select(["name"]), Query.limit(ids.length)],
        total: false,
        ttl: 0,
      }),
    ),
  );
  for (const page of pages) {
    for (const row of page.rows) {
      const name = (row as { name?: unknown }).name;
      if (typeof name === "string" && name) names.set(row.$id, name);
    }
  }
  return names;
}
