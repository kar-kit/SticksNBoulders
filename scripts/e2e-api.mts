/**
 * F29 against a running app and the instance behind it: the personal read
 * API, from minting a token to revoking it.
 *
 *   npm run build && API_TOKEN_USER_IDS=e2e-api-athlete-a npx next start -p 3120
 *   E2E_BASE_URL=http://localhost:3120 npm run e2e:api
 *
 * No browser: the API is HTTP, so this is fetch against the target, with
 * the API key used only to seed and inspect, never to read through the API.
 *
 * Athlete A has a FIXED user id, because the server under test must have it
 * on API_TOKEN_USER_IDS before this starts and a throwaway id is not known
 * until it exists. Default `e2e-api-athlete-a`; override with
 * E2E_API_USER_ID. Against a deployment, that id has to be on the
 * deployment's allowlist for the run (docs/read-api.md, rollout). An
 * account already at that id is removed first, but only if its address is a
 * fixture address; anything else stops the run.
 *
 * Proves: A's token reads A's sessions, program and maxes with the numbers
 * the app would show; gets 404 on B's session; is refused after revocation;
 * B, not on the allowlist, gets 403 minting; and every call made with the
 * token left a row in api_requests. Removes every user and row it made.
 */
import { ID, Query, TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { circleTeamId } from "../appwrite/documents/circle";
import { normaliseExerciseName } from "../appwrite/documents";
import {
  exercisePermissions,
  profilePermissions,
  programPermissions,
  referenceMaxPermissions,
  sessionPermissions,
  setPermissions,
} from "../appwrite/documents/policy";
import { isFixtureEmail } from "./e2e-fixture-scope";

dedupeSdkWarnings();

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const A_ID = process.env.E2E_API_USER_ID ?? "e2e-api-athlete-a";
const config = serverAppwriteConfig();
const admin = createServerClient(config);
const users = new Users(admin);
const teams = new Teams(admin);
const db = new TablesDB(admin);
const D = config.databaseId;
const stamp = Date.now();

const results: boolean[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`);
};

const created: Array<{ table: string; id: string }> = [];
const row = async (table: string, rowId: string, data: Record<string, unknown>, permissions: string[]) => {
  await db.createRow({ databaseId: D, tableId: table, rowId, data, permissions });
  created.push({ table, id: rowId });
  return rowId;
};

// A leftover A from a run that died is removed, if and only if it is ours.
const leftover = await users.get({ userId: A_ID }).catch(() => null);
if (leftover) {
  if (!isFixtureEmail(leftover.email)) {
    console.error(`User ${A_ID} exists and is not a fixture (${leftover.email ? "has a real address" : "no address"}). Not touching it.`);
    process.exit(1);
  }
  await users.delete({ userId: A_ID });
}

const password = `Pw-${stamp}-A1!`;
const A = await users.create({ userId: A_ID, email: `e2e-api-a-${stamp}@sticksnboulders.test`, password, name: "API Athlete A" });
const B = await users.create({ userId: ID.unique(), email: `e2e-api-b-${stamp}@sticksnboulders.test`, password, name: "API Athlete B" });
const C = await users.create({ userId: ID.unique(), email: `e2e-api-c-${stamp}@sticksnboulders.test`, password, name: "API Coach C" });

const jwtOf = async (userId: string) => (await users.createJWT({ userId })).jwt;
const tokenCalls: Array<{ path: string; status: number }> = [];
const api = async (path: string, token: string, method = "GET") => {
  const response = await fetch(`${BASE}${path}`, { method, headers: { authorization: `Bearer ${token}` } });
  tokenCalls.push({ path, status: response.status });
  return { status: response.status, headers: response.headers, body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
};

let failure: unknown = null;
let tokenId = "";

try {
  console.log("\nSeeding A's training and B's");
  const now = new Date().toISOString();
  await row("profiles", A.$id, { user_id: A.$id, display_name: "API Athlete A", units: "kg", created_at: now }, profilePermissions({ athleteId: A.$id }));
  const squat = await row("exercises", `ex-e2eapi-${stamp}`, { name: "E2E API Squat", normalised_name: normaliseExerciseName("E2E API Squat"), is_global: false, owner_id: A.$id, created_at: now }, exercisePermissions({ athleteId: A.$id, isGlobal: false }));
  const aSession = await row("sessions", `cs-e2eapi-a-${stamp}`, { athlete_id: A.$id, client_session_id: `cs-e2eapi-a-${stamp}`, started_at: "2026-11-02T18:00:00.000Z", finished_at: "2026-11-02T19:00:00.000Z", set_count: 2, tonnage_kg: 1500 }, sessionPermissions({ athleteId: A.$id }));
  const bSession = await row("sessions", `cs-e2eapi-b-${stamp}`, { athlete_id: B.$id, client_session_id: `cs-e2eapi-b-${stamp}`, started_at: "2026-11-03T18:00:00.000Z" }, sessionPermissions({ athleteId: B.$id }));
  for (const [n, load] of [[1, 150], [2, 150]] as const) {
    await row("sets", `set-e2eapi-${stamp}-${n}`, { session_id: aSession, athlete_id: A.$id, exercise_id: squat, set_index: n, load_kg: load, reps: 5, rpe: 8, is_warmup: false, logged_at: `2026-11-02T18:1${n}:00.000Z`, client_set_id: `set-e2eapi-${stamp}-${n}`, video_file_id: n === 1 ? `e2eapi-clip-${stamp}` : null }, setPermissions({ athleteId: A.$id }));
  }
  await row("reference_maxes", `max-e2eapi-${stamp}`, { athlete_id: A.$id, exercise_id: squat, kind: "training", value_kg: 200, effective_from: "2026-01-01T00:00:00.000Z", recorded_by: C.$id, created_at: now }, referenceMaxPermissions({ athleteId: A.$id }));
  const owner = { coach_id: C.$id, athlete_id: A.$id };
  const stampP = programPermissions({ coachId: C.$id, athleteId: A.$id });
  const program = await row("programs", `pg-e2eapi-${stamp}`, { ...owner, name: "E2E API Block", status: "published", created_at: now, updated_at: now }, stampP);
  const block = await row("program_blocks", `pb-e2eapi-${stamp}`, { ...owner, program_id: program, position: 0, name: "Strength" }, stampP);
  const live = await row("program_weeks", `pw-e2eapi-l-${stamp}`, { ...owner, program_id: program, block_id: block, position: 0, label: "Week 1", status: "published" }, stampP);
  const draft = await row("program_weeks", `pw-e2eapi-d-${stamp}`, { ...owner, program_id: program, block_id: block, position: 1, label: "Draft week", status: "draft" }, stampP);
  const liveDay = await row("program_days", `pd-e2eapi-l-${stamp}`, { ...owner, program_id: program, block_id: block, week_id: live, position: 0, label: "Squat day" }, stampP);
  const draftDay = await row("program_days", `pd-e2eapi-d-${stamp}`, { ...owner, program_id: program, block_id: block, week_id: draft, position: 0, label: "Draft day" }, stampP);
  await row("prescriptions", `rx-e2eapi-l-${stamp}`, { ...owner, program_id: program, week_id: live, day_id: liveDay, exercise_id: squat, position: 0, set_count: 3, reps: 5, load: "75%", load_kind: "percent", updated_at: now }, stampP);
  await row("prescriptions", `rx-e2eapi-d-${stamp}`, { ...owner, program_id: program, week_id: draft, day_id: draftDay, exercise_id: squat, position: 0, set_count: 1, reps: 1, load: "95%", load_kind: "percent", updated_at: now }, stampP);

  console.log("\nMinting");
  const mint = async (userId: string) =>
    fetch(`${BASE}/api/tokens`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${await jwtOf(userId)}` },
      body: JSON.stringify({ label: "e2e", expiresInDays: 1 }),
    });
  const minted = await mint(A.$id);
  const mintedBody = (await minted.json().catch(() => ({}))) as { id?: string; token?: string };
  check("A, on the allowlist, gets a token", minted.status === 201 && typeof mintedBody.token === "string", minted.status === 403 ? `403: start the server with API_TOKEN_USER_IDS=${A_ID}` : `${minted.status}`);
  check("B, not on it, gets 403", (await mint(B.$id)).status === 403);
  if (typeof mintedBody.token !== "string" || typeof mintedBody.id !== "string") throw new Error("no token to test with");
  const token = mintedBody.token;
  tokenId = mintedBody.id;
  const stored = await db.getRow({ databaseId: D, tableId: "api_tokens", rowId: tokenId });
  check("the row holds a hash, not the token", stored.token_hash !== token && /^[a-f0-9]{64}$/.test(String(stored.token_hash)) && !JSON.stringify(stored).includes(token));

  console.log("\nReading as A");
  const me = await api("/api/v1/me", token);
  check("/me is A", me.status === 200 && me.body.id === A.$id, `${me.status}`);
  check("and is not cached", me.headers.get("cache-control") === "no-store");
  const list = await api("/api/v1/sessions", token);
  const ids = ((list.body.sessions ?? []) as Array<{ id: string }>).map((s) => s.id);
  check("/sessions lists A's session and not B's", ids.includes(aSession) && !ids.includes(bSession), JSON.stringify(ids));
  const one = await api(`/api/v1/sessions/${aSession}`, token);
  const sets = ((one.body.session as { sets?: Array<{ weightKg: number }> } | undefined)?.sets ?? []);
  check("/sessions/:id has A's two sets", one.status === 200 && sets.length === 2 && sets.every((s) => s.weightKg === 150), `${one.status} ${sets.length}`);
  check("and no clip id", !JSON.stringify(one.body).includes(`e2eapi-clip-${stamp}`));
  const theirs = await api(`/api/v1/sessions/${bSession}`, token);
  check("B's session is 404, not 403", theirs.status === 404, `${theirs.status}`);
  const programRes = await api("/api/v1/program/current", token);
  const text = JSON.stringify(programRes.body);
  check("/program/current is A's published block", programRes.status === 200 && text.includes("E2E API Block") && text.includes("Squat day"), `${programRes.status}`);
  check("without the draft week", !text.includes("Draft week") && !text.includes("Draft day"));
  check("75% of the 200 kg training max is 150 kg", /"loadKg":150[,}]/.test(text));
  const maxes = await api("/api/v1/maxes", token);
  const lift = ((maxes.body.lifts ?? []) as Array<{ exercise: { id: string }; training: { valueKg: number } | null }>).find((l) => l.exercise.id === squat);
  check("/maxes has the training max", lift?.training?.valueKg === 200, JSON.stringify(lift));
  check("POST is 405", (await api("/api/v1/me", token, "POST")).status === 405);

  console.log("\nRevoking");
  const revoked = await fetch(`${BASE}/api/tokens/${tokenId}`, { method: "DELETE", headers: { authorization: `Bearer ${await jwtOf(A.$id)}` } });
  check("A revokes it", revoked.status === 200, `${revoked.status}`);
  const after = await api("/api/v1/me", token);
  check("and it is refused with 401", after.status === 401 && after.body.error === "unauthorized", `${after.status}`);

  console.log("\nThe audit trail");
  const trail = await db.listRows({ databaseId: D, tableId: "api_requests", queries: [Query.equal("token_id", tokenId), Query.limit(100)], ttl: 0 });
  check(`every call made with the token left a row (${tokenCalls.length})`, trail.rows.length === tokenCalls.length, `${trail.rows.length} rows`);
  const statuses = trail.rows.map((r) => Number(r.status)).sort();
  check("with the statuses it was answered", JSON.stringify(statuses) === JSON.stringify(tokenCalls.map((c) => c.status).sort()));
  check("and no permissions on any of them", trail.rows.every((r) => Array.isArray(r.$permissions) && r.$permissions.length === 0));
} catch (error) {
  failure = error;
  check("ran without throwing", false, String(error));
} finally {
  const owned = async (table: string, column: string, ids: string[]) =>
    (await db.listRows({ databaseId: D, tableId: table, queries: [Query.equal(column, ids), Query.limit(500)] }).catch(() => ({ rows: [] as Array<{ $id: string }> }))).rows.map((r) => ({ table, id: r.$id }));
  const people = [A.$id, B.$id, C.$id];
  const doomed = [
    ...(await owned("api_requests", "owner_id", people)),
    ...(await owned("api_tokens", "owner_id", people)),
    ...(await owned("stats_rollups", "athlete_id", people)),
    ...created.reverse(),
  ];
  for (const { table, id } of doomed) await db.deleteRow({ databaseId: D, tableId: table, rowId: id }).catch(() => {});
  for (const id of people) await teams.delete({ teamId: circleTeamId(id) }).catch(() => {});
  for (const id of people) await users.delete({ userId: id }).catch(() => {});
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed. Throwaway users and their rows removed.`);
// exitCode, not exit(): scripts/e2e-run.mts still has to run its crash net.
if (failed > 0 || failure) process.exitCode = 1;
