## feat: reference lift -- Tempo Bench at 70% of the competition bench

Ruairi answered "70% of what?" with **the competition bench max** (6 Oct 2026,
as reported by Joey). This builds option (A) from `docs/reference-lift.md`: a
nullable `prescriptions.reference_exercise_id`, with the editor remembering the
last reference per exercise per program, so `of bench` is typed once per
variation per program. Null is today's behaviour byte for byte: no column
written, same display, same snapshot.

### What changes

- **Schema v12**: one nullable string column, no index, no backfill (null =
  the line's own exercise, which every existing row already means).
- **Write helper** (`program-write.ts`): writes the column only when set;
  a self-reference is stored as null; `reference_exercise_id` joins
  `LINE_PLACEMENT` and `copyPrescription` takes it from the remap.
- **Admin** (`program-admin.ts`): `requireExercise` on the reference (global or
  in the athlete's library); `copyProgram` resolves `exercise_id ∪
  reference_exercise_id` in the target's library (kept / found by name /
  created) and refuses before any write if a reference is gone;
  `duplicateWeek` keeps it.
- **Resolver**: a reference row reads only the referenced lift's stored maxes,
  never its own exercise's sets (not `synced`), never the variation's max.
  Display `105 kg (70% of Bench Press)`; snapshot `5 reps · 105 kg (70% of
  Bench Press, training 150)`; no max reads `70% of Bench Press`.
- **Editor**: `70% of bench` strips into the column (stored load stays `70%`),
  `of own` clears, `of tested` stays a kind, an unknown lift stays freeform.
  Indicator: `Percent · 70% of Bench Press (training max)`. New lines inherit
  the last reference for that exercise. **Audit finding closed:** the editor
  now loads the athlete's maxes and warns beside any percentage that would
  resolve to nothing, e.g. `No Bench Press training max for Joey · they see
  "70% of Bench Press"`.

### Where it departs from the design (also `docs/reference-lift.md` §9)

- §6 example 3's snapshot (`105 kg (70%)`) contradicted §4. Built to §4.
- `schema.test.ts` did not pin the version as §5 claimed; it does now.
- The warning covers own-exercise rows too. [Inference] Otherwise the
  `prescription.ts` comment stays false for the common case.
- `targetsFor` takes an optional `ReferenceLookup` 4th argument, not a
  replacement `maxesFor`, so existing callers are untouched.
- The design dated the answer 7 Oct; the brief says 6 Oct. [Unverified] Joey
  to confirm.

### Run live, in this order

1. `npm run appwrite:setup -- --dry-run`. Expect exactly one `create-column`
   (`prescriptions.reference_exercise_id`).
2. `npm run appwrite:setup`. No backfill: null is today's semantics.
3. `npm run appwrite:audit`. New checks: the coach may reference a library lift
   and may not reference his own private exercise.
4. `E2E_BASE_URL=… npm run e2e:copy` (with `next dev` running). Its paused
   bench is now 80% of the squat, carried through both copies, and
   Andrea's Today should read `95 kg (80% of Squat)`.

Deploy the app after step 2. Until the column exists, a write carrying a
reference would fail; rows without one never send the column.

### Not built

Task 9 (own-row snapshots gain the basis) and task 10 (phase 2, pricing off
the comp single logged earlier in the session: **[SME to confirm]** with
Ruairi). `e2e:program` is not extended; `e2e:copy` covers Today pricing.

### Verification

`npm test` 2112 passed (130 files), `npm run lint` clean, `npm run typecheck`
clean, all offline. The design's §6 numbers are unit tests: 150 → 105,
`of tested` 157.5 → 110, 155 mid-block → 107.5 with the 105 snapshot kept, no
max → null, 145×1@9 → 102.5 vs the wrong 90, rounding via `roundToLoadable`.
Audit and e2e not run.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
