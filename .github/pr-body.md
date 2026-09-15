## Order 32 — Coach review queue

The screen that replaces WhatsApp. One list across every athlete, oldest first,
with the context Joey currently types by hand, cleared without switching apps.

### The queue

Sets that have a clip, **minus** the ones this coach has already cleared. Two
tables, because Appwrite has no joins, so the subtraction happens in memory.

`Query.isNotNull("video_file_id")` composes with an `equal()` IN filter over the
coach's athletes — **checked against the instance before designing around it.**
Had it not worked, this would have needed a denormalised `has_video` column and
a backfill.

Oldest first: a clip filmed on Tuesday is the one the athlete is still wondering
about. Ties break on id, so the queue does not reshuffle between renders and
lose the coach's place.

The in-memory filter is the first thing here that stops scaling, and it's chosen
rather than missed — the comment at that line says so, and names the fix (a
`last_reviewed_at` watermark) for whoever hits it.

### ⚠️ Permission-model change

**`set_reviews` is the first table a coach writes, from their own session, and
`USER_WRITABLE_TABLES` grows by one.** Worth a look rather than inferring it
from the policy diff.

The row is stamped `read("team:circle_<athleteId>")` — **not**
`read("user:<athleteId>")`, which is the obvious spelling and the one Appwrite
refuses. A caller may only stamp roles it holds itself. Order 17 paid for that
lesson on the athlete's side; this is the first time it applies to the coach.

Client-writable where `reference_maxes` is server-only, and the difference is
the point: a forged review row can only carry roles its author holds, so the
real coach cannot read it and it filters nothing out of the real queue. Litter,
not a lie — and a training max is a number on a bar where this is only whether a
video has been watched.

Id is `<coachId>_<setId>`, so a double tap is one row.

### Playback, which had no shortcut

A `<video>` element cannot send a header and clips are stamped to a circle. Four
approaches, all against the live instance:

| Approach | Result |
| --- | --- |
| Appwrite file URL, no auth | **404** |
| `x-appwrite-jwt` header | 200 — unreachable from a `<video>` |
| `?jwt=` query parameter | **404**, not supported |
| Appwrite session cookie | 200 — and a trap: different origins make it third-party, so no browser sends it from localhost |

So clips stream through this app's origin behind a signed ticket, and **the
ticket carries identity, not authority**. It says who the URL was minted for and
nothing else; the stream route mints a fresh JWT for that user and asks Appwrite
as them.

- No permission logic in a media route to forget. CLAUDE.md calls a missed
  permission path sev-1; the way to never miss one is not to have one.
- **An unlinked coach's existing, unexpired ticket stops working mid-scrub**,
  because they have left the circle team. That's Order 16.6 item 3 arrived at
  for free rather than built.
- A stranger gets a perfectly valid ticket that fetches a 404. The e2e asserts
  exactly that, because it's the assertion that makes the design defensible
  rather than merely clever.

### The bug worth reading

**Appwrite gzips file responses. `fetch` decompresses transparently. The
upstream `content-length` describes the compressed bytes while the body holds
the decompressed ones — so forwarding it truncated a 40,000-byte clip to 498 and
returned `200 OK`.**

That's the class of bug that ships, sits for a month, and surfaces as "the
videos are broken sometimes". Found by hashing what came out of the proxy, not
by reading the code.

Fixed twice: the upstream request asks for `accept-encoding: identity` (video is
already compressed — gzip buys nothing here and costs correctness), and
`content-length` is dropped if an encoding arrives anyway.

Range requests are forwarded both ways and the body streams unbuffered. Both
matter: 0.25x frame-stepping *is* seeking, and buffering a 150MB clip to hand it
on passes every test and falls over on the first real one.

### What the blueprint asks for and this does not do

- **"Prescribed: 3 @ RPE 8" is absent.** It needs a stored program and there's no
  programs table until Order 19 (blocked on your block-shape question). The
  blueprint calls the context panel "the product", so the missing line is worth
  knowing about — but inferring a target from what was lifted would put a number
  in front of a coach that nobody prescribed.
- **"Still uploading" is not shown.** A set row carries no trace of a clip that
  hasn't landed: the upload flow sends the file first and records it second.
  Showing it honestly means writing intent before the bytes move — a redesign of
  Orders 29 and 31 for a state that exists only while an upload is in flight. A
  clip that won't play says so in the player instead.
- **Clearing is Skip, and only Skip.** "Comment & next" is Order 33. This ships
  as the honest half of the loop rather than a stubbed whole one: a coach can
  watch everything and mark it seen.
- **Voice notes** belong with Order 33, and the blueprint already marks them
  `[Inference — not discussed on the call]`.

### Also

`npm start` took a hardcoded port, so a stale server on 3100 made the e2e run
against somebody else's build and report failures that looked like bugs in this
code. It honours `PORT` now.

### Verification

`typecheck` · `lint` · **1149 tests, 73 files** · `build` · `perf:check` inside
the 2.5s budget · `appwrite:probe` 42/42 · schema applied at v6.

Live against the instance:

- `npm run e2e:review` — **11/11**, including the one this ticket rests on: a
  coach writing a row stamped with the athlete's circle team from their own
  session.
- `npm run e2e:clip` — **15/15**: whole-file byte equality, ranges, ticket
  forgery, a stranger's valid ticket fetching nothing, and an unlinked coach's
  live ticket dying immediately.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
