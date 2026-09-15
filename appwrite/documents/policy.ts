import { circleTeamId } from "./circle";

/**
 * Who may do what to a row, per table.
 *
 * Appwrite has no row-level security policy to audit -- only the permissions
 * each row was stamped with at write time. So this file is the policy, and it
 * is the only place permission strings are constructed. A bug here is sev-1:
 * either the coach cannot see an athlete's work, or someone else can.
 *
 * Pure by design. No client, no network, no I/O -- so every rule below is
 * exhaustively testable, and the tests are the real specification.
 */

export type WritableTable = "profiles" | "exercises" | "sessions" | "sets";
export type ServerTable =
  | "stats_rollups"
  | "coach_athlete_links"
  | "invite_codes"
  | "reference_maxes";
export type PolicyTable = WritableTable | ServerTable;

/** Appwrite's wire format for permissions. Built here and nowhere else. */
const read = (role: string) => `read("${role}")`;
const update = (role: string) => `update("${role}")`;
const del = (role: string) => `delete("${role}")`;
const user = (id: string) => `user:${id}`;
const team = (id: string) => `team:${id}`;
const USERS = "users";

export interface RowOwner {
  /** The athlete the row belongs to. Never the coach, even on a coach action. */
  athleteId: string;
}

export interface ExerciseOwner extends RowOwner {
  /** A library exercise everyone shares, rather than one typed mid-session. */
  isGlobal: boolean;
}

export interface LinkParties {
  coachId: string;
  athleteId: string;
}

export interface CodeOwner {
  coachId: string;
}

