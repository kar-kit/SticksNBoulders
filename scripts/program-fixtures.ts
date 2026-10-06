/**
 * Shared by the program seed and the program e2e: find the sample block's
 * exercises, link a coach to an athlete, and write the block through the same
 * validated ops the editor will send.
 *
 * Everything here goes through appwrite/documents. Scripts are allowed to
 * write rows directly, but a seed that bypassed the helper would prove nothing
 * about the path the app actually uses.
 */
import { ID, Query, TablesDB, Teams, type Client } from "node-appwrite";
import {
  addCoachToCircle,
  createCoachLink,
  createGlobalExercise,
  ensureCircle,
  normaliseExerciseName,
  type WriteDeps,
} from "../appwrite/documents";
import { adminProgramTables, runProgramOp } from "../appwrite/documents/program-admin";
import {
  SAMPLE_EXERCISES,
  sampleProgram,
  writeOutline,
  type SampleExercise,
  type WrittenProgram,
} from "../lib/programming/sample-program";
import type { ProgramOpInput } from "../lib/programming/program";

export function adminDeps(client: Client, databaseId: string): WriteDeps {
  const db = new TablesDB(client);
  return {
    writer: {
      createRow: (params) => db.createRow(params),
      updateRow: (params) => db.updateRow(params),
      deleteRow: (params) => db.deleteRow(params),
    },
    databaseId,
    newId: () => ID.unique(),
    now: () => new Date(),
  };
}

/**
 * The sample block's exercises, from the shared library.
 *
 * Found by normalised name. A missing one is created as a GLOBAL row, the way
 * e2e-dots does, because the athlete must be able to read its name -- a
 * coach-owned custom exercise is not readable by the athlete. `created` lists
 * what this run made, so a caller that cleans up removes only its own rows.
 */
export async function sampleExerciseIds(
  client: Client,
  databaseId: string,
): Promise<{ ids: Record<SampleExercise, string>; created: string[] }> {
  const db = new TablesDB(client);
  const deps = adminDeps(client, databaseId);
  const ids = {} as Record<SampleExercise, string>;
  const created: string[] = [];
  for (const name of SAMPLE_EXERCISES) {
    const found = await db.listRows({
      databaseId,
      tableId: "exercises",
      queries: [
        Query.equal("normalised_name", normaliseExerciseName(name)),
        Query.equal("is_global", true),
        Query.limit(1),
      ],
    });
    if (found.rows.length > 0) {
      ids[name] = found.rows[0].$id;
      continue;
    }
    const row = await createGlobalExercise(deps, { name });
    ids[name] = row.$id;
    created.push(row.$id);
  }
  return { ids, created };
}

/**
 * Links a coach to an athlete the way redemption does: the link row, then the
 * circle membership that makes Appwrite honour it. Idempotent.
 */
export async function linkPair(
  client: Client,
  databaseId: string,
  pair: { coachId: string; coachName: string; athleteId: string; athleteName: string },
): Promise<{ linkId: string | null }> {
  const db = new TablesDB(client);
  const teams = new Teams(client);
  await ensureCircle(teams, pair.athleteId, pair.athleteName);
  await ensureCircle(teams, pair.coachId, pair.coachName);
  await addCoachToCircle(teams, pair.athleteId, pair.coachId);

  const existing = await db.listRows({
    databaseId,
    tableId: "coach_athlete_links",
    queries: [Query.equal("coach_id", pair.coachId), Query.equal("athlete_id", pair.athleteId), Query.limit(1)],
  });
  if (existing.rows.length > 0) return { linkId: null };
  const row = await createCoachLink(adminDeps(client, databaseId), {
    coachId: pair.coachId,
    athleteId: pair.athleteId,
  });
  return { linkId: row.$id };
}

/** One program op, as the coach, through the repository's checks. Throws on refusal. */
export function opRunner(client: Client, databaseId: string, coachId: string) {
  const tables = adminProgramTables(client);
  return async (op: ProgramOpInput): Promise<string> => {
    const result = await runProgramOp(tables, databaseId, coachId, op, {
      newId: () => ID.unique(),
      now: () => new Date(),
    });
    if (result.status !== "ok") throw new Error(`${op.op} refused: ${JSON.stringify(result)}`);
    return result.rowId;
  };
}

export async function seedSampleProgram(
  client: Client,
  databaseId: string,
  coachId: string,
  athleteId: string | null,
  startOn: string,
  exerciseIds: Record<SampleExercise, string>,
): Promise<WrittenProgram> {
  return writeOutline(opRunner(client, databaseId, coachId), athleteId, sampleProgram(startOn), exerciseIds);
}
