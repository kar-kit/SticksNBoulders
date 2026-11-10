import { ID } from "node-appwrite";
import { NextResponse } from "next/server";
import { serverAppwriteConfig } from "@/appwrite/env";
import { createServerClient } from "@/appwrite/server-client";
import { adminApiTokenTables, type Ctx } from "@/appwrite/documents/api-token-admin";
import { mayUseApiTokens } from "@/lib/api/allowlist";
import { callerFrom } from "../push/caller";

/**
 * Who may use /api/tokens: a signed-in user (the Appwrite JWT, `callerFrom`)
 * whose id is on API_TOKEN_USER_IDS. 401 without a session, 403 off the list.
 * The 403 is also how the Connections screen learns not to show itself.
 */

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export type Gate = { ok: true; ctx: Ctx } | { ok: false; response: Response };

export async function gate(request: Request): Promise<Gate> {
  const callerId = await callerFrom(request);
  if (!callerId) {
    return { ok: false, response: NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE }) };
  }
  if (!mayUseApiTokens(callerId)) {
    return { ok: false, response: NextResponse.json({ error: "not_allowed" }, { status: 403, headers: NO_STORE }) };
  }
  const config = serverAppwriteConfig();
  return {
    ok: true,
    ctx: {
      tables: adminApiTokenTables(createServerClient(config)),
      databaseId: config.databaseId,
      callerId,
      now: () => new Date(),
      newId: () => ID.unique(),
    },
  };
}
