"use client";

import { browserAppwrite } from "@/appwrite/browser-client";

/**
 * Asks the server to recompute one weekly rollup.
 *
 * `stats_rollups` is a server-only table -- no user session may write one -- so
 * the browser's part is to say which bucket changed and prove who is asking.
 * The athlete id is not sent: the route takes it from the JWT, because a
 * caller-supplied id would let anyone rewrite anybody's totals.
 */
export async function refreshRollup(exerciseId: string, loggedAt: string): Promise<void> {
  const { account } = browserAppwrite();
  const { jwt } = await account.createJWT();

  const response = await fetch("/api/rollup", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ exerciseId, loggedAt }),
  });

  if (!response.ok) {
    // Thrown so the queue classifies it: a 500 retries, a 400 is marked
    // permanent and stops blocking the sets behind it.
    const error = new Error(`rollup refresh failed: ${response.status}`) as Error & { code: number };
    error.code = response.status;
    throw error;
  }
}
