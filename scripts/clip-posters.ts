/**
 * Posters for clips that have none (F12) -- the logic of `npm run clips:posters`.
 *
 * The phone grabs a poster frame at upload from v17 on. Everything filmed
 * before that, and any clip whose phone could not decode it (some Android
 * HEVC, a frame grab that timed out), has a clip and no poster, and shows the
 * camera placeholder. This makes the missing ones with ffmpeg, beside the
 * Appwrite instance, and points each set at its poster.
 *
 * Pure orchestration over injected deps, so it is tested without a server or
 * ffmpeg; scripts/backfill-clip-posters.mts wires the real ones.
 *
 * Idempotent, by construction rather than by care:
 *   - the poster id is derived from the clip id (appwrite/documents/poster.ts),
 *     so a re-run aims at the same file, and a 409 means it is there;
 *   - a set whose `video_poster_id` already names its clip's poster is skipped,
 *     so a second run reports nothing to do;
 *   - a run that died between upload and pointing finds the file, checks it,
 *     and only points the set.
 *
 * Squatting. The bucket grants create to any signed-in user, so a file could
 * exist at a poster id that someone other than the athlete uploaded. A set is
 * pointed at an existing file only if its permissions are exactly
 * `posterPermissions` for that set's athlete; anything else is reported and
 * left alone for a human.
 *
 * Races. The athlete may replace or remove the clip while this runs. The row is
 * re-read immediately before the write and skipped if its clip changed or it
 * gained a poster meanwhile; the write itself names only the poster column
 * (appwrite/documents/poster-admin.ts), so a stale read cannot put an old clip
 * back.
 */
import { posterIdFor, posterOf } from "../appwrite/documents/poster";

export type Row = Record<string, unknown> & { $id: string };

export interface PosterBackfillDeps {
  /** Authentic sets with a clip, every one, in a stable order. */
  setsWithClips(): Promise<Row[]>;
  /** The set as it is now, or null if it is gone. */
  getSet(rowId: string): Promise<Row | null>;
  /** The poster file's permissions, or null if there is no such file. */
  posterFile(posterId: string): Promise<{ $permissions: string[] } | null>;
  /** A JPEG frame of the clip. Throws if the clip cannot be read or decoded. */
  renderPoster(clipFileId: string): Promise<Uint8Array>;
  /** Uploads at `posterId` with `permissions`. A 409 is the caller's to handle. */
  uploadPoster(posterId: string, bytes: Uint8Array, permissions: string[]): Promise<void>;
  /** Points the set at the poster, through the write helper. */
  pointSet(input: { rowId: string; athleteId: string; videoFileId: string; videoPosterId: string }): Promise<void>;
  /** `posterPermissions` for an athlete. Injected so the test and the script share the policy. */
  permissionsFor(athleteId: string): string[];
  log(line: string): void;
}

export type PlanKind =
  /** No file yet: render one, upload it, point the set. */
  | "render"
  /** The right file is there (an earlier run, or the phone uploaded and the attach never landed): point the set. */
  | "point"
  /** A file is there with permissions other than this athlete's poster stamp: left alone. */
  | "squatted"
  /** The clip id is too long to derive a poster id from. Hand-made fixtures only. */
  | "no-room";

export interface PlanEntry {
  kind: PlanKind;
  rowId: string;
  athleteId: string;
  videoFileId: string;
  posterId: string | null;
}

