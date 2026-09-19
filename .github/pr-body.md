## Order 37 — DOTS calculation and display

A total divided by what a lifter that size is expected to total, so progress at
a changing bodyweight still reads as progress.

**A personal progression number, not a ranking.** No leaderboard, no groups, no
percentile, no comparison between two athletes — and deliberately no shape that
would make one cheap to add later. That layer is the final phase.

### The coefficients are cited, not remembered

This is the part of the ticket that was allowed to block, so none of the ten
numbers are written from memory. They're transcribed from OpenPowerlifting's
reference implementation — the code that computes the DOTS printed on every
lifter page on that site — **pinned to a commit rather than to `main`**, because
a citation that can change underneath you isn't a citation. Tim Konertz wrote
the formula for the BVDK; there's one published revision. `docs/dots.md` carries
the URL, the blob hash and the retrieval date.

**Validated against 98 published meet rows, three lifters, both sexes.** Seven
are in the tests.

A published DOTS isn't reproducible to the last decimal from a published
bodyweight, and the reason is worth having rather than papering over with a
loose tolerance: the site stores bodyweight to two decimals and prints **one**,
so a row reading `63.4` was lifted somewhere in `[63.4, 63.5)`, and the true
score sits in a band a few hundredths wide. **96 of the 98 fall inside it.** The
two that don't are pound-converted high-school totals whose hidden precision is
its own problem — excluded from the table rather than explained away. The tests
assert the band, which is tight enough that a transposed digit misses it by
whole points.

### The old `lib/dots.ts` is deleted, not reused

It carried the same ten numbers — and that wasn't evidence of anything. Its test
recomputed the same polynomial inline and asserted the two agreed, which passes
for *any* coefficients at all. That's precisely the plausible-numbers-with-a-
tautological-test trap this ticket was written to avoid, and it sat green in the
suite the whole time. It was also per-lift and leaderboard-shaped, and returned
a **negative** score at zero bodyweight.

The clamp came with the citation and is part of the formula rather than
tidiness: **40–210kg for men, 40–150kg for women**, and the ceilings must not be
shared. The quartic has a negative leading term, so past its fitted range it
turns over and a heavier lifter would score *higher*.

### Where the total comes from — your call to confirm

This changes the number, so it was decided rather than inherited: **the better
of the tested max and the best rolling e1RM per competition lift, with training
maxes excluded.**

That diverges from `preferredMax`, which CURRENT MAXES uses, and the divergence
is the point. A training max is deliberately submaximal — so feeding it in would
mean **you starting a conservative block lowers your athlete's progression
number** without the athlete doing anything. The e2e writes one and asserts the
score doesn't move.

Not e1RM alone either: a meet total you typed in has no set behind it and would
vanish. Not tested alone: most athletes never enter one and would never see a
score.

> **[SME to confirm]** — is Ruairi happy with DOTS built partly on e1RM
> estimates, or does he want tested maxes only? One line to change. Worth asking,
> because an athlete who's never tested would then have no DOTS at all.

### Identifying the three lifts

Needed a concept no field in the schema carries, so it's a constant of three
normalised names and **no schema change** — three sibling branches are live and
`appwrite-setup.mts` is where they'd all collide.

Matched on exact equality and `is_global`, never `includes`. The seeded library
holds five squat variations, and `seed.ts` is explicit that a variation is its
own exercise with its own max. The global filter stops an athlete's hand-typed
"Squat" shadowing the seeded row.

**All three or none.** Two lifts isn't a total — a missing deadlift cuts the
score by a third and would read as a collapse in form rather than an absent
number.

### Nothing is stored

The compute-and-store rule is about aggregates Appwrite can't compute on read.
This is one division over numbers both screens already fetch, so storing it
would just add a second copy to keep true. One `fetchDots` serves both surfaces
— you and your athlete seeing different DOTS for the same lifter is a bug found
in a conversation, not in a test.

### The four ways there's no number

A discriminated result rather than a null, because each needs different words.
The blueprint asks DOTS to fail with a prompt to complete the profile, which it
can only do if it knows *which* thing is missing. Refusals are ordered by what
the athlete can act on — sex is one tap, a weigh-in needs scales, a missing lift
needs training.

**A stale bodyweight still scores, labelled.** Following the precedent
`bodyweight.md` set: suppressing it would empty the panel on the screen that
exists so you stop having to ask, and showing it bare would present a month-old
weight as this morning's. The window is the bodyweight module's own, so there's
no second staleness constant to drift.

### One thing about the blueprint

Page 08's wireframe shows `DOTS 341.2` above `from 212.5 / 140 / 200`. Those
don't reconcile — that lifter scores **374.5**. I read the figures as decorative
and didn't use them as a test vector. Flagging it in case 341.2 was meant to
mean something.

### Not in scope

- **No DOTS-over-time chart, no roster DOTS column.** Both are a few lines on
  top of this, and both are the first step of the competition layer rather than
  the last step of this ticket. Blueprint 08 shows a single number. Say if you
  want either.
- **No lb display.** The figure is unitless and the breakdown is in kg like
  everything else. `profiles.units` is a preference nothing yet honours — its own
  ticket.

### Verification

`lint` · `typecheck` · **1244 tests, 76 files** · `perf:check` inside budget ·
`appwrite:probe` **42/42**.

Live: `npm run e2e:dots` — **12/12**. The arithmetic is unit-tested and needs no
network; what only the instance proves is the composition, because DOTS is the
first number in the product assembled from **five tables at once** — `profiles`,
`bodyweight_entries`, `reference_maxes`, `stats_rollups`, `exercises`. The
headline check is that a linked coach reads all five through the circle team and
lands on exactly the number the athlete sees. Five tables is five chances for
one to be readable by the athlete and not their coach, and that failure wouldn't
look like a permission error — it'd look like a slightly different score.

Also proved rather than claimed: a training max doesn't move it, a Pause Squat
with a 400kg e1RM stays out of the total, a better rolling e1RM raises it, a
month-old weigh-in still scores and is flagged, a stranger gets nothing, a
revoked coach loses it.

⚠️ **`npm run build` could not be run in this worktree** — `node_modules` is a
symlink into the primary checkout and Turbopack rejects it as "out of the
filesystem root". Pre-existing worktree setup, nothing to do with this diff, but
worth a build on `dev` after merge.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
