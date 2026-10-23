# Video on a set

_Order 29. Phase 3. Source: Joey. P0 Blocker._

> "Highest value feature in the product. Neither RTS nor Excel does it."

The set already carries load, reps, RPE and notes, so the context writes itself
and the essay-length WhatsApp message disappears.

## Which lifts get filmed

[Fact] Asked which lifts he wants on video, Ruairi answered: *Mainly compounds
but if you have questions on accessories or variations do record too* (Ruairi
form answer, 6 Oct 2026). That is the default expectation: compounds filmed,
accessories and variations when the athlete has a question.

[Fact] The code has no compound or accessory classification on an exercise.
What it has is a per-exercise default, `exercises.video_default`, seeded on
for Squat, Bench Press and Deadlift only, which pre-ticks the per-line
`video_required` box when a coach adds a line in the Program Editor (Order 30,
`docs/programs.md`); the coach can untick it, or tick it by hand on any
accessory or variation. `video_required` is a nudge and never a gate. The
mechanism is described in "Which lifts get video: compounds by default, the
coach flags the rest" at the end of this document. Beyond that default, the
expectation lives in the coach's habit and the athlete's briefing, not in the
product.

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

> `npm run appwrite:backup` now copies every finished clip, with its
> permissions, into `SNB_BACKUP_DIR` and on to `SNB_BACKUP_OFFSITE`
> (docs/backups.md). A ZFS snapshot task on the dataset is still worth having:
> it is the fast undo for a bad delete, and the dump is the copy that survives
> the pool.

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
the two this picks the bill. The sweep is `npm run clips:sweep`, a dry run
unless given `--delete`; see docs/backups.md §6.

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
| `lib/video/poster-capture.ts`, `poster-upload.ts`, `poster-cache.ts` | F12 posters: grab, upload, show |
| `scripts/clip-posters.ts`, `backfill-clip-posters.mts` | `npm run clips:posters` |
| `lib/video/my-clips.ts`, `my-clips-store.ts` | F13: the athlete's own clips, paged, and delete / replace |
| `app/(athlete)/history/clips-view.tsx`, `clips/[setId]/` | F13: the Clips grid and one clip |

## Verified against the live instance

The permission probe grew a **Set videos** section, because a clip is stamped
per *file* and that is a different code path in Appwrite from a row — a policy
that is right for a set proves nothing about the video on it. Six cases, all
passing: the athlete reads their own clip, the coach reads it (the review loop),
a stranger cannot and cannot list the bucket to find it, the coach cannot delete
the clip under review, and the athlete can delete their own. Probe now 42/42.

<!-- BEGIN: video default (compounds by default) -->
## Which lifts get video: compounds by default, the coach flags the rest

Ruairi, asked which lifts he wants filmed: "Mainly compounds but if you have
questions on accessories or variations do record too." [Fact] Verbatim from the
brief. The product reads that as a default the coach can override, not a rule.

`exercises.video_default` is an optional boolean, null on every row written
before it existed, and null reads as false. When a coach **adds a line** for an
exercise whose default is on, the Program Editor sends the new line with
`videoRequired: true`, so the Video box arrives ticked. The coach can untick it,
and can tick it on any accessory or variation, exactly as before.

What it does not do:

- **It never gates logging.** Nothing in the logger reads it. `video_required`
  stays a nudge and any set can carry a clip regardless.
- **It never changes an existing line.** The pre-tick happens once, in the
  editor, at add time. Swapping a line's exercise, `duplicateWeek` and
  `copyProgram` leave the flag as the coach set it; both copies carry
  `video_required` as stored, not as the exercise's default would now say.
- **The server does not consult it.** `addPrescription` writes the
  `videoRequired` it was sent (false when absent), so the line's flag is always
  an explicit choice on the row.

The seed sets it for the three competition lifts only: Squat, Bench Press,
Deadlift (`VIDEO_DEFAULT_EXERCISES` in `lib/exercises/seed.ts`).
`npm run exercises:seed` reconciles it on existing rows as well as new ones.
Order of operations on a live instance: `npm run appwrite:setup` first (adds
the column), then the seed.

[SME to confirm] Whether variations count as compounds (Pause Squat, Tempo
Bench Press, Close Grip Bench Press, Sumo Deadlift, Romanian Deadlift ...) is
Ruairi's call. His quote says to record variations "if you have questions", which
reads as coach-flagged rather than default. Not guessed at here.
<!-- END: video default (compounds by default) -->

<!-- BEGIN: clip posters (F12, schema v17) -->
## Thumbnails: a poster frame per clip (F12, schema v17)

Appwrite file previews are image-only, so a clip had no thumbnail anywhere.
Each clip now gets a **poster**: one frame, longer edge 320px, WebP or JPEG,
in its own bucket `set_video_posters`, named by `sets.video_poster_id`.

**Where it is made.** On the phone, at upload (`lib/video/poster-capture.ts`):
a hidden muted `playsinline` `<video>` on a blob URL of the picked file, seeked
to 0.5s (a third of a shorter clip; frame 0 is often black), drawn to a canvas
and encoded WebP, falling back to JPEG when the browser hands back a PNG
(Safari). Grab and poster upload start the moment the clip is picked and run
while the clip uploads (`lib/video/poster-upload.ts`); the poster id rides in
the same `set.attachVideo` op, and the clip stays in IndexedDB until that op is
queued. Every failure -- undecodable codec, a seek that never completes (8s
cap), an upload that fails or takes over 10s, a file already at the poster id
with someone else's permissions -- is logged and the clip attaches without a
poster. A poster never delays or fails a set or a clip.
A resumed upload makes its poster from the blob kept in IndexedDB.

