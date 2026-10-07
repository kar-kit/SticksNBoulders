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

export type WritableTable =
  | "profiles"
  | "exercises"
  | "sessions"
  | "sets"
  | "set_reviews"
  | "set_comments"
  | "bodyweight_entries";
export type ServerTable =
  | "stats_rollups"
  | "coach_athlete_links"
  | "invite_codes"
  | "reference_maxes"
  | ProgramTable;

/** The five tables a program is made of. One policy covers all of them. */
export type ProgramTable =
  | "programs"
  | "program_blocks"
  | "program_weeks"
  | "program_days"
  | "prescriptions";
export type PolicyTable = WritableTable | ServerTable;

/** Appwrite's wire format for permissions. Built here and nowhere else. */
const read = (role: string) => `read("${role}")`;
const update = (role: string) => `update("${role}")`;
const del = (role: string) => `delete("${role}")`;
const user = (id: string) => `user:${id}`;
const team = (id: string) => `team:${id}`;
const USERS = "users";

/**
 * The team that marks a row as the server's.
 *
 * It has no members and never will: `appwrite:setup` creates it with the API
 * key so nobody else can, and no session can stamp a `team:` role for a team
 * it is not in. So `update("team:library")` on a row is a mark only the server
 * can make -- which is what lets a reader tell a seeded library exercise from
 * one a signed-in stranger wrote with `is_global: true` and `read("users")`,
 * a stamp every session may make. See provenance.ts.
 */
export const LIBRARY_TEAM_ID = "library";

/**
 * The strongest read a stranger can stamp: every signed-in user. Appwrite lets
 * any session stamp `users` because every session holds it. No policy grants
 * it on an athlete-owned row; the audit uses it to forge as an attacker would.
 */
export const readableByAnySession = () => read(USERS);

/** The permission that proves the named user wrote the row. See provenance.ts. */
export const writtenByUser = (userId: string) => update(user(requireId(userId, "userId")));
/** The permission that proves the server wrote the row. See provenance.ts. */
export const writtenByServer = () => update(team(LIBRARY_TEAM_ID));

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

export interface ReviewParties {
  athleteId: string;
  coachId: string;
}

export interface ProgramOwner {
  /** Who wrote it. Always the coach, including a self-coached athlete. */
  coachId: string;
  /** Who it is for, or null for a template nobody is assigned to yet. */
  athleteId: string | null;
}

