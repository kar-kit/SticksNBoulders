## test(coach,review,export): cover the coach-side stores, fix two export bugs

### Why

The test-suite audit broke the source on purpose and ran the suite. In the
coach-side data layer the suite stayed green through every mutation, because
`roster-store`, `queue-store`, `comment-store` and `coach-links-store` had no
tests at all. That gap is how the "Unnamed athlete" bug reached a coach. The
same pass turned up two real bugs in the CSV export.

### What changes

**Test infrastructure**

- `lib/testing/fake-tables.ts` (new, test-only): an in-memory Appwrite
  `tables` that applies `equal`, `isNotNull`, `isNull`, `greaterThanEqual`,
  `lessThan`, ordering, `cursorAfter`, `limit` and `select`. It throws on any
  other query method. A store that drops a filter, flips a sort or forgets to
  select a column it reads now gets the wrong rows back, the same as it would
  from the server.

**New store tests**

- `lib/coach/roster-store.test.ts`: `fetchRoster` → `buildRoster`. Covers an
  athlete with a profile (named), one with no profile (listed as
  `Unnamed athlete`, not dropped and not handed someone else's name), forged
  profiles, open sessions not counted as completed, circle visibility, and
  waiting clips.
- `lib/review/queue-store.test.ts`: covers the athlete filter, forged clips
  being dropped, the 300-clip cap keeping the newest clips, unfilmed sets being
  filtered server-side, the prescription snapshot, `fetchReviewedSetIds`
  returning only this coach's own unforged rows, and `subscribeToClips` firing
  on both `update` and `create`.
- `lib/review/comment-store.test.ts`: threads come back in `created_at` order
  even when ids disagree with that order. Also covers forged and empty comments
  being dropped, one round trip per 100 sets, and the Athlete View feed
  (newest first, capped, this athlete only).
- `lib/coach/coach-links-store.test.ts`: only `status: "active"` counts as
  linked. An unknown or missing status does not. Also covers this coach's rows
  only, the revoked/linked dates surviving the column select, and
  `canSeeCircle`.

**Bug fixes (failing test written first, watched fail, then fixed)**

1. **Cancelled share sheet reported success.** `components/export/export-log.tsx`
   ignored the `false` that `deliverFile` returns when the athlete dismisses
   the share sheet, so it still showed "Exported N sets". It now returns to
   idle.
2. **CSV Prescription column always blank.** Sets have stored `prescribed`
   since Order 22. The export failed to fill it in two places: it never
   selected the column, and `buildLogRows` defaulted to a lookup that returned
   null. The store now selects and parses `prescribed`, and the default lookup
   returns it. The column order is unchanged. `docs/csv-export.md` is updated.
   The new `lib/export/export-log.test.ts` checks the assembled CSV for a
   fixture with a header, a warm-up, a working set with its prescription, and
   another athlete's set that gets excluded.

### Mutations now caught

34 mutations run, 34 caught. Each one was applied, run against the named
test file, and reverted with `git checkout`.

| Audit id / mutation | Caught by |
| --- | --- |
| M1 open session counted (`finishedAt` `""` instead of null) | roster-store |
| M2 names map emptied; also names paired by position | roster-store |
| `finished_at` dropped from select; visibility forced true; reviewed ids emptied; forged profile kept (`lib/auth/athletes.ts`) | roster-store |
| M10 subscription reacts to creates only | queue-store |
| M11 `authenticRows` removed from `fetchClips` | queue-store |
| M21 cap keeps the oldest (`orderAsc`) | queue-store |
| athlete filter removed; `isNotNull(video_file_id)` removed; review coach filter / provenance removed; prescription dropped | queue-store |
| M17 unknown status treated as active | coach-links-store |
| coach filter removed; `revoked_at` unselected; `canSeeCircle` always true | coach-links-store |
| comment order, provenance (both reads), empty-body filter, batch size, athlete filter, `parent_id` | comment-store |
| cancel ignored; prescription default, select, parse; athlete filter; warm-up parse | export-log, training-log-store |

One mutation survived on the first try: removing `isNotNull("video_file_id")`.
The store discards video-less rows anyway, so the only effect is extra round
trips. The test now asserts one round trip for 400 unfilmed sets plus one clip.

### Not done / for a decision

- `subscribeToClips` ignores `.delete` events. I did not pin that either way.
  Whether a deleted filmed set should refresh the queue is a product call.
- `fetchCommentsForSets` orders within each 100-set batch, not across batches.
  It is untested past 100 sets and I left it unchanged.

### How to verify

`npm test` (144 files / 2268 tests), `npm run lint`, `npm run typecheck`.
