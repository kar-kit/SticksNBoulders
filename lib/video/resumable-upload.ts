"use client";

import { browserAppwrite } from "@/appwrite/browser-client";
import { videoPermissions } from "@/appwrite/documents/policy";
import { publicAppwriteConfig } from "@/appwrite/env";
import { CHUNK_BYTES, chunkRanges, contentRange, isComplete, percentDone, remainingChunks } from "./chunks";
import { VIDEO_BUCKET } from "./bucket";

/**
 * A chunked upload that survives a dropped connection.
 *
 * Hand-rolled rather than using `storage.createFile`, and the reason is
 * specific: the SDK's `chunkedUpload` always starts at chunk 0, takes no
 * existing upload id and never asks the server what it already has, so a drop
 * on gym wifi costs the whole file. Verified by reading the SDK, and it is the
 * entire justification for this module existing.
 *
 * Three facts about the server make this safe, all verified against the
 * instance rather than assumed:
 *
 *   1. The upload id IS the file id we choose, so a half-finished upload is
 *      addressable from state we already hold -- including after a reload.
 *   2. A user session can read `chunksUploaded` on an incomplete file, so the
 *      client can discover its own resume point without a server route.
 *   3. Re-sending a chunk the server already has is idempotent: the count does
 *      not double-count. So a response lost in flight is harmless, and this
 *      errs toward sending again rather than stranding an upload.
 *
 * Sequential, deliberately. Appwrite reports progress as a COUNT, not a map of
 * which ranges landed, so uploading in order is what makes that number a
 * resume point. Parallel chunks do assemble correctly -- also verified -- but
 * then "four uploaded" cannot tell you which four, and resume is guesswork. On
 * gym wifi, resumable beats fast.
 */

export interface UploadHandle {
  fileId: string;
  /** 0-100. Counts only chunks the server has confirmed. */
  onProgress?: (percent: number) => void;
  /** Lets the caller stop without the upload being treated as failed. */
  signal?: AbortSignal;
}

export type ChunkOutcome =
  | { ok: true; complete: boolean; uploadedCount: number }
  | { ok: false; retryable: boolean; authExpired?: true; message: string };

/** What the caller is told when no JWT can be had: the clip waits, it is not refused. */
const SIGNED_OUT = { ok: false, retryable: true, authExpired: true, message: "Not signed in" } as const;

/**
 * Statuses that say "not now" rather than "never": an expired token, a
 * timeout, a rate limit. The same set the offline queue's `classify` retries,
 * less 403 -- on a create, Appwrite's 403 is the bucket refusing the file.
 */
const TRANSIENT_4XX = new Set([401, 408, 429]);

const endpoint = () =>
  publicAppwriteConfig({
    NEXT_PUBLIC_APPWRITE_ENDPOINT: process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT,
    NEXT_PUBLIC_APPWRITE_PROJECT_ID: process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID,
    NEXT_PUBLIC_APPWRITE_DATABASE_ID: process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID,
  });

/**
 * How far the server already got, or 0 if it has never seen this id.
 *
 * A missing file is not an error -- it is the normal answer for an upload that
 * has not started -- so it resolves to zero rather than throwing.
 */
export async function uploadedSoFar(fileId: string): Promise<number> {
  try {
    const file = await browserAppwrite().storage.getFile({
      bucketId: VIDEO_BUCKET,
      fileId,
    });
    const uploaded = (file as unknown as { chunksUploaded?: number }).chunksUploaded;
    return typeof uploaded === "number" ? uploaded : 0;
  } catch {
    return 0;
  }
}

