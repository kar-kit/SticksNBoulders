import { Account, Client, Users } from "node-appwrite";
import { NextResponse } from "next/server";
import { serverAppwriteConfig } from "@/appwrite/env";
import { createServerClient } from "@/appwrite/server-client";
// By path, not through the barrel: this module constructs the server SDK and
// the barrel is imported by client code. See link-admin.ts.
import { adminLinkTables, redeemInviteCode } from "@/appwrite/documents/link-admin";
import { createRateLimiter } from "@/lib/auth/rate-limit";
import { normaliseInviteCode } from "@/lib/coach/invite-code";

/**
 * Redeems an invite code and links the coach to the athlete.
 *
 * The most dangerous write in the product: it decides who can read somebody's
 * training. Three things make that safe, and all three are here rather than
 * anywhere a client can reach.
 *
 * The athlete is whoever the JWT says. An id from the request body would let a
 * caller link a coach to an account that is not theirs.
 *
 * `coach_athlete_links` is a server-only table by policy, so this cannot be a
 * browser write. The feature list says "an Appwrite Function"; what it means is
 * never client side, and this route is the same privilege at the same boundary.
 * Worth saying plainly, because FTP1-12 flagged this ticket as the one with no
 * clean fallback if the events pipeline stayed broken: that was wrong.
 * Redemption is request/response -- an athlete types a code and taps a button
 * -- so it never needed database events at all.
 *
 * Rate limited per athlete, not only per caller address: a gym shares one IP,
 * and the thing worth limiting is how many codes one account can try.
 */

export const runtime = "nodejs";

const byAthlete = createRateLimiter({ limit: 10, windowMs: 10 * 60_000 });
const byIp = createRateLimiter({ limit: 30, windowMs: 60_000 });

function callerKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function POST(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const jwt = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  // Checked before the code is even read. Without this the endpoint maps a
  // code to a real person's name for anyone with curl.
  if (!jwt) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let typed = "";
  try {
    const body = (await request.json()) as { code?: unknown };
    typed = typeof body.code === "string" ? body.code : "";
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  // Normalised, never trusted as typed. "snb 4f7k2" and "4F7K2" are the same
  // code; anything outside the alphabet is not a code at all.
  const code = normaliseInviteCode(typed);
  // Rejected before any rate-limit budget is spent, so junk cannot lock an
  // athlete out of redeeming a real code.
  if (!code) return NextResponse.json({ status: "unknown-code" }, { status: 200 });

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

  for (const [limiter, key] of [
    [byAthlete, athleteId],
    [byIp, callerKey(request)],
  ] as const) {
    const verdict = limiter.check(key);
    if (!verdict.allowed) {
      return NextResponse.json(
        { error: "too many attempts" },
        { status: 429, headers: { "Retry-After": String(verdict.retryAfterSeconds) } },
      );
    }
  }

  try {
    const admin = createServerClient(config);
    const tables = adminLinkTables(admin, new Users(admin));
    const result = await redeemInviteCode(tables, config.databaseId, athleteId, code);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Logged rather than swallowed. A link that quietly fails looks exactly
    // like one that worked, right up until a coach opens an empty roster.
    console.error("[link] could not redeem", error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
