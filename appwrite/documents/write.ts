import { circleTeamId } from "./circle";
import {
  exercisePermissions,
  linkPermissions,
  profilePermissions,
  rollupPermissions,
  sessionPermissions,
  setPermissions,
} from "./policy";
import type { RowWriter } from "./row-writer";

/**
 * The document write helper.
 *
 * Every write in this product goes through this file. Nothing calls createRow,
 * updateRow or deleteRow from a component, a route handler, a hook or a
 * Function -- there is a guard test that fails the build if anything does.
 *
 * It owns two things that must never drift apart, which is exactly why they
 * live together:
 *
 *   1. The permissions stamped on the row.
 *   2. The denormalised fields the row is later filtered by.
 *
 * Appwrite has no joins, so `athlete_id` is copied onto every set. If that copy
 * and the permission stamp were written in different places, one would
 * eventually be right and the other wrong, and the symptom would be a coach
 * seeing somebody else's training.
 */

export interface WriteDeps {
  writer: RowWriter;
  databaseId: string;
  /** Generates row ids. Injected so tests are deterministic. */
  newId: () => string;
  /** Injected so a queued offline write keeps the time it actually happened. */
  now: () => Date;
}

/** The signed-in user on whose behalf the write happens. */
export interface Actor {
  userId: string;
}

const iso = (date: Date) => date.toISOString();

/* -------------------------------------------------------------------------
 * Profiles
 * ---------------------------------------------------------------------- */

export interface CreateProfileInput {
  displayName: string;
  sex?: "male" | "female";
  units?: "kg" | "lb";
}

export async function createProfile(deps: WriteDeps, actor: Actor, input: CreateProfileInput) {
  return deps.writer.createRow({
    databaseId: deps.databaseId,
    tableId: "profiles",
    // The profile id IS the user id, so a lookup never needs a query.
    rowId: actor.userId,
    data: {
      user_id: actor.userId,
      display_name: input.displayName,
      sex: input.sex,
      units: input.units ?? "kg",
      created_at: iso(deps.now()),
    },
    permissions: profilePermissions({ athleteId: actor.userId }),
  });
}

export async function updateProfile(
  deps: WriteDeps,
  actor: Actor,
  input: Partial<CreateProfileInput>,
) {
  return deps.writer.updateRow({
    databaseId: deps.databaseId,
    tableId: "profiles",
    rowId: actor.userId,
    data: {
      ...(input.displayName !== undefined && { display_name: input.displayName }),
      ...(input.sex !== undefined && { sex: input.sex }),
      ...(input.units !== undefined && { units: input.units }),
    },
    // Re-stamped on every update: a permission set that is only ever written
    // once is a permission set that drifts when the policy changes.
    permissions: profilePermissions({ athleteId: actor.userId }),
  });
}

/* -------------------------------------------------------------------------
 * Exercises
 * ---------------------------------------------------------------------- */

/**
 * Lowercase, collapse whitespace, drop punctuation. "Barbell Row" and
 * "barbell  row" must collide rather than becoming two library entries an
 * athlete has to choose between mid-session.
 */
export function normaliseExerciseName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface CreateExerciseInput {
  name: string;
}

export async function createExercise(deps: WriteDeps, actor: Actor, input: CreateExerciseInput) {
  const name = input.name.trim();
  if (!name) throw new Error("createExercise: name is required");

  return deps.writer.createRow({
    databaseId: deps.databaseId,
    tableId: "exercises",
    rowId: deps.newId(),
    data: {
      name,
      normalised_name: normaliseExerciseName(name),
      // Anything typed during a session belongs to its author. Promoting one
      // into the shared library is a deliberate, separate act.
      is_global: false,
      owner_id: actor.userId,
      created_at: iso(deps.now()),
    },
    permissions: exercisePermissions({ athleteId: actor.userId, isGlobal: false }),
  });
}

/**
 * A row in the shared library.
 *
 * Server-only, and permanently so: `exercisePermissions` grants a global
 * exercise read to everyone and write to nobody, so once seeded, nothing in
 * the app can correct a typo in one. That is why the seed script reconciles
 * rather than only inserting -- see scripts/seed-exercises.mts.
 */
