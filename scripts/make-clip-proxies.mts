/**
 * Makes a normalised H.264 proxy of every clip and points each set at it
 * (schema v22, docs/video-proxy.md).
 *
 *   npm run clips:proxies                          # plans, reads only, writes nothing
 *   npm run clips:proxies -- --yes                 # makes, verifies, uploads, points
 *   npm run clips:proxies -- --yes --retry-failed  # ...including clips that failed in the last day
 *   npm run clips:proxies -- --prune               # plans which originals could go, deletes nothing
 *   npm run clips:proxies -- --prune --yes         # deletes originals whose proxy has played for 7+ days
 *
 * Run on forge, beside the Appwrite instance, every minute from a systemd
 * timer (the unit is in docs/video-proxy.md). One clip at a time: the original
 * is streamed to a temp file, ffmpeg runs under `nice -n 19`, the output is
 * probed and its box layout read, and only a proxy that passes is uploaded.
 * Temp files go as it goes.
 *
 * Needs ffmpeg and ffprobe on PATH, or SNB_FFMPEG / SNB_FFPROBE. HDR clips
 * additionally need an ffmpeg with zscale (libzimg); without it they fail with
 * a message saying so and stay on their original. Schema v22 must be applied
 * first (`npm run appwrite:setup`).
 *
 * State, outside the checkout: a lock so a manual run and the timer never
 * overlap, and a ledger of clips that failed so one bad clip is retried once
 * a day, not re-downloaded every minute. SNB_PROXY_STATE moves both.
 *
 * The logic, and why it is safe to re-run, is in scripts/clip-proxies.ts.
 */
