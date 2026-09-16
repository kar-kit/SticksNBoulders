/**
 * Drives DOTS against the live instance.
 *
 *   npm run e2e:dots
 *
 * The arithmetic is unit-tested against published scores and needs no network.
 * What only the instance can prove is the composition, because DOTS is the
 * first number in the product assembled from five tables at once: `profiles`
 * for sex, `bodyweight_entries` for the weight, `reference_maxes` and
 * `stats_rollups` for the three lifts, and `exercises` to know which three.
 *
 * So the headline check is that a linked coach reads all five through the
 * circle team and lands on exactly the number the athlete sees. Five tables is
 * five chances for one of them to be readable by the athlete and not by their
 * coach, and the failure would not look like a permission error -- it would
 * look like a slightly different score, or a "waiting on a weigh-in" on a
 * screen that exists so Ruairi stops having to ask.
 *
 * The rest is the decisions that would otherwise only be claimed: that a
 * training max cannot move the number, that a squat variation cannot enter the
 * total, and that revocation takes it all away.
 *
 * Creates throwaway users and removes them and their rows. Point it at dev.
 */
import { Query, TablesDB, Teams, Users } from "node-appwrite";
import { Client as WebClient, TablesDB as WebTablesDB } from "appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { ensureCircle, addCoachToCircle } from "../appwrite/documents/circle-admin";
import { circleTeamId } from "../appwrite/documents/circle";
import { bodyweightRowId } from "../appwrite/documents";
import {
  bodyweightPermissions,
  exercisePermissions,
  profilePermissions,
  referenceMaxPermissions,
  rollupPermissions,
} from "../appwrite/documents/policy";
import { dotsFor, dotsScore, formatDots, type DotsResult } from "../lib/strength/dots";
import type { BodyweightEntry } from "../lib/bodyweight/bodyweight";
import type { Exercise } from "../lib/exercises/match";
import type { EstimatedInput, ReferenceMaxEntry } from "../lib/strength/reference-max";

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
    userId: `e2edt${tag}${stamp}`,
    email: `e2e-dots-${tag}-${stamp}@sticksnboulders.test`,
    password: `Pw-${stamp}-${tag}A1!`,
    name,
  });

const athlete = await mkUser("a", "DOTS Athlete");
const coach = await mkUser("c", "DOTS Coach");
const stranger = await mkUser("s", "DOTS Stranger");

/**
 * A lifter the maths is easy to check by hand: 82.4kg, 212.5 / 140 / 200.
 * The expected score is computed from the published coefficients in the unit
 * tests, not here -- this script proves the plumbing delivers those inputs.
 */
const BODYWEIGHT_KG = 82.4;
const WEIGH_IN_DAY = "2026-09-16";
const TODAY = "2026-09-16";
const SQUAT_KG = 212.5;
const BENCH_KG = 140;
const DEADLIFT_KG = 200;
const EXPECTED = dotsScore("male", BODYWEIGHT_KG, SQUAT_KG + BENCH_KG + DEADLIFT_KG);

const writtenMaxes: string[] = [];
const writtenRollups: string[] = [];
const writtenExercises: string[] = [];
let failure: unknown = null;

