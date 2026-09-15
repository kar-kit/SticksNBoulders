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

### Which max a percentage points at

"A percentage needs a reference max, which defaults to the training max and can
be changed per row" — which **kind** of max, resolved against Order 17's table.

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

`toPrefillPrescription` is a typed seam onto the athlete's set row. **Nothing
calls it yet** — `prefill.ts` does not import it — because the caller is the
Program Editor. Deliberate, not an oversight, same as Order 17's write path.

### Verification

`typecheck` · `lint` · **1028 tests** (54 on this module) · `build`.
No schema change, so no `appwrite:setup` and no probe run.

Also corrects the schema docstring, which still claimed reference maxes were
absent alongside prescriptions — half of that went stale when Order 17 shipped.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
