# Coach Review Queue

Order 32. The screen that replaces WhatsApp: every clip waiting across every
athlete, with the context a coach currently types by hand, cleared without
switching apps.

The metric the blueprint sets is **time to clear the queue**, and most of what
follows is downstream of it.

## What the queue is

Sets that have a clip on them, **minus** the ones this coach has already
cleared. Two tables, because Appwrite has no joins — so the subtraction happens
in memory, in `lib/review/queue.ts`.

- `Query.isNotNull("video_file_id")` composes with an `equal()` IN filter over
  the coach's athletes. Verified against the instance before designing around
  it; had it not worked, the queue would have needed a denormalised `has_video`
  column and a backfill.
- **Oldest first.** A clip filmed on Tuesday is the one the athlete is still
  wondering about. Ties break on id, so a queue does not reshuffle between
  renders and lose the coach's place.
- The coach reads through the circle team, exactly like every other read in the
  product. There is no branch for who is asking, and the whole screen stops
  working the moment a link is revoked — see below.

The in-memory filter is the first thing that stops scaling, and it is chosen
rather than missed. At beta scale — one coach, a handful of athletes — it is one
round trip each. Past a few thousand cleared clips the fix is a
`last_reviewed_at` watermark per athlete rather than a growing set of ids.

## `set_reviews`

One row per coach per clip. Per coach on purpose: Ruairi and Louis both coach at
Uxbridge, and one of them clearing a clip must not clear it for the other.

The row is stamped `read("team:circle_<athleteId>")` plus update and delete for
the coach. **Not** `read("user:<athleteId>")`, which is the spelling that looks
obvious and is the one Appwrite refuses — a caller may only stamp roles it holds
itself. Order 17 learned that the expensive way; this is the first thing in the
product a coach writes from their own session, so it is the first time the rule
applies to them rather than to the athlete.

Client-writable, where `reference_maxes` is server-only, and the difference is
worth stating. The forgery that forced reference maxes onto the server does not
bite here: a stranger could create a row naming somebody else's coach and set,
but they can only stamp roles they hold, so the row is unreadable by the real
coach and filters nothing out of the real queue. It is litter, not a lie — and a
training max is a number on a bar, where this is only whether a video has been
watched.

The id is `<coachId>_<setId>` rather than random, so clearing the same clip
twice — a double tap, a replayed request — is one row and not a duplicate.

## Playing the clip

This is the part with no shortcut. A `<video>` element cannot send a header, and
clips are stamped to the athlete's circle rather than to `users`. Three things
were tried against the live instance:

| Approach | Result |
| --- | --- |
| Appwrite file URL, no auth | **404** |
| `x-appwrite-jwt` header | 200 — but `<video>` cannot send it |
| `?jwt=` query parameter | **404** — not supported |
| Appwrite session cookie | 200 — and a trap |

The cookie works at Appwrite's end and will not help: the app and Appwrite are
different origins, so a browser treats it as third-party and will not send it
from localhost at all, never mind under Safari's ITP or Chrome's third-party
cookie removal.

So clips are served through this app's own origin, behind a **signed ticket**.

### The ticket carries identity, not authority

`POST /api/clip` takes a batch of file ids and returns a URL for each, signed
with `VIDEO_TICKET_SECRET` and valid for five minutes. It checks the caller is
signed in and nothing else.

That is not an omission. `GET /api/clip/[fileId]` mints a fresh JWT **for the
ticket's user** and asks Appwrite as them, so the access decision is Appwrite's
own. Consequences:

- There is no permission logic in the media route to get wrong. CLAUDE.md calls
  a missed permission path sev-1, and the way to never miss one is not to have
  one.
- **Revocation is honoured mid-scrub.** A coach holding a valid, unexpired
  ticket who is unlinked mid-session stops being able to play — their next range
  request 404s, because they have left the circle team. That is Order 16.6
  item 3 arrived at for free rather than built.
- A ticket for a clip the holder cannot read is a perfectly valid ticket that
  fetches nothing. `npm run e2e:clip` asserts exactly that for a stranger.

The ticket is bound to one file, so swapping the id in a URL opens nothing.

### Two things that only show up under a proxy

**Range requests.** Forwarded in both directions, because the blueprint wants
frame-stepping at 0.25x, which is seeking, which is ranges. Appwrite answers
206 with `accept-ranges: bytes`, and the proxy passes `Content-Range` back.

**Compression.** Appwrite gzips its file responses. `fetch` transparently
decompresses the body, so the upstream `content-length` describes the compressed
bytes while the body holds the decompressed ones — forwarding it truncated a
40,000-byte clip to 498 and reported **200 OK**. Found by hashing what came out
of the proxy rather than by reading the code.