export async function createGlobalExercise(deps: WriteDeps, input: CreateExerciseInput) {
  const name = input.name.trim();
  if (!name) throw new Error("createGlobalExercise: name is required");

  return deps.writer.createRow({
    databaseId: deps.databaseId,
    tableId: "exercises",
    rowId: deps.newId(),
    data: {
      name,
      normalised_name: normaliseExerciseName(name),
      is_global: true,
      // No owner. The library belongs to the product, not to whoever ran the
      // seed script from their laptop.
      owner_id: undefined,
      created_at: iso(deps.now()),
    },
    // athleteId is required by the policy's signature but unused for a global
    // row, which resolves to a plain read for every signed-in user.
    permissions: exercisePermissions({ athleteId: "library", isGlobal: true }),
  });
}

/** Corrects the display name of a library row. The normalised form follows it. */
export async function renameGlobalExercise(
  deps: WriteDeps,
  input: { rowId: string; name: string },
) {
  const name = input.name.trim();
  if (!name) throw new Error("renameGlobalExercise: name is required");

  return deps.writer.updateRow({
    databaseId: deps.databaseId,
    tableId: "exercises",
    rowId: input.rowId,
    data: { name, normalised_name: normaliseExerciseName(name) },
    permissions: exercisePermissions({ athleteId: "library", isGlobal: true }),
  });
}

/* -------------------------------------------------------------------------
 * Sessions
 * ---------------------------------------------------------------------- */

export interface CreateSessionInput {
  /** Generated on the device. Makes a queued write idempotent on retry. */
  clientSessionId: string;
  startedAt?: Date;
  notes?: string;
}

export async function createSession(deps: WriteDeps, actor: Actor, input: CreateSessionInput) {
  if (!input.clientSessionId) throw new Error("createSession: clientSessionId is required");

  return deps.writer.createRow({
    databaseId: deps.databaseId,
    tableId: "sessions",
    rowId: deps.newId(),
    data: {
      athlete_id: actor.userId,
      started_at: iso(input.startedAt ?? deps.now()),
      notes: input.notes,
      set_count: 0,
      tonnage_kg: 0,
      client_session_id: input.clientSessionId,
    },
    permissions: sessionPermissions({ athleteId: actor.userId }),
  });
}

export interface FinishSessionInput {
  sessionId: string;
  finishedAt?: Date;
  setCount: number;
  tonnageKg: number;
  notes?: string;
}

export async function finishSession(deps: WriteDeps, actor: Actor, input: FinishSessionInput) {
  return deps.writer.updateRow({
    databaseId: deps.databaseId,
    tableId: "sessions",
    rowId: input.sessionId,
    data: {
      finished_at: iso(input.finishedAt ?? deps.now()),
      // Totals are stored, not summed on read: there is no GROUP BY.
      set_count: input.setCount,
      tonnage_kg: input.tonnageKg,
      ...(input.notes !== undefined && { notes: input.notes }),
    },
    permissions: sessionPermissions({ athleteId: actor.userId }),
  });
}

/* -------------------------------------------------------------------------
 * Sets
 * ---------------------------------------------------------------------- */

export interface CreateSetInput {
  sessionId: string;
  exerciseId: string;
  setIndex: number;
  loadKg: number;
  reps: number;
  rpe?: number | null;
  isWarmup?: boolean;
  /** Generated on the device. Unique-indexed, so a retry cannot duplicate. */
  clientSetId: string;
  loggedAt?: Date;
  videoFileId?: string;
  notes?: string;
  /**
   * Computed and stored at write time, never derived on read. Optional until
   * Order 11 lands the formula; the rebuild script backfills it.
   */
  e1rmKg?: number | null;
}

export async function createSet(deps: WriteDeps, actor: Actor, input: CreateSetInput) {
  if (!input.clientSetId) throw new Error("createSet: clientSetId is required");
  if (!input.sessionId) throw new Error("createSet: sessionId is required");
  if (!input.exerciseId) throw new Error("createSet: exerciseId is required");

  return deps.writer.createRow({
    databaseId: deps.databaseId,
    tableId: "sets",
    rowId: deps.newId(),
    data: {
      session_id: input.sessionId,
      // Denormalised here and only here. The caller does not get to supply it:
      // a set always belongs to the person logging it.
      athlete_id: actor.userId,
      exercise_id: input.exerciseId,
      set_index: input.setIndex,
      load_kg: input.loadKg,
      reps: input.reps,
      rpe: input.rpe ?? undefined,
      is_warmup: input.isWarmup ?? false,
      e1rm_kg: input.e1rmKg ?? undefined,
      logged_at: iso(input.loggedAt ?? deps.now()),
      client_set_id: input.clientSetId,
      video_file_id: input.videoFileId,
      notes: input.notes,
    },
    permissions: setPermissions({ athleteId: actor.userId }),
  });
}

