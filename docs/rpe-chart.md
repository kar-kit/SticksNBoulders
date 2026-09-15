# The RPE → %1RM chart

_Order 26. Phase 2b. Source: Joey. P1 Must._

CLAUDE.md required this be checked against a published source before anything
hardcoded it, because wrong numbers here are wrong numbers in every athlete's
program. This is that check, and its findings.

**Nothing is wired to it.** `estimateOneRepMax` still uses Brzycki. See
"The decision this hands over" at the bottom.

## It is one curve, not a grid

The chart is published as an 8 × 10 grid of RPE against reps, but it is a
function of a single variable: **reps-to-failure** — reps performed plus reps
left in reserve. 3 reps at RPE 10, 2 at RPE 9 and 1 at RPE 8 are all three reps
from failure, and the chart gives all three 92.2%.

[Fact] All **80 published cells collapse onto 26 distinct values with zero
contradictions**, checked cell by cell. That is the verification result: an
8 × 10 grid can only fold onto one curve if every cell agrees with every other
cell the same distance from failure. `rpe-chart.test.ts` keeps the published
grid in its original shape and asserts the fold, so a transcription error
anywhere breaks the build rather than sitting in the table unnoticed.

Source: [fitnessvolt.com — The Tuchscherer RPE Chart Explained](https://fitnessvolt.com/rpe-training/guides/tuchscherer-chart-explained/)

## The kink at row 11 is real

CLAUDE.md said to check row 11 first. It was right, and it is the only one.

[Fact] Each step down the whole-number series shrinks smoothly as the curve
flattens — −4.5, −3.3, −3.0, −2.9, −2.6, −2.6, −2.5, −2.4, −2.3 — then jumps to
**−3.2** at 10 → 11, then returns to −2.7. As second differences: +0.3, +0.1,
+0.3, 0.0, +0.1, +0.1, +0.1, **−0.9**, +0.5. One sign reversal in the whole
series, exactly at reps-to-failure 11.

The published 70.7 is **kept, not smoothed**. Smoothing would swap a sourced
number for an invented one and hide the defect from the next reader, and a
chart that quietly disagrees with the one Ruairi has seen is worse than one
that matches it and says where it is soft. The trend would put it near 71.6.

## How far the chart can be trusted

[Fact] Published versions disagree past roughly 10 reps-to-failure.
[1rmcalculator.org](https://www.1rmcalculator.org/programs/rpe-calculator)
gives 73%, 74% and 71% for three cells that are all eleven reps from failure
and must therefore be equal — it breaks the chart's own invariant, so its tail
is rounding noise rather than data.

[Fact] [rippedbody.com](https://rippedbody.com/rpe/), citing Nuzzo et al.
(2024), reports the spread of reps achieved at a given percentage is
"surprisingly large, especially at low percentages" and cautions specifically
about RIR ratings on sets beyond 12 reps. That is **independent support for
`MAX_REPS_TO_FAILURE = 12`**, which had been set on Brzycki's range alone.

So `chartPercent` returns null outside the published range rather than
extrapolating into the region where the sources stop agreeing.

## The decision this hands over

The chart and Brzycki disagree, and the gap is not noise.

| | 170 × 5 @ RPE 8 |
| --- | --- |
| Brzycki (shipping today) | **204.0 kg** |
| RTS chart | **209.6 kg** |
| gap | 5.6 kg, ~2.7% |

They agree exactly at a true single — both return the weight on the bar, so the
anchor argument that chose Brzycki over Epley does not separate these two. The
chart reads higher everywhere else, never lower.

Downstream, that 5.6kg becomes **2.5kg on a 75% backoff** once Order 18 rounds
to something loadable.

Adopting the chart would rewrite every stored `e1rm_kg` via `npm run
e1rm:backfill`, and with it every rollup's `best_e1rm_kg`, every `estimated`
reference max, and every percentage Order 18 syncs to a session — on an
instance being dogfooded from mid-October. That is a live-data migration, so
it is Joey's call and not this ticket's.

**[SME to confirm]** — the strongest argument for switching is that Ruairi is
an RTS-trained coach and the chart is the one he has in his head; the Lift
Detail blueprint already contrasts a personal curve against what "the standard
chart says". That is a claim about Ruairi, not a fact, and he should be asked.

## Files

| File | What it holds |
| --- | --- |
| `lib/strength/rpe-chart.ts` | `RTS_CHART`, `chartPercent`, `chartPercentFor`, `chartOneRepMax` |
| `lib/strength/e1rm.ts` | Brzycki, unchanged, still the one in use |
