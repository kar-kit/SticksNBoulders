"use client";

import { Query, Teams } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import { circleTeamId } from "@/appwrite/documents/circle";
import type { CoachLinkRecord } from "./link-status";

/**
 * The coach's own link rows, active and revoked.
 *
 * A browser read, like `fetchCoachStatus`: both parties are stamped readable on
 * a link row and revoking re-stamps the same two roles, so a coach can always
 * see that a link existed and when it ended -- and nothing else about the
 * athlete once it has.
 *
 * Never cached. This read is what decides whether the Athlete View renders
 * somebody's training or says they left, and a cached page from before the
 * unlink would render the panels into a wall of permission failures.
 */
export async function fetchCoachLinks(coachId: string): Promise<CoachLinkRecord[]> {
  if (!coachId) return [];
  const { tables, databaseId } = browserAppwrite();
  const page = await tables.listRows({
    databaseId,
    tableId: "coach_athlete_links",
    queries: [
      Query.equal("coach_id", coachId),
      Query.limit(100),
      Query.select(["athlete_id", "status", "revoked_at", "linked_at"]),
    ],
    ttl: 0,
  });

  return page.rows.flatMap((row) => {
    const raw = row as unknown as { athlete_id?: unknown; status?: unknown; revoked_at?: unknown; linked_at?: unknown };
    const athleteId = typeof raw.athlete_id === "string" ? raw.athlete_id : "";
    if (!athleteId) return [];
    return [
      {
        athleteId,
        // Anything that is not explicitly active is treated as ended. A link
        // table is the one place where a guess must fall on the side of less
        // access, not more.
        status: raw.status === "active" ? "active" : "revoked",
        revokedAt: typeof raw.revoked_at === "string" ? raw.revoked_at : null,
        linkedAt: typeof raw.linked_at === "string" ? raw.linked_at : null,
      } satisfies CoachLinkRecord,
    ];
  });
}

/**
 * Link changes, live.
 *
 * Realtime only delivers rows the subscriber can read, and the coach can read
 * their own link rows, so an athlete unlinking reaches the coach's open Review
 * Queue within a second and their clips leave it -- along with any half-written
 * comment on them, which is the Build Plan's "drafts flush on revoke".
 */
export function subscribeToLinks(databaseId: string, onChange: () => void): () => void {
  const { client } = browserAppwrite();
  return client.subscribe(`databases.${databaseId}.tables.coach_athlete_links.rows`, () => onChange());
}

/**
 * Whether the coach is in the athlete's circle right now -- the access, as
 * opposed to the link row, which is only the record of it.
 *
 * Appwrite lets a member read their own team and nobody else read it at all,
 * so a successful get is exactly "can see this athlete's training". Any
 * failure reads as not visible: this gates whether panels render, and the safe
 * mistake is a notice, not a screen of false empties.
 */
export async function canSeeCircle(athleteId: string): Promise<boolean> {
  if (!athleteId) return false;
  const { client } = browserAppwrite();
  try {
    await new Teams(client).get({ teamId: circleTeamId(athleteId) });
    return true;
  } catch {
    return false;
  }
}
