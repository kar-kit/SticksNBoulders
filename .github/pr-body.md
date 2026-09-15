## Order 29 — Attach video to a set

> "Highest value feature in the product. Neither RTS nor Excel does it."

The set already carries load, reps, RPE and notes, so a clip attached to it
writes its own context and the essay-length WhatsApp message disappears.

### Two findings that shape the rest of phase 3

**1. The instance caps files at 30MB, and that is not enough.**

[Fact] `_APP_STORAGE_LIMIT` is **30,000,000 bytes**; `createBucket` rejects any
higher `maximumFileSize` outright. A 60-second 1080p phone clip is several times
that.

So **client-side compression is mandatory, not the optimisation Order 31 calls
it** — or the instance limit goes up and the containers restart. That is Joey's
call. The schema tracks what the instance actually allows rather than what we
would like, and an oversized clip is refused *before* the upload starts, because
an athlete on gym wifi should not wait two minutes to be told no.

**2. Chunked uploads DO resume — the SDK just doesn't use it.** Closes the
`[Unverified]` on Order 31 and in CLAUDE.md. Probed live with a 15MB file in
four chunks:

| | |
| --- | --- |
| Server reports partial progress? | **Yes** — `getFile` returns `chunksUploaded: 1/4` |
| Can you send only the missing chunks? | **Yes** — with `x-appwrite-id` + `content-range` |
| Result correct? | **Yes** — `sizeOriginal` exact |
| Does the SDK do it? | **No** — `chunkedUpload` always restarts from chunk 0 |

[Fact] **The upload id is the file id we choose** — asserted directly, not
inferred. That is what lets resume survive a page reload, since a half-finished
upload is findable from state we already hold. Worth re-checking on an Appwrite
upgrade, because Order 31's design rests on it. Evidence is written into
`docs/video.md` so that ticket starts from it rather than repeating the probe.

### Why the upload is not a queued write

The offline queue is a write-ahead log for **row mutations**. Replaying a 30MB
binary through it would mean holding the video in IndexedDB and re-sending it on
every retry. So: the set is logged first as it already was; the upload runs
separately as a progress line, never a blocking spinner; and only the small
durable fact that follows — *this set now has this file* — goes through the
queue as `set.attachVideo`.

`attachVideo` is separate from `updateSet` deliberately. That one demands load,
reps, RPE and the warm-up flag together so e1RM cannot go stale — right for an
edit, wrong for a video, which changes nothing about what was lifted. Making the
caller restate four numbers invites it to restate them wrongly.

### Detaching does not delete the file, and the ordering is why

The row clear is queued, so on a bad connection it may not land for minutes.
Deleting the file immediately leaves the row pointing at something gone — a
broken player in the coach's review queue, which is the state the first draft's
comment claimed to avoid while causing it. The other order needs the queue to
report when the write landed, which it does not. So the file is left and
reclaiming it is a sweep: an orphan is a storage bill, a broken player is a
coach losing trust in the review queue.

### Where a clip goes

One camera **per exercise**, attaching to the **most recently logged set of that
exercise** — straight from the Set Row spec. No row carries a camera; a per-row
one bought nothing and cost the confirm target its column, and confirm is what an
athlete hits 20–40 times a session. The button is **absent, not disabled**, until
there is a set to attach to. Warm-ups are eligible: a coach asking to see a
warm-up is asking about setup, and the warm-up rule is about numbers.

### Buckets are now schema-as-code

CLAUDE.md says infrastructure is never clicked into a console, and a bucket is
infrastructure — its size cap and extension list are as load-bearing as a column
type. `BucketSpec` joins `TableSpec`, the planner diffs every field, the applier
creates or corrects it. **Verified idempotent**: the second run reports "Schema
already matches."

`encryption` and `antivirus` are off deliberately. Appwrite skips encryption
above 20MB, so enabling it would encrypt short clips and silently not long ones —
a guarantee that holds only sometimes is worse than none. Antivirus needs ClamAV
beside the instance, which this one lacks; claiming it would make every apply
report drift it cannot fix.

### Permissions, proved on files rather than rows

A clip is stamped **per file**, and that is a different code path in Appwrite
from a row — a policy right for a set proves nothing about the video on it. So
the probe grew a **Set videos** section, run against the live instance:

- the athlete reads their own clip;
- the coach reads it — the whole review loop;
- a stranger cannot, and cannot list the bucket to find it;
- **the coach cannot delete the clip under review** (a review tool whose reviewer
  can destroy the thing under review is the wrong shape);
- the athlete can delete their own.

Probe now **42/42**.

### Verification

`typecheck` · `lint` · **1093 tests** · `build` · `appwrite:probe` **42/42**.
Schema **v5**, applied live and idempotent.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
