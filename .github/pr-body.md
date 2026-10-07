## fix(offline): replay a reloaded queue in order, and test the queue and log screen for real

### Why

A mutation audit (break the source, run the suite) found the offline queue and
the log screen under-protected: the runner was only ever mocked, the log screen
mocked `logSet`/`removeSet` whole, and several guards could be deleted with the
suite staying green. A probe also found a real ordering bug.

### The bug fixed

On reload, IndexedDB's `getAll` returns ops sorted by key, and the key was
`op-<ms>-<unpadded sequence>`. Ops queued in the same millisecond (a set and its
rollup refresh always are) came back as `[0, 9, 10, 11, 1, 2, …]`, and the
forced flush (`attachQueue`, `online`, tab visible) sent them in that order
because it took the cache unsorted. A set could reach Appwrite ahead of the one
logged before it.

- The forced batch now uses `pendingOps`, which sorts by the stored `sequence`.
  Queues already on a phone with old unpadded ids replay correctly too.
- New ids zero-pad the sequence so disk order matches queue order.
- The failing test came first, against a fake store that sorts like IndexedDB.

### Tests added or rewritten

- `lib/offline/runner.test.ts` (new, 19 tests): the real write helpers run
  behind a recording row writer. Covers payload mapping for every op kind,
  circle-before-write, profile failure never blocking a write, 404 on
  delete/attach counting as done, and the coach-comment guard.
- `client.test.ts`: a retryable `session.create` failure stops `set.create`;
  "writes the op down before it tries to send it" now asserts put-before-send
  on one event log (it only asserted `writes.length === 1` before).
- `log-screen.test.tsx`: three tests run the real set-store over an in-memory
  queue and read the queued op. They cover a warm-up with no prescription link
  next to a working set that has one, a set index that is not reused after a
  delete on the page, and a delete whose local write fails bringing the set back.
- `session-detail.test.tsx`: an incomplete draft cannot save even if its
  confirm fires, and a failed edit or delete reloads the server copy.
- `bodyweight.test.ts`: 399/400/401/499 as literals. The old test read the
  limit back from the module.

### Removed

- `cancelQueued` and its test. Nothing outside the test called it.
  `collapsibleCreate` in queue.ts is now unused too. I left it, with its
  tests, for a follow-up.

### Mutations now caught: 27 / 27

Runner 12 (warm-up forced false, circle removed or not awaited, profile removed
or awaited, 404 swallow removed on delete and on attach, prescription dropped,
load or RPE mis-mapped, update warm-up forced false, comment guard inverted).
Client 4 (keep sending after retry, send before persist, unpadded id, unsorted
forced flush). Log screen 5 (warm-up carries the link, index counted from the
shown sets, no restore on failed delete, warm-up forced false in the screen and
in set-store). History 3. Bodyweight 3.

### Not done / for a decision

- History delete has no undo and no pre-check for coach comments on screen.
  The queue still refuses it (412) when it runs. Whether History should match
  the log screen is a product decision.
- The video-required gate (`set.ts`, `set-row.tsx`) is untouched.

`npm test` 2270 / 140 files, `npm run lint` and `npm run typecheck` are clean.
