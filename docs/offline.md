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

## What it is not

Not a CRDT, not a local-first framework, not a read cache for history or
rollups. Sets are append-mostly and edited by one person on one device. Merge
semantics nobody needs would be the most expensive thing in the codebase.

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
