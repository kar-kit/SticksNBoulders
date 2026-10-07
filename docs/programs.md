# Programs

_Orders 19 (Program Editor) and 22 (prescribed session in the logger). Phase 2a._

## Shape of the data

Five tables, one per level: `programs` → `program_blocks` → `program_weeks` →
`program_days` → `prescriptions`. Every child row carries `program_id`,
`coach_id` and `athlete_id`, copied from the program by the server, because
Appwrite cannot join and the permission stamp needs both ids without a read.

**It does not hard-code block-up-front.** [Fact] The blocked decision with
Ruairi (question 1: block up front, week by week, or session by session) is a
UI question over these rows, not a migration:

- Weeks and days are added one at a time (`addWeek`, `addDay`). Nothing
  requires a block to be complete before it is published.
- Each day carries its own `scheduled_on`. A block written in October, a week
  written on Sunday and a session written the night before are the same row.
- Each week carries its own `status`. `publishProgram` publishes every week
  (the block-up-front button); `publishWeek {weekId}` publishes one (the
  week-by-week button) and takes the program live with it if it is still a
  draft, because a published week under a draft program reaches nobody.
  `updateWeek {status: "draft"}` pulls a week back; the program stays
  published, so the other weeks are untouched. Both are buttons beside the week
  tabs in the editor. Today shows a day only when its program **and** its week
  are published. [Fact] Server and write helper impose no published-to-draft
  rule: `updateWeek` takes either status and `updateProgramWeek` passes it
  through (`program-admin.test.ts`).
- A program with `athlete_id` null is a template. Templates are not exposed in
  the UI ([SME to confirm] question 6/7: does Ruairi reuse skeletons?).

## Who can do what

All five tables have `rowSecurity: true` and **no table-level permissions**: no
client, signed in or not, can create, update or delete a row. Every write goes
through `POST /api/program` (`app/api/program/route.ts`):

1. The caller is whoever a verified Appwrite JWT says. No id in the body is
   trusted.
2. `appwrite/documents/program-admin.ts` checks the caller is the program's
   coach **and** still has an `active` row in `coach_athlete_links` for its
   athlete (a coach programming themselves needs no link).
3. A child's program, coach and athlete are read from its parent row, never
   taken from the request, so a request cannot graft a day onto someone
   else's week.
4. The rows are written with the API key through `program-write.ts`, which
   stamps `programPermissions`.

This is why the tables are not vulnerable to forged owner fields: there is no
client write path to forge them on. [Fact] `scripts/e2e-program.mts` asserts a
direct `createRow` on `program_days` by a signed-in user is refused, and that a
stranger's `createProgram` naming the athlete is a 403.

`programPermissions` grants **read** only: the coach, the athlete, and the
athlete's circle team (so a second coach at the gym sees the program the
athlete is on). The coach's read survives a revoked link (their own work
product); their writes do not.

Draft vs published is **not** a permission. [Inference] Hiding drafts from the
athlete by permission would mean re-stamping every row on publish — hundreds of
writes, any of which can fail halfway — to hide the athlete's own program from
the athlete. The read path filters on status instead. An athlete reading the
raw API can see a draft of their own program; nobody else can.

## Logged work is immutable; prescriptions are not

- Program writes never touch `sessions` or `sets` (asserted in
  `program-admin.test.ts`).
- A logged set stores `prescription_id` (a pointer) and `prescribed` (a text
  snapshot of the target at the moment of logging). Editing or deleting the
  line later changes neither. [Fact] The e2e edits the line after a set is
  logged and asserts the set is unchanged.
- A session stores `program_day_id`. Removing that day leaves the session and
  its sets intact; the logger simply stops showing targets for it.
- Edits to a **published** week are live on save; there is no second draft
  layer for edits. The way to edit without the athlete seeing a half-changed
  day is to **Unpublish** the week (back to draft), edit, then **Publish** it
  again. Rows are neither removed nor re-stamped; only `status` changes, so the
  athlete's read path stops returning the week (My Program and Today) until it
  is republished. [Inference] The blueprint's "publishing mid-block updates
  future days only" is satisfied for logged work (snapshots).
