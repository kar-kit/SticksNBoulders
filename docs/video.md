# Video on a set

_Order 29. Phase 3. Source: Joey. P0 Blocker._

> "Highest value feature in the product. Neither RTS nor Excel does it."

The set already carries load, reps, RPE and notes, so the context writes itself
and the essay-length WhatsApp message disappears.

## Two findings that shape everything downstream

### 1. The instance capped files at 30MB — raised, and where they now live

[Fact] `_APP_STORAGE_LIMIT` on the self-hosted instance is **30,000,000 bytes**.
`createBucket` rejects any `maximumFileSize` above it outright, with
*"Value must be a valid range between 1 and 30,000,000"*.

A 60-second 1080p clip from a modern phone is several times that.

**Resolved 15 Sep 2026.** Joey raised `_APP_STORAGE_LIMIT` to 200MB and moved
uploads onto the TrueNAS box. The bucket's `maximumFileSizeBytes` follows it in
schema-as-code, because Appwrite rejects a bucket asking for more than the
instance allows — if a bucket apply ever fails with "Invalid maximumFileSize",
the instance limit is what moved. `checkClip` still refuses an oversized file
*before* the upload starts, so an athlete on gym wifi is not told no after two
minutes, and Order 31's client-side compression should put real clips far below
the ceiling.

#### Where uploads actually live

`/storage/uploads` is no longer this VM's disk. It is an NFS mount from the
TrueNAS box:

| | |
| --- | --- |
| NAS export | `192.168.1.38:/mnt/Main/snd-data` (restricted to this host only) |
| Host mount | `/mnt/snb-data` — `_netdev,nofail,hard,noatime` |
| Bind device | `/mnt/snb-data/appwrite-uploads` |
| Compose volume | `appwrite-uploads-nas` |

`_APP_STORAGE_DEVICE` stays `local` — Appwrite still thinks it is writing to a
local path, and the NFS layer sits entirely below it. That is why this needed
no application change at all.

Three deliberate choices:

- **`hard`, not `soft`.** A soft mount returns a short write on timeout, which
  for primary video data means a silently corrupt file that looks like success.
- **`nofail`.** If the NAS is down at boot, this VM still boots. Appwrite then
  refuses to start, which is loud and recoverable.
- **`type: none, o: bind, device:` rather than a plain bind path.** If the mount
  is absent the device does not exist and the container *refuses to start*.
  A plain bind would silently create an empty local directory, Appwrite would
  write into it, and those files would appear to vanish when the NAS returned.
  Verified: Docker returns `failed to mount local volume … no such file or
  directory`.

A new volume name (`appwrite-uploads-nas`) rather than redefining
`appwrite-uploads`, because Docker will not apply driver options to a volume
that already exists and the alternative was deleting one on a live system for
no gain. The stock volume is still declared and untouched, so reverting is a
one-line change.

> ⚠️ **The Appwrite installer regenerates `docker-compose.yml` on upgrade.** The
> 1.9.0 → 1.9.6 upgrade already rewrote it once — that is how `worker-executions`
> went missing. After any future upgrade, re-apply the `appwrite-uploads-nas`
> volume and its five service mounts, or uploads silently return to local disk.
> The compose file lives at `/home/websprint-server/appwrite/docker-compose.yml`,
> with `docker-compose.yml.bak-prenfs` as the pre-move original.

> The NAS dataset now holds the **only** copy of every clip. It needs its own
> snapshot task; nothing else is backing it up.

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

Detaching clears the row through the queue and **does not delete the file**.
The ordering forces it: the clear is queued, so on a bad connection it may not
land for minutes, and deleting the file immediately would leave the row pointing
at a file that is gone — a broken player in the coach's review queue, the exact
state this is meant to avoid. Doing it the other way round needs the queue to
report when the write landed, which it does not. So the file is left behind and
reclaiming it is a sweep over files no set references: an orphan is a storage
bill, a broken player is a coach losing trust in the review queue, and between
the two this picks the bill.

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
| `components/logging/attach-video.tsx` | The camera button and its progress line |
| `appwrite/schema/` | `BucketSpec`, bucket planning and applying |

## Verified against the live instance

The permission probe grew a **Set videos** section, because a clip is stamped
per *file* and that is a different code path in Appwrite from a row — a policy
that is right for a set proves nothing about the video on it. Six cases, all
passing: the athlete reads their own clip, the coach reads it (the review loop),
a stranger cannot and cannot list the bucket to find it, the coach cannot delete
the clip under review, and the athlete can delete their own. Probe now 42/42.