/** Sends one chunk. The retry policy lives with the caller, not here. */
async function sendChunk(
  blob: Blob,
  fileId: string,
  athleteId: string,
  name: string,
  range: { start: number; end: number },
  jwt: string,
  signal?: AbortSignal,
): Promise<ChunkOutcome> {
  const config = endpoint();

  const form = new FormData();
  form.append("fileId", fileId);
  for (const permission of videoPermissions({ athleteId })) {
    form.append("permissions[]", permission);
  }
  form.append("file", new File([blob.slice(range.start, range.end + 1)], name), name);

  try {
    const response = await fetch(`${config.endpoint}/storage/buckets/${VIDEO_BUCKET}/files`, {
      method: "POST",
      headers: {
        "x-appwrite-project": config.projectId,
        "x-appwrite-jwt": jwt,
        // Absolute offsets into the WHOLE file and the whole file's size --
        // not the slice's. The slice is only the bytes on the wire; the header
        // is what tells Appwrite where they belong.
        "content-range": contentRange({ index: 0, ...range }, blob.size),
        "x-appwrite-id": fileId,
      },
      body: form,
      signal,
    });

    const body = (await response.json().catch(() => ({}))) as {
      chunksUploaded?: number;
      chunksTotal?: number;
      message?: string;
    };

    if (!response.ok) {
      const message = body.message ?? `Upload failed (${response.status})`;
      // An expired JWT is the token's age, not a verdict on the file. The
      // caller mints a fresh one; dropping the clip here is how an athlete
      // lost a 15-minute upload to a 15-minute token.
      if (response.status === 401) return { ok: false, retryable: true, authExpired: true, message };
      // Any other 4xx is the server saying no -- a file too large, a bad
      // type. Retrying that forever is a loop, not resilience. 5xx, timeouts,
      // rate limits and network failures are worth another go.
      return {
        ok: false,
        retryable: response.status >= 500 || TRANSIENT_4XX.has(response.status),
        message,
      };
    }

    const uploadedCount = body.chunksUploaded ?? 0;
    return {
      ok: true,
      uploadedCount,
      complete: isComplete(uploadedCount, body.chunksTotal ?? 0),
    };
  } catch (error) {
    if (signal?.aborted) return { ok: false, retryable: false, message: "Cancelled" };
    // A dropped connection, which is the case this whole module exists for.
    return { ok: false, retryable: true, message: (error as Error).message };
  }
}

export type UploadResult =
  | { ok: true; fileId: string }
  | {
      ok: false;
      retryable: boolean;
      /** No usable session: the clip waits for the athlete to sign back in. */
      authExpired?: true;
      message: string;
      uploadedCount: number;
    };

async function mintJwt(): Promise<string | null> {
  try {
    return (await browserAppwrite().account.createJWT()).jwt;
  } catch {
    return null;
  }
}

/**
 * Uploads what the server does not already have.
 *
 * Safe to call again on the same file id after a failure: it asks the server
 * where it got to and carries on from there, which is the whole point.
 */
export async function uploadResumable(
  blob: Blob,
  { fileId, athleteId, name }: { fileId: string; athleteId: string; name: string },
  { onProgress, signal }: Omit<UploadHandle, "fileId"> = {},
): Promise<UploadResult> {
  const ranges = chunkRanges(blob.size, CHUNK_BYTES);
  if (ranges.length === 0) {
    return { ok: false, retryable: false, message: "That file is empty.", uploadedCount: 0 };
  }

  // One JWT for the whole attempt, not one per chunk. Appwrite's JWTs last 15
  // minutes and a 150MB clip is 30 chunks -- minting one each would be 30
  // avoidable round trips before any bytes move, on exactly the connection
  // this module exists to tolerate. The cost is that a slow upload can
  // outlive its token, which is what the one refresh below is for.
  let jwt = await mintJwt();
  if (!jwt) return { ...SIGNED_OUT, uploadedCount: 0 };
  let refreshed = false;

  let uploadedCount = await uploadedSoFar(fileId);
  onProgress?.(percentDone(uploadedCount, ranges.length));

  for (const range of remainingChunks(ranges, uploadedCount)) {
    if (signal?.aborted) {
      return { ok: false, retryable: true, message: "Cancelled", uploadedCount };
    }

    let outcome = await sendChunk(blob, fileId, athleteId, name, range, jwt, signal);
    if (!outcome.ok && outcome.authExpired && !refreshed) {
      // Once per attempt. A fresh token refused as well means the session is
      // gone, and minting in a loop would only hammer the server about it.
      refreshed = true;
      const fresh = await mintJwt();
      if (!fresh) return { ...SIGNED_OUT, uploadedCount };
      jwt = fresh;
      // The refused chunk never landed, so it is the one to send again.
      outcome = await sendChunk(blob, fileId, athleteId, name, range, jwt, signal);
      // Refused again with a JWT minted a moment ago: the 401 was never about
      // the session. An athlete with no circle team gets exactly this, on the
      // first chunk, with a message about permissions (scripts/e2e-video.mts).
      // That is a refusal, and a refusal held as pending is retried forever.
      if (!outcome.ok && outcome.authExpired) {
        outcome = { ok: false, retryable: false, message: outcome.message };
      }
    }
    if (!outcome.ok) {
      return { ...outcome, uploadedCount };
    }

    uploadedCount = outcome.uploadedCount;
    onProgress?.(percentDone(uploadedCount, ranges.length));
    if (outcome.complete) return { ok: true, fileId };
  }

  // Every chunk sent. The server agreeing is what makes it finished, so this
  // asks rather than assuming -- a lost final response would otherwise report
  // success on an incomplete file.
  const final = await uploadedSoFar(fileId);
  return isComplete(final, ranges.length)
    ? { ok: true, fileId }
    : {
        ok: false,
        retryable: true,
        message: "Upload did not finish",
        uploadedCount: final,
      };
}