- **A session already started keeps its targets.** [Fact] The logger asks for
  its day by id (`fetchPrescribedDayById`) with no published check, so
  unpublishing the week under an athlete mid-session changes nothing on their
  screen (`prescribed-day.test.ts`). A device that reloads the program picks up
  the coach's current lines for that day, as it does after any live edit.
  [Inference] A session not yet started from that week simply does not find it
  on Today.
- Publishing and unpublishing a week never read or write `sessions` or `sets`
  (asserted in `program-admin.test.ts`, with a logged set and its snapshot left
  unchanged).

## Variations

A variation is its own exercise (Order 18). Typed into the editor, a name the
library lacks is created in the **athlete's** library (`createExercise` op), so
the athlete can read it, log it and hold a max for it. Lines are refused for an
exercise the athlete cannot read (a coach's private custom row would reach
Today with no name).

## In the logger (Order 22)

`lib/programming/session-plan.ts` expands lines into per-set targets, resolves
percentages against the athlete's reference maxes, and re-prices them off
today's top set once it is logged (as a suggestion, not the coach's number).
`prescribeNewRows` stamps each new planned row with the target of the set it
will be, counted in working sets; rows already on screen are never re-priced
under the athlete's thumb.

## Duplicate week and copy program (Order 20)

_Source: Inferred. P1._ Two ops on `POST /api/program`, both server-only:

- **`duplicateWeek {weekId}`** appends a copy of the week to its own block as
  a **draft**: every day (label, notes) and every line. Days move to the week
  after the block's last week -- `7 × (weeks in block − source index)` days,
  which is 7 when the last week is duplicated. [Inference] Duplicating week 1
  of 4 lands the copy a week after week 4, not on top of week 2. The label is
  not copied (two tabs called "Heavy" read worse than "Week 5"). [Inference]
- **`copyProgram {programId, athleteId, blockId?, name?, startOn?}`** copies
  a whole program, or one block, to a linked athlete or to the coach
  themselves as a new **draft** program, every week a draft. Omitting
  `startOn` keeps the source's dates; giving one moves every day by the gap
  from the source's start (whole program) or the block's first dated day.

**Authorisation.** The caller must be able to edit the source (its coach,
still actively linked to its athlete) **and** program for the target (an
active link, or themselves). A refusal is found before any row is written.

**Percentages stay percentages.** Lines are copied as typed: `75%` on a copy is
75% of the *target's* max for that exercise, resolved when they log it. Fixed
kilos (`142.5`) are copied as written -- the coach typed them, for someone
else; the copy is a draft so they read it before publishing. [Inference]

**Exercises are re-resolved in the target's library.** Global stays global; a
variation in the source athlete's library is found by name in the target's
(global first, then theirs) or created there through the same
`createExercise` path the editor uses. A line whose exercise no longer exists
refuses the copy rather than dropping the line.

**Lines are copied generically.** `copyPrescription` copies every stored column
except Appwrite's (`$…`) and placement (scope, parents, exercise, position,
derived `load_kind`, `updated_at`) -- see `lineContent` in `program-write.ts`.
Order 30's `video_required`, and whatever Order 21 adds, travel without
changes. **A new column holding a row id must be added to `LINE_PLACEMENT` and
remapped**, or the copy points at the source's rows.

Neither op reads or writes `sessions` or `sets`. A copy that fails halfway
leaves a draft week, or a draft program only the coach sees -- never half a
block on Today. Templates and bulk percentage shifting are deliberately not
built.

## Seams for what comes next

- **Backoff rules (21), built:** see below.
- **Video required (30), built:** see below.
- **My Program (23) is built**, see below.

## Video required (Order 30)

`prescriptions.video_required` (boolean, null on older rows reads as false) is
a checkbox column on the grid: arrow onto it, Space flips it, and the write is
the same one-field `updatePrescription` as every other cell, so it is server-
only like the rest. In Log Session it is a **nudge, never a gate**
(`lib/logging/video-prompt.ts`): the exercise's camera button is emphasised
while the flagged line's sets are to do, and one status line appears once they
are logged with no clip on any set of that exercise. "Not now" only puts the
line away; nothing is recorded and nothing blocks a set or the session.

[Inference] The Build Plan's section 5 wording ("refuses to quietly complete
without a clip or an explicit skip") is deliberately not implemented: the
Order 30 brief and constraint 4 (offline is normal, no blocking) outrank it.
The existing `videoRequired` flag on `LoggableSet` (which does block confirm)
is left unfed from prescriptions, so the logger never gates.

