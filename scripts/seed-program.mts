/**
 * Seeds a realistic sample program for a fixture coach and athlete.
 *
 *   npm run programs:seed                                    # fixture pair, block starts today
 *   npm run programs:seed -- --start 2026-10-05              # block starts on a given Monday
 *   npm run programs:seed -- --coach <id> --athlete <id>     # an existing, already-linked pair
 *   npm run programs:seed -- --template                      # an unassigned template instead
 *
 * Exists because there is no Program Editor to write one with: the editor is
 * blocked on how Ruairi writes a block. The program goes in through the same
 * validated, authorised ops the editor will send (lib/programming/program.ts
 * and appwrite/documents/program-admin.ts), so it is exactly as valid as an
 * edited one -- this is not a back door.
 *
 * The fixture pair is created once and reused: deterministic ids, a password
 * printed below, so Joey can sign in as either side on a dev server and see a
 * prescribed session on Today. Re-running archives the fixture athlete's
 * previous seeded program first, so Today never has two to choose between.
 *
 * It deletes nothing, ever. Seven agents share this instance.
 */
import { Query, TablesDB, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { calendarDay, localDay } from "../lib/programming/program";
import { linkPair, opRunner, sampleExerciseIds, seedSampleProgram } from "./program-fixtures";

dedupeSdkWarnings();

const arg = (flag: string): string | null => {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? (process.argv[at + 1] ?? null) : null;
};

const FIXTURE = {
  coach: { id: "snbseedcoach", name: "Seed Coach", email: "seed-coach@sticksnboulders.test" },
  athlete: { id: "snbseedathlete", name: "Seed Athlete", email: "seed-athlete@sticksnboulders.test" },
  password: "Seed-pass-123!",
};

const config = serverAppwriteConfig();
const client = createServerClient(config);
const users = new Users(client);
const db = new TablesDB(client);

const startOn = arg("--start") ?? localDay();
if (!calendarDay.safeParse(startOn).success) {
  console.error(`--start must be YYYY-MM-DD, got ${startOn}`);
  process.exit(1);
}
const asTemplate = process.argv.includes("--template");
const customCoach = arg("--coach");
const customAthlete = arg("--athlete");
if (Boolean(customCoach) !== Boolean(customAthlete)) {
  console.error("Pass both --coach and --athlete, or neither.");
  process.exit(1);
}

const ensureUser = async (u: { id: string; name: string; email: string }) => {
  const existing = await users.get({ userId: u.id }).catch(() => null);
  if (existing) return existing;
  return users.create({ userId: u.id, email: u.email, password: FIXTURE.password, name: u.name });
};

const coachId = customCoach ?? (await ensureUser(FIXTURE.coach)).$id;
const athleteId = asTemplate ? null : (customAthlete ?? (await ensureUser(FIXTURE.athlete)).$id);

console.log(`Seeding a sample program on ${config.endpoint}`);
console.log(`  coach ${coachId}${athleteId ? `, athlete ${athleteId}` : ", as a template"}`);

if (athleteId && !customAthlete) {
  await linkPair(client, config.databaseId, {
    coachId,
    coachName: FIXTURE.coach.name,
    athleteId,
    athleteName: FIXTURE.athlete.name,
  });
}

// Archive, never delete: a session may already point at an old program's day.
if (athleteId) {
  const previous = await db.listRows({
    databaseId: config.databaseId,
    tableId: "programs",
    queries: [
      Query.equal("athlete_id", athleteId),
      Query.equal("coach_id", coachId),
      Query.equal("status", "published"),
      Query.limit(50),
    ],
  });
  const run = opRunner(client, config.databaseId, coachId);
  for (const row of previous.rows) {
    await run({ op: "updateProgram", programId: row.$id, status: "archived" });
    console.log(`  archived previous program ${row.$id}`);
  }
}

const { ids, created } = await sampleExerciseIds(client, config.databaseId);
if (created.length > 0) console.log(`  created ${created.length} missing library exercise(s)`);

const written = await seedSampleProgram(client, config.databaseId, coachId, athleteId, startOn, ids);
const counts = written.rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.table]: (acc[r.table] ?? 0) + 1 }), {});

console.log(`\nProgram ${written.programId}`);
for (const [table, count] of Object.entries(counts)) console.log(`  ${table.padEnd(16)} ${count}`);
if (athleteId) {
  console.log(`  first session on ${startOn}${written.daysOn.has(startOn) ? " (day " + written.daysOn.get(startOn) + ")" : ""}`);
}
if (!customCoach) {
  console.log(`\nSign in as ${FIXTURE.athlete.email} or ${FIXTURE.coach.email}, password ${FIXTURE.password}`);
}
