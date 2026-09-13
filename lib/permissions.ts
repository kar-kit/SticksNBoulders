import { Permission, Query, Role } from "appwrite";
import { tablesDB } from "./appwrite";
import { DATABASE_ID, TABLES } from "./constants";
import type { CoachLink } from "./types";

/**
 * Full permission set for a WorkoutSession or WorkoutSet row: the athlete can
 * read/update/delete it, and any coach with an active link can read it -- set once at
 * row creation so no custom access-control code is needed to answer "can this coach
 * see this data?".
 */
export async function getAthleteDataPermissions(athleteUserId: string): Promise<string[]> {
  const links = await tablesDB.listRows<CoachLink>(DATABASE_ID, TABLES.coachLinks, [
    Query.equal("athleteUserId", athleteUserId),
    Query.equal("status", "active"),
  ]);

  return [
    Permission.read(Role.user(athleteUserId)),
    Permission.update(Role.user(athleteUserId)),
    Permission.delete(Role.user(athleteUserId)),
    ...links.rows.map((link) => Permission.read(Role.user(link.coachUserId))),
  ];
}

/** Coach edits, athlete reads: used for Programs and ProgramEntries rows. */
export function getProgramPermissions(coachUserId: string, athleteUserId: string): string[] {
  return [
    Permission.read(Role.user(coachUserId)),
    Permission.update(Role.user(coachUserId)),
    Permission.delete(Role.user(coachUserId)),
    Permission.read(Role.user(athleteUserId)),
  ];
}
