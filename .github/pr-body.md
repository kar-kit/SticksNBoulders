## FTP1-16 — Redeem code and link coach to athlete (Order 16)

An athlete types the code their coach gave them, is told in one sentence what
that shares, and confirms. The coach can then see every set they have ever
logged — including the ones from before the link existed.

That last part is the whole point of the circle design from phase 0. Appwrite
freezes a row's permissions at write time, so stamping coach ids would mean a
coach linked in November cannot see October, and fixing it later needs a
backfill over every row the athlete ever wrote. `e2e:link` asserts it head-on: a
set is written *before* any coach exists, and the coach reads it after linking.

### Consent is two steps, and the first writes nothing

`POST /api/link/resolve` names the coach. The screen shows **"Link with Ruairi
Deane?"** and the sentence. Only when they tap Link does `POST /api/link` write.

The blueprint is explicit that the consequence belongs at this moment rather
than in a policy document, and under UK GDPR this is the moment that has to be
defensible. A code that linked on submit would be one round trip faster and
would not be consent. The e2e checks that no link row exists at the point of
asking.

### The decision is pure

`lib/coach/link.ts` answers one question — given the athlete, the coach a code
resolved to, and the existing links, what should happen — and returns `self`,
`already-linked`, `other-coach`, `reactivate` or `create`. `link-admin.ts`
carries it out and nothing else. Sixteen tests cover the branches, including
the ones that are hard to reach against a live instance.

### The row before the membership, always

Two writes make a link real: the row in `coach_athlete_links` (the **record**)
and the circle membership (the **access**). Row first, every time.

A failure between them leaves a coach recorded but unable to see anything —
visible, recoverable, repaired by redeeming the same code again. The reverse,
access with no record of why, is the one outcome that must never happen, and
row-first cannot produce it. When the membership fails the answer is
`linked-not-visible` and the screen says so, because an athlete told "linked"
while their coach sees an empty roster is how a silent failure survives to
December.

### A real bug the unit tests all passed

`e2e:link` caught it. The athlete's circle team is created **lazily**, by the
first write the offline queue flushes. Onboarding asks for the coach code
*before* any training exists — so on the most common path there was no circle at
all, and adding a coach to a team that does not exist throws `team_not_found`.
The link row would land, the access would not, and the athlete would see
"linked".

`redeemInviteCode` now calls `ensureCircle` first. Worth noting that this is the
second time this ticket a browser-driven test found something sixteen unit tests
agreed was fine.

### Decisions worth your eye

**A second coach is refused, not added.** The schema permits many — the unique
index is on the *pair* — but quietly granting another person access to a
training history is exactly what this module exists to prevent, and the
blueprint's COACH section shows one name.

**There is no unlink yet**, so someone told "already linked to Ruairi" would go
hunting for a button that does not exist. The message says so outright. That is
the obvious next ticket and I did not invent it here.

**The answer carries a name and never an email.** A coach with no name set
degrades to "Your coach". Showing an athlete their coach's address on the one
screen whose job is to state exactly what linking shares is a leak the sentence
never promised.

### Not an Appwrite Function, and that was never a risk

FTP1-12 flagged this ticket as the one with no clean fallback if the broken
events pipeline stayed broken. **That was wrong, and I'd rather correct it than
leave you carrying a risk that doesn't exist.** Redemption is request/response —
an athlete types a code and taps a button — so it never needed database events.
The feature list's "runs in a Function" means *never client side*, which this
route satisfies at the same privilege and the same boundary as `/api/circle`
and `/api/rollup`.

Separately: the 1.9.6 upgrade restored `worker-executions`, so the events
pipeline may well be fixed now. Still unproven — the probe function needs
redeploying — but it no longer blocks anything here.

### Verification

```
npm test              901 ✓ (62 files)    npm run appwrite:probe   26/26
npm run e2e:link       21/21              npm run e2e:invite       17/17
npm run e2e:session    44/44              npm run e2e:history      19/19
npm run e2e:lift       17/17              npm run e2e:offline      33/33
npm run e2e:rollups    17/17              npm run e2e:e1rm         11/11
npm run e2e:auth       24/24              npm run e2e:backup       17/17
npm run e2e:shell      15/15
```

`e2e:link` drives three accounts through a real instance and checks what the
link actually granted, not what it claimed: the coach reads a pre-link set, a
stranger still cannot, redeeming twice makes one row, an unauthenticated caller
gets 401 from both endpoints, a coach cannot redeem their own code, and a second
coach is refused with nothing written.

### Also here

`scripts/prune-e2e-fixtures.mts` is cherry-picked in — it was pushed to FTP1-15
after you merged it, so it never reached `dev`. It clears stranded
`@example.com` fixture accounts, which is what was breaking `appwrite:backup`.
It earned itself again during this ticket: a crashed `e2e:link` run stranded
seven accounts and broke the dump, and one command fixed it.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
