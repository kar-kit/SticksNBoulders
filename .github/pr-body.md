## Video by default for the competition lifts

Ruairi, asked which lifts he wants filmed: "Mainly compounds but if you have
questions on accessories or variations do record too." This makes "compounds by
default, coach flags the rest" true with the smallest thing that does it: an
optional exercise-level default that pre-ticks `video_required` when a coach
adds a line in the Program Editor.

### What changed

**`exercises.video_default`**, a nullable boolean in `appwrite/schema/index.ts`.
No default, so applying it rewrites no row; null reads as false everywhere
(`toExercise` in `lib/exercises/library.ts`, the seed reconcile).
`Exercise.videoDefault` is optional, so no existing constructor changes.

**The pre-tick** is one localised change in `components/coach/program-editor.tsx`
(`addLine`, three lines): a new line for an exercise whose default is on goes
out with `videoRequired: true`. The coach can untick it with the same
one-field write as ever, and can tick any accessory or variation by hand.

**The seed** sets it for Squat, Bench Press and Deadlift only
(`VIDEO_DEFAULT_EXERCISES` in `lib/exercises/seed.ts`). `exercises:seed`
reconciles it on existing library rows too, through a new
`setGlobalExerciseVideoDefault` in the write helper, so every Appwrite write
still goes through `appwrite/documents/write.ts`. `createGlobalExercise` writes
the field only when true.

**`docs/video.md`** gets a delimited subsection appended; nothing else in that
doc moved.

### What it does not do

- **It never gates logging.** [Fact] Nothing under `lib/logging` or the logger
  reads `video_default`; `video_required` stays a nudge.
- **It never changes an existing line.** [Fact] The pre-tick lives in the
  editor's add path only. Swapping a line's exercise sends only `exerciseId`
  (tested). `addPrescription` on the server writes the `videoRequired` it is
  sent and never reads the exercise (tested), so an API caller sees no change.
- **`duplicateWeek` and `copyProgram` carry `video_required` as stored.**
  [Fact] `copyPrescription` copies every non-placement column (`lineContent`,
  `appwrite/documents/program-write.ts`); the existing test for both paths still
  passes, and a new one proves an unticked squat line stays unticked on both
  copies when Squat's default is on.

### Joey must run `npm run appwrite:setup`

[Fact] Schema is code and this PR does not touch the live instance. The
`video_default` column does not exist there until `npm run appwrite:setup`
applies it. Order matters: **setup first, then `npm run exercises:seed -- --yes`**.
Seeding first fails on the three rows that carry the field. Until setup runs,
`fetchExerciseLibrary` still works (the column reads as absent, so false) and
the editor simply pre-ticks nothing.

### Candidate compounds, and what is not guessed

[SME to confirm] Whether variations count as compounds is Ruairi's call; his
quote says to record variations "if you have questions", which reads as
coach-flagged rather than default. Left off. The seeded exercises that look
like compounds, for him to say yes or no to:

- Squat family: Front Squat, Pause Squat, Tempo Squat, Box Squat, Safety Bar Squat
- Bench family: Pause Bench Press, Close Grip Bench Press, Incline Bench Press, Spoto Press, Larsen Press
- Deadlift family: Sumo Deadlift, Deficit Deadlift, Block Pull, Rack Pull, Romanian Deadlift, Stiff Leg Deadlift
- Other multi-joint lifts: Overhead Press, Seated Overhead Press, Barbell Row, Pendlay Row, Pull Up, Chin Up, Dip, Bulgarian Split Squat, Hip Thrust, Good Morning

[Inference] Tempo and pause variations of the three are the real question:
they are the lifts a coach most often has "questions on". Tempo Bench Press is
not in the seed (the seed's header uses it as an example name); a coach typing
it creates an athlete-owned row with no default, so it is coach-flagged today.
Adding a name to `VIDEO_DEFAULT_EXERCISES` and re-running the seed is the whole
change once Ruairi answers.

[Inference] Custom exercises created on the fly never carry a default; only
the seed can set one, because there is no UI for it and none was asked for.

### Verification

`lint` · `typecheck` · **2032 tests, 128 files**. No `appwrite:*` or `e2e:*`
script was run; nothing here touched the live instance. [Unverified] The seed
script's new reconcile branch is not unit-tested (the script runs against the
live instance); `setGlobalExerciseVideoDefault` and `createGlobalExercise` are.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
