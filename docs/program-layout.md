# Program Editor layout: kilos beside the percentage, a progression view, keyboard-first

_Design note, 16 Oct 2026. Extends Order 19 (docs/programs.md). Source: the
competitor research brief, Ruairi's RTS complaints, Joey's screenshot._

## What stays

The research's verdict was to keep the bones: the Block > Week outline, day
cards, one Publish per week, the start date, and Calendar as the opening view.
Nothing below moves them. No schema change, no new route, no new op: every
write is one `/api/program` op the editor already sends.

## What is built, in priority order

### 1. The kilos beside every percentage, and a reason instead of "No load"

[Fact] Before this, a `75%` cell read `Percent · 75% of training max` and, if
the athlete had no max, a red line naming it. It never said what 75% *was*,
which is the question a coach asks before publishing. An empty cell read a
bare "No load".

Each load cell now carries a second line, computed by `loadPreview`
(`lib/programming/editor.ts`) with the **same resolver the phone uses**
(`basisMaxesFor` + `resolvePrescription`, rounded down to 2.5 kg by
`roundToLoadable`), so the editor can never show a different number from the
athlete's phone:

| Cell | Second line |
| --- | --- |
| `75%`, squat training 190 from 12 Sep | `→ 142.5 kg · Squat training max 190, set 12 Sep` |
| `70%` on Tempo Bench, `of bench` | `→ 105 kg · Bench Press training max 150, set 1 Oct` |
| `75% @8` | `→ 142.5 kg, stop at RPE 8 · Squat training max 190, set 12 Sep` |
| `75%`, no squat max | `No Squat training max for Joey yet · they see "75%"` + **Add one** |
| `75%`, max only from 1 Nov | `Squat training max 200 starts 1 Nov · nothing in effect yet` + **Add one** |
| `75% of e1rm`, nothing logged | `No Squat e1RM yet: nothing logged with an RPE · drop "of e1rm" to use the training max` |
| empty | `No load yet · type 75%, @8 or 142.5` |
| maxes still loading / failed | `Kilos appear once Joey's maxes load` / `Could not read Joey's maxes · kilos unknown` |
| template | `Template · kilos resolve per athlete` |

**Add one** opens an inline kg field that writes a max through the existing
`/api/reference-max` route (`setReferenceMax`, the same call CURRENT MAXES on
Athlete View makes), then re-reads the maxes. The kind it sets is the kind the
cell asks for: `of tested` sets a tested max, everything else a training max.
[Inference] An e1RM cannot be typed in; it comes from logged sets, so that
case gets an instruction rather than a field.

**Which date the max is read at.** The phone resolves at render time. The
editor reads the max in effect on the **day's date, or today if the day is in
the past** (`previewDate`). [Inference] A coach who pre-sets next block's
training max from 1 Nov expects week 5's percentages to price off it; a past,
unlogged day will be priced off today's max when the athlete opens it, which is
what today shows.

**What it cannot know.** On the phone a default-basis percentage re-prices
off today's RPE top set once it is logged (docs/prescriptions.md). The editor
shows the stored-max number, which is what the session opens with. [Fact]
That is the number the athlete sees before their first working set.

**RPE rows get no kilos.** [Inference] The phone shows `RPE 8` and lets the
athlete pick; an editor estimate from e1RM would be a number the athlete never
sees, off an RPE chart CLAUDE.md marks [Unverified]. Their kind line already
reads `RPE 8 · athlete picks the weight`, so no second line. Decision for Joey.

### 2. A progression view (rows are exercise slots, columns are weeks)

A third tab, `Progression`, beside Calendar and Week (`?view=progression`).
One block at a time (the selected week's block; a block switcher above the
grid). Rows are **slots**, columns are the block's weeks, each cell is one
editable input holding `sets x reps load` (`3x5 75%`), with the computed kilos
under it.

**What a slot is.** `(day position in the week, exercise, occurrence of that
exercise in the day)`: "Day 1, Squat, 2nd line" is the squat backoff in every
week. [Inference] Position alone breaks the first time a coach inserts a
line in week 3; exercise alone merges a top set and its backoffs. Rows are
grouped under their day ("Day 1 · Heavy squat"), in the order slots first
appear. A week missing the slot shows an empty cell; typing into it adds the
line to that week's day (an `addPrescription`); a week missing the whole day
shows a dash.

Edits are the same one-field `updatePrescription` the week view sends
(`commitShorthand`), optimistic, put back on refusal. Rest, notes, backoff and
video stay in the week view: they do not progress week to week.

### 3. Keyboard-first entry

- **Shorthand** in the sets, reps and load cells and the progression cell
  (`parseShorthand`): `5x3`, `5x3 @8`, `3x5 75%`, `3x8-10 @7`, `4x4 70% of
  bench`, `5×3` and `5 x 3`. It fills set count, reps and load; only fields
  that change are sent. A load part goes through `splitReference`, so `of
  bench` still lands in the reference column. Plain `5` in sets is still 5.
- **Reliability fixes.** [Fact] Cells were keyed on their text, so any save
  that changed a neighbour (which shorthand does) remounted it and dropped the
  focus mid-Tab. Cells now keep their identity and take a new value only when
  not focused. Up/Down cross from one day card to the next; Enter on a day's
  last row goes to that day's "Add exercise" field (type, Enter, next line);
  picking a swapped exercise puts the focus back on its cell.

### 4. A context drawer

A collapsible panel beside the week (`Context` button in the week header;
open/closed remembered per browser). Read-only, built from existing reads:

- **Last logged week**, for the exercises on screen: the most recent Monday to
  Sunday with any working set of each, from `fetchRecentSessions` +
  `fetchSetsForSessions` (the reads Athlete View's sessions panel uses).
  Sets read `180 × 3 @8`, repeated sets collapse to `165 × 5 @7.5 ×3`.
- **Videos waiting**, from `fetchClips` minus this coach's
  `fetchReviewedSetIds` (the Review Queue's own reads), newest five, linking
  to the queue.

[Inference] "Flagged" has no column in the schema; the drawer shows
*unreviewed by you*, which is the queue's own definition. Decision for Joey.

Closed by default: at 1440 the athlete rail, the outline, a 46 rem grid and an
18 rem drawer do not fit side by side, and the grid matters more.

### 5. Duplicate week with a bump (built)

The week's ⋯ has `Duplicate with a bump…` beside the plain Duplicate: an
inline form taking `+ %`, `+ kg` and `+ RPE`, a preview of where the copy
lands ("Lands as Week 5, 3-9 Nov, at the end of Volume", and that later weeks
renumber) and the exact lines that change ("Squat: 75% → 77.5%"), before
anything is written. Pure rules in `lib/programming/bump.ts`.

Written as `duplicateWeek`, then one `updatePrescription` per changed line on
the copy, found by its place in the week (the copy is written day for day,
line for line; a line not where expected keeps its copied load and the editor
says so). Fixed loads take +kg, percentages +%, RPE +RPE, a cap both; RPE
stays on the 6-10 half-point scale; freeform is untouched; a step that would
take a load to nothing is not applied. The reference lift travels with the
copy as before (the bump only rewrites the load text).

## Deliberately not built

- Live-linked templates (the brief says no).
- Animation (a separate ticket).
- Anything on the athlete's phone.
- Editing in the drawer (logged work is the athlete's).
- An RPE-to-kilos estimate (above).
