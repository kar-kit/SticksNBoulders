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
  invitePermissions,
  linkPermissions,
  bodyweightPermissions,
  commentPermissions,
  profilePermissions,
  reviewPermissions,
  rollupPermissions,
  sessionPermissions,
  setPermissions,
  POLICIES,
  SERVER_ONLY_TABLES,
  USER_WRITABLE_TABLES,
  type CodeOwner,
  type CommentAuthor,
  type ReviewParties,
  type PolicyTable,
  type ServerTable,
  type WritableTable,
} from "./policy";

export type { RowWriter } from "./row-writer";

export {
  createCoachLink,
  createExercise,
  createGlobalExercise,
  createInviteCode,
  createProfile,
  createSession,
  createSet,
  attachVideo,
  bodyweightRowId,
  deleteBodyweight,
  deleteComment,
  deleteSet,
  finishSession,
  markSetReviewed,
  normaliseExerciseName,
  postComment,
  recordBodyweight,
  reviseBodyweight,
  reactivateCoachLink,
  renameGlobalExercise,
  revokeCoachLink,
  unmarkSetReviewed,
  updateProfile,
  updateSet,
  writeRollup,
  type Actor,
  type CreateExerciseInput,
  type CreateInviteCodeInput,
  type CreateLinkInput,
  type CreateProfileInput,
  type CreateSessionInput,
  type CreateSetInput,
  type FinishSessionInput,
  type MarkReviewedInput,
  type PostCommentInput,
  type RecordBodyweightInput,
  type UpdateSetInput,
  type UpsertRollupInput,
  type WriteDeps,
} from "./write";
