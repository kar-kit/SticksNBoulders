import { Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";

/**
 * Role is a relationship, not an account type.
 *
 * There is no "coach" flag on a profile and there never will be. Someone is a
 * coach because athletes are linked to them, which means the answer changes the
 * moment a link is created or revoked -- and it means a coach who also lifts
 * needs no second account.
 */

export interface CoachStatus {
  isCoach: boolean;
  athleteIds: string[];
}

export const NOT_A_COACH: CoachStatus = { isCoach: false, athleteIds: [] };

/**
 * Reads `coach_athlete_links`. Both parties can read their own links, so this
 * needs no elevated access -- an athlete simply sees no rows where they are the
 * coach.
 */
export async function fetchCoachStatus(userId: string): Promise<CoachStatus> {
  const { tables, databaseId } = browserAppwrite();
  const rows = await tables.listRows({
    databaseId,
    tableId: "coach_athlete_links",
    queries: [
      Query.equal("coach_id", userId),
      Query.equal("status", "active"),
      Query.limit(100),
      Query.select(["athlete_id"]),
    ],
  });

  const athleteIds = rows.rows
    .map((row) => (row as unknown as { athlete_id?: string }).athlete_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  return { isCoach: athleteIds.length > 0, athleteIds };
}

/** Two initials at most, for the header avatar. */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** "Joey Pang" in the coach's rail is "Joey P" -- surnames waste the width. */
export function railName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}`;
}
