## test: kill the pure-logic critical survivors from the 9 Oct test audit

The 9 Oct mutation audit (coach.md, athlete.md) listed critical survivors: deliberate bugs the suite let through. This PR closes the ones in pure logic and screen glue. Queue, storage, video and Appwrite store survivors are out of scope because other branches own them.

**No production code changed.** Every gap turned out to be a missing test, not a live bug. The code already does the right thing in each case. The suite just could not tell if it stopped.

### Changes

| Audit ID | Where | What the new test pins |
|---|---|---|
| S20 | `lib/programming/session-plan.test.ts` | A row the athlete typed into (150 × 4) is not re-priced when a new row is planned beside it. The new row still gets set 2 of the 3 × 5. The old "never touches a row already on screen" test only hit the all-seen early return. |
| CM2, CM1 | `components/coach/current-maxes.test.tsx` | A future "Takes effect from" date (19 Oct, still BST) is sent as local midnight. The default date is today's *local* date at 00:30 BST (23:30 UTC). |
| K12 | `lib/strength/rollup.test.ts` | Singles-only, doubles (190 × 2 beats 190 × 1), a single next to a five, and a mixed 1/2/3/5 week with a warm-up. Exact set count, volume, tonnage and every best, in either order. |
| Z03, Z04 | `lift-screen.test.tsx` | All-time PRs come from a week 40 weeks back, under 12w and 8w alike. A heavy double renders "200 × 2", not "× 1". |
| Z05 | new `components/strength/dots-block.test.tsx` | The rendered score (412.3), the breakdown, the stale-bodyweight date line, the athlete and coach empty-state wording, and the silent failure. |
| G13, G13b | `program-editor.test.tsx` | The × on line 2 sends `removePrescription` for `l2` and nothing else. A non-coach sees no × at all. |
| X01 | `session-context.test.tsx` | Start → finish → start uses a new client session id. |
| Z02 | `session-detail.test.tsx` | A History edit passes the set's own `loggedAt`, so the right week's rollup refreshes. |

### Testing

- `npm test`: 170 files, 2645 tests, all green.
- `npm run lint`: clean. `npx next typegen && npx tsc --noEmit`: clean.
- **Mutation-checked.** Each mutation was applied to the source and run against its suite, then reverted. Survivors before vs after:

| Mutation | Before | After |
|---|---|---|
| S20: per-row `seen.has` guard removed | survived | killed |
| K12: working sets filter `reps > 1` | survived | killed |
| K12: singles excluded from tonnage | survived | killed |
| K12: singles excluded from heaviest set | survived | killed |
| K12: singles excluded from best e1RM | survived | killed |
| K12: rep-record tie ignores singles | survived | killed |
| CM2: `effectiveFrom = undefined` | survived | killed |
| CM1: `Date.UTC` instead of local midnight | survived | killed |
| Default date a day early | survived | killed |
| G13: × sends `lines[0].id` | survived | killed |
| G13b: × shown to a non-coach | survived | killed |
| X01: `pendingClientId` not cleared | survived | killed |
| Z03: PRs from the 8w range only | survived | killed |
| Z04: heaviest set always "× 1" | survived | killed |
| Z05: score displayed 1% high | survived (audit, full suite) | killed |
| Z02: History edit sends `new Date()` | survived | killed |

16/16 survivors are now killed. The CM1 kill depends on the host clock being in London. Under `TZ=UTC` that mutation is equivalent, because the vitest config does not pin `TZ` (audit Q1).

### Decisions for Joey

1. **The heaviest-single tie across weeks (`lift.test.ts:119`) is left as it is.** Within one week, `rollupFrom` breaks a tie on more reps (140 × 5 beats 140 × 3). Across weeks, `personalRecords` keeps whichever tied week comes first in the list. So the all-time record depends on list order and can show 140 × 3 after a 140 × 5 week. Pick one rule and the test flips with it.
2. **Pin `TZ` in `vitest.config.mts`.** Without it, the BST cases here (and CM1's kill) only bite on a London-time host. This is likely in the scope of whichever branch takes audit Q1.
3. **Out of scope here, still open:** S6/S7 (`program-store`), U03, L02, C02, C07, I01, Z13, S03 (queue, storage and stores). Other branches own these.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
