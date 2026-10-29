import { proxyIdFor } from "./proxy";
import { setPermissions } from "./policy";
import type { RowWriter } from "./row-writer";

/**
 * Pointing an existing set at its clip's verified proxy, server-side (v22).
 *
 * The one write of `video_proxy_id` anywhere, and it lives in the write helper
 * for the reason every row write does: one place to review. Used only by
 * `npm run clips:proxies` (scripts/clip-proxies.ts), with the admin key, and
 * only after ffprobe has passed the proxy file -- a row naming a proxy is the
 * players' signal to stop loading the original.
 *
 * Writes only the proxy column, exactly as `setPosterOnSet` writes only the
 * poster column: the clip id is passed so the pair can be checked, never
 * written, because the worker re-reads the row right before this and rewriting
 * the clip id from a stale read is how a replaced clip would come back.
 *
 * Stamped with `setPermissions` for the athlete, so the row's audience and its
 * authorship proof (appwrite/documents/provenance.ts) are unchanged.
 */
export interface SetProxyInput {
  rowId: string;
  /** The set's athlete, from its own `athlete_id`. */
  athleteId: string;
  /** The set's clip as just re-read. */
  videoFileId: string;
  videoProxyId: string;
}

export async function setProxyOnSet(writer: RowWriter, databaseId: string, input: SetProxyInput) {
  if (!input.rowId || !input.athleteId) throw new Error("setProxyOnSet: rowId and athleteId are required");
  if (input.videoProxyId !== proxyIdFor(input.videoFileId)) {
    throw new Error(`setProxyOnSet: ${input.videoProxyId} is not the proxy of clip ${input.videoFileId}`);
  }
  return writer.updateRow({
    databaseId,
    tableId: "sets",
    rowId: input.rowId,
    data: { video_proxy_id: input.videoProxyId },
    permissions: setPermissions({ athleteId: input.athleteId }),
  });
}
