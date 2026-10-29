/**
 * Which proxy belongs to which clip, from the ids alone (schema v22).
 *
 * A clip's proxy is a normalised copy of it: H.264, capped at 1080p and 60fps,
 * moov atom first (lib/video/proxy-profile.ts, scripts/clip-proxies.ts). The
 * phone uploads whatever the camera wrote -- often 10-bit HEVC with the moov
 * at the end, 100-150MB -- and a coach on Windows Chrome may not decode HEVC
 * at all, or waits for the whole index before the first frame. The proxy is
 * what the players load once it exists.
 *
 * Same shape as the poster (appwrite/documents/poster.ts), for the same three
 * reasons: the id is derived from the clip's, so every path that knows a clip
 * knows its proxy (cleanup, the sweep, the backup); the worker's upload is
 * idempotent (a 409 means it is there); and a reader can tell a proxy that
 * belongs to this row's clip from one left over from a replaced clip, with a
 * pure check and no request per row (`proxyOf`).
 *
 * The column exists, although the id is derivable, because it says a proxy
 * was made AND verified. Only the worker writes it, after ffprobe has checked
 * the output (scripts/clip-proxies.ts). A row without it plays the original.
 *
 * Squatting is a smaller question here than for posters: the proxy bucket
 * grants create to nobody, so only the API key can put a file in it. The
 * worker still refuses to trust a file at a proxy id unless its permissions
 * are exactly the athlete's stamp, because "only the server writes it" is a
 * property of today's bucket config and the check costs nothing.
 *
 * Pure. No client, no network.
 */

export const PROXY_BUCKET = "set_video_proxies";

/** Appwrite ids stop at 36 characters. */
const MAX_FILE_ID = 36;
const SUFFIX = "_proxy";

/**
 * The proxy id for a clip, or null when none fits.
 *
 * A clip id from `ID.unique()` is 20 characters, so the proxy id is 26. Only a
 * hand-made clip id over 30 characters (some e2e fixtures) leaves no room, and
 * that clip simply plays its original.
 */
export function proxyIdFor(clipFileId: unknown): string | null {
  if (typeof clipFileId !== "string" || clipFileId.trim() === "") return null;
  const id = `${clipFileId}${SUFFIX}`;
  return id.length <= MAX_FILE_ID ? id : null;
}

/**
 * The proxy a set row may be played from, or null to play the original.
 *
 * The one place a reader turns `video_proxy_id` into something to load.
 * Absent, blank, or not the proxy of this row's own clip all read as no
 * proxy. A row whose clip was replaced after its proxy was made still names
 * the old proxy until the worker catches up; this makes that row play the new
 * original rather than the old take.
 */
export function proxyOf(row: Record<string, unknown>): string | null {
  const proxy = row.video_proxy_id;
  if (typeof proxy !== "string" || proxy === "") return null;
  return proxy === proxyIdFor(row.video_file_id) ? proxy : null;
}
