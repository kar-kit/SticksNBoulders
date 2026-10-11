## test(e2e): fix the stale suites, prune every table safely, scope the instance-wide jobs

Follows the e2e audit of 9 Oct 2026. Five failing checks in three suites were stale tests, not app bugs. Prune covered 7 of 18 tables and buckets, and missed every `@sticksnboulders.test` account. Two suites ran instance-wide `--yes` jobs against the live instance Joey trains on. This PR fixes all three problems. App code is untouched. `public/sw.js` and `e2e:pwa` are out of scope (another branch owns them).

### What changed

**1. Stale suites, updated to the current UI**

- **`e2e:my-program`**: "the new session points at that day" was a race. Start is local-first, and the row lands only after the queue drains (`ensureMyCircle`, then `createRow`). The script now asserts the device's active-session cache first, then polls Appwrite. The check is also stronger: there must be exactly one new session, linked to **Week 2 Day 1** (the day tapped). Before, any day of the block passed.
- **`e2e:athlete-view`**:
  - "No program yet" became a check on the **This block** region. Its *Adjust program* link must equal `adjustProgramHref(athleteId)`, and the section must contain no digits, which keeps the "no invented numbers" intent.
  - The revoked-link date is now checked against `notLinkedCopy({ kind: "left", revokedAt })`, the gate's own sentence. A copy change can't break the test, but a wrong or missing date still fails it.
- **`e2e:video-required`**:
  - Squat now starts **ticked**, because of its `video_default`. The script asserts the default on screen and on the stored row.
  - A Romanian Deadlift line must start unticked; the script then removes it again.
  - The keyboard walk is Note → Backoff → toggle, with focus asserted at each step.
  - Space turns the toggle **off** and then **on**, and the stored row is polled each way. The old "Space turns it on" passed only because the box was already on.
  - Missing seed data (Squat without `video_default`) now fails fast with a "run `exercises:seed`" message instead of a misleading FAIL.
- All three create their accounts inside `try`, so a setup throw still reaches `finally`.

**2. Prune: every table and bucket, under three locks** (`scripts/e2e-fixture-scope.ts`, `scripts/e2e-purge.ts`, `scripts/prune-e2e-fixtures.mts`)

Coverage now spans all 16 tables, reached through their person columns (`user_id`, `athlete_id`, `coach_id`, `owner_id`, `author_id`, `recorded_by`), plus both buckets. `set_videos` is reached through the `video_file_id` of a deletable set. `avatars` is reached through the owner's `<userId>_xxxxxxxx` namespace. A unit test fails if a table is ever added without a person column. Listing is cursor-paged, so the old silent 100-row cap is gone.

**3. Crash net for every suite** (`scripts/e2e-run.mts`)

`npm run e2e:*` now runs each script through a wrapper. The only exceptions are `prune` and `pwa`. The wrapper wraps `Users.create` in both node-appwrite builds (ESM and CJS) and records each fixture account the script creates. Then, in `finally` or on Ctrl-C, it purges just those accounts with the same locked purge. This covers the 10 suites that have no `try` at all and the ~20 that create users before theirs, without rewriting each one. Seven scripts set `process.exitCode` instead of calling `process.exit(1)`, so the net still runs.

**4. Instance-wide jobs, scoped**

- `e1rm:backfill` gains `--athlete <id>`, matching `rollups:rebuild`. `e2e:e1rm` now uses it. Before, its `--yes` run **rewrote `e1rm_kg` on every set on the instance**, real training included. Scoping also makes the counts exact: 5 sets, 1 to estimate, 1 to correct, 2 to clear, 1 already correct.
- `e2e:lift` passed `--yes` to `rollups:rebuild` with no `--athlete`, so it rebuilt and deleted every athlete's rollups. It now passes `--athlete`. `e2e:rollups` already did this.
- Both now wrap setup and checks in `try/finally`.

### Prune scoping: what can and cannot be deleted

A row or file is deleted only when all three locks open:

1. **Account.** The email must match `^[a-z0-9]+(-[a-z0-9]+)*-<13-digit stamp>@(example.com|sticksnboulders.test)$`. Both domains are reserved for testing by RFC 2606 and RFC 6761. The account's `$createdAt` must also fall within 24h of the stamp in the address. Names, labels and age alone are never treated as a signal. `joey@example.com`, `joey.pang-<stamp>@example.com`, subdomains, upper case and any other domain all fail (see the unit tests).
2. **Row.** Every person column on the row must be empty or a fixture id. A row that names a fixture coach and a real athlete is **reported as SKIPPED and left alone**. Global exercises are never matched, so exercises a fixture run created with no owner are left in place.
3. **Permissions.** Every specific principal the row or file grants (`user:`, `team:`, `member:`, `label:`) must be a fixture or a fixture's `circle_<id>` team. The generic roles `any`, `users` and `guests` are allowed because they name nobody. Anything unparseable fails the check.

Further guards:

- **Last-moment re-check.** The account's email is re-read from the server immediately before `users.delete`.
- **Accounts are kept** if anything of theirs was skipped or any call failed. The account is the only link from a stranded row back to a fixture.
- **Recent fixtures are left alone.** Prune skips fixtures younger than `--min-age-minutes` (default 120), so it can't delete another worktree's live run.
- **Mistyped flags are refused.** `--yse` does not quietly become a report-only run.
- **The crash net is narrower than prune.** It purges only ids this process created, and still requires a fixture email.

### Testing

- `npm run typecheck`: clean (it covers `scripts/**/*.mts`).
- `npm run lint`: clean.
- `npm test`: 2651 of 2655 pass on a full run. The 4 failures are outside this diff:
  - `guard.test.ts` failed first on a comment in `e2e-fixture-scope.ts` that looked like a permission literal. The comment is reworded, and the test now passes.
  - `log-screen` (rest timer) and `review-queue` failed only under full-suite load. Both pass in isolation (86/86), and this PR does not touch them.
- New: `scripts/e2e-fixture-scope.test.ts`, 25 tests. They cover the email shape, the createdAt check, schema coverage (16 tables, 2 buckets), mixed rows and permission principals.
- Runner smoke test, no network: argv passes through, both builds are patched, and a throwing script exits 1.
- **Not run here:** every e2e suite, `e2e:prune` and the backfill. These hit the live instance and are left for the main session.

### Decisions for Joey

- **The runner wraps `Users.create`.** This is test-only and documented in `e2e-run.mts`. The alternative is moving setup into `try` in ~30 scripts by hand, which is the same work as the `@playwright/test` migration the audit recommends. Say if you'd rather have that.
- **Prune now finds `@sticksnboulders.test` accounts.** The first `e2e:prune` report will likely list stranded accounts from `e2e:dots`, `feedback`, `review`, `clip`, `video`, `bodyweight`, `export` and `profile` that it never saw before. Read the report before `--yes`.
- **Stranded global exercises stay.** `sampleExerciseIds` can create global exercises, and a crashed run leaves them behind. Prune can't prove who owns them, so it leaves them.
- **Unverified: queries on unindexed columns.** Some person columns have no index, for example `set_comments.author_id`, `reference_maxes.recorded_by` and `program_blocks.coach_id`. Appwrite 1.9 should accept queries on them. If it refuses one, prune reports it as an ERROR and keeps that account, but deletes nothing wrongly. Confirm on the first report-only run.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
