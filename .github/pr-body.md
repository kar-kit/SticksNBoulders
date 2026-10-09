## feat(editor): Calendar view of the program, beside the week view

**Stacks on the program-editor-outline PR** (`program-editor-outline`, bb823c5). Merge that first; this branch's diff against it is the calendar only.

RTS, TrueCoach and TrainHeroic all show a program as a dated calendar, and coaches think about the cycle in weeks and phases. The editor's outline only showed one week at a time. This adds a **Week | Calendar** toggle to the program header. It is the only new control there. Calendar view shows the whole program as dated weeks. Schema, ops, permissions and validation are unchanged.

### What changed

**1. The toggle and the URL.** The header gets a segmented control (the existing `components/ui/tabs.tsx`) beside Starts. The choice is stored as `?view=calendar` and written with `history.replaceState`, which Next 16 syncs with its router, so it survives a reload and can be linked without adding a history entry. Any other query (`week`, `day`, `line` from "Adjust program") stays as it was. The page reads the view server-side (`editorViewFrom` in `lib/coach/adjust-program.ts`, next to `landingFrom`). Templates have no dates, so they get no toggle and always open in the week view.

**2. The calendar** (`components/coach/program-calendar.tsx`). A Monday-first grid with one row per program week and one `<tbody>` band per block. The band shows the block name and its date range, and the separator between blocks is thicker. Each row header shows the week name, its dates and its state. The state uses the outline's own `weekState` + `StateMark` (draft / live / logged), now exported from `program-outline.tsx`. Every cell is dated from the same helpers the week view uses (`scheduledOnFor`, `placeDay`, `weekRange`, `blockRange`).

A scheduled day shows its title, its first 3 distinct exercises and "+N more", plus a tick and a green edge once logged. A top set and its backoffs count as one lift. Its accessible name reads like "Mon 5 Oct, Squat day: Squat, Bench Press, Deadlift, +1, logged".

A day dated outside its week, or not dated at all, is listed under its week's label rather than dropped.

**3. Click-through.** Clicking a day switches to Week view on that week, scrolls to the day and puts the keyboard on its first line. A day with no lines, or a read-only one, gets focus on the day itself. This reuses the existing landing effect, generalised from "once, from the URL" to "whenever a landing is pending and the week view is showing".

**4. "+ Day" on empty cells.** It appears on hover or focus and sends the existing `addDay` op with `scheduledOn = anchor + 7·week + weekday`. That is the date a weekday chip would store. The view stays on the calendar and the cell becomes the new day.

**5. No start date.** The calendar shows the same prompt as the week view. If nothing is dated, there is no grid. If some days are already dated, the anchor is counted back from them, as the week view already does.

**6. Read-only** for anyone but the program's coach. There is no "+ Day", days still open, and empty cells are focusable and say "no session".

**7. Accessibility.** The table has `role="grid"` with column headers (Week, Mon–Sun), row headers named like "Accumulation · Week 2, draft" and block row-group headers. There is one tab stop for the whole grid. Arrows walk the cells, Home and End jump to the ends of a row, and Enter activates.

**Nothing logged can move.** The calendar only reads, plus `addDay`. No existing day is redated.

### Layout choice

[Inference] In Calendar view the outline column is hidden. The calendar rows carry the same block, week and state information, and dropping the 224 px rail gives each day column about 145 px at the coach side's ~1200 px effective width. Without that, columns would be about 115 px, and three exercise names truncate badly at that width. The side effect is that "+ Week", "+ Block" and block renames are only available in Week view.

### Tests

