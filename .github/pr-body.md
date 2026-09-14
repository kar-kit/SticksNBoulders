## FTP1-12 — Stats rollup function (Order 12)

One row per athlete per exercise per week. Appwrite has no `GROUP BY`, so every chart, PR and dashboard reads these rather than raw sets — which makes them the only aggregates in the product, and makes a wrong one dangerous: **it looks exactly like a right one.**

### The spec'd mechanism doesn't work on your instance

Order 12 says "written by an Appwrite Function on set creation". Verified with a deployed probe on 14 Sep 2026:

| | result |
| --- | --- |
| Deploy a Function | works — 3 second build |
| Execute it manually | works — completes in milliseconds |
| **Trigger it from a database event** | **never fires** — including a bare `databases.*` |

`stats_rollups` is a server-only table by policy, so the browser can't write it either. You chose the server route, so a set write queues a `rollup.refresh` op which calls `POST /api/rollup` — same pattern as the `/api/circle` route that already exists, same privilege level, same write helper.

Moving to a Function later is a **change of caller, not of logic**: the Appwrite part is `appwrite/documents/rollup-admin.ts`, and the arithmetic is shared with the rebuild script.

> Worth knowing: the same gap will hit invite-code redemption (Order 20), which the schema comments already assume runs in a Function. Probably worth a look at the homelab's worker containers before then.

### Recomputed, never adjusted

A bucket is always rebuilt from its sets. Incremental adjustment is faster and wrong — it can't survive an undo, a correction, or the same set arriving twice from a retried queue — and a week of one lift is one query of a few dozen rows.

So the live path and the repair path are the *same function*. Two implementations of an aggregate is how a repair script stops repairing.

### You asked me to check the UTC handling. It was wrong.

Monday-to-Sunday, UK — confirmed. But storing times in UTC (correct, `logged_at` is an instant) is a different question from which calendar *week* an instant falls in:

```
2026-09-13T23:30:00Z  =  Monday 14 Sep, 00:30 BST
UTC-only rule says:      week beginning 7 Sep   ← wrong
```

Under BST — roughly seven months a year — a set logged in the first hour of a Monday morning landed in the week that had just ended. One hour every Monday, quietly filed under last week's volume, and it would have shown up as a session split across two bars on the Order 14 chart.

Membership is now decided in `Europe/London`; `week_start` stays a UTC-midnight **label**, so the column still reads as a Monday and the unique index is stable across the DST boundary. `e2e:rollups` logs a set at 00:30 Monday BST and asserts which week it lands in.

### Two bugs the e2e caught

**Refresh collapsing kept the wrong one.** Five sets of squats need one recompute, so refreshes of a bucket collapse. Collapsing at *enqueue* keeps the earliest — which sits in the queue **ahead** of the sets that follow it. It ran, saw a session one set old, wrote that, and nothing recomputed it again. The week's totals froze partway through the session. The check moved to drain time, where the survivor is the last one and runs behind every set it has to count.

**Re-exporting `rollup-admin` from the barrel broke every athlete screen.** `appwrite/documents/index.ts` is imported by client code — the offline queue's runner reaches `createSet` through it — so re-exporting a module that constructs `node-appwrite` pulled the server SDK into the browser bundle. `circle-admin.ts` avoids the same trap by taking a narrow interface; this one needs the real client, so it stays off the barrel and the route imports it by path.

### What counts

Warm-ups count toward nothing — the same rule the session summary applies, so a week's numbers and a session's numbers agree rather than quietly differing by a warm-up. `best_single` takes the heaviest working set and, on a tie, the most reps at it: 140×5 is a better week than 140×3.

A week with no working sets produces **no row** rather than a row of zeroes — a row of zeroes says the week happened and was empty.

### Repair

```
npm run rollups:rebuild              # plans, writes nothing
npm run rollups:rebuild -- --yes     # applies
```

Repairs a bucket nothing ever wrote, a bucket that drifted, and a rollup whose sets are all gone — which an undo leaves behind and which would otherwise sit in the chart forever claiming a week happened. Separate from `e1rm:backfill` because they fix different failures; run that one first, since `best_e1rm_kg` is drawn from what it writes.

### Verification

```
npm test                 746 passed (51 files)
npm run e2e:session       44/44
npm run e2e:rollups       16/16
npm run e2e:e1rm          11/11
npm run e2e:offline       33/33
npm run appwrite:probe    19/19
```

```
The weekly rollup
  PASS  one rollup exists, for this athlete, lift and week
  PASS  it counts working sets only
  PASS  tonnage excludes the warm-up
  PASS  best e1RM is the best of the week
  PASS  the week starts on a Monday

(e2e:rollups)
  PASS  a set logged just after local midnight on Monday is in that Monday's week
  PASS  the drifted rollup is corrected
  PASS  and keeps its row rather than being replaced
  PASS  the orphan is removed
  PASS  is safe to run forever: the second pass has nothing to do
```

No schema change: `stats_rollups` has been there since phase 0.

`docs/rollups.md` has the full reasoning.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
