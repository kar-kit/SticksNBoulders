# Appwrite events

**Database events did not trigger Functions on Appwrite 1.9.0. They do on
1.9.6.** Measured on this instance, 14 Sep 2026.

This mattered enough to document because a whole design decision was built on
the broken behaviour, and anyone reading `app/api/rollup/route.ts` needs to know
the constraint it works around no longer exists.

## The measurement

The `probe-events` function subscribes to a set being created and does nothing
but log that it ran. Executions carry a `trigger` field, so the evidence is
whatever Appwrite recorded rather than anything the function decided.

| trigger | count | first | last |
|---|---|---|---|
| `event` | 332 | 2026-09-14T22:31Z | 2026-09-14T23:51Z |
| `http` | 1 | 2026-09-14T23:51Z | 2026-09-14T23:51Z |

The 1.9.6 upgrade completed at roughly **22:05Z**. Every event-triggered
execution in the instance's history falls after it, and none before — which is
as clean a before/after as this is going to get, because the same function with
the same subscriptions produced nothing on 1.9.0.

The likely cause: 1.9.0's installer-generated `docker-compose.yml` had no
`appwrite-worker-executions` service. Appwrite's 1.9.5 notes list a fix for
exactly that omission, and the service exists after the upgrade. **[Inference]**
— the timing and the missing service agree, but nothing was instrumented inside
Appwrite to prove the mechanism.

## The gotcha for whoever subscribes next

The event that actually fired was the **documents** form, not the tables form:

```
databases.sticksnboulders.collections.sets.documents.<rowId>.create
```

The probe carried both subscriptions, and this is the one that matched. So a
Function subscribed only to `databases.<db>.tables.<table>.rows.*.create` may
never fire even though it looks like the right name for a TablesDB write.
Subscribe to both, or verify which one your version emits before trusting it.

## Who subscribes now

`validate-row` (appwrite/functions/index.ts) subscribes to both spellings of
row create and update across the database, and filters by table itself. It is
the first Function this product depends on for correctness: a forged row is
deleted within seconds of landing. If it stops firing, readers still hide the
row (appwrite/documents/provenance.ts) and the audit says so.

## What this does and does not change

**Rollups stay in a route.** `app/api/rollup/route.ts` was written as a
workaround and stays by choice. A Function would need its own copy of
`lib/strength/rollup.ts`, and two implementations of an aggregate is how a
repair script stops repairing — the reason `rollupFrom` is shared with the
rebuild script at all. What a Function buys is firing on writes that did not
come through this app, and by policy there are none.

**Invite redemption stays in a route.** It never needed events: an athlete types
a code and taps a button. FTP1-12 flagged Order 16 as the ticket with no clean
fallback if events stayed broken; that was wrong on both counts.

**The probe has no subscriptions.** It was marked disabled on 14 Sep with its
subscriptions kept as a record, and that turned out not to be off: on 1.9.6
the functions worker matches events against every Function's `events` and
never checks `enabled` (`src/Appwrite/Platform/Workers/Functions.php` in the
`appwrite-worker-functions` container, read 6 Oct). So the disabled probe kept
executing on every set create -- 75 failures on 6 Oct alone, each
`Timed out waiting for runtime`.

That is worse than noise. The worker runs the matching Functions for one event
in a loop, in creation order, and a failed execution re-throws out of the loop.
The probe was created before `validate-row`, so whenever the probe's runtime
timed out, `validate-row` never ran for that set. **[Fact]** from the worker
source; observed as set creates that reached the probe's log and not the
validator's.

Its events were cleared on 6 Oct; the function and its deployment are kept.
What it subscribed to, for the record:
`databases.sticksnboulders.tables.sets.rows.*.create` and
`databases.sticksnboulders.collections.sets.documents.*.create`.

The rule that follows: **to switch a Function off, clear its events, not just
`enabled`.** And any event-triggered Function that fails takes every
later-created Function on the same event down with it, so a flaky one is
everyone's problem.

## If you are on 1.9.0 again

Check `docker ps` for `appwrite-worker-executions`. If it is absent, events will
not fire no matter how the Function is configured, and no amount of subscription
tweaking will help.
