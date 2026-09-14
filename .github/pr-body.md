## FTP1-9 — Offline logging with sync queue (Order 9)

> *"IndexedDB write ahead queue with optimistic UI. Not a CRDT, sets are append mostly and edited by one person. Gym signal is bad and a lost set is unforgivable."*

Every write an athlete makes during a session now goes to a durable queue on the device first and to Appwrite afterwards. `logSet` resolves once the op is on disk, not once the server has it. Whether there is signal in the room changes nothing about how long the confirm square takes or what happens next.

```
tap ✓ ──► IndexedDB ──► flush ──► Appwrite
          (durable)     (ordered,  (authoritative)
                         backs off)
```

### The decision everything else hangs off

**The client id *is* the Appwrite row id.** `st-68c5...` is 23 characters of lowercase, digits and a hyphen, which is a legal row id (Appwrite allows 36 and forbids a leading special char).

So there is no local-id-to-server-id mapping anywhere, and no moment where an id changes:

- A set logged in a basement references a session whose id exists before the session row does. Appwrite has no foreign keys, so nothing breaks.
- A retry cannot write a row twice, because the second attempt carries the same row id as the first. The unique indexes on `client_set_id` / `client_session_id` are a belt alongside that brace rather than the only thing between a dropped response and a duplicated set.
- A 409 is success, always. It can only mean our own earlier attempt landed with the response lost on the way back.

Five op kinds: `session.create`, `session.finish`, `set.create`, `set.delete`, `exercise.create`.

### Order, and the op that would have killed the queue

Ops flush strictly in the order they were written, and one op waiting holds the ones behind it — a set must not reach Appwrite before its session, an undo must not overtake the set it removes.

That is only safe because a write that can never succeed drops out of the line. `classify` splits *retry later* (no status at all, 401, 403, 408, 429, 5xx) from *this will never work* (400, 404). Without it, one malformed op retries forever at the head while every real set stalls behind — a queue that looks busy and is dead.

A permanently failed op is **kept**, not deleted. It is evidence that something an athlete logged did not reach their coach, and the screen says so in words. Offline itself stays a quiet dot.

```
 3  ·  140 kg  ·  5  ·  RPE 8   ✓  •
                          queued · no signal
```

### `navigator.onLine` is a hint, never a gate

It reports whether an interface is up, not whether Appwrite is reachable, and gym wifi that associates but routes nowhere reports online all session. So a write is always attempted and the real signal is the attempt failing. Flushes fire on: a new op, the `online` event, the tab becoming visible, and a 5s heartbeat while anything waits. Backoff doubles to a one-minute ceiling.

### Three reads that also had to survive a cold start

Writing the queue turned these up. Without them there would have been nothing to queue.

| What | Why |
| --- | --- |
| **The signed-in athlete** | A session lookup that could not reach Appwrite used to sign the athlete out — mid-session, to a sign-in screen that also needs the network. A lookup that fails for lack of signal now falls back to the last known user. One the server actually *refuses* still signs them out. |
| **The exercise library** | Otherwise the typeahead is empty and nobody can name the lift they are standing under. |
| **The running session** | For the session that synced at the gym door and could not be read back later. Expires after 12 hours, so a finish that never ran cannot block starting a new one. |

All three are localStorage — losing them costs a round trip. The queue gets IndexedDB (and asks for persistent storage), because losing it costs someone's training.

### Bugs the e2e caught

- **Sets vanished at the exact moment they succeeded.** The screen's list was derived from the queue, and an op leaves the queue the instant Appwrite accepts it — so the session totals went with them and the finish screen claimed nothing had been logged. Sets this device logged now live in their own state and only leave it by being undone.
- **Two effects raced.** The fold and the session reset were both deferred through a microtask and ran in declaration order, so the reset wiped the merge. One effect now, keyed on both.
- **`e2e:auth` had been broken since the shell landed** — it still looked for the athlete's name and Sign out on Today after both moved to Me. Predates this ticket; fixed while here.

### Verification

```
npm test              692 passed (47 files)
npm run e2e:offline    31/31
npm run e2e:session    27/27
npm run e2e:auth       24/24
npm run e2e:shell      15/15
npm run appwrite:probe 19/19
npm run perf:check     interactive 629ms on Slow 4G
```

`e2e:offline` is the one that matters. It cuts Appwrite off, starts a session, logs a warm-up and two working sets, **invents a lift the library has never heard of and logs a set into that**, reloads the page while still offline, and only then restores the signal:

```
Throwing the page away, still with no signal
  PASS  the session is still running
  PASS  the warm-up survived the reload
  PASS  the invented lift came back by name
  PASS  still queued, still nothing sent

Walking back out into the signal
  PASS  exactly one session landed
  PASS  exactly four sets landed, not eight
  PASS  the invented lift landed too
  PASS  with the id the device chose
  PASS  and the set logged into it points at exactly that row
  PASS  the row id is the client id, so a replay cannot write a twin
```

Appwrite is blocked rather than the whole browser context, because that is the real failure: the app shell is already on the phone and it is the gym's wifi that is not working. Killing every request would only prove that a page which cannot load does not log sets.

### Not built

No video upload queue (Order 31 has its own resume question), no background sync worker, no conflict resolution, no read cache for history or rollups. Sets are append-mostly and edited by one person on one device.

`docs/offline.md` has the full contract.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
