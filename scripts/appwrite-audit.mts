/**
 * The permission audit. Run it before each phase ships.
 *
 *   npm run appwrite:audit
 *
 * Creates five real roles against the live instance -- athlete A, A's linked
 * coach, an unlinked coach, an unrelated athlete B, and a client with no
 * session at all -- and for every table and bucket asserts who can read,
 * create, update and delete A's data. Prints a pass/fail matrix and exits
 * non-zero on any failure.
 *
 * Why it exists in this shape: `appwrite:probe` wrote every row with the admin
 * key and only READ through user sessions, so it passed 19/19 while no athlete
 * could write anything at all (PR #8). So here:
 *
 *   - Every legitimate write goes through a genuine user session and the real
 *     write helper (appwrite/documents/write.ts), or -- for the server-only
 *     tables -- through the real route handler, called with a real JWT.
 *   - Every refusal is attempted the way an attacker would: raw calls, the
 *     strongest permissions the attacker is able to stamp, no helper to stop
 *     them.
 *   - Resources are discovered from the schema-as-code AND the live instance,
 *     and anything without a rule in appwrite/audit/rules.ts fails the run.
 *
 * Since 6 Oct 2026 a forgery Appwrite accepts is judged twice: it counts as
 * refused only if no reader trusts it (appwrite/documents/provenance.ts), and
 * the validate-row Function must then delete it within a bounded wait.
 *
 * Safe to run against a shared instance. It creates its own uniquely named
 * fixture users (under example.com, so e2e:prune recognises a stranded one)
 * and deletes only what they own. It never lists-and-deletes by table. The
 * forged rows it writes are stamped so that no reader shows them, and are
 * removed on the way out whether or not the validator got there first.
 */
import { Client, Functions, ID, Query, Storage, TablesDB, Teams, Users, type Models } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { schema } from "../appwrite/schema";
import { circleTeamId } from "../appwrite/documents/circle";
import { libraryTeamMembers } from "../appwrite/documents/library-admin";
import {
  avatarPermissions,
  commentPermissions,
  LIBRARY_TEAM_ID,
  readableByAnySession,
  videoPermissions,
} from "../appwrite/documents/policy";
import { AVATAR_BUCKET, newAvatarFileId } from "../appwrite/documents/avatar";
import { authenticRows, isAuthentic, ownerProof } from "../appwrite/documents/provenance";
import { FUNCTIONS } from "../appwrite/functions";
import type { RowWriter } from "../appwrite/documents/row-writer";
import {
  attachVideo,
  setProfileAvatar,
  bodyweightRowId,
  createExercise,
  createGlobalExercise,
  createProfile,
  createSession,
  createSet,
  deleteBodyweight,
  deleteComment,
  deleteSet,
  finishSession,
  markSetReviewed,
  normaliseExerciseName,
  postComment,
  recordBodyweight,
  reviseBodyweight,
  unmarkSetReviewed,
  updateProfile,
  updateSet,
  type WriteDeps,
} from "../appwrite/documents/write";
import {
  ACTORS,
  ACTOR_LABELS,
  RULES,
  classifyError,
  coverage,
  describeFailure,
  expectedStamp,
  failedCells,
  formatMatrix,
  isAllowed,
  STAMPED_TABLES,
  stampDrift,
  type AuditActor,
  type AuditOp,
  type Cell,
  type DiscoveredResource,
  type Outcome,
  type ResourceRule,
} from "../appwrite/audit/rules";
import { POST as circleRoute } from "../app/api/circle/route";
import { POST as inviteRoute } from "../app/api/invite/route";
import { POST as linkRoute } from "../app/api/link/route";
import { POST as revokeRoute } from "../app/api/link/revoke/route";
import { POST as suggestionsRoute } from "../app/api/link/suggestions/route";
import { POST as programRoute } from "../app/api/program/route";
import { POST as referenceMaxRoute, DELETE as referenceMaxDeleteRoute } from "../app/api/reference-max/route";
import { POST as rollupRoute } from "../app/api/rollup/route";

dedupeSdkWarnings();

const config = serverAppwriteConfig();
const admin = createServerClient(config);
const adminDb = new TablesDB(admin);
const adminStorage = new Storage(admin);
const users = new Users(admin);
const teams = new Teams(admin);
const functions = new Functions(admin);
/** How long the validate-row Function gets to delete a forged row. Cold start included. */
const VALIDATOR_WAIT_MS = 45_000;
const D = config.databaseId;
const BUCKET = "set_videos";
const stamp = `${Date.now()}`;
const verbose = process.argv.includes("--verbose");

/* -------------------------------------------------------------------------
 * Bookkeeping
 * ---------------------------------------------------------------------- */

const cells: Cell[] = [];
const checks: { section: string; label: string; ok: boolean; detail?: string }[] = [];
let section = "";

