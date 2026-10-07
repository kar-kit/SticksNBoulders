import { Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";

/**
 * Role is a relationship, not an account type.
 *
 * Nothing grants coach access except a link. Someone can read an athlete's
 * training because that athlete is linked to them, which means the answer
 * changes the moment a link is created or revoked -- and it means a coach who
 * also lifts needs no second account.
 *
 * What does exist, since the first-run question, is a stored LANDING
 * preference: `snb_mode` in the account's prefs (lib/auth/mode.ts) says which
 * side to open on, and `snb_chose_coach` keeps the way into coach mode visible
 * for a coach with no athletes yet. Neither is read by any permission, any
 * query or the write helper; a user who sets their own mode to "coach" gets an
 * empty roster and an invite code, and nothing else. docs/onboarding.md.
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
