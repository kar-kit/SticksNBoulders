## fix(e2e): e2e:backup writes the profile row under the user's id

`e2e:backup` created its profile row with `rowId: ID.unique()`. Since the permission hardening a profile's row id must equal its user id, and the live `validate-row` Function deletes anything else, so the script's disaster step 404'd on its own profile and stranded two fixture accounts. One line: `rowId: athlete.$id`.

### Evidence

Ran live against `appwrite.jp-homelab.work` from this branch: **17/17 passed**, and `e2e:prune` afterwards found no fixtures. Before the fix it failed at the disaster step.

### What the live run turned up (data, not code)

The first runs after the fix got past the profile step and then hit `restoreBackup`'s validation, which refused: the instance's own dump was already invalid with 82 blocking problems, so **`appwrite:backup` had been refusing to produce a restorable dump**. Cause: test runs of 8 to 11 Oct left 44 rows, 6 empty circle teams and 2 probe clips owned by accounts that no longer exist (the same pattern as the 7 Oct cleanup). `e2e:prune` skips these by design, because it can only reach a row through a live fixture account.

Cleaned by hand, narrowest scope, after a dump that held them (`.appwrite-backup/2026-10-16T14-39-02-075Z`):
- 38 `profiles` and 2 `stats_rollups` rows whose every grant named a dead user or circle team
- 6 `profiles` rows and 6 empty `circle_*` teams, all named for the "Ruairi Deane" fixture, none with a member
- 2 `clip.mp4` files (200000 bytes) in `set_videos`
- Kept: the two real accounts, their circles, the link between them, their two avatars, the exercise library.

`appwrite:backup` validates again.

### Not fixed

Nothing prevents the next run from doing this. `e2e:prune` and the runner's crash net both need the fixture account to still exist, so rows and teams whose account was already deleted (by the script's own teardown, or the app creating a profile after it) are unreachable. A purge that finds rows by dead principal would close it. Left for a follow-up.

Checks: lint, typecheck, 2817 of 2817 unit tests.
