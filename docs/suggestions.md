# Next-set load suggestions

_Order 27. Phase 2b. Source: Joey. P1 Must._

> "Log RPE 7 at 170 and the app suggests the next step."

Joey already does this by hand, asking Claude between sets. The last set says
how the day is actually going; the next set's target says where it should go.

**Nothing is wired to it.** See "Why it stays unwired" below.

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

## Why it stays unwired

Unlike Order 18, a caller **does** exist: `lib/logging/prefill.ts` already
accepts a `Suggestion` and ranks it second.

It stays unwired because **Order 28** asks whether load suggestions reach
athletes directly or wait behind coach approval, and calls that "a coaching
philosophy question, not ours — ask Ruairi". Wiring the live path would answer
that question by default, in the direction of straight through.

The ticket's own rule points the same way: "Always a suggestion, always
overridable, never silently imposed."

## Files

| File | What it holds |
| --- | --- |
| `lib/strength/suggestion.ts` | `suggestLoad`, `MAX_SUGGESTION_SPAN` |
| `lib/strength/plates.ts` | `LOADABLE_INCREMENT_KG`, `roundToLoadable` (moved here) |
