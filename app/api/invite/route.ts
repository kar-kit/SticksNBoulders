import { Account, Client } from "node-appwrite";
import { NextResponse } from "next/server";
import { serverAppwriteConfig } from "@/appwrite/env";
import { createServerClient } from "@/appwrite/server-client";
// By path, not through the barrel: this module constructs the server SDK and
// the barrel is imported by client code. See invite-admin.ts.
import { adminInviteTables, ensureInviteCode } from "@/appwrite/documents/invite-admin";

/**
 * Mints the caller's invite code, server-side.
 *
 * `invite_codes` is a server-only table, by policy. A code minted in the
 * browser is a code whose `coach_id` the browser chose, and naming somebody
 * else there would hand their athletes to you -- so this cannot happen on the
 * client, and the coach id comes from the caller's JWT rather than the body.
 *
 * Unlike rollups, nothing here wants an Appwrite Function. Generation is
 * user-initiated, so it never depends on the database events pipeline that is
 * broken on this instance (see app/api/rollup/route.ts). Redemption at Order
 * 16 is the half that does, and it needs a plan.
 *
 * Idempotent: a coach who taps twice, or whose first request died on gym wifi,
 * gets the same code back rather than a second one that makes the code they
 * already gave out look wrong.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const jwt = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!jwt) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const config = serverAppwriteConfig();

  let coachId: string;
  try {
    // Identified by the token alone. No API key on this client, so a forged or
    // expired JWT simply fails here.
    const asCaller = new Client()
      .setEndpoint(config.endpoint)
      .setProject(config.projectId)
      .setJWT(jwt);
    coachId = (await new Account(asCaller).get()).$id;
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  try {
    // Deliberately no check that the caller already coaches somebody. Role is
    // a relationship -- you are a coach because athletes are linked to you --
    // and the first athlete cannot link without a code, so gating this on
    // having athletes would mean nobody could ever get their first one.
    const tables = adminInviteTables(createServerClient(config));
    const { code, created } = await ensureInviteCode(tables, config.databaseId, coachId);
    return NextResponse.json({ code, created }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[invite] could not mint a code", error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
