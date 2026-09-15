/**
 * Proves the permission model against the live instance.
 *
 *   npm run appwrite:probe
 *
 * Every permission below comes from appwrite/documents/policy.ts -- the real
 * policy the app uses, not a restatement of it. Unit tests prove the policy
 * emits the strings we intend; this proves Appwrite then honours them, which
 * is the half no amount of mocking can establish.
 *
 * Creates throwaway users, a circle team and a handful of rows, then removes
 * them all. Point it at dev, never at anything with real athletes on it.
 * This is the permission audit script at Order 38 in embryo.
 */
import { Client, ID, Storage, TablesDB, Teams, Users, type Models } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { circleTeamId, CIRCLE_ROLES } from "../appwrite/documents/circle";
import {
  exercisePermissions,
  invitePermissions,
  linkPermissions,
  referenceMaxPermissions,
  videoPermissions,
  rollupPermissions,
  setPermissions,
} from "../appwrite/documents/policy";

dedupeSdkWarnings();

const config = serverAppwriteConfig();
const admin = createServerClient(config);
const adminDb = new TablesDB(admin);
const users = new Users(admin);
const teams = new Teams(admin);
const db = config.databaseId;
const stamp = Date.now();

const results: { ok: boolean; label: string }[] = [];
const check = (label: string, ok: boolean) => {
  results.push({ ok, label });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
};

const cannotFile = async (label: string, fn: () => Promise<unknown>) => {
  try { await fn(); check(label, false); } catch { check(label, true); }
};

const canRead = async (client: TablesDB, tableId: string, rowId: string) => {
  try {
    await client.getRow({ databaseId: db, tableId, rowId });
    return true;
  } catch {
    return false;
  }
};

const clientFor = async (userId: string) => {
  const session = await users.createSession({ userId });
  return new Client()
    .setEndpoint(config.endpoint)
    .setProject(config.projectId)
    .setSession(session.secret);
};

const sessionFor = async (userId: string) => new TablesDB(await clientFor(userId));

const mkUser = (tag: string, name: string) =>
  users.create({ userId: ID.unique(), email: `probe-${tag}-${stamp}@example.com`, password: "Probe-pass-123!", name });

// --- cast -------------------------------------------------------------
const joey = await mkUser("joey", "Joey Pang");
const ruairi = await mkUser("ruairi", "Ruairi Deane");
const sam = await mkUser("sam", "Sam Tierney");
const louis = await mkUser("louis", "Louis Byrne");

const joeyDb = await sessionFor(joey.$id);
const ruairiDb = await sessionFor(ruairi.$id);
const samDb = await sessionFor(sam.$id);
const louisDb = await sessionFor(louis.$id);

const joeyCircle = await teams.create({ teamId: circleTeamId(joey.$id), name: "Joey Pang — circle" });
const samCircle = await teams.create({ teamId: circleTeamId(sam.$id), name: "Sam Tierney — circle" });
await teams.createMembership({ teamId: joeyCircle.$id, userId: joey.$id, roles: [CIRCLE_ROLES.athlete] });
await teams.createMembership({ teamId: samCircle.$id, userId: sam.$id, roles: [CIRCLE_ROLES.athlete] });

const newSet = (athleteId: string, tag: string, loadKg: number) =>
  adminDb.createRow({
    databaseId: db, tableId: "sets", rowId: ID.unique(),
    data: {
      session_id: ID.unique(), athlete_id: athleteId, exercise_id: ID.unique(),
      set_index: 1, load_kg: loadKg, reps: 5,
      logged_at: new Date().toISOString(), client_set_id: `probe-${tag}-${stamp}`,
    },
    permissions: setPermissions({ athleteId }),
  });

console.log("\nBefore any coach exists");
// Logged during dogfooding, months before Ruairi is linked. The whole reason
// for the circle team: this row must become visible retroactively.
const oldSet = await newSet(joey.$id, "old", 142.5);
check("Joey reads his own set", await canRead(joeyDb, "sets", oldSet.$id));
check("Ruairi, unlinked, cannot read it", !(await canRead(ruairiDb, "sets", oldSet.$id)));
check("Ruairi, unlinked, lists 0 sets", (await ruairiDb.listRows({ databaseId: db, tableId: "sets" })).total === 0);