[Inference] iOS Safari decodes the iPhone's own HEVC `.mov` natively, so
capture should work for iPhone clips; it needs `muted` + `playsinline`, both
set. [Unverified] on a real device. [Inference] Chrome on Android decodes HEVC
only where the phone's hardware does, so some Android HEVC clips will yield no
poster and fall back to the placeholder until the backfill makes one.

**The id is derived, not random:** `<clipId>_poster` (`appwrite/documents/poster.ts`).
Retries, resumes and the backfill all aim at one file (409 = already there),
and deleting a set's clip deletes its poster without queueing anything new
(`lib/video/clip-cleanup.ts`). Readers accept `video_poster_id` only when it
is the poster of the row's own `video_file_id` (`posterOf`), so a stale one
reads as none rather than showing a frame of a different rep.

**Permissions** are the clip's, by definition: `posterPermissions` is
`videoPermissions`. Audit rule `set_video_posters` mirrors `set_videos` cell
for cell. The bucket is encrypted (every file is far under Appwrite's 20MB
encryption cutoff) and capped at 1MB.

**Where it shows** (`components/video/clip-thumb.tsx`, a camera placeholder
whenever there is no poster or it cannot be read): logged set rows on the Log
and in History (in the badge corner, never a column), the coach's athlete
Videos list, and the Review Queue rail from md up. Bytes are fetched through
the SDK like profile pictures (`lib/video/poster-cache.ts`), at most four at a
time and only once a thumbnail is near the screen.

**Backfill.** `npm run clips:posters` plans (reads only); `-- --yes` renders a
frame with ffmpeg for every authentic set with a clip and no valid poster,
uploads it with the athlete's poster stamp, and points the set through
`setPosterOnSet` (`appwrite/documents/poster-admin.ts`). Idempotent; refuses to
point at a file at the poster id with any other permissions; re-reads each row
before writing and skips one whose clip changed. Needs ffmpeg on PATH or
`SNB_FFMPEG`. Order on a live instance: `npm run appwrite:setup` (v17) before
deploying the client, then the backfill.
<!-- END: clip posters (F12, schema v17) -->

<!-- BEGIN: athlete clips gallery (F13) -->
## The athlete's own clips (F13)

History has a **Sessions | Clips** switch at the top (the tab bar stays at
four tabs). Clips is every set the athlete filmed, newest first, as a
three-column grid of posters (F12; the camera placeholder where there is none),
with a row of lift chips to filter it. A tile opens `/history/clips/<setId>`, a
route rather than a dialog, so Back, deep links and F7's push all work. The
switch lives in `?view=clips`, swapped with `replaceState`.

**Own clips only.** Every read filters `athlete_id` to the signed-in athlete,
keeps only rows they authored (`authenticRows`), and checks the owner again
after parsing (`lib/video/my-clips-store.ts`). This matters because a coach who
also trains sits in their athletes' circle teams, so Appwrite would serve them
those sets, and the playback ticket carries identity, not authority. A deep
link to somebody else's set reads as "not found", and no ticket is minted.

**Paging.** Cursor pages of 36 on `logged_at` desc (`idx_athlete_logged`), with
"Load more clips". The lift filter is a server query too
(`idx_athlete_exercise`), so a chosen lift shows all of that lift's clips, not
the ones in the first page. The chips come from the unfiltered pages loaded so
far, most-filmed first. A lift filmed only before the loaded pages has no chip
until "Load more" reaches it.

**One clip** is built from the coach's parts: `ClipPlayer` (now
`components/video/clip-player.tsx`, motion gated `coach:` / `athlete:`, with a
`failedMessage` prop and `shortcuts="none"` so Space presses the screen's own
buttons instead of toggling the video), `CommentThread` (with a `fallbackName` prop), the
Feedback screen's `ReplyBox`, History's `SetNoteField` saved through `editSet`
(restating the set's own values, warm-up flag included, which is why `ClipSet`
now reads `is_warmup`), and the Log's `AttachVideo` for Replace, poster capture
included. Playback is the usual short-lived ticket from `/api/clip`.

**Delete and replace take the file, not just the row.** Delete queues the
detach (`set.attachVideo` with nulls) and then `clip.delete` behind it.
Replace queues `clip.delete` for the old file once the new clip's attach is
queued; if the new upload is still pending, the old file stays for
`clips:sweep`. Delete also forgets any replacement still in the resumable-upload
store for that set, and is disabled while one uploads from the screen, so a
finished upload cannot re-attach a clip the athlete deleted. `deleteClipIfUnused` (was `deleteClipIfSetGone`) now also
deletes a file, with its poster, when the set still exists but names another
file or none. A row that still names the file, or whose column cannot be read,
keeps it. The queue is strictly ordered, so the file never goes while a row
still points at it. The set, its numbers, the note and any coach comments stay.

**Offline.** Queued `set.attachVideo`, `set.delete` and `set.update` ops are
laid over what the server returned (`withQueuedClipState`): a clip deleted
with no signal stays gone after a reload, a replacement shows its new file,
and an edited note shows as edited, each with the pending dot. A failed first
page offers a retry, and a failed "Load more" keeps the grid. Clips still in
the resumable-upload store are counted in one line above the grid.

**No schema or permission change.** Athlete replies were already proved under
the symmetric comment policy (docs/comments.md), and `videoPermissions` already
lets the athlete delete their own clip and poster.

Known edges, for Joey:

- Replacing a clip the coach has already cleared does not put it back in their
  Review Queue. `set_reviews` is keyed on coach + set, and the Log's Replace
  has always behaved this way. Re-queueing would need a column on
  `set_reviews` or on `sets` (a v18).
- After a delete or replace, the coach's comments stay on the set and now
  describe a clip that is gone or a different take. The delete confirm says
  so.
<!-- END: athlete clips gallery (F13) -->
