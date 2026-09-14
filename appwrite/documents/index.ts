/**
 * The document write helper.
 *
 * Every write in this product goes through here. Nothing else calls createRow,
 * updateRow or deleteRow -- enforced by a lint rule and a guard test, because
 * Appwrite stamps access per row at write time and there is no policy to audit,
 * only every write path.
 *
 * Import from this module, not from the files inside it.
 */
export {
  circleTeamId,
  isCircleTeamId,
  athleteIdFromCircle,
  CIRCLE_ROLES,
} from "./circle";

export {
  addCoachToCircle,
  ensureCircle,
  listCircleCoaches,
  removeCoachFromCircle,
  type TeamAdmin,
} from "./circle-admin";

export {
  exercisePermissions,
  linkPermissions,
  profilePermissions,
  rollupPermissions,
  sessionPermissions,
  setPermissions,
  POLICIES,
  SERVER_ONLY_TABLES,
  USER_WRITABLE_TABLES,
  type PolicyTable,
  type ServerTable,
  type WritableTable,
} from "./policy";

export type { RowWriter } from "./row-writer";

export {
  createCoachLink,
  createExercise,
  createGlobalExercise,
  createProfile,
  createSession,
  createSet,
  deleteSet,
  finishSession,
  normaliseExerciseName,
  renameGlobalExercise,
  revokeCoachLink,
  updateProfile,
  updateSet,
  writeRollup,
  type Actor,
  type CreateExerciseInput,
  type CreateLinkInput,
  type CreateProfileInput,
  type CreateSessionInput,
  type CreateSetInput,
  type FinishSessionInput,
  type UpdateSetInput,
  type UpsertRollupInput,
  type WriteDeps,
} from "./write";
