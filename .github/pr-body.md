## FTP1-7 — Start, run and finish a training session

**Notion:** [MVP Feature List — Order 7](https://app.notion.com/p/c1595d12346b47fd9939ea81cd33ab4d)
**Depends on:** #1–#7 (all merged)

Today answers one question — what am I doing, and how do I start it. The logger
is the frame the set rows land in at Order 8: which session is live, how long it
has been running, which exercises are in it, and how it ends.

### ⚠️ This found a bug that blocked every athlete write in the product

**No athlete could write anything.** Appwrite refuses a `team:` permission from
a *user session* unless that user is a member of the team. Every row an athlete
writes carries a read for their circle team — and nothing in the app had ever
created that team. The first session, the first set and the first custom
exercise would all have come back:

```
401  Permissions must be one of: (any, users, user:<id>, user:<id>/unverified, users/unverified)
```

**`npm run appwrite:probe` passed throughout**, because it writes its rows with
the admin key and only uses user sessions for *reads*. The permission policy had
been proven for reads and never once for a user-side write. It surfaced only
when a real browser went through a real sign-in and pressed the button.

The fix cannot live in the browser. A user who creates a team owns it, and could
then add or remove members behind the app's back — `coach_athlete_links` and
actual access would drift apart with nothing to reconcile them, which is the
reasoning already written into `appwrite/documents/circle-admin.ts`. So:

- **`POST /api/circle`** ensures the circle with the admin key.
- The caller proves identity with a **short-lived Appwrite JWT**. The user id
  comes from that token and **never from the request body** — accepting an id
  from the caller would let anyone create, or join, somebody else's circle.
- `ensureMyCircle()` is memoised per page load and awaited by the writes that
  need it, rather than fired from a component that might not be mounted. A
  failure is not cached, so one bad moment on a train does not block every write
  for the life of the page.

### Decisions worth keeping

**No `session_exercises` table, and this does not add one.** An exercise is in a
session because work was logged against it, so the durable record is the sets.
An exercise added and then abandoned does not survive a reload — the right thing
to lose.

**The elapsed clock is derived from `started_at`, never from a counter in an
interval.** A backgrounded phone stops the interval and the world keeps going.
"Never lose a session to a backgrounded app or a phone call" is in the
blueprint; this is what it means in code.

**Resume picks the most recently started live session and leaves others alone.**
More than one can exist — a crashed tab, a second device, a finish write that
failed after the sets landed — and Order 9's queue makes that more likely, not
less. Silently finishing somebody's session is worse than a stray row History
can show.

**`client_session_id` is reused across a retry, not regenerated.** It is
unique-indexed precisely so a second attempt recovers the first attempt's
session rather than creating a twin; minting a new id would defeat the index.

**Warm-ups are excluded from the set count and tonnage** `[Inference]`, so a
session total agrees with the weekly rollup at Order 12 instead of quietly
disagreeing with it. **[SME to confirm]** — Ruairi may count everything that
moved.

### What the screenshots caught

Two things no test was going to fail on:

1. **The typeahead kept the chosen name in the field**, so adding a second
   exercise meant clearing the first by hand, one-handed, mid-session. It
   empties now when the caller asks — right for the logger, wrong for a picker
   that holds a value, so it is a prop rather than a change in behaviour.
2. **The primary action was not in the thumb zone on either screen.**
   `min-h-full` cannot resolve inside the shell's `main`, whose height comes
   from flex rather than being a definite value, so `mt-auto` did nothing and
   the button rode up under the text. The shell is a flex column now, which
   fixes it for every athlete screen rather than these two.

```
  Today                        Session running
  ┌────────────────────────┐   ┌────────────────────────┐
  │ Monday 14 Sep          │   │ Session       0:00:01  │
  │ Nothing prescribed     │   │ ┌────────────────────┐ │
  │ today.                 │   │ │ Squat              │ │
  │                        │   │ │ No sets yet        │ │
  │ No sessions logged yet.│   │ └────────────────────┘ │
  │                        │   │ ┌────────────────────┐ │
  │                        │   │ │ Bench Press        │ │
  │                        │   │ │ No sets yet        │ │
  │                        │   │ └────────────────────┘ │
  │ ┌────────────────────┐ │   │ ┌────────────────────┐ │
  │ │  Start a session   │ │   │ │ Add an exercise    │ │
  │ └────────────────────┘ │   │ └────────────────────┘ │
  └────────────────────────┘   └────────────────────────┘
       thumb zone                    thumb zone
```

### Scope

Not here, and deliberately: the set row and number pad (Order 8), offline queue
(Order 9), rest timer (Order 10), and Today's prescribed-session card, coach
note and rest-day state (Order 22 — the "with a program" layout in the blueprint
is not this ticket).

The finish summary shows **sets, tonnage, exercises and warm-ups read from the
session's own sets** — real numbers that happen to be zero until Order 8 lands
set logging. PRs and queued videos join it at Orders 12 and 3.

Today's last-session line reads "Last session: Thu" rather than "Thu, Deadlift".
Naming the exercise needs the session's sets, which costs a second request on
the most-opened screen to render a word that is always absent until Order 8.
Order 8 fills it in.

Also closes the seam Order 6 left open: an exercise created mid-session now
reaches the library as well as the session.

### Verification

52 new tests, 623 total, plus **`npm run e2e:session`** — 17 assertions driving a
real browser against the live instance:

```
An empty account        lands on Today / says no sessions logged / offers to start
Starting a session      goes to the logger / a clock is running
                        exactly one session row exists, live, no finished_at
Adding an exercise      the exercise appears in the session
After a reload          still running / no second session was created
                        Today offers Resume / Resume reopens the logger
Finishing               summary shown / finished_at written / still one session
                        Today offers Start again and names the session

17/17 passed. Athlete and sessions removed.
```

`npm run perf:check` — interactive at **359ms** on Fast 4G against a 2500ms
budget, 629ms on Slow 4G.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