export interface Plan {
  entries: PlanEntry[];
  /** Sets with a clip whose poster is already in place. */
  done: number;
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");

const samePermissions = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().every((value, i) => value === [...b].sort()[i]);

/** Reads only. What `--yes` would do, set by set. */
export async function planPosters(deps: Pick<PosterBackfillDeps, "setsWithClips" | "posterFile" | "permissionsFor">): Promise<Plan> {
  const entries: PlanEntry[] = [];
  let done = 0;
  for (const row of await deps.setsWithClips()) {
    const videoFileId = str(row.video_file_id);
    const athleteId = str(row.athlete_id);
    if (!videoFileId || !athleteId) continue;
    if (posterOf(row) !== null) {
      done += 1;
      continue;
    }
    const posterId = posterIdFor(videoFileId);
    const base = { rowId: row.$id, athleteId, videoFileId, posterId };
    if (!posterId) {
      entries.push({ ...base, kind: "no-room" });
      continue;
    }
    const existing = await deps.posterFile(posterId);
    if (!existing) entries.push({ ...base, kind: "render" });
    else if (samePermissions(existing.$permissions, deps.permissionsFor(athleteId))) entries.push({ ...base, kind: "point" });
    else entries.push({ ...base, kind: "squatted" });
  }
  return { entries, done };
}

export interface ApplyResult {
  rendered: number;
  pointed: number;
  /** The clip changed, gained a poster, or the set went, between plan and write. */
  changed: number;
  failed: number;
  /** Left alone on purpose: squatted files and clips with no room for a poster id. */
  skipped: number;
}

const isConflict = (error: unknown) => (error as { code?: unknown })?.code === 409;

/** Writes. One set's failure is logged and the rest carry on. */
export async function applyPosters(plan: Plan, deps: PosterBackfillDeps): Promise<ApplyResult> {
  const result: ApplyResult = { rendered: 0, pointed: 0, changed: 0, failed: 0, skipped: 0 };

  for (const entry of plan.entries) {
    if (entry.kind === "squatted" || entry.kind === "no-room" || !entry.posterId) {
      result.skipped += 1;
      continue;
    }
    const posterId = entry.posterId;
    try {
      if (entry.kind === "render") {
        const bytes = await deps.renderPoster(entry.videoFileId);
        try {
          await deps.uploadPoster(posterId, bytes, deps.permissionsFor(entry.athleteId));
          result.rendered += 1;
        } catch (error) {
          if (!isConflict(error)) throw error;
          // Someone got there between plan and now -- the phone, or a second
          // run. Trust it only on the same terms as a planned "point".
          const existing = await deps.posterFile(posterId);
          if (!existing || !samePermissions(existing.$permissions, deps.permissionsFor(entry.athleteId))) {
            deps.log(`  ${entry.rowId}: a poster appeared at ${posterId} with other permissions; left alone`);
            result.skipped += 1;
            continue;
          }
        }
      }

      const now = await deps.getSet(entry.rowId);
      if (!now || str(now.video_file_id) !== entry.videoFileId || posterOf(now) !== null) {
        deps.log(`  ${entry.rowId}: changed since the plan; not pointed (its poster file, if any, is the sweep's)`);
        result.changed += 1;
        continue;
      }
      await deps.pointSet({
        rowId: entry.rowId,
        athleteId: entry.athleteId,
        videoFileId: entry.videoFileId,
        videoPosterId: posterId,
      });
      result.pointed += 1;
    } catch (error) {
      deps.log(`  ${entry.rowId}: failed -- ${error instanceof Error ? error.message : String(error)}`);
      result.failed += 1;
    }
  }
  return result;
}

/** The ffmpeg arguments for one frame: half a second in, longer edge 320px, JPEG. */
export function ffmpegArgs(input: string, output: string, seekSeconds: number): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    // Before -i: a fast keyframe seek, then decode to the exact time.
    "-ss",
    String(seekSeconds),
    "-i",
    input,
    "-frames:v",
    "1",
    // ffmpeg applies the phone's rotation flag itself (autorotate is on by
    // default), so a portrait iPhone clip comes out upright. Longer edge 320,
    // aspect kept, even dimensions -- the phone's poster-capture.ts sizes.
    "-vf",
    "scale=320:320:force_original_aspect_ratio=decrease:force_divisible_by=2",
    "-q:v",
    "5",
    "-y",
    output,
  ];
}
