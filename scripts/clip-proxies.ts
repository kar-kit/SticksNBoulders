/**
 * Proxies for clips (schema v22) -- the logic of `npm run clips:proxies`.
 *
 * Every clip gets a normalised copy (lib/video/proxy-profile.ts: H.264, at most
 * 1080p and 60fps, moov first) and the players load that instead of the
 * original. Made beside the Appwrite instance with ffmpeg, by polling: a
 * systemd timer runs this every minute (docs/video-proxy.md). Polling rather
 * than Appwrite events because a missed event is a clip that never gets a
 * proxy, while a missed poll is a clip that gets one a minute later.
 *
 * Pure orchestration over injected deps, the shape of scripts/clip-posters.ts,
 * so it is tested without a server or ffmpeg; scripts/make-clip-proxies.mts
 * wires the real ones and scripts/proxy-ffmpeg.ts holds the ffmpeg decisions.
 *
 * Idempotent, by construction:
 *   - the proxy id is derived from the clip id (appwrite/documents/proxy.ts),
 *     so a re-run aims at the same file, and a 409 means it is there;
 *   - a set whose `video_proxy_id` already names its clip's proxy is done;
 *   - a run that died between upload and pointing finds the file, verifies
 *     it again, and only points the set;
 *   - an upload that died part-way leaves an unfinished file, which is
 *     deleted and made again.
 *
 * Squatting. The proxy bucket grants create to nobody, so only this worker's
 * key can put a file there. A file at a proxy id is still trusted only if its
 * permissions are exactly `proxyPermissions` for that set's athlete; anything
 * else is reported and left alone for a human.
 *
 * Races. Transcoding takes minutes, and the athlete may replace or delete the
 * clip meanwhile. The row is re-read before the upload and again immediately
 * before the write, and skipped if its clip changed or it gained a proxy; the
 * write names only the proxy column (appwrite/documents/proxy-admin.ts), so a
 * stale read cannot put an old clip back. A proxy uploaded for a clip that
 * has since gone is unreferenced, and `clips:sweep` reclaims it.
 *
 * One clip at a time, ffmpeg niced: this shares a VM with the instance.
 */
import { proxyIdFor, proxyOf } from "../appwrite/documents/proxy";
import { clearForPrune, isTrustedProxyFile, type PrunableOriginal, type StoredProxy } from "../appwrite/backup/prune";

export type Row = Record<string, unknown> & { $id: string };

/** A proxy made on local disk and already checked by ffprobe. */
export interface MadeProxy {
  path: string;
  size: number;
  mode: "remux" | "encode";
  /** What verification found wrong. Empty means it passed. */
  problems: string[];
}

export interface ProxyWorkerDeps {
  /** Authentic sets with a clip, every one, in a stable order. */
  setsWithClips(): Promise<Row[]>;
  /** The set as it is now, or null if it is gone. */
  getSet(rowId: string): Promise<Row | null>;
  /** The proxy file, or null if there is none. */
  proxyFile(proxyId: string): Promise<StoredProxy | null>;
  /**
   * Downloads the original, makes the proxy, and verifies it. Null when the
   * original is not in the bucket. Throws when ffmpeg cannot (an HDR clip and
   * no zscale, a clip it cannot decode); the message is for the log.
   */
  makeProxy(clipFileId: string): Promise<MadeProxy | null>;
  /**
   * Downloads a proxy already in the bucket and verifies it against its
   * original, or on its own when the original is gone.
   */
  verifyStoredProxy(clipFileId: string, proxyId: string): Promise<{ problems: string[]; originalPresent: boolean }>;
  /** Uploads at `proxyId` with `permissions`, and checks the stored size. A 409 is the caller's to handle. */
  uploadProxy(proxyId: string, made: MadeProxy, permissions: string[]): Promise<void>;
  /** Deletes the proxy file through the write helper (`deleteWorkerProxy`). */
  deleteProxy(clipFileId: string, proxyId: string): Promise<void>;
  /** Removes the local file. Never throws. */
  discard(made: MadeProxy): Promise<void>;
  /** Points the set at the proxy, through the write helper. */
  pointSet(input: { rowId: string; athleteId: string; videoFileId: string; videoProxyId: string }): Promise<void>;
  /** `proxyPermissions` for an athlete. Injected so the test and the script share the policy. */
  permissionsFor(athleteId: string): string[];
  /** A clip that failed recently is left until its retry time, so one bad clip is not re-downloaded every minute. */
  heldBack(clipFileId: string): boolean;
  noteFailure(clipFileId: string, reason: string): void;
  noteSuccess(clipFileId: string): void;
  log(line: string): void;
}

