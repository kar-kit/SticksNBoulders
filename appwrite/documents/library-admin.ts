import type { TeamAdmin } from "./circle-admin";
import { LIBRARY_TEAM_ID } from "./policy";

/**
 * The library team: the server's mark on a shared exercise.
 *
 * It exists so that nobody else can create it. A user may create a team from
 * their own session and would then own it -- and hold its `team:` role, which
 * is exactly the role `writtenByServer()` treats as proof that the server
 * wrote a row. Created here with the API key, with no members, it is a role
 * nobody can ever hold, and a stamp nobody but the server can make.
 *
 * Idempotent. `appwrite:setup` calls it after applying the schema, and the
 * audit asserts the team exists with zero members.
 */
export async function ensureLibraryTeam(teams: TeamAdmin): Promise<string> {
  try {
    await teams.get({ teamId: LIBRARY_TEAM_ID });
  } catch {
    await teams.create({ teamId: LIBRARY_TEAM_ID, name: "Exercise library (server mark, no members)" });
  }
  return LIBRARY_TEAM_ID;
}

/** Anyone in the library team could stamp the server's mark. There must be nobody. */
export async function libraryTeamMembers(teams: TeamAdmin): Promise<string[]> {
  const { memberships } = await teams.listMemberships({ teamId: LIBRARY_TEAM_ID });
  return memberships.map((m) => m.userId);
}