const check = (label: string, ok: boolean, detail?: string) => {
  checks.push({ section, label, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n          ${detail}` : ""}`);
};

const heading = (title: string) => {
  section = title;
  console.log(`\n${title}`);
};

/** Rows this run wrote, for teardown. Never anything it did not write. */
const createdRows: { table: string; id: string }[] = [];
const createdFiles: { bucketId: string; fileId: string }[] = [];
const createdUsers: string[] = [];

const attempt = async (fn: () => Promise<unknown>): Promise<Outcome> => {
  try {
    await fn();
    return { kind: "allowed" };
  } catch (error) {
    return classifyError(error);
  }
};

const record = (rule: ResourceRule, op: AuditOp, actor: AuditActor, outcome: Outcome, how: string) => {
  cells.push({ rule: rule.key, op, actor, expected: isAllowed(rule, op, actor), outcome, how });
  if (verbose) console.log(`    ${rule.key} ${op} ${actor}: ${outcome.kind}`);
};

const ruleFor = (key: string) => {
  const rule = RULES.find((r) => r.key === key);
  if (!rule) throw new Error(`audit: no rule named ${key}`);
  return rule;
};

/* -------------------------------------------------------------------------
 * The cast
 * ---------------------------------------------------------------------- */

interface Party {
  actor: AuditActor;
  id: string;
  tables: TablesDB;
  storage: Storage;
  /** A real Appwrite JWT for the route handlers. Null for the anonymous client. */
  jwt: string | null;
  deps: WriteDeps;
}

const sessionWriter = (tables: TablesDB): RowWriter => ({
  createRow: (params) => tables.createRow(params),
  updateRow: (params) => tables.updateRow(params),
  deleteRow: (params) => tables.deleteRow(params),
});

const depsFor = (tables: TablesDB): WriteDeps => ({
  writer: sessionWriter(tables),
  databaseId: D,
  newId: () => ID.unique(),
  now: () => new Date(),
});

const mkParty = async (actor: AuditActor, name: string): Promise<Party> => {
  const user = await users.create({
    userId: ID.unique(),
    email: `audit-${actor.toLowerCase()}-${stamp}@example.com`,
    password: `Audit-${stamp}-pass!`,
    name,
  });
  createdUsers.push(user.$id);
  const session = await users.createSession({ userId: user.$id });
  const { jwt } = await users.createJWT({ userId: user.$id, sessionId: session.$id, duration: 3600 });
  const client = new Client().setEndpoint(config.endpoint).setProject(config.projectId).setSession(session.secret);
  const tables = new TablesDB(client);
  return { actor, id: user.$id, tables, storage: new Storage(client), jwt, deps: depsFor(tables) };
};

const anonParty = (): Party => {
  const client = new Client().setEndpoint(config.endpoint).setProject(config.projectId);
  const tables = new TablesDB(client);
  return { actor: "anon", id: "", tables, storage: new Storage(client), jwt: null, deps: depsFor(tables) };
};

type Handler = (request: Request) => Promise<Response>;
let requestCount = 0;

/** Calls a route handler in-process, exactly as Next would, with the caller's JWT. */
const callRoute = async (
  handler: Handler,
  path: string,
  party: Party,
  body?: unknown,
  method = "POST",
): Promise<{ status: number; body: Record<string, unknown> }> => {
  requestCount += 1;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    // A distinct address per request, so the per-IP limiter never mistakes
    // the audit for a brute force.
    "x-forwarded-for": `10.38.${Math.floor(requestCount / 250)}.${requestCount % 250}`,
  };
  if (party.jwt) headers.authorization = `Bearer ${party.jwt}`;
  const response = await handler(
    new Request(`http://audit.local${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
};

/**
 * The strongest read an attacker can stamp: every signed-in user. Appwrite
 * lets any session stamp `users`, because every session holds it. Built by
 * the policy rather than written as a literal the guard test forbids. (It
 * used to borrow the library stamp, which since 6 Oct carries the server's
 * mark -- a role no session holds, so a forgery stamped with it is refused
 * for the wrong reason.)
 */
const readableByEveryone = () => [readableByAnySession()];

/* -------------------------------------------------------------------------
 * Discovery
 * ---------------------------------------------------------------------- */

heading("Resources");

const live: DiscoveredResource[] = [];
try {
  const liveTables = await adminDb.listTables({ databaseId: D, queries: [Query.limit(100)] });
  live.push(...liveTables.tables.map((t) => ({ id: t.$id, kind: "table" as const })));
  const liveBuckets = await adminStorage.listBuckets({ queries: [Query.limit(100)] });
  live.push(...liveBuckets.buckets.map((b) => ({ id: b.$id, kind: "bucket" as const })));
} catch (error) {
  check("the live instance lists its tables and buckets", false, (error as Error).message);
}
const declared: DiscoveredResource[] = [
  ...schema.tables.map((t) => ({ id: t.id, kind: "table" as const })),
  ...schema.buckets.map((b) => ({ id: b.id, kind: "bucket" as const })),
];
const discovered = [...declared, ...live];
const { uncovered, stale } = coverage(discovered);

console.log(
  `  ${declared.length} declared in appwrite/schema, ${live.length} live on ${config.endpoint}, ` +
    `${RULES.length} audit rules`,
);
for (const r of uncovered) {
  const where = [declared.some((d) => d.id === r.id) && "schema", live.some((l) => l.id === r.id) && "live"]
    .filter(Boolean)
    .join("+");
  check(`${r.kind} "${r.id}" (${where}) has an audit rule`, false, "Add one to appwrite/audit/rules.ts.");
}
for (const rule of stale) {
  check(`rule "${rule.key}" audits something that exists`, false, `${rule.kind} "${rule.resource}" is neither declared nor live.`);
}
for (const r of declared) {
  if (!live.some((l) => l.id === r.id && l.kind === r.kind)) {
    check(`${r.kind} "${r.id}" is applied on the instance`, false, "Run npm run appwrite:setup.");
  }
}
if (uncovered.length === 0 && stale.length === 0) check("every table and bucket has an audit rule", true);

// The server half of the forgery fix. Asserted here so a run against an
// instance where it was never deployed, or was switched off in the console,
// fails before anything else is measured.
let validatorLive = false;
for (const spec of FUNCTIONS) {
  try {
    const fn = await functions.get({ functionId: spec.id });
    const eventsMatch = spec.events.every((e) => fn.events.includes(e));
    validatorLive = fn.enabled && fn.deploymentId !== "" && eventsMatch;
    check(
      `Function "${spec.id}" is deployed, enabled and subscribed to its events`,
      validatorLive,
      `enabled=${fn.enabled} activeDeployment=${JSON.stringify(fn.deploymentId)} events ${eventsMatch ? "match" : "differ"}. Run npm run appwrite:functions.`,
    );
  } catch (error) {
    check(`Function "${spec.id}" exists on the instance`, false, `${(error as Error).message}. Run npm run appwrite:functions.`);
  }
}
try {
  const members = await libraryTeamMembers(teams);
  check(`team "${LIBRARY_TEAM_ID}" exists and has no members (its role is the server's mark)`, members.length === 0, `members: ${members.join(", ")}`);
} catch (error) {
  check(`team "${LIBRARY_TEAM_ID}" exists`, false, `${(error as Error).message}. Run npm run appwrite:setup.`);
}

/* -------------------------------------------------------------------------
 * Fixtures, written the way the app writes them
 * ---------------------------------------------------------------------- */

const targets: Record<string, string> = {};
const extras: Record<string, string> = {};
let A!: Party, C!: Party, U!: Party, B!: Party;
const anon = anonParty();

try {
  heading("Fixtures: five roles, and every write through a real session or a real route");

  A = await mkParty("athlete", "Audit Athlete A");
  C = await mkParty("coach", "Audit Coach");
  U = await mkParty("unlinkedCoach", "Audit Unlinked Coach");
  B = await mkParty("otherAthlete", "Audit Athlete B");
  const party: Record<AuditActor, Party> = {
    athlete: A,
    coach: C,
    unlinkedCoach: U,
    otherAthlete: B,
    anon,
  };

  // Circles, through the route the app calls on first write.
  for (const p of [A, B]) {
    const res = await callRoute(circleRoute as Handler, "/api/circle", p);
    check(`POST /api/circle creates ${ACTOR_LABELS[p.actor]}'s circle`, res.status === 200, JSON.stringify(res.body));
  }

  // Invite codes. Both coaches get one: the unlinked coach is a real coach
  // with a code, just not A's.
  const coachInvite = await callRoute(inviteRoute as Handler, "/api/invite", C);
  const unlinkedInvite = await callRoute(inviteRoute as Handler, "/api/invite", U);
  const code = typeof coachInvite.body.code === "string" ? coachInvite.body.code : "";
  check("POST /api/invite mints the coach a code (invite_codes write)", coachInvite.status === 200 && !!code);
  check("and mints the unlinked coach one too", unlinkedInvite.status === 200);
  if (code) targets.invite_codes = code;
  check(
    "POST /api/invite with no session is refused",
    (await callRoute(inviteRoute as Handler, "/api/invite", anon)).status === 401,
  );

  // The link, redeemed by the athlete.
  const linked = await callRoute(linkRoute as Handler, "/api/link", A, { code });
  check("POST /api/link links A to the coach (coach_athlete_links write + circle membership)", linked.body.status === "linked", JSON.stringify(linked.body));
  const linkRow = (
    await adminDb.listRows({
      databaseId: D,
      tableId: "coach_athlete_links",
      queries: [Query.equal("athlete_id", A.id), Query.equal("coach_id", C.id), Query.limit(1)],
    })
  ).rows[0];
  if (linkRow) targets.coach_athlete_links = linkRow.$id;

  // Order 28: the coach's switch on the link row, through its route.
  const suggest = (p: Party, mode: string) =>
    callRoute(suggestionsRoute as Handler, "/api/link/suggestions", p, { athleteId: A.id, mode });
  check("POST /api/link/suggestions: A's coach holds A's suggestions (coach_athlete_links write)", (await suggest(C, "held")).status === 200);
  check("POST /api/link/suggestions: A cannot set his own", (await suggest(A, "direct")).status === 403);
  for (const p of [U, B]) {
    check(`POST /api/link/suggestions: ${ACTOR_LABELS[p.actor]} cannot set A's`, (await suggest(p, "direct")).status === 403);
  }
  check("POST /api/link/suggestions with no session is refused", (await suggest(anon, "direct")).status === 401);

  // A's logged work, through the write helper, as A.
  const ownerCreate = async (key: string, fn: () => Promise<{ $id: string }>, actor: AuditActor = "athlete") => {
    const rule = ruleFor(key);
    try {
      const row = await fn();
      record(rule, "create", actor, { kind: "allowed" }, "the write helper, from their own session");
      return row.$id;
    } catch (error) {
      record(rule, "create", actor, classifyError(error), "the write helper, from their own session");
      return "";
    }
  };

  targets.profiles = await ownerCreate("profiles", () =>
    createProfile(A.deps, { userId: A.id }, { displayName: "Audit Athlete A", sex: "male" }),
  );
  targets.exercises = await ownerCreate("exercises", () =>
    createExercise(A.deps, { userId: A.id }, { name: `Audit Tempo Squat ${stamp}` }),
  );
  targets.sessions = await ownerCreate("sessions", () =>
    createSession(A.deps, { userId: A.id }, { clientSessionId: `audit-session-${stamp}` }),
  );
  const loggedAt = new Date();
  const setInput = (tag: string, loadKg: number) => ({
    sessionId: targets.sessions,
    exerciseId: targets.exercises,
    setIndex: 0,
    loadKg,
    reps: 5,
    rpe: 8,
    clientSetId: `audit-${tag}-${stamp}`,
    loggedAt,
  });
  targets.sets = await ownerCreate("sets", () => createSet(A.deps, { userId: A.id }, setInput("set1", 140)));
  targets.bodyweight_entries = await ownerCreate("bodyweight_entries", () =>
    recordBodyweight(A.deps, { userId: A.id }, { weightKg: 82.4, measuredOn: "2026-01-05" }),
  );

  // The clip: uploaded from A's session, stamped by the policy, then recorded
  // on the set through the helper.
  targets.set_videos = await ownerCreate("set_videos", () =>
    A.storage.createFile({
      bucketId: BUCKET,
      fileId: ID.unique(),
      file: new File([Buffer.alloc(1024, 1)], "audit.mp4", { type: "video/mp4" }),
      permissions: videoPermissions({ athleteId: A.id }),
    }),
  );
  if (targets.set_videos) createdFiles.push({ bucketId: BUCKET, fileId: targets.set_videos });
  check(
    "A records the clip on the set through the helper (attachVideo)",
    (await attempt(() => attachVideo(A.deps, { userId: A.id }, { rowId: targets.sets, videoFileId: targets.set_videos }))).kind === "allowed",
  );

  // A's profile picture: uploaded from A's session into A's own namespace,
  // stamped by the policy, then pointed at through the helper.
  targets.avatars = await ownerCreate("avatars", () =>
    A.storage.createFile({
      bucketId: AVATAR_BUCKET,
      fileId: newAvatarFileId(A.id),
      file: new File([Buffer.alloc(1024, 3)], "avatar.webp", { type: "image/webp" }),
      permissions: avatarPermissions({ userId: A.id }),
    }),
  );
  if (targets.avatars) createdFiles.push({ bucketId: AVATAR_BUCKET, fileId: targets.avatars });
  check(
    "A points the profile at the picture through the helper (setProfileAvatar)",
    (await attempt(() => setProfileAvatar(A.deps, { userId: A.id }, { fileId: targets.avatars }))).kind === "allowed",
  );

  // The coach's side of the review loop, from the coach's own session.
  targets.set_reviews = await ownerCreate(
    "set_reviews",
    () => markSetReviewed(C.deps, { userId: C.id }, { athleteId: A.id, setId: targets.sets }),
    "coach",
  );
  targets.set_comments = await ownerCreate(
    "set_comments",
    () =>
      postComment(C.deps, { userId: C.id }, {
        athleteId: A.id,
        setId: targets.sets,
        body: "Hips shot up out of the hole.",
        clientCommentId: `audit-coach-comment-${stamp}`,
      }),
    "coach",
  );
  extras.reply = await ownerCreate("set_comments", () =>
    postComment(A.deps, { userId: A.id }, {
      athleteId: A.id,
      setId: targets.sets,
      body: "Felt it. Will film the next one.",
      parentId: targets.set_comments,
      clientCommentId: `audit-athlete-reply-${stamp}`,
    }),
  );

  // Rows the revocation checks read after the targets above are deleted.
  extras.set2 = (await createSet(A.deps, { userId: A.id }, setInput("set2", 145))).$id;
  extras.review2 = (await markSetReviewed(C.deps, { userId: C.id }, { athleteId: A.id, setId: extras.set2 })).$id;
  extras.comment2 = (
    await postComment(C.deps, { userId: C.id }, {
      athleteId: A.id,
      setId: extras.set2,
      body: "Better.",
      clientCommentId: `audit-coach-comment2-${stamp}`,
    })
  ).$id;

  // Server-only tables, through their routes, with real JWTs.
  const rollup = await callRoute(rollupRoute as Handler, "/api/rollup", A, {
    exerciseId: targets.exercises,
    loggedAt: loggedAt.toISOString(),
  });
  check("POST /api/rollup writes A's rollup (stats_rollups write)", rollup.body.status === "written", JSON.stringify(rollup.body));
  const rollupRow = (
    await adminDb.listRows({
      databaseId: D,
      tableId: "stats_rollups",
      queries: [Query.equal("athlete_id", A.id), Query.equal("exercise_id", targets.exercises), Query.limit(1)],
    })
  ).rows[0];
  if (rollupRow) targets.stats_rollups = rollupRow.$id;

  const maxBody = (athleteId: string, kind: string, valueKg: number) => ({
    athleteId,
    exerciseId: targets.exercises,
    kind,
    valueKg,
  });
  const coachMax = await callRoute(referenceMaxRoute as Handler, "/api/reference-max", C, maxBody(A.id, "training", 180));
  check("POST /api/reference-max: the coach sets A's training max (reference_maxes write)", coachMax.status === 200, JSON.stringify(coachMax.body));
  if (typeof coachMax.body.rowId === "string") targets.reference_maxes = coachMax.body.rowId;
  const ownMax = await callRoute(referenceMaxRoute as Handler, "/api/reference-max", A, maxBody(A.id, "tested", 185));
  check("POST /api/reference-max: A records his own tested max", ownMax.status === 200, JSON.stringify(ownMax.body));
  if (typeof ownMax.body.rowId === "string") extras.ownMax = ownMax.body.rowId;
  for (const p of [U, B]) {
    const res = await callRoute(referenceMaxRoute as Handler, "/api/reference-max", p, maxBody(A.id, "training", 250));
    check(`POST /api/reference-max: ${ACTOR_LABELS[p.actor]} cannot set a max for A`, res.status === 403, `${res.status} ${JSON.stringify(res.body)}`);
  }
  check(
    "POST /api/reference-max with no session is refused",
    (await callRoute(referenceMaxRoute as Handler, "/api/reference-max", anon, maxBody(A.id, "training", 250))).status === 401,
  );
  for (const p of [U, B]) {
    const res = await callRoute(
      referenceMaxDeleteRoute as Handler,
      `/api/reference-max?id=${encodeURIComponent(targets.reference_maxes ?? "")}`,
      p,
      undefined,
      "DELETE",
    );
    check(`DELETE /api/reference-max: ${ACTOR_LABELS[p.actor]} cannot remove A's max`, res.status === 403, `${res.status}`);
  }

  // The shared library row, which only the server may write.
  const adminDeps: WriteDeps = {
    writer: sessionWriter(adminDb),
    databaseId: D,
    newId: () => ID.unique(),
    now: () => new Date(),
  };
  targets["exercises:library"] = (await createGlobalExercise(adminDeps, { name: `Audit Library Lift ${stamp}` })).$id;
  createdRows.push({ table: "exercises", id: targets["exercises:library"] });

  // Order 19: a program for A, written by A's coach through /api/program. One
  // route, one op per row; the route reads program, coach and athlete from
  // the parent row and never from the body.
  const programOp = (p: Party, op: Record<string, unknown>) => callRoute(programRoute as Handler, "/api/program", p, op);
  const programCreated = await programOp(C, { op: "createProgram", athleteId: A.id, name: `Audit Block ${stamp}`, status: "published" });
  check("POST /api/program: A's coach creates a program for A (programs write)", programCreated.status === 200, JSON.stringify(programCreated.body));
  targets.programs = typeof programCreated.body.rowId === "string" ? programCreated.body.rowId : "";
  if (targets.programs) {
    const block = await programOp(C, { op: "addBlock", programId: targets.programs, name: "Audit block" });
    targets.program_blocks = typeof block.body.rowId === "string" ? block.body.rowId : "";
    const week = await programOp(C, { op: "addWeek", blockId: targets.program_blocks, label: "Week 1", status: "published" });
    targets.program_weeks = typeof week.body.rowId === "string" ? week.body.rowId : "";
    const day = await programOp(C, { op: "addDay", weekId: targets.program_weeks, label: "Day 1" });
    targets.program_days = typeof day.body.rowId === "string" ? day.body.rowId : "";
    const line = await programOp(C, { op: "addPrescription", dayId: targets.program_days, exerciseId: targets["exercises:library"], setCount: 3, reps: 5, load: "75%" });
    targets.prescriptions = typeof line.body.rowId === "string" ? line.body.rowId : "";
    check("and a block, week, day and line under it", Boolean(targets.program_blocks && targets.program_weeks && targets.program_days && targets.prescriptions));
    // docs/reference-lift.md: a percentage OF another lift. The reference is
    // a row id like exercise_id, so the route holds it to the same rule --
    // global or in A's library -- or A's phone prices a percentage off a row
    // it cannot read. A library reference is accepted; the coach's private
    // exercise is refused.
    const referenced = await programOp(C, { op: "updatePrescription", prescriptionId: targets.prescriptions, referenceExerciseId: targets["exercises:library"] });
    check("POST /api/program: A's coach may point a line's percentage at a library lift", referenced.status === 200, `${referenced.status} ${JSON.stringify(referenced.body)}`);
    // A coach's private exercise is stamped read for his own circle, so the
    // circle has to exist first. The app creates it through /api/circle on
    // the coach's first write; the fixtures only gave circles to A and B.
    const coachCircle = await callRoute(circleRoute as Handler, "/api/circle", C);
    check("POST /api/circle creates A's coach's circle", coachCircle.status === 200, JSON.stringify(coachCircle.body));
    const coachPrivate = await createExercise(C.deps, { userId: C.id }, { name: `Audit Coach Private ${stamp}` });
    createdRows.push({ table: "exercises", id: coachPrivate.$id });
    const refused = await programOp(C, { op: "updatePrescription", prescriptionId: targets.prescriptions, referenceExerciseId: coachPrivate.$id });
    check(
      "POST /api/program: A's coach cannot point a line's percentage at his own private exercise (referenceExerciseId: not in the athlete's library)",
      refused.status === 400 && JSON.stringify(refused.body).includes("referenceExerciseId"),
      `${refused.status} ${JSON.stringify(refused.body)}`,
    );
    await programOp(C, { op: "updatePrescription", prescriptionId: targets.prescriptions, referenceExerciseId: null });
  }
  for (const p of [U, B]) {
    const res = await programOp(p, { op: "createProgram", athleteId: A.id, name: "Forged" });
    check(`POST /api/program: ${ACTOR_LABELS[p.actor]} cannot write a program for A`, res.status === 403, `${res.status} ${JSON.stringify(res.body)}`);
    const line = await programOp(p, { op: "addPrescription", dayId: targets.program_days, exerciseId: targets["exercises:library"], setCount: 10, load: "100%" });
    check(`POST /api/program: ${ACTOR_LABELS[p.actor]} cannot add a line to A's program`, line.status === 403, `${line.status}`);
  }
  check("POST /api/program: A cannot write his own programming through his coach's program", (await programOp(A, { op: "addBlock", programId: targets.programs, name: "Mine" })).status === 403);
  // Orders 20/43: duplicating a week and copying a program. The coach may;
  // nobody else may, and the coach may not copy onto an athlete he does not
  // coach -- B here, who has his own circle and no link to C.
  const dup = await programOp(C, { op: "duplicateWeek", weekId: targets.program_weeks });
  check("POST /api/program duplicateWeek: A's coach duplicates a week of A's program", dup.status === 200, `${dup.status} ${JSON.stringify(dup.body)}`);
  const copied = await programOp(C, { op: "copyProgram", programId: targets.programs, athleteId: A.id, name: `Audit Copy ${stamp}` });
  check("POST /api/program copyProgram: A's coach copies A's program back to A as a draft", copied.status === 200, `${copied.status} ${JSON.stringify(copied.body)}`);
  const copyToStranger = await programOp(C, { op: "copyProgram", programId: targets.programs, athleteId: B.id });
  check("POST /api/program copyProgram: A's coach cannot copy it onto athlete B, whom he does not coach", copyToStranger.status === 403, `${copyToStranger.status}`);
  for (const p of [U, B]) {
    check(`POST /api/program duplicateWeek: ${ACTOR_LABELS[p.actor]} cannot duplicate A's week`, (await programOp(p, { op: "duplicateWeek", weekId: targets.program_weeks })).status === 403);
    check(`POST /api/program copyProgram: ${ACTOR_LABELS[p.actor]} cannot copy A's program to themselves`, (await programOp(p, { op: "copyProgram", programId: targets.programs, athleteId: p.id })).status === 403);
  }
  check("POST /api/program duplicateWeek with no session is refused", (await programOp(anon, { op: "duplicateWeek", weekId: targets.program_weeks })).status === 401);
  check("POST /api/program copyProgram with no session is refused", (await programOp(anon, { op: "copyProgram", programId: targets.programs, athleteId: A.id })).status === 401);
  // Per-week release: publishWeek and the way back (updateWeek to draft). The
  // coach round-trips A's week and leaves it published for what follows.
  const pulled = await programOp(C, { op: "updateWeek", weekId: targets.program_weeks, status: "draft" });
  check("POST /api/program updateWeek: A's coach pulls a week of A's program back to draft", pulled.status === 200, `${pulled.status} ${JSON.stringify(pulled.body)}`);
  const released = await programOp(C, { op: "publishWeek", weekId: targets.program_weeks });
  check("POST /api/program publishWeek: A's coach publishes it again", released.status === 200, `${released.status} ${JSON.stringify(released.body)}`);
  for (const p of [U, B, A]) {
    check(`POST /api/program publishWeek: ${ACTOR_LABELS[p.actor]} cannot publish A's week`, (await programOp(p, { op: "publishWeek", weekId: targets.program_weeks })).status === 403);
    check(`POST /api/program updateWeek: ${ACTOR_LABELS[p.actor]} cannot pull A's week back to draft`, (await programOp(p, { op: "updateWeek", weekId: targets.program_weeks, status: "draft" })).status === 403);
  }
  check("POST /api/program publishWeek with no session is refused", (await programOp(anon, { op: "publishWeek", weekId: targets.program_weeks })).status === 401);
  check("POST /api/program with no session is refused", (await programOp(anon, { op: "createProgram", athleteId: A.id, name: "x" })).status === 401);

  // B's own training, so isolation is tested against real data both ways.
  const bSession = await createSession(B.deps, { userId: B.id }, { clientSessionId: `audit-b-session-${stamp}` });
  const bSet = await createSet(B.deps, { userId: B.id }, {
    ...setInput("b-set", 100),
    sessionId: bSession.$id,
  });
  check("athlete B writes his own set through the helper", !!bSet.$id);

  for (const rule of RULES) {
    if (!targets[rule.key]) check(`fixture for ${rule.key} was written`, false, "Every cell for it will error.");
  }

  /* -----------------------------------------------------------------------
   * Reads
   * -------------------------------------------------------------------- */

  const tableOf = (rule: ResourceRule) => rule.resource;
  const readTarget = (p: Party, rule: ResourceRule) =>
    rule.kind === "bucket"
      ? p.storage.getFile({ bucketId: rule.resource, fileId: targets[rule.key] })
      : p.tables.getRow({ databaseId: D, tableId: tableOf(rule), rowId: targets[rule.key] });

  const guarded = async (rule: ResourceRule, fn: () => Promise<unknown>): Promise<Outcome> =>
    targets[rule.key] ? attempt(fn) : { kind: "error", message: "no fixture to test against" };

  for (const rule of RULES) {
    for (const actor of ACTORS) {
      record(rule, "read", actor, await guarded(rule, () => readTarget(party[actor], rule)), "get the target by id");
    }
  }

  heading("Outsiders see nothing, even by querying for A by name");
  for (const p of [U, B, anon]) {
    const leaks: string[] = [];
    for (const rule of RULES.filter((r) => r.ownerColumn)) {
      const ownerId = rule.ownerColumn === "coach_id" ? C.id : A.id;
      try {
        const page = await p.tables.listRows({
          databaseId: D,
          tableId: rule.resource,
          queries: [Query.equal(rule.ownerColumn!, ownerId), Query.limit(5)],
        });
        if (page.total > 0) leaks.push(`${rule.resource} (${page.total})`);
      } catch {
        // A refusal to list is as good as an empty list.
      }
    }
    check(`${ACTOR_LABELS[p.actor]} lists zero of A's rows in every table`, leaks.length === 0, leaks.join(", "));
  }
  check(
    "A's coach, by contrast, lists A's sets",
    (await C.tables.listRows({ databaseId: D, tableId: "sets", queries: [Query.equal("athlete_id", A.id)] })).total >= 2,
  );
  check("A cannot read athlete B's set", (await attempt(() => A.tables.getRow({ databaseId: D, tableId: "sets", rowId: bSet.$id }))).kind === "denied");
  check("A's coach cannot read athlete B's set", (await attempt(() => C.tables.getRow({ databaseId: D, tableId: "sets", rowId: bSet.$id }))).kind === "denied");

  /* -----------------------------------------------------------------------
   * Creates: forgery, attempted as an attacker would
   * -------------------------------------------------------------------- */

  /** Forged rows Appwrite accepted, for the validator to delete. */
  const landed: { table: string; id: string; what: string }[] = [];

  /**
   * A raw createRow as the attacker. Three outcomes: refused; landed and
   * readable as the victim's (a failure); or landed but failing the authorship
   * check every reader applies, which counts as a refusal because nobody will
   * ever see it. Whether the validator also deletes it is asserted later.
   */
  const forged = async (rule: ResourceRule, actor: AuditActor, table: string, rowId: string, data: Record<string, unknown>, permissions: string[], how: string) => {
    let created: Record<string, unknown> | null = null;
    const outcome = await attempt(async () => {
      created = await party[actor].tables.createRow({ databaseId: D, tableId: table, rowId, data, permissions });
      createdRows.push({ table, id: String(created.$id) });
    });
    if (outcome.kind === "allowed" && created) {
      const row = created as Record<string, unknown>;
      if (isAuthentic(table, row)) {
        record(rule, "create", actor, outcome, `${how}; readers trust it`);
      } else {
        landed.push({ table, id: String(row.$id), what: `${rule.key} by ${ACTOR_LABELS[actor]}` });
        const proof = ownerProof(table, row) ?? [];
        record(rule, "create", actor, { kind: "neutralised", reason: `lacks ${proof.join(", ") || "an owner"}` }, how);
      }
      return String(row.$id);
    }
    record(rule, "create", actor, outcome, how);
    return "";
  };

  const now = () => new Date().toISOString();
  const forgerId = (actor: AuditActor) => party[actor].id || ID.unique();
  const EVERYONE = 'stamped read for every signed-in user';

  const forgedBy: Record<string, string> = {};
  const remember = (key: string, id: string) => {
    if (id) forgedBy[key] = id;
  };
  for (const actor of ACTORS) {
    const tag = `${actor}-${stamp}`;
    if (actor !== "athlete") {
      await forged(ruleFor("profiles"), actor, "profiles", ID.unique(), { user_id: A.id, display_name: "Forged", units: "kg", created_at: now() }, readableByEveryone(), `createRow naming A as user_id, ${EVERYONE}`);
      await forged(ruleFor("exercises"), actor, "exercises", ID.unique(), { name: `Forged ${tag}`, normalised_name: normaliseExerciseName(`Forged ${tag}`), is_global: false, owner_id: A.id, created_at: now() }, readableByEveryone(), `createRow with owner_id A (lands in A's typeahead), ${EVERYONE}`);
      await forged(ruleFor("sessions"), actor, "sessions", ID.unique(), { athlete_id: A.id, started_at: now(), set_count: 0, tonnage_kg: 0, client_session_id: `forged-${tag}` }, readableByEveryone(), `createRow with athlete_id A, ${EVERYONE}`);
      remember(`set:${actor}`, await forged(ruleFor("sets"), actor, "sets", ID.unique(), { session_id: targets.sessions, athlete_id: A.id, exercise_id: targets.exercises, set_index: 9, load_kg: 300, reps: 1, rpe: 10, e1rm_kg: 400, is_warmup: false, logged_at: loggedAt.toISOString(), client_set_id: `forged-${tag}`, video_file_id: targets.set_videos }, readableByEveryone(), `createRow with athlete_id A and e1rm 400, ${EVERYONE}`));
      const day = `2026-01-${String(10 + ACTORS.indexOf(actor)).padStart(2, "0")}`;
      await forged(ruleFor("bodyweight_entries"), actor, "bodyweight_entries", bodyweightRowId(A.id, day), { athlete_id: A.id, weight_kg: 140, measured_on: day, recorded_at: now() }, readableByEveryone(), `createRow at A's derived weigh-in id, ${EVERYONE}`);
    }
    if (actor !== "coach") {
      // The athlete forges with what he holds -- his circle -- which is enough
      // for his coach's queue to read it. Everyone else stamps read(users).
      const reviewStamp = actor === "athlete" ? commentPermissions({ athleteId: A.id, authorId: A.id }) : readableByEveryone();
      remember(`review:${actor}`, await forged(ruleFor("set_reviews"), actor, "set_reviews", ID.unique(), { coach_id: C.id, athlete_id: A.id, set_id: extras.set2, reviewed_at: now(), client_review_id: `forged-${tag}` }, reviewStamp, `createRow claiming the coach cleared A's clip, ${actor === "athlete" ? "stamped read for A's circle" : EVERYONE}`));
    }
    if (actor !== "athlete" && actor !== "coach") {
      remember(`comment:${actor}`, await forged(ruleFor("set_comments"), actor, "set_comments", ID.unique(), { set_id: targets.sets, athlete_id: A.id, author_id: C.id, body: "Forged coaching note", parent_id: null, created_at: now(), client_comment_id: `forged-${tag}` }, readableByEveryone(), `createRow on A's set with author_id = the coach, ${EVERYONE}`));
    }
    remember(`library:${actor}`, await forged(ruleFor("exercises:library"), actor, "exercises", ID.unique(), { name: `Forged Library ${tag}`, normalised_name: normaliseExerciseName(`Forged Library ${tag}`), is_global: true, owner_id: forgerId(actor), created_at: now() }, readableByEveryone(), `createRow with is_global true, ${EVERYONE}`));
    await forged(ruleFor("stats_rollups"), actor, "stats_rollups", ID.unique(), { athlete_id: A.id, exercise_id: targets.exercises, week_start: "2026-01-05T00:00:00.000Z", set_count: 1, volume_reps: 1, tonnage_kg: 999, best_e1rm_kg: 400, rebuilt_at: now() }, readableByEveryone(), `createRow with athlete_id A, ${EVERYONE}`);
    await forged(ruleFor("reference_maxes"), actor, "reference_maxes", ID.unique(), { athlete_id: A.id, exercise_id: targets.exercises, kind: "training", value_kg: 250, effective_from: now(), recorded_by: forgerId(actor), created_at: now() }, readableByEveryone(), `createRow with athlete_id A, ${EVERYONE}`);
    await forged(ruleFor("invite_codes"), actor, "invite_codes", `AUD-${ACTORS.indexOf(actor)}${stamp.slice(-6)}`, { coach_id: ID.unique(), created_at: now() }, readableByEveryone(), `createRow minting a code, ${EVERYONE}`);
    await forged(ruleFor("coach_athlete_links"), actor, "coach_athlete_links", ID.unique(), { coach_id: forgerId(actor), athlete_id: actor === "coach" ? B.id : A.id, status: "active", linked_at: now() }, readableByEveryone(), "createRow granting themselves a coach link");
    // Programming for A, written by anyone but the route. Every table of it.
    const programBase = { coach_id: forgerId(actor), athlete_id: A.id };
    await forged(ruleFor("programs"), actor, "programs", ID.unique(), { ...programBase, name: `Forged ${tag}`, status: "published", created_at: now(), updated_at: now() }, readableByEveryone(), `createRow of a program for A, ${EVERYONE}`);
    await forged(ruleFor("program_blocks"), actor, "program_blocks", ID.unique(), { ...programBase, program_id: targets.programs, position: 9, name: "Forged" }, readableByEveryone(), `createRow of a block in A's program, ${EVERYONE}`);
    await forged(ruleFor("program_weeks"), actor, "program_weeks", ID.unique(), { ...programBase, program_id: targets.programs, block_id: targets.program_blocks, position: 9, status: "published" }, readableByEveryone(), `createRow of a week in A's program, ${EVERYONE}`);
    await forged(ruleFor("program_days"), actor, "program_days", ID.unique(), { ...programBase, program_id: targets.programs, block_id: targets.program_blocks, week_id: targets.program_weeks, position: 9 }, readableByEveryone(), `createRow of a day on A's Today, ${EVERYONE}`);
    await forged(ruleFor("prescriptions"), actor, "prescriptions", ID.unique(), { ...programBase, program_id: targets.programs, week_id: targets.program_weeks, day_id: targets.program_days, exercise_id: targets.exercises, position: 9, set_count: 10, load: "200%", load_kind: "freeform", updated_at: now() }, readableByEveryone(), `createRow of a line in A's program, ${EVERYONE}`);
    if (actor !== "athlete") {
      const outcome = await attempt(async () => {
        const file = await party[actor].storage.createFile({
          bucketId: BUCKET,
          fileId: ID.unique(),
          file: new File([Buffer.alloc(512, 2)], "forged.mp4", { type: "video/mp4" }),
          permissions: videoPermissions({ athleteId: A.id }),
        });
        createdFiles.push({ bucketId: BUCKET, fileId: file.$id });
      });
      record(ruleFor("set_videos"), "create", actor, outcome, "upload a clip stamped with A's video permissions");
      const picture = await attempt(async () => {
        const file = await party[actor].storage.createFile({
          bucketId: AVATAR_BUCKET,
          fileId: newAvatarFileId(A.id),
          file: new File([Buffer.alloc(512, 4)], "forged.webp", { type: "image/webp" }),
          permissions: avatarPermissions({ userId: A.id }),
        });
        createdFiles.push({ bucketId: AVATAR_BUCKET, fileId: file.$id });
      });
      record(ruleFor("avatars"), "create", actor, picture, "upload a picture into A's namespace stamped with A's avatar permissions");
    }
  }

  heading("What a forged row does once it lands: nothing, because no reader trusts it");
  const rollupFor = async (p: Party, exerciseId: string) => {
    const rebuilt = await callRoute(rollupRoute as Handler, "/api/rollup", p, { exerciseId, loggedAt: loggedAt.toISOString() });
    const row = (
      await adminDb.listRows({
        databaseId: D,
        tableId: "stats_rollups",
        queries: [Query.equal("athlete_id", p.id), Query.equal("exercise_id", exerciseId), Query.limit(1)],
      })
    ).rows[0] as unknown as Record<string, unknown> | undefined;
    return { status: rebuilt.body.status, bestE1rm: Number(row?.best_e1rm_kg ?? 0) };
  };
  const bForgedSet = forgedBy["set:otherAthlete"] ?? "";
  if (bForgedSet) {
    const after = await rollupFor(A, targets.exercises);
    check(
      "a set athlete B forged under A's id stays out of A's rollup when A next logs",
      after.status === "written" && after.bestE1rm < 400,
      `A's best e1RM for the week is now ${after.bestE1rm}kg, from a set B wrote`,
    );
    const coachSees = authenticRows(
      "sets",
      (await C.tables.listRows({ databaseId: D, tableId: "sets", queries: [Query.equal("athlete_id", A.id), Query.limit(100)] })).rows,
    ).map((row) => row.$id);
    check("and out of the coach's view of A's sets, clip included", !coachSees.includes(bForgedSet) && coachSees.includes(targets.sets), `coach reads ${coachSees.length} of A's sets`);
  } else {
    check("athlete B could not forge a set under A's id, so there is nothing to leak", true);
  }
  const forgedReview = forgedBy["review:otherAthlete"] ?? forgedBy["review:athlete"] ?? "";
  if (forgedReview) {
    const cleared = authenticRows(
      "set_reviews",
      (await C.tables.listRows({ databaseId: D, tableId: "set_reviews", queries: [Query.equal("coach_id", C.id), Query.limit(100)] })).rows,
    ).map((row) => row.$id);
    check("a forged 'reviewed' mark does not clear A's clip from the coach's queue", !cleared.includes(forgedReview) && cleared.includes(targets.set_reviews), `coach's own reviews: ${cleared.length}`);
  }
  const forgedComment = forgedBy["comment:otherAthlete"] ?? "";
  if (forgedComment) {
    const thread = authenticRows(
      "set_comments",
      (await A.tables.listRows({ databaseId: D, tableId: "set_comments", queries: [Query.equal("set_id", targets.sets), Query.limit(100)] })).rows,
    ).map((row) => row.$id);
    check("a forged comment in the coach's name never reaches A's thread", !thread.includes(forgedComment) && thread.includes(targets.set_comments), `thread: ${thread.length} comments`);
  }
  const forgedLibrary = Object.entries(forgedBy).filter(([k]) => k.startsWith("library:")).map(([, id]) => id);
  if (forgedLibrary.length > 0) {
    const library = authenticRows(
      "exercises",
      (await B.tables.listRows({ databaseId: D, tableId: "exercises", queries: [Query.equal("is_global", true), Query.limit(100), Query.orderDesc("$id")] })).rows,
    ).map((row) => row.$id);
    check("a forged is_global exercise reaches nobody's typeahead; the seeded library does", forgedLibrary.every((id) => !library.includes(id)) && library.includes(targets["exercises:library"]), `typeahead: ${library.length} library rows`);
  }

  /** A row as the admin sees it, or null once validate-row has deleted it. */
  const rowOrNull = async (tableId: string, rowId: string): Promise<Record<string, unknown> | null> => {
    try {
      return (await adminDb.getRow({ databaseId: D, tableId, rowId })) as unknown as Record<string, unknown>;
    } catch (error) {
      if ((error as { code?: unknown })?.code === 404) return null;
      throw error;
    }
  };

  // Not asserted before 6 Oct: A relabelling his own set with B's id. Appwrite
  // allows the update -- A holds update on his own row -- so the row is now
  // stamped by A and claims to be B's.
  const set3 = (await createSet(A.deps, { userId: A.id }, setInput("set3", 300))).$id;
  const relabel = await attempt(() =>
    A.tables.updateRow<Models.DefaultRow>({ databaseId: D, tableId: "sets", rowId: set3, data: { athlete_id: B.id } }),
  );
  if (relabel.kind === "allowed") {
    landed.push({ table: "sets", id: set3, what: "A's set relabelled as B's" });
    // validate-row may already have deleted it; absent is as good as untrusted.
    const relabelled = await rowOrNull("sets", set3);
    const authentic = relabelled !== null && isAuthentic("sets", relabelled);
    const bRollup = await rollupFor(B, targets.exercises);
    check(
      "A relabels his own set as B's: no reader takes it as B's, and B's rollup ignores it",
      // B's own 100x5 set is in the same week; the relabelled 300x5 would push his best past 300.
      !authentic && bRollup.bestE1rm < 300,
      `authentic=${authentic}${relabelled === null ? " (already deleted)" : ""} B's rollup ${bRollup.status} best ${bRollup.bestE1rm}`,
    );
  } else {
    check("A cannot relabel his own set as B's", relabel.kind === "denied", relabel.kind === "error" ? relabel.message : relabel.kind);
  }

  // Also new: squatting a profile. L has an account and has not onboarded; B
  // writes a profile at L's id first.
  const late = await users.create({ userId: ID.unique(), email: `audit-late-${stamp}@example.com`, password: `Audit-${stamp}-pass!`, name: "Audit Late Joiner" });
  createdUsers.push(late.$id);
  const lateSession = await users.createSession({ userId: late.$id });
  const L = { id: late.$id, tables: new TablesDB(new Client().setEndpoint(config.endpoint).setProject(config.projectId).setSession(lateSession.secret)) };
  const squat = await attempt(() =>
    B.tables.createRow<Models.DefaultRow>({ databaseId: D, tableId: "profiles", rowId: L.id, data: { user_id: L.id, display_name: "Squatter", units: "kg", created_at: now() }, permissions: readableByEveryone() }),
  );
  let squatted = false;
  if (squat.kind === "allowed") {
    createdRows.push({ table: "profiles", id: L.id });
    landed.push({ table: "profiles", id: L.id, what: "B's squat on L's profile" });
    squatted = true;
    const seen = await attempt(async () => {
      let row: Record<string, unknown>;
      try {
        row = (await L.tables.getRow({ databaseId: D, tableId: "profiles", rowId: L.id })) as unknown as Record<string, unknown>;
      } catch (error) {
        // validate-row got there first: L reads no profile, which is the point.
        if ((error as { code?: unknown })?.code === 404) return;
        throw error;
      }
      if (isAuthentic("profiles", row)) throw new Error("L's app would show B's profile as L's");
    });
    check("B squats L's profile before L onboards: L's app reads it as absent", seen.kind === "allowed", seen.kind === "error" ? seen.message : seen.kind);
  } else {
    check("B cannot squat L's profile id", squat.kind === "denied");
  }

  /* -----------------------------------------------------------------------
   * The validator: every forged row that landed is deleted, within a bound
   * -------------------------------------------------------------------- */

  heading(`The validate-row Function deletes what landed (within ${VALIDATOR_WAIT_MS / 1000}s)`);
  if (!validatorLive) {
    check(`validate-row is not live, so ${landed.length} forged row(s) stay until teardown`, false, "Deploy it: npm run appwrite:functions");
  } else if (landed.length === 0) {
    check("nothing landed, nothing to delete", true);
  } else {
    const deadline = Date.now() + VALIDATOR_WAIT_MS;
    const remaining = new Set(landed.map((l) => `${l.table}/${l.id}`));
    while (remaining.size > 0 && Date.now() < deadline) {
      for (const l of landed) {
        const key = `${l.table}/${l.id}`;
        if (!remaining.has(key)) continue;
        const gone = (await attempt(() => adminDb.getRow({ databaseId: D, tableId: l.table, rowId: l.id }))).kind === "denied";
        if (gone) remaining.delete(key);
      }
      if (remaining.size > 0) await new Promise((r) => setTimeout(r, 2000));
    }
    for (const l of landed) {
      check(`deleted: ${l.what}`, !remaining.has(`${l.table}/${l.id}`), `${l.table}/${l.id} still present after ${VALIDATOR_WAIT_MS / 1000}s`);
    }
    if (squatted && !remaining.has(`profiles/${L.id}`)) {
      // Circle first, as the app does: the profile's read stamp names L's circle
      // team, and Appwrite refuses a stamp for a team the writer is not in.
      const { jwt } = await users.createJWT({ userId: L.id, sessionId: lateSession.$id, duration: 600 });
      const circle = await callRoute(circleRoute as Handler, "/api/circle", { ...anon, actor: "athlete", id: L.id, jwt });
      const own = await attempt(() => createProfile(depsFor(L.tables), { userId: L.id }, { displayName: "Audit Late Joiner" }));
      check(
        "and L then onboards with his own profile",
        circle.status === 200 && own.kind === "allowed",
        `circle ${circle.status}; profile ${own.kind === "error" ? own.message : own.kind === "denied" ? `denied ${own.code}` : own.kind}`,
      );
    }
  }

  /* -----------------------------------------------------------------------
   * Updates
   * -------------------------------------------------------------------- */

  /**
   * A different value per actor, always. Appwrite answers an update that
   * changes nothing with success before it checks the update permission, so
   * two actors writing the same value would make the second look allowed.
   */
  const rawUpdate = (key: string, actor: AuditActor): Record<string, unknown> => {
    const n = ACTORS.indexOf(actor) + 1;
    const tag = `Hijacked by ${actor}`;
    const values: Record<string, Record<string, unknown>> = {
      profiles: { display_name: tag },
      exercises: { name: tag },
      "exercises:library": { name: tag },
      sessions: { notes: tag },
      sets: { load_kg: 900 + n },
      bodyweight_entries: { weight_kg: 300 + n },
      set_reviews: { reviewed_at: new Date(Date.UTC(2020, 0, n)).toISOString() },
      set_comments: { body: tag },
      stats_rollups: { tonnage_kg: 90000 + n },
      reference_maxes: { value_kg: 500 + n },
      invite_codes: { coach_id: ID.unique() },
      coach_athlete_links: { status: "revoked" },
      programs: { name: tag },
      program_blocks: { name: tag },
      program_weeks: { label: tag },
      program_days: { label: tag },
      prescriptions: { load: tag },
    };
    return values[key] ?? {};
  };

  /** The legitimate owner's update, through the helper where the helper has one. */
  const ownerUpdate: Record<string, (() => Promise<unknown>) | undefined> = {
    profiles: () => updateProfile(A.deps, { userId: A.id }, { units: "lb" }),
    sessions: () => finishSession(A.deps, { userId: A.id }, { sessionId: targets.sessions, setCount: 2, tonnageKg: 1425 }),
    sets: () => updateSet(A.deps, { userId: A.id }, { rowId: targets.sets, loadKg: 142.5, reps: 5, rpe: 8, isWarmup: false }),
    bodyweight_entries: () => reviseBodyweight(A.deps, { userId: A.id }, { weightKg: 82.1, measuredOn: "2026-01-05" }),
  };

  for (const rule of RULES) {
    for (const actor of ACTORS) {
      const p = party[actor];
      const helper = isAllowed(rule, "update", actor) ? ownerUpdate[rule.key] : undefined;
      let how: string;
      let fn: () => Promise<unknown>;
      if (rule.kind === "bucket") {
        how = "rename the file";
        // The bucket's own extension, so a refusal is about permission and
        // never about a name the bucket would not accept anyway.
        const name = rule.resource === AVATAR_BUCKET ? "renamed.webp" : "renamed.mp4";
        fn = () => p.storage.updateFile({ bucketId: rule.resource, fileId: targets[rule.key], name });
      } else if (helper) {
        how = "the write helper, from their own session";
        fn = helper;
      } else {
        const data = rawUpdate(rule.key, actor);
        how = `updateRow ${JSON.stringify(data)}`;
        fn = () => p.tables.updateRow({ databaseId: D, tableId: rule.resource, rowId: targets[rule.key], data });
      }
      record(rule, "update", actor, await guarded(rule, fn), how);
    }
  }

  heading("Each side's words are their own");
  check(
    "the coach cannot edit A's reply",
    (await attempt(() => C.tables.updateRow<Models.DefaultRow>({ databaseId: D, tableId: "set_comments", rowId: extras.reply, data: { body: "Hijacked" } }))).kind === "denied",
  );
  check(
    "the coach cannot delete A's reply",
    (await attempt(() => C.tables.deleteRow({ databaseId: D, tableId: "set_comments", rowId: extras.reply }))).kind === "denied",
  );

  /* -----------------------------------------------------------------------
   * Deletes, part one: everyone who should be refused, then the coach's own
   * -------------------------------------------------------------------- */

  const ownerDelete: Record<string, (() => Promise<unknown>) | undefined> = {
    sets: () => deleteSet(A.deps, { userId: A.id }, targets.sets),
    bodyweight_entries: () => deleteBodyweight(A.deps, { userId: A.id }, "2026-01-05"),
    set_reviews: () => unmarkSetReviewed(C.deps, { userId: C.id }, targets.sets),
    set_comments: () => deleteComment(C.deps, { userId: C.id }, targets.set_comments),
  };

  const runDelete = async (rule: ResourceRule, actor: AuditActor) => {
    const p = party[actor];
    const helper = isAllowed(rule, "delete", actor) ? ownerDelete[rule.key] : undefined;
    const how = rule.kind === "bucket" ? "delete the file" : helper ? "the write helper, from their own session" : "deleteRow";
    const fn = rule.kind === "bucket"
      ? () => p.storage.deleteFile({ bucketId: rule.resource, fileId: targets[rule.key] })
      : helper ?? (() => p.tables.deleteRow({ databaseId: D, tableId: rule.resource, rowId: targets[rule.key] }));
    record(rule, "delete", actor, await guarded(rule, fn), how);
  };

  for (const rule of RULES) {
    for (const actor of ACTORS) {
      if (!isAllowed(rule, "delete", actor)) await runDelete(rule, actor);
    }
  }
  for (const rule of RULES) {
    if (isAllowed(rule, "delete", "coach")) await runDelete(rule, "coach");
  }

  /* -----------------------------------------------------------------------
   * Revocation
   * -------------------------------------------------------------------- */

  heading("After A unlinks, the ex-coach loses everything at once");
  const revoked = await callRoute(revokeRoute as Handler, "/api/link/revoke", A);
  check("POST /api/link/revoke unlinks the coach", revoked.body.status === "unlinked", JSON.stringify(revoked.body));
  const linkAfter = targets.coach_athlete_links
    ? await adminDb.getRow({ databaseId: D, tableId: "coach_athlete_links", rowId: targets.coach_athlete_links })
    : null;
  check("the link row is kept as a record, marked revoked", (linkAfter as Record<string, unknown> | null)?.status === "revoked");

  const exCoachCannotRead: [string, () => Promise<unknown>][] = [
    ["A's profile", () => C.tables.getRow({ databaseId: D, tableId: "profiles", rowId: targets.profiles })],
    ["A's custom exercise", () => C.tables.getRow({ databaseId: D, tableId: "exercises", rowId: targets.exercises })],
    ["A's session", () => C.tables.getRow({ databaseId: D, tableId: "sessions", rowId: targets.sessions })],
    ["a set logged while he was linked", () => C.tables.getRow({ databaseId: D, tableId: "sets", rowId: extras.set2 })],
    ["A's weigh-ins", () => C.tables.getRow({ databaseId: D, tableId: "bodyweight_entries", rowId: bodyweightRowId(A.id, "2026-01-05") })],
    ["A's rollup", () => C.tables.getRow({ databaseId: D, tableId: "stats_rollups", rowId: targets.stats_rollups })],
    ["the max he set himself", () => C.tables.getRow({ databaseId: D, tableId: "reference_maxes", rowId: targets.reference_maxes })],
    ["his own review of A's clip", () => C.tables.getRow({ databaseId: D, tableId: "set_reviews", rowId: extras.review2 })],
    ["his own comment on A's set", () => C.tables.getRow({ databaseId: D, tableId: "set_comments", rowId: extras.comment2 })],
    ["A's reply to him", () => C.tables.getRow({ databaseId: D, tableId: "set_comments", rowId: extras.reply })],
    ["A's clip", () => C.storage.getFile({ bucketId: BUCKET, fileId: targets.set_videos })],
    ["A's picture", () => C.storage.getFile({ bucketId: AVATAR_BUCKET, fileId: targets.avatars })],
  ];
  for (const [what, fn] of exCoachCannotRead) {
    const outcome = await attempt(fn);
    // bodyweight target may already be deleted by nobody; a 404 is a refusal either way.
    check(`the ex-coach cannot read ${what}`, outcome.kind === "denied", outcome.kind === "error" ? outcome.message : outcome.kind);
  }
  check(
    // Only A's real sets. A forged one stamped read(users) is readable by
    // everybody, linked or not, and is reported above as its own finding.
    "and lists none of A's real sets",
    (
      await C.tables.listRows({
        databaseId: D,
        tableId: "sets",
        queries: [Query.equal("athlete_id", A.id), Query.equal("$id", [targets.sets, extras.set2])],
      })
    ).total === 0,
  );
  check(
    "the ex-coach cannot comment on A's set any more",
    (await attempt(() => postComment(C.deps, { userId: C.id }, { athleteId: A.id, setId: extras.set2, body: "Still here", clientCommentId: `audit-after-revoke-${stamp}` }))).kind === "denied",
  );
  check(
    "or clear A's clip from a queue",
    (await attempt(() => markSetReviewed(C.deps, { userId: C.id }, { athleteId: A.id, setId: targets.sets }))).kind === "denied",
  );
  const lateMax = await callRoute(referenceMaxRoute as Handler, "/api/reference-max", C, maxBody(A.id, "training", 200));
  check("or set A's training max through the route", lateMax.status === 403, `${lateMax.status} ${JSON.stringify(lateMax.body)}`);
  check("or hold A's suggestions", (await suggest(C, "held")).status === 403);
  const lateEdit = await programOp(C, { op: "updateProgram", programId: targets.programs, name: "Edited after revoke" });
  check("or edit the program he wrote for A", lateEdit.status === 403, `${lateEdit.status} ${JSON.stringify(lateEdit.body)}`);
  check("or duplicate a week of it", (await programOp(C, { op: "duplicateWeek", weekId: targets.program_weeks })).status === 403);
  check("or copy it to A again", (await programOp(C, { op: "copyProgram", programId: targets.programs, athleteId: A.id })).status === 403);
  check("or publish a week of it", (await programOp(C, { op: "publishWeek", weekId: targets.program_weeks })).status === 403);
  check("or pull a week of it back to draft", (await programOp(C, { op: "updateWeek", weekId: targets.program_weeks, status: "draft" })).status === 403);
  check(
    "[by policy] the ex-coach still reads the program he wrote: it is his work product, like a comment",
    (await attempt(() => C.tables.getRow({ databaseId: D, tableId: "programs", rowId: targets.programs }))).kind === "allowed",
  );
  check(
    "while A keeps reading the program and its days",
    (await attempt(() => A.tables.getRow({ databaseId: D, tableId: "program_days", rowId: targets.program_days }))).kind === "allowed",
  );
  check(
    "while A keeps reading his own set",
    (await attempt(() => A.tables.getRow({ databaseId: D, tableId: "sets", rowId: extras.set2 }))).kind === "allowed",
  );
  check(
    "and the max his coach set before leaving",
    (await attempt(() => A.tables.getRow({ databaseId: D, tableId: "reference_maxes", rowId: targets.reference_maxes }))).kind === "allowed",
  );
  check(
    "[Inference] the ex-coach still reads the revoked link row, the record of what he once saw",
    (await attempt(() => C.tables.getRow({ databaseId: D, tableId: "coach_athlete_links", rowId: targets.coach_athlete_links }))).kind === "allowed",
  );

  /* -----------------------------------------------------------------------
   * Deletes, part two: the athlete's own, last, because revocation read them
   * -------------------------------------------------------------------- */

  for (const rule of RULES) {
    if (isAllowed(rule, "delete", "athlete")) await runDelete(rule, "athlete");
  }
} catch (error) {
  check("the audit ran to completion", false, (error as Error).stack ?? String(error));
} finally {
  await teardown();
}

/* -------------------------------------------------------------------------
 * Report
 * ---------------------------------------------------------------------- */

heading("Matrix: who can do what to athlete A's data");
console.log(
  "  yes/no = what Appwrite actually did. FAIL = not what appwrite/audit/rules.ts expects.\n",
);
console.log(
  formatMatrix(cells)
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n"),
);

const badCells = failedCells(cells);
if (badCells.length > 0) {
  console.log(`\n  ${badCells.length} cell(s) failed:`);
  for (const cell of badCells) console.log(`    - ${describeFailure(cell)}`);
}

await scanStamps();

const badChecks = checks.filter((c) => !c.ok);
const total = cells.length + checks.length;
const failed = badCells.length + badChecks.length;
console.log(
  `\n${failed === 0 ? "PASS" : "FAIL"}: ${total - failed}/${total} (${cells.length} matrix cells, ${checks.length} checks). ` +
    `Fixture users, rows and files removed.`,
);
if (badChecks.length > 0) {
  console.log("Failed checks:");
  for (const c of badChecks) console.log(`  - [${c.section}] ${c.label}`);
}
process.exitCode = failed === 0 ? 0 : 1;

/* -------------------------------------------------------------------------
 * Stored stamps: every row on the instance against today's policy
 * ---------------------------------------------------------------------- */

async function scanStamps() {
  heading("Stored stamps: every row's permissions against policy.ts (read-only)");
  if (process.argv.includes("--no-scan")) {
    console.log("  skipped (--no-scan)");
    return;
  }
  // Programs come before their children in the schema, so a child can be
  // checked against its parent's coach and athlete as the scan goes.
  const programsById = new Map<string, { coach_id: string; athlete_id: string | null }>();
  const rulesFor = (tableId: string) => RULES.filter((r) => r.kind === "table" && r.resource === tableId && r.invariant);
  for (const table of schema.tables) {
    if (!STAMPED_TABLES.includes(table.id)) {
      check(`${table.id}: the stamp scan knows this table's policy`, false, "Add it to expectedStamp in appwrite/documents/provenance.ts.");
      continue;
    }
    let scanned = 0;
    const drift: string[] = [];
    const broken: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const queries = [Query.limit(100), Query.orderAsc("$id")];
      if (cursor) queries.push(Query.cursorAfter(cursor));
      const page = await adminDb.listRows({ databaseId: D, tableId: table.id, queries });
      for (const row of page.rows as unknown as Models.DefaultRow[]) {
        scanned += 1;
        const data = row as unknown as Record<string, unknown>;
        const want = expectedStamp(table.id, data);
        if (want === null) {
          drift.push(`${row.$id}: missing the owner fields a stamp is derived from`);
          continue;
        }
        const { missing, extra } = stampDrift(want, row.$permissions);
        if (missing.length || extra.length) {
          drift.push(`${row.$id}: missing ${JSON.stringify(missing)} extra ${JSON.stringify(extra)}`);
        }
        // Authorship, not just shape: a row whose stamp matches the policy for
        // the owner it names was written by that owner (or the server).
        if (!isAuthentic(table.id, data)) broken.push(`${row.$id}: not written by the owner it names`);
        for (const rule of rulesFor(table.id)) {
          const problem = rule.invariant!(data);
          if (problem) broken.push(`${row.$id}: ${problem}`);
        }
        if (table.id === "programs") {
          programsById.set(row.$id, { coach_id: String(data.coach_id), athlete_id: typeof data.athlete_id === "string" ? data.athlete_id : null });
        } else if (programsById.size > 0 && typeof data.program_id === "string") {
          const parent = programsById.get(data.program_id);
          if (!parent) broken.push(`${row.$id}: program ${data.program_id} does not exist`);
          else if (parent.coach_id !== data.coach_id || parent.athlete_id !== (typeof data.athlete_id === "string" ? data.athlete_id : null)) {
            broken.push(`${row.$id}: coach/athlete differ from program ${data.program_id}`);
          }
        }
      }
      if (page.rows.length < 100) break;
      cursor = page.rows[page.rows.length - 1].$id;
    }
    check(
      `${table.id}: ${scanned} row(s), every stamp matches the policy`,
      drift.length === 0,
      `${drift.length} drifted, e.g.\n          ${drift.slice(0, 3).join("\n          ")}`,
    );
    if (broken.length > 0 || rulesFor(table.id).length > 0 || table.id.startsWith("program") || table.id === "prescriptions") {
      check(`${table.id}: every row was written by the owner it names and holds its invariants`, broken.length === 0, `${broken.length} row(s), e.g.\n          ${broken.slice(0, 3).join("\n          ")}`);
    }
  }
}

/* -------------------------------------------------------------------------
 * Teardown: only what this run's users own
 * ---------------------------------------------------------------------- */

async function teardown() {
  const quiet = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch {
      /* already gone */
    }
  };

  for (const row of createdRows) {
    await quiet(() => adminDb.deleteRow({ databaseId: D, tableId: row.table, rowId: row.id }));
  }
  for (const { bucketId, fileId } of createdFiles) {
    await quiet(() => adminStorage.deleteFile({ bucketId, fileId }));
  }

  // Everything else a fixture user owns, found by the columns naming them.
  // Scoped to this run's user ids, which exist nowhere else.
  const ownerColumns: Record<string, string[]> = {
    profiles: ["user_id"],
    exercises: ["owner_id"],
    sessions: ["athlete_id"],
    sets: ["athlete_id"],
    bodyweight_entries: ["athlete_id"],
    stats_rollups: ["athlete_id"],
    reference_maxes: ["athlete_id", "recorded_by"],
    set_reviews: ["athlete_id", "coach_id"],
    set_comments: ["athlete_id", "author_id"],
    coach_athlete_links: ["athlete_id", "coach_id"],
    invite_codes: ["coach_id"],
    programs: ["athlete_id", "coach_id"],
    program_blocks: ["athlete_id", "coach_id"],
    program_weeks: ["athlete_id", "coach_id"],
    program_days: ["athlete_id", "coach_id"],
    prescriptions: ["athlete_id", "coach_id"],
  };
  if (createdUsers.length > 0) {
    for (const [table, columns] of Object.entries(ownerColumns)) {
      for (const column of columns) {
        for (let guard = 0; guard < 20; guard += 1) {
          const page = await adminDb
            .listRows({ databaseId: D, tableId: table, queries: [Query.equal(column, createdUsers), Query.limit(100)] })
            .catch(() => null);
          if (!page || page.rows.length === 0) break;
          for (const row of page.rows) {
            await quiet(() => adminDb.deleteRow({ databaseId: D, tableId: table, rowId: row.$id }));
          }
        }
      }
    }
  }

  for (const userId of createdUsers) {
    await quiet(() => teams.delete({ teamId: circleTeamId(userId) }));
  }
  for (const userId of createdUsers) {
    await quiet(() => users.delete({ userId }));
  }
}

export {};
