## Order 23 — My Program

Athlete, mobile, P1, source Joey. Page blueprint 06. A read-only view of the
athlete's current block at `/today/program`, reached from a row on Today that
exists only when a coach is linked.

### What it does

- Weeks collapse, the current one open (the week containing today, else the next,
  else the last). A day opens to its prescription: the same lines Today shows,
  percentages already in kilos against the current max, plus the coach's note.
- Day state: **Done** (links to the logged session), **In progress**, **Today**,
  **Missed**, or unlabelled for upcoming. A finished block says so with the
  count logged.
- **Start** reuses Today's path (`start({ programDayId })`, then `/log`). While a
  session is already running the button reads Resume, as on Today.
- Empty states: no coach ("No coach linked", no action, no upsell; Today has no
  entry at all), linked with nothing published ("No program yet"), and a first
  load with no signal and nothing cached ("Program not loaded").
- No new tables, no new write path. Reads reuse `fetchPrograms`, the per-table
  `listAll`, `session-plan` and the reference-max stores.

### Drafts

`fetchMyProgram` reads weeks first and asks for days and lines only for
**published** weeks, so a draft week's rows never leave Appwrite for this screen.
`visibleProgram` filters again on the way out, and the cache only ever holds its
output. [Fact] `e2e:my-program` checks this on the wire (no response body
contains a draft week's days or lines) and in `localStorage`. The existing caveat
in `docs/programs.md` stands: an athlete hitting the raw API can read their own
draft rows, because draft is a filter and not a permission.

### Offline

Stale-while-revalidate over a per-athlete localStorage entry (`snb.my-program`):
the last program paints immediately, the refresh runs behind it, and a failed
refresh changes nothing and says nothing. Maxes are cached with it so kilos stay
kilos. An unpublished program clears the cache.

### Decisions worth a look

- **[Inference]** Done/Missed come from the athlete's recent sessions
  (`programDayId`, newest 25). Missed is not claimed unless that list loaded and
  reaches back to the day; otherwise the day is unlabelled. Offline this means no
  "0 of N" and no wall of Missed.
- **[Inference]** The no-coach state exists as a screen (the brief asked for one)
  though the blueprint says the screen is absent. Today never links to it; only a
  typed URL or a stale tab lands there. Cheap to delete if Joey prefers a 404.

### Left out

- **"Prescription revised" mark** on a logged day the coach later edited. It needs
  each logged set's `prescribed` snapshot compared against the current line, which
  is a new read over `sets`; the brief said no new data paths. A done day shows
  the line as the coach has it now and says the log is unchanged. History itself is
  never rewritten.
- **"Whatever's written next"** on a finished block: nothing in the model says
  what comes next, so only the completion line is shown.
- Per-week unpublish-while-editing (still the open question from Order 19).

### Verification

- `npm run typecheck` and `npm run lint` clean.
- Vitest: **119 files, 1861 tests passing** after merging dev (Order 30). New: 39
  across `my-program.test.ts` (read rules, draft filtering, day state),
  `my-program-store.test.ts` (query shapes, draft filter holds even if queries are
  ignored), `use-my-program.test.ts` (offline, cache scoping, unpublish clears),
  `program-screen.test.tsx` (each state) and two Today tests.
- `npm run e2e:my-program` against the live instance: **26/26**. No coach; linked
  with nothing published; a block with two draft weeks (current week open, drafts
  absent, Done/Missed, kilos, link to logged session); drafts absent on the wire
  and in the cache; the coach publishes a draft week and it appears on next load,
  un-publishes it and it goes; viewing sends no write; offline reload shows the
  cached program with no error text; Start opens the logger on that day.
- Regression: `e2e:program` 31/31.

Run it: `next dev --webpack -p 3123`, then `E2E_BASE_URL=http://localhost:3123 npm run e2e:my-program`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