console.log("\nAfter linking Ruairi to Joey");
await adminDb.createRow({
  databaseId: db, tableId: "coach_athlete_links", rowId: ID.unique(),
  data: { coach_id: ruairi.$id, athlete_id: joey.$id, status: "active", linked_at: new Date().toISOString() },
  permissions: linkPermissions({ coachId: ruairi.$id, athleteId: joey.$id }),
});
const ruairiMembership = await teams.createMembership({
  teamId: joeyCircle.$id, userId: ruairi.$id, roles: [CIRCLE_ROLES.coach],
});
check("Ruairi reads the set logged BEFORE he was linked", await canRead(ruairiDb, "sets", oldSet.$id));

const newerSet = await newSet(joey.$id, "new", 150);
check("Ruairi reads a set logged after linking", await canRead(ruairiDb, "sets", newerSet.$id));

let coachCouldWrite = false;
try {
  await ruairiDb.updateRow({ databaseId: db, tableId: "sets", rowId: oldSet.$id, data: { load_kg: 999 } });
  coachCouldWrite = true;
} catch { /* expected */ }
check("Ruairi CANNOT rewrite Joey's logged work", !coachCouldWrite);

console.log("\nIsolation between athletes");
const samSet = await newSet(sam.$id, "sam", 120);
check("Ruairi cannot read Sam, whom he does not coach", !(await canRead(ruairiDb, "sets", samSet.$id)));
check("Sam cannot read Joey", !(await canRead(samDb, "sets", oldSet.$id)));
await teams.createMembership({ teamId: samCircle.$id, userId: louis.$id, roles: [CIRCLE_ROLES.coach] });
check("Louis, coaching only Sam, reads Sam", await canRead(louisDb, "sets", samSet.$id));
check("Louis cannot read Joey", !(await canRead(louisDb, "sets", oldSet.$id)));
check(
  "Ruairi lists only Joey's sets",
  (await ruairiDb.listRows({ databaseId: db, tableId: "sets" })).total === 2,
);

console.log("\nExercises");
const globalEx = await adminDb.createRow({
  databaseId: db, tableId: "exercises", rowId: ID.unique(),
  data: { name: `Probe Global ${stamp}`, normalised_name: `probe global ${stamp}`, is_global: true, created_at: new Date().toISOString() },
  permissions: exercisePermissions({ athleteId: joey.$id, isGlobal: true }),
});
const customEx = await adminDb.createRow({
  databaseId: db, tableId: "exercises", rowId: ID.unique(),
  data: { name: `Probe Custom ${stamp}`, normalised_name: `probe custom ${stamp}`, is_global: false, owner_id: joey.$id, created_at: new Date().toISOString() },
  permissions: exercisePermissions({ athleteId: joey.$id, isGlobal: false }),
});
check("anyone signed in reads a library exercise", await canRead(samDb, "exercises", globalEx.$id));
check("Ruairi reads Joey's custom exercise, so the queue can name it", await canRead(ruairiDb, "exercises", customEx.$id));
check("Sam cannot read Joey's custom exercise", !(await canRead(samDb, "exercises", customEx.$id)));

console.log("\nInvite codes");
// The code IS the row id, so this is also the proof that Appwrite accepts one.
const inviteCode = `SNB-P${String(stamp).slice(-4)}`;
const invite = await adminDb.createRow({
  databaseId: db, tableId: "invite_codes", rowId: inviteCode,
  data: { coach_id: ruairi.$id, created_at: new Date().toISOString() },
  permissions: invitePermissions({ coachId: ruairi.$id }),
});
check("the code is the row id", invite.$id === inviteCode);
check("Ruairi reads his own code", await canRead(ruairiDb, "invite_codes", inviteCode));
check("Joey cannot read it, even though Ruairi coaches him", !(await canRead(joeyDb, "invite_codes", inviteCode)));
check("Sam cannot read it", !(await canRead(samDb, "invite_codes", inviteCode)));
check(
  "nobody can list the table and link themselves to every coach",
  (await samDb.listRows({ databaseId: db, tableId: "invite_codes" })).total === 0,
);

console.log("\nReference maxes");
/**
 * The table where the coach is the author, and still may not write from a
 * browser. Appwrite polices who reads a row, not what the row says: with any
 * table-level create, a stranger could write a row carrying Joey's athlete_id,
 * stamp it read("users"), and that invented number would be what Joey's
 * percentages resolve against. So every client-side create below must fail --
 * the coach's and the athlete's included -- and the real writes go through the
 * API key behind app/api/reference-max.
 */
