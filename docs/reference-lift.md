# Reference lift: a percentage on a variation, priced off the competition lift

_Design, 7 Oct 2026. Phase 2a, extends Orders 17/18/19/20/22. Source: Ruairi._

**Status: option (A) built, 7 Oct 2026, branch `FTP1-reference-lift`** —
tasks 1–6 and 7, with task 8's audit assertion and `e2e:copy` extension. Not
yet applied to the live instance: needs `npm run appwrite:setup` (one
`create-column`), then `appwrite:audit` and `e2e:copy`. Task 9 (own-exercise
snapshots gain the basis) and task 10 (phase 2 session sync, [SME to confirm])
are not built. Where the build departs from this design, see §9.

Ruairi was asked: "If you programme Tempo Bench at 70%, 70% of what?" He
answered **"the competition bench max"** — not the tempo bench's own max, and
not "I would want to choose each time". So a percentage on a variation must
resolve against the competition lift's max **by default and without a
gesture per row**, and the `[SME to confirm]` carried in
`docs/prescriptions.md`, `docs/reference-maxes.md`, `lib/programming/prescription.ts`
and `appwrite/schema/index.ts` is now answered. [Fact] — Joey's report of the
conversation.

This document decides the shape and recommends one. No production code
changes here; the worked examples were computed by a scratch script against
the repo's own pure functions (see §6).

## 0. What is true on `origin/dev` today

Verified by reading the code at `98d441d`:

- [Fact] A percentage resolves only against the row's own exercise.
  `basisMaxesFor(exerciseId, …)` filters `entry.exerciseId === exerciseId`
  (`lib/programming/session-plan.ts:112-128`), and every caller passes
  `planned.exerciseId` (`app/(athlete)/today/today-screen.tsx:155`,
  `app/(athlete)/log/log-screen.tsx:210`,
  `app/(athlete)/today/program/program-screen.tsx:240`).
- [Fact] The max **kind** comes from an `of tested` / `of e1rm` suffix, default
  `training` (`DEFAULT_BASIS`, `PERCENT_PART`, `basisFrom` in
  `lib/programming/prescription.ts:60-90`). The grammar has no slot for an
  exercise.
- [Fact] A variation is its own exercise (commit `1ebb185`, 14 Sep 2026,
  recorded in `lib/exercises/seed.ts`). The `Exercise` shape is
  `id, name, normalisedName, isGlobal, ownerId` (`lib/exercises/match.ts:16-22`).
  A max is held per `exercise_id` (`reference_maxes`).
- [Fact] With no max, `loadKg` is `null`, `unresolved: true`, and the athlete
  sees the bare percentage (`resolvePrescription`, `prescription.ts:335-343`).
- [Fact] `prescription.ts:47-59` and `docs/prescriptions.md` reject a base-lift
  pointer but say that if Ruairi wants it "it is one added field, not a
  reshaped union". `docs/reference-maxes.md` says the pointer "is a property of
  a prescription, so it belongs to Order 18".
- [Fact] `copyProgram` re-resolves every line's exercise in the target
  athlete's library and refuses the copy if one no longer exists
  (`appwrite/documents/program-admin.ts:636-651`). `copyPrescription` copies
  every column except Appwrite's and `LINE_PLACEMENT`
  (`program-write.ts:356-382`); the comment says a new row-id column **must**
  be added there and remapped.
- [Fact] Commit `6afee10` makes the default basis autoregulate off today's top
  set of the same exercise (`resolveExercise`, `chooseBasis`); a named kind
  never does.
- [Fact] Loads round **down** to 2.5 kg (`roundToLoadable`, `lib/strength/plates.ts`).
- [Fact] The logged set stores `prescription_id` and a 160-char `prescribed`
  text snapshot (`appwrite/schema/index.ts:137-143`, `write.ts:330-333`),
  stamped when the row appears (`prescribeNewRows`, `session-plan.ts:370-371`).
