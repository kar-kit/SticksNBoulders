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
 *
 * ---
 *
 * A variation is its own exercise. Joey's call, 14 Sep 2026.
 *
 * "3-0-0 Tempo Bench Press" is a row, not "Bench Press" carrying a tempo
 * field. Do not build a modifier system for tempo, pauses or grip -- it was
 * considered and rejected, and the reasoning is worth keeping because the
 * alternative looks tidier than it is:
 *
 *   - A tempo bench max is not a bench max. Reference maxes (Order 17) and
 *     e1RM are per exercise, so folding variations into a base lift would mean
 *     one max standing in for lifts that move different weights.
 *   - Even the base name is ambiguous. "Bench Press" reads as the competition
 *     paused bench to one coach and touch-and-go to another, and a program can
 *     legitimately contain both alongside a tempo variant. A modifier system
 *     would still have to answer that, and could not.
 *   - Coaches use whatever seconds they like: 3-0-0, 3-2-0, 0-2-3. A fixed set
 *     of modifier fields would be wrong for somebody within a week.
 *
 * The cost is accepted: the same lift can exist under more than one spelling.
 * The typeahead is what keeps that rare -- "300 tempo bench press" finds
 * "3-0-0 Tempo Bench Press" before the athlete is offered a second row -- and
 * create-on-the-fly is the escape hatch that stops a rigid list sending anyone
 * back to a spreadsheet.
 *
 * This decides shape for Order 12 (rollups are per exercise), Order 17
 * (a max per variation) and Order 18 (no tempo fields on a prescription).
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
