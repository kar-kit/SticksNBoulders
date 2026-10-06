import { Account, Client } from "node-appwrite";
import { NextResponse } from "next/server";
import { serverAppwriteConfig } from "@/appwrite/env";
import { createServerClient } from "@/appwrite/server-client";
import {
  adminSuggestionModeTables,
  setSuggestionMode,
} from "@/appwrite/documents/suggestion-mode-admin";

/**
 * Order 28: a coach switching one athlete's next-set load suggestions between
 * "direct" and "held".
 *
 * The caller is whoever the JWT says, never an id from the body. The body names
 * the athlete and the mode; whether this caller may set it for that athlete is
 * decided in suggestion-mode-admin.ts, against an ACTIVE row in
 * coach_athlete_links. The athlete themselves is refused: this is the coach's
 * switch over what the athlete's screen shows.
 *
 * Reads do not come through here. Both parties are already stamped readable on
 * the link row, so the coach's Athlete View and the athlete's logger read the
 * column straight from Appwrite -- which is what lets the logger cache it and
 * keep working with no signal.
 */

export const runtime = "nodejs";

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

async function callerFrom(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization") ?? "";
  const jwt = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!jwt) return null;

  const config = serverAppwriteConfig();
  try {
    const asCaller = new Client().setEndpoint(config.endpoint).setProject(config.projectId).setJWT(jwt);
    return (await new Account(asCaller).get()).$id;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const callerId = await callerFrom(request);
  if (!callerId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: { athleteId?: unknown; mode?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }
  const athleteId = str(body?.athleteId);
  if (!athleteId) return NextResponse.json({ error: "bad-request" }, { status: 400 });

  const config = serverAppwriteConfig();
  try {
    const result = await setSuggestionMode(
      adminSuggestionModeTables(createServerClient(config)),
      config.databaseId,
      callerId,
      { athleteId, mode: body.mode },
      { now: () => new Date() },
    );
    if (result.status === "not-allowed") {
      return NextResponse.json({ error: "not-allowed" }, { status: 403 });
    }
    if (result.status === "invalid") {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[link/suggestions] could not set", error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
