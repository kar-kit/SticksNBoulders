/**
 * Drives clip playback through the running app, against the live instance.
 *
 *   npm run build && npm run start          # port 3100, or PORT=3101 npm run start
 *   npm run e2e:clip                        # E2E_BASE_URL overrides the port
 *
 * Check the port is actually yours before reading a failure. A `next start`
 * that cannot bind exits, and the run then tests whatever else is on that
 * port -- which produces failures that look like bugs in this code and are
 * not. `ss -ltnp | grep 3100` settles it in one line.
 *
 * This is the half of the Review Queue that no unit test reaches: a `<video>`
 * element loads a plain URL with no headers, so everything that makes that URL
 * safe happens across two route handlers and an Appwrite request. Three things
 * have to hold at once, and all three are invisible until they are not:
 *
 *   1. A signed ticket opens exactly one file for exactly one person.
 *   2. Appwrite, not this app, decides whether that person may read it -- so a
 *      coach who has been unlinked stops being able to watch, mid-session.
 *   3. Range requests survive the proxy, or 0.25x frame-stepping does not work
 *      and the screen's stated purpose is gone.
 *
 * Creates throwaway users and removes them and their clip. Point it at dev.
 */
import { Storage, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { ensureCircle, addCoachToCircle } from "../appwrite/documents/circle-admin";
import { circleTeamId } from "../appwrite/documents/circle";
import { videoPermissions } from "../appwrite/documents/policy";
import { VIDEO_BUCKET } from "../lib/video/bucket";

dedupeSdkWarnings();

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const config = serverAppwriteConfig();
const admin = createServerClient(config);
const users = new Users(admin);
const teams = new Teams(admin);
const storage = new Storage(admin);
const stamp = Date.now();

const results: boolean[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const mkUser = async (tag: string, name: string) =>
  users.create({
    userId: `e2eclip${tag}${stamp}`,
    email: `e2e-clip-${tag}-${stamp}@sticksnboulders.test`,
    password: `Pw-${stamp}-${tag}A1!`,
    name,
  });

const athlete = await mkUser("a", "Clip Athlete");
const coach = await mkUser("c", "Clip Coach");
const stranger = await mkUser("s", "Clip Stranger");

/** Big enough that a range request returns a genuine slice of it. */
const BYTES = 40_000;
const body = Buffer.alloc(BYTES);
for (let i = 0; i < BYTES; i += 1) body[i] = (i * 17) & 0xff;

const fileId = `e2eclipf${stamp}`;
let failure: unknown = null;

const mint = async (userId: string, fileIds: string[]) => {
  const jwt = (await users.createJWT({ userId })).jwt;
  const response = await fetch(`${BASE}/api/clip`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ fileIds }),
  });
  const parsed = (await response.json().catch(() => ({}))) as { urls?: Record<string, string> };
  return { status: response.status, urls: parsed.urls ?? {} };
};

try {
  await ensureCircle(teams, athlete.$id, "Clip Athlete");
  await addCoachToCircle(teams, athlete.$id, coach.$id);

  const form = new FormData();
  form.append("fileId", fileId);
  for (const p of videoPermissions({ athleteId: athlete.$id })) form.append("permissions[]", p);
  form.append("file", new File([body], "clip.mp4", { type: "video/mp4" }), "clip.mp4");
  const upload = await fetch(`${config.endpoint}/storage/buckets/${VIDEO_BUCKET}/files`, {
    method: "POST",
    headers: {
      "x-appwrite-project": config.projectId,
      "x-appwrite-jwt": (await users.createJWT({ userId: athlete.$id })).jwt,
      "content-range": `bytes 0-${BYTES - 1}/${BYTES}`,
      "x-appwrite-id": fileId,
    },
    body: form,
  });
  check("the fixture clip uploaded", upload.status === 201, String(upload.status));

  // --- minting ------------------------------------------------------------
  const anonymous = await fetch(`${BASE}/api/clip`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileIds: [fileId] }),
  });
  check("minting without a token is refused", anonymous.status === 401, String(anonymous.status));

  const coachMint = await mint(coach.$id, [fileId]);
  check("a signed-in coach gets a URL", coachMint.status === 200 && Boolean(coachMint.urls[fileId]));
  const coachUrl = coachMint.urls[fileId];

  // --- streaming ----------------------------------------------------------
  const whole = await fetch(`${BASE}${coachUrl}`);
  const served = Buffer.from(await whole.arrayBuffer());
  check("the coach can play the clip", whole.status === 200, String(whole.status));
  check("and gets the whole file, byte for byte", served.equals(body), `${served.length} of ${BYTES}`);

  const ranged = await fetch(`${BASE}${coachUrl}`, { headers: { range: "bytes=100-199" } });
  const slice = Buffer.from(await ranged.arrayBuffer());
  check("range requests survive the proxy, so scrubbing works", ranged.status === 206, String(ranged.status));
  check("the range header comes back", (ranged.headers.get("content-range") ?? "").includes(`/${BYTES}`),
    ranged.headers.get("content-range") ?? "(none)");
  check("and the bytes are the ones asked for", slice.equals(body.subarray(100, 200)), `${slice.length} bytes`);
  check("it is never cached", (whole.headers.get("cache-control") ?? "").includes("no-store"));

  // --- the ticket's limits ------------------------------------------------
  const noTicket = await fetch(`${BASE}/api/clip/${fileId}`);
  check("no ticket is a 404, not a clip", noTicket.status === 404, String(noTicket.status));

  const swapped = coachUrl.replace(fileId, "some-other-file");
  const wrongFile = await fetch(`${BASE}${swapped}`);
  check("a ticket cannot be pointed at another file", wrongFile.status === 404, String(wrongFile.status));

  const tampered = `${coachUrl.slice(0, -2)}xx`;
  const forged = await fetch(`${BASE}${tampered}`);
  check("an edited signature is refused", forged.status === 404, String(forged.status));

  // A stranger's own, properly signed ticket. The app hands it over happily,
  // because the ticket is identity -- and Appwrite then declines.
  const strangerMint = await mint(stranger.$id, [fileId]);
  check("a stranger is issued a ticket, since tickets carry no authority", Boolean(strangerMint.urls[fileId]));
  const strangerPlay = await fetch(`${BASE}${strangerMint.urls[fileId]}`);
  check("but Appwrite refuses them the bytes", strangerPlay.status === 404, String(strangerPlay.status));

  // --- revocation, mid-session -------------------------------------------
  // The coach already holds a valid, unexpired ticket. Unlinking must stop
  // playback anyway, which it does only because the decision is Appwrite's.
  const { memberships } = await teams.listMemberships({ teamId: circleTeamId(athlete.$id) });
  const coachMembership = memberships.find((m) => m.userId === coach.$id);
  if (coachMembership) {
    await teams.deleteMembership({ teamId: circleTeamId(athlete.$id), membershipId: coachMembership.$id });
  }
  const afterRevoke = await fetch(`${BASE}${coachUrl}`);
  check(
    "an unlinked coach's existing ticket stops working immediately",
    afterRevoke.status === 404,
    String(afterRevoke.status),
  );
} catch (error) {
  failure = error;
  check("ran without throwing", false, String(error));
} finally {
  await storage.deleteFile({ bucketId: VIDEO_BUCKET, fileId }).catch(() => {});
  await teams.delete({ teamId: circleTeamId(athlete.$id) }).catch(() => {});
  for (const id of [athlete.$id, coach.$id, stranger.$id]) {
    await users.delete({ userId: id }).catch(() => {});
  }
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0 || failure) process.exit(1);
