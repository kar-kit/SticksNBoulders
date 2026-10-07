import { Account, Client, Users } from "node-appwrite";
import { NextResponse } from "next/server";
import { serverAppwriteConfig } from "@/appwrite/env";
import { createServerClient } from "@/appwrite/server-client";
import { AVATAR_BUCKET } from "@/appwrite/documents/avatar";
import { adminLinkTables, coachPictureFor } from "@/appwrite/documents/link-admin";

/**
 * The caller's own coach's profile picture, as image bytes.
 *
 * The picture's sibling of ../route.ts, which names the coach, and here for
 * the same reason: the athlete cannot read anything of the coach's directly
 * (see `coachPictureFor`). The gate is the link, read fresh: an athlete who
 * unlinks stops getting the picture on their next request.
 *
 * The bytes are read with the API key, because no session the athlete holds
 * can read them. What keeps that from being a hole is that the file id is
 * never the caller's to choose -- it comes from the coach's own profile row,
 * found through the caller's own active link, and the athlete id comes from
 * the JWT. No parameter on this route names a file or a user.
 *
 * 204 when there is no coach or no picture, so the client shows initials
 * without treating it as a failure.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const jwt = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!jwt) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const config = serverAppwriteConfig();

  let athleteId: string;
  try {
    const asCaller = new Client().setEndpoint(config.endpoint).setProject(config.projectId).setJWT(jwt);
    athleteId = (await new Account(asCaller).get()).$id;
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  try {
    const admin = createServerClient(config);
    const picture = await coachPictureFor(adminLinkTables(admin, new Users(admin)), config.databaseId, athleteId);
    if (!picture) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

    const upstream = await fetch(
      `${config.endpoint}/storage/buckets/${AVATAR_BUCKET}/files/${encodeURIComponent(picture.fileId)}/view`,
      { headers: { "x-appwrite-project": config.projectId, "x-appwrite-key": config.apiKey }, cache: "no-store" },
    );
    if (!upstream.ok) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

    const type = upstream.headers.get("content-type") ?? "";
    return new Response(upstream.body, {
      status: 200,
      headers: {
        // Only the two formats the bucket holds; anything else is served as
        // bytes the browser will not try to interpret.
        "Content-Type": /^image\/(webp|jpeg)$/.test(type) ? type : "application/octet-stream",
        // Private: it is one person's view of another person's face, and it
        // must not outlive an unlink in a shared cache.
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[link/coach/avatar] lookup failed", error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
