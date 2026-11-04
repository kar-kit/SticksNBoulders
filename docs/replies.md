# Coach Replies inbox (F26, schema v24)

When an athlete replies to something the coach said on a clip, the coach used
to get no signal at all. The athlete's unread dot (Today, Feedback) was the
only unread model in the product, and it lives in the athlete's localStorage.
The coach's Review Queue listens to `sets`, so once he had cleared a clip, a
reply on it surfaced nowhere.

F26 adds a **Replies** item to the coach nav with an unread count, a Replies
screen, server-side read state that his phone and laptop share, and a stable
link to one thread for F27's push notifications.

## What counts as unread

`lib/review/replies.ts`, pure and unit tested. A thread is one set's comments.
An athlete comment in it is unread when it reached the server after the
coach's **watermark** for that thread, and the watermark is the later of:

- his read mark (`thread_reads.last_read_at`), and
- his own newest comment in the thread. Answering a reply is reading it, which
  also means threads he has already answered need no backfill on rollout.

Only the athlete's own words in their own set's thread count
(`author_id === athlete_id`, and never the coach himself). A second coach on
the same athlete (Ruairi and Louis both coach at Uxbridge) does not count:
Louis talking is not the athlete answering. Only athletes linked to this coach
now are counted; the circle stops returning an unlinked athlete's rows anyway,
and the filter covers the moment between a revoke and the next read.

**Reactions (F25) never count.** They live in `comment_reactions`, which
nothing in the inbox reads or subscribes to.

**One clock.** Comparisons use each comment's server `$createdAt` (`postedAt`
on `Comment`), never its client-written `created_at`. An athlete's phone set
five minutes slow cannot hide a reply behind a mark. The mark itself stores a
comment's server time, never the coach's clock.

**The badge counts threads**, not messages: the number beside Replies is the
number of bold rows on the Replies screen, the same promise the Review badge
makes about clips.

## `thread_reads`

| Column | Type | Notes |
| --- | --- | --- |
| `coach_id` | string 36, required | The reader |
| `athlete_id` | string 36, required | Whose set, denormalised so readers can drop an unlinked athlete's marks |
| `set_id` | string 36, required | The thread |
| `last_read_at` | datetime, required | Server `$createdAt` of the newest comment the coach had on screen |

Index: `idx_coach_set`, unique on (`coach_id`, `set_id`). Row id is derived,
`<coachId>_<setId>` (41 characters, the length `set_reviews` already proves
Appwrite accepts), so a second device marking the same thread hits a 409 and
`markThreadRead` turns it into an update.

**Permissions: `read`, `update`, `delete` for `user:<coachId>` only**
(`threadReadPermissions`). Not the circle, unlike every other row about a set.
A read mark the athlete could read is a read receipt, and the blueprint rules
those out; it is the same reason the athlete's own "seen" is local
(`lib/review/feedback-seen.ts`). `update("user:<coach_id>")` is the
provenance proof, so a mark planted in the coach's name (the way to silence
his badge) is never trusted and `validate-row` deletes it.

A revoked link leaves the coach's marks behind. They are harmless: they name
sets he can no longer read, and readers ignore marks for athletes he no longer
coaches.

## Where a thread is marked read

Opening a thread anywhere marks it, through `useMarkThreadRead`
(`lib/review/coach-replies-context.tsx`):

- the clip dialog over Athlete View (`components/coach/athlete-videos.tsx`),
  where Replies rows and the thread link land;
- the clip on screen in the Review Queue, whose thread sits under it;
- a tap on a Replies row, and the thread link's hand-over, so a thread whose
  clip has gone still clears.

A screen marks only **as far as the comments it shows**. A reply that arrives
live while the dialog shows an older copy of the thread stays unread until the
coach actually sees it. Nothing is written when the mark would clear nothing,
so opening read threads costs no writes. The badge drops optimistically;
a refused write re-reads so the badge never shows a clear that did not land.

## A reply on a clip already reviewed: Replies, not a requeue

The two options were to put the clip back in the Review Queue, or to surface
the reply under Replies. F26 does the second, for three reasons:

