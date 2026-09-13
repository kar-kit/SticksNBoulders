import type { Models } from "appwrite";

export type Sex = "male" | "female";
export type UnitPreference = "kg" | "lb";

export interface Profile extends Models.Row {
  sex: Sex;
  unitPreference: UnitPreference;
  displayName: string | null;
  avatarFileId: string | null;
}

export interface Lift extends Models.Row {
  name: string;
}

export interface TeamInviteCode extends Models.Row {
  teamId: string;
  code: string;
  active: boolean;
}

export interface CoachInviteCode extends Models.Row {
  coachUserId: string;
  code: string;
  active: boolean;
}

export type CoachLinkStatus = "pending" | "active";

export interface CoachLink extends Models.Row {
  coachUserId: string;
  athleteUserId: string;
  status: CoachLinkStatus;
  inviteCodeUsed: string;
  athleteName: string | null;
  coachName: string | null;
}

export interface Program extends Models.Row {
  athleteUserId: string;
  coachUserId: string;
  name: string;
  active: boolean;
}

export interface ProgramEntry extends Models.Row {
  programId: string;
  liftId: string;
  targetSets: number;
  targetReps: number;
  targetLoadKg: number | null;
  targetPercent1RM: number | null;
  dayLabel: string;
}

export interface WorkoutSession extends Models.Row {
  userId: string;
  startedAt: string;
  endedAt: string | null;
}

export interface WorkoutSet extends Models.Row {
  userId: string;
  sessionId: string;
  liftId: string;
  date: string;
  weightKg: number;
  reps: number;
  isWarmup: boolean;
}

export interface BodyweightCheckIn extends Models.Row {
  userId: string;
  weekOf: string;
  photoFileId: string;
  declaredWeightKg: number;
  visionVerified: boolean;
  visionConfidence: number | null;
  flagged: boolean;
}
