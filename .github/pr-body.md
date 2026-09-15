## Order 36 — Bodyweight log and graph

> "He said he currently has to ask athletes what they weigh."

So the job was never to build a weight tracker — it was to make the number land
on your Athlete View by itself. That sentence decides most of what's below, and
it's why bodyweight survived when the rest of the competition layer was cut.

### One entry per day, enforced by the id

`bodyweightRowId(athleteId, measuredOn)` → `<athleteId>_<YYYYMMDD>`. Derived
rather than generated, so logging again on the same morning **updates** the row
that's already there. Two weigh-ins on one day would quietly drag the rolling
average the whole screen is about.

Guarded at 36 characters like `circleTeamId`. A generated user id is 20 and
leaves room; a custom one would push it over, and the failure would look like a
rejected weigh-in rather than a naming problem.

### `measured_on` is a day, not a timestamp

Built from **local** date parts. A weigh-in belongs to a morning, and
`toISOString` would agree with someone in London and file a Sydney athlete's 7am
under yesterday. `recorded_at` separately holds when it was typed — they differ
when somebody catches up on a missed day.

### Three decisions about the average, all about where it would lie

**A partial window still gives a number.** Four days in, or back after a week
away. The blueprint asks for no guilt copy on a gap, and a blank where the trend
should be *is* guilt copy. The count comes with it, so the screen says "from 3"
rather than implying a week of data that doesn't exist.

**The change is window-to-window, not day-to-day.** A single day is mostly water;
telling someone they gained half a kilo overnight is noise dressed as
information.

**It stops entirely once the last weigh-in falls outside the window.** A
"7-day average" for someone three weeks off the scales is a lie with a number
attached — both screens show the last weight and its date instead. This matters
most on your side: a stale bodyweight read as current is how a weight class gets
missed.

The average is computed over the **full history** at every plotted point, not the
visible range. Otherwise switching 90d → 30d changes the line's shape at its
left-hand edge, and an average that moves when you zoom is one nobody can trust.

### The chart

Two series, one scale. **Both map through the same min and max** — that's the one
bug in a two-series chart that reads as a data problem rather than a rendering
one: scaled apart, the average drifts off the points it's averaging. The dailies
are faint and the average isn't, so the eye lands on the trend.

Its own geometry rather than widening `chartGeometry` — that one's typed to a
`WeekPoint` and draws a single series, and changing a shipped chart to serve a
new one costs more than twenty lines of maths.

### A real bug the tests caught

**`dayDate` checked the shape of a key, not its validity.** `new Date(2026, 12,
45)` doesn't throw — it rolls over to a real day in **February 2027**. A corrupt
`measured_on` would have plotted somewhere plausible and dragged an average with
no error anywhere. The parsed date is now checked back against the key it came
from.

### Not in scope

- **DOTS is Order 37**, absent rather than stubbed. `computeDots` takes a
  non-nullable `Sex` and Order 35 just shipped the field.
- **No scale photo, no verification, no anti-cheat** — that belonged to the
  friend-leaderboard product and was cut. In a coaching product you are the
  verification.
- **Not a tab.** Four tabs on the athlete side, and a screen visited once a
  morning doesn't earn a permanent quarter of the bottom bar. Reached from
  Profile. The blueprint also mentions a weigh-in prompt on Today — that's
  Today's screen, and I left it alone rather than adding it unasked. Say if you
  want it.
- **The logging `NumberPad` isn't reused** — it carries a warm-up toggle and a
  next-field flow that mean nothing here. `inputMode="decimal"` gets the phone's
  own pad, same keys.

### Verification

`typecheck` · `lint` · **1220 tests, 76 files** · `build` · `perf:check` inside
budget · `appwrite:probe` 42/42 · schema applied at v8.

Live: `npm run e2e:bodyweight` — **10/10**, including the two that matter: the
coach reading their athlete's weigh-ins, and a second weigh-in on the same
morning being refused rather than appended.

Also documented in `docs/review-queue.md`: `markSetReviewed` derives a 41-char
row id and the e2e proves that length works, so the practical Appwrite limit is
at least 41 rather than the 36 the docs suggest. Undocumented luck, now
documented.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
