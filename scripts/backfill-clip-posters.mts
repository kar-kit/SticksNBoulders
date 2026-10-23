/**
 * Makes posters for clips that have none (F12, schema v17).
 *
 *   npm run clips:posters              # plans, reads only, writes nothing
 *   npm run clips:posters -- --yes     # renders, uploads, points the sets
 *
 * Run on forge, beside the Appwrite instance: every clip without a poster is
 * downloaded once (streamed to a temp file, never held in memory), a frame is
 * taken with ffmpeg, and the temp files are removed as it goes. Needs ffmpeg
 * on PATH, or SNB_FFMPEG pointing at one. Schema v17 must be applied first
 * (`npm run appwrite:setup`): without the bucket and the column there is
 * nothing to write to, and the plan says so.
 *
 * The logic, and why it is safe to re-run, is in scripts/clip-posters.ts.
 */
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { Query, Storage, TablesDB } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { isAuthentic } from "../appwrite/documents/provenance";
import { POSTER_BUCKET } from "../appwrite/documents/poster";
import { posterPermissions } from "../appwrite/documents/policy";
import { setPosterOnSet } from "../appwrite/documents/poster-admin";
import type { RowWriter } from "../appwrite/documents/row-writer";
import { VIDEO_BUCKET } from "../lib/video/bucket";
import { appwriteBucketSource } from "./backup-driver";
import { applyPosters, ffmpegArgs, planPosters, type PosterBackfillDeps, type Row } from "./clip-posters";

dedupeSdkWarnings();
const run = promisify(execFile);

const confirmed = process.argv.includes("--yes");
const FFMPEG = process.env.SNB_FFMPEG || "ffmpeg";
const PAGE = 100;

const config = serverAppwriteConfig();
const client = createServerClient(config);
const db = new TablesDB(client);
const storage = new Storage(client);
const clips = appwriteBucketSource(storage, {
  endpoint: config.endpoint,
  projectId: config.projectId,
  apiKey: config.apiKey,
  bucketIds: [VIDEO_BUCKET],
});
// Matched on the code, not instanceof: under tsx the SDK can load twice, so its class is not always ours.
const notFound = (error: unknown) => (error as { code?: unknown })?.code === 404;

console.log(`${confirmed ? "Making posters on" : "Dry run: planning posters on"} ${config.endpoint}`);
console.log(`  project ${config.projectId}, database ${config.databaseId}\n`);

if (confirmed) {
  // Before anything is read: a run that plans 300 renders and then finds no
  // ffmpeg has wasted nobody's time but is still a confusing way to fail.
  try {
    await run(FFMPEG, ["-version"]);
  } catch {
    console.error(`ffmpeg not found (${FFMPEG}). Install it (apt install ffmpeg) or set SNB_FFMPEG.`);
    process.exit(1);
  }
}

const workDir = await mkdtemp(join(tmpdir(), "snb-posters-"));

/** Admin writes, through the helper's narrow interface. */
const writer: RowWriter = {
  createRow: () => Promise.reject(new Error("clips:posters creates no rows")),
  deleteRow: () => Promise.reject(new Error("clips:posters deletes no rows")),
  updateRow: (params) => db.updateRow(params) as unknown as ReturnType<RowWriter["updateRow"]>,
};

async function renderPoster(clipFileId: string): Promise<Uint8Array> {
  const source = await clips.download(VIDEO_BUCKET, clipFileId);
  if (!source) throw new Error(`clip ${clipFileId} is not in the bucket`);
  const input = join(workDir, `${clipFileId}.clip`);
  const output = join(workDir, `${clipFileId}.jpg`);
  try {
    await pipeline(source, createWriteStream(input));
    // Half a second in, past the black first frame; a clip shorter than that
    // yields no frame, so try once more from the start.
    for (const seek of [0.5, 0]) {
      await run(FFMPEG, ffmpegArgs(input, output, seek), { timeout: 60_000 });
      const size = await stat(output).then((s) => s.size, () => 0);
      if (size > 0) return new Uint8Array(await readFile(output));
    }
    throw new Error("ffmpeg produced no frame");
  } finally {
    await rm(input, { force: true });
    await rm(output, { force: true });
  }
}

const deps: PosterBackfillDeps = {
  async setsWithClips() {
    const rows: Row[] = [];
    let cursor: string | null = null;
    for (;;) {
      const queries = [Query.isNotNull("video_file_id"), Query.orderAsc("$id"), Query.limit(PAGE)];
      if (cursor) queries.push(Query.cursorAfter(cursor));
      const page = await db.listRows({ databaseId: config.databaseId, tableId: "sets", queries, ttl: 0 });
      if (page.rows.length === 0) break;
      // Only sets their athlete wrote: a forged set gets no poster, and no
      // file stamped with anyone's permissions on its account.
      for (const row of page.rows) {
        if (isAuthentic("sets", row as unknown as Record<string, unknown>)) rows.push(row as unknown as Row);
      }
      cursor = page.rows[page.rows.length - 1].$id;
    }
    return rows;
  },
  async getSet(rowId) {
    try {
      return (await db.getRow({ databaseId: config.databaseId, tableId: "sets", rowId })) as unknown as Row;
    } catch (error) {
      if (notFound(error)) return null;
      throw error;
    }
  },
  async posterFile(posterId) {
    try {
      const file = await storage.getFile({ bucketId: POSTER_BUCKET, fileId: posterId });
      return { $permissions: file.$permissions };
    } catch (error) {
      if (notFound(error)) return null;
      throw error;
    }
  },
  renderPoster,
  async uploadPoster(posterId, bytes, permissions) {
    await storage.createFile({
      bucketId: POSTER_BUCKET,
      fileId: posterId,
      // A plain File, as appwrite-audit uploads: node-appwrite/file can load as a second copy of the SDK,
      // whose InputFile the client then fails to recognise ("File not found in payload").
      file: new File([Buffer.from(bytes)], "poster.jpg", { type: "image/jpeg" }),
      permissions,
    });
  },
  pointSet: async (input) => {
    await setPosterOnSet(writer, config.databaseId, input);
  },
  permissionsFor: (athleteId) => posterPermissions({ athleteId }),
  log: (line) => console.log(line),
};

try {
  const plan = await planPosters(deps);
  const count = (kind: string) => plan.entries.filter((e) => e.kind === kind).length;
  console.log(`${plan.done + plan.entries.length} set(s) with a clip, ${plan.done} already have a poster`);
  console.log(`  ${count("render")} to render and point`);
  console.log(`  ${count("point")} poster file already there, set to point`);
  console.log(`  ${count("squatted")} file at the poster id with other permissions (left alone)`);
  console.log(`  ${count("no-room")} clip id too long for a poster id (left alone)\n`);
  for (const entry of plan.entries.filter((e) => e.kind === "squatted")) {
    console.log(`  squatted: ${POSTER_BUCKET}/${entry.posterId} for set ${entry.rowId}`);
  }

  const todo = count("render") + count("point");
  if (todo === 0) {
    console.log("Nothing to do.");
  } else if (!confirmed) {
    console.log("Nothing written. Re-run with -- --yes to make them.");
  } else {
    const result = await applyPosters(plan, deps);
    console.log(
      `\n${result.rendered} rendered, ${result.pointed} set(s) pointed, ${result.changed} changed meanwhile, ` +
        `${result.skipped} skipped, ${result.failed} failed.`,
    );
    if (result.failed > 0) process.exitCode = 1;
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
}
