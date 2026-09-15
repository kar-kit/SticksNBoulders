## Order 27 — Next set load suggestion

> "Log RPE 7 at 170 and the app suggests the next step."

The thing Joey already does by hand between sets, asking Claude — which the
ticket calls the strongest signal it belongs in the product.

### A suggestion is a ratio, and that is why it could ship now

`load × percent(target) ÷ percent(logged)` — the estimated max appears in both
halves and **cancels**. A suggestion never depends on the absolute value of the
e1RM curve, only on its shape over a short span.

That matters because the curve is an open decision. Order 26 measured the RTS
chart **2.7% away** from the Brzycki formula shipping today, and choosing
between them is a live-data migration and Joey's call. Anything depending on
the absolute curve has to wait for it. This does not:

[Fact] Over the suggestions this module actually makes, the two curves disagree
by **0.1–0.5kg** — inside one plate step, so both round to the same weight.
There is a test asserting exactly that on the set the two curves value 5.6kg
apart as an e1RM.

[Fact] The exception is a target near a maximal single, where they can differ by
**4.4kg** because they part company where the curve is steepest. Flagged on the
result as `nearMaximal`, **not gated** — working up to a top single is exactly
what a powerlifter does.

### Where that divergence lives — the intuition is wrong

I expected it to track the target. It tracks **distance travelled**, cleanly and
monotonically:

| jump distance (reps-to-failure) | worst disagreement, 170kg set |
| --- | --- |
| 0.5 | 1.67 kg |
| 1 | 3.15 kg |
| 2 | 4.38 kg |
| 4 | 5.74 kg |

Grouped by *target* instead there is no clean pattern — 5.74 at a target of 1,
but still 4.40 at a target of 5. So the bound belongs on reach, which is where
it wanted to be on product grounds anyway.

`MAX_SUGGESTION_SPAN = 2` reps-to-failure. An athlete who did 8 at RPE 7 has
told you very little about a heavy single, and a suggestion that confident would
be a guess wearing a number.

### No default target, deliberately

The target RPE comes from a prescription. An athlete without one has nothing to
suggest toward — prefill's rule 3, *repeat the previous set*, is already the
right answer, and a manufactured suggestion would outrank it while saying less.

Other refusals, each a real case: no RPE on the logged set ("not sure" — the set
could be a grinder or an easy back-off at the same load and reps), a warm-up,
either end past `MAX_REPS_TO_FAILURE`.

### Why it stays unwired — and this time a caller exists

`lib/logging/prefill.ts` already accepts a `Suggestion` and ranks it second. So
unlike Order 18, wiring it is one line.

It stays unwired because **Order 28** asks whether load suggestions reach
athletes directly or wait behind coach approval, and calls that "a coaching
philosophy question, not ours — ask Ruairi". Wiring the live path answers that
question by default, in the direction of straight through. The ticket's own rule
points the same way: "always a suggestion, always overridable, never silently
imposed."

### Refactor included

`LOADABLE_INCREMENT_KG` and `roundToLoadable` moved from `lib/programming` to
`lib/strength/plates.ts`. Plate maths is a fact about barbells, not about
prescriptions; both the suggestion engine and the percentage resolver need it;
and `lib/programming` depends on `lib/strength` rather than the reverse.
`prescription.ts` re-exports them, so nothing else moved.

### Verification

`typecheck` · `lint` · **1068 tests** (14 on this module) · `build`.
No schema change, no data touched.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
