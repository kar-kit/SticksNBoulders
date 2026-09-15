## Order 31 — Chunked background upload

Two halves: resume is built, compression is recommended against.

### Resume, and why it had to be hand-rolled

The ticket asks whether Appwrite's chunked upload resumes after a dropped
connection or restarts from zero. It restarts from zero.

**It resumes at the protocol level and the SDK does not use it:**
`chunkedUpload` always starts at chunk 0, takes no existing upload id, and
never asks the server what it already holds. So `lib/video/resumable-upload.ts`
talks to the endpoint directly.

Three server behaviours make that safe, all verified against the instance
rather than assumed:

1. The upload id **is** the file id we choose, so a half-finished upload is
   addressable from state we already hold — including after a reload.
2. A user session can read `chunksUploaded` on an incomplete file, so the
   client finds its own resume point with no server route.
3. Re-sending a chunk the server already has is idempotent. A response lost in
   flight is harmless, so this errs toward sending again rather than stranding
   an upload.

Sequential, deliberately. Appwrite reports progress as a **count**, not a map
of which ranges landed, so uploading in order is what makes that number a
resume point. Parallel chunks do assemble correctly — also verified — but then
"four uploaded" cannot tell you *which* four. On gym wifi, resumable beats fast.

### Surviving a reload

The blob is kept in IndexedDB, not a reference: a `File` from an `<input>` is
gone the moment the page reloads, so an upload that could not survive that
would only survive the failures that were never going to lose it. It is a
**separate database** from the offline write queue — that one holds small rows,
is read on every render, and must stay fast.

The entry is written **before the first byte moves**. The gap between starting
and recording is exactly when a phone gets locked.

`resumeInterruptedUploads()` runs from the same effect that flushes the offline
queue, and is deliberately silent — the athlete already saw the set logged, and
a clip finishing in the background is not news worth interrupting them for.

Retries stop at `MAX_UPLOAD_ATTEMPTS = 5`. Any 4xx drops immediately; retrying
a 4xx is a loop, not resilience.

### Proved against the instance, not asserted

`npm run e2e:video` drives the real `uploadResumable` against the live server
with an 11.7MB file — two and a half chunks, deliberately not a round number,
so the short final range is exercised. It interrupts the upload the moment the
first chunk is confirmed, resumes, and compares a SHA-256 of what came back
against what went up.

Unit tests cannot catch the failure that actually matters here. A
`content-range` built from the slice rather than the whole file assembles into
a corrupt clip **and still reports success** — every chunk 200s,
`chunksUploaded` reaches the total, and the coach opens a broken video weeks
later. Only the hash catches it.

8/8 pass. Writing it found two things:

- **The JWT was being minted per chunk.** A 150MB clip is thirty chunks, so
  thirty round trips before any bytes move, on precisely the connection this
  module exists to tolerate. Appwrite's JWTs last fifteen minutes; one per
  attempt is enough. Hoisted.
- **An athlete not in their own circle team cannot upload at all.** A clip
  names that team as a reader, and Appwrite only lets a caller stamp roles it
  holds — the same restriction that made reference maxes server-only at
  Order 17. The symptom is a 401 on the first chunk with a message about
  permissions, which reads like an auth bug and is not one. Onboarding already
  calls `/api/circle` and `ensureCircle` is idempotent, so nothing is broken;
  the dependency was just invisible. The e2e now asserts the refusal.

### Compression: recommended against, for now

**Compression is not built, and the ticket's own metadata is the argument.**
Order 31 is `Inferred`, nobody asked for it, and CLAUDE.md says to say so
rather than grinding out an awkward one.

- ffmpeg.wasm is a ~25MB bundle against a 2.5s interactive budget. Speed is
  constraint #1 and this trades it away for a problem we do not have.
- WebCodecs is the light alternative and is only partially there on iOS Safari,
  which is the athlete's phone.
- The stated reason is Cloud cost economics for January 2027, not the beta.
- Nothing is blocked: uploads land on 941GB of NAS behind a 200MB ceiling.

The better shape, if it becomes real: record in-app with `MediaRecorder` at a
capped bitrate, so the phone never produces the large file in the first place.
That costs an in-app camera UI instead of the system one — a product decision
for Joey, not a technical one.

### [SME to confirm]

Resume-after-reload assumes the blob is still in IndexedDB. Browsers evict
under storage pressure, and a phone that is nearly full may drop it. Worth
knowing whether athletes' phones routinely run near capacity before relying on
this for a long session.

### Verification

`typecheck` · `lint` · **1111 tests, 71 files** · `build` · `perf:check` within
the 2.5s interactive budget · `e2e:video` 8/8 against the live instance.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