- [Fact] `asOf` for max resolution is the **render time** (`new Date()`), not
  the day's `scheduled_on`. A past day re-rendered later shows today's max;
  the snapshot is the record of what was asked.
- [Fact] The Program Editor does not load the athlete's maxes and shows no
  "unresolved" warning; `describeLoad` only names the kind
  (`lib/programming/editor.ts:43-61`, no `maxes` in `program-editor.tsx`).
  The comment in `prescription.ts:209-213` ("the editor warns the coach") is
  aspirational.
- [Fact] `fetchReferenceMaxes(athleteId)` is **not** filtered by exercise and
  is cached offline with My Program (`my-program-cache.ts`), so the reference
  lift's maxes are already on the device whenever the variation's are.
- [Fact] `exercises` is client-writable: an athlete-owned row carries
  `update("user:<athlete>")`; a global row is `read("users")` plus the
  server's `team:library` mark and is writable by nobody from a session
  (`policy.ts:166-179`). The coach cannot write an athlete's exercise row
  from the browser.

## 1. Where the link lives

Three candidates. Keystroke counts assume Ruairi's stated pattern of "most
blocks are one week repeated with load changes" — he writes week 1 and
duplicates — and a 12-week program with two variations at a percentage.

### (A) Per-prescription `reference_exercise_id`, nullable

The row says "this percentage is of *that* exercise". Null means the row's own
exercise — today's behaviour, byte for byte.

- Keystrokes, naive: one gesture per row (`of bench`, ~9 keystrokes). 12 weeks
  × 2 variations = 24 gestures if every week is typed by hand; **2** if week 1
  is duplicated, because the column travels with the line
  (`lineContent` copies anything not in `LINE_PLACEMENT`, and the remap for
  `duplicateWeek` is the identity).
- Keystrokes with the **editor remembering the last reference used for the
  same exercise in the same program** (a client-side default, no schema): one
  gesture per variation per program. New Tempo Bench rows prefill the
  reference and the indicator says so; `of own` clears it.
- 14 Sep decision: **untouched.** A variation stays its own exercise with its
  own max, rollups and e1RM. The pointer is on the prescription, which is
  exactly where `docs/reference-maxes.md` said it belongs.
- Cost: the first row of each variation in each program needs a word typed.
  [Inference] That is the same cost as `of tested` today and the same control.

### (B) Exercise-level default: "Tempo Bench references Bench Press"

A `reference_exercise_id` on the `exercises` row. Zero gestures per row, one
per variation **per athlete library**, ever.

- Global rows are server-only, so the seeded variations would need the default
  **curated**: somebody decides that `Pause Bench Press`, `Spoto Press`,
  `Close Grip Bench Press` all reference `Bench Press`. `seed.ts` itself says
  the base name is ambiguous ("Bench Press" is the comp paused bench to one
  coach and touch-and-go to another). A seeded default encodes one coach's
  opinion into every coach's library. [Inference]
- Athlete-owned variations are **athlete-writable** and **coach-unwritable**
  from a session. The coach setting the default needs a new server op (a
  `/api/program` or `/api/library` route), a policy decision on whether the
  athlete may change what their coach's percentages point at, a validator
  consideration (the Function fires on `exercises` updates), and an IDB cache
  shape bump for the library (`library-cache.ts`).
- It reopens the 14 Sep decision in substance: the exercise row grows a
  relationship to a base lift — the first step toward the modifier system that
  was considered and rejected.
- It is a hidden default: a coach typing `70%` sees "70% of training max" and
  the athlete gets comp bench numbers. The indicator can say so, but the truth
  is on another screen.
- One exercise row serves every athlete on the instance (global rows), so it
  cannot express "comp bench for this athlete, own max for that one".

### (C) Both: exercise default, row overrides

Fewest gestures, most surface. Two places to look when a number is wrong.
`copyProgram` must carry **both**: the row column (remapped) and, for a
variation created in the target's library, the exercise default (an
`exercises` write inside a program copy). Everything in (B) plus (A).

