## FTP1-1 — Appwrite project and schema as code

**Notion:** https://app.notion.com/3da64699b43c8144ad04dd99a5cd5814

### What was built

Collections, columns, indexes and permissions for phase 0 and phase 1, defined
in a versioned TypeScript schema and applied with `npm run appwrite:setup`.
The applier is split into a pure planner and an executor, so idempotency is a
unit-tested property rather than something we hope holds against a live server.
Alongside it, `npm run appwrite:reset` clears the previous product's resources,
dumping every table to `.appwrite-backup/` before it deletes anything.

Six tables: `profiles`, `exercises`, `sessions`, `sets`, `stats_rollups`,
`coach_athlete_links`. Applied to the live instance and verified — all columns
available, all indexes built, second and third runs are no-ops.

### Scope, and what is deliberately absent

`programs`, `prescriptions` and `reference_maxes` are **not** here. The Program
Editor's shape is still open question 1 with Ruairi, and the build plan calls
guessing the prescription model the expensive retrofit. They arrive as later
migrations once that answer does. `coach_athlete_links` is included despite
being Order 16, because the write helper at Order 2 cannot be built without the
table it reads to stamp permissions.

### Decisions that were not specified

- **Appwrite 1.9 uses the TablesDB API**, not the older Databases API — tables,
  rows and columns rather than collections, documents and attributes. The
  legacy `/databases` endpoint reports zero databases on this instance, which
  is why it looked empty at first glance.
- **`node-appwrite` pinned to 28.0.0.** It targets Appwrite 1.9.6; the server
  runs 1.9.0, so every response carries a version-mismatch warning. No
  published SDK targets 1.9.0 exactly. The warning is now printed once per run
  instead of once per request. **Upgrading the server to 1.9.6 clears it.**
- **Column changes are never applied automatically.** A narrowed width or a
  changed type truncates data, and that data is an athlete's logged work, so
  the planner reports and a human decides.
- **Orphans are reported, never deleted**, for the same reason.
- **`client_set_id` and `client_session_id`** are required and unique-indexed.
  The offline queue at Order 9 retries on reconnect, and without an
  idempotency key a retried set is logged twice and tonnage goes wrong.
- **`sex` is nullable.** DOTS needs it, but an athlete may not have set it yet;
  the number simply does not render until they do.
- **`stats_rollups` and `coach_athlete_links` have `permissions: []` on
  purpose.** That is not an oversight: nothing may read them by virtue of being
  signed in. Every read comes from a row permission stamped by the Function
  that writes the row.

### Tests

66 new, 213 total.

- **Schema invariants.** Row security on every table; no table-level read
  anywhere, because Appwrite grants on table-level *OR* row-level permission
  and the combination silently exposes every row to every signed-in user. No
  user may create a rollup or a coach link. `athlete_id` denormalised onto
  `sets`, `e1rm_kg` stored not derived, rollups uniquely keyed per athlete per
  exercise per week.
- **Idempotency**, as the feature list requires: apply against an in-memory
  Appwrite, assert the second and third runs write nothing. The fake reports
  state the way the real server does — `float` comes back as `double`, a
  single-column index reports empty orders — so the test is not just the
  planner agreeing with itself. Also covers resuming a half-finished run.
- **Drift repair.** Row security switched off in the console is restored; a
  changed index is deleted before being recreated; orphans survive.
- **Config.** Endpoint from an env var, API key absent from the client config,
  actionable errors naming what is missing.

**Live permission probe** (`npm run appwrite:probe`). The whole design rests on
Appwrite granting access on table-level *OR* row-level permission. That is
invisible when wrong, so it is now checked against the real instance rather
than asserted in a comment. Eight assertions, all passing:

```
PASS  owner A reads their own set
PASS  stranger B CANNOT read A's set
PASS  stranger B lists 0 sets (saw 0)
PASS  B reads a global exercise
PASS  B CANNOT read A's custom exercise
PASS  B reads A's set when stamped as their coach
PASS  A CANNOT forge a rollup
PASS  A CANNOT grant themselves a coach link
```

It creates two throwaway users, exercises each case, and removes them. This is
the seed of the permission audit script at Order 38.

Not unit-tested, verified by hand and stated here: the live apply itself, and
the reset. Appwrite is not our code, so the SDK is mocked at the driver
boundary.

### Bugs found and fixed on the way

1. **Idempotency was broken on first implementation.** Appwrite reports
   `orders: []` for single-column and unique indexes; the planner filled in a
   default of `asc` and compared, so seven indexes were rebuilt on every run.
   Now only orders the schema explicitly asked for are compared.
2. **`coach_athlete_links.status` was required *and* had a default.** Appwrite
   rejects that outright (`column_default_unsupported`) and the first live
   apply died halfway through. There is now a schema test for it, and the
   resumability of a half-finished run is tested because of it.
3. **Vitest was not collecting `appwrite/**`.** The `include` pattern only
   covered `app`, `lib` and `components`, so the first 26 tests in this PR
   passed by never running. Widened.
4. **`z.url()` accepts `localhost:80`** — it parses as a URL with protocol
   `localhost:`. A typo'd endpoint would have failed at the first request
   rather than at startup. The scheme is now checked.

### Pre-existing problems found, not fixed here

- **A live Appwrite API key is committed in `ff289fa` on `main`, in a public
  repo.** Untracked on `dev` in an earlier commit, but it remains in history
  and needs rotating in the console. Flagged separately; Joey is on it.
- The self-hosted instance runs Appwrite 1.9.0 against a 1.9.6 SDK.

### Reset

Ten tables, two buckets and six functions from the previous product were
deleted, including rows: `profiles` had 10, `workout_sets` 7,
`workout_sessions` 6, `lifts` 4. All dumped to `.appwrite-backup/` first.
**Auth users were not touched** — they are identities rather than product data,
and deleting them would have taken Joey's own login with them.

### Two things for Joey

- **`--reviewer kar-kit` cannot work.** `gh` here is authenticated as kar-kit,
  so every PR is authored by Joey and GitHub refuses to let an author review
  their own PR (422). The assignee is set, which is the part that matters. The
  brief's step 7 command needs that flag dropped.
- **The pre-reset dump is single-copy on this dev box**, under
  `.appwrite-backup/`, gitignored. It holds the old `profiles`, `workout_sets`
  and `workout_sessions` rows. Off-machine backups are FTP1-5, but if that data
  is worth keeping, pull it somewhere before then.