const refMaxData = (athleteId: string, recordedBy: string, valueKg: number) => ({
  athlete_id: athleteId,
  exercise_id: globalEx.$id,
  kind: "training",
  value_kg: valueKg,
  effective_from: new Date().toISOString(),
  recorded_by: recordedBy,
  created_at: new Date().toISOString(),
});

const coachMax = await adminDb.createRow<Models.DefaultRow>({
  databaseId: db, tableId: "reference_maxes", rowId: ID.unique(),
  data: refMaxData(joey.$id, ruairi.$id, 180),
  permissions: referenceMaxPermissions({ athleteId: joey.$id }),
});
const athleteMax = await adminDb.createRow<Models.DefaultRow>({
  databaseId: db, tableId: "reference_maxes", rowId: ID.unique(),
  data: { ...refMaxData(joey.$id, joey.$id, 185), kind: "tested" },
  permissions: referenceMaxPermissions({ athleteId: joey.$id }),
});

check("Joey reads the max his coach set", await canRead(joeyDb, "reference_maxes", coachMax.$id));
check("Ruairi reads it too", await canRead(ruairiDb, "reference_maxes", coachMax.$id));
check("Sam reads neither", !(await canRead(samDb, "reference_maxes", coachMax.$id)));
check(
  "and cannot list the table to find them",
  (await samDb.listRows({ databaseId: db, tableId: "reference_maxes" })).total === 0,
);

console.log("\nSet videos");
/**
 * Files, not rows. The rest of this probe checks table permissions; a clip is
 * stamped per FILE and the check is a different code path in Appwrite, so a
 * policy that is right for a set row proves nothing about the video on it.
 */
const adminStorage = new Storage(admin);
const storageFor = async (userId: string) => new Storage(await clientFor(userId));

const clip = await adminStorage.createFile({
  bucketId: "set_videos",
  fileId: ID.unique(),
  file: new File([Buffer.alloc(1024, 1)], "probe.mp4", { type: "video/mp4" }),
  permissions: videoPermissions({ athleteId: joey.$id }),
});

const canReadFile = async (storage: Storage, fileId: string) => {
  try {
    await storage.getFile({ bucketId: "set_videos", fileId });
    return true;
  } catch {
    return false;
  }
};

const joeyStorage = await storageFor(joey.$id);
const ruairiStorage = await storageFor(ruairi.$id);
const samStorage = await storageFor(sam.$id);

check("Joey reads his own clip", await canReadFile(joeyStorage, clip.$id));
check("Ruairi reads it, which is the whole review loop", await canReadFile(ruairiStorage, clip.$id));
check("Sam cannot", !(await canReadFile(samStorage, clip.$id)));
check(
  "and cannot list the bucket to find it",
  await (async () => {
    try {
      return (await samStorage.listFiles({ bucketId: "set_videos" })).total === 0;
    } catch {
      return true;
    }
  })(),
);

await cannotFile("Ruairi cannot delete the clip he is reviewing", () =>
  ruairiStorage.deleteFile({ bucketId: "set_videos", fileId: clip.$id }),
);
check(
  "Joey can delete his own",
  await joeyStorage
    .deleteFile({ bucketId: "set_videos", fileId: clip.$id })
    .then(() => true)
    .catch(() => false),
);

