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
  (the block-up-front button); `updateWeek {status: "published"}` publishes one
  (the week-by-week button). Today shows a day only when its program **and** its
  week are published.
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
- Edits to a **published** program are live on save. There is no second draft
  layer for edits yet. [Inference] The blueprint's "publishing mid-block updates
  future days only" is satisfied for logged work (snapshots), but a coach
  mid-edit can briefly show a half-changed day. If Ruairi edits live blocks
  heavily, a per-week "unpublish while editing" is the cheap fix.

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

## Seams for what comes next

- **Duplicate week (Order 20):** one more op in `lib/programming/program.ts` +
  `program-admin.ts` (copy a week's days and lines, shifting `scheduled_on` by
  7), and a button beside "+ Week".
- **Backoff rules (21):** new nullable columns on `prescriptions`, a field in
  `lineFields`, and a column after Notes in `COLUMNS` (`lib/programming/editor.ts`).
- **Video required (30), built:** see below.
- **My Program (23):** `fetchPrograms({ athleteId })` + `fetchProgramTree`
  already read through the athlete's own session; `targetsFor` resolves kilos.

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
