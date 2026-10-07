## Design: reference lift for percentage prescriptions on variations

Ruairi answered "70% of what?" for Tempo Bench with **"the competition bench
max"** — a default, not a per-row choice. Today a percentage resolves only
against the row's own exercise (`basisMaxesFor` filters on `exerciseId`), so a
tempo line shows a bare `70%` or, worse, 70% of the tempo max. This PR is the
design only: `docs/reference-lift.md`. No production code.

### Recommendation

One nullable column, `prescriptions.reference_exercise_id`, exactly the "one
added field, not a reshaped union" that `prescription.ts` and
`docs/prescriptions.md` reserved. Null is today's behaviour. The editor
remembers the last reference used for the same exercise in the same program,
so Ruairi types `of bench` once per variation per program, not once per row,
and `duplicateWeek` carries it. The 14 Sep "a variation is its own exercise"
decision stands untouched; the exercise-level default (option B) is kept as
the fallback if the per-program word turns out to be friction.

### Semantics decided

- Kind as typed (`training` default, `of tested`, `of e1rm`), applied to the
  **reference** lift's maxes at render-time `asOf` — the same functions, a
  different exercise id.
- No fallback to the variation's own max. Reference lift with no max →
  unresolved, athlete reads "70% of Bench Press". Rows without a reference are
  byte-for-byte today's.
- Session sync: a reference row is **never** priced off its own exercise's
  sets (wrong lift). Phase 1 uses the stored reference max; phase 2, [SME to
  confirm], prices off the reference lift's top set logged earlier in the
  same session.
- Snapshot on the logged set records lift, kind and basis kg:
  `5 reps · 105 kg (70% of Bench Press, training 150)` — fits 160 chars in
  the worst case (129).
- `copyProgram` resolves `exercise_id ∪ reference_exercise_id` in the target's
  library and refuses before writing if either is gone; column added to
  `LINE_PLACEMENT` as the code already demands.

### Verified

Worked examples computed by a scratch script against the repo's own
`basisMaxesFor`, `resolvePrescription`, `resolveExercise`, `roundToLoadable`
and `estimateOneRepMax`: 39 checks pass. Highlights: 150 → **105 kg**;
`of tested` 157.5 → **110 kg**; max moves 150 → 155 mid-block gives
**107.5 kg** on the later day while the earlier set's snapshot stays 105; no
max → `null`; today's bench single 145 × 1 @9 would price it at **102.5 kg**,
the tempo set wrongly at **90 kg**.

### Decision for Joey

Row-level column with editor memory (recommended) versus an exercise-level
default. Everything else in the doc follows from that.

### Implementation

Ten tasks sized S/M with model tier and exact files, in
`docs/reference-lift.md` §7. Tasks 1–6 are one PR.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
