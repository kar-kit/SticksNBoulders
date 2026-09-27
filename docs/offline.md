# Offline logging

A lost set is unforgivable and gym signal is bad. Everything below follows from
those two sentences.

## The shape

Every write an athlete makes during a session is written to a durable queue on
the device first, and sent afterwards. Nothing on the logging path waits for
Appwrite — `logSet` resolves once the op is on disk, not once the server has it.

```
tap ✓ ──► IndexedDB ──► flush ──► Appwrite
          (durable)     (retry,    (authoritative)
                         in order)
```

Four kinds of op, all carrying their own Appwrite row id: `session.create`,
`session.finish`, `set.create`, `set.delete`, plus `exercise.create` for a lift
typed on the spot.

## One id, not two

The client id **is** the Appwrite row id. `st-68c5...` is 23 characters of
lowercase, digits and a hyphen, which is a legal row id (Appwrite allows 36 and
forbids a leading special character).

This is the decision the rest of the design hangs off:

- There is no local-id-to-server-id mapping, and no moment where an id changes.
- A set logged with no signal can reference its session immediately, because the
  session's id exists before the session row does. Appwrite has no foreign keys,
  so nothing breaks.
- A retry cannot write a row twice, because the second attempt carries the same
  row id as the first. The unique indexes on `client_set_id` and
  `client_session_id` are now a belt alongside that brace.
- A 409 is success, always. It can only mean our own earlier attempt landed with
  the response lost on the way back.

## Order

Ops flush strictly in the order they were written, and one op waiting holds the
ones behind it. A set must not reach Appwrite before its session, and an undo
must not overtake the set it removes.

That is only safe because a write that can never succeed drops out of the line:
`classify` separates *retry later* (no status at all, 401, 403, 408, 429, 5xx)
from *this will never work* (400, 404). Without that distinction one malformed op
retries forever at the head of the queue and every real set stalls behind it —
a queue that looks busy and is actually dead.

A permanently failed op is **kept**, not deleted. It is evidence that something
an athlete logged did not reach their coach, and the log screen says so. Offline
gets a quiet dot; this is the one case that gets words.

## Deleting a set

Any logged set in the running session can be deleted: tap the row for its
Delete, or swipe it left. Neither asks first. The set leaves the screen and an
undo toast holds the delete for five seconds; only when the toast goes is
`removeSet` called. So Undo never has to reverse a write, and a tab killed
inside the window keeps the set, which is the right way round for a log whose
worst failure is a lost set. Hiding the page, leaving the screen, starting a
second delete or finishing the session all write it immediately.

`removeSet` then deals with the queue before the server:

| The set's create is... | What happens |
| --- | --- |
| never attempted | it leaves the queue with any edit or clip queued against it; no delete is sent, because the row was never written |
| refused (400) | same: a refused create never landed |
| attempted, still retrying | it stays, and a `set.delete` runs behind it, because it may have landed with the response lost |
| on the wire right now | treated as attempted, whatever its counter says |
| already synced | a `set.delete` is queued |

A real delete is always followed by a `rollup.refresh` for the week the set
was **logged** in, so volume, tonnage, set count, best e1RM and the best-set
PR are recomputed from what is left. A week with no working sets left loses
its row. Lift Detail, the estimated reference max and DOTS read that row, so
they follow without being touched.

The drain loop checks each op is still in the queue before sending it. It
takes its batch as a snapshot, and without that check a set withdrawn while
an earlier op was sending would be sent anyway.

**A set a coach has commented on cannot be deleted.** The comments are the
coach's record of their own practice, the athlete cannot delete them (the row
grants delete to its author alone), and a thread whose set has gone is a
correction about nothing. The logger reads the session's comments when it
loads and says so in place of Delete; the numbers can still be corrected from
History, which keeps the thread attached. Because a delete queued in a
basement may run an hour later, `deleteSet` in the write helper checks again
immediately before the row goes and refuses with a 412, which the queue files
as permanent. The screen treats that one refusal differently from every other
failure: the set comes back, the note says a coach had already commented, and
it can be dismissed, because nothing was lost.

A clip still uploading for a deleted set is forgotten. One that already
uploaded stays in storage, the same trade `detachClipFromSet` makes: reclaiming
files no set references is a sweep, and a broken player in the coach's queue
is worse than a storage bill. An attach that arrives after its set was deleted
gets a 404 and is treated as done rather than as a failure the athlete has to
read about.

