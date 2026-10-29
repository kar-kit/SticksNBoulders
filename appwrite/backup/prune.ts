import { proxyIdFor, proxyOf } from "../documents/proxy";

/**
 * Whether a clip's original may be deleted now that its proxy plays instead
 * (`npm run clips:proxies -- --prune`, docs/video-proxy.md).
 *
 * Joey's rule: the original is kept until the proxy is verified, then deleted
 * seven days later. "Verified" is something only the worker can say -- it
 * points a set at a proxy only after ffprobe has passed it -- and the bucket
 * grants create to nobody, so a proxy file stamped exactly for the athlete was
 * made by the worker. Everything below is checked from state, never assumed:
 *
 *   - the set still names this clip, and its `video_proxy_id` is this clip's
 *     proxy (`proxyOf`): the players are already loading the proxy;
 *   - the proxy file exists, finished uploading, is not empty, and carries
 *     exactly the athlete's stamp;
 *   - the proxy file is at least `PRUNE_AFTER_DAYS` old.
 *
 * After a prune `video_file_id` stays as it was. It is the clip's identity --
 * the poster and proxy ids hang off it, reviews record it (v18) -- and every
 * reader that loads bytes goes through the proxy when the row names one.
 *
 * Pure, like orphans.ts, because a delete that cannot be taken back wants
 * every edge tested without a network.
 */

export const PRUNE_AFTER_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface StoredProxy {
  $permissions: readonly string[];
  $createdAt: string;
  sizeOriginal: number;
  chunksTotal: number;
  chunksUploaded: number;
}

declare const clearedForPrune: unique symbol;

/**
 * An original whose proxy has been checked to stand in for it. Only
 * `clearForPrune` makes one, and the write helper's delete takes nothing else
 * (appwrite/documents/clip-admin.ts `deletePrunedOriginal`).
 */
export type PrunableOriginal = Readonly<{
  bucketId: "set_videos";
  $id: string;
  proxyId: string;
  setId: string;
}> & { readonly [clearedForPrune]: true };

const samePermissions = (a: readonly string[], b: readonly string[]) => {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((value, i) => value === y[i]);
};

/** A proxy file the worker made and finished uploading, for this athlete. */
export function isTrustedProxyFile(file: StoredProxy | null, permissions: readonly string[]): file is StoredProxy {
  return (
    file !== null &&
    file.sizeOriginal > 0 &&
    file.chunksTotal > 0 &&
    file.chunksUploaded === file.chunksTotal &&
    samePermissions(file.$permissions, permissions)
  );
}

export function clearForPrune(input: {
  /** The set, as read just now. Null when it is gone. */
  row: (Record<string, unknown> & { $id: string }) | null;
  /** The clip the plan meant to prune. */
  clipFileId: string;
  proxy: StoredProxy | null;
  /** `proxyPermissions` for the row's athlete. */
  permissionsFor: (athleteId: string) => string[];
  now: Date;
  minAgeDays?: number;
}): { ok: true; original: PrunableOriginal } | { ok: false; tooYoung: boolean; reason: string } {
  const { row, clipFileId, proxy, now } = input;
  const minAgeDays = input.minAgeDays ?? PRUNE_AFTER_DAYS;
  if (!row) return { ok: false, tooYoung: false, reason: "the set is gone" };
  if (row.video_file_id !== clipFileId) return { ok: false, tooYoung: false, reason: "the set no longer names this clip" };
  const proxyId = proxyIdFor(clipFileId);
  if (!proxyId || proxyOf(row) !== proxyId) return { ok: false, tooYoung: false, reason: "the set does not play a proxy of this clip" };
  const athleteId = typeof row.athlete_id === "string" ? row.athlete_id : "";
  if (!athleteId) return { ok: false, tooYoung: false, reason: "the set names no athlete" };
  if (!isTrustedProxyFile(proxy, input.permissionsFor(athleteId))) {
    return { ok: false, tooYoung: false, reason: "the proxy file is missing, unfinished, empty, or not stamped for this athlete" };
  }
  const made = Date.parse(proxy.$createdAt);
  if (Number.isNaN(made) || made > now.getTime()) return { ok: false, tooYoung: false, reason: "the proxy file cannot be dated" };
  const ageDays = (now.getTime() - made) / DAY_MS;
  if (ageDays < minAgeDays) return { ok: false, tooYoung: true, reason: `the proxy is ${Math.floor(ageDays)} day(s) old; prune waits ${minAgeDays}` };
  return {
    ok: true,
    original: { bucketId: "set_videos", $id: clipFileId, proxyId, setId: row.$id } as PrunableOriginal,
  };
}
