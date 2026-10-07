# Reference maxes

_Order 17. Phase 2a. Source: Ruairi._

What a percentage is a percentage **of**.

## Why it is a table and not a field

The ticket is explicit: "a table with effective dates, not a number on the
profile". The reason is the failure it prevents. If a prescription says 80% and
the max is one mutable field, then every block ever written silently re-prices
itself the moment that field moves — an e1RM ticking up in October changes what
August's session meant. A block has to still explain itself later.

So entries are append-only and each carries the date it takes effect from.
Asking for the current max is asking a question with a date in it, and
`currentMax(entries, kind, asOf)` answers it: the newest entry that has already
come into effect. Entries dated in the future are invisible until then, which
is what lets a coach set next block's numbers in advance.

There is no update path. A new number is a new row. Deleting is the only edit,
and it exists for typos.

## Three kinds, two stored

| Kind | Where it lives | What it means |
| --- | --- | --- |
| `tested` | `reference_maxes` | An actual max attempt |
| `training` | `reference_maxes` | What Ruairi wants percentages calculated against, routinely not the tested max |
| `estimated` | `stats_rollups` | Rolling e1RM from logged work |

**Estimated is derived, never stored here.** `best_e1rm_kg` already sits in the
rollups and there is a rebuild script that regenerates it from raw sets.
Storing a second copy would be a second implementation of one aggregate, and
the rebuild script would then repair half the data and leave the other half
wrong — the same trap `docs/rollups.md` describes. `STORED_KINDS` has a test
asserting it holds exactly two values, so adding a third breaks the build.

When nothing names a kind, `preferredMax` picks training, then tested, then the
estimate — weakest last, because the athlete never agreed to it. Order 18 lets
a prescription name one explicitly.

## Per exercise, not per base lift

A max is held against an `exercise_id`. A 3-0-0 tempo bench and a competition
bench are different numbers and neither stands in for the other, and the
exercise library already treats a variation as its own row.

~~**[SME to confirm]** — whether Ruairi wants a percentage prescription *on* a
variation to be able to point at the base lift's max instead of the variation's
own.~~ **Answered by Ruairi, 6 Oct 2026:** yes, by default. "Tempo Bench at
70%" is 70% of the competition bench max. [Fact] — Joey's report of the
conversation.

It is still not modelled here, as this section said it should not be: the
pointer is a property of the prescription, `prescriptions.reference_exercise_id`
(`docs/reference-lift.md`, `docs/prescriptions.md`). Maxes stay per exercise —
a tempo bench max is still its own row and still prices any Tempo Bench line
that does not reference another lift. A referenced line simply reads the bench's
rows instead: same `currentMax`, same effective dates, same kinds, nothing
written twice. No change to this table, its permissions or the route.

## Panel order, and a cap that pointed the wrong way

Rows come out in **exercise library order**, not sorted by weight. The
blueprint's panel reads Squat, Bench, Deadlift — competition order — and the
seeded library is in that order, so passing it through reproduces the spec
without needing a "competition lift" flag that no field carries. Sorting by
weight looked tidier and would put most lifters' deadlift first.

`fetchReferenceMaxes` reads **newest first**. Appwrite ids are time-prefixed,
so ascending is creation order, and a cap on an ascending read keeps the oldest
rows and discards the newest — the panel would freeze on stale numbers, with no
error, once an athlete passed the cap. A coach setting weekly training maxes
across six lifts gets there inside a year.

## Why the coach cannot write this from their browser

This table inverts the product's usual rule. Everywhere else the athlete writes
and the coach only reads, because logged work is the athlete's. A training max
is not logged work — it is programming input, and setting it *is* the coaching.
So the coach is the author.

That made a client-side write look correct. It is not, and the probe proves why.

Appwrite permissions constrain **who may read a row**. They cannot constrain
**what a row says**. `athlete_id` is data, not a permission, and there is no
rule of the form "create only rows where this field equals your own id". So
with any table-level create, a signed-in stranger could write a row carrying
somebody else's `athlete_id`, stamp it `read("users")` — a role everybody holds
— and that invented number would appear in the athlete's panel as the max their
percentages resolve against. A wrong number on a bar.

It is `invite_codes` again: a code someone can mint for themselves is a code
they can mint naming somebody else as the coach.

So `reference_maxes` is a **server-only table**. Table permissions are `[]`,
row permissions are `[read(athlete), read(circle)]` — identical to a rollup —
and writes go through `app/api/reference-max` with the API key, behind
`mayWriteFor`, which allows exactly two callers:

- the athlete, for their own, and
- a coach with an **active row in `coach_athlete_links`**.

The link row is checked rather than circle membership, so a membership left
behind by a half-failed revoke is never mistaken for an authorisation.

The probe asserts all of it, including the cases that are easy to miss: neither
the coach nor the athlete can create a row client-side, a stranger cannot forge
one with `read("users")`, nothing can be edited in place, and a revoked coach
loses both read and write without anything re-stamping a single row.

## The inline editor (Order 25)

Order 17 shipped the write path with no control; Athlete View (Order 25) adds
it. CURRENT MAXES now shows all three kinds side by side per lift, marks the
one a percentage uses when nothing names a kind, and makes tested and training
editable inline: a weight, a date it takes effect from (today by default), and
Enter. A later date is next block's number and shows as "next … from …" until
it takes effect, rather than vanishing from the panel it was typed into.

Squat, bench and deadlift are always rows, even empty, so a coach's first move
with a new athlete (setting a training max on a lift nobody has logged) has
somewhere to go.

Undo, straight after a save, deletes the row just written. That is the typo
case deletion exists for; there is still no update path.

`npm run e2e:athlete-view` drives it in a browser: set, assert the row and its
`recorded_by`, undo, assert it is gone.

## Files

| File | What it holds |
| --- | --- |
| `lib/strength/reference-max.ts` | Pure resolver: `currentMax`, `resolveMaxes`, `preferredMax`, `buildMaxRows` |
| `lib/strength/reference-max-store.ts` | Reads (rows + rollups) and the write boundary |
| `appwrite/documents/reference-max-admin.ts` | `mayWriteFor`, `setReferenceMax`, `removeReferenceMax` |
| `app/api/reference-max/route.ts` | POST and DELETE, caller from the JWT only |
| `components/coach/current-maxes.tsx` | The CURRENT MAXES panel |
