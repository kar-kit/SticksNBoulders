## Appwrite events work on 1.9.6 — correcting the record

Not a feature. Tonight's upgrade fixed something four places in the tree
described as broken, and a comment explaining why a workaround exists is worse
than no comment once the thing it works around is gone: the next person reads it
as a live constraint.

### The measurement

`probe-events` subscribes to a set being created and does nothing but log that
it ran. Appwrite records a `trigger` on every execution, so the evidence is its
own bookkeeping rather than anything the function decided.

| trigger | count | first | last |
|---|---|---|---|
| `event` | 332 | 22:31Z | 23:51Z |
| `http` | 1 | 23:51Z | 23:51Z |

The upgrade completed around **22:05Z**. Every event-triggered execution in the
instance's history falls after it and none before — the same function, the same
subscriptions, nothing on 1.9.0.

Cause is **[Inference]**, not fact: 1.9.0's installer-generated compose had no
`appwrite-worker-executions` service, 1.9.5's notes fix exactly that omission,
and the service exists post-upgrade. The timing and the missing service agree;
nothing inside Appwrite was instrumented to prove the mechanism.

### The finding worth more than the headline

The event that actually fired was the **documents** form, not the tables form,
for a TablesDB row write:

```
databases.sticksnboulders.collections.sets.documents.<rowId>.create
```

The probe carried both subscriptions and this is the one that matched. A
Function subscribed only to `databases.<db>.tables.<table>.rows.*.create` may
never fire while looking entirely correct. That is a expensive afternoon for
whoever hits it, so it is in `docs/appwrite-events.md` in bold.

### What I did not change

**Rollups keep their route.** It was a workaround; it stays by choice. A
Function would need its own copy of `lib/strength/rollup.ts`, and two
implementations of an aggregate is precisely how a repair script stops
repairing — the reason `rollupFrom` is shared with the rebuild script at all.
What a Function buys is firing on writes that did not come through this app, and
by policy there are none. Happy to move it if you disagree, but I would not.

**Invite redemption keeps its route** too — it never needed events.

### Housekeeping

The probe is left **disabled**. It fires on every set created: 332 executions in
ninety minutes of e2e runs, every one failing until it had a deployment. Left
enabled it would spawn an execution per athlete set forever. Its subscriptions
are kept as the record of what was tested.

```
npm test 923 ✓   npm run typecheck ✓   npm run lint ✓
```

Docs only — no behaviour changed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
