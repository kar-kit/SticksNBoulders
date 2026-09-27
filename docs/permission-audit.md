# Permission audit

```
npm run appwrite:audit              # the full audit, ~1 minute
npm run appwrite:audit -- --no-scan # skip the stored-stamp scan
npm run appwrite:audit -- --verbose # print every attempt as it happens
```

Run it before each phase ships (CLAUDE.md, "A permission bug is sev-1"). It
exits non-zero on any failure.

## Why it is shaped like this

`appwrite:probe` wrote every row with the admin key and only *read* through
user sessions. It passed 19/19 while no athlete could write anything at all
(PR #8). A permission check that never writes as a user proves the half of the
model that was never broken.

So the audit has three rules of its own:

1. **Every legitimate write goes through a genuine user session**, using the
   real write helper (`appwrite/documents/write.ts`). The server-only tables
   are written through their real route handlers (`app/api/*/route.ts`),
   called in-process with a real Appwrite JWT, so the route's own
   authorisation is under test too.
2. **Every refusal is attempted the way an attacker would**: raw
   `createRow`/`updateRow`/`deleteRow` calls, no helper in the way, stamped
   with the strongest permissions the attacker is able to stamp.
3. **Resources are discovered, not listed.** Tables and buckets come from the
   schema-as-code *and* the live instance. Anything without a rule in
   `appwrite/audit/rules.ts` fails the run, as does a rule for something that
   no longer exists.

## The five roles

| Role | Who |
|---|---|
| athlete A | The athlete whose data is under test. Has a circle, a profile, logged work, a clip, maxes. |
| A's coach | Linked to A by redeeming the coach's invite code through `POST /api/link`. |
| unlinked | A real coach with their own invite code and no link to A. |
| athlete B | An unrelated athlete with their own circle and their own logged set. |
| anon | A client with no session at all. |

## What each operation means

Every cell is about **athlete A's data**, judged from the attacker's side.

- **read**: get the target row or file by id.
- **create**: can this role put a row into A's data that A and A's coach will
  then read as A's? For the owner, that is the setup write through the helper.
  For anyone else it is a forgery: a raw `createRow` carrying A's id, stamped
  `read("users")`, which any session may stamp because every session holds
  that role. For the server-only tables every role attempts it, because no
  session may write them at all.
- **update**: a raw data-only `updateRow`, or the helper for the owner where
  the helper has one. Each role writes a *different* value (see "Appwrite
  quirks").
- **delete**: raw `deleteRow`, or the helper for the owner. Non-owners go
  first, the coach's own deletes next, and A's own last, because the
  revocation checks need A's rows to still exist.

## Beyond the matrix

- **Routes**: circle, invite, link, rollup and reference-max each write through
  their route with a real JWT. The unlinked coach and athlete B are refused by
  `/api/reference-max` for A (403), and every route refuses a caller with no
  token (401).
- **Outsiders see nothing**: the unlinked coach, athlete B and anon list every
  table filtered by A's id and get zero rows.
- **Each side's words are their own**: the coach cannot edit or delete A's
  reply; the matrix covers A against the coach's comment.
- **Revocation**: A unlinks through `POST /api/link/revoke`. The ex-coach then
  loses read on every table and the clip, including rows logged while he was
  linked and his own review and comment. He can no longer comment, clear A's
  clip, or set A's max through the route. A keeps everything. The link row
  stays, marked revoked, and the ex-coach can still read it `[Inference]`: the
  row is the record of who could once see what (docs/coach-links.md).
- **Stored stamps**: every row on the instance, compared with what `policy.ts`
  would stamp on it today. Read-only. This is the "rescan documents for
  missing or wrong permissions" half of the Build Plan's audit (§7). Rows are
  frozen at write time, so a policy change or a write that skipped the helper
  leaves rows no session-based test will touch. It also catches a forged row
  after the fact, because a forger cannot stamp the owner's roles.

## Running it on a shared instance

It creates its own users (`audit-<role>-<timestamp>@example.com`, so
`e2e:prune` recognises one stranded by a crash), and on the way out deletes only
rows naming those users' ids, their files, and their circle teams. It never
lists a table and deletes what it finds. Schema changes: none.

It does create one global library exercise for a few seconds ("Audit Library
Lift <timestamp>"), because a library row can only be written by the server
and the audit needs one it is allowed to lose. Another session's typeahead
could see it briefly.

## Adding a table

A new table without a rule fails both the audit and `npm test`
(`appwrite/audit/rules.test.ts`), the same way `POLICIES` refuses a table with
no policy. To add one:

1. Add a `ResourceRule` to `RULES` in `appwrite/audit/rules.ts`: who reads,
   creates, updates and deletes A's row, and the column naming A.
2. Add the table to `STAMPED_TABLES` and `expectedStamp`.
3. In `scripts/appwrite-audit.mts`, write the target as its real owner would
   (through the helper or route) and add the forgery attempt, the raw update
   value, and the owner's update and delete.

## Appwrite quirks it found

- **An update that changes nothing succeeds without an update permission**,
  as long as the caller can read the row. The first run reported the coach
  "editing" A's custom exercise because he wrote the same name A had just
  written. Nothing changed, so it is not a leak, but it would make any
  audit that reuses a value lie. Each role now writes its own value.
  `[Inference]` from that run and the next, where different values were
  refused.
- **Any session may stamp `read("users")` or `read("any")`.** Appwrite limits
  a session to roles it holds, and every session holds those two. This is the
  root of the finding below.

## Finding, 27 Sep 2026: any signed-in user can forge rows into anyone's data

`[Fact]` from the audit run: every table with `create("users")` at table level
(`exercises`, `sessions`, `sets`, `bodyweight_entries`, `set_reviews`,
`set_comments`) accepts a row from any session carrying somebody else's
`athlete_id`, `owner_id`, `coach_id` or `author_id`, stamped `read("users")`.
The victim and their coach then read it as theirs, because every read in the
app filters on those columns and Appwrite returns every row the caller may
read.

This is not a confidentiality bug. Nobody reads what they should not. It is an
**integrity** bug: somebody else's numbers appear as yours. It is the same
reasoning `policy.ts` already applies to `reference_maxes` and `invite_codes`
("Appwrite can police who reads a row but not what the row claims"), applied
to the tables that still allow a client-side create.

What the audit showed landing:

| Forged row | What it does |
|---|---|
| A set under A's id with `e1rm_kg: 400` | **Counted in A's rollup** the next time A logs that lift. `/api/rollup` rebuilds from every set with A's id, using the admin key, so A's best e1RM for the week became 400kg. The coach also reads it as A's set, and with a `video_file_id` it would sit in his review queue. |
| A session or weigh-in under A's id | Shows in A's history, bodyweight chart and DOTS, and the coach's Athlete View. A weigh-in at A's derived row id for a future date also blocks A from logging that day `[Inference]`: the create collides and the update fallback is refused. |
| A custom exercise with `owner_id: A` | Appears in A's typeahead. |
| A library exercise with `is_global: true` | Appears in **every** athlete's typeahead. |
| A comment on A's set with `author_id` = A's coach | Shows on the thread as the coach's words. |
| A review claiming A's coach cleared A's clip | Removes the clip from the coach's queue. The `reviewPermissions` comment says this is harmless because a forger "can only stamp roles they hold". That is wrong: `users` is a role everyone holds. **A himself** can also do it, stamped with his own circle, which contradicts "the athlete never writes one, and cannot". |

Not fixed here: the fix is not small, and choosing it is a design decision.
`[Inference]` on the options, cheapest first:

1. **Readers check authorship.** A forger cannot stamp another user's role, so
   `update("user:<athlete_id>")` on a set proves A wrote it, and the same holds
   for `author_id` on comments and `coach_id` on reviews. Filter on that in
   the stores and in `rebuildRollup`. Does not cover global exercises, where
   a real row and a forged row carry the same stamp.
2. **A validating Function** on row create, using `expectedStamp` from this
   PR: delete any row whose stamp does not match its owner fields. Covers
   everything except the library, closes the gap within seconds rather than
   never, and database events work since 1.9.6 (docs/appwrite-events.md).
3. **Move creates server-side**, like `reference_maxes`. The only complete
   fix, and the most expensive: it puts a round trip behind every logged set
   and fights the offline queue.

The library needs its own answer under any option: no client-side create of
`is_global: true` rows, most simply by splitting the library into a
server-only table. `[SME to confirm]` with Joey which option, and whether the
beta blocks on it.

Who can do it: anyone with an account, and the app has self sign-up
(`lib/auth/session.ts` calls `account.create`) `[Fact]`. Unless the instance
restricts sign-ups in the console, that means anyone who can reach it
`[Unverified]`: check the project's auth settings.

Not asserted yet, same root cause: an athlete relabelling his own set with
another athlete's id via `updateRow` (it lands in their rollup the same way),
and squatting a new user's profile id before they onboard.
