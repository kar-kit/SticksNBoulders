# Call in sick (F31, schema v27)

Source note: "Ability to call in sick". Joey's call, 27 Nov 2026: "fix F31",
smallest shape. An athlete tells their coach they are ill, for a day or a run
of days; the coach sees it on the Roster and gets a push; the days they were
off read as skipped rather than missed.

It does not pause the program, reschedule anything or ask the coach to
acknowledge. Those are open questions (last section), not omissions.

## What it does

| Who | What they get |
|---|---|
| The athlete | On Today, a 44px row **Call in sick** (absent without a coach, like My program). It opens a bottom sheet: **From** and **Through** (today, today), an optional note of up to 200 characters, one big **Call in sick** button. Once sick, a card says "Off sick until Sunday 29 Nov", shows the note, says "Your coach knows. Nothing in your program has moved." and offers **I'm better**. A call-in still to come shows with **Cancel**. The row becomes **Add days**. |
| Every linked coach | The **Roster** marks the athlete **Sick** beside their name and lists them under an **Off sick** heading (dates and note) below Needs you; the **Athlete View** shows the same under the header. A web push through `notify`: "Joey called in sick", "Fri 27 Nov to Sat 28 Nov". |
| An unlinked coach, a stranger | Nothing. Appwrite refuses the read; see Permissions. |

Where on the phone: Today, in the row stack between Coach feedback and the
Start button, so the sheet's own button is the thumb target and the row cannot
be mistaken for Start. The sheet is the Log's `ModalSheet` (scrim, spring rise,
tap-out dismiss; docs/athlete-motion.md), the buttons are the athlete `Button`
with its press, and nothing on the screen animates layout. [Unverified] on a
real iPhone: native `<input type="date">` in standalone PWA mode, and the
sheet's reach on a 390 x 852 screen, were checked in jsdom only.

## The table

`sick_days`, one row per call-in. Row id is the client's `sk-<unique>` (23
characters), also in `client_sick_id` (unique): a queued write that is retried
is the same row, and a 409 is "already landed" (`classify`).

| Column | Type | Notes |
|---|---|---|
| `athlete_id` | string 36, required | From the signed-in actor, never from input |
| `starts_on`, `ends_on` | string 10, required | `YYYY-MM-DD`, both included |
| `note` | string 200, optional | Trimmed, whitespace flattened, cut to the column |
| `created_at` | datetime, required | When it was made, for "the newest note wins" |
| `client_sick_id` | string 64, required | Idempotency key |

Indexes: `idx_athlete_ends` on (`athlete_id`, `ends_on`) serves every read
("this athlete's call-ins not finished before day X"); `idx_client_sick_id`
unique. **Appended last, a new table: applying v27 rewrites no existing row and
changes no existing table.**

A new table rather than columns on `sessions`: a sick day has no session, a
range is not an instant, and nothing in sessions, program days or prescriptions
needed to learn about it.

## Date semantics

`starts_on` and `ends_on` are the **athlete's own calendar days**, the
convention the app already uses: `localDay()` for a session's day, `measured_on`
for a weigh-in, `scheduled_on` for a program day. Strings, not datetimes, so
"is this prescribed day inside the range" is `starts_on <= scheduledOn <=
ends_on` with no timezone in it, which is why it survives the CI zone matrix
(UTC, America/Los_Angeles, Pacific/Auckland: the new tests use local noon, not
UTC instants).

Checked in three places by the one function, `sickRangeProblem`
(`appwrite/documents/sick.ts`, no imports so the validate-row Function can
bundle it): both are real calendar days (`2026-13-45` is refused, not rolled
into 2027), `ends_on` is not before `starts_on`, and the span is at most **31
days** [Inference: nobody has asked for a number; it stops a year typo silencing
every missed-session signal for decades]. The write helper refuses it, every
reader drops it, validate-row deletes it.

What "sick today" means on each side:

- **The athlete's screens** use the athlete's `localDay()`.
- **The Roster and Athlete View** use the **coach's** `localDay()`, the one
  clock they have (the Roster's missed-session count already does). An athlete
  one day ahead of or behind their coach shows as sick from, or until, a day
  late. [Inference] Acceptable for a marker; the prescribed-day maths above is
  zone-free either way, because it compares two athlete-local strings.
- Two call-ins may overlap or touch. "Sick" is their union, and `sickNow` runs
  back-to-back ones together ("today", then "and tomorrow", reads as sick until
  tomorrow).

## Ending one

`planEnd(spells, today)`: a call-in that began before today is **shortened** to
end yesterday (the days already spent sick stay skipped, not missed); one that
begins today or later is **deleted**; one already finished is left alone.
"I'm better" and "Cancel" both mean "today and everything after stops being
sick", applied to every call-in that reaches today. Idempotent. The coach's push
is not retracted.

## Skipped, not missed

[Fact] by reading the code, the app derives "missed" in exactly two places, and
both now know about call-ins. Nothing else derives missed, failed (a `failed`
set is F19's per-set flag, unrelated to the schedule) or adherence: Today shows
the prescribed day with no state, History lists what was logged, rollups are set
aggregates with no schedule, and the coach's Athlete View program panel only
marks a day `logged` or not, never missed. Nothing was invented.

| Where | Before | Now |
|---|---|---|
| My Program, `dayStates` (`lib/programming/my-program.ts`) | past day with no session = `missed` | a dated day inside a call-in = `sick`, labelled **Sick**, whether past, today or still to come. A logged or running session still wins: what they did is what they did. |
| Roster, `computeProgramSignals` (`lib/coach/program-signals.ts`) | missed = this week's past days nobody started | a day inside the athlete's call-in does not count; the "missed N sessions" line in Needs you does not fire for it |

A `sick` day on My Program can still be started: nothing is paused. Its detail
says so.

**Unknown is not "none".** While the athlete's call-ins have not loaded (a first
visit with no signal and nothing cached) `dayStates` is given `null` and
claims no day was missed, as it already does when the sessions are not
loaded. The Roster's sick read is `.catch`ed to "none": it loads without
call-ins (no table yet, no signal) and says what it always said.

## Permissions

`sickDayPermissions` is a weigh-in's stamp, and a test asserts the two equal:
`read` for the athlete and their circle, `update` and `delete` for the athlete
alone. The coach is never named: access comes from the circle, which
`coach_athlete_links` populates, so a coach unlinked from the athlete has left
the team and reads nothing, and one who was never linked never could.

Appwrite polices who reads a row, not what it claims, and the table allows any
session to create (as `sessions` and `bodyweight_entries` do). So the proof is
the same: a call-in carrying `update("user:<athlete_id>")` was written by that
athlete (`ownerProof`), every reader goes through `authenticRows`, and
validate-row deletes one that lacks it. Without that, a stranger could put an
athlete "off sick" on their coach's Roster, or hide their missed sessions. See
docs/permission-audit.md, Sick days.

## The push

`notify` (docs/push-notifications.md) gains a third event: `sick_days` created,
both spellings. `classifyEvent` skips an update (ending it), a delete, a forged
row and an invalid range; `recipientsFor` is unchanged, so only coaches on an
**active** link to that athlete are told, never the athlete.

- **Message**: tag `sick:<athleteId>`, key the call-in's id. Title "Joey called
  in sick"; body the dates ("Fri 27 Nov to Sat 28 Nov"). A tap opens the
  Athlete View; several collapse to "Joey called in sick 3 times" and open the
  Roster. Same collapse, same quiet replace for the same call-in firing under
  both event spellings.
- **The note is not in the push.** It is health information and a lock screen
  shows it to whoever holds the phone. [SME to confirm] with Ruairi, and with
  GDPR in mind (Jan 2027): whether the athlete's name next to "called in sick"
  on a lock screen is acceptable either.
- **No switch of its own.** A coach who muted clips and replies still hears an
  athlete is ill; every device that is on gets it. [Inference] A third switch is
  one optional column `push_subscriptions.notify_sick` (default true) plus the
  settings row, a change to an existing table, so not made here.
- `NOTIFY_DRY_RUN` and the VAPID handling are unchanged. Retroactive call-ins
  (a day already past) notify too: the Function does not know the athlete's today.

## Offline

Two queued ops, `sick.create` and `sick.end` (docs/offline.md), through the
same document helpers as everything else. The screen updates and the cache
(`snb.my-sick`, scoped to the athlete) are written at once; a quiet pending dot
shows until the queue has sent it; the network read lands over the top only when
nothing is still queued, and once more when the queue empties. A payload that can
never be written is a permanent 400 (kept as evidence, queue moves on), never a
retryable error that would wedge every set behind it. An end for a call-in
already gone is done.

## Rollout

In order. Joey approves each; none of this has been run against the live
instance.

1. **Schema before prod.** `~/personal/snb-ops/with-snb-env.sh npm run
   appwrite:setup -- --dry-run` first: it must print exactly
   `would create table sick_days`, its six columns and its two indexes, and
   nothing else (`execute.test.ts`, "v26 -> v27", pins the lines). Anything more
   means the instance has drifted from v26. Then without `--dry-run`. Until it is
   applied, Today's row works (offline queue holds the writes) but nothing
   reaches Appwrite, and the Roster and Athlete View read nothing.
2. **Redeploy both Functions**: `with-snb-env.sh npm run appwrite:functions --
   --dry-run`, check `notify` lists the **eight** events (two new `sick_days`
   creates) and its three secrets present, then without `--dry-run`.
   `validate-row` bundles `provenance.ts` and only then vouches for `sick_days`
   rows and deletes a forged or malformed one; `notify` only then knows the
   event. Optionally `NOTIFY_DRY_RUN=true` first.
3. **Prod deploy** (Vercel). The app change is the Today row, My Program's
   label, the Roster and Athlete View, and `public/sw.js` (the worker learns the
   `sick` kind; without it a call-in push shows but does not collapse).
4. **Audit**: `with-snb-env.sh npm run appwrite:audit` (new `sick_days` rule and
   its live cells), then `npm run e2e:sick` against a dev instance.

## Not done, and what is unverified

- **Real device.** A push on an iPhone, the sheet in a standalone PWA, and
  native date inputs there. All [Unverified].
- **Live instance.** The audit, `e2e:sick`, the schema plan against v26 and the
  Function redeploy. The plan is proved against a fake driver only.
- **Realtime.** The Roster reads on load; it does not subscribe to `sick_days`,
  so a call-in made while it is open shows on the next load (the push is the
  live signal). A subscription is one line in `subscribeToClips`' pattern.
- **The coach's program panel** does not mark a sick day. It never marked
  missed ones either; the Athlete View banner carries the call-in.
- **The read API** (`/api/v1`, F29) does not expose call-ins.

## Open questions for Joey and Ruairi

None of these is answered, so the smallest shape was built.

1. Must the coach **acknowledge** a call-in? Built: no. (It would be a
   coach-written row or column, readable by the athlete, and a Needs-you item.)
2. Should being sick **pause** the program, or move its days? Built: no.
   Nothing is rescheduled and the days stay startable.
3. What does Ruairi **do today** when an athlete is ill (a WhatsApp, a rewrite of
   the week, nothing)? That decides whether a day should become a make-up, or
   whether the marker alone is the whole feature.
4. Whether the push should carry the **name** or the **note**; see above.
5. The **31-day** cap and **no per-type switch** are my choices, not asked for.

## Files

| File | What |
|---|---|
| `appwrite/schema/index.ts` | `sick_days`, v27 |
| `appwrite/documents/sick.ts` | Pure: day check, range rule, note |
| `appwrite/documents/policy.ts`, `provenance.ts` | `sickDayPermissions`, stamp, proof, `contentProblem` |
| `appwrite/documents/write.ts` | `callInSick`, `endSick` |
| `appwrite/audit/rules.ts`, `scripts/appwrite-audit.mts` | The audit rule and its live cells |
| `lib/sick/sick.ts`, `labels.ts` | Pure: union, `sickNow`, `planEnd`, labels |
| `lib/sick/sick-store.ts`, `sick-queue.ts`, `sick-cache.ts`, `use-my-sick.ts` | Reads, queued sends, cache, the athlete's hook |
| `lib/offline/queue.ts`, `runner.ts` | `sick.create`, `sick.end` |
| `components/sick/call-in-sick.tsx` | Today's row, sheet and card |
| `app/(athlete)/today/program/program-screen.tsx`, `lib/programming/my-program.ts` | The `sick` day state |
| `lib/coach/roster.ts`, `roster-store.ts`, `program-signals.ts`, `components/coach/roster.tsx` | The marker, the read, the missed count |
| `components/coach/athlete-sick.tsx` | Athlete View banner |
| `lib/push/*`, `functions/notify`, `appwrite/functions/index.ts`, `public/sw.js` | The push |
| `scripts/e2e-sick.mts` | The loop, live (`npm run e2e:sick`) |