### Recommendation: (A), with the editor's per-program memory

[Inference] It satisfies Ruairi's answer — Tempo Bench rows default to comp
bench without a per-row gesture once he has said so once in that program —
while keeping the 14 Sep decision intact, needing one nullable column, no new
route, no exercise-table change, and a copy rule the code already asks for.
The difference against (B) is one or two typed phrases per program.

(B)/(C) remain the right move only if Ruairi, having used (A), says the
per-program word is itself the friction. That is observable in the beta and
cheap to add later: the row column would stay the override. **[SME to
confirm]** after a block of real use.

## 2. Resolution semantics

For a row with `reference_exercise_id = R` and load `p%` (percent or capped):

| Question | Answer |
| --- | --- |
| Which exercise's maxes | `R`'s. `basisMaxesFor(R, entries, estimated, asOf)` — the same function, a different first argument. |
| Which kind | As the load text says: `70%` → `training`, `70% of tested` → `tested`, `70% of e1rm` → `R`'s best e1RM in the rollups. `DEFAULT_BASIS` unchanged. |
| Effective date | Unchanged: `asOf` is render time, `currentMax` picks the newest entry already in effect, future-dated entries invisible. |
| Own max | **Not consulted.** No fallback from `R` to the row's own exercise: the coach said "of bench"; a tempo max standing in for it is a wrong number on the bar, and silently so. Rows with a null reference behave exactly as today, so a variation's own max still wins for rows that do not opt in. |
| `R` has no max | `loadKg: null`, `unresolved: true`; the athlete reads **"70% of Bench Press"** and picks a weight. A capped row keeps its ceiling. Same honest failure as today, with the lift named so the athlete knows *which* max is missing. |
| Display | "105 kg (70% of Bench Press)". The lift name appears **only** when a reference is set; own-exercise rows keep "105 kg (70%)". [Inference] — the name is what makes the number explain itself; omitting it on the common case keeps the set row short. |
| Non-percent loads | The column is stored whatever the load kind and consulted only for `percent`/`capped`. A coach who changes `70%` to `@8` and back does not lose the reference. The editor indicator shows it only when it matters. |
| `R` = own exercise | Normalised to null by the write helper. |

### Session sync (`6afee10`)

Today `resolveExercise` prices the default basis off the highest e1RM among
the **same exercise's** sets logged this session. For a reference row that is
the wrong lift: a tempo bench set at RPE 8 measures tempo bench, not comp
bench. Example 5 in §6 shows the gap — 102.5 kg priced off today's bench
single, 90 kg if wrongly priced off the tempo set, 105 kg from the stored
bench max.

Rule: **a reference row is never priced off its own exercise's sets.**

- **Phase 1 (ship with the column):** a reference row resolves against the
  stored max of `R` and is not `synced`. This is exactly how a named kind
  behaves today (`chooseBasis` with `basis !== DEFAULT_BASIS`), so the
  resolver change is: when a row carries a reference, pass it the reference's
  maxes with `session: null`.
- **Phase 2 ([SME to confirm] with Ruairi):** price the row off `R`'s top set
  logged **earlier in the same session**, when there is one — "Bench 1×1 @9,
  then Tempo Bench 3×5 70%" is his own mechanism applied across lifts. The
  logger holds every exercise's sets, so this is plumbing (`targetsFor`
  takes a `loggedFor(exerciseId)` lookup) rather than a model change. The
  anchor note would read "(from today's Bench Press top set)". Not built until
  he confirms it is what he means; a wrong sync is a wrong weight on every
  remaining set.

### Backoff rules (Order 21)

Unaffected. A backoff prices off the **athlete's actual top set on that line**,
never a stored max, so `3 x 90%` under a reference row still follows what they
lifted.

## 3. `copyProgram` and `duplicateWeek`

