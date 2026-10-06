# Coach links

Redeeming an invite code is the write that decides who can read an athlete's
training. It is the most dangerous path in the product, so it is also the most
constrained.

## Consent, in the right place

The blueprint requires the consequence to be stated when the link is made, not
in a policy document, and under UK GDPR that is the moment consent actually
happens. So redemption is two steps and the first one writes nothing:

1. `POST /api/link/resolve` — names the coach the code belongs to.
2. The athlete sees **"Link with Ruairi Deane?"** and the sentence from
   `linkConsentSentence`: *will be able to see your sessions, your videos and
   your bodyweight, and set your training program.*
3. `POST /api/link` — only after they tap Link.

A code that linked on submit would be one round trip faster and would not be
consent. The e2e asserts that no link row exists at the moment of asking.

## Where the decision lives

`lib/coach/link.ts` is pure and exhaustively tested. It answers one question —
given the athlete, the coach a code resolved to, and the athlete's existing
links, what should happen — and returns one of:

| | |
|---|---|
| `self` | A coach redeemed their own code. |
| `already-linked` | Same coach. A no-op, not an error. |
| `other-coach` | Linked to somebody else. **Refused.** |
| `reactivate` | Linked to this coach before and revoked. The row is reused. |
| `create` | A first link. |

`appwrite/documents/link-admin.ts` carries the decision out and nothing else.
Splitting them is what makes every branch testable without a network.

### One coach at a time

`other-coach` refuses rather than adds. The schema permits many coaches per
athlete — the unique index is on the *pair* — but quietly granting a second
person access to a training history is the failure this module exists to
prevent, and the blueprint's COACH section shows one name.

**There is no unlink yet.** Somebody told "already linked to Ruairi" will go
looking for a button that does not exist, so the message says so outright.
Unlinking is the obvious next ticket.

### Reactivation

A revoked pair cannot be re-created: the unique index on
`(coach_id, athlete_id)` rejects it. So `reactivateCoachLink` reuses the row,
clears `revoked_at` rather than leaving it beside an active status, and
re-stamps permissions instead of trusting what the row carried.

## The row before the membership

Two writes make a link real:

1. The row in `coach_athlete_links` — the **record**.
2. The coach's membership of the athlete's circle team — the **access**.

They happen in that order, always. A failure between them leaves a coach
recorded but not yet able to see anything, which is visible, recoverable, and
repaired by redeeming the same code again. The reverse — access with no record
of why — is the one outcome that must never happen, and row-first cannot
produce it.

When the membership fails the response is `linked-not-visible`, and the screen
says so rather than claiming success. An athlete told "linked" while their
coach sees an empty roster is how a silent failure survives to December.

### The circle may not exist yet

An athlete's circle team is created lazily, by the first write the offline
queue flushes. Onboarding asks for the coach code *before* any training exists,
so the common path had no circle at all — and adding a coach to a team that
does not exist throws `team_not_found`. `redeemInviteCode` calls `ensureCircle`
first. Found by `e2e:link` on 14 Sep 2026; it passed every unit test.

## Withdrawing it

Order 16.5, and the exact inverse of redeeming.

Linking writes the **record** first and grants **access** second. Unlinking
removes access first and writes the record second. Both orders serve one
invariant: **there is never access without a record of why.** A failure either
way leaves a link recorded while the coach may not be able to see anything —
visible, recoverable, repaired by trying again.

`removeCoachFromCircle` returns silently when it finds no membership, so a
call that appears to succeed proves nothing. `revokeCoachAccess` re-reads the
circle afterwards and refuses to write the row unless the coach is genuinely
gone. That re-read is the cheapest possible guard on the one direction that
matters, and without it a stale or half-applied removal would leave a coach
reading a training history the record says they cannot.

When it fails, the answer is `still-visible`, nothing is written, and the screen
says so. An athlete told "unlinked" while their coach can still read everything
has been told the opposite of the truth on the one screen that exists to tell
it.

**Revoked, never deleted.** The row is the record of who could once see what,
and the unique index on `(coach_id, athlete_id)` means re-linking later has to
reuse it anyway — which `e2e:link` drives end to end: link, unlink, redeem the
same code, one row throughout, access back.

Two things shipped as assumptions rather than decisions:

- **Athlete-initiated only.** Whether a coach can drop an athlete from their own
  roster is `[SME to confirm]` on Order 16.5.
- **A hard cut.** Access ends the moment the membership goes. Whether a coach
  should keep seeing anything for a window afterwards — a session they are
  mid-review on, say — is a product decision Ruairi has not made.

Revoking is **not rate limited**, unlike redeeming. Guessing codes is the attack
redemption defends against; revoking only ever affects the caller's own link,
and a limit on it would mean an athlete who taps twice cannot withdraw consent.

## When a link ends, on the coach's side

