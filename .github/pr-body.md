## FTP1-16.5 — Unlink a coach (Order 16.5)

The ticket added after FTP1-16 shipped a trap: an athlete who typed the wrong
code was linked forever, and the UI said so outright because there was nothing
else honest to say. This is the way out.

An athlete taps Unlink, is told in one sentence what stops, and confirms. The
coach immediately loses the ability to read anything — not at their next login,
not after a backfill.

### The ordering is the whole ticket

Linking writes the **record** first and grants **access** second. Unlinking
removes access first and writes the record second.

Both orders serve one invariant: **there is never access without a record of
why.** A failure in either direction leaves a link recorded while the coach may
not be able to see anything — visible, recoverable, fixed by trying again. The
reverse is the sev-1, and neither ordering can produce it.

### A silent return that needed catching

`removeCoachFromCircle` returns silently when it finds no membership. That is
correct for idempotency, but it means "removed it" and "it was never there" are
indistinguishable from the caller — and on this path, being wrong leaves a coach
reading a training history the record says they cannot see.

So `revokeCoachAccess` **re-reads the circle** after removing, and refuses to
write the row unless the coach is genuinely gone. One extra request, guarding
the only direction that matters. When it fails the answer is `still-visible`,
nothing is written, and the screen says *"Nothing changed — try again."*

### Revoked, never deleted

The row is the record of who could once see what. It also has to survive,
because the unique index on `(coach_id, athlete_id)` means re-linking later
reuses it — `reactivateCoachLink` from FTP1-16 already handled that, and this is
the first path that exercises it for real.

### The assertion that earns the ticket

`e2e:link` now drives the full round trip against the live instance:

```
seed a set  →  link  →  coach reads it  →  unlink  →  coach CANNOT read it
                                              ↓
                             athlete still can · row revoked, not deleted
                                              ↓
                    redeem the same code  →  same row reused  →  access back
```

A test that only checked the row flipped to `revoked` would pass with the
membership still in place. That is precisely the bug worth catching, so the
negative read is asserted directly.

### Copy

The confirm mirrors the linking one — named, specific — and adds a line the
linking sentence does not need:

> Ruairi Deane will no longer see your sessions, your videos or your bodyweight,
> and won't be able to set your training program. **Your own training stays
> exactly as it is.**

The fear at that moment is losing your own log, not the coach's view of it.

### Two assumptions, stated rather than decided

- **Athlete-initiated only.** Whether a coach can drop an athlete from their own
  roster is `[SME to confirm]` on the ticket. Not guessed here.
- **A hard cut.** Access ends the instant the membership goes. Whether a coach
  should keep seeing anything for a window — a session they are mid-review on —
  is a product decision Ruairi hasn't made. Worth putting to him.

One deliberate asymmetry: **revoking is not rate limited**, unlike redeeming.
Guessing codes is the attack redemption defends against; revoking only ever
touches the caller's own link, and a limit would mean an athlete who taps twice
cannot withdraw consent. Under UK GDPR that has to be as easy as giving it.

### Verification

```
npm test              923 ✓ (62 files)    npm run appwrite:probe   26/26
npm run e2e:link       34/34              npm run e2e:invite       17/17
npm run e2e:session    44/44              npm run e2e:history      19/19
npm run e2e:lift       17/17              npm run e2e:offline      33/33
npm run e2e:rollups    17/17              npm run e2e:e1rm         11/11
npm run e2e:auth       24/24              npm run e2e:backup       17/17
npm run e2e:shell      15/15
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
