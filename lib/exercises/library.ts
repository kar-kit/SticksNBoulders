import { ID, Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import { browserWriteDeps } from "@/appwrite/documents/browser-writer";
import { createExercise, type Actor } from "@/appwrite/documents";
import { ensureMyCircle } from "@/lib/auth/circle";
import { findByName, type Exercise } from "./match";

/**
 * Loading the exercise library onto the device.
 *
 * The whole library, once, rather than a query per keystroke. Two reasons, and
 * the second is the one that settles it:
 *
 *   1. Ranking has to be instant. A round trip per character in a basement gym
 *      is the "slow" that made Ruairi leave RTS.
 *   2. Order 9 makes offline logging normal, not an error. An athlete picking
 *      an exercise with no signal must still get the list, so it has to be
 *      local regardless of how fast the network is.
 *
 * A consequence worth stating: `idx_name_search`, the fulltext index on `name`
 * in the schema, goes unused. It is left in place for a server-side search
 * later (the coach's Program Editor may outgrow this), but nothing queries it
 * today.
 *
 * Size is not a concern at this scale -- 54 seeded rows plus whatever an
 * athlete has typed. If the library ever reaches thousands, this is the
 * decision to revisit.
 */

const PAGE = 100;

interface ExerciseRow {
  $id: string;
  name?: unknown;
  normalised_name?: unknown;
  is_global?: unknown;
  owner_id?: unknown;
}

/** Skips a row rather than throwing: one malformed row must not empty the list. */
function toExercise(row: ExerciseRow): Exercise | null {
  if (typeof row.name !== "string" || !row.name) return null;
  if (typeof row.normalised_name !== "string") return null;
  return {
    id: row.$id,
    name: row.name,
    normalisedName: row.normalised_name,
    isGlobal: row.is_global === true,
    ownerId: typeof row.owner_id === "string" ? row.owner_id : null,
  };
}

/**
 * The shared library plus this athlete's own additions.
 *
 * Filtered explicitly rather than relying on what permissions happen to allow:
 * a coach can read their athletes' custom exercises, and those do not belong in
 * the coach's own logging typeahead.
 */
export async function fetchExerciseLibrary(userId: string): Promise<Exercise[]> {
  const { tables, databaseId } = browserAppwrite();
  const exercises: Exercise[] = [];
  let cursor: string | null = null;

  for (;;) {
    const queries = [
      Query.or([Query.equal("is_global", true), Query.equal("owner_id", userId)]),
      Query.orderAsc("$id"),
      Query.limit(PAGE),
    ];
    if (cursor) queries.push(Query.cursorAfter(cursor));

    const page = await tables.listRows({ databaseId, tableId: "exercises", queries });
    if (page.rows.length === 0) break;

    for (const row of page.rows) {
      const exercise = toExercise(row as unknown as ExerciseRow);
      if (exercise) exercises.push(exercise);
    }
    cursor = page.rows[page.rows.length - 1].$id;
  }

  return exercises;
}

export interface ResolvedExercise {
  exercise: Exercise;
  /** False when the typed name turned out to be something the library already had. */
  created: boolean;
}

/**
 * The exercise a typed name means, creating one only if it is genuinely new.
 *
 * `idx_normalised` is a key index, not a unique one, so Appwrite would happily
 * accept a second "Barbell Row". The first athlete to type one would get a
 * personal duplicate of a library row, and that lift's history would split in
 * two -- half against one id, half against the other. So the check happens here,
 * against the loaded library, before anything is written.
 */
export async function resolveOrCreateExercise(
  name: string,
  library: readonly Exercise[],
  actor: Actor,
): Promise<ResolvedExercise> {
  const existing = findByName(name, library);
  if (existing) return { exercise: existing, created: false };

  // A custom exercise is stamped with the athlete's circle too, so it needs the
  // same precondition a session start does.
  await ensureMyCircle();
  const row = await createExercise(browserWriteDeps(() => ID.unique()), actor, { name });
  const created = toExercise(row as unknown as ExerciseRow);
  if (!created) throw new Error(`Appwrite returned an unusable exercise row for "${name}"`);
  return { exercise: created, created: true };
}
