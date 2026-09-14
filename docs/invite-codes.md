# Invite codes

A coach's code is the only route from Ruairi's empty account to his first
athlete. Order 15 generates and shows one; Order 16 redeems it.

## The code is the row id

`SNB-4F7K2` is a legal Appwrite row id, so that is exactly what it is. The same
convention the product already runs on twice — the profile id is the user id,
a set's client id is its row id — and it buys two things:

- **Uniqueness from the primary key**, not from an index anyone has to trust.
- **Redemption is a point read.** Order 16 fetches one row by id with the API
  key rather than querying a table it must not let the caller list.

One inversion worth stating loudly, because this codebase reads 409s the other
way round everywhere else: on `invite_codes` **a 409 means the code is taken**,
not that a queued write already landed. `ensureInviteCode` generates another
and tries again — up to five times, then fails loudly, because five consecutive
collisions means the keyspace has run out rather than the luck.

## The alphabet

`23456789ABCDEFGHJKMNPQRSTVWXYZ` — 30 characters, five of them, 24.3 million
codes.

`I`, `L`, `O`, `0` and `1` are gone because this code gets read aloud across a
gym floor and typed one-handed by somebody who has not signed in yet. Removing
one side of every confusable pair means a mis-transcribed code fails to exist
rather than quietly resolving to a different coach. `U` is gone for a different
reason: it is the letter that turns a random five-character string into a word
somebody has to read out in public.

Input is normalised, not validated strictly: `snb 4f7k2`, `4F7K2` and
`SNB-4f7k2` are all the same code. A character outside the alphabet is the one
thing not forgiven — that is what the alphabet is for.

**Order 16 needs a rate limit.** A blind guess lands roughly once in ten
thousand attempts, which is a nuisance rather than a breach given the athlete is
shown the coach's name and asked to confirm. Unlimited attempts would change
that arithmetic.

## Who can do what

`invite_codes` is a **server-only table**, alongside `stats_rollups` and
`coach_athlete_links`:

| | read | write |
|---|---|---|
| The coach | their own row | never |
| Everyone else | never | never |
| The API key | everything | everything |

The coach's read is what lets Profile & Settings show the code with a plain
browser query — one round trip shorter than proxying it through our own server,
and the row is stamped for them alone.

Nobody writes one, including the coach whose code it is. A code someone can mint
is a code they can mint naming *somebody else* as the coach, which would hand
that coach's next athlete to the forger. So generation runs in
`app/api/invite/route.ts`, the coach id comes from the caller's JWT, and never
from the request body.

`scripts/appwrite-permission-probe.mts` asserts all of that against the live
instance, which is the half no amount of mocking establishes.

## Why everyone is offered a code

Role is a relationship — `isCoach` is true because athletes are linked to you —
so there is no account type to gate this on, and gating it on having athletes
would mean a coach with none could never get their first.

So the COACHING section appears for every signed-in user, offering a button. An
athlete who never taps it never has a code, and nothing about their account
changes. This resolves a contradiction between two blueprints: 09 — Profile &
Settings files the code under "coach additions", which cannot bootstrap, while
Onboarding says a coach's code is generated at sign-up, which would require
asking a new user which kind of user they are.

## One code per coach

A unique index on `coach_id`, and `ensureInviteCode` returns the existing code
rather than minting a second. A coach who taps twice, or whose first request
died on gym wifi, must not end up with the code they already texted somebody
looking wrong.

There is deliberately **no rotation**: a leaked code cannot currently be
replaced. Not in the blueprint, so not invented here — but it is the obvious
next thing this table will be asked for, and the shape (delete the row, mint
another) is already available.
