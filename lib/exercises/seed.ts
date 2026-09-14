/**
 * The shared exercise library.
 *
 * [Inference] Nobody specified these contents. Order 6 says "exercise library
 * with typeahead and create on the fly" and nothing about what is in it, so
 * this is a starting list, not an agreed one -- powerlifting staples and the
 * variations a coach actually programmes, deliberately not a bodybuilding
 * database. Anything missing gets typed in mid-session and belongs to whoever
 * typed it, which is the whole point of create-on-the-fly.
 *
 * Ruairi should be asked to cut and add before the beta. [SME to confirm]
 *
 * Names are stored as written here. Matching is done on the normalised form,
 * so capitalisation and punctuation below are for reading, not for searching.
 */
export const SEED_EXERCISES: readonly string[] = [
  // The three, and the bar variations of each.
  "Squat",
  "Front Squat",
  "Pause Squat",
  "Tempo Squat",
  "Box Squat",
  "Safety Bar Squat",
  "Bench Press",
  "Pause Bench Press",
  "Close Grip Bench Press",
  "Incline Bench Press",
  "Spoto Press",
  "Larsen Press",
  "Deadlift",
  "Sumo Deadlift",
  "Deficit Deadlift",
  "Block Pull",
  "Rack Pull",
  "Romanian Deadlift",
  "Stiff Leg Deadlift",

  // Lower body accessories.
  "Bulgarian Split Squat",
  "Walking Lunge",
  "Leg Press",
  "Hack Squat",
  "Leg Extension",
  "Leg Curl",
  "Hip Thrust",
  "Good Morning",
  "Back Extension",
  "Standing Calf Raise",

  // Upper body pressing.
  "Overhead Press",
  "Seated Overhead Press",
  "Dumbbell Bench Press",
  "Dumbbell Shoulder Press",
  "Dip",
  "Push Up",
  "Tricep Pushdown",
  "Skullcrusher",
  "Lateral Raise",

  // Upper body pulling.
  "Barbell Row",
  "Pendlay Row",
  "Dumbbell Row",
  "Chest Supported Row",
  "Seated Cable Row",
  "Lat Pulldown",
  "Pull Up",
  "Chin Up",
  "Face Pull",
  "Barbell Curl",
  "Dumbbell Curl",
  "Hammer Curl",

  // Trunk.
  "Plank",
  "Hanging Leg Raise",
  "Ab Wheel Rollout",
  "Pallof Press",
] as const;
