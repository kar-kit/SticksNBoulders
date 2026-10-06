import { normaliseBackoff } from "@/lib/programming/backoff";
import { parsePrescription } from "@/lib/programming/prescription";
import { programPermissions, type ProgramTable } from "./policy";
import { createExercise, type Actor, type WriteDeps } from "./write";

/**
 * The write helper's program half. Part of the helper, not beside it: it lives
 * in appwrite/documents, is covered by the same guard test, and stamps
 * permissions from the same policy file. Split out of write.ts only so the
 * five program tables are reviewed together.
 */

const iso = (date: Date) => date.toISOString();

/* -------------------------------------------------------------------------
 * Programs (Order 19)
 *
 * Coach-authored and server-written: every function below runs with the API
 * key, called only from program-admin.ts, which has already checked that the
 * caller coaches the athlete. They take a ProgramScope rather than loose ids
 * because the scope is what gets copied onto every row AND what the
 * permissions are stamped from -- one value, so the two cannot disagree.
 *
 * Nothing here touches `sessions` or `sets`. That is constraint 5 in code: a
 * coach editing a block never rewrites what an athlete already did. There is a
 * test asserting it.
 * ---------------------------------------------------------------------- */

/** Which program a row belongs to, and whose it is. Read from the program row. */
export interface ProgramScope {
  programId: string;
  coachId: string;
  /** Null for a template. */
  athleteId: string | null;
}

/**
 * The denormalised columns every child row carries, written together with the
 * permission stamp. Re-written on every update too: a scope written once is a
 * scope that drifts the first time a template is copied wrong.
 */
function scoped(scope: ProgramScope) {
  return {
    data: { program_id: scope.programId, coach_id: scope.coachId, athlete_id: scope.athleteId },
    permissions: programPermissions({ coachId: scope.coachId, athleteId: scope.athleteId }),
  };
}

/** Drops keys whose value is undefined, so a partial update leaves them alone. */
function defined(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
}

export interface CreateProgramInput {
  /** Null for a template. */
  athleteId: string | null;
  name: string;
  status?: "draft" | "published" | "archived";
  startOn?: string | null;
  notes?: string | null;
  templateId?: string | null;
}

/**
 * Starts a program. The actor is the coach, and becomes `coach_id` -- never an
 * argument, so a program cannot be written in somebody else's name.
 *
 * Draft by default. A half-written block must not reach an athlete's Today.
 */
export async function createProgram(deps: WriteDeps, actor: Actor, input: CreateProgramInput) {
  const name = input.name.trim();
  if (!name) throw new Error("createProgram: name is required");
  const now = iso(deps.now());
  return deps.writer.createRow({
    databaseId: deps.databaseId,
    tableId: "programs",
    rowId: deps.newId(),
    data: {
      coach_id: actor.userId,
      athlete_id: input.athleteId,
      name,
      status: input.status ?? "draft",
      start_on: input.startOn ?? null,
      notes: input.notes ?? null,
      template_id: input.templateId ?? null,
      created_at: now,
      updated_at: now,
    },
    permissions: programPermissions({ coachId: actor.userId, athleteId: input.athleteId }),
  });
}

export interface UpdateProgramInput {
  name?: string;
  status?: "draft" | "published" | "archived";
  startOn?: string | null;
  notes?: string | null;
}

/**
 * Renames, re-dates, publishes or archives a program. Coach and athlete are
 * not editable here: reassigning a program is a copy, so a template edited
 * later cannot reach into an athlete's live block.
 */
export async function updateProgram(deps: WriteDeps, scope: ProgramScope, input: UpdateProgramInput) {
  const { permissions } = scoped(scope);
  return deps.writer.updateRow({
    databaseId: deps.databaseId,
    tableId: "programs",
    rowId: scope.programId,
    data: defined({
      name: input.name?.trim() || undefined,
      status: input.status,
      start_on: input.startOn,
      notes: input.notes,
      updated_at: iso(deps.now()),
    }),
    permissions,
  });
}

