"use client";

import { browserAppwrite } from "@/appwrite/browser-client";

/**
 * Makes sure this athlete's circle team exists before they write anything.
 *
 * Appwrite refuses a `team:` permission from a user session unless that user is
 * in the team, and every row an athlete writes carries a read for their circle.
 * So this is not setup -- it is a precondition of the first write, and it
 * belongs next to the writes rather than in a component that might not be
 * mounted.
 *
 * Memoised per page load. It is idempotent server-side, but a session start and
 * an exercise created in the same breath should cost one request, not two.
 */
let pending: Promise<void> | null = null;

async function ensure(): Promise<void> {
  const { account } = browserAppwrite();
  // Short-lived, and the only thing that tells the server who is asking.
  const { jwt } = await account.createJWT();
  const response = await fetch("/api/circle", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!response.ok) throw new Error(`Could not prepare your account (${response.status})`);
}

export function ensureMyCircle(): Promise<void> {
  pending ??= ensure().catch((error) => {
    // A failure must not be cached, or one bad moment on a train blocks every
    // write for the rest of the page's life.
    pending = null;
    throw error;
  });
  return pending;
}

/** Test seam, and used when signing out so the next account starts clean. */
export function forgetCircle(): void {
  pending = null;
}
