"use client";

import { browserAppwrite } from "@/appwrite/browser-client";
import { POSTER_BUCKET, posterIdFor, posterPermissions } from "@/appwrite/documents";
import { browserCapture, capturePoster, posterExtension, type Poster } from "./poster-capture";

/**
 * Making a clip's poster and putting it in storage (F12).
 *
 * A plain `createFile`, not the resumable transport: a poster is a few tens of
 * kilobytes, one request, and if it does not land the clip simply goes without
 * one. Stamped with `posterPermissions`, which is `videoPermissions` -- the
 * clip's own audience, nobody wider.
 *
 * The id is the clip's plus `_poster` (appwrite/documents/poster.ts), so a
 * retry, a resumed upload or the backfill all aim at the same file: a 409
 * means it is already there, which is what this wanted.
 *
 * Returns the poster id or null, and never throws: every caller is on the
 * path that attaches a clip, and a poster is not worth losing a clip over.
 */

/** Past this the clip is attached without a poster rather than kept waiting. */
export const POSTER_UPLOAD_TIMEOUT_MS = 10_000;

/**
 * Starts the grab and the upload together, as soon as the clip is picked, so
 * the poster id is claimed by the athlete while the clip is still uploading
 * and, on anything but a short clip, is settled before the clip is.
 */
export function startPoster(clip: Blob, clipFileId: string, athleteId: string): Promise<string | null> {
  return capturePosterFor(clip).then((poster) => uploadPoster(clipFileId, athleteId, poster));
}

export interface PosterUploadDeps {
  capture: (clip: Blob) => Promise<Poster | null>;
  createFile: (params: { bucketId: string; fileId: string; file: File; permissions: string[] }) => Promise<unknown>;
  getFile: (params: { bucketId: string; fileId: string }) => Promise<{ $permissions: string[] }>;
  timeoutMs: number;
}

const defaultDeps = (): PosterUploadDeps => ({
  capture: (clip) => capturePoster(clip, browserCapture),
  createFile: (params) => browserAppwrite().storage.createFile(params),
  getFile: (params) => browserAppwrite().storage.getFile(params),
  timeoutMs: POSTER_UPLOAD_TIMEOUT_MS,
});

const samePermissions = (a: readonly string[], b: readonly string[]) => {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((value, i) => value === y[i]);
};

/** Starts the frame grab. Separate from the upload so it can run while the clip uploads. */
export function capturePosterFor(clip: Blob, deps: Pick<PosterUploadDeps, "capture"> = defaultDeps()): Promise<Poster | null> {
  return deps.capture(clip).catch((error: unknown) => {
    console.warn("poster: capture failed", error);
    return null;
  });
}

/**
 * Uploads a captured poster for `clipFileId`. Null when there was nothing to
 * upload, the clip id leaves no room for a poster id, or the upload failed.
 */
export async function uploadPoster(
  clipFileId: string,
  athleteId: string,
  poster: Poster | null,
  deps: Partial<PosterUploadDeps> = {},
): Promise<string | null> {
  const { createFile, getFile, timeoutMs } = { ...defaultDeps(), ...deps };
  const posterId = posterIdFor(clipFileId);
  if (!poster || !posterId) return null;
  const permissions = posterPermissions({ athleteId });

  const upload = createFile({
    bucketId: POSTER_BUCKET,
    fileId: posterId,
    file: new File([poster.blob], `poster.${posterExtension(poster.type)}`, { type: poster.type }),
    permissions,
  }).then(
    () => posterId,
    async (error: unknown) => {
      if ((error as { code?: unknown })?.code !== 409) {
        console.warn("poster: upload failed; the clip is attached without one", error);
        return null;
      }
      // Already there: a retry, a resumed upload, or the backfill. Or someone
      // else -- the circle can list the clip bucket and so learn a clip id
      // while it uploads, and the bucket grants create to any session. So
      // the file is trusted only if it carries exactly this athlete's poster
      // stamp; anything else and the set gets no poster rather than theirs.
      try {
        const existing = await getFile({ bucketId: POSTER_BUCKET, fileId: posterId });
        if (samePermissions(existing.$permissions, permissions)) return posterId;
        console.warn(`poster: ${posterId} exists with other permissions; not attaching it`);
      } catch (readError) {
        console.warn("poster: could not check the existing poster", readError);
      }
      return null;
    },
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`poster: upload took over ${timeoutMs}ms; the clip is attached without one`);
      resolve(null);
    }, timeoutMs);
  });
  try {
    return await Promise.race([upload, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
