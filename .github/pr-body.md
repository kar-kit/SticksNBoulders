## Order 33 — Coach comments threaded on the set

Comments anchored to the set they're about rather than sitting in an inbox. The
set already carries load, reps, RPE and the athlete's own note, so none of the
context gets typed by anyone — which is the whole reason a comment can be short.

### The permission shape is symmetric, and that's the load-bearing part

`commentPermissions({ athleteId, authorId })` — circle-team read, update and
delete for the **author**.

Both parties are circle members, so both can stamp it. **The athlete's reply at
Order 34 needs no second policy, no new table and no server route.** Not
assumed: the e2e has an athlete authoring a comment stamped with their own
circle — a different caller against the same rule that refused the coach at
Order 17.

The author owns their own words and nobody else's. A coach cannot delete an
athlete's reply; an athlete cannot delete a coach's correction. **A record one
side can edit is not a record.** Both asserted live, along with each of them
withdrawing their own.

Revoking a link takes the thread with it, for free — the read is the circle.

### Choices worth a look

**Body is 2000, not the 500 a set note gets.** An athlete taps a note out
mid-set; this replaces an essay. Truncating a coach's correction ends with them
retyping it.

**`parent_id` exists now though only Order 34 draws replies.** Adding it later
means backfilling every comment ever written.

**Threading stops at one level, on purpose.** The blueprint says outright that
if a real conversation is needed they have WhatsApp — so a reply to a reply
flattens onto its thread rather than indenting again. Nesting invites the
conversation the screen is trying not to host.

Two cases that would otherwise lose someone's words: an orphaned reply (parent
deleted) is promoted to its own thread rather than dropped, and a cycle in
`parent_id` is bounded rather than spun on — it can only come from corrupt data,
and freezing the screen is worse than losing one comment.

### "Comment & next" writes two rows, in this order

Comment first, review second. **If the comment lands and the review doesn't, the
clip comes back with the comment already on it** and the coach sees what they
said — a duplicate they can skip. The other order loses the feedback and shows
an empty box, which is indistinguishable from never having commented.

A clip that already carries a comment is marked in the queue rail, so a coach
who was here last Sunday knows before opening it.

### The keyboard collision

The player owns space and the arrows, the queue owns Enter, and all three stop
listening while a field has focus — otherwise a coach couldn't type the word
"space". So the composer takes **⌘/Ctrl + Enter**. The player's hint line is
updated to say so.

The box focuses on arrival, and **a failed post keeps the draft**. Retyping your
own feedback because the network blinked is the worst thing this screen could do
to someone.

### Athlete View

`RecentFeedback` — everything said to one person, newest first, read-only.
Replying belongs with the clip where the video and the numbers are; a second
composer here would be a second place to say the same thing with less context.

It exists because the queue is organised around *clearing*, so a clip leaves the
moment it's dealt with and there'd otherwise be nowhere to read back what's
already been said.

### Voice notes: recommended against, for now

**Not built, and the ticket's own metadata is the argument.** The feature list
says voice "was not discussed on the call". The blueprint marks it `[Inference —
not discussed on the call]` and says outright: *"Cut it if December is tight."*

- Second bucket, a `MediaRecorder` UI, an audio player on the athlete side, and
  a story for a coach who can't re-listen.
- It arrives **before anyone has used the text version**.
- December is the hand-over, and this is the first thing the blueprint itself
  nominates to cut.

The case for it — talking beats typing across twenty clips — is real, and worth
testing against you and Ruairi actually clearing a queue rather than designing
around. If it comes back it's the same bucket pattern as clips and the same
ticket route for playback, so nothing here blocks it.

### What's not here

**The athlete's reply box.** Order 34 owns the Coach Feedback screen, the unread
badge, and tapping through to the set in its session. The table, the policy and
`submitComment` already take a `parentId`, so that ticket is a screen rather
than a model.

### Verification

`typecheck` · `lint` · **1171 tests, 74 files** · `build` · `perf:check` inside
budget · `appwrite:probe` 42/42 · schema applied at v7.

Live against the instance:

- `npm run e2e:review` — **21/21**, eleven of them new: both directions of
  authorship, both parties reading the thread, a stranger seeing none of it,
  threading, each side failing to delete the other's words, each side
  withdrawing their own, and the thread disappearing when the link is revoked.
- `npm run e2e:clip` — **15/15**, unchanged.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
