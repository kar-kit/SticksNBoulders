# Bodyweight

Order 36. Ruairi asked for this because **he currently has to ask athletes what
they weigh**, so the job is not to build a weight tracker — it is to make the
number appear on his Athlete View without him asking.

That single sentence decides most of what follows. It is why the logging flow is
one field, why the coach panel is not an afterthought, and why this survived when
the rest of the competition layer was cut.

## One entry per day, enforced by the id

`bodyweightRowId(athleteId, measuredOn)` → `<athleteId>_<YYYYMMDD>`.

Derived rather than generated, which makes "one per day" true without a
read-then-write: logging again on the same morning updates the row that is
already there. Two weigh-ins on one day would quietly drag the rolling average
that the whole screen is about.

Guarded at 36 characters like `circleTeamId`, because Appwrite ids stop there. A
generated user id is 20, which leaves room; a custom one would push it over, and
the failure would look like a rejected weigh-in rather than a naming problem.
There is a unique index on `(athlete_id, measured_on)` as well — the id already
prevents it, but the schema is where the next person looks.

Appwrite has no upsert, so the store creates and falls back to update on
collision.

## `measured_on` is a day, not a timestamp

A weigh-in belongs to a morning rather than to an instant, and the key is built
from **local** date parts. `toISOString` would agree with someone in London and
file a Sydney athlete's 7am under yesterday.

`recorded_at` is separate and holds when it was actually typed. They differ when
somebody catches up on a missed morning, and it is what you would want if two
numbers ever disagreed.

## The rolling average, and where it would lie

Daily bodyweight is noise around a trend, and the blueprint says the trend is the
only part that means anything. Three decisions:

**A partial window still produces a number.** Four days into using the app, or
back after a week away, you get an average rather than a blank. The blueprint
asks for no guilt copy on a gap, and a blank where the trend should be *is* guilt
copy. `Average` carries a `count` so the screen can say "from 3" rather than
implying a week of data that does not exist.

**The change is window-to-window, not day-to-day.** A single day's difference is
mostly water; telling somebody they gained half a kilo overnight is noise dressed
as information.

**`trend` returns null once the last weigh-in falls outside the window**, and
that is the point rather than a gap. A "7-day average" for somebody who has not
stood on a scale in three weeks is a lie with a number attached. Both screens
show the last weight and the day it was taken instead — on the coach's side
especially, because a stale bodyweight read as current is how a weight class gets
missed.

The average is computed over the **full history** at every plotted point, not
over the visible range. Otherwise switching from 90 days to 30 changes the shape
of the line at the left-hand edge, and an average that moves when you zoom is one
nobody can trust.

## The chart

Hand-rolled SVG, like the e1RM chart. Two series — the daily points faint, the
average not — because the eye should land on the trend and read the scatter as
texture underneath it.

**Both series map through the same min and max.** That is the one bug in a
two-series chart that looks like a data problem: scaled independently, the
average line drifts away from the points it is averaging. The scale spans both,
because an average can legitimately sit outside the visible dailies — it is
pulled by weights from before the window — and clipping it would bend the line at
the edge.

Its own geometry function rather than a generalisation of `chartGeometry` in
`lib/strength/lift.ts`: that one is typed to a `WeekPoint` and draws a single
series, and widening a shipped chart to serve a new one costs more than twenty
lines of maths.

## A bug the tests caught

`dayDate` originally checked only the *shape* of a key. `new Date(2026, 12, 45)`
does not throw — it rolls over to a real day in **February 2027**. So a corrupt
`measured_on` would have plotted somewhere plausible and dragged an average with
no visible error. The parsed date is now checked back against the key it came
from.

## What is not here

**DOTS is Order 37** and is absent rather than stubbed. `computeDots` takes a
non-nullable `Sex`, and Order 35 just shipped the field it needs.

**No scale photo, no verification, no anti-cheat.** That mechanism belonged to
the friend-leaderboard version of this product and was cut entirely. In a
coaching product the coach is the verification.

**Not a tab.** The blueprint gives the athlete four, and a screen visited once a
morning does not earn a permanent quarter of the bottom bar. It is reached from
Profile. The blueprint also mentions a weigh-in prompt on Today; that is Today's
screen and is left alone rather than added unasked.

**The logging screen's `NumberPad` is not reused.** It carries a warm-up toggle
and a next-field flow that mean nothing here, and bending it would put
logging-screen concepts on a screen that has none. `inputMode="decimal"` gets the
phone's own pad, which is the same keys.

## Verified against the instance

`npm run e2e:bodyweight` — 10 checks, including the two that matter: **the coach
reading their athlete's weigh-ins**, which is the feature, and a second weigh-in
on the same morning being refused rather than appended. Also the athlete
correcting that day's number, a stranger seeing nothing, the coach being unable
to change what the scale said, the rolling average computed over rows that came
back from the server, and an unlinked coach losing it all.

## Files

| File | What it holds |
| --- | --- |
| `lib/bodyweight/bodyweight.ts` | Pure: day keys, the plausible range, averages, trend, ranges |
| `lib/bodyweight/chart.ts` | Two series on one scale |
| `lib/bodyweight/store.ts` | Reads and the create-then-update write |
| `components/bodyweight/bodyweight-screen.tsx` | The athlete's screen |
| `components/bodyweight/bodyweight-chart.tsx` | The SVG |
| `components/coach/athlete-bodyweight.tsx` | The panel that is the point |
| `scripts/e2e-bodyweight.mts` | The claims, live |
