/**
 * Records which clip each pre-v18 review cleared (schema v18).
 *
 *   npm run reviews:clips              # plans, reads only, writes nothing
 *   npm run reviews:clips -- --yes     # stamps, and re-queues replaced clips
 *
 * Optional. Without it every pre-v18 review keeps counting for whatever clip
 * its set carries, exactly as before v18; with it, a clip cleared before v18
 * comes back when the athlete replaces it, and one already replaced since it
 * was cleared comes back now. Schema v18 must be applied first
 * (`npm run appwrite:setup`): without the column there is nothing to write.
 *
 * The logic, and why it is safe to re-run, is in scripts/review-clips.ts.
 */
import { AppwriteException, Query, Storage, TablesDB } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { isAuthentic } from "../appwrite/documents/provenance";
import { requeueReview, stampReviewClip } from "../appwrite/documents/review-admin";
import type { RowWriter } from "../appwrite/documents/row-writer";
import { VIDEO_BUCKET } from "../lib/video/bucket";
import { applyReviewClips, planReviewClips, type ReviewClipsDeps, type Row } from "./review-clips";

dedupeSdkWarnings();

const confirmed = process.argv.includes("--yes");
const PAGE = 100;

const config = serverAppwriteConfig();
const client = createServerClient(config);
const db = new TablesDB(client);
const storage = new Storage(client);
const notFound = (error: unknown) => error instanceof AppwriteException && error.code === 404;

console.log(`${confirmed ? "Stamping reviews on" : "Dry run: planning reviews on"} ${config.endpoint}`);
console.log(`  project ${config.projectId}, database ${config.databaseId}\n`);

/** Admin writes, through the helper's narrow interface. */
const writer: RowWriter = {
  createRow: () => Promise.reject(new Error("reviews:clips creates no rows")),
  updateRow: (params) => db.updateRow(params) as unknown as ReturnType<RowWriter["updateRow"]>,
  deleteRow: (params) => db.deleteRow(params),
};

const getRow = async (tableId: string, rowId: string): Promise<Row | null> => {
  try {
    const row = (await db.getRow({ databaseId: config.databaseId, tableId, rowId })) as unknown as Row;
    // Only rows their owner wrote: a forged review or set is left alone.
    return isAuthentic(tableId, row) ? row : null;
  } catch (error) {
    if (notFound(error)) return null;
    throw error;
  }
};

const deps: ReviewClipsDeps = {
  async legacyReviews() {
    const rows: Row[] = [];
    let cursor: string | null = null;
    for (;;) {
      const queries = [Query.isNull("video_file_id"), Query.orderAsc("$id"), Query.limit(PAGE)];
      if (cursor) queries.push(Query.cursorAfter(cursor));
      const page = await db.listRows({ databaseId: config.databaseId, tableId: "set_reviews", queries, ttl: 0 });
      if (page.rows.length === 0) break;
      for (const row of page.rows) {
        if (isAuthentic("set_reviews", row as unknown as Record<string, unknown>)) rows.push(row as unknown as Row);
      }
      cursor = page.rows[page.rows.length - 1].$id;
    }
    return rows;
  },
  getReview: (rowId) => getRow("set_reviews", rowId),
  getSet: (rowId) => getRow("sets", rowId),
  async clipCreatedAt(fileId) {
    try {
      return (await storage.getFile({ bucketId: VIDEO_BUCKET, fileId })).$createdAt;
    } catch (error) {
      if (notFound(error)) return null;
      throw error;
    }
  },
  stamp: async (input) => {
    await stampReviewClip(writer, config.databaseId, input);
  },
  requeue: async (rowId) => {
    await requeueReview(writer, config.databaseId, rowId);
  },
  log: (line) => console.log(line),
};

const entries = await planReviewClips(deps);
const count = (kind: string) => entries.filter((e) => e.kind === kind).length;
console.log(`${entries.length} review(s) from before v18`);
console.log(`  ${count("stamp")} to stamp with the clip the coach watched`);
console.log(`  ${count("requeue")} whose clip was replaced after the review: back to the queue`);
console.log(`  ${count("skip")} left alone\n`);
for (const entry of entries.filter((e) => e.kind !== "stamp")) {
  console.log(`  ${entry.kind}: review ${entry.rowId} (set ${entry.setId})${entry.reason ? ` -- ${entry.reason}` : ""}`);
}

if (count("stamp") + count("requeue") === 0) {
  console.log("Nothing to do.");
} else if (!confirmed) {
  console.log("Nothing written. Re-run with -- --yes to apply.");
} else {
  const result = await applyReviewClips(entries, deps);
  console.log(
    `\n${result.stamped} stamped, ${result.requeued} re-queued, ${result.changed} changed meanwhile, ${result.failed} failed.`,
  );
  if (result.failed > 0) process.exitCode = 1;
}