export interface BlockFields {
  position?: number;
  name?: string;
  notes?: string | null;
}

export async function createProgramBlock(
  deps: WriteDeps,
  scope: ProgramScope,
  input: BlockFields & { position: number; name: string },
) {
  const { data, permissions } = scoped(scope);
  return deps.writer.createRow({
    databaseId: deps.databaseId,
    tableId: "program_blocks",
    rowId: deps.newId(),
    data: { ...data, position: input.position, name: input.name.trim(), notes: input.notes ?? null },
    permissions,
  });
}

export async function updateProgramBlock(deps: WriteDeps, scope: ProgramScope, rowId: string, input: BlockFields) {
  const { data, permissions } = scoped(scope);
  return deps.writer.updateRow({
    databaseId: deps.databaseId,
    tableId: "program_blocks",
    rowId,
    data: defined({ ...data, position: input.position, name: input.name?.trim() || undefined, notes: input.notes }),
    permissions,
  });
}

export interface WeekFields {
  position?: number;
  label?: string | null;
  status?: "draft" | "published";
  notes?: string | null;
}

export async function createProgramWeek(
  deps: WriteDeps,
  scope: ProgramScope,
  input: WeekFields & { blockId: string; position: number },
) {
  const { data, permissions } = scoped(scope);
  return deps.writer.createRow({
    databaseId: deps.databaseId,
    tableId: "program_weeks",
    rowId: deps.newId(),
    data: {
      ...data,
      block_id: input.blockId,
      position: input.position,
      label: input.label ?? null,
      status: input.status ?? "draft",
      notes: input.notes ?? null,
    },
    permissions,
  });
}

export async function updateProgramWeek(deps: WriteDeps, scope: ProgramScope, rowId: string, input: WeekFields) {
  const { data, permissions } = scoped(scope);
  return deps.writer.updateRow({
    databaseId: deps.databaseId,
    tableId: "program_weeks",
    rowId,
    data: defined({ ...data, position: input.position, label: input.label, status: input.status, notes: input.notes }),
    permissions,
  });
}

export interface DayFields {
  position?: number;
  label?: string | null;
  scheduledOn?: string | null;
  notes?: string | null;
}

export async function createProgramDay(
  deps: WriteDeps,
  scope: ProgramScope,
  input: DayFields & { blockId: string; weekId: string; position: number },
) {
  const { data, permissions } = scoped(scope);
  return deps.writer.createRow({
    databaseId: deps.databaseId,
    tableId: "program_days",
    rowId: deps.newId(),
    data: {
      ...data,
      block_id: input.blockId,
      week_id: input.weekId,
      position: input.position,
      label: input.label ?? null,
      scheduled_on: input.scheduledOn ?? null,
      notes: input.notes ?? null,
    },
    permissions,
  });
}

export async function updateProgramDay(deps: WriteDeps, scope: ProgramScope, rowId: string, input: DayFields) {
  const { data, permissions } = scoped(scope);
  return deps.writer.updateRow({
    databaseId: deps.databaseId,
    tableId: "program_days",
    rowId,
    data: defined({
      ...data,
      position: input.position,
      label: input.label,
      scheduled_on: input.scheduledOn,
      notes: input.notes,
    }),
    permissions,
  });
}

export interface PrescriptionFields {
  exerciseId?: string;
  position?: number;
  setCount?: number;
  reps?: number | null;
  repMax?: number | null;
  /** The load cell as typed. Its kind is derived here, never supplied. */
  load?: string | null;
  restSeconds?: number | null;
  notes?: string | null;
  /** The backoff cell as typed. Stored in its canonical spelling, derived here. */
  backoff?: string | null;
}

/**
 * The backoff as stored: canonical ("3 x 90%"), so the athlete's phone and
 * the editor read the same rule however the coach spaced it. Undefined means
 * "not in this write". The route has already refused anything unparseable;
 * this throws rather than store a rule nobody can execute if a caller skips
 * the route's schema.
 */