- Add `reference_exercise_id` to `LINE_PLACEMENT` and give `copyPrescription`'s
  `placement` a `referenceExerciseId: string | null`. [Fact] The comment at
  `program-write.ts:369-377` already requires this for any row-id column; left
  out, a copy onto another athlete would point at an exercise they may not be
  able to read.
- **`duplicateWeek`**: same athlete, same library — the remap is the identity
  (`(id) => id`), as it already is for `exercise_id`.
- **`copyProgram`**: the set of exercises resolved in the target's library
  (`program-admin.ts:641-651`) is built from `exercise_id` alone. Build it
  from `exercise_id ∪ reference_exercise_id`. Then: global stays global; a
  source-athlete-owned reference is found by name in the target's library or
  **created there** through `exerciseInLibrary`, like any variation; a
  reference whose row no longer exists **refuses the copy before any write**,
  same rule as the line's own exercise. A created reference has no max, so
  the copied line is unresolved until the coach sets one — the copy is a
  draft the coach reads before publishing, and the editor indicator says
  "no Bench Press max for <athlete>" ([Inference]; see §7 task 5).
- Percentages stay percentages; nothing turns one into kilos (existing rule).
- Authorisation unchanged: both ends still need an active link.

## 4. Immutability: what the `prescribed` snapshot must record

Constraint 5 is carried by the 160-char text stamped on the set when the row
appears. Today it reads `5 reps · 105 kg (70%)` and records **neither which max
nor its value**. For a reference row that is no longer enough: when the bench
max moves from 150 to 155 the string "105 kg (70%)" cannot say what the 70% was
of.

Required on a reference row's snapshot: the lift name, the kind used and the
basis value — e.g.

```
5 reps · 105 kg (70% of Bench Press, training 150)
5–8 reps · 107.5 kg (70% of 3-0-0 Tempo Close Grip Larsen Press With Chains, tested 157.5), stop at RPE 8
```

[Fact] Both fit the 160-char column; the worst case (64-char exercise name,
range reps, half-point cap) is 129 chars (§6). The **display** the athlete
reads mid-set stays short ("105 kg (70% of Bench Press)"); only the snapshot
carries the basis. `snapshotOf` gains the basis annotation from
`ResolvedPrescription.basisUsed` plus the kg it resolved against, which
`chooseBasis` already knows and should return.

Recommended, separately: give own-exercise rows the same `, training 150`
annotation. [Inference] It is the same gap, and a snapshot that records the
basis is what lets the coach's "why did that say 105?" be answered from the
set alone a month later. Optional; it changes every future snapshot string and
the e2e assertions on them, so it is its own task (§7 task 8).

What the snapshot guarantees, verified in §6 example 3: the set logged on
15 Oct holds `105 kg`; the same line re-rendered on 22 Oct resolves to
`107.5 kg`; a typo-fix row dated 1 Oct and entered later changes the live plan
and never the set. Nothing on the program or max side writes to `sets`
(asserted today in `program-admin.test.ts`; `reference-max-admin` writes only
`reference_maxes`).

## 5. Schema, migration, permissions, write helper

**Schema** (`appwrite/schema/index.ts`, `version: 12`):

```ts
// prescriptions
// The exercise whose max this percentage is OF, when it is not the line's
// own: "Tempo Bench 70%" of the competition bench (Ruairi, 7 Oct 2026). Null
// means the line's own exercise, which is every row written before this.
{ key: "reference_exercise_id", type: "string", size: 36, required: false },
```

No index: nothing queries by it. No enum change. `planSchema` emits a single
`create-column`, which `appwrite:setup` applies; a nullable column needs no
backfill because null is today's semantics. [Fact] `schema.test.ts` pins the
version and column list and must be updated.

**Row parser and type** (`lib/programming/program.ts`): `reference_exercise_id:
nullableString` in `prescriptionRow`; `referenceExerciseId?: string | null` on
`Prescription` (optional, like `backoff`, so fixtures built before the column
still type-check). Zod: `referenceExerciseId: rowId.nullable().optional()` in
`lineFields` and `updatePrescription`.