export interface CommentAuthor {
  /** Whose set is being discussed. Never the author on a coach's comment. */
  athleteId: string;
  /** Who wrote it. Either party -- the coach opens, the athlete replies. */
  authorId: string;
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
  // The shared library: readable by anyone signed in, editable by nobody who
  // holds a session. Curating it is an admin job, not something an athlete
  // does mid-set.
  //
  // The second entry grants nothing to anyone -- the team has no members. It
  // is the server's mark. `read("users")` alone is a stamp every session can
  // make, so a stranger could write `is_global: true` into every athlete's
  // typeahead and nothing stored on the row would tell it from a seeded one
  // (the 27 Sep finding in docs/permission-audit.md). A `team:` role for a
  // team the caller is not in is the one thing Appwrite refuses to stamp.
  if (isGlobal) return [read(USERS), writtenByServer()];
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
 * Any row of a program: the program itself, a block, a week, a day, or a
 * prescription line. One policy for all five, because they are one document
 * split for Appwrite's sake, and a day readable by someone who cannot read its
 * program is a bug with no upside.
 *
 * The coach who wrote it reads it by name. That grant survives a revoked link
 * on purpose: the block is the coach's own work product, like a comment, and
 * a coach who loses an athlete does not lose the record of what they wrote.
 * The athlete it is for reads it, and so does their circle -- a second coach
 * at the same gym (Ruairi and Louis both coach at Uxbridge) sees the program
 * the athlete is on.
 *
 * A template carries the coach's read and nothing else. Nobody is assigned,
 * so nobody else has a reason to see it.
 *
 * No update or delete for anyone, the coach included. Like reference_maxes,
 * this is programming input written with the API key behind a route that
 * checks the caller really coaches this athlete: Appwrite polices who reads a
 * row, not what a row claims, so a table-level create would let a stranger
 * write a day carrying somebody else's athlete_id and put it on their Today.
 *
 * Draft versus published is deliberately NOT a permission. Hiding a draft
 * from the athlete would mean re-stamping every row of a block on publish --
 * hundreds of writes, any of which can fail halfway -- to hide the athlete's
 * own program from the athlete. The read path filters on status instead. See
 * docs/programs.md.
 */
export function programPermissions({ coachId, athleteId }: ProgramOwner): string[] {
  const permissions = [read(user(requireId(coachId, "coachId")))];
  if (athleteId === null) return permissions;
  const athlete = requireId(athleteId, "athleteId");
  // A self-coached athlete is both, and Appwrite rejects a duplicate grant no
  // more than it rejects a single one -- but a clean list is easier to audit.
  if (athlete !== coachId) permissions.push(read(user(athlete)));
  permissions.push(read(team(circleTeamId(athlete))));
  return permissions;
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

/**
 * A profile picture.
 *
 * The audience of the profile row that points at it, and deliberately no
 * wider: the owner and their circle read it, so a coach sees each athlete's
 * face and nobody else on the instance does. `read("users")` is what a
 * stranger would stamp and is never granted here -- the audit flags it as
 * squattable, and a face is not something to show a whole instance.
 *
 * The owner alone may change or remove it. No coach update or delete: whose
 * face appears beside a name is that person's call.
 *
 * The coach-to-athlete direction does not come from this stamp. An athlete is
 * not in their coach's circle, the same reason they cannot read the coach's
 * profile row, so the coach's picture reaches them the way the coach's name
 * does: through /api/link/coach/avatar, which checks the active link.
 *
 * Not in POLICIES, which is keyed by table, for the reason `videoPermissions`
 * is not.
 */
export function avatarPermissions({ userId }: { userId: string }): string[] {
  const id = requireId(userId, "userId");
  return [...athleteAndCircle(id), update(user(id)), del(user(id))];
}

/**
 * A coach's record that they have cleared a clip.
 *
 * Read through the circle team and NOT through `read("user:<athleteId>")`,
 * which looks like the obvious spelling and is the one Appwrite refuses. A
 * caller may only stamp roles it holds itself, so a coach cannot grant the
 * athlete anything by name -- the lesson Order 17 learned the expensive way.
 * The circle is the role they share, so the circle is what the row is stamped
 * with, and both of them read it because both are in it.
 *
 * Written from the coach's browser rather than a server route. That is NOT
 * safe on its own, and this comment used to say it was: a stranger -- or the
 * athlete, stamping their own circle -- can create a row naming the real
 * coach, stamped `read("users")`, a role every session holds, and the coach's
 * queue reads it as their own clearance. Found by the audit, 27 Sep 2026.
 * What makes it safe is provenance.ts: a reader only trusts a review carrying
 * `update("user:<coach_id>")`, which only that coach can stamp, and the
 * validate-row Function deletes anything that lacks it.
 *
 * The athlete never writes one: update and delete are the coach's alone, and
 * a row the athlete forges carries no coach stamp and is never read as a
 * review. Clearing a coach's queue is not something the person being coached
 * gets to do.
 */
export function reviewPermissions({ athleteId, coachId }: ReviewParties): string[] {
  return [
    read(team(circleTeamId(requireId(athleteId, "athleteId")))),
    update(user(requireId(coachId, "coachId"))),
    del(user(requireId(coachId, "coachId"))),
  ];
}

/**
 * A comment on a set.
 *
 * Stamped by whoever wrote it, and the shape is deliberately symmetric: the
 * circle reads, the author edits and deletes. That symmetry is the whole
 * reason the athlete's reply at Order 34 needs no second policy -- both
 * parties are circle members, so both can stamp this, and neither can stamp
 * anything naming the other by name.
 *
 * The author owns their own words and nobody else's. A coach cannot delete an
 * athlete's reply and an athlete cannot delete a coach's correction: this is a
 * record of what was said, and a record one side can edit is not one.
 */
export function commentPermissions({ athleteId, authorId }: CommentAuthor): string[] {
  return [
    read(team(circleTeamId(requireId(athleteId, "athleteId")))),
    update(user(requireId(authorId, "authorId"))),
    del(user(requireId(authorId, "authorId"))),
  ];
}

/**
 * A weigh-in.
 *
 * Exactly the shape of a session or a set, and deliberately so: it is the
 * athlete's own record of their own body, written by them and read by whoever
 * coaches them. The coach reading it is the entire feature -- Ruairi asked for
 * this because he currently has to ask -- and the coach not writing it is the
 * same rule as everywhere else, because a coach who could edit a bodyweight
 * could edit a DOTS score.
 */
export function bodyweightPermissions({ athleteId }: RowOwner): string[] {
  return ownedByAthlete(requireId(athleteId, "athleteId"), true);
}

/** Every policy in one place, so a table can never be added without one. */
export const POLICIES = {
  profiles: profilePermissions,
  exercises: exercisePermissions,
  sessions: sessionPermissions,
  sets: setPermissions,
  set_reviews: reviewPermissions,
  set_comments: commentPermissions,
  bodyweight_entries: bodyweightPermissions,
  stats_rollups: rollupPermissions,
  coach_athlete_links: linkPermissions,
  invite_codes: invitePermissions,
  reference_maxes: referenceMaxPermissions,
  programs: programPermissions,
  program_blocks: programPermissions,
  program_weeks: programPermissions,
  program_days: programPermissions,
  prescriptions: programPermissions,
} as const satisfies Record<PolicyTable, (owner: never) => string[]>;

/** Tables a signed-in user may write to at all. */
export const USER_WRITABLE_TABLES: readonly WritableTable[] = [
  "profiles",
  "exercises",
  "sessions",
  "sets",
  "set_reviews",
  "set_comments",
  "bodyweight_entries",
];

export const PROGRAM_TABLES: readonly ProgramTable[] = [
  "programs",
  "program_blocks",
  "program_weeks",
  "program_days",
  "prescriptions",
];

export const SERVER_ONLY_TABLES: readonly ServerTable[] = [
  "stats_rollups",
  "coach_athlete_links",
  "invite_codes",
  "reference_maxes",
  ...PROGRAM_TABLES,
];
