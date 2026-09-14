## FTP1-11 — e1RM computed and stored on every set (Order 11)

The number the progression chart, the rollups, reference maxes, the RPE engine and the attempt board are all built on. Stored when the set is written — Appwrite has no `GROUP BY`, so nothing can derive it on read.

```
RIR   = 10 - RPE
total = reps + RIR
e1RM  = load x 36 / (37 - total)
```

Brzycki, M. (1993). *Strength Testing — Predicting a One-Rep Max from Reps-to-Fatigue.* JOPERD 64(1), 88–90. Most accurate over 1–6 reps, derived on slow-tempo barbell bench and squat — this product's whole domain rather than general fitness.

Applying it to **reps-to-failure** rather than reps performed is the standard RPE construction, and it's what makes 5 @ RPE 7 a different set from 5 @ RPE 10. A rep-count-only formula can't tell those apart.

### Brzycki, not Epley — and the one rep that decides it

**Ruairi: this is the part worth arguing with.** Epley is the more common choice in RPE calculators. The two agree within a few percent through the middle and cross at ten reps-to-failure:

| reps to failure | Brzycki | Epley |
| --- | --- | --- |
| **1** | **1.000 × load** | **1.033 × load** |
| 3 | 1.059 | 1.100 |
| 5 | 1.125 | 1.167 |
| 7 | 1.200 | 1.233 |
| 10 | 1.333 | 1.333 |
| 12 | 1.440 | 1.400 |

A single at RPE 10 is a **tested max by definition**, not an estimate. Epley reports it as 3.3% above the weight that was actually on the bar. That's the most scrutinised number in the app, and getting it visibly wrong costs trust in every other number.

Above ten reps-to-failure the choice barely matters, and powerlifting rarely goes there.

[Unverified] Neither formula has a documented empirical derivation and both predate RPE-based training. Order 26 revisits this against the RTS chart.

### When no estimate is written

Normal, not a failure:

- **No RPE** — "Not sure" is a real answer, and the same load and reps could be a grinder or an easy back-off. A wrong number is worse than no number.
- **A warm-up** — excluded from PRs and rollups everywhere else.
- **More than 12 reps to failure** — past roughly ten the set is limited by endurance, not maximal strength.

> **One consequence for Order 12 (rollups) worth seeing now, Ruairi:** a hard 10 × RPE 8 gets an estimate; 11 reps at the same RPE doesn't. So a week's best e1RM can come from a set the athlete thought of as the lighter one. That's the trade for keeping endurance work out of PRs — but it's a rule, not an accident.

Half points interpolate: 3 reps @ RPE 8.5 is 4.5 reps-to-failure, and Brzycki is linear in that term, so half a point moves the estimate by about half of what a whole one does. Rounding to an integer would discard exactly what the RPE sheet exists to capture.

### Where it's computed

`createSet`, and nowhere else. `CreateSetInput` no longer accepts an `e1rmKg` at all — derived fields are written in the same helper that stamps permissions so they can't drift, and a caller able to supply its own estimate is a way for one of them to be wrong.

The offline queue gains nothing to carry: `runOp` calls the same helper, so a set logged in a basement gets the same number as one on wifi. Asserted in `e2e:offline`, not just claimed.

**Open:** `updateSet` doesn't recompute. Nothing calls it yet; History editing at Order 13 must, or an edit that changes reps leaves a stale estimate behind.

### The backfill ships in this PR, not with the rollups

Order 12's note parks the rebuild script with the rollups. It belongs here instead, because otherwise the reversibility argument is hollow — the thing that un-ships a wrong formula wouldn't exist while the wrong formula was live.

```
npm run e1rm:backfill              # plans, writes nothing
npm run e1rm:backfill -- --yes     # applies
```

It **reconciles rather than fills blanks**: a set whose estimate changed is corrected, and one no longer owed an estimate has it cleared. Changing `lib/strength/e1rm.ts` and re-running is the entire migration path for Order 26.

`e2e:e1rm` exists because that script's failure mode is silent — wrong numbers sitting in athletes' logs looking exactly like right ones:

```
Planning
  PASS  finds the set with no estimate
  PASS  finds the one carrying a number from another formula
  PASS  finds the two that are owed nothing
  PASS  leaves the correct one alone
  PASS  and writes nothing while planning
Applying
  PASS  estimates the set that had none
  PASS  corrects the one that was wrong
  PASS  clears the warm-up
  PASS  clears the set with no RPE
  PASS  leaves the already-correct one at its value
Re-running
  PASS  is safe to run forever: the second pass has nothing to do
```

### Verification

```
npm test                 725 passed (50 files)
npm run e2e:session       35/35
npm run e2e:e1rm          11/11
npm run e2e:offline       33/33
npm run e2e:shell         15/15
npm run appwrite:probe    19/19
```

`e2e:session` logs 140 × 5 @ RPE 8 and asserts the stored value is **168.0** — seven reps to failure, 140 × 36 / 30. That one number proves which formula shipped: Epley would have written 172.7. Set 2 in the same script is logged without tapping RPE, so it carries nothing — identical load and reps, one with a number and one without.

No schema change: `e1rm_kg` has been on the `sets` table since phase 0.

`docs/e1rm.md` has the full reasoning.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
