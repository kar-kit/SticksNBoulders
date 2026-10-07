# The prescription model

_Order 18. Phase 2a. Source: Ruairi. P0 Blocker._

What a coach writes in the load cell, and what the athlete ends up reading.

## Five kinds, one typed cell

The Program Editor blueprint calls this "the hardest control in the product":
one cell accepting five kinds of prescription, **typed rather than picked from
a dropdown first**. Making Ruairi choose a load type before he can type the
load is what sends him back to Excel.

| Kind | He types | She sees |
| --- | --- | --- |
| Fixed | `142.5`, `60 kg` | 142.5 kg |
| Percent | `75%`, `75% of tested` | 135 kg (75%) |
| RPE | `@8`, `rpe8` | RPE 8 |
| Capped | `75% @8` | 135 kg (75%), stop at RPE 8 |
| Freeform | anything else | shown as written |

`75% @8` and `@8 75%` are the same prescription. Spellings normalise: `rpe 8`
formats back as `@8`.

## Parsing never fails

Freeform is the escape hatch and it is **not optional** — every place this cell
refuses to hold what a coach wants to say is a place he reopens the
spreadsheet. So anything the grammar does not recognise becomes freeform rather
than an error.

That has a failure mode worth naming: a mistyped `75%%` becomes literal text
and reaches the athlete unresolved. The fix is not rejection, it is visibility —
every spec carries its `kind`, so the editor shows the coach what their typing
landed as. Order 19 owes the athlete that indicator.

Two deliberate rules that will look like bugs:

- **A bare `8` is 8kg, not RPE 8.** The grammar requires `@` or `rpe`, and the
  blueprint is explicit. A coach who means RPE 8 and types `8` gets a very light
  single; the parsed-kind indicator is what catches it.
- **An out-of-range RPE stays the coach's words.** `@12` becomes freeform rather
  than a silently clamped RPE 10.

Words left over also mean freeform: `75% then stretch` keeps the whole
instruction instead of parsing to a clean 75% and dropping "then stretch".

## Which max a percentage points at

The blueprint: "A percentage needs a reference max, which defaults to the
training max and can be changed per row." That is which **kind** of max —
`training` by default, `tested` or `estimated` if named — resolved against
Order 17's `reference_maxes`.

Which **exercise** supplies it is a separate question, and Ruairi has answered
it: "Tempo Bench at 70%" is 70% of **the competition bench max**, by default
and without a gesture per row. [Fact] — Ruairi, 6 Oct 2026, as reported by
Joey; the design is `docs/reference-lift.md`.

As predicted here, that is one nullable field and not a reshaped union:
`prescriptions.reference_exercise_id`. Null — every row written before it — is
the line's own exercise, exactly as before. Set, it names the lift whose maxes
the percentage reads:

| Coach types on a Tempo Bench line | Stored | Athlete sees (bench training 150) |
| --- | --- | --- |
| `70% of bench` | load `70%`, reference Bench Press | 105 kg (70% of Bench Press) |
| `70% of tested` (reference already set) | load `70% of tested` | 110 kg (70% of Bench Press), bench tested 157.5 |
| `70% of own` | load `70%`, reference cleared | the tempo bench's own max, as before |

The grammar is untouched: the editor strips `of <lift>` into the column, so the
stored load and everything that parses it are what they were. The kind still
comes from the load text. A reference row:

- reads **only** the referenced lift's maxes — no fallback to the variation's
  own, because a tempo max standing in for "of bench" is a wrong number on the
  bar, silently;
- is **never priced off today's sets of its own exercise**: a tempo set at RPE
  8 measures tempo bench, not comp bench. It behaves like a named kind and is
  never `synced`. Pricing it off the comp bench single logged earlier the same
  session is phase 2 and **[SME to confirm]**;
- names the lift when it cannot resolve ("70% of Bench Press"), so the
  athlete knows which max is missing;