Fixed twice over: the upstream request asks for `accept-encoding: identity`
(video is already compressed; gzip here costs only correctness), and
`content-length` is dropped if a response arrives encoded anyway.

The body is passed through unbuffered. Reading a 150MB clip into memory to hand
it on would pass every test and fall over on the first real one.

`Content-Type` is forwarded as Appwrite reports it, under `X-Content-Type-Options:
nosniff`. For a real clip that is the stored mime type and correct. If it ever
is not, the browser refuses to decode rather than guessing, and the coach gets
the player's "would not play" message — which covers a mislabelled type as well
as a link that has been withdrawn, so it is worth checking the response headers
before assuming the athlete revoked access.

## Clearing

**Reviewed — next**, or Enter. Skip is the blueprint's own action for clips that
are simply fine, and in Order 32 it is the only one: "Comment & next" needs
Order 33's comment table. So this ships as the honest half of the loop — a coach
can watch everything and mark it seen; saying something about one arrives next.

Advance is decided against the queue **before** the clip leaves it. The other
way round shows the coach the clip they just cleared when they clear the last
one. Clearing the last clip falls back to the previous rather than snapping to
the top.

The write is optimistic, and the failure direction is deliberate: a failed write
leaves the clip cleared on screen and back in the queue on the next load. A clip
shown twice costs a moment; a clip silently dropped costs a review. **Undo**
deletes the review row and puts it back.

## Live

`subscribeToClips` watches the sets table, for **create and update**. The update
is the one that matters: our own upload flow sends the file first and records it
on the set afterwards, so a clip almost always reaches the queue as an update to
a set that already existed. A subscription listening only for creates would look
right in a test and never fire in a gym.

Realtime failing is silent. It is an improvement on a screen that already works,
not a dependency of it.

The nav badge is counted from the same two reads the queue itself uses, so the
number beside "Review" and the number of clips on screen cannot disagree.

## What the blueprint asks for and this does not do

**"Prescribed: 3 @ RPE 8" is absent.** It needs a stored program, and there is no
programs table until Order 19 — the Program Editor is blocked on Ruairi's
block-shape question. The blueprint calls the context panel "the product", so
the missing line is worth knowing about; rendering it empty, or inferring a
target from what was lifted, would put a number in front of a coach that nobody
prescribed.

**"Still uploading" is not shown.** A set row carries no trace of a clip that has
not landed yet: `attachClipToSet` uploads first and records second, so an
in-flight clip is invisible server-side. Showing the state honestly would mean
writing upload intent to the set before the bytes move — a set row mutated twice
per clip, and a pending state that strands if the athlete never comes back. That
is a redesign of Order 29 and 31 for a state that only exists while an upload is
genuinely in flight. A clip that will not play says so in the player instead.

**Voice notes are not built.** They belong with Order 33's comments, and the
blueprint already marks them `[Inference — not discussed on the call]`.

## Verified against the instance

`npm run e2e:review` — 11 checks on the data path, including the one this ticket
rests on: a coach writing a row stamped with the athlete's circle team, from
their own session.

`npm run e2e:clip` — 15 checks on playback, with the app running (`npm run
build && npm run start`; set `PORT` and `E2E_BASE_URL` together if 3100 is
taken). Whole-file
byte equality, ranges, ticket forgery, a stranger's valid ticket, and an
unlinked coach's existing ticket dying immediately.

## Files

| File | What it holds |
| --- | --- |
| `lib/review/queue.ts` | Pure: what is in the queue, in what order, what is next |
| `lib/review/queue-store.ts` | The Appwrite reads, the review writes, realtime |
| `lib/video/ticket.ts` | The signed playback pass |
| `app/api/clip/route.ts` | Mints URLs for a batch of clips |
| `app/api/clip/[fileId]/route.ts` | Streams one, as the ticket's user |
| `components/coach/review-queue.tsx` | The screen |
| `components/coach/clip-player.tsx` | Speed, loop, frame step, keyboard |
| `components/coach/clip-context.tsx` | Everything right of the video |
| `scripts/e2e-review.mts` | The data path, live |
| `scripts/e2e-clip.mts` | Playback, live |

## A bound worth writing down

`markSetReviewed` derives its row id as `<coachId>_<setId>`. With Appwrite's
generated ids that is 20 + 1 + 20 = **41 characters**, and `npm run e2e:review`
writes one at exactly that length against the live instance on every run. So the
practical limit is at least 41, not the 36 the docs suggest — proven rather than
assumed, and worth knowing before anyone derives a longer one.

`bodyweightRowId` at Order 36 guards explicitly rather than relying on it, since
its athlete id could in principle be a custom one.
