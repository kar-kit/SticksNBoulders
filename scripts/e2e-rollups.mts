/**
 * Drives the rollup rebuild against the live instance.
 *
 *   npm run e2e:rollups
 *
 * Rollups are the only aggregates in the product and every chart reads them
 * rather than raw sets, so a wrong one looks exactly like a right one. The
 * rebuild script is the only thing that can say what the sets actually add up
 * to -- and a rebuild that silently does the wrong thing leaves wrong numbers
 * wearing the same face.
 *
 * So this writes sets and rollups in each shape the script has to handle, and
 * checks what it does to them. No browser: this is about rows.
 */
import { execFileSync } from "node:child_process";
import { ID, Query, TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { circleTeamId } from "../appwrite/documents/circle";
import { rollupPermissions, setPermissions } from "../appwrite/documents/policy";

dedupeSdkWarnings();

const config = serverAppwriteConfig();
const db = new TablesDB(createServerClient(config));
const users = new Users(createServerClient(config));
const teams = new Teams(createServerClient(config));
const D = config.databaseId;
const stamp = Date.now();

const results: boolean[] = [];
const check = (label: string, ok: boolean) => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
};

const athlete = await users.create({
  userId: ID.unique(),
  email: `rollup-${stamp}@example.com`,
  password: "Probe-pass-123!",
  name: "Joey Pang",
});

// A Monday in BST, and a set half an hour past local midnight -- the instant
// that a UTC-only week rule files into the week before.
const MONDAY = new Date("2026-09-14T00:00:00.000Z");
const EARLY_MONDAY = new Date("2026-09-13T23:30:00.000Z");

let n = 0;
const seed = async (data: {
  exercise_id: string;
  load_kg: number;
  reps: number;
  rpe?: number;
  e1rm_kg?: number;
  is_warmup?: boolean;
  logged_at: Date;
}) => {
  const id = `st-ru-${stamp}-${n++}`;
  await db.createRow({
    databaseId: D,
    tableId: "sets",
    rowId: id,
    data: {
      session_id: `cs-ru-${stamp}`,
      athlete_id: athlete.$id,
      exercise_id: data.exercise_id,
      set_index: 1,
      load_kg: data.load_kg,
      reps: data.reps,
      rpe: data.rpe,
      e1rm_kg: data.e1rm_kg,
      is_warmup: data.is_warmup ?? false,
      logged_at: data.logged_at.toISOString(),
      client_set_id: id,
    },
    permissions: setPermissions({ athleteId: athlete.$id }),
  });
  return id;
};

// Squat: a warm-up plus two working sets, one of them logged just past local
// midnight on the Monday.
await seed({ exercise_id: "squat", load_kg: 60, reps: 5, is_warmup: true, logged_at: EARLY_MONDAY });
await seed({ exercise_id: "squat", load_kg: 140, reps: 5, rpe: 8, e1rm_kg: 168, logged_at: EARLY_MONDAY });
await seed({ exercise_id: "squat", load_kg: 150, reps: 3, rpe: 9, e1rm_kg: 176.5, logged_at: new Date("2026-09-17T10:00:00Z") });

// Bench, with a rollup already stored that disagrees with the sets.
await seed({ exercise_id: "bench", load_kg: 100, reps: 5, rpe: 8, e1rm_kg: 120, logged_at: new Date("2026-09-16T10:00:00Z") });
const staleId = `ru-stale-${stamp}`;
await db.createRow({
  databaseId: D, tableId: "stats_rollups", rowId: staleId,
  data: {
    athlete_id: athlete.$id, exercise_id: "bench", week_start: MONDAY.toISOString(),
    set_count: 9, volume_reps: 99, tonnage_kg: 9999, best_e1rm_kg: 999,
    rebuilt_at: new Date("2020-01-01T00:00:00Z").toISOString(),
  },
  permissions: rollupPermissions({ athleteId: athlete.$id }),
});