- records lift, kind and basis on the logged set's snapshot — `5 reps · 105 kg
  (70% of Bench Press, training 150)` — so a moved bench max cannot make the
  set unexplainable. Own-exercise snapshots are unchanged.

The editor remembers the last reference used for the same exercise in the same
program and gives it to every new line of that exercise, so it is typed once
per variation per program. Whether that is acceptable or Ruairi wants an
exercise-level default is **[SME to confirm]** after a block of real use.

## Percentages are weight guidance, and they sync to the session

This is what percentages are *for*, and it is easy to build the useless version
by accident. A percentage is not arithmetic against a stored number — it is a
recommendation for how much weight to put on the bar for that set.

The mechanism: a coach prescribes the first set at an RPE and the rest as
percentages. The athlete hits the first set, and `sessionMaxFrom` turns it into
today's working max via the e1RM estimate. Every remaining percentage on that
exercise is then priced off that max, so they all carry a real weight.

```
Squat   set 1   @8            athlete picks it -- 170 x 5 @ 8
        set 2   75%           152.5 kg   (75% of 204, today's max)
        set 3   70%           142.5 kg
        set 4   70%           142.5 kg
```

Before the first set is logged, the percentages fall back to the stored
training max, so the session opens with numbers rather than blanks.

Today's set beats the stored training max whenever there is one, and that is
the point: the training max is a number from weeks ago, the first working set
is a measurement from minutes ago. Preferring the stored one leaves percentages
priced against a max the athlete has already outgrown — the complaint the
ticket opens with, *"athletes max out mid block and wreck his programming"*.

A coach who spells out `of tested` or `of e1RM` is naming a specific stored
number and gets it. Only the default basis autoregulates, so the escape hatch
is one word.

**It is a suggestion, not an imposition.** Order 27 is explicit that a load
suggestion is "always a suggestion, always overridable, never silently
imposed", so a resolved prescription carries `synced` for the logger to show.
A warm-up, or a set logged without an RPE, produces no session max at all —
`estimateOneRepMax` already refuses those, and the percentages stay on the
stored max, which is the safe direction.

`resolveExercise(specs, maxes, loggedSoFar)` does the whole loop in one call.
Every spec passed must belong to the same exercise — they are all priced off
those sets, so a whole day's rows would resolve a bench percentage against a
squat's top set.

The session max is the **highest** estimate among the sets logged so far, not
the latest. Usually there is one RPE set and the two are identical, but they
differ in the two cases that matter: working up (a second, heavier RPE set is a
better measurement, and anchoring on the first would price backoffs off a set
already beaten) and fatigue (a tired late set estimates lower, and a 75%
backoff must not shrink because the athlete is tired — that is what the RPE cap
is for).

## Rounding, which is a product decision

A resolved percentage is rounded **down** to 2.5kg — a 1.25kg plate on each
side.

Down rather than to nearest, because the two directions are not equally wrong.
Prescribing more than the coach asked for is a missed rep or a failed set;
prescribing a shade less is a set that was light. Rounding to nearest would also
make 100% of a 191.5kg max resolve to 192.5 — a weight the athlete has never
lifted, prescribed as if they had.

The cost: every resolved percentage sits up to 2.4kg under its exact value,
about 1% on a heavy squat. Both the increment and the direction are
**[SME to confirm]** with Ruairi, and both are one-word changes.

## When a percentage cannot resolve

An athlete with no max for the lift gets `loadKg: null` and sees the bare
percentage. Inventing a number here would put a weight on a bar that no coach
chose and no data supports. `lib/logging/prefill.ts` already documents exactly
this case — the kilo field starts empty and the RPE engine fills it after the
first working set.

A capped prescription keeps its RPE ceiling even when the percentage cannot
resolve, because the ceiling is still a real instruction.

The Program Editor shows the coach the same failure before the athlete meets
it: beside any percentage that would resolve to nothing it reads, for example,
`No Bench Press training max for Joey · they see "70% of Bench Press"`. It
loads the athlete's maxes the way the logger does and resolves with no session
max. No warning while the maxes are unread or failed, or on a template — unknown
is not missing.

## Where it is stored

Order 18 is the **model**; Order 19 stores it. A line is a row of the
`prescriptions` table, under a program, block, week and day (see
`docs/programs.md`). The load cell is stored **as typed**, with `load_kind`
derived beside it by the write helper — `parse` and `format` round-trip
exactly, and freeform forces the raw text to be kept anyway. The reference
lift is its own column, `reference_exercise_id`, not part of the text.

## Files

| File | What it holds |
| --- | --- |
| `lib/programming/prescription.ts` | The whole model: parse, format, resolve, round, and the prefill adapter |
| `lib/programming/session-plan.ts` | A day's lines into set targets; a reference row's maxes via `ReferenceLookup` |
| `lib/programming/editor.ts` | The load cell's `of <lift>` clause, its indicator, and the missing-max warning |

Consumed by `lib/logging/prefill.ts` (the athlete's set row) and, at Order 19,
by the Program Editor grid.
