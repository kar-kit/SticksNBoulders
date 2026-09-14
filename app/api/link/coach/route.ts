import { Account, Client, Users } from "node-appwrite";
import { NextResponse } from "next/server";
import { serverAppwriteConfig } from "@/appwrite/env";
import { createServerClient } from "@/appwrite/server-client";
import { activeCoachFor, adminLinkTables } from "@/appwrite/documents/link-admin";

/**
 * The caller's own coach, named.
 *
 * The link row is readable by both parties, so the athlete can already see
 * that they have a coach and when. What they cannot see is who: Appwrite's
 * user directory is admin-only, and a coach's profile row is stamped for the
 * coach's circle, which the athlete is not in.
 *
 * So the name comes from here. The alternative was denormalising `coach_name`
 * onto the link row, which the write helper would happily do -- but a name
 * copied at link time is a name that is wrong the day a coach corrects their
 * own spelling, and this one appears on the screen where an athlete checks who
 * can see their training.
 *
 * Answers only about the caller's own active link. The athlete id comes from
 * the JWT, so this cannot be used to ask who coaches somebody else, and the
 * answer carries a name and never an email address.
 */

export const runtime = "nodejs";

export async function GET(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const jwt = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!jwt) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const config = serverAppwriteConfig();

  let athleteId: string;
  try {
    const asCaller = new Client()
      .setEndpoint(config.endpoint)
      .setProject(config.projectId)
      .setJWT(jwt);
    athleteId = (await new Account(asCaller).get()).$id;
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  try {
    const admin = createServerClient(config);
    const coach = await activeCoachFor(
      adminLinkTables(admin, new Users(admin)),
      config.databaseId,
      athleteId,
    );
    if (!coach) return NextResponse.json({ status: "none" });
    return NextResponse.json(
      { status: "linked", ...coach },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[link/coach] lookup failed", error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
