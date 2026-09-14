import { Query, TablesDB, Teams, type Client } from "node-appwrite";
import { decideRedemption, decideUnlink, type ExistingLink, type Redemption } from "@/lib/coach/link";
import {
  addCoachToCircle,
  ensureCircle,
  listCircleCoaches,
  removeCoachFromCircle,
} from "./circle-admin";
import { createCoachLink, reactivateCoachLink, revokeCoachLink } from "./write";
import type { RowWriter } from "./row-writer";

/**
 * Redeeming an invite code, server-side.
 *
 * This is the write that decides who can read an athlete's training, so it is
 * the most dangerous code path in the product. Three rules shape it:
 *
 *   1. The athlete id comes from the caller's JWT, never from a request body.
 *      The route enforces that; this module simply never invents one.
 *   2. The decision is made in lib/coach/link.ts, which is pure and tested
 *      exhaustively. This file only carries it out.
 *   3. The link row is written BEFORE the circle membership. A failure between
 *      the two leaves a coach recorded but not yet able to see anything, which
 *      is recoverable and visible. The reverse -- access with no record of why
 *      -- is the one outcome that must never happen.
 *
 * Deliberately NOT re-exported from ./index: it constructs node-appwrite, and
 * the barrel is imported by client code. The route imports it by path.
 */

export interface LinkTables {
  getRow(params: { databaseId: string; tableId: string; rowId: string }): Promise<{ $id: string } & Record<string, unknown>>;
  listRows(params: {
    databaseId: string;
    tableId: string;
    queries: string[];
    ttl?: number;
  }): Promise<{ rows: Array<Record<string, unknown>> }>;
  writer: RowWriter;
  teams: Parameters<typeof addCoachToCircle>[0];
  userName(userId: string): Promise<string>;
}

export function adminLinkTables(client: Client, users: { get(params: { userId: string }): Promise<{ name?: string; email?: string }> }): LinkTables {
  const db = new TablesDB(client);
  return {
    getRow: (params) => db.getRow(params) as unknown as Promise<{ $id: string } & Record<string, unknown>>,
    listRows: (params) => db.listRows(params) as unknown as Promise<{ rows: Array<Record<string, unknown>> }>,
    writer: {
      createRow: (params) => db.createRow(params),
      updateRow: (params) => db.updateRow(params),
      deleteRow: (params) => db.deleteRow(params),
    },
    teams: new Teams(client),
    async userName(userId) {
      const user = await users.get({ userId });
      // The name and nothing else. Falling back to the email would put a
      // coach's address on an athlete's screen -- on the one screen whose job
      // is to say exactly what linking shares, having promised nothing of the
      // sort. An unnamed coach degrades to "Your coach" in lib/coach/link.ts.
      return (user.name ?? "").trim();
    },
  };
}

/** Who a code belongs to, without writing anything. */
export async function resolveInviteCode(
  tables: LinkTables,
  databaseId: string,
  code: string,
): Promise<{ coachId: string; coachName: string } | null> {
  let row: ({ $id: string } & Record<string, unknown>) | null = null;
  try {
    // A point read, because the code IS the row id. See docs/invite-codes.md.
    row = await tables.getRow({ databaseId, tableId: "invite_codes", rowId: code });
  } catch {
    return null;
  }
  const coachId = typeof row?.coach_id === "string" ? row.coach_id : "";
  if (!coachId) return null;
  return { coachId, coachName: await tables.userName(coachId).catch(() => "") };
}

export interface ActiveCoach {
  coachId: string;
  coachName: string;
  linkedAt: string | null;
}

/**
 * The athlete's current coach, named. Read-only.
 *
 * Here rather than in the route because constructing TablesDB outside
 * appwrite/documents is what the guard test and the lint rule forbid -- the
 * point being that every path touching these rows stays in one reviewable
 * place, reads included.
 */
export async function activeCoachFor(
  tables: LinkTables,
  databaseId: string,
  athleteId: string,
): Promise<ActiveCoach | null> {
  const active = (await linksFor(tables, databaseId, athleteId)).find((l) => l.status === "active");
  if (!active) return null;
  const row = await tables
    .getRow({ databaseId, tableId: "coach_athlete_links", rowId: active.rowId })
    .catch(() => null);
  return {
    coachId: active.coachId,
    coachName: await tables.userName(active.coachId).catch(() => ""),
    linkedAt: typeof row?.linked_at === "string" ? row.linked_at : null,
  };
}

export type RedeemResult =
  | { status: "linked"; coachId: string; coachName: string; reactivated: boolean }
  /** Already linked to this coach. Redeeming again is a no-op, not an error. */
  | { status: "already-linked"; coachId: string; coachName: string }
  | { status: "unknown-code" }
  | { status: "self" }
  | { status: "other-coach"; coachId: string; coachName: string }
  /**
   * The row landed and the circle membership did not. Reported rather than
   * dressed up as success: the athlete is linked but the coach sees nothing,
   * and only saying so gets anybody to retry.
   */
  | { status: "linked-not-visible"; coachId: string; coachName: string };