export interface UpdateSetInput {
  rowId: string;
  loadKg?: number;
  reps?: number;
  rpe?: number | null;
  isWarmup?: boolean;
  videoFileId?: string;
  notes?: string;
  e1rmKg?: number | null;
}

/** Correcting a set from History. The rollup is recomputed by the Function. */
export async function updateSet(deps: WriteDeps, actor: Actor, input: UpdateSetInput) {
  return deps.writer.updateRow({
    databaseId: deps.databaseId,
    tableId: "sets",
    rowId: input.rowId,
    data: {
      ...(input.loadKg !== undefined && { load_kg: input.loadKg }),
      ...(input.reps !== undefined && { reps: input.reps }),
      ...(input.rpe !== undefined && { rpe: input.rpe ?? null }),
      ...(input.isWarmup !== undefined && { is_warmup: input.isWarmup }),
      ...(input.videoFileId !== undefined && { video_file_id: input.videoFileId }),
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.e1rmKg !== undefined && { e1rm_kg: input.e1rmKg }),
    },
    permissions: setPermissions({ athleteId: actor.userId }),
  });
}

export async function deleteSet(deps: WriteDeps, _actor: Actor, rowId: string) {
  return deps.writer.deleteRow({ databaseId: deps.databaseId, tableId: "sets", rowId });
}

/* -------------------------------------------------------------------------
 * Server-only writes
 *
 * These run inside an Appwrite Function with an API key, which bypasses
 * permissions entirely. They still route through here so the stamped
 * permissions come from the same policy as everything else.
 * ---------------------------------------------------------------------- */

export interface UpsertRollupInput {
  athleteId: string;
  exerciseId: string;
  weekStart: Date;
  setCount: number;
  volumeReps: number;
  tonnageKg: number;
  bestE1rmKg?: number | null;
  bestSingleKg?: number | null;
  bestSingleReps?: number | null;
  /** Supplied when updating an existing rollup rather than creating one. */
  rowId?: string;
}

export async function writeRollup(deps: WriteDeps, input: UpsertRollupInput) {
  const data = {
    athlete_id: input.athleteId,
    exercise_id: input.exerciseId,
    week_start: iso(input.weekStart),
    set_count: input.setCount,
    volume_reps: input.volumeReps,
    tonnage_kg: input.tonnageKg,
    best_e1rm_kg: input.bestE1rmKg ?? undefined,
    best_single_kg: input.bestSingleKg ?? undefined,
    best_single_reps: input.bestSingleReps ?? undefined,
    rebuilt_at: iso(deps.now()),
  };
  const permissions = rollupPermissions({ athleteId: input.athleteId });

  if (input.rowId) {
    return deps.writer.updateRow({
      databaseId: deps.databaseId,
      tableId: "stats_rollups",
      rowId: input.rowId,
      data,
      permissions,
    });
  }
  return deps.writer.createRow({
    databaseId: deps.databaseId,
    tableId: "stats_rollups",
    rowId: deps.newId(),
    data,
    permissions,
  });
}

export interface CreateLinkInput {
  coachId: string;
  athleteId: string;
}

/**
 * Links a coach to an athlete. The caller is responsible for adding the coach
 * to the athlete's circle team in the same Function -- the link row records the
 * fact, the membership is what Appwrite enforces. `circleTeamId` is exported
 * here so that call site cannot invent its own naming.
 */
export async function createCoachLink(deps: WriteDeps, input: CreateLinkInput) {
  if (input.coachId === input.athleteId) {
    throw new Error("createCoachLink: a coach cannot be linked to themselves");
  }
  return deps.writer.createRow({
    databaseId: deps.databaseId,
    tableId: "coach_athlete_links",
    rowId: deps.newId(),
    data: {
      coach_id: input.coachId,
      athlete_id: input.athleteId,
      status: "active",
      linked_at: iso(deps.now()),
    },
    permissions: linkPermissions(input),
  });
}

export async function revokeCoachLink(
  deps: WriteDeps,
  input: CreateLinkInput & { rowId: string },
) {
  return deps.writer.updateRow({
    databaseId: deps.databaseId,
    tableId: "coach_athlete_links",
    rowId: input.rowId,
    data: { status: "revoked", revoked_at: iso(deps.now()) },
    permissions: linkPermissions(input),
  });
}

export { circleTeamId };
