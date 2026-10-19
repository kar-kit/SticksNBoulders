import { Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import { authenticRows } from "@/appwrite/documents";

/**
 * What still points at one of the athlete's own exercises.
 *
 * Read-only, and separate from the queue writes in my-exercises-store.ts so
 * the queue's runner can ask it at the last moment before a delete without
 * importing the queue back into itself.
 */

export interface ExerciseUsage {
  /** Sets this athlete logged against it. */
  sets: boolean;
  /** Reference maxes recorded against it, by the athlete or their coach. */
  referenceMaxes: boolean;
  /** Program lines the coach wrote for this athlete that use it, as the lift or as the max a percentage reads. */
  prescriptions: boolean;
}

export const isInUse = (usage: ExerciseUsage): boolean =>
  usage.sets || usage.referenceMaxes || usage.prescriptions;

async function any(tableId: string, queries: string[], provenanceChecked: boolean): Promise<boolean> {
  const { tables, databaseId } = browserAppwrite();
  const page = await tables.listRows({ databaseId, tableId, queries: [...queries, Query.limit(25)] });
  // Sets carry their author's proof; a forged one naming this exercise must
  // not be able to pin it in the library. Reference maxes and program lines
  // are written only by the server, so a row's existence is the proof.
  return (provenanceChecked ? authenticRows(tableId, page.rows) : page.rows).length > 0;
}

/**
 * One small read per kind of reference, in parallel.
 *
 * Program lines are only those the athlete can read -- ones written for them.
 * A coach's template that borrowed the exercise is invisible here; deleting
 * the exercise leaves that template showing an id, which is the coach's to
 * fix and cannot touch anything the athlete logged.
 */
export async function fetchExerciseUsage(athleteId: string, exerciseId: string): Promise<ExerciseUsage> {
  const mine = Query.equal("athlete_id", athleteId);
  const [sets, referenceMaxes, asLift, asReference] = await Promise.all([
    any("sets", [mine, Query.equal("exercise_id", exerciseId)], true),
    any("reference_maxes", [mine, Query.equal("exercise_id", exerciseId)], false),
    any("prescriptions", [mine, Query.equal("exercise_id", exerciseId)], false),
    any("prescriptions", [mine, Query.equal("reference_exercise_id", exerciseId)], false),
  ]);
  return { sets, referenceMaxes, prescriptions: asLift || asReference };
}

/** The exercise delete's guard. */
export async function exerciseInUse(athleteId: string, exerciseId: string): Promise<boolean> {
  return isInUse(await fetchExerciseUsage(athleteId, exerciseId));
}
