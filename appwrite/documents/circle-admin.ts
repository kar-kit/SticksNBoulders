import { circleTeamId, CIRCLE_ROLES } from "./circle";

/**
 * Managing an athlete's circle.
 *
 * Server-side only, and deliberately so. A user can create a team from their
 * own session and would then own it -- able to add and remove members behind
 * the app's back, so `coach_athlete_links` and actual access would drift apart
 * with nothing to reconcile them. Keeping ownership on the server means the
 * one Function that writes a link is the same one that grants the membership,
 * and the two cannot disagree.
 */

export interface TeamAdmin {
  get(params: { teamId: string }): Promise<{ $id: string }>;
  create(params: { teamId: string; name: string; roles?: string[] }): Promise<{ $id: string }>;
  createMembership(params: {
    teamId: string;
    userId: string;
    roles: string[];
  }): Promise<{ $id: string }>;
  listMemberships(params: {
    teamId: string;
  }): Promise<{ memberships: Array<{ $id: string; userId: string; roles: string[] }> }>;
  deleteMembership(params: { teamId: string; membershipId: string }): Promise<unknown>;
}

/**
 * Idempotent. Called at onboarding, and safe to call again -- an athlete who
 * somehow has no circle has no coach-visible data, so repairing it silently is
 * better than failing.
 */
export async function ensureCircle(
  teams: TeamAdmin,
  athleteId: string,
  displayName: string,
): Promise<string> {
  const teamId = circleTeamId(athleteId);
  try {
    await teams.get({ teamId });
  } catch {
    await teams.create({ teamId, name: `${displayName} — circle` });
  }
  // The athlete's own membership is also repaired, not assumed.
  await addMember(teams, teamId, athleteId, CIRCLE_ROLES.athlete);
  return teamId;
}

async function addMember(teams: TeamAdmin, teamId: string, userId: string, role: string) {
  const { memberships } = await teams.listMemberships({ teamId });
  if (memberships.some((m) => m.userId === userId)) return;
  await teams.createMembership({ teamId, userId, roles: [role] });
}

/** Grants a coach retroactive read of everything the athlete has ever logged. */
export async function addCoachToCircle(teams: TeamAdmin, athleteId: string, coachId: string) {
  if (coachId === athleteId) {
    throw new Error("addCoachToCircle: an athlete cannot be their own coach");
  }
  await addMember(teams, circleTeamId(athleteId), coachId, CIRCLE_ROLES.coach);
}

/**
 * Revokes access to every row at once. The athlete's own membership is never
 * removed by this: revoking a coach must not be able to lock an athlete out of
 * their own training history.
 */
export async function removeCoachFromCircle(teams: TeamAdmin, athleteId: string, coachId: string) {
  if (coachId === athleteId) {
    throw new Error("removeCoachFromCircle: refusing to remove the athlete from their own circle");
  }
  const teamId = circleTeamId(athleteId);
  const { memberships } = await teams.listMemberships({ teamId });
  const membership = memberships.find((m) => m.userId === coachId);
  if (!membership) return;
  await teams.deleteMembership({ teamId, membershipId: membership.$id });
}

/** Who currently has access, for the audit script and the roster. */
export async function listCircleCoaches(teams: TeamAdmin, athleteId: string): Promise<string[]> {
  const { memberships } = await teams.listMemberships({ teamId: circleTeamId(athleteId) });
  return memberships.filter((m) => m.roles.includes(CIRCLE_ROLES.coach)).map((m) => m.userId);
}
