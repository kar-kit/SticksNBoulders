## Order 24 — Coach roster dashboard

Ruairi's landing page, blueprint 10. A coach should walk in cold and know
within five seconds who needs attention. So there's a computed **Needs you**
list first, a dense sortable table under it (athlete / this week / videos /
bodyweight / block), and no charts. Clicking a row opens Athlete View.

**Source: Inferred, and blueprint 10 is a BLOCKED decision.** The triggers come
from Ruairi's complaints, not from watching him work. They all live in one
small module, `lib/coach/roster-triggers.ts`, as one function each, with every
threshold in `TRIGGER_RULES`. When he answers, the change is an edit there and
a test run.

### The triggers, all [Inference]

| Trigger | Rule as built | Live now? |
| --- | --- | --- |
| Unprompted RPE 10 | an RPE 10 where the prescription asked for less, in the last **7 days** | **no**, needs Order 19/22 |
| Missed sessions | **≥1** prescribed session this week whose day passed with nothing logged | **no**, needs Order 19 |
| Unreviewed videos | **≥1** clip this coach hasn't cleared, **any age**; links to the Review Queue | yes |
| No bodyweight | last weigh-in **>7 days** ago; an athlete who has **never** logged one fires once linked **>7 days** | yes |
| Weight-class drift near a meet | in the blueprint | **not built** |

On-screen order is unprompted max → missed sessions → videos → bodyweight,
then by name. The unprompted max goes first because it's the one Ruairi named.
An athlete whose circle the coach can't see yet fires nothing, because an empty
read there says nothing about the athlete.

### Questions for Ruairi

1. **Your review day, in order:** what do you check first, and is this list in
   the right order? (Blueprint question 2.)
2. **Videos:** does one unreviewed clip count as "needs you", or only clips
   that have waited a while (a day? two?)?
3. **Bodyweight:** is 7 days without a weigh-in the right gap? Should an
   athlete who has never weighed in be flagged, and after how long?
4. **RPE 10:** before programs exist in the app, should *any* RPE 10 be
   flagged, or only one that beats a prescription? How long should it stay up?
5. **Missed sessions:** is one missed session in a week worth a line, or only
   two or more?
6. **Next comp / weight class:** the blueprint wants a next-comp column and a
   drift-near-a-meet trigger. Neither has data until comp planning (Feb 2027).
   Do you need them at handover?

### The Order 19 seam

Order 19 is being built in parallel, so nothing here touches program tables.
`fetchProgramSignals` in `lib/coach/roster-store.ts` returns an empty map. The
two program triggers and the **Block** column already consume its
`ProgramSignals` shape (block label, missed sessions, recent unprompted RPE 10
sets), and both rules are unit-tested against it. Wiring Order 19 in means
filling in that one function, through the coach's session.

### Reads, permissions, rollups

- **Every read uses the coach's own session** through the athletes' circle
  teams. No server-key reads, no new tables, no writes. Nothing for the
  forged-owner audit to cover.
- **Sets this week come from `stats_rollups`**, never raw sets.
  **Sessions completed** are `sessions` rows (finished, this London week): one
  row per session, a count rather than a GROUP BY, and rollups don't carry it.
  The week boundary is `weekStart` from the rollups, so a 00:30 Monday BST
  session lands in the same week on both. Tested.
- **One query per table for every athlete** (`equal()` takes an array). The
  only per-athlete calls are the circle check and a "newest weigh-in ever"
  lookup for anyone with none in 21 days.
- **Reuses:** the Review Queue's clip/review reads, `canSeeCircle`,
  `fetchCoachLinks` + `subscribeToLinks`, `sameAthletes`, the bodyweight
  `trend`, `InviteCodePanel`, `DepartureNotice`.

### States

- **Empty account** (Ruairi's first session): "No athletes yet" with the invite
  code as its one action. No data reads fire.
- **Loading**, **couldn't load**, **linked athletes**, and **linked but not
  visible yet** each have their own state.
- **A revoked athlete** leaves the table and Needs you **live** via the link
  subscription. The session refreshes so the rail catches up, and the existing
  departure notice says someone left, without a name. `DepartureNotice` now
  takes the roster's link read as an optional prop instead of reading the table
  a second time.

### Small changes outside the screen

- `CoachLinkRecord` gets an optional `linkedAt`, used for the never-weighed-in
  grace period. `fetchCoachLinks` selects `linked_at`.
- `e2e:shell` scopes its "rail names the athlete" check to the rail, because
  the Roster table now names the athlete too and Playwright's strict mode saw
  two matches.

### Not in scope

- **No rail attention dot.** `CoachShell` has a `needsAttention` prop that
  nothing sets. Wiring it would mean running the roster reads on every coach
  screen. Easy to add if you want it.
- **No Next comp column, no weight-class trigger** (see question 6).
- **No coach-side "remove athlete".** Still [SME to confirm] from Order 16.5.

### Verification

`lint` · `typecheck` · **1585 tests, 99 files** (38 new unit tests for triggers,
rows and sorting; 12 screen-state tests; 2 for `DepartureNotice` taking records).

Live: `npm run e2e:roster` **23/23**. It covers the empty account with its
invite code, two linked athletes read entirely through the coach's session,
the week from the rollup, both live triggers, sorting, no horizontal scroll at
1280, a row opening Athlete View, a live unlink leaving the table with an
unnamed notice, and a stranger coach seeing nothing. Regressions re-run green:
`e2e:shell` 15/15, `e2e:unlink` 27/27, `e2e:invite` 17/17.

⚠️ **`npm run build` and Turbopack `next dev` can't run in this worktree**
because the symlinked `node_modules` points outside the filesystem root. The
e2e ran against `next dev --webpack -p 3124`. Worth a build on `dev` after
merge.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
