/**
 * An athlete's circle: the Appwrite Team holding the athlete and whoever
 * coaches them.
 *
 * Appwrite freezes a row's permissions at write time. Stamping coach user IDs
 * would mean a coach linked in November cannot see a set logged in October,
 * and fixing that needs a backfill over every row the athlete ever wrote --
 * a job that silently half-fails and leaves gaps nobody notices.
 *
 * A team is stamped once and stays correct. Linking a coach is one membership
 * write, it applies retroactively to every existing row, and revoking is the
 * same operation in reverse. `coach_athlete_links` remains the source of truth
 * for who coaches whom; the team is how that fact reaches Appwrite.
 */

/** Appwrite IDs allow a-z A-Z 0-9 . - _ up to 36 chars, no leading special. */
const CIRCLE_PREFIX = "circle_";

export function circleTeamId(athleteId: string): string {
  if (!athleteId) throw new Error("circleTeamId: athleteId is required");
  const id = `${CIRCLE_PREFIX}${athleteId}`;
  if (id.length > 36) {
    throw new Error(`circleTeamId: "${id}" exceeds Appwrite's 36-character limit`);
  }
  return id;
}

export function isCircleTeamId(teamId: string): boolean {
  return teamId.startsWith(CIRCLE_PREFIX);
}

export function athleteIdFromCircle(teamId: string): string {
  if (!isCircleTeamId(teamId)) throw new Error(`Not a circle team: ${teamId}`);
  return teamId.slice(CIRCLE_PREFIX.length);
}

/** Roles inside a circle. The athlete owns it; coaches only ever read. */
export const CIRCLE_ROLES = { athlete: "athlete", coach: "coach" } as const;
