## fix(video): never lose a clip to an expired session, and pin the clip stream's auth

Two findings from the 9 Oct test audit.

### 1. A clip was deleted when the session expired mid-upload (audit B4, confirmed)

The audit guessed this from reading the code. A test confirmed it. `sendChunk` treated every 4xx as permanent, 401 included. `attachClipToSet` and `resumeInterruptedUploads` then called `forgetUpload`, which deleted the blob from IndexedDB. The JWT is minted once per attempt and lasts 15 minutes, so a 150 MB clip on slow gym wifi could outlive its token and be lost. The new transport test "mints one fresh JWT and resends the refused chunk" failed on `dev` with `{ ok: false, retryable: false }`.

**Changes**
- `lib/video/resumable-upload.ts`: on a 401, mint **one** fresh JWT per attempt and resend the refused chunk.
  - If no JWT can be minted (signed out), the result is `{ retryable: true, authExpired: true }` and the clip is kept.
  - If the **fresh** JWT is refused as well, the 401 was never about the session, so the result is a permanent refusal (`retryable: false`) and the clip is dropped as before. This is the athlete-with-no-circle case in `scripts/e2e-video.mts:139-158`: Appwrite returns a 401 about permissions on the first chunk, whatever the token. The first version of this fix held that clip as pending forever, which failed `e2e:video` (7/8).
  - A 401 on a later chunk, after an earlier refresh worked, is kept as pending without a second mint. 408 and 429 are now retryable as well, matching the offline queue's `classify`. Other 4xx (wrong type, too large) are still permanent.
- `lib/video/upload.ts`: a kept clip now returns `reason: "pending"` instead of `"failed"`. When sign-in is the blocker, the message says signing in will send it. On resume, a sign-in failure refunds its attempt (`refundAttempt`, new in `pending-store.ts`). Without that, five app starts while signed out would reach `MAX_UPLOAD_ATTEMPTS` and delete a clip the server never refused.
- `components/logging/attach-video.tsx`: a pending clip shows **"Video pending"** with the message (`data-upload="pending"`) and counts as on its way, so the coach's nudge stops. A refused clip is still shown as a failure.
- Signing back in already re-runs `resumeInterruptedUploads()` (the `athleteId` effect in `session-context.tsx`), which picks up from the last confirmed chunk. The Feedback screen already lists pending uploads from IndexedDB.
- `docs/video-upload.md`: the retry policy is updated.

### 2. Clip stream auth had no test that could fail (audit C07, C03–C06)

`app/api/clip/[fileId]/route.ts` is correct today. Before this change, though, adding `x-appwrite-key` to the storage read would have turned it into an unauthenticated admin read of every clip, and every test would still have passed. I checked this against `dev`: that mutation **survived** the old tests. The fake storage served any file to any caller, and the header check used `toMatchObject`.

**Changes (tests only, no route change)**
- The fake storage now models Appwrite permissions. The API key reads everything; a JWT reads only that user's files.
- Upstream headers are checked with exact equality, and `x-appwrite-key` must be absent.
- A valid ticket for a clip its holder can't read streams nothing: 404, with no upstream body leaked.
- Missing, expired, forged, payload-edited, malformed and wrong-file tickets never create the admin client and never mint a JWT.
- The JWT is minted only for the ticket's user. Query params such as `u`, `user` and `userId` are ignored.
- `Cache-Control: no-store, private`, `nosniff`, and the forward allowlist (`set-cookie` and `x-appwrite-session` dropped).

### Testing
- Tests were written first. The transport and upload tests failed on `dev` and pass with the fix.
- Mutation-checked. All 11 upload-path mutations were killed: no refresh, 401 classed as permanent, 408/429 dropped, no resend, no refund, forgetting on auth, wrong message, refresh per chunk instead of per attempt, and two UI mutations. Three more for the persistent-401 follow-up were killed as well: no reclassification after a fresh JWT is refused, the reclassification left retryable, and signed-out-on-refresh treated as permanent. All 9 clip-route mutations were killed: admin key added, admin key instead of JWT, fileId check removed, admin client created eagerly, upstream body passed through, `set-cookie` forwarded, nosniff removed, Cache-Control changed, and JWT user taken from the query.
- `npm test` passed (169 files). `npm run lint` and `npx tsc --noEmit` are clean.
- Not run here: `e2e:video` against the live instance. It reported 7/8 on the first version, failing the no-circle check. The follow-up commit targets that check and needs a rerun.

### Decisions for Joey
- **A 401 is told apart by behaviour, not by Appwrite's error `type`.** A 401 that a JWT minted a moment ago also gets is treated as a refusal. That doesn't depend on Appwrite's error-type strings, which aren't pinned anywhere in the repo. The trade-off: a session revoked in the instant between the fresh mint and the resend would drop the clip instead of keeping it. I judged that unlikely enough to accept.
- **Refused tickets still return 404, not 401/403.** The brief asked for 401/403 on expired or forged tickets. The route and `ticket.ts` deliberately give one opaque 404 for every refusal, and the player's refresh fires on any error status, so I pinned the existing 404. Switching would be a one-line change per branch plus test updates. Say if you want it.
- **403 on an upload chunk is still permanent.** The queue retries 403, but on a storage create Appwrite's 403 means the bucket refused the file. Retrying it would loop until the attempt cap.
- **`refundAttempt` has no unit test.** It is raw IndexedDB glue, like the rest of `pending-store.ts` (audit Q2: always mocked). The `upload.test.ts` mock pins that it is called. Adding `fake-indexeddb` would cover it, but that is a new dependency.
- **The 15-minute JWT lifetime is still [Unverified]** against the instance's configured TTL. The fix doesn't depend on the exact value.
- **"Video pending" stays on that camera only until the screen reloads.** After a reload, pending clips still show on Feedback (from IndexedDB), but the Log screen's camera goes back to "Add video". A per-set pending marker on the Log screen would be a follow-up.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