`set_index` is one past the highest index the exercise has used, not one past
the count. Delete set 2 of 4 and the count hands out 4 again; the review queue
positions a clip by finding its index among its siblings. Gaps are harmless,
because every screen numbers by order.

## When it sends

`navigator.onLine` is a hint, never a gate. It reports whether a network
interface is up, not whether Appwrite is reachable, and gym wifi that associates
but routes nowhere reports online all session. So a write is always attempted and
the real signal is the attempt failing. Flushes are triggered by: a new op, the
`online` event, the tab becoming visible, and a five-second heartbeat while
anything is waiting. Backoff doubles to a one-minute ceiling.

## What else had to be local

Offline logging is not only the queue. Three reads had to survive a cold start
in a basement, or the queue would have had nothing to queue:

| What | Where | Why |
| --- | --- | --- |
| The signed-in athlete | `lib/auth/remembered-user.ts` | A lookup that cannot reach Appwrite used to sign them out — mid-session, to a sign-in screen that also needs the network. A request that is *refused* still signs them out; this is a fallback for silence only. |
| The exercise library | `lib/exercises/library-cache.ts` | Otherwise the typeahead is empty and nobody can name the lift they are standing under. |
| The running session | `lib/logging/active-session-cache.ts` | For the session that synced at the gym door and could not be read back later. Expires after 12 hours so a finish that never ran cannot block starting a new one. |

All three are localStorage, because losing them costs a round trip. The queue
gets IndexedDB, because losing it costs someone's training.

### Reading the session back

The log screen reads the session's sets from Appwrite once, and retries on
every queue announcement until that read has succeeded. A page reloaded with
no signal used to give up after the first failure, so the sets that had
synced before the reload stayed off the screen, and out of the totals the
finish wrote, long after the signal came back.

## What it is not

Not a CRDT, not a local-first framework, not a read cache for history or
rollups. Sets are append-mostly and edited by one person on one device. Merge
semantics nobody needs would be the most expensive thing in the codebase.

## Deleting a set

Any logged set can be deleted from the logger (tap the row, or swipe it left),
and the delete is the one write in the product that waits: the screen hides the
set and shows an undo toast for five seconds, and only then queues the delete.
Undo therefore never has to reverse a write. The pending delete is written
early if the page is hidden, left, or finished, so a phone locked inside the
window still deletes; a tab killed outright inside it keeps the set, which is
the right way round.

What `removeSet` does to the queue (`opsDroppedByDelete`):

| State of the set | What happens |
| --- | --- |
| Create never attempted, or refused with a 4xx | The create leaves the queue with any edit or clip queued against it. No delete is sent; Appwrite never sees the set. |
| Create attempted (retrying, or on the wire right now) | It stays, and `set.delete` queues behind it. It may have landed. |
| Synced | `set.delete`, then `rollup.refresh` for the week the set was **logged** in. |

The drain loop re-checks each op against the live queue before sending it, so
an op withdrawn after a batch was taken is not sent anyway, and the op whose
request is on the wire is never withdrawn.

A 404 on `set.delete` or `set.attachVideo` counts as done: the row is already
gone, or a clip finished uploading for a set deleted meanwhile. The uploaded
file is left for the orphan sweep, the same trade `detachClipFromSet` makes.

**A set a coach has commented on cannot be deleted.** The write helper refuses
with 412 `set-has-coach-comments`, checked immediately before the delete runs
(not when it was tapped: a delete queued offline may run after the coach has
watched the clip). The logger also knows which of the session's sets carry
someone else's comment and says so instead of offering Delete. A refused delete
is a permanent op, but not lost work: the set reappears, and the notice can be
dismissed. The athlete corrects the numbers from History instead, which keeps
the thread attached to its set.

## Testing it

- `npm test` — the queue logic, the drain loop against an in-memory store, and
  the projection back into sessions and sets.
- `npm run e2e:offline` — the real claim, in a browser: Appwrite is cut off, a
  session is started and three sets logged, the page is **reloaded while still
  offline**, and then the signal comes back and everything lands exactly once.
  The reload is the part that justifies IndexedDB.

Appwrite is blocked rather than the whole browser context, because that is the
real failure: the app shell is already on the phone and it is the gym's wifi that
is not working. Killing every request would only prove that a page which cannot
load does not log sets.
