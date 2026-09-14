# Weekly rollups

One row per athlete per exercise per week. Appwrite has no `GROUP BY`, so every
chart, PR and dashboard reads these rather than raw sets — which makes them the
only aggregates in the product, and makes a wrong one dangerous: it looks
exactly like a right one.

## Recomputed, never adjusted

A bucket is always rebuilt from its sets. Incremental adjustment is faster and
wrong — it cannot survive an undo, a correction, or the same set arriving twice
from a retried queue — and a week of one lift is one query of at most a few
dozen rows.

The consequence is that the live path and the repair path are the *same
function*: `rollupFrom` in `lib/strength/rollup.ts`. Two implementations of an
aggregate is how a repair script stops repairing.

## What a week is

Monday to Sunday (Joey, 14 Sep 2026), decided in **Europe/London**.

That is not the same as storing times in UTC, which the product does and should
— `logged_at` is an instant. It is about which calendar week an instant falls
in, and in the UK that is not a question UTC can answer:

```
2026-09-13T23:30:00Z  =  Monday 14 Sep, 00:30 BST
UTC-only rule says:      week beginning 7 Sep   ← wrong
```

Under BST — roughly seven months a year — a set logged in the first hour of a
Monday morning would land in the week that just ended. One hour every Monday,
quietly filed under last week's volume.

`week_start` is stored as a **label**, the UTC midnight of that local Monday, so
the column reads as a Monday to anyone looking at the database and the unique
index stays stable across the BST boundary.

[SME to confirm] the day itself. If Ruairi runs Sunday-to-Saturday it is one
constant and a rebuild run.

## What counts

Warm-ups count toward nothing — set count, volume, tonnage and every best. Same
rule the session summary applies, so a week's numbers and a session's numbers
agree rather than quietly differing by a warm-up.

`best_single` is the heaviest working set and, on a tie, the most reps at that
weight: 140×5 is a better week than 140×3, and a rollup that called them equal
would flatten exactly the progress the chart exists to show.

A week with no working sets produces **no row**, rather than a row of zeroes. A
row of zeroes is a different statement — it says the week happened and was
empty.

## What writes them

`stats_rollups` is a server-only table; no user session may write one, by
policy. So this cannot happen in the browser.

The feature list asks for an Appwrite Function on set creation. **It does not
work on the current instance.** Verified 14 Sep 2026:

| | result |
| --- | --- |
| Deploy a Function | works — 3 second build |
| Execute it manually | works — completes in milliseconds |
| Trigger it from a database event | **never fires**, including a bare `databases.*` |

So a set write queues a `rollup.refresh` op, which calls `POST /api/rollup` —
the same pattern as `/api/circle`, at the same privilege level, through the same
write helper. Moving to a Function later is a change of caller, not of logic:
the Appwrite part is `appwrite/documents/rollup-admin.ts` and the arithmetic is
shared with the rebuild script.

The athlete id comes from the caller's JWT and never from the request body.

### Why an op and not a fire-and-forget call

A rollup that fails to update looks exactly like one that is correct. As a
queued op it retries, survives a reload, and a refusal that will never succeed
ends up visible rather than silent.

Refreshes of the same bucket collapse — five sets of squats need one recompute —
but the **last** one survives, not the first. Collapsing at enqueue keeps the
earliest, which sits in the queue *ahead* of the sets that follow it: it runs,
sees a partial session, and nothing recomputes it again. The week then sits
frozen at whatever had landed partway through. Caught by `e2e:session`, which is
why the check happens at drain time instead.

## Repairing them

```
npm run rollups:rebuild              # plans, writes nothing
npm run rollups:rebuild -- --yes     # applies
```

Repairs three things: a bucket nothing ever wrote, a bucket that drifted, and a
rollup whose sets are all gone — which an undo leaves behind and which would
otherwise sit in the chart forever claiming a week happened.

`rebuilt_at` on every row says when it last agreed with the sets.

Run it after `npm run e1rm:backfill`, which changes the `e1rm_kg` that
`best_e1rm_kg` is drawn from. They are separate scripts because they fix
different failures and you want to run one without the other.

## Testing

- `npm test` — the arithmetic, the week boundary including the BST case, and the
  queue's supersede rule.
- `npm run e2e:session` — the live path: log a session, assert the rollup row.
- `npm run e2e:rollups` — the repair path: missing, drifted, orphaned and
  already-correct buckets, plus a set logged at 00:30 Monday BST.