**Write helper** (`appwrite/documents/program-write.ts`): `createPrescription`
and `updatePrescription` write `reference_exercise_id`, normalising a
self-reference to null; `copyPrescription` takes it from `placement`;
`LINE_PLACEMENT` gains it. Permission stamps unchanged — `programPermissions`
is keyed on coach and athlete, not on columns.

**Admin** (`program-admin.ts`): `addPrescription`/`updatePrescription` run
`requireExercise(ctx, scope, referenceExerciseId)` on the reference too — it
must be global or in the athlete's library, or the athlete's phone would price
a percentage off a row it cannot read. Copy changes per §3.

**Permission audit**: no new table, so no new `ResourceRule`; `programTable("prescriptions")`
already covers the column. [Inference] Worth one added assertion in
`scripts/appwrite-audit.mts`: the route refuses a reference to a coach-private
exercise (same shape as the existing "exerciseId: not in the athlete's
library" refusal). Provenance and the validator Function are untouched —
`prescriptions` is server-only and not in `USER_WRITABLE_TABLES`.

**Offline**: nothing. Reference maxes for every exercise are already fetched
and cached with the program (§0).

## 6. Worked examples (computed, not hand-calculated)

Script: `/tmp/snb-reference-lift/check.ts` (outside the repo), run with
`node_modules/.bin/tsx --tsconfig tsconfig.json`, importing `basisMaxesFor`,
`targetsFor`, `resolvePrescription`, `resolveExercise`, `roundToLoadable` and
`estimateOneRepMax` from this worktree. 39 checks, all passing on 7 Oct. The
only "design" step in the script is handing `basisMaxesFor` the reference
lift's id.

**1. Comp bench training 150, Tempo Bench `70%` referencing bench.**
70% × 150 = 105.0 → `roundToLoadable` → **105 kg**, `basisUsed: training`.
Same row with no reference and a tempo training max of 120: 70% × 120 = 84.0 →
**82.5 kg** (rounded down). `72.5%` of 150 = 108.75 → **107.5 kg**.

**2. Kinds on the reference lift.** Bench tested 157.5 (20 Sep), training 150
(1 Oct), best e1RM 160. `70%` → 105 kg (training); `70% of tested` → 110.25 →
**110 kg**; `70% of e1rm` → 112 → **110 kg**; `70% @8` → 105 kg, ceiling RPE 8.

**3. Reference max moves mid-block.** Bench training 150 from 1 Oct, 155 from
20 Oct, 160 from 1 Nov. Session on 15 Oct: **105 kg**, snapshot
`5 reps · 105 kg (70%)` stamped on the set. Same line rendered on 22 Oct:
**107.5 kg** (108.5 floored); the 1 Nov entry is invisible. A typo-fix row
(152.5, effective 1 Oct, entered later) wins the tie for 15 Oct going forward;
the logged set's snapshot does not move.

**4. Reference lift has no max.** Tempo has a training max of 120; bench has
none (or only a future-dated one). `loadKg: null`, `unresolved: true`, display
`70%` today, to become `70% of Bench Press`. The capped row keeps `stop at RPE 8`.
The own max is not used.

**5. Session sync.** Comp bench logged earlier: 145 × 1 @9 → e1RM **149.1**
(Brzycki, RIR 1). 70% → 104.37 → **102.5 kg**, `synced: true` — phase 2's
answer. Wrongly priced off the tempo bench's own first set (110 × 5 @8 → e1RM
132): 70% → 92.4 → **90 kg**. Phase 1's answer: stored bench max, **105 kg**,
`synced: false`. `70% of tested` ignores today's set either way: **110 kg**.

**Snapshot budget.** Proposed long-form snapshot with a 48-char name: 105
chars; with a 64-char name, range reps and a half-point cap: 129 chars. Both
under 160.

## 7. Implementation breakdown

