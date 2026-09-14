"use client";

import { Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";

/**
 * Reading and minting a coach's own invite code.
 *
 * The read runs in the browser: the row is stamped readable by the coach and
 * by nobody else, so a plain query is both correct and one round trip shorter
 * than asking our own server to fetch it. The mint cannot -- `invite_codes` is
 * a server-only table, and a code whose coach_id the browser chose is a code
 * that could name somebody else.
 */

/** The code, or null for a coach who has never asked for one. */
export async function fetchMyInviteCode(coachId: string): Promise<string | null> {
  const { tables, databaseId } = browserAppwrite();
  const page = await tables.listRows({
    databaseId,
    tableId: "invite_codes",
    // The code IS the row id, so nothing needs selecting: $id is the answer.
    queries: [Query.equal("coach_id", coachId), Query.limit(1)],
  });
  const id = page.rows[0]?.$id;
  return typeof id === "string" ? id : null;
}

/** Asks the server for a code, and returns the one the coach already had. */
export async function mintInviteCode(): Promise<string> {
  const { account } = browserAppwrite();
  const { jwt } = await account.createJWT();

  const response = await fetch("/api/invite", {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}` },
  });
  if (!response.ok) throw new Error(`invite mint failed: ${response.status}`);

  const body = (await response.json()) as { code?: unknown };
  if (typeof body.code !== "string") throw new Error("invite mint returned no code");
  return body.code;
}
