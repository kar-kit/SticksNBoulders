## Orders 19 + 22 — Program editor and prescribed sessions

A coach writes a block in a keyboard-first grid; the linked athlete sees that
day on Today with percentages already in kilos, starts it, and logs against
targets that prefill the set row. Includes a merge of `dev` (64fa6a9, PRs
#31–#35, #37) with conflicts resolved by keeping both sides.

### The blocked decision, and what this assumes on Ruairi's behalf

**[SME to confirm] question 1 — block up front, week by week, or session by
session.** The editor UI follows the blueprint's block-up-front layout (week
tabs across, days down, one Publish for the block). **The data model does not
hard-code it** [Fact, see `docs/programs.md`]:

- weeks and days are added one at a time; nothing requires a complete block;
- every day carries its own date, so a block written in October, a week written
  on Sunday and a session written the night before are the same row;
- every week carries its own draft/published status: `publishProgram` publishes
  the lot, `updateWeek` publishes one week.

If Ruairi writes week by week, the change is UI (a per-week Publish), not a
migration. Templates exist in the tables (program with no athlete) but are not
exposed — question 6/7 is still open.

Other assumptions made, each reversible:

- **[Inference]** New lines start at 1 set, no reps, no load — no invented
  defaults in somebody's training.
- **[Inference]** Edits to a published program are live on save; there is no
  second draft layer for edits. Logged work is safe regardless (snapshots), but
  a coach mid-edit can briefly show a half-changed day.
- **[Inference]** New days default to the day after the week's last dated day,
  or the start date + 7 per week. Always editable.
- **[Inference]** A coach can program themselves ("Yourself" in Programs).

### What's built

**Order 19 — Program Editor** (`/coach/programs`, `/coach/programs/[id]`)
- Programs index: every linked athlete plus the coach; New block creates
  program + first block + first week and opens the editor.
- Grid: exercise / sets / reps / load / rest / note. Arrows move between cells
  (sideways only from a cell's edge, so the caret still works inside `75% @8`),
  Enter commits and moves down, Escape reverts, Alt+Up/Down reorders a line.
- **The load cell indicator Order 18 owed**: each load shows what it parsed
  as — "Percent · 75% of training max", "RPE 8 · athlete picks the weight",
  "Freeform · shown as written" — which is the only thing that catches a bare
  `8` meant as RPE.
- Exercises are typed, never picked from a list. A variation the library lacks
  is created **in the athlete's library**, because a coach-owned custom
  exercise is unreadable on the athlete's Today.
- Cells save on blur, only the edited field, optimistically; a refusal puts the
  cell back and says why on the cell. Removing a day/week asks once, inline.
- Read-only for anyone but the program's coach.

**Order 22 — Prescribed session**
- Today: preview card with each line resolved against reference maxes, the
  coach's note under it, Start today's session + Log something else.
- Log Session: prescribed exercises lead in the coach's order, target lines
  above the rows, first exercise opens with set 1 already holding the target.
  Every new planned row (dev's multi-row planner from #37) gets the target for
  the set it will be, counted in working sets; rows already on screen are
  never re-priced. Sets store `prescription_id` and a text snapshot; sessions
  store `program_day_id`.

**Server ops added on top of the 27 Sep WIP**: `publishProgram`,
`removeBlock/Week/Day` (children first), `createExercise` (athlete-owned,
deduped), and lines refused for an exercise the athlete cannot read.

### What's stubbed or out of scope (seams left)

- Duplicate week (20), backoff rules (21), My Program (23), video-required (30):
  not built. `docs/programs.md` § Seams says where each plugs in.
- Copy/paste of rows, multi-select percentage shift, block-level undo: not
  built (blueprint bulk-editing beyond duplicate week).
- Athlete View's "This block" panel now points to Programs; tracking against
  the block is not built.
- Template UI.

### Security — rules the new tables need

`appwrite/audit/rules.ts` is not on this base (it's on PR #36), so here are the
rules to add there. All five tables: `rowSecurity: true`, **no table-level
permissions**, so no client can create, update or delete. Writes only via
`POST /api/program` (verified JWT → caller must be the program's coach with an
`active` `coach_athlete_links` row for its athlete; child scope read from the
parent row, never the request).

| Table | Read | Create | Update | Delete | Owner columns |
| --- | --- | --- | --- | --- | --- |
| `programs` | coach, athlete, athlete's circle team (template: coach only) | server only | server only | none (archive) | `coach_id`, `athlete_id` (nullable = template) |
| `program_blocks` | same | server only | server only | server only (cascade) | `coach_id`, `athlete_id`, `program_id` |
| `program_weeks` | same | server only | server only | server only (cascade) | `coach_id`, `athlete_id`, `program_id`, `block_id` |
| `program_days` | same | server only | server only | server only (cascade) | `coach_id`, `athlete_id`, `program_id`, `week_id` |
| `prescriptions` | same | server only | server only | server only | `coach_id`, `athlete_id`, `program_id`, `day_id` |

Audit assertions worth encoding: every row's `$permissions` contains only
`read(...)` grants; `coach_id`/`athlete_id` on each child equal its program's;
read set = {`user:coach_id`, `user:athlete_id`, `team:circle-<athlete_id>`}.

New columns on existing tables (athlete-written): `sessions.program_day_id`,
`sets.prescription_id`, `sets.prescribed`. These are pointers/snapshots on the
athlete's own rows; a forged value only mislabels the athlete's own set. **[Inference]**
No new audit rule needed beyond the existing owner checks PR #36 adds.

Also: `createExercise` creates an `exercises` row owned by the athlete via the
server — same stamp as an athlete creating it mid-session.

### Schema

v9, already applied to the live instance (`npm run appwrite:setup` reports
"Schema already matches"). It flags one orphan column,
`coach_athlete_links.suggestions_mode`, which belongs to Order 28's in-progress
branch — not this PR, left alone.

### Tests

- `npx tsc --noEmit -p .` clean, `npm run lint` clean.
- Vitest: **103 files, 1692 tests passing**. New: `lib/programming/editor.test.ts`
  (25), `components/coach/program-editor.test.tsx` (11),
  `components/coach/program-list.test.tsx` (4), prescribed-row tests in
  `session-plan.test.ts` and `log-screen.test.tsx`, server-op tests in
  `program-admin.test.ts` (35 total).
- `npm run e2e:program` against the live instance: **29/29**. Coach writes and
  publishes a day in the editor; an unlinked user cannot list or read it, write
  through the route, forge a program for the athlete, or write a program table
  directly; the athlete sees it on Today in kilos, starts it, logs the
  prefilled set with prescription id and snapshot; a later coach edit leaves the
  set untouched.
- **[Unverified]** `components/coach/review-queue.test.tsx` ("drops an
  athlete's clips live when they unlink") failed once under full-suite load and
  passed on every rerun — timing-sensitive, came in from dev.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
