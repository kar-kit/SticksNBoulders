import { Account, Client, Users } from "node-appwrite";
import { NextResponse } from "next/server";
import { serverAppwriteConfig } from "@/appwrite/env";
import { createServerClient } from "@/appwrite/server-client";
import { adminLinkTables, resolveInviteCode } from "@/appwrite/documents/link-admin";
import { createRateLimiter } from "@/lib/auth/rate-limit";
import { normaliseInviteCode } from "@/lib/coach/invite-code";

/**
 * Names the coach a code belongs to, so the athlete can be asked to confirm.
 *
 * The blueprint requires the consent step to name the person: "Ruairi will be
 * able to see your sessions, your videos and your bodyweight." Under UK GDPR
 * that is the moment consent actually happens, so the name has to be on screen
 * before anything is written -- which means a read that resolves a code
 * without linking.
 *
 * That makes this an oracle mapping a five-character code to a real person's
 * name, so it is the more carefully guarded of the two endpoints, not the less:
 * a JWT is required before the code is looked at, and the budget is tighter
 * than the write's. Nothing here writes.
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
  if (!jwt) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let typed = "";
  try {
    const body = (await request.json()) as { code?: unknown };
    typed = typeof body.code === "string" ? body.code : "";
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const code = normaliseInviteCode(typed);
  if (!code) return NextResponse.json({ status: "unknown-code" });

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
    const resolved = await resolveInviteCode(adminLinkTables(admin, new Users(admin)), config.databaseId, code);
    if (!resolved) return NextResponse.json({ status: "unknown-code" });
    // The athlete's own code resolves, but linking to yourself never will --
    // said here so the confirm screen is never shown for it.
    if (resolved.coachId === athleteId) return NextResponse.json({ status: "self" });
    return NextResponse.json(
      { status: "found", coachId: resolved.coachId, coachName: resolved.coachName },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[link/resolve] lookup failed", error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
