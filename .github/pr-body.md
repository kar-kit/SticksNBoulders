## fix(offline): set-logging queue integrity (shared phone, full storage, withdrawn sets)

Three fixes to the offline set queue, from the 2026-10-09 test audit (Summary items 3 and 4, e2e P0-3, athlete U03 and C02/Q3). Each fix has tests that fail on `dev` and pass here. Each test was mutation-checked: reverting the fix makes it fail again.

### 1. Shared phone: A's unsent sets were sent as B (confirmed)

**The bug.** Athlete A logs with no signal and signs out. Athlete B signs in on the same phone, and A's queued session and sets go to Appwrite as B. The runner stamps the attached actor onto every row, so A's training was written into B's account under B's permissions, where B's coach could read it. Queued ops had no owner, `signOut` never touched the queue, and `attachQueue` swapped the actor.

**Evidence.** `lib/offline/client.test.ts › a shared phone` uses the real `client.ts` and `queue.ts` with a mocked runner. On `dev` it fails with `expected [ 'athlete-b:session.create', 'athlete-b:set.create', 'athlete-b:set.create' ] to deeply equal []`, in the same tab and after a reload.

**The fix.**
- `QueuedOp.ownerId` is stamped at enqueue. The queue's cache, and so every screen, only holds the attached athlete's ops. Other athletes' ops stay on disk untouched. They are held, not dropped, and flush exactly once, as their owner, when that athlete signs back in on the phone.
- `detachQueue()` is called from `signOut`: nothing is sent with nobody signed in. A drain stops if the athlete changes under it.
- `resumeInterruptedUploads(athleteId)` only resumes the signed-in athlete's clips. Before this, A's half-uploaded clip would have finished under B's session.
- If training is still waiting to sync, Me → Sign out asks first: "Some of your training hasn't synced yet. It stays on this phone and sends the next time you sign in here." The options are Stay signed in and Sign out anyway. Permanently refused ops don't trigger the warning, because they won't send on a later sign-in either.

### 2. Full storage: a set looked logged and wasn't

**The bug.** `confirmSet` showed the row as logged and started the rest timer before `logSet` had written to IndexedDB. When the write failed, the row went back to "planned" with nothing said, and the rest timer kept running. `writeLocal` swallowing its error was a red herring for the set itself, because localStorage only backs conveniences (rest timer, cached session). Tests now pin that.

**The fix.** A failed write is now always surfaced and undone, never silent.
- **On confirm:** the row leaves the plan at once and shows in the logged list with the existing "Queued, will sync" mark until `logSet` has it on disk. The rest timer starts on the tap, as on `dev`.
- **On a failed write:** the row comes off the logged list and goes back to the head of its exercise with its numbers. The rest is put back to whatever was running before. A `role="alert"` says "That set wasn't saved — this phone couldn't store it. Your numbers are still in the row. Free up some space, then tap it again." The next tap retries with the same client id.

*Revised twice after e2e feedback.*
1. **First version:** it kept the row in the plan until the write landed. Add set tapped inside that window built a row behind a still-planned head. That broke e2e-session (a stray "Set 2") and e2e-offline (no "Log Set 2").
2. **Second version:** it started the rest only after `logSet` resolved. That is two sequential IndexedDB writes (`set.create`, then `rollup.refresh`), so e2e-session's "rest timer started as usual" check, made the moment "Log Set 4" appears, ran before the timer existed. The delay was only those writes; the timer did appear afterwards. Starting it on the tap removes the race instead of making the script wait.

Three component tests replay these e2e sequences over a queue whose disk takes 50ms per write. Each fails on the version it caught and passes on `dev` and here.

`logSet` no longer throws once `set.create` is on disk. Before, a `rollup.refresh` that couldn't be queued made the screen take back a set that would still sync.

### 3. Withdrawn-op test was hollow, and hid a real race

**The test.** The old test enqueued the set after the drain had taken its snapshot, so it passed even with the snapshot guard deleted. It now seeds both ops before `attachQueue`, so both are in the batch.

**The race.** Writing the test properly exposed a real bug. `withdrawSet` removed ops from IndexedDB first and from the in-memory cache after. A drain that moved on during that delete still found the set and sent it, while `withdrawSet` had already returned `landed: false`, so no `set.delete` was queued behind it. The athlete's deleted set stayed on the coach's side. Now the cache drops the op synchronously, before the disk delete. A new test gates the disk delete to reproduce the race; it fails on the old ordering.

### Testing
- `npm test`: 172 files, 2656 tests pass. `npx tsc --noEmit` is clean after `npx next typegen`. `npm run lint` is clean.
- New and changed tests:
  - `lib/offline/client.test.ts` (shared phone ×7, withdrawn op ×2)
  - `lib/auth/session.test.ts`
  - `app/(athlete)/me/me-panel.test.tsx`
  - `lib/video/upload.test.ts`
  - `lib/logging/set-store.test.ts`
  - `app/(athlete)/log/log-screen.test.tsx` (mocked and real-queue storage-full paths, queued-until-written, the rest being restored on failure, and three e2e tap sequences over a 50ms disk)
  - `lib/local-store.test.ts`
- Mutation checks, each turning at least one test red:
  - the owner filter, adoption, `owner` assignment, `detachQueue`'s actor clear and the mid-drain actor check
  - the upload athlete filter and `signOut`'s `detachQueue()`
  - the sign-out warning branch
  - the snapshot guard and withdraw ordering
  - `setUnsaved(true)`, the saving mark, the rest revert (removed, or clearing instead of restoring), the rollup `.catch`, and `writeLocal`'s try/catch
- Not run here: the live e2e suites. e2e:offline passed 46/46 on 0eebc93. e2e:session failed 1/71 there (the rest-timer check); the fix is above and needs a re-run, plus P0-3.

### Decisions for Joey
1. **Ops queued before this release have no owner, and the first athlete to open the app adopts them.** On a one-athlete phone, which is nearly every phone, that's the right owner. The alternative is stranding sets nobody can ever send. The leak survives only if a phone was shared and still had an unsynced queue at upgrade time. Should we hold unowned ops instead?
2. **Sign-out warns but doesn't block.** It doesn't try a last flush either. Should we add a short `flush(true)` before the warning, so an online phone usually skips it?
3. **B never sees that A's ops are being held.** They are invisible to B. P0-3 also allowed a "belongs to another account" notice. Showing one would tell B that someone else has unsynced training on the phone, so it is a privacy trade-off.
4. **The rest timer starts on the tap, before the set is on disk.** If the write then fails, the rest is withdrawn along with the set, and the alert says why. Holding the rest until the write lands (version 2) was more literal about "saved" but put IndexedDB latency on screen. If IndexedDB hangs (older iOS Safari has had this bug), the set stays marked queued with no alert. A timeout raising the same alert is a possible follow-up.
5. **Still open:** `openQueueStore` falls back to an in-memory store when IndexedDB can't open (private mode, blocked). Sets then show as saved but are lost on reload, and nothing tells the athlete. It's out of scope here and worth a follow-up banner.
6. **Still open:** two tabs on one phone share a queue (audit B7). Not addressed here.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
