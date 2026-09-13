import { ID, Query } from "appwrite";
import { tablesDB } from "./appwrite";
import { DATABASE_ID, TABLES } from "./constants";
import { getAthleteDataPermissions } from "./permissions";
import type { WorkoutSession } from "./types";

/** The user's currently-open session (endedAt not yet set), if any. */
export async function findOpenSession(userId: string): Promise<WorkoutSession | null> {
  const res = await tablesDB.listRows<WorkoutSession>(DATABASE_ID, TABLES.workoutSessions, [
    Query.equal("userId", userId),
    Query.isNull("endedAt"),
    Query.orderDesc("startedAt"),
    Query.limit(1),
  ]);
  return res.rows[0] ?? null;
}

export async function createSession(userId: string): Promise<WorkoutSession> {
  const permissions = await getAthleteDataPermissions(userId);
  return tablesDB.createRow<WorkoutSession>(
    DATABASE_ID,
    TABLES.workoutSessions,
    ID.unique(),
    { userId, startedAt: new Date().toISOString(), endedAt: null },
    permissions
  );
}

export async function findOrCreateOpenSession(userId: string): Promise<WorkoutSession> {
  const existing = await findOpenSession(userId);
  return existing ?? createSession(userId);
}

export async function endSession(sessionId: string): Promise<WorkoutSession> {
  return tablesDB.updateRow<WorkoutSession>(DATABASE_ID, TABLES.workoutSessions, sessionId, {
    endedAt: new Date().toISOString(),
  });
}
