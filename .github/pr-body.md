## fix(strength, programming): same-day max typo beat its correction; stale program across athletes; close mutation-audit gaps

### Why

A mutation audit (break the source, run the suite) found behaviours the 2242
tests did not protect. Two of them hid real bugs.

### Source bugs fixed (failing test written first, watched fail, then fixed)

1. **`currentMax` let a typo beat its own correction.** Same-day ties broke on
   list position ("later-listed wins"), but `fetchReferenceMaxes` reads
   newest-first (`orderDesc("$id")`) while the test fed entries oldest-first.
   With the store's order, a coach entering 1800 then 180 on the same date got
   1800, which then priced every percentage, DOTS and the coach panel. Ties now
   break on the row id: rows are written with `ID.unique()` (route.ts), whose
   hex seconds + milliseconds prefix sorts in creation order. Tested in both
   list orders, and end to end through the store; switching the store to
   `orderAsc` leaves that answer unchanged.
2. **`useMyProgram` kept the previous athlete's program.** On an athlete change
   whose read failed, the catch kept any `ready` state (the previous athlete's),
   and a null id left it on screen. State is now tagged with the athlete it was
   loaded for; anything else reads as `loading`.

### Tests added or tightened

- backoff: a heavier line BEFORE the backoff line must not price it (M20).
- `rollupMatches`: drift in each of the 8 fields alone, plus a guard that the
  list covers every `Rollup` key. The source already compared all 8; the gap
  was test-only.
- `personalRecords`: pins current cross-week heaviest-single tie behaviour.
- Button: variants must produce distinct classes; default equals primary.
- library fetch: query-applying fake (handles `Query.or`), so dropping the
  `owner_id` branch fails; also paging and coach-vs-athlete scoping.
- my-program store: spies on every browser TablesDB write method and asserts
  none is called (the old test passed a fire-and-forget `upsertRow`).
- New read-layer tests: `reference-max-store`, `lift-store`, `rollup-client`.
- dots: corrected the comment. A trailing-digit swap in b/c/d/e moves the
  score by at most 0.003, inside the band; tolerance unchanged.

### Mutations

38 run, 38 caught (one, rollupFrom's rep tie-break, by an existing test).

### Not done / for a decision

- **Heaviest-single tie rules disagree.** `rollupFrom` prefers more reps
  within a week; `personalRecords` keeps the first week listed (`>`), so the
  all-time record can read 140x3 after a 140x5 week, depending on list order.
  Documented by a test, not changed.
- `dots-store.ts` not tested: pure fan-out to five tested readers plus `dotsFor`.
