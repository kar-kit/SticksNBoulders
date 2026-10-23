# Coach comments on a set

Order 33. What the coach says about a filmed set, anchored to the set rather
than sitting in an inbox.

This is the WhatsApp thread, and the reason it can be short is that the set
already carries load, reps, RPE and the athlete's own note. None of the context
gets typed by anyone.

## `set_comments`

| Column | Why |
| --- | --- |
| `set_id` | What it is about |
| `athlete_id` | **Whose set**, not who wrote it. Denormalised so Order 34's feedback screen can read by athlete without joining back |
| `author_id` | Who said it. Either party |
| `body` | 2000 characters |
| `parent_id` | Null on the opening comment, the parent's id on a reply |
| `created_at`, `client_comment_id` | Ordering, and idempotency |

**Body is 2000, not 500.** `sets.notes` is 500 because an athlete taps it out
mid-set. This replaces the essay Joey currently types into WhatsApp, and
truncating a coach's correction is the kind of bug that ends with them retyping
it. Checked client-side too, so the box says so before the round trip rather
than Appwrite rejecting it after the coach has moved on.

**`parent_id` exists now even though only Order 34 draws replies.** Adding the
column later means backfilling every comment ever written.

## Permissions are symmetric, and that is the point

`commentPermissions({ athleteId, authorId })` — circle-team read, update and
delete for the **author**.

Both parties are circle members, so both can stamp it. That symmetry is
load-bearing: **the athlete's reply at Order 34 needs no second policy**, no new
table and no server route. Proved live rather than assumed — `npm run
e2e:review` has an athlete authoring a comment stamped with their own circle,
which is a different caller against the rule that refused the coach at Order 17.

The author owns their own words and nobody else's. A coach cannot delete an
athlete's reply; an athlete cannot delete a coach's correction. A record one
side can edit is not a record. Both assertions are in the e2e.

Revoking a link takes the thread with it, for free — the read is the circle.

## Threading is one level deep, deliberately

The blueprint is explicit that this is not a chat product: *"if a real
conversation is needed they have WhatsApp, and that is fine."* So a reply to a
reply is flattened onto the thread it belongs to rather than indented again.
Nesting invites the conversation the screen is trying not to host.

Two cases that would otherwise lose someone's words:

- **An orphaned reply** — parent deleted by its author, or simply not in the
  page that was read — is promoted to a thread of its own rather than dropped.
  Losing the athlete's answer because the question went away is worse than
  showing it without its question.
- **A cycle** in `parent_id` can only come from corrupt data, and spinning on it
  would freeze the screen rather than lose one comment. The walk up to the root
  is bounded.

## "Comment & next" writes two rows

Posting also clears the clip, because the blueprint's two exits — *Comment &
next* and *Skip* — both mean the coach has dealt with it.

**The comment is written first, the review second**, and the order is the whole
design. If the comment lands and the review does not, the clip comes back with
the comment already on it and the coach sees what they said — a duplicate they
can skip. The other order loses the feedback and shows an empty box, which is
indistinguishable from never having commented.

A clip that already carries a comment is marked in the queue rail, so a coach
who was here last Sunday knows before opening it.

## The keyboard

`clip-player.tsx` listens for space and arrows; `review-queue.tsx` listens for
Enter. Both ignore those keys while a field has focus, or a coach could not type
the word "space".

So the composer takes **⌘/Ctrl + Enter** to post and advance. Bare Enter is a
new paragraph inside the box and still skips when focus is outside it.

The box focuses itself on arrival — the coach's hands are already on the
keyboard and the blueprint's ask is that they stay there — and **a failed post
keeps the draft**. A coach retyping their own feedback because the network
blinked is the worst outcome this screen has.

## Athlete View

Comments are read back on the clip they are about. Since Joey's review of the
dashboard (16 Oct 2026) each clip in the Videos list carries its latest comment
on one line, and opening it shows the clip and its whole thread together, drawn
by `CommentThread` (`components/video/comment-thread.tsx` since F13, so the
queue, the Athlete View and the athlete's Clips gallery render the same words
the same way). The separate
`RecentFeedback` list is gone: every comment in it was about one of those clips.

Read-only: replying belongs with the clip in the Review Queue, where the
context panel carries the prescription, the RPE and recent weeks, and a second
composer here would be a second place to say the same thing with less context
attached. A clip still waiting links there.

It exists because the Review Queue is organised around *clearing* — a clip
leaves the moment it is dealt with — so without this there is nowhere to read
back what has already been said to somebody.

## Voice notes: recommended against, for now

**Not built, and the ticket's own metadata is the argument.** The feature list
says voice "was not discussed on the call", and the blueprint marks it
`[Inference — not discussed on the call]` and says outright: *"Cut it if
December is tight."*

- It needs a second bucket, a `MediaRecorder` UI, an audio player on the athlete
  side, and a story for transcription or for a coach who cannot re-listen.
- It arrives **before anyone has used the text version**. The case for it is
  that talking beats typing across twenty clips — which is a real argument, and
  one worth testing against Ruairi actually clearing a queue rather than
  designing around.
- December is the hand-over. This is the first thing the blueprint itself
  nominates to cut.

If it does come back, the shape is the same bucket pattern as clips and the same
ticket route for playback, so nothing here blocks it.

## The athlete's side

Order 34 built the reply box on the Coach Feedback screen (`/today/feedback`),
with the unread dot on the Today tab. It needed no new table, policy or route:
replies go through `submitComment` with a `parentId`, exactly as predicted
above. The unread watermark is kept on the device rather than on a row, because
anything stamped for the circle would hand the coach a read receipt. See
`lib/review/feedback-seen.ts`.

F13 adds a second place to answer: a clip opened from History → Clips shows
its thread and the same `ReplyBox`, posting through `submitComment` with the
latest thread's opening comment as `parentId` (the Feedback screen's rule).
Still no new table, policy or route. The box only appears once the coach has
said something on that clip and while a coach is linked. Reading a thread
there does not move the Feedback screen's unread watermark.

## Verified against the instance

`npm run e2e:review` — **21/21**, eleven of them on comments: both directions of
authorship, both parties reading the thread, a stranger seeing none of it,
threading, each side failing to delete the other's words, each side withdrawing
their own, and the thread disappearing when the link is revoked.

## Files

| File | What it holds |
| --- | --- |
| `lib/review/comments.ts` | Pure: validation, threading, labels, counts |
| `lib/review/comment-store.ts` | Reads, posts, withdraws |
| `components/coach/comment-box.tsx` | The composer and what was already said |
| `components/coach/recent-feedback.tsx` | The Athlete View panel |
| `scripts/e2e-review.mts` | Both directions, live |
