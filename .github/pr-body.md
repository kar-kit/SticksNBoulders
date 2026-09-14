## FTP1-15 — Coach invite code generation (Order 15)

Ruairi's first session is an account with nothing on it. His invite code is the
only route from there to a first athlete, so this generates one, shows it on
Profile and on the Roster, and puts it on the clipboard. Redemption is Order 16.

### The code is the row id

`SNB-4F7K2` is a legal Appwrite row id, so that is exactly what it is. Third
time this codebase has made an id out of the thing it identifies — the profile
id is the user id, a set's client id is its row id — and it pays the same way:
uniqueness comes from the primary key rather than from an index anyone has to
trust, and Order 16 redeems with a point read instead of a query against a table
it must never let the caller list.

**One inversion worth reading twice.** Everywhere else in this codebase a 409
means a queued write already landed and is success. On `invite_codes` it means
the code is taken. `ensureInviteCode` generates another and retries — five
times, then fails loudly, because five consecutive collisions means the keyspace
has run out rather than the luck.

### The alphabet

`23456789ABCDEFGHJKMNPQRSTVWXYZ` — 30 characters, five of them, 24.3M codes.

`I`, `L`, `O`, `0` and `1` are gone because this gets read aloud across a gym
floor and typed one-handed by somebody who has not signed in yet. Removing one
side of every confusable pair means a mis-transcribed code fails to exist rather
than quietly resolving to a *different coach*. `U` is gone for a different
reason: it is the letter that turns a random five-character string into a word
somebody has to read out in public.

Input is then normalised rather than validated strictly — `snb 4f7k2`, `4F7K2`
and `SNB-4f7k2` are one code. Length, not the prefix, decides whether a leading
`SNB` is the prefix or part of the body: `S`, `N` and `B` are all in the
alphabet, so `SNB-SNB23` is a code this generator can produce, and stripping on
sight would refuse the bare body somebody typed.

**Order 16 needs a rate limit.** A blind guess lands roughly once in ten
thousand attempts — a nuisance rather than a breach, given the athlete is shown
the coach's name and asked to confirm. Unlimited attempts change that.

### Permissions — schema v3, applied

`invite_codes` joins `stats_rollups` and `coach_athlete_links` as a server-only
table. The coach reads their own row; nobody else reads it at all. Not because
the code is a secret from the athlete — the coach is about to text it to them —
but because a signed-in user who could list the table could link themselves to
every coach on the instance.

Nobody writes one, **including the coach whose code it is**. A code you can mint
for yourself is a code you can mint naming somebody else as the coach, which
hands their next athlete to you. So minting is `app/api/invite/route.ts`, the
coach id comes from the caller's JWT, and never from the request body.

`appwrite:probe` now asserts that against the live instance: 26/26, including
that Joey cannot mint a code naming himself the coach, and that Ruairi cannot
rewrite his own code to point at somebody else.

Unlike rollups, nothing here wants an Appwrite Function — generation is
user-initiated, so it never touches the events pipeline that is broken on this
homelab. **Redemption at Order 16 is the half that does, and still has no plan.**

### Every athlete's Me screen now has a COACHING section

This is the load-bearing consequence and the thing you will notice first.

`isCoach` is true because athletes are linked to you, so gating the code on it
would mean a coach with none could never get their first one. That resolves a
contradiction between two blueprints: 09 — Profile & Settings files the code
under "Layout, coach additions", which cannot bootstrap, while Onboarding
generates it at sign-up, which would mean asking a new user which kind of user
they are — inventing the account type CLAUDE.md says never to invent.

So the section appears for everyone, offering a button. An athlete who never
taps it never has a code, and nothing about their account changes. Shout if you
would rather it hid behind something.

On the Roster it is the empty state's action rather than a section beneath it —
that body already says "share your invite code", and sending a coach to a
settings tab to find the thing the screen just asked for is the errand that
makes a product feel slow.

### Verification

```
npm test               858 ✓ (59 files)     npm run appwrite:probe   26/26
npm run e2e:invite      17/17               npm run e2e:shell        15/15
npm run e2e:session     44/44               npm run e2e:history      19/19
npm run e2e:lift        17/17               npm run e2e:offline      33/33
npm run e2e:rollups     17/17               npm run e2e:e1rm         11/11
npm run e2e:auth        24/24               npm run perf:check       within budget
```

`e2e:invite` drives the round trip a browser is the only place to see: an empty
account taps a button, a table no browser may write gains a row, the clipboard
holds the code, and it is still there after a reload and on the Roster. A second
request to the route returns the *same* code and says it created nothing — a
coach who taps twice, or whose first request died on gym wifi, must not end up
with the one they already texted somebody looking wrong.

### `e2e:backup` fails, and it is not this branch

It fails identically on `dev` with these changes stashed. The cause is instance
state: 16 rows (5 sessions, 6 sets, 5 rollups) belonging to
`lift-1789401513863@example.com` still reference a circle team that was deleted,
so the dump refuses itself. An `e2e:lift` run died between its teardown steps.

There is also `invite-coach-1789421350648@example.com`, left by my own first
`e2e:invite` run before I fixed it — mine to have cleaned up.

Deleting rows from the live instance was blocked, correctly, so both are yours
to clear: removing those two accounts and their rows unblocks the backup. I took
a dump first — `.appwrite-backup/2026-09-14T21-39-55-950Z/` — so the rows are
recoverable either way. Worth knowing that an interrupted e2e run can leave the
backup invariant broken; a teardown that ran in `finally` would not.

### Still open

- **No rotation.** A leaked code cannot be replaced. Not in the blueprint, so
  not invented — but it is the obvious next ask, and the shape (delete the row,
  mint another) is already there.
- The suggestion-approval toggle and Billing from the same blueprint section are
  Order 28 and later; only the code landed here.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
