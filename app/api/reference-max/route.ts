import { Account, Client, ID } from "node-appwrite";
import { NextResponse } from "next/server";
import { serverAppwriteConfig } from "@/appwrite/env";
import { createServerClient } from "@/appwrite/server-client";
import {
  adminReferenceMaxTables,
  removeReferenceMax,
  setReferenceMax,
} from "@/appwrite/documents/reference-max-admin";

/**
 * Setting and removing the numbers percentages are calculated against.
 *
 * The caller is whoever the JWT says, never an id from the body -- that is the
 * whole security boundary here. A coach may write for an athlete they actively
 * coach; an athlete may write for themselves; nobody else may write at all,
 * and the check lives in reference-max-admin.ts.
 *
 * Not rate limited. There is nothing to guess: every request names a row or an
 * athlete the caller already has a relationship with, so a limit would only
 * stop a coach entering a squad's maxes in one sitting.
 */

export const runtime = "nodejs";

type Body = {
  athleteId?: unknown;
  exerciseId?: unknown;
  kind?: unknown;
  valueKg?: unknown;
  effectiveFrom?: unknown;
};

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

async function callerFrom(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization") ?? "";
  const jwt = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!jwt) return null;

  const config = serverAppwriteConfig();
  try {
    const asCaller = new Client()
      .setEndpoint(config.endpoint)
      .setProject(config.projectId)
      .setJWT(jwt);
    return (await new Account(asCaller).get()).$id;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const callerId = await callerFrom(request);
  if (!callerId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }

  const kind = str(body.kind);
  if (kind !== "tested" && kind !== "training") {
    // "Estimated" is not writable and never will be: it is the best e1RM in
    // stats_rollups, and a second stored copy would leave the rollup rebuild
    // script repairing half the data.
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }

  const config = serverAppwriteConfig();
  try {
    const result = await setReferenceMax(
      adminReferenceMaxTables(createServerClient(config)),
      config.databaseId,
      callerId,
      {
        athleteId: str(body.athleteId) || callerId,
        exerciseId: str(body.exerciseId),
        kind,
        valueKg: typeof body.valueKg === "number" ? body.valueKg : Number.NaN,
        effectiveFrom: str(body.effectiveFrom) || undefined,
      },
      { newId: () => ID.unique(), now: () => new Date() },
    );

    if (result.status === "not-allowed") {
      return NextResponse.json({ error: "not-allowed" }, { status: 403 });
    }
    if (result.status === "invalid") {
      return NextResponse.json({ error: "invalid", reason: result.reason }, { status: 400 });
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[reference-max] could not set", error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const callerId = await callerFrom(request);
  if (!callerId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const rowId = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!rowId) return NextResponse.json({ error: "bad-request" }, { status: 400 });

  const config = serverAppwriteConfig();
  try {
    const result = await removeReferenceMax(
      adminReferenceMaxTables(createServerClient(config)),
      config.databaseId,
      callerId,
      rowId,
    );
    if (result.status === "not-allowed") {
      return NextResponse.json({ error: "not-allowed" }, { status: 403 });
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[reference-max] could not remove", error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