Order 16.6. Unlinking is instant and athlete-initiated, so the coach's screens
meet it without warning. Every one of them treats "no longer linked" as a state
it renders, never as an error it stumbles into.

The data source is the coach's own link rows. They are stamped readable by both
parties and revoking re-stamps the same two roles, so a coach can always see
*that* a link existed and *when* it ended, and nothing else about the athlete
once it has. `lib/coach/link-status.ts` decides everything from those rows and
is pure; `lib/coach/coach-links-store.ts` is the two reads and a subscription.

| Screen | What the coach sees |
|---|---|
| Roster | A muted line: *"An athlete stopped sharing their training with you on 26 Sep."* For a fortnight, or until they re-link. No name. |
| Review Queue | Their clips leave, live, with *"A clip left the queue because the athlete who filmed it is no longer linked with you."* A half-written comment on one goes with it. |
| Athlete View at their URL | *"No longer linked"*, dated, with what comes back on re-link. Never the panels. |
| Rail and Review badge | Drop the athlete as soon as any screen notices, without a reload. |

**The queue reads who is linked fresh on every refresh**, rather than from the
session resolved at app load. A stale session would keep the athlete in the IN
filter; their rows would silently come back empty, but anything already on
screen would stay there and every action on it would fail against a circle the
coach has left. A refused comment or review is also treated as a possible unlink
and re-reads, which covers the gap before a realtime event arrives.

**The Athlete View is gated** by `AthleteLinkGate`. A linked athlete's panels
render on the first paint from the session, with no extra round trip; the link
is checked alongside and live. Without the gate an ex-athlete's URL rendered
every panel against reads the circle no longer grants: lists came back empty
and said *"No maxes yet"* about somebody who has maxes.

**Linked means row *and* membership.** Re-linking writes the row first and the
membership second, so a coach watching live sees the row flip a moment before
access exists. The gate checks the circle too (`canSeeCircle`, a team read that
only a member can make) and holds the panels on *"Linked, nothing showing yet"*
until both agree. That state also covers a half-failed redemption
(`linked-not-visible`) from the coach's side.

**A stranger and a typo look the same.** An id with no link row says *"Not one
of your athletes"*, never "this person exists but is not yours".

### What history stays visible: none, and it is kept

The coach's own comments on an ex-athlete's sets are **hidden while unlinked,
kept intact, and back on re-link**. Nothing is deleted or rewritten; `e2e:unlink`
asserts one comment and one review before, during and after.

Reasoning, in order of weight:

1. **It is what the permission model already says.** Comments are stamped to
   the athlete's circle. Keeping them readable would mean adding
   `read("user:<authorId>")` to every comment and backfilling every existing
   row with the server key: a second read path into a withdrawn athlete's data,
   on the table the product says must never grow one.
2. **A comment is about the athlete.** *"Hips shot up at 180"* is their training
   data in the coach's words. Withdrawal under UK GDPR has to mean withdrawn,
   which is the same argument that rejected a grace period on reads.
3. **Without its set it is a fragment.** The load, the clip and the athlete's
   reply all left with the circle; a list of orphaned corrections is not a
   useful record of anything.

The Build Plan note says the coach's feedback is "preserved (it's the coach's
record of their own practice)". Kept-not-deleted satisfies *preserved*. If
Ruairi needs a record he can keep after an athlete leaves, the honest shape is
an export he takes while linked, not a read that outlives consent
`[SME to confirm]`.

The coach's unsaved draft is flushed, per the same note: the comment box resets
when its clip leaves the queue.

`npm run e2e:unlink` drives the whole thing against the live instance with the
app running: link, coach sees panels, queue and comment; unlink while the coach
is on the queue; the ex-athlete URL, the Roster, what the coach's session can
still read; re-link while the coach is on the Athlete View; and one link row,
one review, one comment at the end.

## What the endpoints refuse

Both require a JWT **before** the code is looked at. Without that, a
five-character code becomes a name-lookup oracle for anyone with curl —
24.3 million codes is a large keyspace and a poor secret.

The athlete is whoever the token says. An id from a request body would let a
caller link a coach to an account that is not theirs.

Rate limited per athlete *and* per address, because a gym shares one IP and the
thing worth limiting is how many codes one account can try. `resolve` is the
tighter of the two: it is the one that maps a code to a real person's name.

The answer carries a name and never an email. A coach with no name set degrades
to "Your coach" rather than showing an athlete their coach's address on the one
screen whose job is to say exactly what linking shares.

## Not an Appwrite Function

The feature list says redemption runs in a Function. What it means is *never
client side*, and this route is the same privilege at the same boundary as the
rollup and circle routes.

Worth stating plainly because FTP1-12 flagged Order 16 as the ticket with no
clean fallback if the events pipeline stayed broken. That was wrong twice over:
redemption is request/response — an athlete types a code and taps a button — so
it never needed database events, and events work anyway since the 1.9.6 upgrade
on 14 Sep 2026. See `docs/appwrite-events.md`.
