/**
 * Drives the e1RM backfill against the live instance.
 *
 *   npm run e2e:e1rm
 *
 * The backfill is the reason it is acceptable to ship a formula that is not
 * settled: change lib/strength/e1rm.ts, re-run it, and every stored number
 * converges. That argument is only worth anything if the script actually works,
 * and its failure mode is silent -- wrong numbers left sitting in athletes'
 * logs, looking exactly like right ones.
 *
 * So this writes sets with deliberately wrong estimates, in each of the shapes
 * the script has to handle, and checks what it does to them. No browser: this
 * is about rows.
 *
 * Creates a throwaway athlete and removes them and their sets.
 */
import { execFileSync } from "node:child_process";
import { ID, Query, TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { circleTeamId } from "../appwrite/documents/circle";
import { setPermissions } from "../appwrite/documents/policy";

dedupeSdkWarnings();

const config = serverAppwriteConfig();
const db = new TablesDB(createServerClient(config));
const users = new Users(createServerClient(config));
const teams = new Teams(createServerClient(config));
const stamp = Date.now();

const results: boolean[] = [];
const check = (label: string, ok: boolean) => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
};

const athlete = await users.create({
  userId: ID.unique(),
  email: `e1rm-${stamp}@example.com`,
  password: "Probe-pass-123!",
  name: "Joey Pang",
});

/** Written straight in, wrong on purpose. The script's job is to notice. */
const seed = async (
  label: string,
  data: { load_kg: number; reps: number; rpe?: number; is_warmup?: boolean; e1rm_kg?: number },
) => {
  const row = await db.createRow({
    databaseId: config.databaseId,
    tableId: "sets",
    rowId: `st-e1rm-${stamp}-${label}`,
    data: {
      session_id: `cs-e1rm-${stamp}`,
      athlete_id: athlete.$id,
      exercise_id: "squat",
      set_index: 1,
      logged_at: new Date().toISOString(),
      client_set_id: `st-e1rm-${stamp}-${label}`,
      ...data,
    },
    permissions: setPermissions({ athleteId: athlete.$id }),
  });
  return row.$id;
};

// Nothing stored, an estimate is owed: 140 x 5 @ RPE 8 -> 140 x 36 / 30.
const missing = await seed("missing", { load_kg: 140, reps: 5, rpe: 8 });
// A number from some earlier formula. Epley would have written this one.
const wrong = await seed("wrong", { load_kg: 140, reps: 5, rpe: 8, e1rm_kg: 172.7 });
// Owed nothing, but carrying a number anyway -- the case a fill-the-blanks
// script leaves behind forever.
const warmup = await seed("warmup", { load_kg: 60, reps: 5, rpe: 8, is_warmup: true, e1rm_kg: 72 });
const noRpe = await seed("norpe", { load_kg: 140, reps: 5, e1rm_kg: 168 });
// Already right. Must not be rewritten.
const correct = await seed("correct", { load_kg: 100, reps: 3, rpe: 9, e1rm_kg: 109.1 });

const run = (...args: string[]) =>
  execFileSync("npm", ["run", "e1rm:backfill", ...args], { encoding: "utf8" });

console.log("\nPlanning");
const plan = run();
check("finds the set with no estimate", /1 to estimate for the first time/.test(plan));
check("finds the one carrying a number from another formula", /1 to correct/.test(plan));
check("finds the two that are owed nothing", /2 to clear/.test(plan));
check("leaves the correct one alone", /1 already correct/.test(plan));

/**
 * Read through listRows rather than getRow, because only listRows takes ttl.
 * A cached read here would let the script report a value the server no longer
 * holds, which is the one way this test could quietly lie.
 */
const read = async (rowId: string) => {
  const page = await db.listRows({
    databaseId: config.databaseId,
    tableId: "sets",
    queries: [Query.equal("$id", rowId), Query.limit(1)],
    ttl: 0,
  });
  return page.rows[0] as unknown as { e1rm_kg?: number | null };
};

check("and writes nothing while planning", (await read(missing)).e1rm_kg == null);

console.log("\nApplying");
run("--", "--yes");
check("estimates the set that had none", (await read(missing)).e1rm_kg === 168);
check("corrects the one that was wrong", (await read(wrong)).e1rm_kg === 168);
check("clears the warm-up", (await read(warmup)).e1rm_kg == null);
check("clears the set with no RPE", (await read(noRpe)).e1rm_kg == null);
check("leaves the already-correct one at its value", (await read(correct)).e1rm_kg === 109.1);

console.log("\nRe-running");
const second = run();
check("is safe to run forever: the second pass has nothing to do", /Nothing to do/.test(second));

// --- teardown ---------------------------------------------------------
for (const row of (
  await db.listRows({
    databaseId: config.databaseId,
    tableId: "sets",
    queries: [Query.equal("athlete_id", athlete.$id), Query.limit(50)],
    ttl: 0,
  })
).rows) {
  await db.deleteRow({ databaseId: config.databaseId, tableId: "sets", rowId: row.$id });
}
await teams.delete({ teamId: circleTeamId(athlete.$id) }).catch(() => {});
await users.delete({ userId: athlete.$id });

const failed = results.filter((ok) => !ok).length;
console.log(
  failed === 0
    ? `\n${results.length}/${results.length} passed. Athlete and sets removed.`
    : `\n${failed} of ${results.length} FAILED.`,
);
process.exitCode = failed === 0 ? 0 : 1;