export type PlanKind =
  /** No file yet: make one, verify it, upload it, point the set. */
  | "make"
  /** A finished file with this athlete's stamp is there (a run died before pointing): verify it, point the set. */
  | "point"
  /** The worker's own upload died part-way: delete it and make it again. */
  | "redo"
  /** A file is there with permissions other than this athlete's stamp: left alone. */
  | "squatted"
  /** The clip id is too long to derive a proxy id from. Hand-made fixtures only. */
  | "no-room"
  /** Failed recently; retried later (or now with --retry-failed). */
  | "held-back";

export interface PlanEntry {
  kind: PlanKind;
  rowId: string;
  athleteId: string;
  videoFileId: string;
  proxyId: string | null;
}

export interface Plan {
  entries: PlanEntry[];
  /** Sets whose proxy is in place. */
  done: number;
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");

const samePermissions = (a: readonly string[], b: readonly string[]) => {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((value, i) => value === y[i]);
};

/** Reads only. What `--yes` would do, set by set. */
export async function planProxies(
  deps: Pick<ProxyWorkerDeps, "setsWithClips" | "proxyFile" | "permissionsFor" | "heldBack">,
): Promise<Plan> {
  const entries: PlanEntry[] = [];
  let done = 0;
  for (const row of await deps.setsWithClips()) {
    const videoFileId = str(row.video_file_id);
    const athleteId = str(row.athlete_id);
    if (!videoFileId || !athleteId) continue;
    if (proxyOf(row) !== null) {
      done += 1;
      continue;
    }
    const proxyId = proxyIdFor(videoFileId);
    const base = { rowId: row.$id, athleteId, videoFileId, proxyId };
    if (!proxyId) {
      entries.push({ ...base, kind: "no-room" });
      continue;
    }
    if (deps.heldBack(videoFileId)) {
      entries.push({ ...base, kind: "held-back" });
      continue;
    }
    const existing = await deps.proxyFile(proxyId);
    const stamp = deps.permissionsFor(athleteId);
    if (!existing) entries.push({ ...base, kind: "make" });
    else if (!samePermissions(existing.$permissions, stamp)) entries.push({ ...base, kind: "squatted" });
    else if (isTrustedProxyFile(existing, stamp)) entries.push({ ...base, kind: "point" });
    else entries.push({ ...base, kind: "redo" });
  }
  return { entries, done };
}

export interface ApplyResult {
  /** Proxies made, verified and uploaded this run. */
  made: number;
  pointed: number;
  /** Made, then failed verification: deleted, set left on its original. */
  rejected: number;
  /** The clip changed, gained a proxy, or the set went, between plan and write. */
  changed: number;
  /** The set names a clip the bucket does not hold. */
  missing: number;
  failed: number;
  /** Left alone on purpose: squatted files, no room for an id, held back after a failure. */
  skipped: number;
}

const isConflict = (error: unknown) => (error as { code?: unknown })?.code === 409;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Writes. One set's failure is logged and the rest carry on, one clip at a time. */
export async function applyProxies(plan: Plan, deps: ProxyWorkerDeps): Promise<ApplyResult> {
  const result: ApplyResult = { made: 0, pointed: 0, rejected: 0, changed: 0, missing: 0, failed: 0, skipped: 0 };

  // Whether the row still names this clip and has no proxy yet. Read fresh.
  const stillWants = async (entry: PlanEntry) => {
    const now = await deps.getSet(entry.rowId);
    return Boolean(now) && str(now!.video_file_id) === entry.videoFileId && proxyOf(now!) === null;
  };

  for (const entry of plan.entries) {
    if (entry.kind === "squatted" || entry.kind === "no-room" || entry.kind === "held-back" || !entry.proxyId) {
      result.skipped += 1;
      continue;
    }
    const proxyId = entry.proxyId;
    const stamp = deps.permissionsFor(entry.athleteId);
    try {
      let kind: PlanKind = entry.kind;
      if (kind === "redo") {
        deps.log(`  ${entry.rowId}: an unfinished upload at ${proxyId}; deleting it and starting again`);
        await deps.deleteProxy(entry.videoFileId, proxyId);
        kind = "make";
      }

      if (kind === "make") {
        const made = await deps.makeProxy(entry.videoFileId);
        if (!made) {
          deps.log(`  ${entry.rowId}: clip ${entry.videoFileId} is not in the bucket; nothing to make a proxy from`);
          result.missing += 1;
          continue;
        }
        try {
          if (made.problems.length > 0) {
            // Never uploaded, so "deleted" is the local file. The set stays on
            // its original, which plays wherever it played before.
            deps.log(`  ${entry.rowId}: proxy of ${entry.videoFileId} failed verification (${made.problems.join("; ")}); left on the original`);
            deps.noteFailure(entry.videoFileId, made.problems.join("; "));
            result.rejected += 1;
            continue;
          }
          // Minutes have passed. Do not upload a proxy of a clip the set has dropped.
          if (!(await stillWants(entry))) {
            deps.log(`  ${entry.rowId}: changed while its proxy was made; not uploaded`);
            result.changed += 1;
            continue;
          }
          try {
            await deps.uploadProxy(proxyId, made, stamp);
            result.made += 1;
          } catch (error) {
            if (!isConflict(error)) throw error;
            // A second run got there between plan and now. Trust it only on
            // the same terms as a planned "point".
            const existing = await deps.proxyFile(proxyId);
            if (!isTrustedProxyFile(existing, stamp)) {
              deps.log(`  ${entry.rowId}: a proxy appeared at ${proxyId} that this run cannot trust; left alone`);
              result.skipped += 1;
              continue;
            }
          }
        } finally {
          await deps.discard(made);
        }
      } else {
        // "point": a file is there that no set names yet. Verify before trusting.
        const { problems, originalPresent } = await deps.verifyStoredProxy(entry.videoFileId, proxyId);
        if (problems.length > 0) {
          if (originalPresent) {
            deps.log(`  ${entry.rowId}: stored proxy ${proxyId} failed verification (${problems.join("; ")}); deleted, left on the original`);
            await deps.deleteProxy(entry.videoFileId, proxyId);
            deps.noteFailure(entry.videoFileId, problems.join("; "));
          } else {
            // The only copy left. Not ours to destroy on a failed check.
            deps.log(`  ${entry.rowId}: stored proxy ${proxyId} failed verification (${problems.join("; ")}) and the original is gone; left alone`);
          }
          result.rejected += 1;
          continue;
        }
      }

      if (!(await stillWants(entry))) {
        deps.log(`  ${entry.rowId}: changed since the plan; not pointed (its proxy file, if any, is the sweep's)`);
        result.changed += 1;
        continue;
      }
      await deps.pointSet({
        rowId: entry.rowId,
        athleteId: entry.athleteId,
        videoFileId: entry.videoFileId,
        videoProxyId: proxyId,
      });
      deps.noteSuccess(entry.videoFileId);
      result.pointed += 1;
    } catch (error) {
      deps.log(`  ${entry.rowId}: failed -- ${message(error)}`);
      deps.noteFailure(entry.videoFileId, message(error));
      result.failed += 1;
    }
  }
  return result;
}

/* -------------------------------------------------------------------------
 * Prune: deleting originals once their proxy has stood in for seven days.
 * Never part of the default run.
 * ---------------------------------------------------------------------- */

export interface PruneDeps {
  setsWithClips(): Promise<Row[]>;
  getSet(rowId: string): Promise<Row | null>;
  proxyFile(proxyId: string): Promise<StoredProxy | null>;
  /** Whether the original is still in the clip bucket. */
  originalExists(clipFileId: string): Promise<boolean>;
  /** Deletes through the write helper (`deletePrunedOriginal`). */
  deleteOriginal(original: PrunableOriginal): Promise<void>;
  permissionsFor(athleteId: string): string[];
  now(): Date;
  log(line: string): void;
}

export type PruneKind =
  /** Every check passes: the original can go. */
  | "prune"
  /** The proxy plays but is younger than the wait. */
  | "too-young"
  /** Pointed, but the proxy file is missing, unfinished or mis-stamped: kept, and worth a look. */
  | "untrusted"
  /** Another set names the same clip and does not play its proxy: kept. */
  | "shared"
  /** Already pruned. */
  | "gone";

export interface PruneEntry {
  kind: PruneKind;
  rowId: string;
  videoFileId: string;
  reason?: string;
}

export interface PrunePlan {
  entries: PruneEntry[];
  /** Sets with a clip and no proxy yet: nothing to prune. */
  unproxied: number;
}

export async function planPrune(deps: Omit<PruneDeps, "getSet" | "deleteOriginal" | "log">): Promise<PrunePlan> {
  const rows = await deps.setsWithClips();
  const now = deps.now();
  // A clip one set plays from its proxy and another plays as the original
  // must keep its original.
  const byClip = new Map<string, Row[]>();
  for (const row of rows) {
    const clip = str(row.video_file_id);
    if (clip) byClip.set(clip, [...(byClip.get(clip) ?? []), row]);
  }

  const entries: PruneEntry[] = [];
  let unproxied = 0;
  for (const row of rows) {
    const videoFileId = str(row.video_file_id);
    if (!videoFileId) continue;
    const proxyId = proxyOf(row);
    if (!proxyId) {
      unproxied += 1;
      continue;
    }
    const base = { rowId: row.$id, videoFileId };
    if (byClip.get(videoFileId)!.some((other) => proxyOf(other) !== proxyId)) {
      entries.push({ ...base, kind: "shared" });
      continue;
    }
    const verdict = clearForPrune({ row, clipFileId: videoFileId, proxy: await deps.proxyFile(proxyId), permissionsFor: deps.permissionsFor, now });
    if (!verdict.ok) {
      entries.push({ ...base, kind: verdict.tooYoung ? "too-young" : "untrusted", reason: verdict.reason });
      continue;
    }
    entries.push({ ...base, kind: (await deps.originalExists(videoFileId)) ? "prune" : "gone" });
  }
  return { entries, unproxied };
}

export interface PruneResult {
  deleted: number;
  /** Re-checked immediately before the delete and no longer clear. */
  changed: number;
  /** Already gone by the time of the delete. */
  gone: number;
  failed: number;
}

/** Deletes. Every original is re-checked against a fresh read just before it goes. */
export async function applyPrune(plan: PrunePlan, deps: PruneDeps): Promise<PruneResult> {
  const result: PruneResult = { deleted: 0, changed: 0, gone: 0, failed: 0 };
  for (const entry of plan.entries) {
    if (entry.kind !== "prune") continue;
    try {
      const row = await deps.getSet(entry.rowId);
      const proxyId = proxyIdFor(entry.videoFileId);
      const verdict = clearForPrune({
        row,
        clipFileId: entry.videoFileId,
        proxy: proxyId ? await deps.proxyFile(proxyId) : null,
        permissionsFor: deps.permissionsFor,
        now: deps.now(),
      });
      if (!verdict.ok) {
        deps.log(`  ${entry.rowId}: kept -- ${verdict.reason}`);
        result.changed += 1;
        continue;
      }
      try {
        await deps.deleteOriginal(verdict.original);
        result.deleted += 1;
        deps.log(`  pruned   set_videos/${entry.videoFileId} (set ${entry.rowId} plays ${verdict.original.proxyId})`);
      } catch (error) {
        if ((error as { code?: unknown })?.code !== 404) throw error;
        result.gone += 1;
      }
    } catch (error) {
      deps.log(`  ${entry.rowId}: failed -- ${message(error)}`);
      result.failed += 1;
    }
  }
  return result;
}
