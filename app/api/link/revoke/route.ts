import { Account, Client, Users } from "node-appwrite";
import { NextResponse } from "next/server";
import { serverAppwriteConfig } from "@/appwrite/env";
import { createServerClient } from "@/appwrite/server-client";
import { adminLinkTables, revokeCoachAccess } from "@/appwrite/documents/link-admin";

/**
 * Withdraws the caller's coach.
 *
 * Athlete-initiated only. Under UK GDPR consent has to be as easy to withdraw
 * as it was to give, and the athlete is whoever the JWT says -- an id from a
 * request body would let anyone cut somebody else's coach off.
 *
 * Whether a coach can also drop an athlete from their own roster is a separate
 * question and Ruairi's to answer; it is marked [SME to confirm] on Order 16.5
 * and deliberately not guessed here.
 *
 * Not rate limited. Redeeming is limited because guessing codes is the attack;
 * revoking only ever affects the caller's own link, and a limit on it would
 * mean an athlete who taps twice cannot withdraw consent.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
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
    const result = await revokeCoachAccess(
      adminLinkTables(admin, new Users(admin)),
      config.databaseId,
      athleteId,
    );
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[link/revoke] could not revoke", error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
