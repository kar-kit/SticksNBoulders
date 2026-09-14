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
clean fallback if the broken events pipeline stayed broken. That was wrong.
Redemption is request/response — an athlete types a code and taps a button — so
it never needed database events at all.
