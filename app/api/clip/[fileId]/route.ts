import { NextResponse } from "next/server";
import { serverAppwriteConfig } from "@/appwrite/env";
import { PROXY_BUCKET, proxyIdFor } from "@/appwrite/documents/proxy";
import { VIDEO_BUCKET } from "@/lib/video/bucket";
import { clipJwts } from "@/lib/video/clip-jwt";
import { readTicket, ticketBucket, ticketSecret } from "@/lib/video/ticket";

/**
 * Streams one clip, through this app's origin.
 *
 * The whole reason this route exists is that a `<video>` element cannot send a
 * header, and Appwrite will not take a JWT any other way -- see
 * lib/video/ticket.ts for the three things that were tried against the live
 * instance before this one.
 *
 * It is a pipe, not a gate. The ticket says who the caller is; this asks
 * Appwrite as that user, with a short-lived JWT minted for them, so the access
 * decision is Appwrite's own -- the same one it makes for every other read in
 * the product. A coach who has just been unlinked has left the circle team,
 * and their next range request comes back 404 mid-scrub. That is the correct
 * behaviour and it costs nothing to get.
 *
 * The JWT is reused across one user's requests for a few minutes
 * (lib/video/clip-jwt.ts). Each seek is a Range request, and minting per
 * request put an ~80 ms Appwrite round trip in front of every one. Reuse does
 * not change who is asking or what they may read: the key is the signed
 * ticket's user, and Appwrite still checks permissions on every read.
 *
 * `Range` is forwarded in both directions and the body is passed through
 * unbuffered. Both matter: the blueprint wants frame-stepping at 0.25x, which
 * is seeking, which is range requests -- and reading a 150MB clip into memory
 * to hand it on would work in every test and fall over on the first real one.
 *
 * Which bucket (v22) comes from the signed ticket, never the URL, and only
 * from PLAYABLE_BUCKETS. A ticket with no bucket -- every ticket minted before
 * proxies, and every clip without one -- opens the clip bucket as it always
 * did. A proxy ticket whose file Appwrite does not have falls back to the
 * clip it was derived from, as the same user: a row can name a proxy that has
 * since been deleted, and the original, while it exists, is the right thing
 * to play.
 */

export const runtime = "nodejs";
/** Nothing here is static, and a cached clip would be a cached credential. */
export const dynamic = "force-dynamic";

/**
 * Passed straight back from Appwrite so the browser can seek. Not
 * `content-type`: that is decided here, by `servedType`.
 */
const FORWARD_BACK = ["content-length", "content-range", "accept-ranges", "etag", "last-modified"] as const;

/**
 * The type a playable original is served as when Appwrite's stored one is
 * not a video type.
 *
 * Why the stored type cannot just be forwarded: Appwrite sets a file's
 * `mimeType` at upload by sniffing its bytes, and on 2 Nov 2026 7 of the 27
 * files in `set_videos` had come out wrong -- 5 as
 * `application/SIMH-tape-data`, 2 as `''` -- against 20 `video/quicktime`.
 * With `nosniff` below, the browser has to take the declared type at its
 * word, and [Inference] iOS Safari, which picks its media pipeline from the
 * type, refuses a clip declared as tape data.
 *
 * Why `video/mp4` and not `video/quicktime`: the bucket only takes mp4, mov,
 * m4v and webm (appwrite/schema, `VIDEO_EXTENSIONS`), and in practice clips
 * are phone camera files -- mp4, or QuickTime .mov holding H.264 or HEVC.
 * MP4 is the ISO successor to the QuickTime format and the two share the
 * same box structure, so every browser that plays an H.264/HEVC .mov plays
 * it declared as `video/mp4` [Inference, from Safari's and Chrome's demuxers
 * treating them as one family]. The reverse is not true: Firefox refuses a
 * `video/quicktime` response outright [Unverified on the current Firefox].
 * So the default is the type every browser accepts. A webm that also lost
 * its type would be mislabelled as mp4; none of the bad seven is webm, and
 * Chrome and Firefox identify a media container from its bytes regardless
 * [Inference].
 */
