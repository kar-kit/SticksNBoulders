import { Account, Client, Teams } from "node-appwrite";
import { NextResponse } from "next/server";
import { serverAppwriteConfig } from "@/appwrite/env";
import { createServerClient } from "@/appwrite/server-client";
import { ensureCircle } from "@/appwrite/documents";

/**
 * Creates the athlete's circle team, server-side.
 *
 * Appwrite will not let a user session stamp a `team:` permission for a team
 * they are not a member of -- the write comes back 401, "Permissions must be
 * one of (any, users, user:<id>...)". Every row an athlete writes carries
 * a circle-team read, so until this team exists with them in it,
 * an athlete cannot log anything at all.
 *
 * It cannot be done from the browser. A user who creates a team owns it, and
 * could then add or remove members behind the app's back -- coach_athlete_links
 * and actual access would drift apart with nothing to reconcile them. That
 * reasoning is in appwrite/documents/circle-admin.ts and it is why this route
 * exists rather than a client call.
 *
 * The caller proves who they are with a short-lived Appwrite JWT. The user id
 * is taken from that token and never from the request body: accepting an id
 * from the caller would let anyone create, or join, anybody's circle.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const jwt = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!jwt) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const config = serverAppwriteConfig();

  let userId: string;
  let name: string;
  try {
    // Identified by the token alone. No API key on this client, so a forged or
    // expired JWT simply fails here.
    const asCaller = new Client()
      .setEndpoint(config.endpoint)
      .setProject(config.projectId)
      .setJWT(jwt);
    const user = await new Account(asCaller).get();
    userId = user.$id;
    name = user.name || user.email || "Athlete";
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  try {
    // Now with the admin key, because the team must not belong to the athlete.
    const teams = new Teams(createServerClient(config));
    const teamId = await ensureCircle(teams, userId, name);
    return NextResponse.json({ teamId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Logged rather than swallowed: silently failing here looks exactly like
    // working, right up until the athlete's first set is rejected.
    console.error("[circle] could not ensure circle", error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
