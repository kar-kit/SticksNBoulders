## Video upload and playback: tests that fail when the code breaks, plus two fixes

### Why

A mutation audit (break the source, run the suite) found the video path largely
unguarded: `lib/video/resumable-upload.ts` had no tests, `attachClipToSet` had
none, two limit tests compared code to itself, and neither `/api/clip` route had
a test. It also found two real bugs, both fixed here.

### Source fixes (failing test written first, watched fail, then fixed)

1. **`POST /api/clip` threw on a missing `VIDEO_TICKET_SECRET`.** `ticketSecret()`
   sat outside any try/catch, so the handler threw: a 500 with nothing in the log.
   The stream route already logged it. Both now log
   `clip: VIDEO_TICKET_SECRET is not configured` once and return
   `500 { error: "unavailable" }`.
2. **Playback broke after five minutes on one clip.** The stream route checks the
   ticket on every request, and every seek, frame step or loop past the buffer is
   a new Range request carrying the same URL. The queue only re-mints when
   `items` changes, so staying on a clip (or picking one from the rail) past five
   minutes gave "This clip would not play". The old comment in `ticket.ts`
   ("the stream, once started, is not interrupted by expiry") was true only for a
   response already in flight. `ClipPlayer` now takes `refreshSrc`. On a video
   error it asks once for a fresh URL and resumes at the same time and play
   state. If a fresh URL fails before it loads, the player treats that as final
   (revoked access, or the file is still uploading), so it never loops. It is
   wired into the review queue and the athlete videos list.

### Tests added, and the mutations they now catch

| Area | Mutation | Caught by |
|---|---|---|
| resumable-upload | 4xx marked retryable | 4xx reported permanent, stops sending |
| | 5xx / dropped connection marked permanent | retryable-failure tests |
| | resume from 0 instead of `chunksUploaded` | three resume tests |
| | report success without asking the server (L191-198) | unreadable final response, server not complete |
| | JWT minted per chunk | clean-upload test |
| attachClipToSet | forget pending after a retryable failure | keeps pending |
| | skip `enqueue("set.attachVideo")` | records the clip |
| | remember after upload / keep refused clip | order + drop tests |
| ticket | minimum 32→6, 32→33 | 31 throws, 32 passes |
| clip | `MAX_VIDEO_BYTES` → 300MB; extra extension | compared to `set_videos` in `appwrite/schema` |
| `/api/clip` | unwrap secret; mint for wrong user; skip JWT check; trust bad JWT | route tests |
| `/api/clip/[fileId]` | drop file-id comparison (L58); ignore expiry; drop log; drop Range | route tests |
| ClipPlayer / queue | never refresh; refresh forever; refresh once ever; lose position; lose play state; ignore failed refresh; queue not wired | player + queue tests |

29 mutations run, all 29 caught. The no-JWT test initially survived "drop the
`!jwt` check" (Appwrite rejects an empty JWT anyway); it now also asserts no
Appwrite lookup happens.

### Not done / worth knowing

- **There is no backoff.** `uploadResumable` does not retry. It reports
  `retryable`, and the retry is `resumeInterruptedUploads` on the next app
  start, capped at `MAX_UPLOAD_ATTEMPTS`. The tests cover that contract. Adding
  in-session backoff would be a product change, so I left it out.
- `athlete-videos.tsx` got the same `refreshSrc` wiring but has no test file.
  The behaviour lives in `ClipPlayer` and is tested there.
- The expiry diagnosis comes from reading the route and the media Range
  behaviour. Nobody reproduced it in a browser. Safari issues many small
  ranges, so it is the likeliest place to hit it.

### How to verify

`npm test`, `npm run lint`, `npm run typecheck`.
