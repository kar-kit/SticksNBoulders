## FTP1-14 — Lift detail: progression chart and PRs (Order 14)

One lift, all of it: is this going up, what is my best, what have I actually been doing. Reached from History rather than the tab bar — it answers a question you arrive holding about one lift.

```
+--------------------------------+
|  ← Back                        |
|  Deadlift                      |
|  ESTIMATED 1RM                 |
|  204.9 kg     +24.9 (12w)      |
|                       .--*     |
|              .---''''          |
|      ..--''''                  |
|   --'                          |
|  [ 8w ][ 12W ][ 6m ][ all ]    |
|                                |
|  PERSONAL RECORDS              |
|  Heaviest single      200 × 1  |
|  Best estimated      205.3 kg  |
|  Most reps           140 × 12  |
|                                |
|  RECENT SETS                   |
|  16 Sep   185 × 3     RPE 8.5  |
|  09 Sep   182.5 × 3     RPE 8  |
+--------------------------------+
```

### The chart is hand-rolled SVG

One line, no axes, no legend, no tooltip, no interaction. Every charting library that could draw that brings a hundred times more than that, and six dependencies is a deliberate property of this repo rather than an accident.

Two details that matter:

- **Points are spaced by time, not by index.** Three weeks of training either side of a three-month layoff would otherwise read as steady progress.
- **Fewer than three points and the chart is hidden, not emptied.** A two-point line turns a coincidence into a direction — on the one screen that exists to answer whether the line is going up.

### Personal records are all-time, not per range

A record that changed when you tapped "8w" would not be a record.

### "Most reps" needed two new rollup columns

`best_reps` and `best_reps_load_kg`. It's an aggregate over all time, so scanning raw sets for it would have made this the one number on the screen derived a second way — which is exactly how a stored answer and a computed one start disagreeing. **Schema v2, already applied to the instance**; `rollups:rebuild` fills them.

On a tie the heavier set wins: a rep record that ignored the weight would crown the lightest set of the week.

### One thing a screenshot caught that no test would have

The recent-sets list **excludes warm-ups**. Including them looked defensible when I wrote it — "how you warm up is part of what you've been doing" — until the screen was full of `60 × 5`. An athlete who warms up every session gets a list that's half warm-up, and warm-ups already count toward no total, no record and no rollup anywhere else in the product.

### Deferred, with reasons

- **Personal RPE curve panel** — needs `personal_rpe_curves` and the RPE engine at phase 2b. Its own blueprint carries an open question on the sample threshold, and a curve fitted to six sets is noise presented as insight.
- **Volume/tonnage charts** — out per the blueprint's own note.
- **Log Session as an entry point** — listed in the blueprint, but the exercise name there is already a tap target for reactivating the row. A second behaviour on one control needs a design decision, not a quiet addition. **Joey: worth a view when you're next in the logger.**

### Verification

```
npm test                 810 passed (56 files)
npm run e2e:lift          17/17
npm run e2e:history       19/19
npm run e2e:session       44/44
npm run e2e:offline       33/33
npm run e2e:rollups       17/17
npm run e2e:e1rm          11/11
npm run e2e:shell         15/15
npm run appwrite:probe    19/19
```

`e2e:lift` seeds five weeks arranged so **no record can be read off the newest row**, then walks in from History:

```
  16w  140 × 12 @ 8   rep record — 14 reps to failure, past the cutoff,
                      so it earns NO estimate (the cutoff working)
   8w  200 × 1  @ 10  heaviest single, e1RM exactly 200 by definition
   4w  180 × 3  @ 8   best estimated: 202.5
   0w  175 × 3  @ 8   current: 196.9 — deliberately BELOW the best

  PASS  shows the current estimate                        (196.9)
  PASS  and how far it has moved, including downward      (−3.1)
  PASS  best estimated, all-time                          (202.5)
  PASS  most reps, with the weight it was done at         (140 × 12)
  PASS  records stay all-time after narrowing the range
```

A screen that only ever showed a rising line and a plus sign would pass a test built on climbing data. This one doesn't.

Also fixed a fragility in `e2e:e1rm` that went red for the right reason: it asserted exact instance-wide counts from the backfill's plan, which fails as soon as the instance holds any other data.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