function requireId(value: string, label: string): string {
  if (!value || typeof value !== "string") {
    throw new Error(`Permission policy: ${label} is required and was ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * The athlete always gets an explicit read alongside their circle's.
 *
 * Redundant while team membership is correct, and deliberately so: a bug in
 * membership sync must never be able to lock an athlete out of their own
 * training history mid-session.
 */
function athleteAndCircle(athleteId: string): string[] {
  return [read(user(athleteId)), read(team(circleTeamId(athleteId)))];
}

/**
 * Rows an athlete owns: their sessions, their sets, their rollups, their
 * profile. Readable by them and their coaches; writable by them alone.
 *
 * Coaches get no update anywhere. A coach editing a block mid-way never
 * rewrites what an athlete already did.
 */
function ownedByAthlete(athleteId: string, athleteMayWrite: boolean): string[] {
  const permissions = athleteAndCircle(athleteId);
  if (athleteMayWrite) {
    permissions.push(update(user(athleteId)), del(user(athleteId)));
  }
  return permissions;
}

export function profilePermissions({ athleteId }: RowOwner): string[] {
  return ownedByAthlete(requireId(athleteId, "athleteId"), true);
}

export function sessionPermissions({ athleteId }: RowOwner): string[] {
  return ownedByAthlete(requireId(athleteId, "athleteId"), true);
}

/**
 * A set stays editable by the athlete -- the blueprint allows correcting one
 * from History, which then recomputes e1RM and the rollup.
 */
export function setPermissions({ athleteId }: RowOwner): string[] {
  return ownedByAthlete(requireId(athleteId, "athleteId"), true);
}

/**
 * Written only by the rollup Function, which uses an API key and bypasses
 * permissions entirely. Nobody may write one: a forged rollup is a forged PR.
 */
export function rollupPermissions({ athleteId }: RowOwner): string[] {
  return ownedByAthlete(requireId(athleteId, "athleteId"), false);
}

export function exercisePermissions({ athleteId, isGlobal }: ExerciseOwner): string[] {
  // The shared library: readable by anyone signed in, editable by nobody.
  // Curating it is an admin job, not something an athlete does mid-set.
  if (isGlobal) return [read(USERS)];
  return ownedByAthlete(requireId(athleteId, "athleteId"), true);
}

/**
 * Both parties see the link; neither may write it. Redemption runs in a
 * Function, or an athlete could grant themselves a coach -- or worse, grant
 * themselves as coach to someone else.
 */
export function linkPermissions({ coachId, athleteId }: LinkParties): string[] {
  return [
    read(user(requireId(athleteId, "athleteId"))),
    read(user(requireId(coachId, "coachId"))),
  ];
}

/**
 * A reference max: what a percentage is a percentage OF.
 *
 * Read by the athlete and their circle, written by nobody -- the same shape as
 * a rollup, and for a sharper reason.
 *
 * The coach is this table's author, which is the one place the product's usual
 * rule inverts: everywhere else the athlete writes because logged work is
 * theirs, but a training max is programming input and setting it is the
 * coaching. That made a client-side write look right, and it is not.
 *
 * Appwrite permissions constrain who may read a row; they cannot constrain
 * what a row says. With any table-level create, a signed-in stranger could
 * write a row carrying somebody else's `athlete_id`, stamp it `read("users")`
 * -- a role everybody holds -- and that forged number would appear in the
 * athlete's panel as the max their percentages resolve against. It is
 * `invite_codes` again: a code someone can mint for themselves is a code they
 * can mint naming somebody else as the coach.
 *
 * So writes go through the API key, behind a route that checks the caller is
 * the athlete or actively coaches them. See reference-max-admin.ts.
 *
 * No update permission either, and that one is about history rather than
 * forgery: the table is append-only, and a max edited in place would take the
 * record of what August's percentages meant with it.
 */
export function referenceMaxPermissions({ athleteId }: RowOwner): string[] {
  return ownedByAthlete(requireId(athleteId, "athleteId"), false);
}

/**
 * A coach reads their own code and nobody else reads it at all.
 *
 * Not because the code is a secret from the athlete -- the coach is about to
 * text it to them -- but because a signed-in user who could list this table
 * could link themselves to every coach on the instance. The athlete never
 * reads a row here: redemption at Order 16 looks the code up with the API key,
 * which bypasses permissions, and answers with the coach's name rather than
 * with the row.
 *
 * No write for anyone, including the coach. A code someone can mint for
 * themselves is a code they can mint naming somebody else as the coach.
 */
export function invitePermissions({ coachId }: CodeOwner): string[] {
  return [read(user(requireId(coachId, "coachId")))];
}

/**
 * A clip on a set.
 *
 * Stamped per file, the same shape as the set it belongs to, because it is the
 * same fact: the athlete's work, readable by whoever coaches them. A video is
 * more revealing than a row of numbers, so it gets no wider audience than the
 * numbers do -- the circle and nobody else.
 *
 * The athlete may delete. Deleting a set should take its clip with it, and an
 * athlete who filmed something they would rather not share must be able to
 * remove it without asking. The coach may not: a clip is evidence of what
 * happened, and a review tool whose reviewer can destroy the thing under
 * review is the wrong shape.
 *
 * Not in POLICIES, which is keyed by table. A bucket is not a table, and
 * pretending otherwise to satisfy a lookup would put a file policy where the
 * next person looks for a row policy.
 */
export function videoPermissions({ athleteId }: RowOwner): string[] {
  const id = requireId(athleteId, "athleteId");
  return [...athleteAndCircle(id), del(user(id))];
}

/** Every policy in one place, so a table can never be added without one. */
export const POLICIES = {
  profiles: profilePermissions,
  exercises: exercisePermissions,
  sessions: sessionPermissions,
  sets: setPermissions,
  stats_rollups: rollupPermissions,
  coach_athlete_links: linkPermissions,
  invite_codes: invitePermissions,
  reference_maxes: referenceMaxPermissions,
} as const satisfies Record<PolicyTable, (owner: never) => string[]>;

/** Tables a signed-in user may write to at all. */
export const USER_WRITABLE_TABLES: readonly WritableTable[] = [
  "profiles",
  "exercises",
  "sessions",
  "sets",
];

export const SERVER_ONLY_TABLES: readonly ServerTable[] = [
  "stats_rollups",
  "coach_athlete_links",
  "invite_codes",
  "reference_maxes",
];
