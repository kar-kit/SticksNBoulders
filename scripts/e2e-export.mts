/**
 * Order 39 against the live instance: the CSV export, as the people who use it.
 *
 *   npm run e2e:export
 *
 * No browser. The export is fetch-shape-serialise followed by handing a Blob
 * to the OS, and the part with teeth is the first three: does it read EVERY
 * set rather than the first page, and does it read ONLY what the requester is
 * allowed to. So this runs the exact code the button runs --
 * buildTrainingLogExport -- through a real user session for each of an
 * athlete, their coach, a stranger and a coach whose link was revoked, and
 * reads the bytes each of them would get.
 *
 * Seeds 520 sets so the export has to cross a 500-row page boundary. Creates
 * throwaway users and removes them, along with every row this run wrote and the
 * rollups the set writes triggered. Touches nothing it did not create.
 */
import { Query, TablesDB, Teams, Users } from "node-appwrite";
import { Client as WebClient, TablesDB as WebTablesDB } from "appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { addCoachToCircle, ensureCircle, removeCoachFromCircle } from "../appwrite/documents/circle-admin";
import { circleTeamId } from "../appwrite/documents/circle";
import { exercisePermissions, sessionPermissions, setPermissions } from "../appwrite/documents/policy";
import { normaliseExerciseName } from "../appwrite/documents";
import { buildTrainingLogExport } from "../lib/export/export-log";

dedupeSdkWarnings();

const config = serverAppwriteConfig();
const admin = createServerClient(config);
const users = new Users(admin);
const teams = new Teams(admin);
const adminDb = new TablesDB(admin);
const D = config.databaseId;
const stamp = Date.now();

const results: boolean[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const asUser = (secret: string) => {
  const client = new WebClient().setEndpoint(config.endpoint).setProject(config.projectId);
  client.setSession(secret);
  return new WebTablesDB(client);
};

const mkUser = (tag: string, name: string) =>
  users.create({
    userId: `e2eexp${tag}${stamp}`,
    email: `e2e-export-${tag}-${stamp}@sticksnboulders.test`,
    password: `Pw-${stamp}-${tag}A1!`,
    name,
  });

const SESSIONS = 26;
const SETS_PER_SESSION = 20;
const TOTAL_SETS = SESSIONS * SETS_PER_SESSION;
const NOTE = 'knee caved, "rep 4"\nfilmed it';
const HOSTILE = "=HYPERLINK(\"http://evil.test\",\"x\")";

const athlete = await mkUser("a", "Export Athlete");
const coach = await mkUser("c", "Export Coach");
const stranger = await mkUser("s", "Export Stranger");
const created: Array<{ table: string; id: string }> = [];
let failure: unknown = null;

const inBatches = async <T,>(items: T[], size: number, run: (item: T) => Promise<unknown>) => {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(run));
};

