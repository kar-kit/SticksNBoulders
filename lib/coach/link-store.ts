"use client";

import { browserAppwrite } from "@/appwrite/browser-client";

/**
 * The athlete's side of the coach link.
 *
 * The read runs in the browser: both parties are stamped readable on the link
 * row, so an athlete can see their own. The writes cannot -- coach_athlete_links
 * is a server-only table, and a link an athlete could write is a coach they
 * could invent, or worse, a coach they could invent for somebody else.
 */

export interface MyCoach {
  coachId: string;
  coachName: string;
  linkedAt: Date | null;
}

/**
 * The active link, or null for an athlete training solo.
 *
 * Through the server rather than a browser query, because the coach's *name*
 * is admin-only in Appwrite -- see app/api/link/coach/route.ts. The row itself
 * the athlete could read; the person it points at they could not.
 */
export async function fetchMyCoach(): Promise<MyCoach | null> {
  const { account } = browserAppwrite();
  const { jwt } = await account.createJWT();

  const response = await fetch("/api/link/coach", {
    headers: { authorization: `Bearer ${jwt}` },
  });
  if (!response.ok) throw new Error(`coach lookup failed: ${response.status}`);

  const body = (await response.json()) as {
    status?: string;
    coachId?: string;
    coachName?: string;
    linkedAt?: string | null;
  };
  if (body.status !== "linked" || !body.coachId) return null;
  const linkedAt = body.linkedAt ? new Date(body.linkedAt) : null;
  return {
    coachId: body.coachId,
    coachName: body.coachName ?? "",
    linkedAt: linkedAt && !Number.isNaN(linkedAt.getTime()) ? linkedAt : null,
  };
}

export type ResolvedCode =
  | { status: "found"; coachId: string; coachName: string }
  | { status: "unknown-code" }
  | { status: "self" };

export type RedeemOutcome =
  | { status: "linked"; coachId: string; coachName: string; reactivated: boolean }
  | { status: "already-linked"; coachId: string; coachName: string }
  | { status: "linked-not-visible"; coachId: string; coachName: string }
  | { status: "other-coach"; coachId: string; coachName: string }
  | { status: "unknown-code" }
  | { status: "self" };

async function post<T>(path: string, code: string): Promise<T> {
  const { account } = browserAppwrite();
  const { jwt } = await account.createJWT();

  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ code }),
  });
  if (!response.ok) {
    const error = new Error(`${path} failed: ${response.status}`) as Error & { code: number };
    error.code = response.status;
    throw error;
  }
  return (await response.json()) as T;
}

/** Names the coach a code belongs to. Writes nothing. */
export const resolveCode = (code: string) => post<ResolvedCode>("/api/link/resolve", code);

/** Links them. Only ever called after the athlete has seen the coach's name. */
export const redeemCode = (code: string) => post<RedeemOutcome>("/api/link", code);
