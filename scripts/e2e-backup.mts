/**
 * Proves a backup can actually be restored.
 *
 *   npm run e2e:backup
 *
 * A dump nobody has restored is not a backup, it is a directory of JSON that
 * makes people feel safe. So this takes a real dump of the live instance,
 * destroys a real athlete's account, team and training, restores from that
 * dump, and then checks the thing that actually matters: that the coach can
 * still read the athlete's set afterwards.
 *
 * It builds its own cast and removes it again. Point it at dev, never at
 * anything with real athletes on it -- and note the restore step replays the
 * WHOLE dump, not just the cast. On dev that is a no-op, because everything
 * else still exists and every write is skipped as already there. On an instance
 * where something was legitimately deleted between the dump and the restore,
 * it would bring that back.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, ID, TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { schema } from "../appwrite/schema";
import { circleTeamId, CIRCLE_ROLES } from "../appwrite/documents/circle";
import { profilePermissions, sessionPermissions, setPermissions } from "../appwrite/documents/policy";
import { dumpInstance } from "../appwrite/backup/dump";
import { restoreBackup } from "../appwrite/backup/restore";
import { readBackup, writeBackup } from "../appwrite/backup/files";
import { appwriteSource, appwriteTarget } from "./backup-driver";

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

const source = appwriteSource(adminDb, users, teams, {
  databaseId: db,
  tableIds: schema.tables.map((t) => t.id),
});
const target = appwriteTarget(adminDb, users, teams, { databaseId: db });

const dumpNow = async (dir: string) => {
  const backup = await dumpInstance(source, {
    endpoint: config.endpoint,
    projectId: config.projectId,
    databaseId: db,
    schemaVersion: schema.version,
  });
  await writeBackup(dir, backup);
  return backup;
};

const canRead = async (client: TablesDB, tableId: string, rowId: string) => {
  try {
    await client.getRow({ databaseId: db, tableId, rowId });
    return true;
  } catch {
    return false;
  }
};

const sessionFor = async (userId: string) => {
  const session = await users.createSession({ userId });
  return new TablesDB(
    new Client().setEndpoint(config.endpoint).setProject(config.projectId).setSession(session.secret),
  );
};

const workDir = await mkdtemp(join(tmpdir(), "snb-e2e-backup-"));

// --- a real athlete, a real coach, real training ----------------------
console.log("\nBefore the disaster");
const athlete = await users.create({
  userId: ID.unique(),
  email: `backup-athlete-${stamp}@example.com`,
  password: "Backup-pass-123!",
  name: "Joey Pang",
});
const coach = await users.create({
  userId: ID.unique(),
  email: `backup-coach-${stamp}@example.com`,
  password: "Backup-pass-123!",
  name: "Ruairi Deane",
});

const circle = await teams.create({
  teamId: circleTeamId(athlete.$id),
  name: "Joey Pang — circle",
});
await teams.createMembership({ teamId: circle.$id, userId: athlete.$id, roles: [CIRCLE_ROLES.athlete] });
await teams.createMembership({ teamId: circle.$id, userId: coach.$id, roles: [CIRCLE_ROLES.coach] });

const profile = await adminDb.createRow({
  databaseId: db, tableId: "profiles", rowId: ID.unique(),
  data: {
    user_id: athlete.$id,
    display_name: "Joey Pang",
    units: "kg",
    created_at: new Date().toISOString(),
  },
  permissions: profilePermissions({ athleteId: athlete.$id }),
});
const session = await adminDb.createRow({
  databaseId: db, tableId: "sessions", rowId: ID.unique(),
  data: {
    athlete_id: athlete.$id,
    started_at: new Date().toISOString(),
    client_session_id: `backup-session-${stamp}`,
  },
  permissions: sessionPermissions({ athleteId: athlete.$id }),
});
const set = await adminDb.createRow({
  databaseId: db, tableId: "sets", rowId: ID.unique(),
  data: {
    session_id: session.$id,
    athlete_id: athlete.$id,
    exercise_id: ID.unique(),
    set_index: 1,
    load_kg: 142.5,
    reps: 5,
    rpe: 8,
    e1rm_kg: 165,
    logged_at: new Date().toISOString(),
    client_set_id: `backup-set-${stamp}`,
  },
  permissions: setPermissions({ athleteId: athlete.$id }),
});

const coachDb = await sessionFor(coach.$id);
check("the coach can read the athlete's set to begin with", await canRead(coachDb, "sets", set.$id));

// --- the backup -------------------------------------------------------
const dumpDir = join(workDir, "dump");
const backup = await dumpNow(dumpDir);

const dumpedSet = backup.tables.find((t) => t.id === "sets")?.rows.find((r) => r.$id === set.$id);
const dumpedTeam = backup.teams.find((t) => t.$id === circle.$id);
check("the dump holds the set", Boolean(dumpedSet));
check("with its permissions, not just its numbers", (dumpedSet?.$permissions.length ?? 0) === 4);
check("and the load that was lifted", dumpedSet?.data.load_kg === 142.5);
check("the dump holds the athlete's account", backup.users.some((u) => u.$id === athlete.$id));
check("and the circle, with the coach in it", dumpedTeam?.memberships.length === 2);
check(
  "and no password material anywhere in it",
  !/"(password|hash|secret|providerAccessToken)"/.test(JSON.stringify(backup)),
);

// --- the disaster -----------------------------------------------------
console.log("\nAfter losing all of it");
for (const [tableId, row] of [["sets", set], ["sessions", session], ["profiles", profile]] as const) {
  await adminDb.deleteRow({ databaseId: db, tableId, rowId: row.$id });
}
await teams.delete({ teamId: circle.$id });
await users.delete({ userId: athlete.$id });
await users.delete({ userId: coach.$id });
check("the set is gone", !(await canRead(adminDb, "sets", set.$id)));

// --- the restore ------------------------------------------------------
console.log("\nAfter restoring from the dump");
const fromDisk = await readBackup(dumpDir);
const report = await restoreBackup(target, fromDisk);

const restored = await adminDb.getRow({ databaseId: db, tableId: "sets", rowId: set.$id });
check("the set is back, under the same id", restored.$id === set.$id);
check("with the same load", restored.load_kg === 142.5);
check(
  "and byte-identical permissions",
  JSON.stringify(restored.$permissions.slice().sort()) ===
    JSON.stringify(set.$permissions.slice().sort()),
);
check("the athlete's account exists again", Boolean(await users.get({ userId: athlete.$id })));
check(
  "the circle has both members again",
  (await teams.listMemberships({ teamId: circle.$id })).memberships.length === 2,
);

// The check the whole feature is for. Rows, users and teams can all come back
// and still leave the coach staring at an empty roster if the permissions or
// the membership did not survive.
const coachDbAfter = await sessionFor(coach.$id);
check("THE COACH CAN READ THE SET AGAIN", await canRead(coachDbAfter, "sets", set.$id));
check("the athlete can read their own session", await canRead(await sessionFor(athlete.$id), "sessions", session.$id));

check(
  "restoring twice changes nothing",
  (await restoreBackup(target, fromDisk)).rows.sets.created === 0,
);
check("the first restore reported what it created", report.rows.sets.created === 1);

// --- teardown ---------------------------------------------------------
for (const [tableId, row] of [["sets", set], ["sessions", session], ["profiles", profile]] as const) {
  await adminDb.deleteRow({ databaseId: db, tableId, rowId: row.$id });
}
await teams.delete({ teamId: circle.$id });
await users.delete({ userId: athlete.$id });
await users.delete({ userId: coach.$id });
await rm(workDir, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(
  failed.length === 0
    ? `\n${results.length}/${results.length} passed. Cast, circle and dump removed.`
    : `\n${failed.length} FAILED: ${failed.map((f) => f.label).join("; ")}`,
);
process.exitCode = failed.length === 0 ? 0 : 1;