try {
  await ensureCircle(teams, athlete.$id, "Export Athlete");
  await addCoachToCircle(teams, athlete.$id, coach.$id);

  // A custom exercise whose name would be a formula in Excel.
  const customId = `ex-e2eexp-${stamp}`;
  await adminDb.createRow({
    databaseId: D,
    tableId: "exercises",
    rowId: customId,
    data: {
      name: "-pause squat",
      normalised_name: normaliseExerciseName("-pause squat"),
      is_global: false,
      owner_id: athlete.$id,
      created_at: new Date().toISOString(),
    },
    permissions: exercisePermissions({ athleteId: athlete.$id, isGlobal: false }),
  });
  created.push({ table: "exercises", id: customId });

  console.log(`\nSeeding ${SESSIONS} sessions, ${TOTAL_SETS} sets`);
  const start = Date.UTC(2026, 0, 5, 18, 0);
  const sessionIds = Array.from({ length: SESSIONS }, (_, i) => `cs-e2eexp-${stamp}-${i}`);
  await inBatches(sessionIds, 10, async (sessionId) => {
    const i = sessionIds.indexOf(sessionId);
    await adminDb.createRow({
      databaseId: D,
      tableId: "sessions",
      rowId: sessionId,
      data: {
        athlete_id: athlete.$id,
        client_session_id: sessionId,
        started_at: new Date(start + i * 3 * 86_400_000).toISOString(),
        finished_at: new Date(start + i * 3 * 86_400_000 + 3_600_000).toISOString(),
        notes: i === 0 ? HOSTILE : null,
      },
      permissions: sessionPermissions({ athleteId: athlete.$id }),
    });
    created.push({ table: "sessions", id: sessionId });
  });

  const sets = sessionIds.flatMap((sessionId, s) =>
    Array.from({ length: SETS_PER_SESSION }, (_, k) => ({ sessionId, s, k })),
  );
  await inBatches(sets, 20, async ({ sessionId, s, k }) => {
    const setId = `st-e2eexp-${stamp}-${s}-${k}`;
    await adminDb.createRow({
      databaseId: D,
      tableId: "sets",
      rowId: setId,
      data: {
        session_id: sessionId,
        athlete_id: athlete.$id,
        exercise_id: customId,
        set_index: k + 1,
        load_kg: 100 + k,
        reps: 5,
        rpe: k === 0 ? null : 8,
        is_warmup: k === 0,
        e1rm_kg: k === 0 ? null : (100 + k) * (1 + 7 / 30),
        logged_at: new Date(start + s * 3 * 86_400_000 + k * 60_000).toISOString(),
        client_set_id: setId,
        notes: s === 0 && k === 1 ? NOTE : null,
      },
      permissions: setPermissions({ athleteId: athlete.$id }),
    });
    created.push({ table: "sets", id: setId });
  });

  const session = async (userId: string) => asUser((await users.createSession({ userId })).secret);
  const athleteDb = await session(athlete.$id);
  const coachDb = await session(coach.$id);
  const strangerDb = await session(stranger.$id);
  const run = (db: WebTablesDB) =>
    buildTrainingLogExport(db, D, { id: athlete.$id, name: "Export Athlete" }, { yieldToMain: async () => {} });

  console.log("\nThe athlete, exporting their own log");
  const own = await run(athleteDb);
  const text = own.parts.join("");
  const lines = text.split("\r\n").filter(Boolean);
  check("every set is in the file, past the 500-row page", own.setCount === TOTAL_SETS, `${own.setCount} rows`);
  check("from every session", own.sessionCount === SESSIONS, `${own.sessionCount}`);
  check("nothing was unreadable", own.skipped === 0, `${own.skipped}`);
  check("the file starts with a UTF-8 BOM", text.charCodeAt(0) === 0xfeff);
  check(
    "the header is the Order 39 column list",
    lines[0] === "﻿Date,Session,Exercise,Set,Load (kg),Reps,RPE,Warm-up,e1RM (kg),Notes,Prescription,Session notes",
  );
  check("the first row is session 1, set 1, an ISO date", lines[1]?.startsWith("2026-01-05,1,'-pause squat,1,100,5,,Yes,"));
  check("a note with a comma, quotes and a newline stays one cell", text.includes('"knee caved, ""rep 4""\nfilmed it"'));
  check("a formula-shaped session note is neutralised", text.includes(`"'=HYPERLINK(""http://evil.test"",""x"")"`));
  check("the custom exercise name is resolved and neutralised", text.includes(",'-pause squat,"));
  check("the file is named for the athlete", /^sticksnboulders-export-athlete-\d{4}-\d{2}-\d{2}\.csv$/.test(own.fileName), own.fileName);

  console.log("\nTheir coach");
  const coached = await run(coachDb);
  check("a linked coach gets the same log", coached.setCount === TOTAL_SETS, `${coached.setCount} rows`);
  check("byte for byte", coached.parts.join("") === text);

  console.log("\nSomebody else");
  const nosy = await run(strangerDb);
  check("a stranger gets nothing, not an error", nosy.setCount === 0 && nosy.sessionCount === 0, `${nosy.setCount} rows`);

  console.log("\nA coach whose link was revoked");
  await removeCoachFromCircle(teams, athlete.$id, coach.$id);
  const revoked = await run(coachDb);
  check("loses the log with everything else", revoked.setCount === 0, `${revoked.setCount} rows`);
} catch (error) {
  failure = error;
  check("ran without throwing", false, String(error));
} finally {
  // Rows this run wrote, then the rollups its set writes triggered for this
  // throwaway athlete. Nothing else.
  const rollups = await adminDb
    .listRows({ databaseId: D, tableId: "stats_rollups", queries: [Query.equal("athlete_id", athlete.$id), Query.limit(500)] })
    .catch(() => ({ rows: [] as Array<{ $id: string }> }));
  const doomed = [
    ...created.filter((c) => c.table === "sets"),
    ...created.filter((c) => c.table === "sessions"),
    ...rollups.rows.map((r) => ({ table: "stats_rollups", id: r.$id })),
    ...created.filter((c) => c.table === "exercises"),
  ];
  await inBatches(doomed, 20, ({ table, id }) =>
    adminDb.deleteRow({ databaseId: D, tableId: table, rowId: id }).catch(() => {}),
  );
  await teams.delete({ teamId: circleTeamId(athlete.$id) }).catch(() => {});
  for (const id of [athlete.$id, coach.$id, stranger.$id]) await users.delete({ userId: id }).catch(() => {});
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed. Throwaway users and their rows removed.`);
if (failed > 0 || failure) process.exit(1);
