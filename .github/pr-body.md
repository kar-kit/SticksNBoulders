## FTP1-2 — Document write helper and permission model

**Notion:** https://app.notion.com/3da64699b43c81e7aaccd2091df64fd4
**Depends on:** #1 (merged)

### What was built

`appwrite/documents/` — the single write path. Every row this product writes
goes through it, and it stamps permissions and denormalised fields in the same
place so the two cannot drift apart. A lint rule and a guard test both fail the
build if anything calls `createRow`/`updateRow`/`deleteRow` elsewhere.

- `policy.ts` — who may do what, per table. Pure, no I/O, so every rule is
  exhaustively testable and the tests are the real specification.
- `write.ts` — the typed operations. Callers never supply `athlete_id`; it
  comes from the actor.
- `circle.ts` / `circle-admin.ts` — the team that carries coach access.
- `row-writer.ts` — the narrow SDK surface, so the helper is testable and the
  row methods are imported in exactly one file.

### The design decision worth reviewing

CLAUDE.md says the helper reads `coach_athlete_links` to decide who sees what.
Read literally that means stamping each coach's **user id** onto each row — but
Appwrite freezes permissions at write time, so **a coach linked in November
would see nothing logged in October.**

That is not hypothetical. The build plan has Joey dogfooding phase 1 from
mid-October and coach linking landing mid-November. Ruairi would have linked and
found an empty account with two months of training invisible behind it. Fixing
it after the fact means a backfill over every row the athlete ever wrote — a job
that half-fails silently and leaves gaps nobody notices.

Instead, **every athlete has a circle**: an Appwrite Team holding them and their
coaches. Rows stamp `read(team:circle_<athlete>)`. Linking a coach is one
membership write, applies retroactively to every existing row, and revokes the
same way. `coach_athlete_links` remains the source of truth for who coaches
whom; the team is how that fact reaches Appwrite.

Joey chose this over the backfill after seeing both. **It is worth deciding
whether CLAUDE.md's wording should be updated**, so the next reader does not
take "reading coach_athlete_links" as a mandate to stamp user ids.

The circle is managed server-side only. A user can create a team from their own
session and would then own it, able to add and remove members behind the app's
back — so links and real access would drift with nothing to reconcile them.

### Policy, in one place

| Table | Read | Write |
| --- | --- | --- |
| `profiles`, `sessions`, `sets` | athlete + their circle | athlete only |
| `stats_rollups` | athlete + their circle | nobody (Function, API key) |
| `exercises` (global) | any signed-in user | nobody |
| `exercises` (custom) | owner + their circle | owner only |
| `coach_athlete_links` | the two parties | nobody (Function) |

Two things that look redundant and are not:

- **The athlete always gets an explicit `read(user:…)` alongside their
  circle's.** A bug in membership sync must never lock an athlete out of their
  own history mid-session.
- **Permissions are re-stamped on every update**, not just on create. A
  permission set written once is one that drifts when the policy changes.

The circle grants **read and only read**. A coach cannot rewrite logged work —
constraint 5, enforced in the policy rather than trusted to callers.

### Tests

63 new, 315 total.

- **`policy.test.ts`** — exhaustive. Every table, both exercise cases, the
  no-blanket-read rule, no duplicate permissions, well-formed permission
  strings, and a throw rather than a silent stamp when an id is missing.
- **`write.test.ts`** — `athlete_id` comes from the actor and never the caller;
  the permission stamp and the denormalised id agree by construction; a queued
  set keeps the time it was logged, not the time it synced; a null RPE is not
  a number; updates send only what changed.
- **`circle-admin.test.ts`** — idempotent creation, repair of a missing athlete
  membership, multiple coaches (Ruairi and Louis both coach at Uxbridge),
  and a refusal to remove an athlete from their own circle.
- **`guard.test.ts`** — no write path bypasses the helper. Scans the **working
  tree**, not just the index, because an uncommitted bypass is exactly the one
  that matters. Verified non-vacuous: adding a bypassing file fails it with a
  message explaining why.

**Live probe** (`npm run appwrite:probe`), now driving the real policy module
rather than a restatement of it. 19/19 against the running instance:

```
Before any coach exists
  PASS  Joey reads his own set
  PASS  Ruairi, unlinked, cannot read it
  PASS  Ruairi, unlinked, lists 0 sets
After linking Ruairi to Joey
  PASS  Ruairi reads the set logged BEFORE he was linked
  PASS  Ruairi reads a set logged after linking
  PASS  Ruairi CANNOT rewrite Joey's logged work
Isolation between athletes
  PASS  Ruairi cannot read Sam, whom he does not coach
  PASS  Sam cannot read Joey
  PASS  Louis, coaching only Sam, reads Sam
  PASS  Louis cannot read Joey
  PASS  Ruairi lists only Joey's sets
Exercises
  PASS  anyone signed in reads a library exercise
  PASS  Ruairi reads Joey's custom exercise, so the queue can name it
  PASS  Sam cannot read Joey's custom exercise
Forgery
  PASS  Joey cannot forge a rollup
  PASS  Joey cannot grant himself a coach link
Revocation
  PASS  a revoked coach loses access to everything at once
  PASS  and to rows logged after linking too
  PASS  while Joey keeps his own data
```

### Bugs found and fixed on the way

1. **My first lint guard silently did nothing.** ESLint flat config *replaces*
   a rule's options when a later block sets the same rule rather than merging
   them, so splitting the row-mutator ban and the `TablesDB` ban across two
   blocks disabled the first. Caught by testing that the guard fires, not by
   reading it. Both bans now live in one selector list, restated per variant.
2. **The guard test only scanned tracked files.** A newly written bypass would
   have been invisible until after it was committed. Now scans the working
   tree, untracked files included.
3. **`perm.readUsers` existed in the schema and was never used** — a ready-made
   constant for `read("users")`, the exact string the schema tests forbid at
   table level. Deleted: the dangerous string should not be constructible.

### Known limitation, stated rather than hidden

**Permission stamping is client-trusted.** Athlete writes happen in the browser
with the athlete's session, so a modified client could stamp a wrong
`athlete_id` or an over-permissive read on its own rows. It cannot read anyone
else's data — the probe covers that — and it cannot forge rollups or links,
which are Function-only. Closing it properly means routing writes through a
Function, which costs the offline-first latency the logger is built around.
Worth revisiting at Order 38 when the audit script lands; not worth paying for
now. Flagging it so it is a decision rather than an oversight.

### Not in this PR

`e1rm_kg` is accepted and stamped by `createSet` but nothing computes it yet.
The formula is Order 11, and the build plan says to verify it against a
published source before hardcoding. The column is nullable and the rebuild
script backfills.