// A rollup for a lift with no sets at all: what an undo of a whole week leaves.
const orphanId = `ru-orphan-${stamp}`;
await db.createRow({
  databaseId: D, tableId: "stats_rollups", rowId: orphanId,
  data: {
    athlete_id: athlete.$id, exercise_id: "deadlift", week_start: MONDAY.toISOString(),
    set_count: 3, volume_reps: 9, tonnage_kg: 1800, rebuilt_at: new Date().toISOString(),
  },
  permissions: rollupPermissions({ athleteId: athlete.$id }),
});

const run = (...args: string[]) =>
  execFileSync("npm", ["run", "rollups:rebuild", ...args], { encoding: "utf8" });

const rollupsOf = async () =>
  (
    await db.listRows({
      databaseId: D, tableId: "stats_rollups",
      queries: [Query.equal("athlete_id", athlete.$id), Query.limit(25)], ttl: 0,
    })
  ).rows as unknown as Array<Record<string, unknown>>;

console.log("\nPlanning");
// The script reports counts across the whole instance, so these assert that it
// found work of each kind rather than an exact number -- on an instance with
// real data in it, exact counts would be a test that fails for being right.
const plan = run();
const counted = (label: string) => new RegExp(`([1-9]\\d*) to ${label}`).test(plan);
check("finds the bucket nothing has written", counted("create"));
check("finds the rollup that drifted from its sets", counted("correct"));
check("finds the rollup whose sets are gone", counted("remove"));
check("writes nothing while planning", (await rollupsOf()).length === 2);

console.log("\nApplying");
run("--", "--yes");
const rows = await rollupsOf();
const squat = rows.find((r) => r.exercise_id === "squat");
const bench = rows.find((r) => r.exercise_id === "bench");

check("the missing rollup is created", squat != null);
check("counting working sets only", squat?.set_count === 2);
check("volume is reps of working sets", squat?.volume_reps === 8);
check("tonnage excludes the warm-up", squat?.tonnage_kg === 1150);
check("best e1RM is the best of the week", squat?.best_e1rm_kg === 176.5);
check("best single is the heaviest, with its reps", squat?.best_single_kg === 150 && squat?.best_single_reps === 3);
// The rep record Lift Detail shows. Stored rather than scanned out of raw
// sets, because "most reps ever" is an aggregate like every other one here.
check("most reps in one set, with the weight it was done at", squat?.best_reps === 5 && squat?.best_reps_load_kg === 140);
// The BST case. A set at 23:30Z on the Sunday is 00:30 Monday in London, and a
// UTC-only rule would have put it in the week before -- splitting one session
// across two bars on the chart.
check(
  "a set logged just after local midnight on Monday is in that Monday's week",
  new Date(String(squat?.week_start)).toISOString() === MONDAY.toISOString(),
);

check("the drifted rollup is corrected", bench?.set_count === 1 && bench?.tonnage_kg === 500);
check("and keeps its row rather than being replaced", bench?.$id === staleId);
check("the orphan is removed", rows.every((r) => r.exercise_id !== "deadlift"));
check("nothing else is left behind for this athlete", rows.length === 2);

console.log("\nRe-running");
check("is safe to run forever: the second pass has nothing to do", /Nothing to do/.test(run()));

// --- teardown ---------------------------------------------------------
for (const table of ["sets", "stats_rollups"] as const) {
  for (const row of (
    await db.listRows({ databaseId: D, tableId: table, queries: [Query.equal("athlete_id", athlete.$id), Query.limit(50)], ttl: 0 })
  ).rows) {
    await db.deleteRow({ databaseId: D, tableId: table, rowId: row.$id });
  }
}
await teams.delete({ teamId: circleTeamId(athlete.$id) }).catch(() => {});
await users.delete({ userId: athlete.$id });

const failed = results.filter((ok) => !ok).length;
console.log(
  failed === 0
    ? `\n${results.length}/${results.length} passed. Athlete, sets and rollups removed.`
    : `\n${failed} of ${results.length} FAILED.`,
);
process.exitCode = failed === 0 ? 0 : 1;