Tiers: **S** ≤ half a day, mechanical, Sonnet. **M** a day, touches a reviewed
boundary or UX, Opus. **L** none here. The write helper and anything stamping
or copying rows is hand-reviewed line by line regardless of who writes it
(CLAUDE.md).

| # | Task | Size | Model | Files |
| --- | --- | --- | --- | --- |
| 1 | Schema column, version 12, Zod `referenceExerciseId` on `lineFields`/`updatePrescription`, row parser, `Prescription` type. Update `schema.test.ts`, `program.test.ts`. | S | Sonnet | `appwrite/schema/index.ts`, `appwrite/schema/schema.test.ts`, `lib/programming/program.ts`, `lib/programming/program.test.ts` |
| 2 | Write helper: create/update write the column, self-reference → null, `LINE_PLACEMENT` + `copyPrescription` placement. Tests for all three and for `lineContent` excluding it. | M | Opus | `appwrite/documents/program-write.ts`, `program-write.test.ts` |
| 3 | Admin: `requireExercise` on the reference for add/update; `copyProgram` resolves `exercise_id ∪ reference_exercise_id` in the target's library and remaps both; `duplicateWeek` identity remap. Tests: reference kept when global, found by name, created, refused when gone, refused when coach-private; never touches `sets`. | M | Opus | `appwrite/documents/program-admin.ts`, `program-admin.test.ts`, `program-copy.test.ts` |
| 4 | Pure resolver + planner: `targetsFor` takes `maxesFor(exerciseId)` (and in phase 2 `loggedFor`); reference rows get `R`'s maxes with `session: null`; display adds "of <name>" when referenced; `chooseBasis` returns the kg used; `snapshotOf` records lift, kind and basis kg on reference rows. Tests mirror §6. | M | Opus | `lib/programming/prescription.ts`, `prescription.test.ts`, `lib/programming/session-plan.ts`, `session-plan.test.ts` |
| 5 | Logger and Today wiring: the three call sites pass a `maxesFor` lookup and the exercise name map (already loaded for the typeahead). Snapshot reaches `prescribeNewRows` unchanged. | S | Sonnet | `app/(athlete)/log/log-screen.tsx`, `app/(athlete)/today/today-screen.tsx`, `app/(athlete)/today/program/program-screen.tsx`, `today-screen.test.tsx` |
| 6 | Editor: load cell accepts a trailing `of <name>` (not a basis word) resolved against the athlete's library with the existing typeahead ranking; `commitCell` strips it into `referenceExerciseId` so stored `load` stays `70%`; `of own` clears; indicator reads "Percent · 70% of Bench Press (training max)"; new rows on the same exercise in the same program prefill the last reference used. `applyLineOp` carries it. | M | Opus | `lib/programming/editor.ts`, `editor.test.ts`, `components/coach/program-editor.tsx`, `program-editor.test.tsx` |
| 7 | Docs: resolve the `[SME to confirm]` in `prescriptions.md`, `reference-maxes.md`, the comments in `prescription.ts:47-59` and `schema/index.ts:301-305`; `programs.md` copy rules gain the column. | S | Sonnet | `docs/prescriptions.md`, `docs/reference-maxes.md`, `docs/programs.md`, the two comments |
| 8 | Audit + e2e: one audit assertion (coach-private reference refused via the route); `e2e:program` writes a referenced line and asserts Today shows the bench-priced kilos; `e2e:copy` asserts the reference is remapped and a missing one refuses. Not run by the design author. | S | Sonnet | `scripts/appwrite-audit.mts`, `scripts/e2e-program.mts`, `scripts/e2e-copy.mts` |
| 9 | Optional, same gap: own-exercise snapshots gain `, training 150`. Changes every snapshot string and the e2e assertions on them. | S | Sonnet | `lib/programming/session-plan.ts`, tests, `scripts/e2e-*.mts` that assert `prescribed` |
| 10 | Phase 2, after Ruairi confirms: reference rows price off `R`'s top set logged earlier in the session; anchor note names the lift. | M | Opus | `session-plan.ts`, `prescription.ts`, `log-screen.tsx`, tests |

