# Video on a set

_Order 29. Phase 3. Source: Joey. P0 Blocker._

> "Highest value feature in the product. Neither RTS nor Excel does it."

The set already carries load, reps, RPE and notes, so the context writes itself
and the essay-length WhatsApp message disappears.

## Two findings that shape everything downstream

### 1. The instance caps files at 30MB — and that is not enough

[Fact] `_APP_STORAGE_LIMIT` on the self-hosted instance is **30,000,000 bytes**.
`createBucket` rejects any `maximumFileSize` above it outright, with
*"Value must be a valid range between 1 and 30,000,000"*.

A 60-second 1080p clip from a modern phone is several times that. So **client-
side compression is mandatory, not the optimisation Order 31 calls it** — or
the instance limit has to be raised and the containers restarted. That is
Joey's call; the schema tracks what the instance actually allows rather than
what we would like, and `checkClip` refuses an oversized file *before* the
upload starts so an athlete on gym wifi is not told no after two minutes.

### 2. Chunked uploads DO resume — but the SDK does not use it

This closes the `[Unverified]` on Order 31 and in CLAUDE.md. Probed against the
live instance with a 15MB file in four 5MB chunks:

| Question | Answer |
| --- | --- |
| Does the server report partial progress? | **Yes** — `getFile` on a half-uploaded file returns `chunksUploaded: 1/4` |
| Can you send only the missing chunks? | **Yes** — with `x-appwrite-id` and the right `content-range`, chunks 1–3 completed it |
| Does the result match? | **Yes** — `sizeOriginal` exactly equal to the original byte count |
| Does the SDK do any of this? | **No** |

[Fact] `Client.chunkedUpload` in the browser SDK always uploads chunk 0 first to
obtain an upload id, then chunks 1..n at concurrency 8. There is no parameter
for an existing upload id and no query of what already landed, so
`storage.createFile()` after a dropped connection **restarts from byte 0**.
Resume is real at the protocol level and has to be written by hand.

[Fact] **The upload id is the file id we choose.** Asserted directly rather than
inferred — the server echoed back the exact `fileId` posted. This is the fact
resume-across-a-reload rests on: a half-finished upload can be found again from
state we already hold. If Appwrite ever returned a server-generated handle
instead, resume after a page reload would become impossible, so it is worth
re-checking on an Appwrite upgrade.

Chunk size is 5MB (`Client.CHUNK_SIZE`).

## Where a clip goes

One camera button **per exercise**, not per row, attaching to the **most
recently logged set of that exercise** — straight from the Set Row spec. A
per-row camera bought nothing and cost the confirm target its column, and
confirm is the control an athlete hits 20–40 times a session.

Warm-ups are eligible. A coach asking to see a warm-up is asking about setup,
which is a real coaching question; the rule that excludes warm-ups from PRs and
rollups is about numbers, not video.

The camera is **absent** rather than disabled when nothing has been logged for
that exercise — offering it with nowhere to attach produces a clip the product
then has to explain away.

## Why the upload is not a queued write

The offline queue is a write-ahead log for **row mutations**. Replaying a 30MB
binary through it would mean holding the video in IndexedDB and re-sending it
on every retry.

So the split is:

1. The set is logged first, through the queue, as it already was.
2. The upload runs separately — "a thin progress line under the row", never a
   spinner that blocks the next set. It either finishes or it does not.
3. The small durable fact that follows — *this set now has this file* — goes
   through the queue as `set.attachVideo`, so a clip that landed on gym wifi is
   never lost to a dropped response on the row write.

`attachVideo` is deliberately separate from `updateSet`. That one demands load,
reps, RPE and the warm-up flag together so e1RM cannot go stale, which is right
for an edit and wrong here: a video changes nothing about what was lifted, and
making the caller restate four numbers invites it to restate them wrongly.

Detaching clears the row first and deletes the file second. An orphaned file is
a storage bill nobody notices; a row pointing at a file that is gone is a broken
player in the coach's review queue, which is worse — so the dangling direction
is chosen rather than accidental.

## Permissions

`videoPermissions` stamps each file for the athlete and their circle — the same
shape as the set it belongs to, because it is the same fact. A video is more
revealing than a row of numbers and gets no wider audience than the numbers do.

The athlete may delete; the coach may not. Deleting a set should take its clip,
and someone who filmed something they would rather not share must be able to
remove it — but a review tool whose reviewer can destroy the thing under review
is the wrong shape.

Bucket-level permissions carry `create("users")` and no read, for the same
reason tables do: Appwrite grants access on bucket-level **or** file-level
permission, so a bucket-wide read would make every clip visible to every
signed-in user.

## Buckets are now schema-as-code

CLAUDE.md says infrastructure is never clicked into existence in a console, and
a bucket is infrastructure — its size cap and extension list are as load-bearing
as a column type. `BucketSpec` joins `TableSpec`, the planner diffs every field,
and `npm run appwrite:setup` creates or corrects it. Verified idempotent against
the live instance: the second run reports "Schema already matches."

`encryption` and `antivirus` are both off, deliberately. Appwrite skips
encryption above 20MB, so enabling it would encrypt short clips and silently not
long ones — a guarantee that holds only sometimes is worse than none. Antivirus
needs ClamAV beside the instance, which this one does not have, and claiming it
would make every apply report drift it cannot fix.

## Files

| File | What it holds |
| --- | --- |
| `lib/video/clip.ts` | Pure rules: what can attach, which set it attaches to |
| `lib/video/upload.ts` | The upload itself, and detaching |
| `appwrite/documents/write.ts` | `attachVideo` |
| `appwrite/documents/policy.ts` | `videoPermissions` |
| `appwrite/schema/` | `BucketSpec`, bucket planning and applying |
