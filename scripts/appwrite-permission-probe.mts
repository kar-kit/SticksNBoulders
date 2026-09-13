/**
 * Proves, against the live instance, the row-security semantics the whole
 * permission design rests on.
 *
 *   npm run appwrite:probe
 *
 * The schema assumes Appwrite grants access on table-level OR row-level
 * permission, which is why no table carries a blanket read. That assumption is
 * invisible when wrong -- data is simply readable by people who should not see
 * it -- so it is checked rather than asserted in a comment.
 *
 * Creates two throwaway users and a handful of rows, then removes them. Safe to
 * run against the dev instance; do not point it at anything with real athletes
 * on it. Grows into the permission audit script at Order 38.
 */
import { Client, ID, Permission, Role, TablesDB, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";

dedupeSdkWarnings();
const config = serverAppwriteConfig();
const admin = createServerClient(config);
const adminDb = new TablesDB(admin);
const users = new Users(admin);

const asUser = async (userId: string) => {
  const session = await users.createSession({ userId });
  const c = new Client().setEndpoint(config.endpoint).setProject(config.projectId).setSession(session.secret);
  return { db: new TablesDB(c), sessionId: session.$id };
};

const stamp = Date.now();
const A = await users.create({ userId: ID.unique(), email: `probe-a-${stamp}@example.com`, password: "Probe-pass-123!", name: "Probe A" });
const B = await users.create({ userId: ID.unique(), email: `probe-b-${stamp}@example.com`, password: "Probe-pass-123!", name: "Probe B" });
const a = await asUser(A.$id);
const b = await asUser(B.$id);

const results: string[] = [];
const check = (label: string, pass: boolean) => {
  results.push(`${pass ? "PASS" : "FAIL"}  ${label}`);
};

// 1. A private set row, readable only by A.
const privateSet = await adminDb.createRow({
  databaseId: config.databaseId, tableId: "sets", rowId: ID.unique(),
  data: { session_id: ID.unique(), athlete_id: A.$id, exercise_id: ID.unique(), set_index: 1,
          load_kg: 142.5, reps: 5, logged_at: new Date().toISOString(), client_set_id: `probe-${stamp}` },
  permissions: [Permission.read(Role.user(A.$id))],
});

try { await a.db.getRow({ databaseId: config.databaseId, tableId: "sets", rowId: privateSet.$id }); check("owner A reads their own set", true); }
catch { check("owner A reads their own set", false); }

try { await b.db.getRow({ databaseId: config.databaseId, tableId: "sets", rowId: privateSet.$id }); check("stranger B CANNOT read A's set", false); }
catch { check("stranger B CANNOT read A's set", true); }

const bList = await b.db.listRows({ databaseId: config.databaseId, tableId: "sets" });
check(`stranger B lists 0 sets (saw ${bList.total})`, bList.total === 0);

// 2. A global exercise, readable by every signed-in user; and a private one.
const globalEx = await adminDb.createRow({
  databaseId: config.databaseId, tableId: "exercises", rowId: ID.unique(),
  data: { name: `Probe Global ${stamp}`, normalised_name: `probe global ${stamp}`, is_global: true, created_at: new Date().toISOString() },
  permissions: [Permission.read(Role.users())],
});
const privateEx = await adminDb.createRow({
  databaseId: config.databaseId, tableId: "exercises", rowId: ID.unique(),
  data: { name: `Probe Private ${stamp}`, normalised_name: `probe private ${stamp}`, is_global: false, owner_id: A.$id, created_at: new Date().toISOString() },
  permissions: [Permission.read(Role.user(A.$id))],
});

try { await b.db.getRow({ databaseId: config.databaseId, tableId: "exercises", rowId: globalEx.$id }); check("B reads a global exercise", true); }
catch { check("B reads a global exercise", false); }
try { await b.db.getRow({ databaseId: config.databaseId, tableId: "exercises", rowId: privateEx.$id }); check("B CANNOT read A's custom exercise", false); }
catch { check("B CANNOT read A's custom exercise", true); }

// 3. A coach with an explicit read grant sees the athlete's set.
const coachSet = await adminDb.createRow({
  databaseId: config.databaseId, tableId: "sets", rowId: ID.unique(),
  data: { session_id: ID.unique(), athlete_id: A.$id, exercise_id: ID.unique(), set_index: 2,
          load_kg: 150, reps: 3, logged_at: new Date().toISOString(), client_set_id: `probe-coach-${stamp}` },
  permissions: [Permission.read(Role.user(A.$id)), Permission.read(Role.user(B.$id))],
});
try { await b.db.getRow({ databaseId: config.databaseId, tableId: "sets", rowId: coachSet.$id }); check("B reads A's set when stamped as their coach", true); }
catch { check("B reads A's set when stamped as their coach", false); }

// 4. A user may not create a rollup — the table grants no create.
try {
  await a.db.createRow({ databaseId: config.databaseId, tableId: "stats_rollups", rowId: ID.unique(),
    data: { athlete_id: A.$id, exercise_id: ID.unique(), week_start: new Date().toISOString(),
            set_count: 1, volume_reps: 5, tonnage_kg: 700, rebuilt_at: new Date().toISOString() } });
  check("A CANNOT forge a rollup", false);
} catch { check("A CANNOT forge a rollup", true); }

try {
  await a.db.createRow({ databaseId: config.databaseId, tableId: "coach_athlete_links", rowId: ID.unique(),
    data: { coach_id: A.$id, athlete_id: B.$id, status: "active", linked_at: new Date().toISOString() } });
  check("A CANNOT grant themselves a coach link", false);
} catch { check("A CANNOT grant themselves a coach link", true); }

console.log("\n" + results.join("\n"));
console.log(results.every((r) => r.startsWith("PASS")) ? "\nAll permission semantics confirmed." : "\nSOMETHING IS WRONG.");

// Cleanup.
for (const row of [privateSet, coachSet]) await adminDb.deleteRow({ databaseId: config.databaseId, tableId: "sets", rowId: row.$id });
for (const row of [globalEx, privateEx]) await adminDb.deleteRow({ databaseId: config.databaseId, tableId: "exercises", rowId: row.$id });
await users.delete({ userId: A.$id });
await users.delete({ userId: B.$id });
console.log("Probe users and rows removed.");
