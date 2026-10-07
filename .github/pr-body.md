## feat(editor): program outline, one publish, dates from the start date

The Program Editor had buttons everywhere: block tabs, week tabs, "+ Week", "Duplicate week N", "Publish week N" and "Remove week N" in one row, a second Publish in the header, a date picker on every day plus the program's start date, and blocks that meant nothing. This rebuilds the layout around the shape Ruairi actually writes in (a mix of block-up-front and week-at-a-time) without touching the schema, the ops, permissions or validation.

### What changed

**1. Outline column** (`components/coach/program-outline.tsx`). Replaces both tab rows. Between the athlete rail and the week: each block with its name (rename inline), its date range, and its weeks. Each week shows its dates and a state: **Draft**, **Live** (week and program published) or **Logged** (an athlete has started a session from one of its days). Logged comes from `sessions.program_day_id`, read once on the `athlete_id` index, the same column the roster reads. If that read fails, nothing is marked logged. Up/Down walks every week, with one tab stop for the whole list. A block's ⋯ offers Accumulation / Intensity / Peak / Taper / Deload as one-click names, plus Remove (confirmed). The phase is the name, so there is no schema change.

**2. "+ Week" and "+ Block" copy by default.** "+ Week" at the end of a block is `duplicateWeek` on that block's **last** week; an empty block gets `addWeek`. "+ Block" adds a block whose first week copies the program's last week, a week later. `duplicateWeek` only appends within its own block, so this is written with the ordinary `addBlock` / `addWeek` / `addDay` / `addPrescription` ops (`copyWeekPlan`, a pure function in `lib/programming/copy.ts`). No new server path: it goes through the same validation and permission checks as typing it in by hand.

**3. One primary button at a time.** The week header is "Block 2 · Week 3", its dates and state, then **Publish week N** (primary) or **Unpublish week N** (secondary, when live), and a ⋯ with Duplicate and Remove (confirmed). The program header holds the name, athlete · status, Starts and a ⋯ with **Copy to…** (the existing form, now openable from the menu) and **Publish all draft weeks** (`publishProgram`). A day's ⋯ sits next to its title and holds Remove day. The menu is a small accessible one built here (`components/ui/menu.tsx`): menu-button ARIA, arrows, Home/End, Escape returns focus, and Tab or an outside click closes it. No dependency added.

**4. Dates from the start date** (`lib/programming/calendar.ts`, pure, unit-tested). Week N is the Nth Monday-to-Sunday row from the start date's Monday. A day is a Mon–Sun chip, and `scheduled_on` = that Monday + 7·(N−1) + weekday. The per-day date pickers are gone.
- With no start date, the editor prompts for one. If days are already dated, the anchor is counted back from them, so the chips still work. If nothing is dated, the chips wait.
- A day dated outside its week shows "Tue 20 Oct · outside this week" with no chip pressed. It moves only when the coach picks a weekday.
- Changing the start date moves every day that sits in its week by whole weeks, keeping its weekday. Days an athlete has logged from, and days already outside their week, are not moved. If the sessions couldn't be read, only the start date is saved, and the editor says so.

**5. Nothing logged changes.** Every write is an existing program op, and none of them touch `sessions` or `sets` (asserted in `program-admin.test.ts`).

### The publish decision

[Fact] `publishWeek` already takes a draft program live with the week (`publishWeekOp` in `program-admin.ts`; `docs/programs.md`). A week published under a draft program reaches nobody, because `isLiveDay` needs both. So **Publish week N** alone always does the right thing, and the coach never needs a second publish to make a week reach Today. "Live" in the UI means week **and** program published. A week stored as published under a draft program therefore still shows Publish, and pressing it takes both live. Publishing every draft week at once moves into the program ⋯ for block-up-front writing.

### Skipped

- **Clear week.** There is no clear op. It would be a `removeDay` per day, and Remove week plus "+ Week" covers the same need.
- **Calendar month view.** This is the follow-up. `calendar.ts` already gives the Monday-aligned anchor, `weekRange`, `scheduledOnFor` and `placeDay`, so a month grid is a render over the same helpers.

### Check by eye

- Width at 1440 with the 1.2× coach zoom. The outline is 224px and the grid narrowed (exercise 192, load 192, backoff 144), but it scrolls sideways rather than squeezing if it still doesn't fit.
- The outline scrolls with the page rather than sticking, because a long program's outline is taller than the screen.
- A program starting mid-week: week 1's Monday chip is dated before the start. [Inference] This is deliberate, so a coach's "Monday squat" stays in one column.

### Tests

New tests cover outline selection and arrow keys, the week states, "+ Week" copying the last week, "+ Block" copying op for op (plus a blank block and a halfway failure), the single publish button and its Unpublish swap, the program/week/day/block ⋯ menus, chip → `scheduled_on`, off-week days, the start-date move (including logged days and an unreadable sessions read), and pure tests for the calendar, `copyWeekPlan` and `weekState`. Mutation spot-checks were run on 24 lines across the new code, and every mutation was caught.

- `npx vitest run`: 168 files, 2612 tests passed (was 166 / 2556).
- `npx eslint .`: clean.
- `npx next build --webpack`: passed. `npx tsc --noEmit` passed after it.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
