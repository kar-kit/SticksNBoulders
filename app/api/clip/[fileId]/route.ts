import { Users } from "node-appwrite";
import { NextResponse } from "next/server";
import { serverAppwriteConfig } from "@/appwrite/env";
import { createServerClient } from "@/appwrite/server-client";
import { VIDEO_BUCKET } from "@/lib/video/bucket";
import { readTicket, ticketSecret } from "@/lib/video/ticket";

/**
 * Streams one clip, through this app's origin.
 *
 * The whole reason this route exists is that a `<video>` element cannot send a
 * header, and Appwrite will not take a JWT any other way -- see
 * lib/video/ticket.ts for the three things that were tried against the live
 * instance before this one.
 *
 * It is a pipe, not a gate. The ticket says who the caller is; this mints a
 * fresh short-lived JWT for that user and asks Appwrite as them, so the access
 * decision is Appwrite's own -- the same one it makes for every other read in
 * the product. A coach who has just been unlinked has left the circle team,
 * and their next range request comes back 404 mid-scrub. That is the correct
 * behaviour and it costs nothing to get.
 *
 * `Range` is forwarded in both directions and the body is passed through
 * unbuffered. Both matter: the blueprint wants frame-stepping at 0.25x, which
 * is seeking, which is range requests -- and reading a 150MB clip into memory
 * to hand it on would work in every test and fall over on the first real one.
 */

export const runtime = "nodejs";
/** Nothing here is static, and a cached clip would be a cached credential. */
export const dynamic = "force-dynamic";

/** Passed straight back from Appwrite so the browser can seek. */
const FORWARD_BACK = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
] as const;

export async function GET(request: Request, context: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await context.params;
  const token = new URL(request.url).searchParams.get("t") ?? "";

  let claims: ReturnType<typeof readTicket>;
  try {
    claims = readTicket(token, ticketSecret());
  } catch {
    // A missing VIDEO_TICKET_SECRET. Loud in the log, opaque to the caller.
    console.error("clip: VIDEO_TICKET_SECRET is not configured");
    return NextResponse.json({ error: "unavailable" }, { status: 500 });
  }

  // The file in the path must be the file in the ticket. Without this a single
  // ticket would open the whole bucket to whoever held it.
  if (!claims || claims.fileId !== fileId) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  const config = serverAppwriteConfig();

  let jwt: string;
  try {
    // The admin key mints a token FOR the user; it never reads the file
    // itself. The bytes are fetched with the user's own authority.
    jwt = (await new Users(createServerClient(config)).createJWT({ userId: claims.userId })).jwt;
  } catch {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  const range = request.headers.get("range");
  const upstream = await fetch(
    `${config.endpoint}/storage/buckets/${VIDEO_BUCKET}/files/${encodeURIComponent(fileId)}/view`,
    {
      headers: {
        "x-appwrite-project": config.projectId,
        "x-appwrite-jwt": jwt,
        // Identity, deliberately. Appwrite gzips its file responses, and a
        // gzipped range is a range over compressed bytes -- meaningless to a
        // video element seeking to a timestamp. Video is already compressed,
        // so the only thing gzip costs here is correctness.
        "accept-encoding": "identity",
        ...(range ? { range } : {}),
      },
      // Appwrite answers 404 for a file the caller may not read, which is the
      // right shape: a coach who lost access learns nothing about whether the
      // clip still exists.
      cache: "no-store",
    },
  );

  if (!upstream.ok && upstream.status !== 206) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  // If it came back encoded anyway, the length describes the COMPRESSED bytes
  // while fetch has already handed us the decompressed ones -- forwarding it
  // truncates the clip to a few hundred bytes and reports success. Found
  // exactly that way, by hashing what came out of the proxy.
  const encoded = Boolean(upstream.headers.get("content-encoding"));
  const headers = new Headers();
  for (const name of FORWARD_BACK) {
    if (encoded && name === "content-length") continue;
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Cache-Control", "no-store, private");
  // The bytes are a video, whatever the upstream said. Without this an
  // unexpected content-type could be sniffed as something executable.
  headers.set("X-Content-Type-Options", "nosniff");

  return new Response(upstream.body, { status: upstream.status, headers });
}
