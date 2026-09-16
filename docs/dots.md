# DOTS

Order 37. A total, divided by what a lifter that size is expected to total, so
that progress at a changing bodyweight is still legible as progress.

**A personal progression number. Not a leaderboard.** The ticket says so and
CLAUDE.md says so twice: leaderboards, groups and the friend competition layer
are the final phase, well after the beta, and are not to be scaffolded for. So
there is no ranking, no percentile, no comparison between athletes, and no
shape here that would make one cheap to add later. One athlete, one number, on
the two screens the feature row names.

## The coefficients, and where they came from

This is the part of the ticket that was allowed to block. DOTS becomes a number
in a real athlete's profile, and a wrong digit produces a score that looks
entirely reasonable — 341 and 374 are both plausible for the same lifter — so
nothing here is written from memory.

They are transcribed from OpenPowerlifting's reference implementation, which is
the code that computes the DOTS printed on every lifter page on that site:

> `crates/coefficients/src/dots.rs`, OpenPowerlifting (`opl-data`)
> <https://gitlab.com/openpowerlifting/opl-data/-/blob/facce0f532698157f9aa0ef29f921cd36d2ea5c4/crates/coefficients/src/dots.rs>
> blob `0972e0348132e67e24e53737544b57eecb19186d`, retrieved 16 September 2026
> ISC licence, © 2020 The OpenPowerlifting Project

Pinned to a commit rather than to `main`, because `main` moves and a citation
that can change underneath you is not a citation. The file's content has not
changed since March 2022.

**Which revision.** [Fact] One. The formula was written by Tim Konertz for the
BVDK, the German IPF affiliate, which needed a score that compares across sexes
so that mixed teams could compete — IPF Points cannot do that, and Wilks had
been dropped by the IPF. There is no DOTS-2 or revised-DOTS in circulation the
way there is a Wilks and a Wilks-2020. [Unverified] If the BVDK ever publishes
a revision, the giveaway will be these ten numbers changing; nothing else in
this file would need to.

The two sets are kept as separate named constants, `MEN` and `WOMEN`, rather
than as a record keyed by sex, so that a lookup with a bad key is a type error
instead of an `undefined` that reaches the arithmetic and hands a screen `NaN`.

### The clamp is part of the formula, not tidiness

The reference clamps bodyweight to **40–210kg for men and 40–150kg for women**
before evaluating, and so does this. Different ceilings, and they must not be
shared.

The polynomial has a negative leading term, so past its fitted range it turns
over: an unclamped 250kg lifter would score *higher* as they got heavier, and a
light enough input crosses zero and flips the sign. Clamping scores a lifter
outside the range as though at the boundary, which understates them rather than
inverting them. [Inference] Unreachable in practice on the athlete side —
`checkWeight` already rejects anything outside 20–400kg, and the clamp sits
inside that — but a weight typed in pounds by someone whose profile says kg
lands at 180 for an 82kg lifter, which is inside the men's range and quietly
wrong in a different way. That one is a units problem, not this file's.

Zero bodyweight or zero total scores zero, matching the reference. The previous
product's version returned a **negative** number there, because at 0kg the
polynomial evaluates to its negative constant term.

### Validated against published scores

The formula was checked against real lifters at documented bodyweights and
totals whose DOTS OpenPowerlifting publishes — **98 meet rows across three
lifters, both sexes**, retrieved 16 September 2026 from
`openpowerlifting.org/u/jesusolivares`, `/u/agatasitko` and `/u/jessicabuettner`.
Seven of them are in `lib/strength/dots.test.ts`, chosen from kilogram
federations.

A published DOTS is not reproducible to the last decimal from a published
bodyweight, and the reason is worth writing down rather than solving with a
loose tolerance. The site stores bodyweight to two decimals and prints it to
one, so a row reading `63.4` was lifted at some weight in `[63.4, 63.5)`.
Heavier means a lower score, so the true score lies in a band a few hundredths
wide, between the score at the printed weight and the score a tenth above it.
**96 of the 98 rows fall inside that band.** The two that do not are
pound-converted high-school totals whose hidden precision is its own source of
disagreement, and they are excluded from the test table rather than explained
away.