## Backoff rules (Order 21)

_Source: Inferred. Every formula below is [Inference] until Ruairi confirms._

A line can carry a backoff rule in its **Backoff** cell (after Note). The rule
is the coach's, executed on the phone against the top set the athlete
**actually logged** for that line today -- never a prescribed or stored number,
and never generated. Stored as canonical text in the optional
`prescriptions.backoff` column (40 chars), validated by `lineFields` and
normalised by the write helper. Unlike the load cell there is no freeform
fallback: a rule that does not parse is refused on the cell and by the route.

| Typed | Canonical | Means |
| --- | --- | --- |
| `3 x 90%`, `3x-10%`, `90% x 3` | `3 x 90%` | 3 sets at 90% of the top set's load |
| `-5% until @9` | `-5% until @9` | top set load −5%, repeat until a set is logged at RPE ≥ 9 |
| `repeat until @9`, `same to rpe 9` | `repeat until @9` | the top set's load again, until RPE ≥ 9 |
| `... max 4` | `... max 4` | cap the run (default 5) |

- **Top set** = the heaviest non-warm-up set logged against the line's own set
  slots (tie: the later one). Warm-ups never fill a slot or count.
- **Load** = `roundToLoadable(top × percent)` or `roundToLoadable(top × (1 − drop))`
  -- Order 18's round-down-to-2.5kg, not a copy of it. 100% / `repeat` keep the
  top set's exact load (it is already on the bar).
- **No top set yet** = no load. The athlete reads "90% of top set"; the row
  falls back to repeating, as for an unresolved percentage.
- **Run length**: a percent rule is N slots. A drop rule grows one slot at a
  time; the set that reaches the stop RPE ends it; a set logged without RPE
  cannot end it; the cap ends it regardless.
- In the logger (`targetsFor`), backoff slots follow the line's own sets and
  carry `backoff: { rule, topSet }`. New rows get the load as the coach's
  number (prefill rule 1) with the note "backoff from top set 185 × 3";
  `setTargetFor` keeps them away from the suggestion engine. Rows already on
  screen are never re-priced -- a row planned with Add set *before* the top
  set was logged keeps its repeated load.
- Copies (Order 20) carry the rule: it is text on the line, not a row id.
- `videoAsk` (Order 30) counts backoff slots as positions.

`scripts/e2e-backoff.mts` proves it against the live instance, including the
prefill with the phone offline.


## My Program (Order 23)

`/today/program`, linked from a row on Today that exists only when the athlete
has an active coach link. Read-only: weeks collapse with the current one open,
a day opens to its lines (the same `planDay` / `targetsFor` / `lineSummaries`
Today uses, so 75% is already kilos), and Start goes through `start({
programDayId })` like Today's. A done day links to its logged session instead.

- **Read path.** `fetchMyProgram` (`program-store.ts`) reads the athlete's
  published programs, then their weeks, and asks for days and lines only for
  the **published** weeks (`week_id IN`, covered by existing indexes). Draft
  rows never leave Appwrite for this caller. `visibleProgram`
  (`my-program.ts`) filters again on the way out, so a changed query cannot
  start leaking. [Fact] `e2e:my-program` asserts on the wire that no response
  contains a draft week's days or lines, and that the device cache holds none.
  The limit from above still stands: an athlete calling the raw API sees their
  own drafts. This is a filter, not a permission.
- **Day state** is derived from the athlete's sessions (`programDayId` on a
  finished session = done). Missed is only claimed when the loaded sessions
  (newest 25) reach back to that date and the list actually loaded; otherwise
  the day carries no label. [Inference] Better silent than wrong offline.
- **Offline.** The last tree and the athlete's maxes sit in localStorage
  (`snb.my-program`, scoped to the athlete). Cache paints first, the network
  refreshes behind it, a failed refresh changes nothing, and an unpublished
  program clears it. First-ever load with no signal says "Program not loaded".
- **No coach.** Today has no entry. A typed URL shows "No coach linked", with
  no action.
- **Not built:** the "prescription revised" mark on a logged day the coach has
  since edited, and "whatever's written next" on a finished block. A done day
  shows the line as the coach has it now and says the log is unchanged.
