/**
 * Drives the profile against the live instance.
 *
 *   npm run e2e:profile
 *
 * Profiles are the one owned table with no server route in front of them, and
 * this is what justifies that. The row id IS the user id and every permission
 * on it names the owner, so Appwrite refuses a row stamped for somebody else --
 * the same rule that stopped a coach stamping an athlete's read at Order 17,
 * working in our favour for once.
 *
 * The other claim here is less obvious and more important: a coach can read
 * their athlete's profile. `fetchAthleteNames` reads this table, so that one
 * assertion is the difference between a coach's rail showing names and showing
 * nothing at all -- which is what it did before this ticket, because nothing
 * ever created a profile row.
 *
 * Creates throwaway users and removes them. Point it at dev.
 */
import { Query, TablesDB, Teams, Users } from "node-appwrite";
import { Client as WebClient, TablesDB as WebTablesDB } from "appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { ensureCircle, addCoachToCircle } from "../appwrite/documents/circle-admin";
import { circleTeamId } from "../appwrite/documents/circle";
import { profilePermissions } from "../appwrite/documents/policy";

dedupeSdkWarnings();

const config = serverAppwriteConfig();
const admin = createServerClient(config);
const users = new Users(admin);
const teams = new Teams(admin);
const adminDb = new TablesDB(admin);
const db = config.databaseId;
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

const mkUser = async (tag: string, name: string) =>
  users.create({
    userId: `e2eprof${tag}${stamp}`,
    email: `e2e-profile-${tag}-${stamp}@sticksnboulders.test`,
    password: `Pw-${stamp}-${tag}A1!`,
    name,
  });

const athlete = await mkUser("a", "Profile Athlete");
const coach = await mkUser("c", "Profile Coach");
const stranger = await mkUser("s", "Profile Stranger");
let failure: unknown = null;

try {
  await ensureCircle(teams, athlete.$id, "Profile Athlete");
  await addCoachToCircle(teams, athlete.$id, coach.$id);

  const athleteDb = asUser((await users.createSession({ userId: athlete.$id })).secret);
  const coachDb = asUser((await users.createSession({ userId: coach.$id })).secret);
  const strangerDb = asUser((await users.createSession({ userId: stranger.$id })).secret);

  // --- creating it --------------------------------------------------------
  let created = true;
  let createError = "";
  try {
    await athleteDb.createRow({
      databaseId: db,
      tableId: "profiles",
      rowId: athlete.$id,
      data: {
        user_id: athlete.$id,
        display_name: "Profile Athlete",
        // Deliberately absent. Every profile backfilled onto an existing
        // account starts this way, and a column that refused it would turn a
        // missing number into a missing athlete.
        sex: null,
        units: "kg",
        created_at: new Date().toISOString(),
      },
      permissions: profilePermissions({ athleteId: athlete.$id }),
    });
  } catch (error) {
    created = false;
    createError = (error as Error).message;
  }
  check("an athlete creates their own profile, with no server route", created, createError);
  check("and it is written without a sex, which is the backfill case", created);

  // --- the one that makes the coach's rail work ---------------------------
  const seen = await coachDb.listRows({
    databaseId: db,
    tableId: "profiles",
    queries: [Query.equal("user_id", [athlete.$id]), Query.limit(5), Query.select(["display_name"])],
  });
  check("their coach can read it — this is the rail and the queue's names", seen.rows.length === 1, `${seen.rows.length} rows`);

  const notSeen = await strangerDb.listRows({
    databaseId: db,
    tableId: "profiles",
    queries: [Query.limit(10)],
  });
  check("a stranger reads no profiles at all", notSeen.rows.length === 0, `${notSeen.rows.length} rows`);

  // --- editing it ---------------------------------------------------------
  let answered = true;
  try {
    await athleteDb.updateRow({
      databaseId: db,
      tableId: "profiles",
      rowId: athlete.$id,
      data: { sex: "male", units: "lb", display_name: "Joey P" },
      permissions: profilePermissions({ athleteId: athlete.$id }),
    });
  } catch {
    answered = false;
  }
  check("the athlete can answer sex and change units later", answered);

  let coachEdited = true;
  try {
    await coachDb.updateRow({ databaseId: db, tableId: "profiles", rowId: athlete.$id, data: { sex: "female" } });
  } catch {
    coachEdited = false;
  }
  // A coach setting their athlete's sex would be a coach setting their DOTS.
  check("the coach can read it but not edit it", !coachEdited);

  // --- the forgery that this table's design rests on ----------------------
  let forged = true;
  try {
    await athleteDb.createRow({
      databaseId: db,
      tableId: "profiles",
      rowId: coach.$id,
      data: {
        user_id: coach.$id,
        display_name: "Hijacked",
        units: "kg",
        created_at: new Date().toISOString(),
      },
      permissions: profilePermissions({ athleteId: coach.$id }),
    });
  } catch {
    forged = false;
  }
  check("nobody can create a profile under somebody else's id", !forged);
  if (forged) {
    await adminDb.deleteRow({ databaseId: db, tableId: "profiles", rowId: coach.$id }).catch(() => {});
  }

  // --- revocation ---------------------------------------------------------
  const { memberships } = await teams.listMemberships({ teamId: circleTeamId(athlete.$id) });
  const membership = memberships.find((m) => m.userId === coach.$id);
  if (membership) {
    await teams.deleteMembership({ teamId: circleTeamId(athlete.$id), membershipId: membership.$id });
  }
  const afterRevoke = await coachDb.listRows({
    databaseId: db,
    tableId: "profiles",
    queries: [Query.equal("user_id", [athlete.$id]), Query.limit(5)],
  });
  check("an unlinked coach loses the name too", afterRevoke.rows.length === 0, `${afterRevoke.rows.length} rows`);
} catch (error) {
  failure = error;
  check("ran without throwing", false, String(error));
} finally {
  await adminDb.deleteRow({ databaseId: db, tableId: "profiles", rowId: athlete.$id }).catch(() => {});
  await teams.delete({ teamId: circleTeamId(athlete.$id) }).catch(() => {});
  for (const id of [athlete.$id, coach.$id, stranger.$id]) {
    await users.delete({ userId: id }).catch(() => {});
  }
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0 || failure) process.exit(1);