So the tests assert the band, not an equality. It is tight enough that a
transposed digit in any coefficient misses it by whole points.

The previous product's `lib/dots.ts` carried the same ten numbers and is
**deleted** rather than reused. Its test recomputed the same polynomial inline
and asserted the two agreed — which passes for any coefficients at all, and is
exactly the plausible-numbers-with-a-tautological-test trap this ticket was
written to avoid. Matching numbers were not evidence; the citation is.

> **Note on the blueprint.** Page 08's wireframe shows `DOTS 341.2` above
> `from 212.5 / 140 / 200`. Those two figures do not reconcile: a male lifter at
> 82.4kg with a 552.5kg total scores **374.5**. The wireframe's numbers are
> decorative, and were not treated as a test vector.

## Where the total comes from

DOTS needs a bodyweight and a total, and which total changes the number, so
this was decided deliberately rather than inherited.

**The better of the tested reference max and the best rolling e1RM, per
competition lift. Training maxes are excluded.**

That diverges from `preferredMax`, which the CURRENT MAXES panel uses and which
puts the training max first. The divergence is the point:

- **A training max is deliberately submaximal.** Ruairi sets it below the
  tested single on purpose, because that is what he wants percentages taken
  from. Feed it into DOTS and a coach starting a conservative block *lowers*
  their athlete's progression number without the athlete doing anything — a
  number that lies about the thing it claims to measure. Proved live, not just
  claimed: `e2e:dots` writes a training max and asserts the score does not move.
- **Not e1RM alone.** `reference-maxes.md` says a tested max may be "entered or
  detected", so a meet total the coach typed in has no set behind it and would
  never appear in the rollups.
- **Not tested alone.** Most athletes never enter one, and their DOTS would
  never appear at all.

The estimate comes from `stats_rollups` and never from raw sets — the rule in
`rollups.md` — via `fetchEstimatedMaxes`, which already takes the maximum across
weeks so that a deload does not drop the score.

**[SME to confirm]** — whether Ruairi is content with a DOTS built partly on
e1RM estimates, or wants it computed from tested maxes only. It is a one-line
change here. Worth asking, because an athlete who has never tested would then
have no DOTS at all, and the "all three or none" rule below would bite far more
often.

### Identifying the three lifts

[Inference] Nobody specified how the app knows what a competition lift is, and
no field in the schema carries the idea — `reference-max.ts` says so outright
and sidesteps it by using library order. DOTS cannot sidestep it: it needs
exactly these three and must not accept a fourth. So there is a constant of
three normalised names in `dots.ts`, and **no schema change**.

Matched on exact normalised equality and `is_global`, never `includes`. The
seeded library holds Front Squat, Pause Squat, Tempo Squat, Box Squat, Safety
Bar Squat, Pause Bench Press, Close Grip Bench Press, Incline Bench Press, Sumo
Deadlift, Deficit Deadlift, Romanian Deadlift and Stiff Leg Deadlift. A
substring match on `squat` picks up five lifts that are not the competition
squat, and `seed.ts` is explicit that a variation is its own exercise with its
own max. The global filter stops an athlete's own hand-typed "Squat" shadowing
the seeded row and splitting the lift's history in half.

**All three or none.** Two lifts is not a total: a missing deadlift cuts the
score by roughly a third and would read as a collapse in form rather than as an
absent number. The refusal names the missing lifts so the screen can say which.

## Nothing is stored

DOTS is not written to a document and has no rollup. The compute-and-store rule
in CLAUDE.md exists because Appwrite has no `GROUP BY` — it applies to
aggregates, and DOTS is a single division over numbers both screens have
already fetched. Storing it would add a second copy to keep true, and a
`rebuild` script to keep it true with.

