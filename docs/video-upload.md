# Resumable background upload

_Order 31. Phase 3. Source: **Inferred**. P1 Must._

> "Gym wifi drops. Compress client side before upload from day one, because
> video is the variable cost that sets the price floor."

The ticket has two halves. One is built. The other is a recommendation not to
build it yet, and the ticket's own metadata is why.

## Resume: built

The `[Unverified]` on this ticket — *does Appwrite resume after a dropped
connection or restart?* — was closed during Order 29. **It resumes at the
protocol level; the SDK does not use it.** `Client.chunkedUpload` always starts
at chunk 0, accepts no existing upload id, and never asks the server what it
already holds. So a drop on gym wifi costs the whole file.

This module hand-rolls the upload instead. Four facts make that safe, all
verified against the live instance rather than assumed:

| | |
| --- | --- |
| The upload id **is** the file id we choose | a half-finished upload is addressable from state we already hold, including after a reload |
| A **user session** can read `chunksUploaded` on an incomplete file | the client discovers its own resume point; no server route needed |
| Re-sending a chunk the server has is **idempotent** | the count does not double-count, so a response lost in flight is harmless |
| Out-of-order chunks **do** assemble correctly | so parallelism is possible — and still rejected, see below |

### Why it uploads sequentially

Appwrite reports progress as `chunksUploaded` — a **count**, not a map of which
ranges landed. Sequential upload makes that number mean *"chunks 0…n−1 are in"*,
which is a resume point. The SDK's concurrency of 8 would make the same number
mean *"some four of these landed"*, which is not.

Out-of-order chunks assemble fine, so parallel would work — it just would not be
resumable. On gym wifi, resumable beats fast.

### Surviving a reload

The blob is kept in IndexedDB, not just a reference. A `File` from an `<input>`
is gone the moment the page reloads, so an upload that could not survive that
would only survive the failures that were never going to lose it anyway.

It's a **separate database** from the offline write queue. That one holds small
rows, is read on every render, and must stay fast; mixing a 40MB blob into it is
how the log screen gets slow on a phone.

The entry is written **before the first byte moves**. An upload the app does not
know about cannot be resumed, and the gap between starting and recording is
exactly when a phone gets locked.

`resumeInterruptedUploads()` runs from the same effect that flushes the offline
queue — the moment the app learns who it is writing as, and the moment anything
left over from a dead battery starts moving. Deliberately silent: the athlete
already saw the set logged, and a clip finishing in the background is not news.

Retries stop at `MAX_UPLOAD_ATTEMPTS = 5`. The failures this exists for are
transient; anything surviving five separate app launches is broken in a way
retrying will not fix, and tens of megabytes should not sit in a phone's quota
forever. A permanent rejection (any 4xx — wrong type, too large, expired
session) drops immediately, because retrying a 4xx is a loop, not resilience.

**[SME to confirm]** — resume-after-reload assumes the blob is still in
IndexedDB. Browsers evict under storage pressure, and a phone that is nearly
full may drop it. Worth knowing whether athletes' phones routinely run near
capacity before relying on this for a long session.

## Proved against the instance, not asserted

`npm run e2e:video` drives the real `uploadResumable` against the live server
with an 11.7MB file — two and a half chunks, deliberately not a round number, so
the short final range is exercised. It interrupts the upload the moment the
first chunk is confirmed, resumes, and then compares a SHA-256 of what came back
against what went up.

Unit tests cannot catch the failure that actually matters here. A `content-range`
built from the slice rather than the whole file assembles into a corrupt clip
**and still reports success** — every chunk 200s, `chunksUploaded` reaches the
total, and the coach opens a broken video weeks later. Only the hash catches it.

What the run establishes:

- The clip that comes back is byte-for-byte the clip that went up, across a
  resume boundary.
- A JWT is accepted for a chunked **write**. The earlier probe only proved reads.
- Resume sends two chunks of three, not three of three. A resume that re-sent
  everything would pass a hash check and still be worthless on gym wifi.
- One JWT is minted per upload attempt, not per chunk. A 150MB clip is 30
  chunks; minting one each would be 30 avoidable round trips before any bytes
  move, on precisely the connection this module exists to tolerate.

### The circle dependency

An athlete who is not a member of their own circle team **cannot upload at all**.
A clip is stamped `read("team:circle_<id>")`, and Appwrite only permits a caller
to stamp roles it actually holds. The symptom is a 401 on the first chunk with a
message about permissions, which reads like an auth bug and is not one —
onboarding calls `/api/circle`, and `ensureCircle` is idempotent, so the repair
is to call it again. The e2e asserts this failure rather than leaving it to be
rediscovered at 2am.

## Compression: recommended against, for now

Order 31 is **`Inferred`** — nobody asked for it. CLAUDE.md is explicit that
Inferred items are proposals and *"if one is awkward to build, say so rather
than grinding it out."* This one is awkward.

**Browser-side video compression on an iPhone is a bigger piece of work than the
one-line note suggests.** `ffmpeg.wasm` is a ~25MB bundle against a 2.5s
interactive budget that the build plan calls a non-negotiable. WebCodecs
`VideoEncoder` is the alternative and its iOS Safari support is partial — the
kind that works in testing and fails on someone's phone mid-session, which is
the worst way to discover it.

**Nothing is currently blocked by its absence.** The stated reason is cost
economics for the Cloud migration in January, not the beta. As of 15 Sep 2026
uploads land on the TrueNAS box with 941GB free and a 200MB per-file ceiling, so
a real clip fits with room to spare.

**If it becomes necessary, capture is probably cheaper than transcoding.**
Recording in-app through `MediaRecorder` at a chosen bitrate avoids re-encoding
entirely — the phone never produces the large file in the first place. It costs
an in-app camera UI instead of the system one, which is a product decision for
Joey rather than a technical one.

## Files

| File | What it holds |
| --- | --- |
| `lib/video/chunks.ts` | Pure chunk arithmetic: ranges, resume point, progress |
| `lib/video/resumable-upload.ts` | The hand-rolled transport |
| `lib/video/pending-store.ts` | Interrupted uploads, blob included, in IndexedDB |
| `lib/video/upload.ts` | `attachClipToSet`, `resumeInterruptedUploads` |
| `scripts/e2e-video.mts` | Proves the above against the live instance |
