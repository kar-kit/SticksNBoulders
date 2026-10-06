import { Account, Client, ID } from "node-appwrite";
import { NextResponse } from "next/server";
import { serverAppwriteConfig } from "@/appwrite/env";
import { createServerClient } from "@/appwrite/server-client";
import { adminProgramTables, runProgramOp } from "@/appwrite/documents/program-admin";

/**
 * Every write to a program: create, edit, reorder, remove a line. Order 19.
 *
 * One endpoint taking one validated op, rather than a route per table, because
 * the checks are identical for all of them and live in program-admin.ts: the
 * caller is whoever the JWT says -- never an id from the body -- and they must
 * be the program's coach, still actively linked to its athlete.
 *
 * No editor calls this yet; the Program Editor screen is blocked on Ruairi.
 * The seed script and the e2e drive it, and it exists now so the boundary is
 * tested before a screen leans on it -- the same call Order 17 made.
 */

export const runtime = "nodejs";

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }

  const config = serverAppwriteConfig();
  try {
    const result = await runProgramOp(
      adminProgramTables(createServerClient(config)),
      config.databaseId,
      callerId,
      body,
      { newId: () => ID.unique(), now: () => new Date() },
    );
    switch (result.status) {
      case "invalid":
        return NextResponse.json({ error: "invalid", reason: result.reason }, { status: 400 });
      case "not-found":
        return NextResponse.json({ error: "not-found" }, { status: 404 });
      case "not-allowed":
        return NextResponse.json({ error: "not-allowed" }, { status: 403 });
      case "ok":
        return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }
  } catch (error) {
    console.error("[program] write failed", error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