`fetchDots` is one function used by both surfaces rather than one each, for the
same reason: a coach and an athlete seeing different DOTS for the same lifter
is a bug discovered in a conversation, not in a test. Five reads in parallel,
no branch anywhere on who is asking — the coach reads all five through the
circle team exactly as the athlete reads them for themselves.

## The four ways there is no number

A discriminated result rather than `number | null`, because each one needs
different words on screen. The blueprint asks DOTS to "fail gracefully with a
prompt to complete the profile rather than showing a broken figure", which it
can only do if it knows which thing is absent.

| | Athlete sees | Coach sees |
| --- | --- | --- |
| `no-sex` | a link to Profile | what he is waiting on |
| `no-bodyweight` | "log a weight and this appears" | "waiting on a weigh-in" |
| `incomplete-total` | which lifts need a number | which lifts, and why |
| stale bodyweight | **the score, labelled** | **the score, labelled** |

Refusals are ordered by what the athlete can act on: sex is one tap on Profile,
a weigh-in needs scales, a missing lift needs training. Reporting the cheapest
fix first is the difference between a prompt and a wall.

**A stale bodyweight still scores.** This follows the precedent `bodyweight.md`
set rather than inventing one: when `trend` goes null both screens keep showing
the last weight with the day it was taken. Suppressing DOTS instead would empty
the panel on the screen that exists so Ruairi stops having to ask; presenting
it as current is the "lie with a number attached" that doc names. So it is
labelled with the weight and its date, not hidden. The window is the bodyweight
module's own `AVERAGE_DAYS` — there is deliberately **no staleness constant in
this feature**, because two of them would drift and the screens would disagree
about what "recent" means.

Sex stays nullable, and `dotsScore` takes a non-nullable `Sex`, so a missing
answer cannot reach a coefficient set. `profile.md` already made that call: an
athlete for whom neither option is right can leave it unset and lose DOTS,
which is better than a third option that silently picks one of the two
formulas anyway.

## What is not here

**No leaderboard, and nothing that would become one.** No groups, no ranking,
no percentile, no data model for comparing two athletes. Cut entirely, not
deferred into a half-built shape.

**No DOTS-over-time chart and no roster DOTS column.** Both are a few lines on
top of what is here, and both are the first step of the competition layer
rather than the last step of this ticket. Blueprint 08 shows a single number.

**No schema change.** Three sibling branches are live and `appwrite-setup.mts`
is the file they would all collide in; nothing about this feature needs a new
attribute.

**No lb display.** The figure is unitless, and the breakdown under it is in kg
like every other number in the product. `profiles.units` is a display
preference that nothing yet honours, which is its own ticket.

## Verified against the instance

`npm run e2e:dots` — 12 checks. The arithmetic is unit-tested and needs no
network; what only the instance proves is the composition, because DOTS is the
first number in the product assembled from **five tables at once**: `profiles`,
`bodyweight_entries`, `reference_maxes`, `stats_rollups` and `exercises`.

The headline check is that a linked coach reads all five through the circle
team and lands on exactly the number the athlete sees. Five tables is five
chances for one to be readable by the athlete and not their coach, and that
failure would not look like a permission error — it would look like a slightly
different score.

Also proved rather than claimed: a training max does not move the number, a
Pause Squat with a 400kg e1RM stays out of the total, a better rolling e1RM
raises it, a month-old weigh-in still scores and is flagged, a stranger gets
nothing, and a revoked coach loses it with everything else.

## Files

| File | What it holds |
| --- | --- |
| `lib/strength/dots.ts` | The coefficients, the clamp, the three lifts, the result type |
| `lib/strength/dots.test.ts` | Published reference points, both sexes, every refusal |
| `lib/strength/dots-store.ts` | The five reads, shared by both screens |
| `components/strength/dots-block.tsx` | The figure, and the words when there isn't one |
| `scripts/e2e-dots.mts` | The composition, live |
