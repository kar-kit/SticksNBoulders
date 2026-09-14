## FTP1-13 — Workout history (Order 13)

Grouped by week, newest first, searchable by exercise, tapping into the full session. No calendar grid — nobody navigates their training by looking at a month view, and a list is faster to scan and far cheaper to build.

```
+--------------------------------+     +--------------------------------+
|  History                       |     |  ← History                     |
|  [ Search by exercise        ] |     |  Monday 14 Sep                 |
|                                |     |  1h 12m · 5 sets · 3,338 kg    |
|  THIS WEEK                     |     |                                |
|  +--------------------------+  |     |  Squat                         |
|  | Tuesday 15 Sep      58m  |  |     |  #  KG      REPS  RPE          |
|  | Bench Press, Barbell Row |  |     |  W  60      5     —       ✓    |
|  | 2 sets · 1,285 kg        |  |     |  1  142.5   5     7       ✓    |
|  +--------------------------+  |     | +--------------------------+   |
|  +--------------------------+  |     | |2  142.5   5     8    ✓ | |   |
|  | Monday 14 Sep     1h 12m |  |     | +--------------------------+   |
|  | Squat, Bench Press       |  |     |                                |
|  | 5 sets · 3,338 kg        |  |     |  [ Cancel ]   [ Delete set ]   |
|  +--------------------------+  |     |  [ number pad ]                |
|  LAST WEEK ...                 |     |                                |
+--------------------------------+     +--------------------------------+
```

### Two queries, however long the list

Sessions come from the provider Today and Log already use. The sets for **every card on the page** arrive in one query — Appwrite's `equal()` takes an array, which is an IN. Verified against the live instance before building on it, rather than assumed. Names come from the library already in memory, because there are no joins.

**Card totals come from the session row, not from the sets on screen.** The finish screen showed the athlete those exact numbers; recomputing here would mean a session whose finish op is still queued reports one total on the summary and a different one on History, with nothing to say which is right.

### Editing — and the Order 11 gap it closes

I flagged this in FTP1-11: `updateSet` didn't recompute `e1rm_kg`, and *couldn't* from a partial input.

It now requires **load, reps, RPE and the warm-up flag together**. e1RM is a function of all four, so an edit that changed reps while leaving last week's estimate on the row is exactly the drift that computing it inside the helper exists to prevent. Requiring the full set makes the stale case unrepresentable rather than merely discouraged.

The estimate is written as `null`, not `undefined`, when an edit removes the grounds for one — an RPE cleared, a set flagged as a warm-up. `undefined` would leave the old number sitting there.

A correction queues a rollup refresh behind it, and so does a delete: changing a weight changes the week's tonnage, and marking a set as a warm-up after the fact removes it from the week entirely.

**The row being corrected is the same component, in the same active state, as the row being logged.** An edit is the same gesture as an entry and shouldn't look like a different thing.

### One accessibility fix worth naming

The number pad's backspace was labelled **"Delete"**. On this screen it sits directly beside a **"Delete set"** button — a screen reader announcing two adjacent controls as Delete is a destructive confusion, not a cosmetic one. Renamed to "Backspace".

### Deferred, not dropped

- **PR marker** (in the wireframe) belongs to Lift Detail at Order 14, which reads the same rollups. A second PR derivation here would be the two-implementations-of-an-aggregate mistake Order 12 just avoided.
- **Prescription** (Order 22), **video** (Order 29) and **coach's threaded comments** (phase 3) are visibly absent rather than faked.

### Verification

```
npm test                 778 passed (54 files)
npm run e2e:history       19/19
npm run e2e:session       44/44
npm run e2e:offline       33/33
npm run e2e:rollups       16/16
npm run e2e:e1rm          11/11
npm run e2e:shell         15/15
npm run appwrite:probe    19/19
npm run perf:check        interactive 630ms on Slow 4G
```

`e2e:history` corrects a set **through the UI** and follows the consequences all the way down — this is the assertion that matters, because every one of these could fail silently:

```
Correcting a set
  PASS  the correction shows straight away
  PASS  the set is rewritten at Appwrite
  PASS  and its e1RM is recomputed, not left stale     ← 140→145 gives 174
  PASS  the week's tonnage follows the correction      ← 1,400 → 1,425
  PASS  and so does its best e1RM
Deleting a set
  PASS  the rollup drops the deleted set               ← 1 set, 725 kg
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
