import { Account, Client } from "node-appwrite";
import { NextResponse } from "next/server";
import { serverAppwriteConfig } from "@/appwrite/env";
import { clipUrl, mintTicket, ticketSecret, TICKET_TTL_MS } from "@/lib/video/ticket";

/**
 * Mints playback URLs for clips.
 *
 * Takes a batch, because the Review Queue shows a list and the coach will play
 * the next clip within seconds of the current one. One round trip for the
 * visible queue beats one per clip on a screen the blueprint measures by time
 * to clear.
 *
 * It checks that the caller is signed in and nothing else. That is not an
 * omission: a ticket carries identity rather than authority, so a ticket for a
 * clip the caller cannot read is a ticket that fetches a 404. Putting an
 * access check here as well would be a second implementation of a decision
 * Appwrite already makes correctly, and a second place for it to rot.
 */

export const runtime = "nodejs";

/** A coach clearing a queue, not a script enumerating a bucket. */
const MAX_FILES = 60;

export async function POST(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const jwt = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!jwt) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: { fileIds?: unknown };
  try {
    body = (await request.json()) as { fileIds?: unknown };
  } catch {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }

  const fileIds = Array.isArray(body.fileIds)
    ? body.fileIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  if (fileIds.length === 0 || fileIds.length > MAX_FILES) {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }

  const config = serverAppwriteConfig();

  let userId: string;
  try {
    // No API key on this client, so a forged or expired JWT simply fails here.
    const asCaller = new Client()
      .setEndpoint(config.endpoint)
      .setProject(config.projectId)
      .setJWT(jwt);
    userId = (await new Account(asCaller).get()).$id;
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const secret = ticketSecret();
  const expiresAt = Date.now() + TICKET_TTL_MS;
  const urls: Record<string, string> = {};
  for (const fileId of fileIds) {
    urls[fileId] = clipUrl(fileId, mintTicket({ fileId, userId, expiresAt }, secret));
  }

  return NextResponse.json(
    { urls, expiresAt },
    // Never cached anywhere. These are per-user, short-lived credentials.
    { headers: { "Cache-Control": "no-store, private" } },
  );
}
