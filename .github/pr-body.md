## Order 26 — RPE chart and e1RM derivation

CLAUDE.md required this chart be checked against a published source before
anything hardcoded it, because wrong numbers here are wrong numbers in every
athlete's program. **This is that check.** The findings matter more than the
code, and nothing is wired to the result.

> Taken out of numeric order because 19–23 all sit behind Ruairi's
> block-up-front question and 24 behind his review-day question. Order 26 is
> `No UI (backend)` and fully unblocked.

### It is one curve, not a grid

Published as an 8 × 10 table of RPE against reps, it is really a function of a
single variable: **reps-to-failure**. 3 reps @ RPE 10, 2 @ RPE 9 and 1 @ RPE 8
are all three reps from failure, and all three are 92.2%.

[Fact] **All 80 published cells collapse onto 26 distinct values with zero
contradictions**, checked cell by cell.

That collapse *is* the verification, not a tidy-up — an 8 × 10 grid can only
fold onto one curve if every cell agrees with every other cell the same
distance from failure. So the test keeps the published grid in its original
shape and asserts the fold: a transcription error anywhere breaks the build
instead of sitting in the table unnoticed.

### The kink is real, and row 11 was the right place to look

[Fact] Each step down shrinks smoothly as the curve flattens — −4.5, −3.3,
−3.0, −2.9, −2.6, −2.6, −2.5, −2.4, −2.3 — then jumps to **−3.2** at 10 → 11
and returns to −2.7. As second differences: +0.3, +0.1, +0.3, 0.0, +0.1, +0.1,
+0.1, **−0.9**, +0.5. One sign reversal in the entire series, exactly at 11.

**Kept as published, not smoothed.** Smoothing swaps a sourced number for an
invented one and hides the defect from the next reader; a chart that quietly
disagrees with the one Ruairi has seen is worse than one that matches it and
says where it is soft. The trend would put it near 71.6.

### How far the tail can be trusted

[Fact] A second source gives 73%, 74% and 71% for three cells that are all
eleven reps from failure and must be equal — it breaks the chart's own
invariant, so its tail is rounding noise, not data.

[Fact] A third, citing Nuzzo et al. (2024), reports the spread of reps at a
given percentage is "surprisingly large, especially at low percentages" and
cautions about RIR reports beyond 12 reps — **independent support for
`MAX_REPS_TO_FAILURE = 12`**, which had been set on Brzycki's range alone.

So the lookup returns null outside the published range rather than
extrapolating into the region where sources stop agreeing.

### The decision this hands over — not taken here

| | 170 × 5 @ RPE 8 |
| --- | --- |
| Brzycki (shipping today) | **204.0 kg** |
| RTS chart | **209.6 kg** |
| gap | 5.6 kg, ~2.7% |

They agree **exactly** on a true single, so the anchor argument that chose
Brzycki over Epley does not separate these two. The chart reads higher
everywhere else, never lower. Downstream, 5.6kg becomes **2.5kg on a 75%
backoff** once Order 18 rounds to something loadable.

Adopting it would rewrite every stored `e1rm_kg` via `e1rm:backfill`, and with
it every rollup's `best_e1rm_kg`, every `estimated` reference max, and every
percentage Order 18 syncs to a session — on an instance being dogfooded from
mid-October. That is a live-data migration, so it is Joey's call, and this
ships as a reference that changes nothing. The switch stays a one-line change
plus a script run, which is the position `e1rm.ts` says it wants to be in.

**[SME to confirm]** — the strongest argument for switching is that Ruairi is
RTS-trained and this is the chart in his head; the Lift Detail blueprint
already contrasts a personal curve against what "the standard chart says".
That is a claim about Ruairi, not a fact.

### Verification

`typecheck` · `lint` · **1054 tests** (14 on this module) · `build`.
No schema change, no probe run, no data touched.

Sources: [Fitness Volt — Tuchscherer chart](https://fitnessvolt.com/rpe-training/guides/tuchscherer-chart-explained/) ·
[1rmcalculator.org](https://www.1rmcalculator.org/programs/rpe-calculator) ·
[Ripped Body (Nuzzo et al. 2024)](https://rippedbody.com/rpe/)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
