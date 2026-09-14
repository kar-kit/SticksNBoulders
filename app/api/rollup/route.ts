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
 * The feature list asks for an Appwrite Function on set creation. Functions
 * deploy and execute on the self-hosted instance, but database events do not
 * trigger them there -- verified on 14 Sep 2026 with a deployed probe
 * subscribed to `databases.*`, which never fired while a manual execution of
 * the same function completed in milliseconds. Until that pipeline is fixed,
 * this route does the same job at the same privilege level through the same
 * write helper. Moving to a Function later is a change of caller, not of
 * logic: the Appwrite part is in appwrite/documents/rollup-admin.ts and the
 * arithmetic is in lib/strength/rollup.ts, shared with the rebuild script.
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