1. **One signal for one event.** Requeuing would light both badges for one
   reply, or need the two to clear each other, which is exactly the
   double-count the brief warns against.
2. **The queue means footage.** `set_reviews` records which clip a coach
   cleared (v18), and a clip comes back when the *video* changes. A reply is
   words to answer, not footage to rewatch. Requeuing would make him re-clear
   a clip he has already watched to acknowledge a sentence.
3. **Cost.** The Review badge is computed from sets and reviews on every
   realtime `sets` event. Requeuing on replies would add a comments read to
   every one of those for every coach.

The trade-off, recorded because it needs a decision (see below): the Athlete
View dialog is read-only, by design (Joey, 16 Oct 2026), so a coach reading a
reply on a cleared clip can react to it (F25) but cannot answer it in words
without restoring the clip in Review.

## The thread link

**`/coach/replies/<setId>`** (`threadHref` in `lib/review/replies.ts`). F27
links push notifications here. It names only the set, so it survives the
Athlete View URL changing. The page (`components/coach/thread-link.tsx`)
finds whose set it is (from the inbox, or the set row when opened cold), marks
the thread read, and replaces itself with
`/coach/athletes/<athleteId>?clip=<setId>`, so Back returns to wherever the
coach came from. A set he cannot read (deleted, never his athlete's, or an
athlete who has unlinked) gets "This thread isn't available" and a link back
to Replies. It grants nothing.

## Live

The coach layout's provider subscribes to two channels: `set_comments` rows
(create, update, delete, so a withdrawn reply leaves the badge) and his own
`thread_reads` rows (so reading on the laptop clears the phone). Realtime only
delivers rows the subscriber can read. Bursts coalesce into one read after the
one in flight.

## Bounds

The inbox reads the newest 500 comments across the roster and up to 1,000
marks. Past that, a reply is still in its thread (Athlete View and the
athlete's Feedback read by set); it just no longer lights the badge. The fix
when that bites is a time floor on the comment query, not a bigger cap.

## Rollout

1. `npm run appwrite:setup` (schema v24 adds `thread_reads`; no existing row
   is rewritten). Before the prod deploy, or the inbox's reads 404 and the
   badge stays at zero.
2. `npm run appwrite:functions` to redeploy `validate-row`, which bundles
   provenance.ts and only then vouches for `thread_reads` rows. Without it,
   honest marks still work; forged ones are hidden by readers but not deleted.
3. Deploy the app.
4. `npm run appwrite:audit` and `npm run e2e:replies` against the instance.

Nothing needs a backfill. On first load every athlete reply the coach has not
answered since shows as unread, which is the truth.

## Open decisions

- **Answering from the dialog.** Should the Athlete View clip dialog get a
  reply box when the thread has an athlete reply? Today it is read-only on
  purpose. [SME to confirm] with Ruairi: does he answer replies in the app,
  or does a reply only need to be seen?
- **Threads with another coach.** An athlete replying to Louis lights
  Ruairi's badge too, because the brief counts every athlete comment on a
  linked athlete's set. Restricting to threads he has spoken in is a one-line
  filter if two-coach circles find it noisy. [Inference]

## Files

| File | What |
| --- | --- |
| `appwrite/schema/index.ts` | `thread_reads`, v24 |
| `appwrite/documents/policy.ts` | `threadReadPermissions` |
| `appwrite/documents/provenance.ts` | stamp, proof, label |
| `appwrite/documents/write.ts` | `markThreadRead`, `threadReadRowId` |
| `appwrite/audit/rules.ts`, `scripts/appwrite-audit.mts` | the audit rule and its live cells |
| `lib/review/replies.ts` | Pure: unread, ordering, marks, links |
| `lib/review/replies-store.ts` | Reads, the write, the subscription |
| `lib/review/coach-replies-context.tsx` | The shared state, `useMarkThreadRead` |
| `components/coach/replies-inbox.tsx` | The Replies screen |
| `components/coach/thread-link.tsx` | Behind `/coach/replies/<setId>` |
| `components/shell/coach-shell.tsx` | The nav item and its badge |
| `scripts/e2e-replies.mts` | The loop, live (`npm run e2e:replies`) |
