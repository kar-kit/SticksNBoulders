export const DATABASE_ID = "sticksnboulders";

export const TABLES = {
  profiles: "profiles",
  lifts: "lifts",
  teamInviteCodes: "team_invite_codes",
  coachInviteCodes: "coach_invite_codes",
  coachLinks: "coach_links",
  programs: "programs",
  programEntries: "program_entries",
  workoutSessions: "workout_sessions",
  workoutSets: "workout_sets",
  bodyweightCheckins: "bodyweight_checkins",
} as const;

export const BUCKETS = {
  bodyweightPhotos: "bodyweight_photos",
  avatars: "avatars",
} as const;

export const FUNCTIONS = {
  teamInviteCreate: "team-invite-create",
  teamInviteRedeem: "team-invite-redeem",
  coachInviteCreate: "coach-invite-create",
  coachInviteRedeem: "coach-invite-redeem",
  leaderboard: "leaderboard",
} as const;
