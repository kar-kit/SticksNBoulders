import { NextResponse } from "next/server";
import { serverAppwriteConfig } from "@/appwrite/env";
import { createServerClient } from "@/appwrite/server-client";
import { adminPushTables, sendTest } from "@/appwrite/documents/push-admin";
import { vapidFromEnv, webPushSender } from "@/lib/push/web-push-sender";
import { callerFrom } from "../caller";

/**
 * F27: "Send a test" -- one notification to every device the caller has on,
 * through the same delivery path the notify Function uses, so a test that
 * lands proves the keys, the subscription and the service worker together.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  const callerId = await callerFrom(request);
  if (!callerId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const vapid = vapidFromEnv();
  if (!vapid) return NextResponse.json({ error: "not-configured" }, { status: 503 });

  const config = serverAppwriteConfig();
  try {
    const result = await sendTest(
      { tables: adminPushTables(createServerClient(config)), databaseId: config.databaseId, callerId, now: () => new Date() },
      webPushSender(vapid),
    );
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[push/test] failed", error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
