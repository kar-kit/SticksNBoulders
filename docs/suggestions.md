# Next-set load suggestions

_Order 27. Phase 2b. Source: Joey. P1 Must._

> "Log RPE 7 at 170 and the app suggests the next step."

Joey already does this by hand, asking Claude between sets. The last set says
how the day is actually going; the next set's target says where it should go.

**Wired behind the coach's switch since Order 28.** See "The coach's switch"
below. No suggestion reaches an athlete yet, because the logger does not read
prescribed targets until Order 22.

## It is a ratio, which is why it could be built now

A suggestion is `load × percent(target) ÷ percent(logged)`. The estimated max
appears in both halves and **cancels**. So a suggestion never depends on the
absolute value of the e1RM curve — only on its *shape* over a short span.

That matters because the curve is an open decision. Order 26 verified the RTS
chart and measured it **2.7% away** from the Brzycki formula shipping today,
and choosing between them is a live-data migration and Joey's call. A feature
that depended on the absolute curve would have to wait for it. This one does
not.

[Fact] Over the suggestions this module actually makes — the same reps one RPE
step harder, and similar — the two curves disagree by **0.1–0.5kg**, inside a
single plate step, so both round to the same weight. Tested directly.

[Fact] The exception is a target near a maximal single. At three or fewer reps
from failure the curves can differ by up to **4.4kg**, because they part company
most where the curve is steepest. That is flagged on the result as
`nearMaximal` rather than gated — working up to a top single is exactly what a
powerlifter does.

### Where the divergence actually lives

Worth recording, because the intuition is wrong. The disagreement tracks the
**distance travelled**, not the target:

| jump distance (reps-to-failure) | worst disagreement on a 170kg set |
| --- | --- |
| 0.5 | 1.67 kg |
| 1 | 3.15 kg |
| 2 | 4.38 kg |
| 4 | 5.74 kg |

Grouped by *target* reps-to-failure instead, there is no clean pattern — it
peaks at 5.74 for a target of 1 but is still 4.40 at a target of 5. So the
bound belongs on how far the suggestion reaches, which is also the right place
for it on product grounds.

## How far it will reach

`MAX_SUGGESTION_SPAN = 2` reps-to-failure: the same reps two RPE steps harder,
or two more reps at the same RPE. That is the span "the next step" honestly
means. An athlete who did 8 at RPE 7 has told you very little about a heavy
single, and a suggestion that confident would be a guess wearing a number.

## What it refuses

Null rather than a guess, and each refusal is a real case:

- **No RPE on the logged set** — the athlete answered "not sure", and the set
  could be a grinder or an easy back-off at the same load and reps.
  `estimateOneRepMax` refuses it for the same reason.
- **A warm-up** — says nothing about what is left in the tank.
- **Either end past `MAX_REPS_TO_FAILURE`.**
- **A target further than the span above.**

There is deliberately **no default target**. The target RPE comes from a
prescription, and an athlete with none has nothing to suggest toward — prefill's
rule 3, repeat the previous set, is already the right answer, and a
manufactured suggestion would outrank it while saying less.

## Rounding

Down to a plate step, the same argument as Order 18's percentages: suggesting
heavier than the athlete can hold at the target RPE is the harmful direction.
`LOADABLE_INCREMENT_KG` and `roundToLoadable` moved to `lib/strength/plates.ts`
in this ticket — plate maths is a fact about barbells, needed by both the
suggestion engine and the percentage resolver, and `lib/programming` depends on
`lib/strength` rather than the reverse. `prescription.ts` re-exports them.

## The coach's switch (Order 28)

_Order 28. Phase 2b. Source: Inferred. P2._

Order 27 left the engine unwired because wiring it would have answered
"direct or held?" by default. Order 28 is that switch, so the engine is now
wired, behind it.

### What it means

[Inference] The Profile blueprint offers "Athletes see them directly" vs "Hold
for my approval". Nothing specifies an approval queue (who approves what,
when, on which screen), and an athlete resting two minutes between sets
cannot wait on one. So the smallest reading that keeps the coach in control
is taken:

- **direct**: the athlete's logger shows the engine's suggestion, ranked
  second in prefill and marked *suggested from RPE 7 @ 170*. Always editable,
  and the note drops the moment the athlete types their own load.
