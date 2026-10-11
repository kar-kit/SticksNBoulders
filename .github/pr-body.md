## ci: GitHub Actions gate, plus the three flaky/zone-dependent test findings from the 2026-10-09 audit

Until now nothing ran `lint`, `typecheck` or the unit suite on a PR, so every merge (agent self-merges included) was ungated. This adds CI and fixes the three test-health findings that would have made it flaky: the forgot-form cooldown flake (F1), the order-dependent session-plan example (F2) and the zone-dependent fixtures (F3). Two of them turned out to be product bugs, not just test bugs.

### What changed

**1. CI** (`.github/workflows/ci.yml`). Runs on `pull_request` and on `push` to `dev`. No secrets.
- `check`: `npm ci` → `npm run lint` → `npm run typecheck` (`next typegen && tsc --noEmit`) → `npx vitest run`, with `TZ=Europe/London`.
- `test-timezones`: the same vitest run under `UTC`, `America/Los_Angeles` and `Pacific/Auckland` (matrix, `fail-fast: false`).
- Node comes from a new `.nvmrc` (`26`, matching local dev and `@types/node ^26`). `concurrency` cancels superseded runs on the same ref.
- `vitest.config.mts` now sets `process.env.TZ ||= "Europe/London"` before workers start, so a laptop run matches CI. An explicit `TZ=…` still wins, which is what the matrix and ad-hoc zone checks rely on.

**2. Forgot password: Resend was enabled for one frame (product bug, F1).** `forgot-form.tsx` set `sentAt`, then a passive effect set the cooldown, so the confirmation committed once with "Resend link" enabled and "You can ask for another one" showing. Under load the test caught that intermediate commit about 1 run in 8. The cooldown is now derived in render from `sentAt` and a `now` state set in the same batch, and the interval only runs while cooling.
- The test fakes only `Date`/`setInterval`/`clearInterval` (no `shouldAdvanceTime`) and moves the clock inside `act()`. That removes the forgot-form act() warnings (61 of the 67 per run).
- New regression test: a `MutationObserver` records any `disabled` attribute flip on the Resend button. It fails on the old component deterministically, not just under load. A second new test covers the cooldown restarting after a resend.

**3. session-plan example 3 was order-dependent (test bug, F2).** Fixture ids were `m${++seq}` from a module-level counter, and `currentMax` breaks same-date ties by string-comparing ids, so `"m10" < "m9"`. The product sort is correct: reference maxes are only written by `app/api/reference-max/route.ts` with `ID.unique()`, which is fixed-width hex and sorts in creation order (already covered by `reference-max.test.ts` with real-shaped ids). Fixtures now use zero-padded hex ids, and the counter resets per test. The seed from the audit (`1791579938182`) and four others pass.

**4. History week headings said Sunday west of Greenwich (product bug, F3).** `weekStart` returns the Monday as UTC midnight, and `weekLabel` formatted it with local getters, so in Los Angeles History read "Week of Sunday 30 Aug" for the week of Monday 31 Aug. New `calendarDayLabel` in `lib/logging/session.ts` reads UTC getters for calendar days held as UTC midnight. A new `groupByWeek` test checks the label end to end.

**5. Zone-independent fixtures (test bugs, F3).** `athlete-view.test.tsx` ("linked 2 Sep") and `feedback-screen.test.tsx` ("Sat 19 Sept") asserted a local day from a UTC instant, which is the next day in Auckland/Kiritimati. The components are right to show the viewer's local day. The fixtures now build those instants with local constructors.

**6. A DST test that can actually fail.** The old `daysBetween("2026-10-20", "2026-11-03") === 14 // BST ends 25 Oct` could not catch a DST bug: `daysBetween` parses at noon UTC and rounds, so the zone never mattered, and the case only crossed the autumn change forwards. A local-midnight-plus-`floor` mutant still passed it, even under London. The replacement walks ±10 days around both 2026 clock changes in London, Los Angeles and Auckland, in both directions. It switches the process into each zone and first asserts the change day really isn't 24 hours. The same mutant now fails in all three zones.

### Testing

- `npx vitest run`: 2,636/2,636 (2,630 before; +6 from the new tests and the 3-zone `it.each`). forgot-form now logs 0 act() warnings (61 before). 14 remain suite-wide: LogScreen 12, AthleteView 1, UserAvatar 1, all in files this PR doesn't touch.
- Once each under `TZ=UTC`, `Europe/London`, `America/Los_Angeles` and `Pacific/Auckland`: all pass. Before this branch, LA and Auckland each had one failure.
- `npm run lint` and `npm run typecheck`: clean.
- The workflow itself has **not run yet**. It runs on this PR.

**Run results (MacBook, Node 26.5.1):**

| Run | Result |
|---|---|
| 10× plain `npx vitest run` | 10/10 green |
| 4 zones (UTC, London, LA, Auckland), once each | 4/4 green |
| Full runs alongside 2 concurrent shuffled full-suite loops (3× load) | 8 of 9 green, and 12 of 17 load-loop runs green. **Every failure was outside the three audit findings**, listed below |

Under 3× load, none of the forgot-form, session-plan or zone tests failed. Failures that did show up, all pre-existing and in files this PR doesn't touch:
- `app/(athlete)/log/log-screen.test.tsx`: 5s timeouts in "types a weight and reps on the pad", "takes an RPE from the sheet", "does not reuse a set index…" and "adds a second row prefilled…" (6 occurrences in total). Also 2 assertion failures in "adds thirty seconds to the rest on each tap" (`3:00` expected): its comment says the clock hasn't moved, but `shouldAdvanceTime: true` lets real time run, so a slow click reads 2:59. Same pattern as F1.
- `components/coach/review-queue.test.tsx` › "leaves Enter on the focused Adjust program link…": "2 waiting" not found (1 occurrence).

CI runners don't run three suites at once, so I expect these to stay quiet in Actions [Inference]. The log-screen fix is to drop `shouldAdvanceTime` there the way this PR does for forgot-form, and to split the 1,381-line file (audit §4). That belongs in its own PR.

### Decisions for Joey

- **Make `Lint, typecheck, test` (and the three `Test (TZ=…)` legs, if you keep them) required checks on `dev` and `main`** in branch protection. Without that, CI reports but doesn't gate self-merges. This needs repo admin, so I left it alone.
- **`.github/pr-body.md` is not path-ignored.** Every PR rewrites it, but `paths-ignore` would skip the whole workflow on a PR that only touches that file. A skipped required check then sits at "pending" and blocks the merge. Lint and tsc don't read markdown, so it costs nothing to leave in.
- **The TZ matrix is 3 extra jobs** (about a minute each, [Inference] from local timings). Drop the `test-timezones` job if you'd rather keep CI lean; the London job alone still gates.
- **Explicit `TZ` overrides the London default** in `vitest.config.mts`. The stricter alternative is to force London always and use a separate variable for overrides. I went with the familiar `TZ=… npx vitest run`.
- Not done here (from the audit, separate PRs): the six other module-level id counters, a shuffled-order CI leg, coverage tooling. Also noticed: `lib/coach/link-status.ts` `shortDate` formats an instant with UTC getters while `lib/coach/athlete-view.ts` `shortDate` uses local ones. Worth a look; I didn't change it.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
