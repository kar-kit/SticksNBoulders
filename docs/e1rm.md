# Estimated one-rep max

The number the progression chart, the rollups, reference maxes, the RPE engine
and the attempt board are all built on. Computed and stored on the set when it
is written — Appwrite has no `GROUP BY`, so nothing can derive it on read.

## The formula

Brzycki, applied to **reps-to-failure** rather than reps performed:

```
RIR   = 10 - RPE
total = reps + RIR
e1RM  = load x 36 / (37 - total)
```

Source: Brzycki, M. (1993). *Strength Testing — Predicting a One-Rep Max from
Reps-to-Fatigue.* Journal of Physical Education, Recreation & Dance 64(1),
88–90. Most accurate over 1–6 reps, derived on slow-tempo barbell bench and
squat.

`RIR = 10 - RPE` and `total = reps + RIR` is the standard RPE→1RM construction;
it is what makes 5 reps at RPE 7 a different set from 5 reps at RPE 10, which a
rep-count-only formula cannot see.

## Why not Epley

Epley — `load x (1 + total/30)` — is the more common choice in RPE calculators
and the two agree within a few percent through the middle of the range. They
part company at one rep:

| reps to failure | Brzycki | Epley |
| --- | --- | --- |
| 1 | **1.000** × load | 1.033 × load |
| 3 | 1.059 | 1.100 |
| 5 | 1.125 | 1.167 |
| 7 | 1.200 | 1.233 |
| 10 | 1.333 | 1.333 |
| 12 | 1.440 | 1.400 |

A single at RPE 10 is a tested max by definition, not an estimate. Epley reports
it as 3.3% above the weight that was actually on the bar. That is the most
scrutinised number in the app, and getting it visibly wrong costs trust in every
other number.

They cross at ten reps-to-failure, which powerlifting rarely reaches, so the
choice barely matters above it.

## When there is no estimate

`e1rm_kg` is left unset, and this is normal rather than a failure:

- **No RPE.** The athlete answered "Not sure". Without it, the same load and
  reps could be a grinder or an easy back-off. A wrong number is worse than no
  number.
- **A warm-up.** Excluded from PRs and rollups everywhere else.
- **More than 12 reps to failure.** Past roughly ten reps the set is limited by
  endurance rather than maximal strength. The cutoff stops a twenty-rep back-off
  becoming somebody's best e1RM of the week.

## Where it is computed

`createSet` in `appwrite/documents/write.ts`, and nowhere else. It is a derived
field, and the rule is that derived and denormalised fields are written in the
same helper that stamps permissions so they cannot drift. `CreateSetInput` has
no `e1rmKg` — a caller able to supply its own is a way for one to be wrong.

The offline queue carries no estimate either; `runOp` calls the same helper, so
a set logged in a basement gets the same number as one logged on wifi.

**Open:** `updateSet` does not recompute. Nothing calls it yet; History editing
at Order 13 must, or an edit that changes reps leaves a stale estimate behind.

## Changing it

[Unverified] Neither formula has a documented empirical derivation and both
predate RPE-based training. Order 26 revisits this against the RTS chart.

That revision is a script run, not a migration:

```
npm run e1rm:backfill              # plans, writes nothing
npm run e1rm:backfill -- --yes     # applies
```

It reconciles rather than fills blanks — a set whose estimate has changed is
corrected, and one that is no longer owed an estimate has it cleared. Safe to
re-run forever. `npm run e2e:e1rm` proves all four cases against the live
instance, because a backfill that silently does the wrong thing leaves wrong
numbers looking exactly like right ones.