import { execFile } from "node:child_process";
import { createWriteStream, openAsBlob } from "node:fs";
import { mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { Query, Storage, TablesDB } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { isAuthentic } from "../appwrite/documents/provenance";
import { PROXY_BUCKET } from "../appwrite/documents/proxy";
import { proxyPermissions } from "../appwrite/documents/policy";
import { setProxyOnSet } from "../appwrite/documents/proxy-admin";
import { deletePrunedOriginal, deleteWorkerProxy } from "../appwrite/documents/clip-admin";
import type { RowWriter } from "../appwrite/documents/row-writer";
import { PRUNE_AFTER_DAYS } from "../appwrite/backup/prune";
import { VIDEO_BUCKET } from "../lib/video/bucket";
import { PROXY_CAP } from "../lib/video/proxy-profile";
import { appwriteBucketSource, appwriteClipStore } from "./backup-driver";
import {
  applyPrune,
  applyProxies,
  planPrune,
  planProxies,
  type MadeProxy,
  type ProxyWorkerDeps,
  type PruneDeps,
  type Row,
} from "./clip-proxies";
import {
  moovBeforeMdat,
  parseCapabilities,
  planProxy,
  readProbe,
  topLevelBoxes,
  verifyProxy,
  type Capabilities,
  type ProbeJson,
} from "./proxy-ffmpeg";

dedupeSdkWarnings();
const run = promisify(execFile);

const args = process.argv.slice(2);
const KNOWN = new Set(["--yes", "--prune", "--retry-failed"]);
for (const arg of args) {
  // A mistyped --yes must not quietly become a dry run that looks like a run.
  if (!KNOWN.has(arg)) {
    console.error(`Unknown option ${arg}. Known: ${[...KNOWN].join(", ")}.`);
    process.exit(1);
  }
}
const confirmed = args.includes("--yes");
const pruning = args.includes("--prune");
const retryFailed = args.includes("--retry-failed");

const FFMPEG = process.env.SNB_FFMPEG || "ffmpeg";
const FFPROBE = process.env.SNB_FFPROBE || (process.env.SNB_FFMPEG ? join(dirname(process.env.SNB_FFMPEG), "ffprobe") : "ffprobe");
const STATE_DIR = process.env.SNB_PROXY_STATE || join(homedir(), ".cache", "snb-clip-proxies");
const LEDGER = join(STATE_DIR, "failures.json");
const LOCK = join(STATE_DIR, "lock");
/** A failed clip is tried again after this long, or at once with --retry-failed. */
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
/** Generous: a minute of 4K60 HEVC on a shared VM, niced, at veryfast. */
const FFMPEG_TIMEOUT_MS = 30 * 60 * 1000;
const PAGE = 100;

const config = serverAppwriteConfig();
const client = createServerClient(config);
const db = new TablesDB(client);
const storage = new Storage(client);
const files = appwriteBucketSource(storage, {
  endpoint: config.endpoint,
  projectId: config.projectId,
  apiKey: config.apiKey,
  bucketIds: [VIDEO_BUCKET, PROXY_BUCKET],
});
const store = appwriteClipStore(storage);
// Matched on the code, not instanceof: under tsx the SDK can load twice, so its class is not always ours.
const notFound = (error: unknown) => (error as { code?: unknown })?.code === 404;

/* -------------------------------------------------------------------------
 * Reads shared by both modes
 * ---------------------------------------------------------------------- */

async function setsWithClips(): Promise<Row[]> {
  const rows: Row[] = [];
  let cursor: string | null = null;
  for (;;) {
    const queries = [Query.isNotNull("video_file_id"), Query.orderAsc("$id"), Query.limit(PAGE)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const page = await db.listRows({ databaseId: config.databaseId, tableId: "sets", queries, ttl: 0 });
    if (page.rows.length === 0) break;
    // Only sets their athlete wrote: a forged set gets no proxy, and no file
    // stamped with anyone's permissions on its account.
    for (const row of page.rows) {
      if (isAuthentic("sets", row as unknown as Record<string, unknown>)) rows.push(row as unknown as Row);
    }
    cursor = page.rows[page.rows.length - 1].$id;
  }
  return rows;
}

async function getSet(rowId: string): Promise<Row | null> {
  try {
    return (await db.getRow({ databaseId: config.databaseId, tableId: "sets", rowId })) as unknown as Row;
  } catch (error) {
    if (notFound(error)) return null;
    throw error;
  }
}

async function proxyFile(proxyId: string) {
  try {
    const file = await storage.getFile({ bucketId: PROXY_BUCKET, fileId: proxyId });
    return {
      $permissions: file.$permissions,
      $createdAt: file.$createdAt,
      sizeOriginal: file.sizeOriginal,
      chunksTotal: file.chunksTotal,
      chunksUploaded: file.chunksUploaded,
    };
  } catch (error) {
    if (notFound(error)) return null;
    throw error;
  }
}

const permissionsFor = (athleteId: string) => proxyPermissions({ athleteId });

console.log(
  `${confirmed ? "" : "Dry run: "}${pruning ? "pruning originals" : "making clip proxies"} on ${config.endpoint}`,
);
console.log(`  project ${config.projectId}, database ${config.databaseId}`);
console.log(`  cap ${PROXY_CAP.longEdge}x${PROXY_CAP.shortEdge} @ ${PROXY_CAP.fps}fps\n`);

/* -------------------------------------------------------------------------
 * --prune: never part of the default run
 * ---------------------------------------------------------------------- */

if (pruning) {
  const deps: PruneDeps = {
    setsWithClips,
    getSet,
    proxyFile,
    async originalExists(clipFileId) {
      try {
        await storage.getFile({ bucketId: VIDEO_BUCKET, fileId: clipFileId });
        return true;
      } catch (error) {
        if (notFound(error)) return false;
        throw error;
      }
    },
    deleteOriginal: (original) => deletePrunedOriginal(store, original),
    permissionsFor,
    now: () => new Date(),
    log: (line) => console.log(line),
  };
  const plan = await planPrune(deps);
  const count = (kind: string) => plan.entries.filter((e) => e.kind === kind).length;
  console.log(`${plan.entries.length} set(s) play a proxy, ${plan.unproxied} still play their original`);
  console.log(`  ${count("prune")} original(s) can go: proxy verified and ${PRUNE_AFTER_DAYS}+ days old`);
  console.log(`  ${count("too-young")} proxy younger than ${PRUNE_AFTER_DAYS} days (kept)`);
  console.log(`  ${count("shared")} clip also named by a set without its proxy (kept)`);
  console.log(`  ${count("gone")} already pruned`);
  console.log(`  ${count("untrusted")} pointed at a proxy file that is missing, unfinished or mis-stamped (kept; look at these)`);
  for (const entry of plan.entries.filter((e) => e.kind === "untrusted")) {
    console.log(`    set ${entry.rowId}: ${entry.reason}`);
  }
  if (count("prune") === 0) {
    console.log("\nNothing to prune.");
  } else if (!confirmed) {
    console.log("\nNothing deleted. Re-run with -- --prune --yes to delete those originals.");
  } else {
    const result = await applyPrune(plan, deps);
    console.log(`\n${result.deleted} deleted, ${result.changed} kept after a re-check, ${result.gone} already gone, ${result.failed} failed.`);
    if (result.failed > 0) process.exitCode = 1;
  }
  process.exit();
}

/* -------------------------------------------------------------------------
 * Making proxies
 * ---------------------------------------------------------------------- */

async function capabilities(): Promise<Capabilities | null> {
  try {
    const [version, filters, encoders] = await Promise.all([
      run(FFMPEG, ["-version"]),
      run(FFMPEG, ["-hide_banner", "-filters"]),
      run(FFMPEG, ["-hide_banner", "-encoders"]),
      run(FFPROBE, ["-version"]),
    ]);
    return parseCapabilities({ version: version.stdout, filters: filters.stdout, encoders: encoders.stdout });
  } catch {
    return null;
  }
}

const caps = await capabilities();
if (!caps) {
  const line = `ffmpeg/ffprobe not found (${FFMPEG}, ${FFPROBE}). Install them (apt install ffmpeg) or set SNB_FFMPEG.`;
  if (confirmed) {
    console.error(line);
    process.exit(1);
  }
  console.log(`${line}\n`);
} else {
  console.log(
    `ffmpeg: libx264 ${caps.libx264 ? "yes" : "NO"}, HDR tone-mapping ${caps.zscale && caps.tonemap ? "yes" : "NO (zscale/tonemap missing: HDR clips will fail and stay on their original)"}\n`,
  );
}

await mkdir(STATE_DIR, { recursive: true });

type Ledger = Record<string, { at: number; reason: string }>;
const ledger: Ledger = await readFile(LEDGER, "utf8")
  .then((text) => JSON.parse(text) as Ledger)
  .catch(() => ({}));
const saveLedger = () => writeFile(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`);

/** One run at a time. A lock left by a dead process is taken over. */
async function takeLock(): Promise<boolean> {
  try {
    const handle = await open(LOCK, "wx");
    await handle.writeFile(String(process.pid));
    await handle.close();
    return true;
  } catch {
    const pid = Number(await readFile(LOCK, "utf8").catch(() => ""));
    let alive = false;
    try {
      if (pid > 0) {
        process.kill(pid, 0);
        alive = true;
      }
    } catch {
      alive = false;
    }
    if (alive) return false;
    await rm(LOCK, { force: true });
    return takeLock();
  }
}

if (confirmed && !(await takeLock())) {
  console.log("Another clips:proxies run holds the lock; leaving it to finish.");
  process.exit(0);
}

const workDir = await mkdtemp(join(tmpdir(), "snb-proxies-"));

async function probe(path: string): Promise<ProbeJson> {
  const { stdout } = await run(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", path], {
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout) as ProbeJson;
}

async function faststart(path: string): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const types = await topLevelBoxes(async (offset, length) => {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return buffer.subarray(0, bytesRead);
    }, size);
    return moovBeforeMdat(types);
  } finally {
    await handle.close();
  }
}

/** Streams a file to disk, never into memory. False when the bucket does not hold it. */
async function download(bucketId: string, fileId: string, to: string): Promise<boolean> {
  const source = await files.download(bucketId, fileId);
  if (!source) return false;
  await pipeline(source, createWriteStream(to));
  return true;
}

/** Admin writes, through the helper's narrow interface. */
const writer: RowWriter = {
  createRow: () => Promise.reject(new Error("clips:proxies creates no rows")),
  deleteRow: () => Promise.reject(new Error("clips:proxies deletes no rows")),
  updateRow: (params) => db.updateRow(params) as unknown as ReturnType<RowWriter["updateRow"]>,
};

const deps: ProxyWorkerDeps = {
  setsWithClips,
  getSet,
  proxyFile,

  async makeProxy(clipFileId) {
    if (!caps) throw new Error("ffmpeg is not available");
    const input = join(workDir, `${clipFileId}.src`);
    const output = join(workDir, `${clipFileId}.proxy.mp4`);
    try {
      if (!(await download(VIDEO_BUCKET, clipFileId, input))) return null;
      const source = readProbe(await probe(input));
      const plan = planProxy(source, caps, input, output);
      const started = Date.now();
      await run("nice", ["-n", "19", FFMPEG, ...plan.args], { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
      // The original is not needed past this point; free the disk now.
      await rm(input, { force: true });
      const problems = verifyProxy(await probe(output), source, { moovBeforeMdat: await faststart(output) });
      const size = (await stat(output)).size;
      console.log(
        `  ${clipFileId}: ${plan.mode}${plan.mode === "encode" ? ` (${plan.reasons.join(", ")})` : ""}, ` +
          `${(size / 1e6).toFixed(1)} MB in ${Math.round((Date.now() - started) / 1000)}s`,
      );
      return { path: output, size, mode: plan.mode, problems };
    } catch (error) {
      await rm(output, { force: true });
      throw error;
    } finally {
      await rm(input, { force: true });
    }
  },

  async verifyStoredProxy(clipFileId, proxyId) {
    const original = join(workDir, `${clipFileId}.src`);
    const copy = join(workDir, `${proxyId}.mp4`);
    try {
      if (!(await download(PROXY_BUCKET, proxyId, copy))) return { problems: ["the proxy file vanished"], originalPresent: true };
      const originalPresent = await download(VIDEO_BUCKET, clipFileId, original);
      const source = originalPresent ? readProbe(await probe(original)) : null;
      const problems = verifyProxy(await probe(copy), source, { moovBeforeMdat: await faststart(copy) });
      return { problems, originalPresent };
    } finally {
      await rm(original, { force: true });
      await rm(copy, { force: true });
    }
  },

  async uploadProxy(proxyId, made: MadeProxy, permissions) {
    await storage.createFile({
      bucketId: PROXY_BUCKET,
      fileId: proxyId,
      // File-backed, so the SDK's 5MB chunks are read from disk as it goes
      // rather than the whole proxy sitting in memory. A plain File, as the
      // poster backfill uploads: node-appwrite/file can load as a second copy
      // of the SDK, whose InputFile the client then fails to recognise.
      file: new File([await openAsBlob(made.path)], `${proxyId}.mp4`, { type: "video/mp4" }),
      permissions,
    });
    // What landed must be what was verified.
    const landed = await proxyFile(proxyId);
    if (!landed || landed.sizeOriginal !== made.size || landed.chunksUploaded !== landed.chunksTotal) {
      throw new Error(`uploaded ${proxyId} is ${landed?.sizeOriginal ?? "missing"} bytes, expected ${made.size}`);
    }
  },

  deleteProxy: (clipFileId, proxyId) => deleteWorkerProxy(store, { clipFileId, proxyId }),
  discard: (made) => rm(made.path, { force: true }).catch(() => {}),
  pointSet: async (input) => {
    await setProxyOnSet(writer, config.databaseId, input);
  },
  permissionsFor,
  heldBack: (clipFileId) => !retryFailed && Date.now() - (ledger[clipFileId]?.at ?? 0) < RETRY_AFTER_MS,
  noteFailure: (clipFileId, reason) => {
    ledger[clipFileId] = { at: Date.now(), reason };
  },
  noteSuccess: (clipFileId) => {
    delete ledger[clipFileId];
  },
  log: (line) => console.log(line),
};

try {
  const plan = await planProxies(deps);
  const count = (kind: string) => plan.entries.filter((e) => e.kind === kind).length;
  console.log(`${plan.done + plan.entries.length} set(s) with a clip, ${plan.done} already play a proxy`);
  console.log(`  ${count("make")} to make, verify and point`);
  console.log(`  ${count("point")} proxy file already there, to verify and point`);
  console.log(`  ${count("redo")} unfinished upload at the proxy id, to delete and make again`);
  console.log(`  ${count("held-back")} failed in the last day, retried later (--retry-failed for now)`);
  console.log(`  ${count("squatted")} file at the proxy id with other permissions (left alone)`);
  console.log(`  ${count("no-room")} clip id too long for a proxy id (left alone)\n`);
  for (const entry of plan.entries.filter((e) => e.kind === "squatted")) {
    console.log(`  squatted: ${PROXY_BUCKET}/${entry.proxyId} for set ${entry.rowId}`);
  }
  for (const entry of plan.entries.filter((e) => e.kind === "held-back")) {
    console.log(`  held back: clip ${entry.videoFileId} (set ${entry.rowId}): ${ledger[entry.videoFileId]?.reason ?? ""}`);
  }

  const todo = count("make") + count("point") + count("redo");
  if (todo === 0) {
    console.log("Nothing to do.");
  } else if (!confirmed) {
    console.log("Nothing written. Re-run with -- --yes to make them.");
  } else {
    const result = await applyProxies(plan, deps);
    await saveLedger();
    console.log(
      `\n${result.made} made, ${result.pointed} set(s) pointed, ${result.rejected} failed verification, ` +
        `${result.changed} changed meanwhile, ${result.missing} original missing, ${result.skipped} skipped, ${result.failed} failed.`,
    );
    if (result.failed > 0 || result.rejected > 0) process.exitCode = 1;
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
  if (confirmed) await rm(LOCK, { force: true });
}
