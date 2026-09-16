/**
 * Drives bodyweight against the live instance.
 *
 *   npm run e2e:bodyweight
 *
 * Two claims worth proving here, and only one of them is about permissions.
 *
 * The first is the feature itself: a coach can read their athlete's weigh-ins.
 * Ruairi asked for bodyweight because he currently has to ask people what they
 * weigh, so that single read IS the feature -- the athlete's own screen is
 * merely how the number gets there.
 *
 * The second is "one entry per day", which is enforced by a derived row id
 * rather than by a check. Logging twice on the same morning has to correct the
 * first number rather than sit beside it, because two weigh-ins on one day
 * would quietly drag the rolling average that the whole screen is about.
 *
 * Creates throwaway users and removes them and their entries. Point it at dev.
 */
import { Query, TablesDB, Teams, Users } from "node-appwrite";
import { Client as WebClient, TablesDB as WebTablesDB } from "appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { ensureCircle, addCoachToCircle } from "../appwrite/documents/circle-admin";
import { circleTeamId } from "../appwrite/documents/circle";
import { bodyweightRowId } from "../appwrite/documents";
import { bodyweightPermissions } from "../appwrite/documents/policy";
import { rollingAverage, trend, type BodyweightEntry } from "../lib/bodyweight/bodyweight";

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
    userId: `e2ebw${tag}${stamp}`,
    email: `e2e-bw-${tag}-${stamp}@sticksnboulders.test`,
    password: `Pw-${stamp}-${tag}A1!`,
    name,
  });

const athlete = await mkUser("a", "BW Athlete");
const coach = await mkUser("c", "BW Coach");
const stranger = await mkUser("s", "BW Stranger");

/** A week of weigh-ins ending today, so the average is a real one. */
const DAYS = ["2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10"];
const WEIGHTS = [83.0, 82.6, 82.8, 82.2, 82.4];
const written: string[] = [];
let failure: unknown = null;

try {
  await ensureCircle(teams, athlete.$id, "BW Athlete");
  await addCoachToCircle(teams, athlete.$id, coach.$id);

  const athleteDb = asUser((await users.createSession({ userId: athlete.$id })).secret);
  const coachDb = asUser((await users.createSession({ userId: coach.$id })).secret);
  const strangerDb = asUser((await users.createSession({ userId: stranger.$id })).secret);

  const write = async (tables: WebTablesDB, actorId: string, day: string, kg: number) => {
    const rowId = bodyweightRowId(actorId, day);
    await tables.createRow({
      databaseId: db,
      tableId: "bodyweight_entries",
      rowId,
      data: {
        athlete_id: actorId,
        weight_kg: kg,
        measured_on: day,
        recorded_at: new Date().toISOString(),
      },
      permissions: bodyweightPermissions({ athleteId: actorId }),
    });
    return rowId;
  };

  // --- the athlete's week -------------------------------------------------
  let logged = true;
  let logError = "";
  try {
    for (let i = 0; i < DAYS.length; i += 1) {
      written.push(await write(athleteDb, athlete.$id, DAYS[i], WEIGHTS[i]));
    }
  } catch (error) {
    logged = false;
    logError = (error as Error).message;
  }
  check("an athlete logs their own weigh-ins", logged, logError);

  // --- one per day, enforced by the id ------------------------------------
  let duplicated = true;
  try {
    await write(athleteDb, athlete.$id, DAYS[0], 99.9);
  } catch {
    duplicated = false;
  }
  // Two entries on one morning would drag the rolling average the screen is
  // built around, so the second has to be a correction rather than an addition.
  check("a second weigh-in on the same day is refused, not appended", !duplicated);

  let corrected = true;
  try {
    await athleteDb.updateRow({
      databaseId: db,
      tableId: "bodyweight_entries",
      rowId: bodyweightRowId(athlete.$id, DAYS[0]),
      data: { weight_kg: 83.4, recorded_at: new Date().toISOString() },
      permissions: bodyweightPermissions({ athleteId: athlete.$id }),
    });
  } catch {
    corrected = false;
  }
  check("but correcting that day's number is allowed", corrected);

  // --- the read that is the whole feature ---------------------------------
  const read = async (tables: WebTablesDB) =>
    (
      await tables.listRows({
        databaseId: db,
        tableId: "bodyweight_entries",
        queries: [
          Query.equal("athlete_id", athlete.$id),
          Query.orderDesc("measured_on"),
          Query.limit(25),
        ],
      })
    ).rows;

  const coachSees = await read(coachDb);
  check(
    "their coach can read every weigh-in — this is the feature",
    coachSees.length === DAYS.length,
    `${coachSees.length} of ${DAYS.length}`,
  );

  const strangerSees = await strangerDb.listRows({
    databaseId: db,
    tableId: "bodyweight_entries",
    queries: [Query.limit(25)],
  });
  check("a stranger reads none of them", strangerSees.rows.length === 0, `${strangerSees.rows.length} rows`);

  let coachWrote = true;
  try {
    await coachDb.updateRow({
      databaseId: db,
      tableId: "bodyweight_entries",
      rowId: bodyweightRowId(athlete.$id, DAYS[0]),
      data: { weight_kg: 70 },
    });
  } catch {
    coachWrote = false;
  }
  // A coach who could edit a bodyweight could edit a DOTS score.
  check("the coach cannot change what the scale said", !coachWrote);

  // --- the numbers the coach's panel shows --------------------------------
  const entries: BodyweightEntry[] = coachSees.map((row) => {
    const raw = row as unknown as Record<string, unknown>;
    return {
      id: row.$id,
      athleteId: String(raw.athlete_id),
      weightKg: Number(raw.weight_kg),
      measuredOn: String(raw.measured_on),
      recordedAt: String(raw.recorded_at),
    };
  });

  const average = rollingAverage(entries, "2026-09-10", 7);
  // 83.4 + 82.6 + 82.8 + 82.2 + 82.4 = 413.4 over five days.
  check("the rolling average over what came back is right", average?.kg === 82.7, `${average?.kg}`);
  check("and it says how many weigh-ins it used", average?.count === 5, `${average?.count}`);
  check("the trend resolves from real rows", trend(entries, 7, "2026-09-10") !== null);

  // --- revocation ---------------------------------------------------------
  const { memberships } = await teams.listMemberships({ teamId: circleTeamId(athlete.$id) });
  const membership = memberships.find((m) => m.userId === coach.$id);
  if (membership) {
    await teams.deleteMembership({ teamId: circleTeamId(athlete.$id), membershipId: membership.$id });
  }
  check("an unlinked coach stops seeing bodyweight", (await read(coachDb)).length === 0);
} catch (error) {
  failure = error;
  check("ran without throwing", false, String(error));
} finally {
  for (const rowId of written) {
    await adminDb.deleteRow({ databaseId: db, tableId: "bodyweight_entries", rowId }).catch(() => {});
  }
  await teams.delete({ teamId: circleTeamId(athlete.$id) }).catch(() => {});
  for (const id of [athlete.$id, coach.$id, stranger.$id]) {
    await users.delete({ userId: id }).catch(() => {});
  }
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0 || failure) process.exit(1);