- **held**: the logger shows no suggestion at all, and the next row repeats
  the set just logged (prefill rule 3), as it did before Order 27.

[Inference] **Per linked athlete**, not one switch per coach. A coach may
trust a veteran's RPE and not a novice's, which is the scepticism the Athlete
View's RPE curve exists for. The switch sits on the Athlete View; Profile &
Settings tells an athlete when their coach holds suggestions and tells a
coach where the switch is.

**Default: direct.** [SME to confirm] The blueprint says to ask Ruairi rather
than ship a default. Changing it is `DEFAULT_SUGGESTION_MODE` and nothing
else; links from before Order 28 carry no value and read through it.

This is not an AI coach. The switch exists so the coach decides whether
arithmetic on the athlete's own RPE reaches them at all.

### Where it lives, and who can write it

`suggestions_mode` (`direct` | `held`, optional, default `direct`) on
`coach_athlete_links`. That row is already the record of this relationship,
already unique per pair, and already readable by exactly the coach and the
athlete and by nobody else. Revoking and re-linking reuse the row, so a
coach's choice survives an athlete leaving and coming back.

The table is server-only. Writes go through `POST /api/link/suggestions`:
the caller comes from the JWT, never the body, and only the coach on an
**active** link row qualifies. The athlete is refused, even for their own
link: a switch the person being coached can flip back is not the coach
staying in control. A revoked coach is refused because the link record is
checked rather than circle membership, the same rule as reference maxes.

### Audit rule it depends on

Order 4's permission audit (`rules.ts`, on PR #36) needs to assert, for
`coach_athlete_links`:

1. Table permissions are `[]`: no client may create a row.
2. Every row's permissions are exactly
   `[read("user:<athlete_id>"), read("user:<coach_id>")]`, matching the row's
   own `athlete_id` and `coach_id`: no `update`, no `delete`, no team or
   `users` read.
3. `suggestions_mode` is null, `direct` or `held`.

Rules 1 and 2 are what make the route the only way to change the switch.
`npm run e2e:suggestions` proves them on the live instance: the athlete, the
coach and a stranger are all refused a client-side write.

### With no signal

The logger reads the athlete's active link rows straight from Appwrite and
caches the answer on the device (`snb.suggestion-mode`, keyed by athlete).
It re-reads on load, on `online` and on return to the foreground. A failed
read never moves the cached value, so a coach's switch keeps applying in a
basement.

A device that has **never** read its link row (a fresh install opened with
no signal) assumes **held**. Showing a suggestion the coach has switched off
is the failure this switch exists to prevent; withholding one costs the
athlete one number typed, and the first read with signal corrects it.
Profile does not claim the coach held anything in that case.

### Why nothing appears yet

The engine has no default target on purpose (above). Targets come from
prescriptions, which reach the logger at Order 22.
`lib/logging/set-targets.ts` is that seam and returns null today. Everything
downstream (the switch, the gate, the engine, the prefill note) is wired and
tested now, so when a target exists the suggestion appears for athletes whose
coach allows it, and for nobody else.

## Files

| File | What it holds |
| --- | --- |
| `lib/strength/suggestion.ts` | `suggestLoad`, `MAX_SUGGESTION_SPAN` |
| `lib/strength/plates.ts` | `LOADABLE_INCREMENT_KG`, `roundToLoadable` (moved here) |
| `lib/coach/suggestion-mode.ts` | Order 28: the two modes, the default, the athlete's fold over links |
| `lib/logging/suggestion-gate.ts` | The one place a suggestion enters the logger, and the switch on it |
| `lib/logging/set-targets.ts` | The seam Order 22 fills; null today |
| `lib/coach/suggestion-mode-store.ts`, `use-suggestion-mode.ts` | Reads, the device cache, the coach's write |
| `appwrite/documents/suggestion-mode-admin.ts` | Who may set it: the coach on an active link, nobody else |
| `app/api/link/suggestions/route.ts` | POST, caller from the JWT only |
| `components/coach/suggestion-switch.tsx` | LOAD SUGGESTIONS on the Athlete View |
| `components/profile/suggestion-mode-note.tsx` | LOAD SUGGESTIONS on Profile & Settings |
