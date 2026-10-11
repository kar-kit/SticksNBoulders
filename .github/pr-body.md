## fix: close program-store and backup-driver test gaps (audit 2026-10-09)

Follows the 9 Oct unit-test audit (coach S6/S7/S7b/S7c, backend BD1 to BD5). Two of the gaps hid real bugs; the rest were correct code with nothing proving it.

### Summary

- **Program store:** the reads already page on a `$id` cursor and refusals already throw. The audit's S6/S7 were surviving mutants, not live bugs. This adds the tests so they stay that way.
- **History set read (real bug):** `fetchSetsForSessions` read up to 25 sessions' sets in one 500-row page. At ~30 sets per powerlifting session with warm-ups, a beta athlete passes 500 within a few weeks, and History and the coach's Athlete View silently dropped whatever fell past it. It now pages.
- **Backup driver (real bug):** a blocked user could come back active after a retried restore. `ensureUser` now re-blocks on a 409 too.

### Changes

1. `lib/programming/program-store.test.ts` (new, 7 tests). This runs against the query-applying `FakeTables`:
   - a 12-week block (12 × 4 × 6 = 288 lines) reads whole, over three pages with the right cursors
   - `fetchLoggedDayIds` finds a day past row 300 and ignores another athlete's session
   - `sendProgramOp` throws the server's `error` on 403, its `reason` on 400, and the status on a 500 with no readable body
   - an invalid op makes no request
   - success returns the row id, sent with the JWT
2. `lib/logging/history-store.ts`: `fetchSetsForSessions` pages with `orderAsc($id)` + `cursorAfter`, 500 rows per page. Test in `lib/logging/history-store.test.ts` (new): 25 sessions × 30 sets = 750 rows all return.
3. `scripts/backup-driver.ts`: a restore stops at its first error (`restore.ts` awaits each user in turn). If a run died after `users.create` and before `updateStatus(false)`, the re-run got a 409, reported "existed", and left the account open. `ensureUser` now passes a re-block as the 409 handler when the dump says the user was blocked. It only ever re-blocks: an existing account is never unblocked, and prefs, labels and verification still apply to new accounts only.
4. `scripts/backup-driver.test.ts` (new, 11 tests, SDK fakes):
   - dump keeps `$permissions` and puts only non-`$` fields in `data`
   - cursor, `$id` order and `ttl: 0` on rows, users and teams
   - a blocked user is dumped as blocked, with providers deduplicated and no password hash
   - `putRow` replays id, data and permissions
   - only a 409 counts as existed; 500, 401 and network errors rethrow
   - `ensureUser` re-blocks on create and on 409, and fails a user with no email
   - membership roles go through, and a non-409 rethrows

### Other list reads checked

Every other cursor loop in `lib/` and `appwrite/documents/program-admin.ts` (audit G08) is correct. The single-page reads that remain are bounded per session, per week or per coach (`fetchSessionSets` at 100/200, rollup rebuild at 200 sets per lift per week, coach links at 100), and a 5-athlete beta stays well inside those limits.

### Testing

- Each new test was mutation-checked. Program store: 6/6 killed. History: 4/5, and the survivor (`PAGE = 1000`) is equivalent. Backup driver: 12/12, including all five audit mutants, BD1 to BD5.
- The history and backup tests failed before their fixes (500 of 750 rows; `updateStatus` called 0 times).
- `npm test`: 172 files, 2651 tests pass. `npm run lint` and `npx tsc --noEmit` are clean.
- No live-instance scripts were run.

### Decisions for Joey

- **Re-block on 409.** A restore into a live instance where an admin has unblocked someone since the dump will block them again. I chose that over the opposite risk, which is a banned account reopening silently. Say if you'd rather it only warn.
- **A 409 on `users.create` can also mean a different account already holds that email** (`user_email_already_exists`). Today that reports "existed" even though the dumped user id doesn't exist, so their rows' permissions point at nobody. This PR doesn't fix it. A follow-up could confirm with `users.get(userId)` on a 409. [Unverified] I haven't checked which 409 type Appwrite 1.8 returns for an email clash.
- **`fetchAthleteNames` uses `limit(athleteIds.length)` and filters forgeries afterwards.** A forged profile row for an athlete could push out the real one, and that athlete would lose their name in the rail. This is a provenance issue rather than truncation, so it's out of scope here.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
