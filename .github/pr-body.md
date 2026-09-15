## Order 18 — Prescription model: fixed, percent, RPE, capped, freeform

The ticket calls this "the central schema decision and the expensive one to
retrofit". The blueprint calls the load cell "the hardest control in the
product": one cell accepting five kinds of prescription, **typed** rather than
picked from a dropdown first. Making Ruairi choose a load type before he can
type the load is what sends him back to Excel.

| Kind | He types | She sees |
| --- | --- | --- |
| Fixed | `142.5`, `60 kg` | 142.5 kg |
| Percent | `75%`, `75% of tested` | 135 kg (75%) |
| RPE | `@8`, `rpe8` | RPE 8 |
| Capped | `75% @8` | 135 kg (75%), stop at RPE 8 |
| Freeform | anything else | shown as written |

`75% @8` and `@8 75%` are the same prescription. Spellings normalise — `rpe 8`
formats back as `@8`.

### Parsing never fails, and that needs a guard

Freeform is the escape hatch and it is not optional, so anything the grammar
does not recognise becomes freeform rather than an error. The risk is the
opposite direction: parsing *too* eagerly and silently dropping what the coach
actually said.

The percent and RPE regexes are non-global, so they see only the first match in
a cell. A whole-cell check is what stops `75% 80%` parsing as a clean 75% and
putting one of two percentages on the bar with no indication. Twelve ambiguous
cells checked by hand — `@8 @9`, `3x8 @8`, `5x5 60kg`, `work up to rpe 8`,
`rperformance 8` — all correctly freeform; the seven that would break first are
pinned as tests.

A mistyped `75%%` still becomes literal text. The fix is not rejection — it is
visibility: every spec carries its `kind`, so the editor shows the coach what
their typing landed as. **Order 19 owes the athlete that indicator.**

### Two rules that will look like bugs

- **A bare `8` is 8kg, not RPE 8.** The grammar requires `@` or `rpe`, per the
  blueprint. A coach who means RPE 8 and types `8` gets a very light single.
- **An out-of-range RPE stays the coach's words.** `@12` becomes freeform rather
  than a silently clamped RPE 10.

### Percentages are weight guidance, and they sync to the session

This is what percentages are *for*, and the useless version is easy to build by
accident. A percentage is not arithmetic against a stored number — it is a
recommendation for how much weight goes on the bar for that set.

A coach prescribes the first set at an RPE and the rest as percentages. The
athlete hits the RPE, and that set says what they are good for **today**. Every
remaining percentage on that exercise is priced off it:

```
Squat   set 1   @8       athlete picks it — 170 x 5 @ 8
        set 2   75%      152.5 kg   (75% of 204, today's max)
        set 3   70%      142.5 kg
        set 4   70%      142.5 kg
```

Today's set beats the stored training max whenever there is one. The training
max is weeks old; the first working set is minutes old. Preferring the stored
number leaves percentages priced against a max the athlete has already outgrown
— which is the complaint this ticket opens with, *"athletes max out mid block
and wreck his programming"*.

Before the first set is logged, percentages fall back to the stored max, so a
session opens with numbers rather than blanks. The session max comes from
`estimateOneRepMax`, which already refuses warm-ups, sets logged without an RPE,
and sets too far from failure — refusals that are load-bearing here, since a
wrong number becomes a wrong weight on every remaining set.

**It is a suggestion, not an imposition.** Order 27: a load suggestion is
"always a suggestion, always overridable, never silently imposed". So a resolved
prescription carries `synced` and `basisUsed` for the logger to show, and the
prefill adapter notes that Order 22 must map `synced` onto prefill's
`"suggested"` source rather than `"prescribed"` — otherwise a derived weight
presents itself as the coach's own number.

The anchor is the **highest** estimate among sets logged so far, not the latest.
Usually there is one RPE set and they are identical; they differ when the
athlete works up (a heavier second RPE set is the better measurement) and under
fatigue (a tired late set must not shrink the backoffs — that is what the RPE
cap is for). Both cases are pinned as tests.

### Which max a percentage points at

A percentage names which **kind** of max — `training` by default, resolved
against Order 17's table. Only the default basis autoregulates: a coach who
spells out `of tested` or `of e1RM` is naming a specific stored number and gets
it, so the escape hatch is one word.

Deliberately **not** a pointer at another exercise's max. This ticket's own
notes reject "a single reference max standing in for lifts that move different
weights", which is exactly what tempo bench at a percentage of competition bench
would be. Whether Ruairi wants that anyway is **[SME to confirm]** — one
nullable field if he does, not a reshaped union.

### Rounding, which is a product decision — please read

Resolved percentages round **down** to 2.5kg.

Down rather than to nearest, because the directions are not equally wrong:
prescribing more than the coach asked for is a missed rep, prescribing a shade
less is a set that was light. Rounding to nearest also made 100% of a 191.5kg
max resolve to **192.5** — a weight the athlete has never lifted, prescribed as
if they had. That surfaced as a failing test rather than as a decision, which is
the only reason it got made deliberately.

Cost: every resolved percentage sits up to 2.4kg under its exact value, ~1% on a
heavy squat. **Both the increment and the direction are [SME to confirm] with
Ruairi, and both are one-word changes.**

A percentage with no max resolves to **no load**, not to a guess — `prefill.ts`
already documents exactly that case. A capped prescription keeps its RPE ceiling
even then, because the ceiling is still a real instruction.

### Scope: no table, on purpose

A prescription hangs off a block, a week and a day, and that container is
**Order 19 — still blocked on Ruairi's question** about whether he writes a block
up front, week by week, or session by session. `schema.test.ts` still asserts
`prescriptions` is absent.

`parse` and `format` round-trip exactly for every kind, which is what makes the
storage question safely deferrable: Order 19 can store the typed text or the
structured fields and derive the other. Freeform forces the raw text to be kept
either way.

`toPrefillPrescription` and `resolveExercise` are typed seams onto the athlete's
set row. **Nothing calls them yet** — `prefill.ts` does not import them — because
the callers are the Program Editor (Order 19) and the prescribed session in the
logger (Order 22). Deliberate, not an oversight, same as Order 17's write path.

### Verification

`typecheck` · `lint` · **1040 tests** (66 on this module) · `build`.
No schema change, so no `appwrite:setup` and no probe run.

Also corrects the schema docstring, which still claimed reference maxes were
absent alongside prescriptions — half of that went stale when Order 17 shipped.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