/** Reads rows as one actor and assembles DOTS exactly as both screens do. */
const dotsAs = async (tables: WebTablesDB, today = TODAY): Promise<DotsResult> => {
  const profileRow = await tables
    .getRow({ databaseId: db, tableId: "profiles", rowId: athlete.$id })
    .catch(() => null);
  const raw = profileRow as unknown as Record<string, unknown> | null;
  const sex = raw?.sex === "male" || raw?.sex === "female" ? raw.sex : null;

  const bwRows = await tables
    .listRows({
      databaseId: db,
      tableId: "bodyweight_entries",
      queries: [Query.equal("athlete_id", athlete.$id), Query.limit(50)],
    })
    .then((page) => page.rows)
    .catch(() => []);

  const bodyweight: BodyweightEntry[] = bwRows.map((row) => {
    const r = row as unknown as Record<string, unknown>;
    return {
      id: row.$id,
      athleteId: String(r.athlete_id),
      weightKg: Number(r.weight_kg),
      measuredOn: String(r.measured_on),
      recordedAt: String(r.recorded_at),
    };
  });

  const maxRows = await tables
    .listRows({
      databaseId: db,
      tableId: "reference_maxes",
      queries: [Query.equal("athlete_id", athlete.$id), Query.limit(50)],
    })
    .then((page) => page.rows)
    .catch(() => []);

  const entries: ReferenceMaxEntry[] = maxRows.map((row) => {
    const r = row as unknown as Record<string, unknown>;
    return {
      id: row.$id,
      exerciseId: String(r.exercise_id),
      kind: r.kind === "training" ? "training" : "tested",
      valueKg: Number(r.value_kg),
      effectiveFrom: String(r.effective_from),
      recordedBy: String(r.recorded_by),
    };
  });

  const rollupRows = await tables
    .listRows({
      databaseId: db,
      tableId: "stats_rollups",
      queries: [Query.equal("athlete_id", athlete.$id), Query.limit(50)],
    })
    .then((page) => page.rows)
    .catch(() => []);

  const estimated = new Map<string, EstimatedInput>();
  for (const row of rollupRows) {
    const r = row as unknown as Record<string, unknown>;
    const valueKg = Number(r.best_e1rm_kg);
    if (!Number.isFinite(valueKg) || valueKg <= 0) continue;
    const id = String(r.exercise_id);
    const current = estimated.get(id);
    if (!current || valueKg > current.valueKg) {
      estimated.set(id, { valueKg, asOf: String(r.week_start) });
    }
  }

  const exerciseRows = await tables
    .listRows({
      databaseId: db,
      tableId: "exercises",
      queries: [
        Query.or([Query.equal("is_global", true), Query.equal("owner_id", athlete.$id)]),
        Query.limit(200),
      ],
    })
    .then((page) => page.rows)
    .catch(() => []);

  const exercises: Exercise[] = exerciseRows.flatMap((row) => {
    const r = row as unknown as Record<string, unknown>;
    if (typeof r.name !== "string" || typeof r.normalised_name !== "string") return [];
    return [
      {
        id: row.$id,
        name: r.name,
        normalisedName: r.normalised_name,
        isGlobal: r.is_global === true,
        ownerId: typeof r.owner_id === "string" ? r.owner_id : null,
      },
    ];
  });

  return dotsFor({ sex, bodyweight, entries, estimated, exercises, asOf: new Date(), today });
};