const DEFAULT_ORIGINAL_TYPE = "video/mp4";

/**
 * What a proxy always is. The worker writes H.264 in MP4 and the bucket takes
 * nothing else (docs/video-proxy.md), so the stored type adds no information
 * here and is ignored.
 */
const PROXY_TYPE = "video/mp4";

/**
 * A bare `video/<subtype>` and nothing else. Parameters are dropped: the one
 * a player cares about, `codecs`, Appwrite never sets, and a malformed one
 * could make a strict parser refuse a type it would otherwise accept.
 */
const VIDEO_TYPE = /^video\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

/**
 * The content-type for what this response is actually serving -- decided by
 * which bucket the bytes came from, not by what Appwrite stored.
 *
 * `bucket` is the bucket the bytes were read from, which after the
 * proxy→original fallback is the clip bucket, not the one the ticket named.
 * A fallen-back proxy ticket is serving an original and gets an original's
 * type.
 */
function servedType(bucket: string, upstreamType: string | null): string {
  if (bucket === PROXY_BUCKET) return PROXY_TYPE;
  const essence = (upstreamType ?? "").split(";")[0].trim().toLowerCase();
  return VIDEO_TYPE.test(essence) ? essence : DEFAULT_ORIGINAL_TYPE;
}

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
  const bucket = ticketBucket(claims);
  if (!bucket) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const config = serverAppwriteConfig();
  const userId = claims.userId;
  const range = request.headers.get("range");

  const view = (jwt: string, bucketId: string, id: string) =>
    fetch(`${config.endpoint}/storage/buckets/${bucketId}/files/${encodeURIComponent(id)}/view`, {
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
    });

  /** The ticket's file, or the original it was derived from, and which bucket answered. */
  const fetchAs = async (jwt: string) => {
    const upstream = await view(jwt, bucket, fileId);
    if (upstream.status === 404 && bucket === PROXY_BUCKET) {
      // Only the clip this proxy id was derived from, never a guess.
      const clipId = fileId.endsWith("_proxy") ? fileId.slice(0, -"_proxy".length) : "";
      if (clipId && proxyIdFor(clipId) === fileId) {
        await upstream.body?.cancel();
        return { upstream: await view(jwt, VIDEO_BUCKET, clipId), servedFrom: VIDEO_BUCKET };
      }
    }
    return { upstream, servedFrom: bucket };
  };

  let served: Awaited<ReturnType<typeof fetchAs>>;
  try {
    // Only after the ticket has checked out: a refused ticket never touches
    // the admin key or the JWT cache.
    let lease = await clipJwts.get(userId);
    served = await fetchAs(lease.jwt);
    if (served.upstream.status === 401 && lease.reused) {
      // A JWT that was fine a minute ago and is refused now: the user's
      // session was deleted (a JWT dies with the session it was cut from), or
      // Appwrite restarted with a new secret. Not a permissions answer --
      // Appwrite says 404 for those. Drop it, mint fresh, try once more; a
      // fresh JWT refused as well is refused for a real reason.
      await served.upstream.body?.cancel();
      clipJwts.forget(userId, lease.entry);
      lease = await clipJwts.get(userId);
      served = await fetchAs(lease.jwt);
    }
  } catch {
    // Minting failed: no such user, or Appwrite unreachable. Same answer as
    // a file they may not read.
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  const { upstream, servedFrom } = served;
  if (!upstream.ok && upstream.status !== 206) {
    await upstream.body?.cancel();
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
  headers.set("content-type", servedType(servedFrom, upstream.headers.get("content-type")));
  headers.set("Cache-Control", "no-store, private");
  // The bytes are a video, and the type above always says so. nosniff keeps
  // the browser from second-guessing it into something executable -- which is
  // also why the type has to be right rather than left for the browser to
  // work out.
  headers.set("X-Content-Type-Options", "nosniff");

  return new Response(upstream.body, { status: upstream.status, headers });
}
