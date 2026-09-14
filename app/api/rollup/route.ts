import { Account, Client } from "node-appwrite";
import { NextResponse } from "next/server";
import { serverAppwriteConfig } from "@/appwrite/env";
import { createServerClient } from "@/appwrite/server-client";
// By path, not through the barrel: this module constructs the server SDK and
// the barrel is imported by client code. See rollup-admin.ts.
import { adminRollupTables, rebuildRollup } from "@/appwrite/documents/rollup-admin";

/**
 * Recomputes one weekly rollup, server-side.
 *
 * Appwrite has no GROUP BY, so every chart and PR reads a stored aggregate
 * rather than raw sets, and `stats_rollups` is a server-only table -- no user
 * session may write one, by policy. So this cannot happen in the browser.
 *
 * The feature list asks for an Appwrite Function on set creation. This route
 * does that job instead, at the same privilege level and through the same
 * write helper.
 *
 * It was originally a workaround: database events did not trigger Functions on
 * this instance at all. That was true on Appwrite 1.9.0 and is fixed on 1.9.6
 * -- re-measured on 14 Sep 2026 after the upgrade, 332 event-triggered
 * executions where 1.9.0 produced none, first one 26 minutes after the
 * upgrade landed.
 *
 * The route stays anyway, and now by choice rather than necessity. A Function
 * would need its own copy of the arithmetic in lib/strength/rollup.ts, and two
 * implementations of an aggregate is exactly how a repair script stops
 * repairing -- the reason rollupFrom is shared with the rebuild script in the
 * first place. The one thing a Function buys is firing on writes that did not
 * come through this app, and by policy there are none.
 *
 * If that ever changes, moving is a change of caller and not of logic: the
 * Appwrite part is in appwrite/documents/rollup-admin.ts.
 *
 * The caller proves who they are with a short-lived Appwrite JWT, and the
 * athlete id comes from that token and never from the request body. Accepting
 * an id would let anyone rewrite anybody's totals.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const jwt = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!jwt) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: { exerciseId?: unknown; loggedAt?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const exerciseId = typeof body.exerciseId === "string" ? body.exerciseId : "";
  const loggedAt = new Date(typeof body.loggedAt === "string" ? body.loggedAt : "");
  if (!exerciseId || Number.isNaN(loggedAt.getTime())) {
    // 400 rather than 500: the queue marks this permanent and stops retrying,
    // instead of a malformed op blocking every set behind it forever.
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const config = serverAppwriteConfig();

  let athleteId: string;
  try {
    // Identified by the token alone. No API key on this client, so a forged or
    // expired JWT simply fails here.
    const asCaller = new Client()
      .setEndpoint(config.endpoint)
      .setProject(config.projectId)
      .setJWT(jwt);
    athleteId = (await new Account(asCaller).get()).$id;
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  try {
    const tables = adminRollupTables(createServerClient(config));
    const result = await rebuildRollup(tables, config.databaseId, { athleteId, exerciseId, loggedAt });
    return NextResponse.json(
      { status: result.status, weekStart: result.weekStart.toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    // Logged rather than swallowed. A rollup that quietly fails to update looks
    // exactly like one that is correct, which is the whole hazard of aggregates.
    console.error("[rollup] could not rebuild", error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