try {
  await ensureCircle(teams, athlete.$id, "DOTS Athlete");
  await addCoachToCircle(teams, athlete.$id, coach.$id);

  const athleteDb = asUser((await users.createSession({ userId: athlete.$id })).secret);
  const coachDb = asUser((await users.createSession({ userId: coach.$id })).secret);
  const strangerDb = asUser((await users.createSession({ userId: stranger.$id })).secret);

  // --- the three competition lifts ----------------------------------------
  // Used if the instance is seeded, created if it is not, so this runs on a
  // bare instance without inventing a second global "Squat" on a seeded one.
  const findOrCreateLift = async (name: string, normalised: string) => {
    const existing = await adminDb.listRows({
      databaseId: db,
      tableId: "exercises",
      queries: [
        Query.equal("normalised_name", normalised),
        Query.equal("is_global", true),
        Query.limit(1),
      ],
    });
    if (existing.rows.length > 0) return existing.rows[0].$id;

    const rowId = `e2edt-${normalised.replace(/\s+/g, "-")}-${stamp}`;
    await adminDb.createRow({
      databaseId: db,
      tableId: "exercises",
      rowId,
      data: { name, normalised_name: normalised, is_global: true, created_at: new Date().toISOString() },
      permissions: exercisePermissions({ athleteId: athlete.$id, isGlobal: true }),
    });
    writtenExercises.push(rowId);
    return rowId;
  };

  const squatId = await findOrCreateLift("Squat", "squat");
  const benchId = await findOrCreateLift("Bench Press", "bench press");
  const deadliftId = await findOrCreateLift("Deadlift", "deadlift");
  // A variation that must never be mistaken for the competition lift.
  const pauseSquatId = await findOrCreateLift("Pause Squat", "pause squat");

  // --- profile, with no sex yet -------------------------------------------
  await athleteDb.createRow({
    databaseId: db,
    tableId: "profiles",
    rowId: athlete.$id,
    data: {
      user_id: athlete.$id,
      display_name: "DOTS Athlete",
      sex: null,
      units: "kg",
      created_at: new Date().toISOString(),
    },
    permissions: profilePermissions({ athleteId: athlete.$id }),
  });

  const noSex = await dotsAs(athleteDb);
  // The blueprint is explicit: fail gracefully with a prompt to complete the
  // profile rather than showing a broken figure.
  check("without a sex there is no score, and the reason says so", noSex.status === "no-sex", noSex.status);

  await athleteDb.updateRow({
    databaseId: db,
    tableId: "profiles",
    rowId: athlete.$id,
    data: { sex: "male" },
    permissions: profilePermissions({ athleteId: athlete.$id }),
  });

  const noWeight = await dotsAs(athleteDb);
  check("with a sex but no weigh-in it asks for the scales", noWeight.status === "no-bodyweight", noWeight.status);

  // --- the weigh-in -------------------------------------------------------
  const bwRowId = bodyweightRowId(athlete.$id, WEIGH_IN_DAY);
  await athleteDb.createRow({
    databaseId: db,
    tableId: "bodyweight_entries",
    rowId: bwRowId,
    data: {
      athlete_id: athlete.$id,
      weight_kg: BODYWEIGHT_KG,
      measured_on: WEIGH_IN_DAY,
      recorded_at: new Date().toISOString(),
    },
    permissions: bodyweightPermissions({ athleteId: athlete.$id }),
  });

  const noLifts = await dotsAs(athleteDb);
  check(
    "a weigh-in alone is not a total — it names all three missing lifts",
    noLifts.status === "incomplete-total" && noLifts.missing.length === 3,
    noLifts.status,
  );

  // --- the lifts ----------------------------------------------------------
  // `reference_maxes` is a server-only table by policy, so these go in with the
  // API key exactly as the route does.
  const putMax = async (exerciseId: string, kind: "tested" | "training", valueKg: number) => {
    const rowId = `e2edt-${kind}-${exerciseId}-${valueKg}-${stamp}`.slice(0, 36);
    await adminDb.createRow({
      databaseId: db,
      tableId: "reference_maxes",
      rowId,
      data: {
        athlete_id: athlete.$id,
        exercise_id: exerciseId,
        kind,
        value_kg: valueKg,
        effective_from: new Date("2026-09-01T00:00:00Z").toISOString(),
        recorded_by: coach.$id,
        created_at: new Date().toISOString(),
      },
      permissions: referenceMaxPermissions({ athleteId: athlete.$id }),
    });
    writtenMaxes.push(rowId);
  };

  const putRollup = async (exerciseId: string, bestE1rm: number, tag: string) => {
    const rowId = `e2edt-ru-${tag}-${stamp}`.slice(0, 36);
    await adminDb.createRow({
      databaseId: db,
      tableId: "stats_rollups",
      rowId,
      data: {
        athlete_id: athlete.$id,
        exercise_id: exerciseId,
        week_start: new Date("2026-09-07T00:00:00Z").toISOString(),
        set_count: 3,
        volume_reps: 9,
        tonnage_kg: 1800,
        best_e1rm_kg: bestE1rm,
        rebuilt_at: new Date().toISOString(),
      },
      permissions: rollupPermissions({ athleteId: athlete.$id }),
    });
    writtenRollups.push(rowId);
  };

  await putMax(squatId, "tested", SQUAT_KG);
  await putMax(benchId, "tested", BENCH_KG);
  await putMax(deadliftId, "tested", DEADLIFT_KG);

  const ready = await dotsAs(athleteDb);
  check(
    "the athlete sees a score assembled from five tables",
    ready.status === "ready" && Math.abs(ready.score - EXPECTED) < 1e-9,
    ready.status === "ready" ? formatDots(ready.score) : ready.status,
  );
  check(
    "and it is not stale, because the weigh-in is today",
    ready.status === "ready" && !ready.stale,
  );

  // --- the check this script exists for -----------------------------------
  const coachSees = await dotsAs(coachDb);
  check(
    "their coach reads all five tables and lands on the same number — this is the feature",
    coachSees.status === "ready" &&
      ready.status === "ready" &&
      coachSees.score === ready.score &&
      coachSees.totalKg === ready.totalKg,
    coachSees.status === "ready" ? formatDots(coachSees.score) : coachSees.status,
  );

  // --- the decisions, proved rather than claimed --------------------------
  await putMax(squatId, "training", 180);
  const withTrainingMax = await dotsAs(athleteDb);
  // A coach starting a conservative block must not lower their athlete's
  // progression number. This is the one decision the whole feature turns on.
  check(
    "a training max does not move the score",
    withTrainingMax.status === "ready" && Math.abs(withTrainingMax.score - EXPECTED) < 1e-9,
    withTrainingMax.status === "ready" ? formatDots(withTrainingMax.score) : withTrainingMax.status,
  );

  await putRollup(pauseSquatId, 400, "pause");
  const withVariation = await dotsAs(athleteDb);
  // Pause Squat is its own exercise with its own max. A substring match on
  // "squat" would have just added 400kg to this athlete's total.
  check(
    "a squat variation stays out of the total",
    withVariation.status === "ready" && Math.abs(withVariation.score - EXPECTED) < 1e-9,
    withVariation.status === "ready" ? formatDots(withVariation.score) : withVariation.status,
  );

  await putRollup(squatId, 225, "sq");
  const withBetterE1rm = await dotsAs(athleteDb);
  const betterExpected = dotsScore("male", BODYWEIGHT_KG, 225 + BENCH_KG + DEADLIFT_KG);
  // The rolling e1RM beats the tested max here, and the better number wins.
  check(
    "a better e1RM from the rollups raises it",
    withBetterE1rm.status === "ready" && Math.abs(withBetterE1rm.score - betterExpected) < 1e-9,
    withBetterE1rm.status === "ready" ? formatDots(withBetterE1rm.score) : withBetterE1rm.status,
  );

  // --- stale -------------------------------------------------------------
  const stale = await dotsAs(athleteDb, "2026-10-16");
  // Still a number, still labelled. Hiding it would empty the coach's panel;
  // showing it bare would present a month-old weight as this morning's.
  check(
    "a month-old weigh-in still scores, and is flagged stale",
    stale.status === "ready" && stale.stale && stale.measuredOn === WEIGH_IN_DAY,
    stale.status,
  );

  // --- who may not see it -------------------------------------------------
  const strangerSees = await dotsAs(strangerDb);
  check(
    "a stranger gets no score at all",
    strangerSees.status !== "ready",
    strangerSees.status,
  );

  const { memberships } = await teams.listMemberships({ teamId: circleTeamId(athlete.$id) });
  const membership = memberships.find((m) => m.userId === coach.$id);
  if (membership) {
    await teams.deleteMembership({ teamId: circleTeamId(athlete.$id), membershipId: membership.$id });
  }
  const revoked = await dotsAs(coachDb);
  check("a revoked coach loses the score with everything else", revoked.status !== "ready", revoked.status);
} catch (error) {
  failure = error;
  check("ran without throwing", false, String(error));
} finally {
  await adminDb
    .deleteRow({ databaseId: db, tableId: "bodyweight_entries", rowId: bodyweightRowId(athlete.$id, WEIGH_IN_DAY) })
    .catch(() => {});
  await adminDb.deleteRow({ databaseId: db, tableId: "profiles", rowId: athlete.$id }).catch(() => {});
  for (const rowId of writtenMaxes) {
    await adminDb.deleteRow({ databaseId: db, tableId: "reference_maxes", rowId }).catch(() => {});
  }
  for (const rowId of writtenRollups) {
    await adminDb.deleteRow({ databaseId: db, tableId: "stats_rollups", rowId }).catch(() => {});
  }
  // Only the ones this run created. A seeded library is left exactly as found.
  for (const rowId of writtenExercises) {
    await adminDb.deleteRow({ databaseId: db, tableId: "exercises", rowId }).catch(() => {});
  }
  await teams.delete({ teamId: circleTeamId(athlete.$id) }).catch(() => {});
  for (const id of [athlete.$id, coach.$id, stranger.$id]) {
    await users.delete({ userId: id }).catch(() => {});
  }
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0 || failure) process.exit(1);
