/**
 * Drives the real resumable uploader against the live instance.
 *
 *   npm run e2e:video
 *
 * The unit tests cover the chunk arithmetic in isolation. They cannot catch the
 * failure that actually matters here: a `content-range` built from the slice
 * rather than the whole file assembles into a corrupt clip and still reports
 * success. So this uploads a real multi-chunk file through
 * `uploadResumable` itself, interrupts it, resumes it, and then compares a
 * SHA-256 of what came back against what went up. Byte-exact or it failed.
 *
 * It also proves the two things the probe never covered: that a JWT is accepted
 * for a chunked WRITE (the probe only read), and that resume genuinely skips
 * what the server already holds rather than quietly re-sending the lot.
 *
 * Creates a throwaway athlete and removes them and the file. Point it at dev.
 */
import { createHash } from "node:crypto";
import { Storage, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { ensureCircle } from "../appwrite/documents/circle-admin";
import { circleTeamId } from "../appwrite/documents/circle";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { browserAppwrite } from "../appwrite/browser-client";
import { uploadResumable, uploadedSoFar } from "../lib/video/resumable-upload";
import { VIDEO_BUCKET } from "../lib/video/bucket";
import { CHUNK_BYTES } from "../lib/video/chunks";

dedupeSdkWarnings();

const config = serverAppwriteConfig();
const admin = createServerClient(config);
const users = new Users(admin);
const adminStorage = new Storage(admin);
const teams = new Teams(admin);
const stamp = Date.now();

// The browser module reads its endpoint from the public env vars, which the
// server config also carries. Same instance, different variable names.
process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT ??= config.endpoint;
process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID ??= config.projectId;
process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID ??= config.databaseId;

const results: boolean[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

/**
 * Two and a half chunks. Not a round number of chunks, deliberately: a file
 * that divides exactly never exercises the short final range, which is where
 * an off-by-one hides.
 */
const SIZE = CHUNK_BYTES * 2 + 1_234_567;
const bytes = Buffer.alloc(SIZE);
for (let i = 0; i < SIZE; i += 1) bytes[i] = (i * 31 + (i >> 11)) & 0xff;
const sourceHash = createHash("sha256").update(bytes).digest("hex");
const clip = new Blob([bytes], { type: "video/mp4" });

const athlete = await users.create({
  userId: `e2evideo${stamp}`,
  email: `e2e-video-${stamp}@sticksnboulders.test`,
  password: `Pw-${stamp}-aA1!`,
  name: "E2E Video",
});

// Not decoration. A video is stamped with its circle team as a reader, and Appwrite
// only lets a caller stamp roles it actually holds -- so an athlete who is not
// in their own circle cannot upload at all. Onboarding does this through
// /api/circle; the script has to do it too, and the last check below is what
// stops that dependency being rediscovered the hard way.
await ensureCircle(teams, athlete.$id, "E2E Video");

const session = await users.createSession({ userId: athlete.$id });
browserAppwrite().client.setSession(session.secret);

// Every POST to the files endpoint, counted. It is the only way to tell a
// resume that skipped from a resume that re-sent everything and got the same
// answer.
const realFetch = globalThis.fetch;
let posts = 0;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (init?.method === "POST" && url.includes(`/buckets/${VIDEO_BUCKET}/files`)) posts += 1;
  return realFetch(input, init);
}) as typeof fetch;

const fileId = `clip${stamp}`;
let failure: unknown = null;

try {
  console.log(`\n${SIZE} bytes, ${Math.ceil(SIZE / CHUNK_BYTES)} chunks\n`);

  // --- the interruption ------------------------------------------------
  // Aborted the moment the server confirms the first chunk, which is the gym
  // wifi case: some bytes landed, the rest did not.
  const controller = new AbortController();
  const first = await uploadResumable(
    clip,
    { fileId, athleteId: athlete.$id, name: "clip.mp4" },
    {
      signal: controller.signal,
      onProgress: (pct) => {
        if (pct > 0) controller.abort();
      },
    },
  );
  check("an interrupted upload reports itself unfinished", !first.ok);
  const afterFirst = await uploadedSoFar(fileId);
  check("the server holds a partial file the client can find again", afterFirst > 0, `${afterFirst} chunks`);
  check("a JWT is accepted for a chunked write", afterFirst > 0);
  const postsBeforeResume = posts;

  // --- the resume ------------------------------------------------------
  const second = await uploadResumable(clip, { fileId, athleteId: athlete.$id, name: "clip.mp4" });
  check("the resumed upload finishes", second.ok, second.ok ? "" : JSON.stringify(second));

  const sent = posts - postsBeforeResume;
  const expected = Math.ceil(SIZE / CHUNK_BYTES) - afterFirst;
  check("resume sends only what the server was missing", sent === expected, `${sent} sent, ${expected} expected`);

  // --- the bytes -------------------------------------------------------
  const stored = await browserAppwrite().storage.getFile({ bucketId: VIDEO_BUCKET, fileId });
  check("the stored file is the size that went up", stored.sizeOriginal === SIZE, `${stored.sizeOriginal} vs ${SIZE}`);

  const downloaded = Buffer.from(
    await (await realFetch(
      `${config.endpoint}/storage/buckets/${VIDEO_BUCKET}/files/${fileId}/download?project=${config.projectId}`,
      { headers: { "x-appwrite-project": config.projectId, "x-appwrite-key": config.apiKey } },
    )).arrayBuffer(),
  );
  const backHash = createHash("sha256").update(downloaded).digest("hex");
  check("the clip that comes back is byte-for-byte the clip that went up", backHash === sourceHash);

  // --- the dependency --------------------------------------------------
  // An athlete with no circle team cannot stamp its read role, so the upload is
  // refused outright. Asserted rather than assumed because the symptom is a
  // 401 on the first chunk with a message about permissions, which reads like
  // an auth bug and is not one.
  const loner = await users.create({
    userId: `e2evideono${stamp}`,
    email: `e2e-video-nocircle-${stamp}@sticksnboulders.test`,
    password: `Pw-${stamp}-bB2!`,
    name: "E2E No Circle",
  });
  try {
    browserAppwrite().client.setSession((await users.createSession({ userId: loner.$id })).secret);
    const refused = await uploadResumable(
      new Blob([bytes.subarray(0, 1024)], { type: "video/mp4" }),
      { fileId: `lone${stamp}`, athleteId: loner.$id, name: "clip.mp4" },
    );
    check(
      "an athlete with no circle is refused rather than uploading unreadable clips",
      !refused.ok && !refused.retryable,
    );
  } finally {
    await users.delete({ userId: loner.$id }).catch(() => {});
  }
} catch (error) {
  failure = error;
  check("ran without throwing", false, String(error));
} finally {
  globalThis.fetch = realFetch;
  await adminStorage.deleteFile({ bucketId: VIDEO_BUCKET, fileId }).catch(() => {});
  await teams.delete({ teamId: circleTeamId(athlete.$id) }).catch(() => {});
  await users.delete({ userId: athlete.$id }).catch(() => {});
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0 || failure) process.exit(1);