Order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Tasks 1–5 ship the model end to end
(a referenced line can be seeded and resolves on the phone); 6 makes it
typeable. Nothing before 6 is visible to Ruairi, so 1–6 are one PR.

**Test plan.** Unit: every row of §6 as a `prescription.test.ts` /
`session-plan.test.ts` case; `program-write.test.ts` asserts the column is
written, self-reference nulled, and `lineContent` excludes it;
`program-copy.test.ts` covers kept/found/created/refused for the reference and
asserts no `sets` write; `editor.test.ts` covers `70% of bench` → `{load:
"70%", referenceExerciseId}`, `70% of tested` untouched, `70% of own` → null,
`75% of nonsense` → freeform as today (parsing never fails). Schema test pins
version 12. Live: `npm run appwrite:setup` (one `create-column`), `appwrite:audit`
green with the new assertion, `e2e:program` and `e2e:copy` extended. Before
hand-over: Joey's own Tempo Bench line in his dogfood program, priced off his
bench.

## 8. Open points

- **[SME to confirm] Phase 2 sync** — does Ruairi want the tempo percentage to
  follow today's comp bench single when both are in the same session?
- **[SME to confirm] After a block** — is one `of bench` per variation per
  program acceptable, or does he want the exercise-level default (B)?
- **[Inference] Display names the lift only on reference rows.** If the
  athlete side reads better with the lift always named, it is one string.
- **[Unverified] Appwrite accepts a nullable string column on a populated
  table without a rebuild** — every previous nullable addition (`backoff`,
  `video_required`, `program_day_id`) did; confirmed by running `appwrite:setup`
  against the beta instance at task 1.

## 9. As built: where it departs from the design

- **Example 3's snapshot.** §6 example 3 shows the logged set stamped
  `5 reps · 105 kg (70%)`; that is today's own-exercise form and contradicts
  §4, which requires the lift, kind and basis on a reference row. Built to §4:
  `5 reps · 105 kg (70% of Bench Press, training 150)`. The numbers are as
  computed (105, then 107.5 on 22 Oct, the snapshot unmoved).
- **Date of the answer.** The §5 schema comment dates Ruairi's answer 7 Oct,
  the design's own date. The brief for the build dates it 6 Oct 2026, with his
  other form answers; the code and docs say 6 Oct. [Unverified] — Joey to
  confirm which day he asked.
- **`targetsFor`'s signature.** Task 4 says it "takes `maxesFor(exerciseId)`".
  Built as an optional fourth argument, a `ReferenceLookup` (maxes and name by
  id), leaving the own-exercise `maxes` argument and every existing caller and
  test as they were. A reference row with no lookup resolves to nothing rather
  than the own max.
- **`schema.test.ts` did not pin the version** (§5 says it does; it asserted
  `>= 1`). The new test pins 12 and the column's exact shape.
- **The editor warning covers own-exercise rows too.** §0's finding was that
  the editor warned on nothing, despite `prescription.ts` saying it did. It now
  loads the athlete's maxes and warns on any percentage that would resolve to
  nothing, own or referenced, naming the max to set. No warning while the maxes
  are unread or failed, or on a template. [Inference] The narrower fix (reference
  rows only) would have left the comment's claim false for the common case.
- **"Last reference used" is the last line of the exercise in program order**,
  not the last edit. [Inference] The tree carries no per-cell history and
  blocks are written forwards; `of own` on the latest line stops inheritance.
- **An unnamed reference.** If the athlete's library has not loaded when a row
  is stamped, the display and snapshot say "the reference lift" instead of the
  name. The kilos are unaffected. [Inference] Rare: the library is cached
  offline with the session.
- **`e2e:program` is not extended**; `e2e:copy` carries the end-to-end proof
  instead — a referenced line through duplicate and copy, Andrea's Today
  reading `95 kg (80% of Squat)`, and the route refusing a reference to a
  lift she cannot read.