console.log("\nForgery");
const cannot = async (label: string, fn: () => Promise<unknown>) => {
  try { await fn(); check(label, false); } catch { check(label, true); }
};
await cannot("Joey cannot forge a rollup", () =>
  joeyDb.createRow<Models.DefaultRow>({
    databaseId: db, tableId: "stats_rollups", rowId: ID.unique(),
    data: { athlete_id: joey.$id, exercise_id: ID.unique(), week_start: new Date().toISOString(), set_count: 1, volume_reps: 5, tonnage_kg: 700, rebuilt_at: new Date().toISOString() },
    permissions: rollupPermissions({ athleteId: joey.$id }),
  }),
);
await cannot("Joey cannot mint a code naming himself the coach", () =>
  joeyDb.createRow<Models.DefaultRow>({
    databaseId: db, tableId: "invite_codes", rowId: `SNB-F${String(stamp).slice(-4)}`,
    data: { coach_id: joey.$id, created_at: new Date().toISOString() },
    permissions: invitePermissions({ coachId: joey.$id }),
  }),
);
await cannot("Ruairi cannot rewrite his own code to point at somebody else", () =>
  ruairiDb.updateRow<Models.DefaultRow>({
    databaseId: db, tableId: "invite_codes", rowId: inviteCode, data: { coach_id: sam.$id },
  }),
);
await cannot("Ruairi cannot set a max from the browser, though he is the author", () =>
  ruairiDb.createRow<Models.DefaultRow>({
    databaseId: db, tableId: "reference_maxes", rowId: ID.unique(),
    data: refMaxData(joey.$id, ruairi.$id, 200),
    permissions: referenceMaxPermissions({ athleteId: joey.$id }),
  }),
);
await cannot("nor can Joey, for his own", () =>
  joeyDb.createRow<Models.DefaultRow>({
    databaseId: db, tableId: "reference_maxes", rowId: ID.unique(),
    data: refMaxData(joey.$id, joey.$id, 200),
    permissions: referenceMaxPermissions({ athleteId: joey.$id }),
  }),
);
await cannot("so Louis cannot forge one carrying Joey's id and a role everyone holds", () =>
  louisDb.createRow<Models.DefaultRow>({
    databaseId: db, tableId: "reference_maxes", rowId: ID.unique(),
    data: refMaxData(joey.$id, louis.$id, 999),
    // read("users") -- everybody signed in -- taken from the one policy that
    // legitimately emits it rather than written as a literal here, which the
    // guard test forbids and rightly so. This is the forgery the table's
    // server-only write path exists to refuse: Joey's id on a row Louis wrote.
    permissions: exercisePermissions({ athleteId: louis.$id, isGlobal: true }),
  }),
);
await cannot("nobody can edit a max in place, because the table is append-only", () =>
  ruairiDb.updateRow<Models.DefaultRow>({
    databaseId: db, tableId: "reference_maxes", rowId: coachMax.$id, data: { value_kg: 999 },
  }),
);
await cannot("Joey cannot grant himself a coach link", () =>
  joeyDb.createRow<Models.DefaultRow>({
    databaseId: db, tableId: "coach_athlete_links", rowId: ID.unique(),
    data: { coach_id: joey.$id, athlete_id: sam.$id, status: "active", linked_at: new Date().toISOString() },
    permissions: linkPermissions({ coachId: joey.$id, athleteId: sam.$id }),
  }),
);

console.log("\nRevocation");
await teams.deleteMembership({ teamId: joeyCircle.$id, membershipId: ruairiMembership.$id });
check("a revoked coach loses access to everything at once", !(await canRead(ruairiDb, "sets", oldSet.$id)));
check("and to rows logged after linking too", !(await canRead(ruairiDb, "sets", newerSet.$id)));
check("while Joey keeps his own data", await canRead(joeyDb, "sets", oldSet.$id));
/**
 * The case the circle design makes free: nothing re-stamps these rows on
 * revocation, so if membership were not the only thing granting write access,
 * a sacked coach would still be setting the numbers an athlete trains to.
 */
check("a revoked coach can no longer read a max", !(await canRead(ruairiDb, "reference_maxes", coachMax.$id)));
check("while Joey keeps the max he recorded himself", await canRead(joeyDb, "reference_maxes", athleteMax.$id));

// --- teardown ---------------------------------------------------------
for (const row of [oldSet, newerSet, samSet]) {
  await adminDb.deleteRow({ databaseId: db, tableId: "sets", rowId: row.$id });
}
for (const row of [globalEx, customEx]) {
  await adminDb.deleteRow({ databaseId: db, tableId: "exercises", rowId: row.$id });
}
await adminDb.deleteRow({ databaseId: db, tableId: "invite_codes", rowId: inviteCode });
for (const row of [coachMax, athleteMax]) {
  await adminDb.deleteRow({ databaseId: db, tableId: "reference_maxes", rowId: row.$id });
}
for (const links of [await adminDb.listRows({ databaseId: db, tableId: "coach_athlete_links" })]) {
  for (const row of links.rows) {
    await adminDb.deleteRow({ databaseId: db, tableId: "coach_athlete_links", rowId: row.$id });
  }
}
for (const team of [joeyCircle, samCircle]) await teams.delete({ teamId: team.$id });
for (const u of [joey, ruairi, sam, louis]) await users.delete({ userId: u.$id });

const failed = results.filter((r) => !r.ok);
console.log(
  failed.length === 0
    ? `\n${results.length}/${results.length} passed. Probe users, teams and rows removed.`
    : `\n${failed.length} FAILED: ${failed.map((f) => f.label).join("; ")}`,
);
process.exitCode = failed.length === 0 ? 0 : 1;
