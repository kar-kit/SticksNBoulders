## Review Queue: batch clip URL requests past 60

A coach with 61 or more unreviewed clips got no playback at all. The queue sent
every id in one `POST /api/clip`; the route answers 400 above `MAX_FILES` (60);
the client's `.catch(() => {})` swallowed it and the player sat on "Loading the
clip…" forever. [Fact] Read in `app/api/clip/route.ts` and
`components/coach/review-queue.tsx` on `origin/dev`, and reproduced by the new
component test, which fails on the old queue. [Inference] A capacity model puts
five athletes at about 112 clips a week, so a normal Sunday crosses the line.

### The fix (client only)

- `MAX_FILES` moves to `lib/video/clip-limits.ts` so the queue imports it
  rather than copying 60. A Next route file cannot export it
  ([Inference] from Next's route export rules; `typecheck` is the check). The
  limit itself is unchanged.
- `lib/review/clip-url-batches.ts` slices ids (de-duplicated, queue order) into
  batches of at most `MAX_FILES`, requests them together, and reports each as
  it settles. The first batch does not wait on the last.
- A failed batch is an outcome, not a swallowed throw. The queue shows how many
  clips could not be prepared, with **Try again**; `ClipPlayer` takes an
  optional `unavailable` message so an affected clip says so instead of loading
  forever. Batches that landed keep playing, and the failed clips can still be
  cleared.
- Realtime is untouched: a new clip changes `items`, which re-mints the batches
  exactly as before.

### Not done

- `app/(athlete)/today/feedback/feedback-screen.tsx` batches with its own
  `CLIP_BATCH = 50`. It works; left alone as out of scope.
- [Unverified] A long queue now costs two or three `createJWT` calls per clear
  rather than one. Whether Appwrite's rate limit on that endpoint bites at 100+
  clips is not checked. Reading the limit for `POST /account/jwts` settles it.

### Verification

`lint` · `typecheck` · **2033 tests, 128 files**. New: unit tests for exactly
60, 61 and 130 ids and a failing batch (`lib/review/clip-url-batches.test.ts`),
and four queue tests (61 clips play; first batch plays while another is in
flight; failed batch named, others kept, retry; current clip failed). No live
instance touched.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
