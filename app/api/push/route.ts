import { NextResponse } from "next/server";
import { serverAppwriteConfig } from "@/appwrite/env";
import { createServerClient } from "@/appwrite/server-client";
import { adminPushTables, savePrefs, subscribe, unsubscribe } from "@/appwrite/documents/push-admin";
import { callerFrom } from "./caller";

/**
 * F27: a coach's devices for web push.
 *
 *   POST    { subscription, prefs? }   this device on (or its keys refreshed)
 *   PATCH   { prefs }                  the per-type switches, every device
 *   DELETE  { endpoint }               this device off
 *
 * The table is server-only, so this is the only way a session reaches it.
 * Reads do not come through here: each row is stamped readable by its owner,
 * so the settings screen reads its own rows straight from Appwrite.
 */

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

async function handle(
  request: Request,
  run: (ctx: Parameters<typeof savePrefs>[0], body: unknown) => Promise<{ status: string }>,
) {
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
    const result = await run(
      { tables: adminPushTables(createServerClient(config)), databaseId: config.databaseId, callerId, now: () => new Date() },
      body,
    );
    if (result.status === "invalid") return NextResponse.json({ error: "invalid" }, { status: 400 });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    console.error("[push] failed", error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

export function POST(request: Request) {
  return handle(request, (ctx, body) => subscribe(ctx, body, request.headers.get("user-agent") ?? ""));
}

export function PATCH(request: Request) {
  return handle(request, savePrefs);
}

export function DELETE(request: Request) {
  return handle(request, unsubscribe);
}