export async function redeemInviteCode(
  tables: LinkTables,
  databaseId: string,
  athleteId: string,
  code: string,
  now: () => Date = () => new Date(),
): Promise<RedeemResult> {
  if (!athleteId) throw new Error("redeemInviteCode: athleteId is required");

  const resolved = await resolveInviteCode(tables, databaseId, code);
  if (!resolved) return { status: "unknown-code" };

  const existing = await linksFor(tables, databaseId, athleteId);
  const decision = decideRedemption(athleteId, resolved.coachId, existing);

  if (decision.kind === "self") return { status: "self" };

  if (decision.kind === "other-coach") {
    return {
      status: "other-coach",
      coachId: decision.coachId,
      coachName: await tables.userName(decision.coachId).catch(() => ""),
    };
  }

  if (decision.kind === "already-linked") {
    // Repaired, not assumed. A link recorded without its membership is exactly
    // the state a half-failed redemption leaves behind, and redeeming the same
    // code again is the most likely way anybody notices.
    await ensureVisible(tables, athleteId, decision.coachId);
    return { status: "already-linked", coachId: resolved.coachId, coachName: resolved.coachName };
  }

  const deps = { writer: tables.writer, databaseId, newId: () => crypto.randomUUID(), now };
  const parties = { coachId: resolved.coachId, athleteId };

  if (decision.kind === "reactivate") {
    await reactivateCoachLink(deps, { ...parties, rowId: decision.rowId });
  } else {
    await createCoachLink(deps, parties);
  }

  // Only now. The row is the record; the membership is the access.
  try {
    // The circle is created lazily, by the first write the offline queue
    // flushes -- so an athlete who redeems a code before logging anything has
    // no circle at all, and that is the onboarding path the blueprint asks for
    // ("Got a code from your coach?" comes before any training exists). Adding
    // a coach to a team that does not exist throws team_not_found, and the
    // coach silently sees nothing. ensureCircle is idempotent; this costs one
    // lookup and removes the whole failure.
    await ensureCircle(tables.teams, athleteId, await athleteName(tables, athleteId));
    await addCoachToCircle(tables.teams, athleteId, resolved.coachId);
  } catch {
    return { status: "linked-not-visible", coachId: resolved.coachId, coachName: resolved.coachName };
  }

  return {
    status: "linked",
    coachId: resolved.coachId,
    coachName: resolved.coachName,
    reactivated: decision.kind === "reactivate",
  };
}

export type UnlinkResult =
  | { status: "unlinked"; coachId: string }
  /** Nothing to withdraw. A success: two devices, two taps. */
  | { status: "not-linked" }
  /**
   * The membership could not be removed, so nothing was written and the link
   * still stands. Reported rather than dressed up: the alternative is a record
   * saying revoked while the coach can still read everything.
   */
  | { status: "still-visible"; coachId: string };

/**
 * Withdraws a coach's access.
 *
 * The exact inverse of redeeming, and the ordering is the point. Linking
 * writes the record first and grants access second; unlinking removes access
 * first and writes the record second. Both orders serve one invariant: there is
 * never access without a record of why.
 *
 * So a failure here leaves the link recorded and active while the coach may
 * already have lost access -- the same safe direction as a half-finished link,
 * and repaired by unlinking again.
 */
export async function revokeCoachAccess(
  tables: LinkTables,
  databaseId: string,
  athleteId: string,
  now: () => Date = () => new Date(),
): Promise<UnlinkResult> {
  if (!athleteId) throw new Error("revokeCoachAccess: athleteId is required");

  const decision = decideUnlink(athleteId, await linksFor(tables, databaseId, athleteId));
  if (decision.kind === "not-linked") return { status: "not-linked" };

  try {
    await removeCoachFromCircle(tables.teams, athleteId, decision.coachId);
    // Re-read rather than trusting the call. removeCoachFromCircle returns
    // silently when the membership was not there, so "removed" and "never
    // present" look identical from here -- and on this path, being wrong means
    // a coach reading somebody's training while the record says they cannot.
    const remaining = await listCircleCoaches(tables.teams, athleteId);
    if (remaining.includes(decision.coachId)) {
      return { status: "still-visible", coachId: decision.coachId };
    }
  } catch {
    return { status: "still-visible", coachId: decision.coachId };
  }

  // Only now, and revoked rather than deleted: the row is the record of who
  // could once see what, and the unique index on the pair means re-linking
  // later has to reuse it anyway.
  await revokeCoachLink(
    { writer: tables.writer, databaseId, newId: () => crypto.randomUUID(), now },
    { rowId: decision.rowId, coachId: decision.coachId, athleteId },
  );
  return { status: "unlinked", coachId: decision.coachId };
}

/** Adds the membership only if it is genuinely missing. */
async function ensureVisible(tables: LinkTables, athleteId: string, coachId: string): Promise<void> {
  const coaches = await listCircleCoaches(tables.teams, athleteId).catch(() => null);
  if (coaches?.includes(coachId)) return;
  // null means the circle could not be read at all, which for a link that is
  // already recorded most likely means it was never created. Repairing it is
  // the point of redeeming a code you have already used.
  await ensureCircle(tables.teams, athleteId, await athleteName(tables, athleteId)).catch(() => {});
  await addCoachToCircle(tables.teams, athleteId, coachId).catch(() => {});
}

/** Only ever the team's display name, so an unnamed athlete still gets one. */
async function athleteName(tables: LinkTables, athleteId: string): Promise<string> {
  return (await tables.userName(athleteId).catch(() => "")) || "Athlete";
}

async function linksFor(
  tables: LinkTables,
  databaseId: string,
  athleteId: string,
): Promise<ExistingLink[]> {
  const page = await tables.listRows({
    databaseId,
    tableId: "coach_athlete_links",
    queries: [Query.equal("athlete_id", athleteId), Query.limit(50)],
    // Never cached: a link written a moment ago decides whether this one is a
    // second coach, and a stale page would grant one.
    ttl: 0,
  });
  return page.rows.flatMap((row) => {
    const coachId = typeof row.coach_id === "string" ? row.coach_id : "";
    const status = row.status === "revoked" ? "revoked" : "active";
    const rowId = typeof row.$id === "string" ? row.$id : "";
    return coachId && rowId ? [{ rowId, coachId, status } satisfies ExistingLink] : [];
  });
}

export type { Redemption };