function backoffOf(backoff: string | null | undefined) {
  return backoff === undefined ? undefined : normaliseBackoff(backoff);
}

/**
 * What a load cell parses as, or null for an empty one.
 *
 * Computed here and not by the caller, the same rule as e1RM on a set: a
 * derived column the caller could supply is a column that can disagree with
 * the text it was derived from.
 */
function loadKindOf(load: string | null | undefined) {
  if (load === undefined) return undefined;
  return load === null ? null : (parsePrescription(load)?.kind ?? null);
}

export async function createPrescription(
  deps: WriteDeps,
  scope: ProgramScope,
  input: PrescriptionFields & { weekId: string; dayId: string; exerciseId: string; position: number; setCount: number },
) {
  const { data, permissions } = scoped(scope);
  const load = input.load?.trim() || null;
  return deps.writer.createRow({
    databaseId: deps.databaseId,
    tableId: "prescriptions",
    rowId: deps.newId(),
    data: {
      ...data,
      week_id: input.weekId,
      day_id: input.dayId,
      exercise_id: input.exerciseId,
      position: input.position,
      set_count: input.setCount,
      reps: input.reps ?? null,
      rep_max: input.repMax ?? null,
      load,
      load_kind: loadKindOf(load),
      rest_seconds: input.restSeconds ?? null,
      notes: input.notes ?? null,
      // Only when set: a line with no backoff writes exactly what it did
      // before Order 21, so it never depends on the column existing yet.
      ...(input.backoff ? { backoff: backoffOf(input.backoff) } : {}),
      updated_at: iso(deps.now()),
    },
    permissions,
  });
}

/**
 * Edits a line. Mutable by design: a logged set carries its own snapshot of
 * what it was prescribed, so nothing here can reach what an athlete did.
 */
export async function updatePrescription(
  deps: WriteDeps,
  scope: ProgramScope,
  rowId: string,
  input: PrescriptionFields,
) {
  const { data, permissions } = scoped(scope);
  const load = input.load === undefined ? undefined : input.load?.trim() || null;
  return deps.writer.updateRow({
    databaseId: deps.databaseId,
    tableId: "prescriptions",
    rowId,
    data: defined({
      ...data,
      exercise_id: input.exerciseId,
      position: input.position,
      set_count: input.setCount,
      reps: input.reps,
      rep_max: input.repMax,
      load,
      load_kind: loadKindOf(load),
      rest_seconds: input.restSeconds,
      notes: input.notes,
      backoff: backoffOf(input.backoff),
      updated_at: iso(deps.now()),
    }),
    permissions,
  });
}

/**
 * Removes a line. Safe for the same reason editing is: a set logged against it
 * keeps its snapshot, and its `prescription_id` simply stops resolving.
 */
export async function deletePrescription(deps: WriteDeps, rowId: string) {
  return deps.writer.deleteRow({ databaseId: deps.databaseId, tableId: "prescriptions", rowId });
}

/**
 * Removes a block, week or day row. The cascade -- which children go first --
 * is program-admin's job; this only deletes the one row it is given, from a
 * program table and nowhere else.
 */
export async function deleteProgramRow(
  deps: WriteDeps,
  tableId: Exclude<ProgramTable, "programs" | "prescriptions">,
  rowId: string,
) {
  return deps.writer.deleteRow({ databaseId: deps.databaseId, tableId, rowId });
}

/**
 * A variation typed into the editor, created in the library of the person who
 * will log it. Same row, same permission stamp as an athlete creating it
 * mid-session -- `createExercise` with the owner as actor -- so nothing
 * downstream can tell the two apart. Only program-admin calls this, after it
 * has checked the caller coaches `ownerId`.
 */
export async function createExerciseFor(deps: WriteDeps, ownerId: string, name: string) {
  return createExercise(deps, { userId: ownerId }, { name });
}