- `components/coach/program-calendar.test.tsx`: 17 tests. They cover the toggle and URL param (other params kept), opening on `?view=calendar`, no toggle on templates, column and row headers with state, block bands with ranges, cell dates across weeks and blocks, summary truncation, logged and unlabelled days, off-week and undated days, arrow-key walking with a single tab stop, click-through (week, scroll, focus on the line or the day), "+ Day" dates in two blocks, "+ Day" only on empty cells, "+ Day" with no start date but dated days, read-only mode, and the no-start-date prompt.
- `lib/coach/adjust-program.test.ts`: `editorViewFrom`.
- Mutation-checked: each of 21 deliberate breaks across the editor, the calendar and the view parser fails at least one test.
- `scripts/e2e-calendar.mts` (`npm run e2e:calendar`) at 1440×900 covers `?view=calendar` and reload, the toggle writing and clearing the param, Monday-first headers, rows for both blocks, the summary with "+1 more", no horizontal scroll, click-through to the right week with focus inside the day, and "+ Day" on an empty cell. For "+ Day" it asserts both the stored `scheduled_on` and the cell turning into the new day. It writes the program through `program-fixtures.ts` ops and deletes only its own rows. **Not run yet.**

`npx vitest run` passes 2630 of 2630. `npx eslint .`, `npx next build --webpack` and `npx tsc --noEmit` are all clean.

### Check by eye

- Cell density at 1440 with the coach-side 1.2× zoom: whether three exercise lines plus the title read comfortably at about 145 px.
- Whether the hover-only "+ Day" is discoverable enough, or should show faintly at rest.
- Whether hiding the outline in Calendar view is right, or whether Joey wants it kept.
- The block band separator weight in dark mode.

### E2E

The Playwright scripts drive the real UI, so the ones that touched removed editor controls are moved onto the new accessible names (read from the components, not guessed). They have not been run against the live instance yet. Each one type-checks and lints.

- `e2e-program.mts`: tab "Week 1" becomes the outline button "Week 1, draft" (`aria-current`) and the heading "Block 1 · Week 1". "a new day is dated from the start date" now checks that the start weekday's chip is pressed and that the day shows today's date. "Publish" becomes **Publish week 1**, and Status reads "Live" with the outline showing "Week 1, live".
- `e2e-copy.mts`: Duplicate goes through the "Week 1 actions" ⋯ menu, and the new week is checked as the outline's current "Week 2, draft" plus the heading "Volume · Week 2". Copy to… goes through the "Program actions" ⋯ menu.
- `e2e-backoff.mts`, `e2e-video-required.mts`: **Publish week 1**, then Status "Live".
- Not changed, because none of them touch the editor: `e2e-my-program` (the athlete's own week list), `e2e-athlete-view`, `e2e-suggestions`, `e2e-roster`, `e2e-shell` (only follows the Programs link).

New: `npm run e2e:editor` (`scripts/e2e-editor.mts`, default `http://localhost:3100`, coach at 1440×900, throwaway users with `presetMode`). It covers:

- The outline shows the block, Week 1 as draft and selected, and the week's date range.
- Weekday chips date the day from the start date, a different chip moves it, and `scheduled_on` matches in the rows.
- "+ Week" opens Week 2 with week 1's line in it, stored a week on.
- Week selection works by click, and by Down/Up then Enter (focus checked).
- A block can be renamed inline, then named "Intensity" from the block ⋯.
- "+ Block" opens Block 2 / Week 3, copied from week 2 and a week on.
- Moving the start date a week later moves every unlogged day by a week, and moving it back restores them.
- **Publish week 1**: outline "live", Status "Live", "2 draft weeks" count, rows published. The athlete sees the day on Today. Unpublish puts it back to draft.
- Week ⋯ Duplicate (appended as Week 3, next block's week becomes Week 4) and Remove with its confirm. Day ⋯ Remove Day 2 with confirm.
- Program ⋯ Copy to… opens and closes the form. "Publish all draft weeks" publishes every week, and no draft is left in the outline.
- At 1440 the coach zoom causes no horizontal page scroll. This check only runs once `coach-scale` is in `app/globals.css`; it is skipped on this branch.


### E2E run (live instance, Turbopack dev server)
- `e2e:editor` 45/45, `e2e:program` 31/31, `e2e:copy` 22/22, `e2e:backoff` 15/15.
- `e2e:video-required` 16/18: the two failures ("the toggle starts off", "ArrowRight from the Note cell lands on the toggle") fail identically on unmodified `dev`, so they predate this PR. This PR fixes its third failure (two "Publish" buttons).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
